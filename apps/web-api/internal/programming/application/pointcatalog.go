package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// PointCatalogEntry chiếu một Point canonical cho binding — DM-PROG-001 §3.5.
// Category theo đúng ba giá trị đã khoá ở OD-PROG-007: LOCAL/VP/MB_RTU;
// KHÔNG được phát minh category thứ tư.
type PointCatalogEntry struct {
	Category   string `json:"category"`
	PointID    string `json:"pointId"`
	DeviceID   string `json:"deviceId,omitempty"`
	Name       string `json:"name"`
	DataType   string `json:"dataType"`
	Unit       string `json:"unit,omitempty"`
	Direction  string `json:"direction"`
	Writable   bool   `json:"writable"`
	Quality    string `json:"quality"`
	Value      any    `json:"value"`
	ObservedAt string `json:"observedAt,omitempty"`
	// ExtIndex — slot EXT 1-based mà runtime sẽ dùng cho điểm MB_RTU. 0 = CHƯA
	// CẤP: `ISS-PIO-31` còn nợ bảng cấp phát bền, nên adapter chưa điền được.
	// Đây không phải trường trang trí — `EvaluatePointMapEligibility` đọc nó để
	// quyết định MB_RTU đã bind được chưa, nên ngày `ISS-PIO-31` phát số thật
	// thì năng lực tự mở, không ai phải nhớ sửa thêm chỗ nào.
	ExtIndex int `json:"extIndex,omitempty"`
	// Mapping là QUYẾT ĐỊNH eligibility do server cấp kèm lý do (`ISS-PIO-32`).
	// FE render nguyên văn; nó KHÔNG được giữ bản luật thứ hai.
	Mapping PointMapEligibility `json:"mapping"`
}

// PointCatalogProvider được `internal/app` implement (adapter quanh
// `App.ReadPoints`) và tiêm vào từ `internal/app/main.go` — `application`
// không được import `internal/app` (ngược hướng phụ thuộc), nên interface
// đứng ở đây theo đúng nguyên tắc Go "accept interfaces, return structs".
type PointCatalogProvider interface {
	ListPointCatalog(ctx context.Context) ([]PointCatalogEntry, error)
}

type PointCatalogPage struct {
	Items      []PointCatalogEntry `json:"items"`
	NextCursor *string             `json:"nextCursor,omitempty"`
}

// `ISS-PIO-04` — PHÂN TRANG TẤT ĐỊNH THEO KHOÁ BỀN.
//
// LỖI CŨ
// ------
// Catalog cắt cứng ở 500 mục NHƯNG VẪN KHAI LÀ ĐÃ ĐỦ: `entries[:limit]` rồi trả
// `NextCursor = nil`. FE suy "đầy đủ" chỉ từ `nextCursor`, nên với một cấu hình
// hợp lệ vượt 500 điểm — trần thật của hệ là 24 LOCAL + 464 VP + 256 EXT = 744 —
// những điểm cuối bảng chữ cái đơn giản KHÔNG TỒN TẠI đối với kỹ sư: bảng không
// có dấu "+", nút Map vẫn mở, và không một dòng cảnh báo.
//
// VÌ SAO CURSOR THEO KHOÁ CHỨ KHÔNG THEO OFFSET
// ---------------------------------------------
// Catalog đọc lại authority thật ở MỖI request, nên nội dung có thể đổi giữa
// hai trang. Với offset, thêm một điểm ở đầu bảng làm cả trang sau lùi một ô:
// một điểm bị lặp, một điểm biến mất. Cursor mang KHOÁ SẮP XẾP của mục cuối
// trang trước, nên chèn/xoá ở phần đã đi qua không đẩy phần chưa đi.
//
// Khoá là `(category, deviceId, pointId)` — đúng bộ ba danh tính bền mà
// `ISS-PIO-31` đã khoá. Không dùng `name`: người dùng đổi nhãn hiển thị thường
// xuyên, và một khoá sắp xếp đổi được là một cursor nhảy chỗ.
type pointCatalogCursor struct {
	Category       string `json:"category"`
	DeviceID       string `json:"deviceId"`
	PointID        string `json:"pointId"`
	ExpiresAtUTCMS int64  `json:"expiresAtUtcMs"`
}

// pointCatalogSortKey giữ đúng thứ tự so sánh của khoá bền.
func pointCatalogSortKey(entry PointCatalogEntry) [3]string {
	return [3]string{entry.Category, entry.DeviceID, entry.PointID}
}

