package application

import (
	"context"
	"fmt"
	"testing"
	"time"
)

/* `ISS-PIO-04` — phân trang tất định theo khoá bền.
 *
 * Trần thật của hệ là 24 LOCAL + 464 VP + 256 EXT = 744 điểm, nên "vượt 500" là
 * một cấu hình HỢP LỆ chứ không phải ca biên hiếm. Bản cũ cắt ở 500 rồi vẫn khai
 * là đủ, và những điểm cuối bảng chữ cái đơn giản không tồn tại đối với kỹ sư. */

type stubCatalogProvider struct{ entries []PointCatalogEntry }

func (s *stubCatalogProvider) ListPointCatalog(context.Context) ([]PointCatalogEntry, error) {
	return append([]PointCatalogEntry(nil), s.entries...), nil
}

func catalogEntry(category, deviceID, pointID string) PointCatalogEntry {
	return PointCatalogEntry{
		Category: category, DeviceID: deviceID, PointID: pointID,
		Name: pointID, DataType: "REAL", Direction: "READ", Quality: "GOOD",
	}
}

func catalogService(t *testing.T, provider *stubCatalogProvider) *RuntimeService {
	t.Helper()
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: &fakeRuntimeStatusReader{}, ControllerID: "controller-1",
		Catalog: provider, CursorSecret: []byte("0123456789abcdef0123456789abcdef"),
		Now: func() time.Time { return time.Unix(1_760_000_000, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("dựng RuntimeService: %v", err)
	}
	return service
}

// walkCatalog đi hết mọi trang và trả danh sách `pointId` theo thứ tự nhận được.
func walkCatalog(t *testing.T, service *RuntimeService, limit int) []string {
	t.Helper()
	var seen []string
	cursor := ""
	for page := 0; page < 100; page++ {
		result, err := service.ListPointCatalog(context.Background(), cursor, limit)
		if err != nil {
			t.Fatalf("trang %d: %v", page, err)
		}
		for _, item := range result.Items {
			seen = append(seen, item.PointID)
		}
		if result.NextCursor == nil {
			return seen
		}
		cursor = *result.NextCursor
	}
	t.Fatal("phân trang không kết thúc sau 100 trang")
	return nil
}

func TestCatalogOver500ItemsPaginatesWithoutLosingAny(t *testing.T) {
	// 744 = 24 LOCAL + 464 VP + 256 EXT, đúng trần thật của hệ.
	provider := &stubCatalogProvider{}
	for index := 1; index <= 24; index++ {
		provider.entries = append(provider.entries, catalogEntry("LOCAL", "", fmt.Sprintf("UI-%03d", index)))
	}
	for index := 1; index <= 464; index++ {
		provider.entries = append(provider.entries, catalogEntry("VP", "", fmt.Sprintf("AV-%03d", index)))
	}
	for index := 1; index <= 256; index++ {
		provider.entries = append(provider.entries,
			catalogEntry("MB_RTU", "bus-1-slave-2", fmt.Sprintf("REG_%03d", index)))
	}
	service := catalogService(t, provider)

	seen := walkCatalog(t, service, 500)

	if len(seen) != 744 {
		t.Fatalf("phải đi hết 744 điểm, nhận %d", len(seen))
	}
	unique := map[string]bool{}
	for _, pointID := range seen {
		if unique[pointID] {
			t.Fatalf("điểm %s xuất hiện hai lần", pointID)
		}
		unique[pointID] = true
	}
}

// Trang đầu PHẢI nói ra rằng còn nữa. Đây chính là chỗ bản cũ nói dối: cắt ở
// 500 rồi trả `nextCursor = nil`, và FE suy "đầy đủ" từ đúng trường đó.
func TestCatalogFirstPageAdmitsThereIsMore(t *testing.T) {
	provider := &stubCatalogProvider{}
	for index := 1; index <= 600; index++ {
		provider.entries = append(provider.entries, catalogEntry("VP", "", fmt.Sprintf("AV-%03d", index)))
	}
	service := catalogService(t, provider)

	page, err := service.ListPointCatalog(context.Background(), "", 500)
	if err != nil {
		t.Fatalf("trang đầu: %v", err)
	}
	if len(page.Items) != 500 {
		t.Fatalf("trang đầu phải đủ 500 mục, nhận %d", len(page.Items))
	}
	if page.NextCursor == nil {
		t.Fatal("catalog 600 mục mà trang đầu khai là đã đủ — đúng lỗi F-PIO-004")
	}
}

/* Catalog ĐỔI giữa hai trang. Với cursor theo offset, thêm một điểm ở đầu bảng
 * làm cả trang sau lùi một ô: một điểm bị lặp, một điểm biến mất. Cursor theo
 * KHOÁ thì phần đã đi qua không đẩy phần chưa đi. */
func TestCatalogChangingBetweenPagesNeverRepeatsOrSkips(t *testing.T) {
	provider := &stubCatalogProvider{}
	for index := 1; index <= 10; index++ {
		provider.entries = append(provider.entries, catalogEntry("VP", "", fmt.Sprintf("AV-%02d", index)))
	}
	service := catalogService(t, provider)

	first, err := service.ListPointCatalog(context.Background(), "", 4)
	if err != nil {
		t.Fatalf("trang đầu: %v", err)
	}
	if first.NextCursor == nil {
		t.Fatal("còn mục mà không có cursor")
	}

	// Chèn một điểm đứng TRƯỚC toàn bộ trang đầu, và xoá một điểm đã đọc.
	provider.entries = append(provider.entries, catalogEntry("VP", "", "AA-00"))
	provider.entries = provider.entries[1:]

	var rest []string
	cursor := *first.NextCursor
	for page := 0; page < 100; page++ {
		result, err := service.ListPointCatalog(context.Background(), cursor, 4)
		if err != nil {
			t.Fatalf("trang tiếp: %v", err)
		}
		for _, item := range result.Items {
			rest = append(rest, item.PointID)
		}
		if result.NextCursor == nil {
			break
		}
		cursor = *result.NextCursor
	}

	firstIDs := map[string]bool{}
	for _, item := range first.Items {
		firstIDs[item.PointID] = true
	}
	for _, pointID := range rest {
		if firstIDs[pointID] {
			t.Fatalf("điểm %s lặp lại sau khi catalog đổi giữa hai trang", pointID)
		}
	}
	// Không nhảy: mọi điểm còn tồn tại và đứng sau trang đầu đều phải xuất hiện.
	for index := 5; index <= 10; index++ {
		wanted := fmt.Sprintf("AV-%02d", index)
		found := false
		for _, pointID := range rest {
			if pointID == wanted {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("điểm %s bị nhảy qua sau khi catalog đổi", wanted)
		}
	}
}

// Cursor bị sửa phải bị TỪ CHỐI, không được âm thầm coi như trang đầu: một
// cursor giả mạo đọc lại từ đầu là một cách làm người dùng tin bảng đã đủ.
func TestCatalogRejectsTamperedCursor(t *testing.T) {
	provider := &stubCatalogProvider{}
	for index := 1; index <= 10; index++ {
		provider.entries = append(provider.entries, catalogEntry("VP", "", fmt.Sprintf("AV-%02d", index)))
	}
	service := catalogService(t, provider)

	page, err := service.ListPointCatalog(context.Background(), "", 4)
	if err != nil || page.NextCursor == nil {
		t.Fatalf("cần một cursor hợp lệ để tiêm: %v / %+v", err, page.NextCursor)
	}
	tampered := *page.NextCursor
	tampered = tampered[:len(tampered)-2] + "AA"

	if _, err := service.ListPointCatalog(context.Background(), tampered, 4); err == nil {
		t.Fatal("cursor bị sửa mà vẫn được chấp nhận")
	}
}
