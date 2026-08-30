package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// Vòng đối chiếu VP ↔ Core (`F-PROG-ASBUILT-014` phần READ).
//
// Đẩy VP xuống Core MỘT LẦN lúc web-api khởi động là chưa đủ: nếu Core khởi
// động lại sau đó, av_[]/bv_[] reset về 0/BAD và không có gì đẩy lại, nên mọi
// ST Program bind VP đọc thành 0/false IM LẶNG. Quan sát được trên bo Foxlinx
// 2026-08-28: sau restart Core, `VP_OCCUPIED` đọc false nên AHU không rời OFF.

type recordingForcer struct {
	points []PointDTO
	forced []string
}

func (r *recordingForcer) ReadPoints(context.Context) ([]PointDTO, error) { return r.points, nil }

func (r *recordingForcer) ReadStatus(context.Context) (CoreStatus, error) { return CoreStatus{}, nil }

func (r *recordingForcer) ForcePointTTL(_ context.Context, id string, _ any, _ bool, _ uint32, _ string) (PointDTO, error) {
	r.forced = append(r.forced, id)
	return PointDTO{ID: id}, nil
}

func seedVirtualPoints(t *testing.T, app *App, body string) {
	t.Helper()
	path := filepath.Join(app.cfg.ConfigDir, "virtual_points.conf")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("seed config: %v", err)
	}
}

func TestReconcileBoundVirtualPointsPushesOnlyWhenCoreDiverges(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	seedVirtualPoints(t, app, `{"items":[
	  {"id":"VP1","tag":"OCC","signalType":"boolean","enabled":true,"writable":true,"boundPointId":"BV-1","value":true},
	  {"id":"VP2","tag":"SP","signalType":"float","enabled":true,"writable":true,"boundPointId":"AV-4","value":16.5},
	  {"id":"VP3","tag":"OUT","signalType":"float","enabled":true,"writable":true,"source":"PROGRAM","boundPointId":"AV-13","value":0}
	]}`)

	t.Run("Core khop cau hinh thi KHONG ghi gi", func(t *testing.T) {
		core := &recordingForcer{points: []PointDTO{
			{ID: "BV1", Value: true, Quality: "good"},
			{ID: "AV4", Value: float32(16.5), Quality: "good"},
			{ID: "AV13", Value: float32(20), Quality: "good"},
		}}
		app.core = core
		app.reconcileBoundVirtualPointsOnce(context.Background())
		if len(core.forced) != 0 {
			t.Fatalf("khong duoc ghi khi da khop, nhan %v", core.forced)
		}
	})

	t.Run("Core reset ve 0 sau restart thi day lai", func(t *testing.T) {
		core := &recordingForcer{points: []PointDTO{
			{ID: "BV1", Value: false, Quality: "good"},
			{ID: "AV4", Value: float32(0), Quality: "good"},
			{ID: "AV13", Value: float32(0), Quality: "good"},
		}}
		app.core = core
		app.reconcileBoundVirtualPointsOnce(context.Background())
		if len(core.forced) != 2 {
			t.Fatalf("phai day lai dung 2 VP do WEB so huu, nhan %v", core.forced)
		}
	})

	t.Run("slot do CHUONG TRINH so huu khong bao gio bi ghi de", func(t *testing.T) {
		core := &recordingForcer{points: []PointDTO{
			{ID: "BV1", Value: true, Quality: "good"},
			{ID: "AV4", Value: float32(16.5), Quality: "good"},
			// Chương trình vừa ghi 20; cấu hình vẫn để 0. Vòng đối chiếu KHÔNG
			// được kéo nó về 0 — đó là giẫm lên kết quả điều khiển.
			{ID: "AV13", Value: float32(20), Quality: "good"},
		}}
		app.core = core
		app.reconcileBoundVirtualPointsOnce(context.Background())
		for _, id := range core.forced {
			if id == "AV-13" || id == "AV13" {
				t.Fatalf("da ghi de slot do chuong trinh so huu: %v", core.forced)
			}
		}
	})

	t.Run("chat luong khac good cung la lech", func(t *testing.T) {
		core := &recordingForcer{points: []PointDTO{
			// Giá trị trùng nhưng BAD: chương trình đọc nó sẽ fail-closed, nên
			// phải đẩy lại dù con số tình cờ khớp.
			{ID: "BV1", Value: true, Quality: "bad"},
			{ID: "AV4", Value: float32(16.5), Quality: "good"},
		}}
		app.core = core
		app.reconcileBoundVirtualPointsOnce(context.Background())
		if len(core.forced) != 1 {
			t.Fatalf("phai day lai VP1 vi quality bad, nhan %v", core.forced)
		}
	})
}