func pointCatalogLess(left, right [3]string) bool {
	for index := 0; index < 3; index++ {
		if left[index] != right[index] {
			return left[index] < right[index]
		}
	}
	return false
}

// ListPointCatalog KHÔNG cache — mỗi request đọc lại authority thật.
//
// `encodedCursor` rỗng = trang đầu. `NextCursor` khác nil nghĩa là CÒN mục —
// và đó là tín hiệu duy nhất FE dùng để biết bảng chưa đủ, nên nó phải đúng.
func (s *RuntimeService) ListPointCatalog(ctx context.Context, encodedCursor string,
	limit int) (PointCatalogPage, error) {
	if s.catalog == nil {
		return PointCatalogPage{}, fmt.Errorf("Programming point catalog provider chưa cấu hình")
	}
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	var after *[3]string
	if encodedCursor != "" {
		cursor, err := s.decodePointCatalogCursor(encodedCursor)
		if err != nil {
			return PointCatalogPage{}, err
		}
		key := [3]string{cursor.Category, cursor.DeviceID, cursor.PointID}
		after = &key
	}

	entries, err := s.catalog.ListPointCatalog(ctx)
	if err != nil {
		return PointCatalogPage{}, err
	}
	sort.Slice(entries, func(left, right int) bool {
		return pointCatalogLess(pointCatalogSortKey(entries[left]), pointCatalogSortKey(entries[right]))
	})

	page := PointCatalogPage{Items: make([]PointCatalogEntry, 0, limit)}
	remaining := false
	for _, entry := range entries {
		key := pointCatalogSortKey(entry)
		if after != nil && !pointCatalogLess(*after, key) {
			continue
		}
		if len(page.Items) == limit {
			/* Còn ít nhất một mục sau trang này. Dừng ở đây thay vì đếm hết:
			 * thứ FE cần biết là "còn nữa", không phải "còn bao nhiêu". */
			remaining = true
			break
		}
		/* Eligibility tính Ở ĐÂY, trên đường ra duy nhất của catalog: tính ở
		 * adapter thì mỗi provider phải nhớ gọi, mà "phải nhớ gọi" chính là cách
		 * bản luật thứ hai ở FE đã sinh ra. */
		entry.Mapping = EvaluatePointMapEligibility(entry)
		page.Items = append(page.Items, entry)
	}
	if remaining && len(page.Items) > 0 {
		last := page.Items[len(page.Items)-1]
		encoded, err := s.encodePointCatalogCursor(pointCatalogCursor{
			Category: last.Category, DeviceID: last.DeviceID, PointID: last.PointID,
			ExpiresAtUTCMS: s.now().UTC().Add(pointCatalogCursorTTL).UnixMilli(),
		})
		if err != nil {
			return PointCatalogPage{}, err
		}
		page.NextCursor = &encoded
	}
	return page, nil
}

// pointCatalogCursorTTL — cursor là ảnh chụp một vị trí trong danh sách, không
// phải một quyền. Hết hạn ngắn để một cursor cũ không được dùng lại sau khi
// catalog đã đổi hẳn; FE luôn có thể bắt đầu lại từ trang đầu.
const pointCatalogCursorTTL = 15 * time.Minute

func (s *RuntimeService) encodePointCatalogCursor(cursor pointCatalogCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *RuntimeService) decodePointCatalogCursor(encoded string) (pointCatalogCursor, error) {
	parts := strings.Split(encoded, ".")
	if len(parts) != 2 || len(encoded) > 1024 {
		return pointCatalogCursor{}, ErrInvalidCursor
	}
	/* `Strict()` chứ không phải decoder mặc định — cùng lý do đã ghi ở
	 * `decodeLibraryCursor`: base64 raw cho phép ký tự cuối mang bit không dùng,
	 * nên một cursor bị sửa vẫn có thể decode ra đúng chữ ký cũ. */
	payload, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil {
		return pointCatalogCursor{}, ErrInvalidCursor
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return pointCatalogCursor{}, ErrInvalidCursor
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return pointCatalogCursor{}, ErrInvalidCursor
	}
	var cursor pointCatalogCursor
	if err := decodeStrict(payload, &cursor); err != nil ||
		!validText(cursor.Category, 1, 16) || !validText(cursor.PointID, 1, 64) ||
		len(cursor.DeviceID) > 64 || s.now().UTC().UnixMilli() >= cursor.ExpiresAtUTCMS {
		return pointCatalogCursor{}, ErrInvalidCursor
	}
	return cursor, nil
}
