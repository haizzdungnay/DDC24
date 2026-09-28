package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
)

/* T63-108 (PERF-API-03) — trả `304 Not Modified` cho GET bị poll dày mà nội
 * dung thường đứng yên.
 *
 * TRIỆU CHỨNG: `GET /alarms` bị trang Cảnh báo poll mỗi 2 s (và shell dùng nó
 * làm đường dự phòng mỗi 1 s khi snapshot overview không đáng tin); `GET /me`
 * mỗi 30 s. Gần như mọi lượt trả lại đúng từng byte của lượt trước, mà lần nào
 * cũng mã hoá và truyền trọn thân.
 *
 * VÌ SAO ETag THEO NỘI DUNG, KHÔNG THEO REVISION: một ETag chỉ an toàn khi hai
 * phản hồi cùng ETag là cùng từng byte. Danh sách cảnh báo không có revision
 * nào cả, còn revision của `/virtual-points` không đổi khi giá trị được đặt lại
 * lúc khởi động (`writeVirtualPointsConfigFile`) hay khi tệp cấu hình bị ghi
 * ngoài phễu — 304 theo revision ở đó sẽ cho trình duyệt dùng lại bản cũ đúng
 * lúc nó đã sai. Băm chính thân phản hồi thì 304 CHỈ xảy ra khi bản trình
 * duyệt đang giữ y hệt bản server sắp gửi; nó không bao giờ là "số cũ trông như
 * số mới".
 *
 * Handler vẫn chạy trọn (đọc Core, ghi lịch sử…) trước khi băm: 304 chỉ bớt
 * byte trên dây và phần giải mã phía trình duyệt, không bớt phép đọc authority.
 *
 * `Cache-Control: private, no-cache`: trình duyệt ĐƯỢC giữ bản sao nhưng PHẢI
 * hỏi lại server trước mỗi lần dùng — không bao giờ tự phục vụ cảnh báo từ
 * cache. `fetch()` mặc định tự gửi `If-None-Match` và trả thân đã cache khi
 * nhận 304, nên phía FE không cần đổi gì.
 */

// contentETag là ETag mạnh dựng từ SHA-256 của thân phản hồi (96 bit đầu).
func contentETag(body []byte) string {
	sum := sha256.Sum256(body)
	return `"c-` + hex.EncodeToString(sum[:12]) + `"`
}

// ifNoneMatchHits áp đúng RFC 9110 §13.1.2: `*` khớp mọi biểu diễn hiện có,
// danh sách nhiều tag cách nhau bởi dấu phẩy, so sánh YẾU (bỏ tiền tố `W/`).
func ifNoneMatchHits(header, etag string) bool {
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if header == "*" {
		return true
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, candidate := range strings.Split(header, ",") {
		if strings.TrimPrefix(strings.TrimSpace(candidate), "W/") == want {
			return true
		}
	}
	return false
}

// writeJSONRevalidated ghi `200` JSON kèm ETag theo nội dung, hoặc `304` không
// thân khi `If-None-Match` của request khớp ETag đó.
func writeJSONRevalidated(w http.ResponseWriter, r *http.Request, value any) {
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(value); err != nil {
		writeError(w, http.StatusInternalServerError, "encode response: "+err.Error())
		return
	}
	body := buf.Bytes()
	etag := contentETag(body)
	header := w.Header()
	header.Set("ETag", etag)
	header.Set("Cache-Control", "private, no-cache")
	if ifNoneMatchHits(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	header.Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
