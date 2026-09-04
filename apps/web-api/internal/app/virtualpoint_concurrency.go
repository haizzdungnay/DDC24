package app

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

/* ISS-PIO-37 — chống lost-update cho cấu hình Virtual Point.
 *
 * TRIỆU CHỨNG: hai người (hoặc hai tab của cùng một người) cùng mở danh sách
 * điểm ảo, cùng sửa, cùng bấm Lưu. Người ghi sau ĐÈ TRỌN thay đổi của người ghi
 * trước, và không ai được báo. `pointConfigMu` chỉ tuần tự hoá hai lời gọi
 * trong CÙNG tiến trình; nó không hề biết bản mà client đang sửa đã cũ.
 *
 * Vì sao nguy hiểm hơn "mất một lần sửa": người ghi sau thấy thao tác của mình
 * thành công và tin rằng trạng thái trên màn hình là trạng thái thiết bị. Thay
 * đổi bị mất chỉ lộ ra khi có người tình cờ mở lại — hoặc khi thiết bị chạy sai.
 *
 * CÁCH SỬA: ETag/If-Match tiêu chuẩn HTTP.
 *   - `GET /virtual-points` trả `ETag` = revision của không gian tên điểm.
 *   - Mọi lệnh ghi PHẢI gửi `If-Match`. Lệch ⇒ 412; thiếu ⇒ 428.
 *
 * VÌ SAO BẮT BUỘC CHỨ KHÔNG TUỲ CHỌN: một `If-Match` tuỳ chọn không chống được
 * gì cả — client cũ cứ bỏ trống là ghi đè như trước, và bề mặt API khi đó hứa
 * một sự bảo vệ mà nó không cưỡng chế. Bắt buộc thì hỏng ồn ào và sửa được;
 * tuỳ chọn thì hỏng im lặng, đúng lớp lỗi đang vá.
 *
 * `428 Precondition Required` cho ca THIẾU và `412 Precondition Failed` cho ca
 * LỆCH là hai câu trả lời khác nhau vì hai hành động khắc phục khác nhau: thiếu
 * ⇒ client phải gửi header; lệch ⇒ người dùng phải tải lại vì có người đã đổi.
 * Gộp cả hai vào 412 sẽ bảo một client cũ đi "tải lại", việc không giúp gì.
 */

// virtualPointETagHeader là tên header client đọc để lấy revision hiện tại.
const virtualPointETagHeader = "ETag"

// formatVirtualPointETag dựng ETag từ revision không gian tên điểm.
//
// Dùng ETag MẠNH (không có tiền tố `W/`): revision đổi đúng một bậc cho mỗi lần
// ghi, nên hai bản cùng revision là bằng nhau từng byte về phần cấu hình.
func formatVirtualPointETag(revision uint64) string {
	return fmt.Sprintf("\"vp:%d\"", revision)
}

// parseVirtualPointETag lấy revision từ giá trị `If-Match`.
//
// Chấp `*` (ghi đè có chủ đích, đúng ngữ nghĩa HTTP) bằng cách trả `matchAny`.
func parseVirtualPointETag(value string) (revision uint64, matchAny bool, ok bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "*" {
		return 0, true, true
	}
	trimmed = strings.TrimPrefix(trimmed, "W/")
	if len(trimmed) < 2 || !strings.HasPrefix(trimmed, "\"") || !strings.HasSuffix(trimmed, "\"") {
		return 0, false, false
	}
	inner := trimmed[1 : len(trimmed)-1]
	digits, found := strings.CutPrefix(inner, "vp:")
	if !found {
		return 0, false, false
	}
	parsed, err := strconv.ParseUint(digits, 10, 64)
	if err != nil {
		return 0, false, false
	}
	return parsed, false, true
}

// setVirtualPointETag gắn ETag hiện tại lên phản hồi đọc.
//
// Không đọc được authority thì KHÔNG gắn ETag: một ETag bịa sẽ khiến lệnh ghi
// kế tiếp qua được phép kiểm mà không có cơ sở nào — tệ hơn hẳn việc client
// nhận về một phản hồi không có ETag và phải hỏi lại.
func (a *App) setVirtualPointETag(w http.ResponseWriter) {
	authority, err := a.readPointNamespaceAuthority()
	if err != nil {
		return
	}
	w.Header().Set(virtualPointETagHeader, formatVirtualPointETag(authority.Revision))
}

/* requireVirtualPointPrecondition kiểm `If-Match` trước một lệnh ghi VP.
 *
 * Trả `true` khi được phép ghi tiếp. Khi trả `false` nó ĐÃ ghi phản hồi lỗi,
 * nên nơi gọi chỉ cần `return`.
 */
func (a *App) requireVirtualPointPrecondition(w http.ResponseWriter, r *http.Request) bool {
	header := strings.TrimSpace(r.Header.Get("If-Match"))
	if header == "" {
		writeError(w, http.StatusPreconditionRequired,
			"thiếu header If-Match; đọc GET /virtual-points để lấy ETag rồi gửi lại — nếu không, một lần lưu đồng thời sẽ đè mất thay đổi của người khác")
		return false
	}
	authority, err := a.readPointNamespaceAuthority()
	if err != nil {
		/* Không đọc được revision hiện tại ⇒ KHÔNG có cơ sở để so. Fail closed:
		 * cho qua ở đây là bỏ đúng phép kiểm này trong đúng lúc hệ thống đang
		 * không khoẻ. */
		writeError(w, http.StatusServiceUnavailable, "không đọc được revision điểm ảo để kiểm If-Match: "+err.Error())
		return false
	}
	requested, matchAny, ok := parseVirtualPointETag(header)
	if !ok {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("If-Match %q không đúng dạng; chờ ETag lấy từ GET /virtual-points (ví dụ %s)", header, formatVirtualPointETag(authority.Revision)))
		return false
	}
	if matchAny {
		return true
	}
	if requested != authority.Revision {
		writeError(w, http.StatusPreconditionFailed,
			fmt.Sprintf("cấu hình điểm ảo đã ở revision %d, bản bạn đang sửa là %d; tải lại rồi thao tác lại để không đè mất thay đổi của người khác",
				authority.Revision, requested))
		return false
	}
	return true
}
