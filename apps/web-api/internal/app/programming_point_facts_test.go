package app

import (
	"context"
	"os"
	"strings"
	"testing"
)

/* ISS-PIO-28 — adapter cấu hình Point cho lớp Check, và CỔNG NỐI DÂY.
 *
 * Lớp `application` cố ý cho qua khi thiếu provider (binding LOCAL/VP mang
 * thẳng danh tính bền, khác slot Modbus). Cái giá của lựa chọn đó là phép kiểm
 * có thể IM LẶNG biến mất nếu ai đó gỡ dây — đúng lớp lỗi đã xảy ra với bộ test
 * `AlarmRuntime`. Nên bảo đảm nằm ở đây.
 */

func seedIOAndVP(t *testing.T, app *App) {
	t.Helper()
	write := func(name, body string) {
		if err := writeConfigFileAtomic(app.configPath(name), []byte(body), 0o644); err != nil {
			t.Fatalf("gieo %s: %v", name, err)
		}
	}
	write(configGroupIO.file, `{"ui":[{"ch":5,"tag":"UI-05","type":"ntc10k","enabled":true},{"ch":6,"tag":"UI-06","type":"","enabled":false}],
	  "ao":[{"ch":1,"tag":"AO-01","enabled":true}],"do":[{"ch":1,"tag":"DO-01","enabled":true}]}`)
	write(configGroupSafeState.file, `{"ao":[{"ch":1,"safe":0}],"do":[]}`)
	write(configGroupVirtualPoints.file, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,
	  "value":1,"boundPointId":"AV-07","source":"PROGRAM","restartPolicy":"initial","initialValue":20,"minValue":16,"maxValue":30}]}`)
}

func TestPointFactsAdapterReadsRunningConfig(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	seedIOAndVP(t, app)

	snapshot, err := app.programmingPointFacts().ResolvePointBindingFacts(context.Background())
	if err != nil {
		t.Fatalf("đọc cấu hình: %v", err)
	}

	ui5 := snapshot.Local["UI-05"]
	if !ui5.Enabled || ui5.SignalType != "ntc10k" {
		t.Fatalf("UI-05 = %+v", ui5)
	}
	if snapshot.Local["UI-06"].Enabled {
		t.Fatal("UI-06 khai enabled=false mà vẫn báo đang bật")
	}
	// `safe_state` có hàng AO-01 kèm khoá `safe`, không có hàng DO-01.
	if !snapshot.Local["AO-01"].HasSafeValue {
		t.Fatal("AO-01 đã khai safe mà không nhận ra")
	}
	if snapshot.Local["DO-01"].HasSafeValue {
		t.Fatal("DO-01 chưa khai safe mà vẫn báo có")
	}

	vp := snapshot.Virtual["VP1"]
	if !vp.Enabled || vp.Source != "PROGRAM" || vp.SignalType != "float" || !vp.HasInitial {
		t.Fatalf("VP1 = %+v", vp)
	}
	if vp.MinValue == nil || *vp.MinValue != 16 || vp.MaxValue == nil || *vp.MaxValue != 30 {
		t.Fatalf("biên kỹ thuật không được chở sang: %+v", vp)
	}
	/* Binding có thể mang mã SLOT (`AV-07`) thay vì mã điểm ảo: tab Ánh xạ phát
	 * mã slot cho category VP. Không đăng ký cả hai khoá thì mọi binding đi
	 * đường đó hiện thành "điểm ảo không tồn tại" — buộc tội sai một binding đúng. */
	if _, ok := snapshot.Virtual["AV-07"]; !ok {
		t.Fatal("mã slot AV-07 không tra được về điểm ảo")
	}
	/* Slot phải đi kèm facts: Check suy kiểu biến ST từ slot (`AV ⇒ REAL`), kể
	 * cả khi binding mang mã điểm ảo `VP1` thay vì mã slot. */
	if vp.BoundPointID != "AV-07" || snapshot.Virtual["AV-07"].BoundPointID != "AV-07" {
		t.Fatalf("slot không được chở sang facts: VP1=%q AV-07=%q", vp.BoundPointID, snapshot.Virtual["AV-07"].BoundPointID)
	}
}

/* `enabled` VẮNG MẶT khác `enabled: false`.
 *
 * Cấu hình đời cũ không có khoá này. Coi nó là "đã tắt" sẽ làm Check chặn mọi
 * binding của một tủ đang chạy tốt. */
func TestPointFactsTreatsMissingEnabledAsOn(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	if err := writeConfigFileAtomic(app.configPath(configGroupIO.file),
		[]byte(`{"ui":[{"ch":5,"tag":"UI-05","type":"ntc10k"}]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	snapshot, err := app.programmingPointFacts().ResolvePointBindingFacts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Local["UI-05"].Enabled {
		t.Fatal("cấu hình đời cũ không khai `enabled` bị coi là đã tắt")
	}
}

/* Lỗi đọc cấu hình KHÔNG bị nuốt thành ảnh chụp rỗng.
 *
 * Ảnh rỗng sẽ khiến MỌI điểm hiện thành "không có trong cấu hình" — một lời
 * buộc tội sai, và người vận hành sẽ đi sửa binding thay vì sửa cái đang thật
 * sự hỏng. */
func TestPointFactsSurfacesConfigReadError(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	if err := os.WriteFile(app.configPath(configGroupIO.file), []byte("{khong-phai-json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := app.programmingPointFacts().ResolvePointBindingFacts(context.Background()); err == nil {
		t.Fatal("cấu hình hỏng vẫn trả về ảnh chụp như thể mọi điểm đều biến mất")
	}
}

/* CỔNG NỐI DÂY — `NewApp` phải dựng `CheckService` kèm `PointFacts`.
 *
 * Đọc thẳng mã nguồn thay vì gọi `NewApp` (nó cần cả compiler, socket Core và
 * thư mục staging thật): thứ cần khoá ở đây là DÂY NỐI, và dây nối nằm trong
 * mã. Gỡ nó thì test này đỏ, không phải cả nhóm phép kiểm im lặng biến mất. */
func TestCheckServiceIsWiredWithPointFacts(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("đọc main.go: %v", err)
	}
	text := string(source)
	options := "programmingapplication.CheckServiceOptions{"
	start := strings.Index(text, options)
	if start < 0 {
		t.Fatal("không tìm thấy nơi dựng CheckService — cổng này đã mất mục tiêu, cập nhật lại nó")
	}
	end := strings.Index(text[start:], "\n\t\t})")
	if end < 0 {
		t.Fatal("không xác định được biên khối CheckServiceOptions")
	}
	block := text[start : start+end]
	if !strings.Contains(block, "PointFacts:") {
		t.Fatal("CheckService được dựng KHÔNG kèm PointFacts: phép kiểm đặc thù theo nguồn Point " +
			"(ISS-PIO-28) sẽ im lặng không chạy trên bản production")
	}
}
