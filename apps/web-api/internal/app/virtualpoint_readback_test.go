package app

import (
	"os"
	"path/filepath"
	"testing"
)

// Đọc ngược giá trị Virtual Point do ST Program ghi (`F-PROG-ASBUILT-016`).
//
// Bẫy đã cắn một lần và test này tồn tại để nó không cắn lần nữa:
// `pointKindFromID` trả `"virtual"` cho MỌI id không phải UI/AO/DO — tức cho
// chính các slot `AV`/`BV`/`MSV` cần bắt. Nếu phép bỏ qua `Kind == "virtual"`
// đứng TRƯỚC nhánh bắt slot thì bản đồ slot rỗng vĩnh viễn và mọi VP do chương
// trình sở hữu đọc ra `quality = unknown` — im lặng, vì kết quả đó trông y hệt
// "Core chưa có giá trị".
func TestOverlayVirtualPointsReadsProgramOwnedSlotFromCore(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	cfg := `{"items":[
      {"id":"VP15","tag":"VP_AHU_STATE_OUT","signalType":"float","enabled":true,
       "writable":true,"source":"PROGRAM","boundPointId":"AV-13","value":0},
      {"id":"VP1","tag":"VP_OCCUPIED","signalType":"boolean","enabled":true,
       "writable":true,"boundPointId":"BV-1","value":true},
      {"id":"VP99","tag":"VP_GHOST","signalType":"float","enabled":true,
       "writable":true,"source":"PROGRAM","boundPointId":"AV-30","value":7}
    ]}`
	if err := os.WriteFile(path, []byte(cfg), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	// Điểm Core cho slot ảo: `Kind` của chúng LÀ "virtual" — đó chính là chỗ
	// bẫy nằm, nên khẳng định tiền đề thay vì hard-code chuỗi.
	if k := pointKindFromID("AV13"); k != "virtual" {
		t.Fatalf("tien de sai: mong Kind=virtual cho AV13, nhan %q", k)
	}
	corePoints := []PointDTO{
		{ID: "UI1", Kind: "UI", Value: float32(21.5), Quality: "good"},
		{ID: "AV13", Kind: pointKindFromID("AV13"), Value: float32(20), Quality: "good",
			Source: "program", UpdatedAt: "2026-08-29T00:00:00Z"},
		{ID: "BV3", Kind: pointKindFromID("BV3"), Value: true, Quality: "good", Source: "program"},
	}

	byID := map[string]PointDTO{}
	for _, p := range app.overlayVirtualPoints(corePoints) {
		byID[p.ID] = p
	}

	got, ok := byID["VP15"]
	if !ok {
		t.Fatal("VP15 khong co trong ket qua")
	}
	if v, isF := got.Value.(float32); !isF || v != 20 {
		t.Fatalf("VP15 phai lay gia tri 20 tu slot Core AV-13, nhan %v (quality=%s)", got.Value, got.Quality)
	}
	if got.Quality != "good" {
		t.Fatalf("VP15 phai mang quality cua slot Core, nhan %q", got.Quality)
	}

	// VP do WEB sở hữu giữ nguyên đường cũ: đọc từ config, không từ Core.
	if v, isBool := byID["VP1"].Value.(bool); !isBool || !v {
		t.Fatalf("VP1 (WEB) phai giu gia tri config true, nhan %v", byID["VP1"].Value)
	}

	// PROGRAM nhưng Core không có slot ⇒ nói "chưa đọc được", tuyệt đối không
	// rơi về giá trị cấu hình: hiện một hằng số cho một điểm chưa đọc được là
	// bịa số.
	ghost := byID["VP99"]
	if ghost.Value != nil || ghost.Quality != "unknown" {
		t.Fatalf("VP99 khong tra duoc slot Core => phai la value=nil/quality=unknown, nhan %v/%q",
			ghost.Value, ghost.Quality)
	}

	// Slot AV/BV thô KHÔNG được lọt ra ngoài: VP là bề mặt duy nhất người dùng thấy.
	for id := range byID {
		if id == "AV13" || id == "BV3" {
			t.Fatalf("slot tho %s bi phat ra ngoai", id)
		}
	}
}

// Point Catalog phải phân biệt HAI TRỤC của một Virtual Point:
//
//	`writable`  — operator sửa được giá trị từ dashboard không;
//	`source`    — ai sở hữu slot: web-api hay ST Program.
//
// Trước `F-PROG-ASBUILT-016` chỉ có trục đầu, nên catalog báo READ cho mọi VP.
// Nay VP do CHƯƠNG TRÌNH sở hữu là đích ghi hợp lệ của `VAR_OUTPUT`; VP do
// web-api sở hữu thì không — chương trình ghi vào đó sẽ bị vòng đối chiếu kéo
// về giá trị cấu hình mỗi 10 giây, một cuộc giằng co im lặng.
func TestPointCatalogDirectionSeparatesWritableFromOwnership(t *testing.T) {
	cases := []struct {
		name      string
		point     PointDTO
		direction string
		writable  bool
	}{
		{"VP do web-api so huu, sua duoc tu dashboard",
			PointDTO{Kind: "virtual", Writable: true}, "READ", false},
		{"VP do web-api so huu, khong sua duoc",
			PointDTO{Kind: "virtual", Writable: false}, "READ", false},
		{"VP do CHUONG TRINH so huu",
			PointDTO{Kind: "virtual", Writable: true, VirtualSource: "PROGRAM"}, "READ_WRITE", true},
		{"khong phan biet hoa thuong",
			PointDTO{Kind: "virtual", VirtualSource: "program"}, "READ_WRITE", true},
		{"DO vat ly giu nguyen",
			PointDTO{Kind: "DO"}, "READ_WRITE", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir, w := pointCatalogDirection(tc.point)
			if dir != tc.direction || w != tc.writable {
				t.Fatalf("mong (%s,%v), nhan (%s,%v)", tc.direction, tc.writable, dir, w)
			}
		})
	}
}
