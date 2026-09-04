package app

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

/* ISS-PIO-19 — nguồn cảnh báo cho điểm Modbus RTU (F-PIO-023), và lệch hợp đồng
 * web-api ↔ Core phát hiện khi làm issue này.
 */

func alarmRow(sources ...AlarmSource) AlarmSetting {
	hh, h, l, ll := 32.0, 28.0, 16.0, 12.0
	return AlarmSetting{
		ID: "ALM-001", Label: "Fault word", Enabled: true, AlarmType: alarmTypeHighLowInput,
		Sources: sources, Priority: "high", ClearMode: "auto",
		Params: &AlarmParams{HH: &hh, H: &h, L: &l, LL: &ll},
	}
}

// Điểm Modbus đặt được cảnh báo — điều kiện đóng của issue.
func TestAlarmSourceAcceptsModbusRtu(t *testing.T) {
	rows := []AlarmSetting{alarmRow(AlarmSource{Kind: alarmSourceKindModbus, Channel: 3, PointID: "EXT-03"})}
	if errs := validateAlarmSettings(rows); len(errs) != 0 {
		t.Fatalf("nguồn MB_RTU hợp lệ vẫn bị từ chối: %v", errs)
	}
}

// Slot ext ngoài dải bị chặn.
func TestAlarmSourceRejectsModbusChannelOutOfRange(t *testing.T) {
	for _, channel := range []int{0, kxNEXT + 1} {
		rows := []AlarmSetting{alarmRow(AlarmSource{Kind: alarmSourceKindModbus, Channel: channel, PointID: "EXT-01"})}
		if errs := validateAlarmSettings(rows); len(errs) == 0 {
			t.Fatalf("channel %d phải bị từ chối", channel)
		}
	}
}

/* `pointId` phải khớp slot ext, không phải danh theo `kind`.
 *
 * `formatPointID("MB_RTU", 3)` cho ra `MB_RTU-03`, một chuỗi Core không phân
 * giải được. Nhận nó ở đây là ghi ra một tệp mà Core từ chối — và Core từ chối
 * MỘT dòng là bỏ nạp TOÀN BỘ cấu hình cảnh báo. */
func TestAlarmSourceModbusPointIDMustBeExtSlot(t *testing.T) {
	rows := []AlarmSetting{alarmRow(AlarmSource{Kind: alarmSourceKindModbus, Channel: 3, PointID: "MB_RTU-03"})}
	errs := validateAlarmSettings(rows)
	if len(errs) == 0 {
		t.Fatal("pointId không phải EXT-NN vẫn được nhận")
	}
	joined := configValidationSummary(errs)
	if !strings.Contains(joined, "EXT-03") {
		t.Fatalf("thông báo không nói dạng đúng: %s", joined)
	}
}

// Các kind cũ giữ nguyên hành vi.
func TestAlarmSourceKeepsExistingKinds(t *testing.T) {
	for _, tc := range []struct {
		kind    string
		channel int
		pointID string
	}{{"UI", 1, "UI-01"}, {"AO", 1, "AO-01"}, {"DO", 1, "DO-01"}, {"VP", 1, "VP1"}} {
		rows := []AlarmSetting{alarmRow(AlarmSource{Kind: tc.kind, Channel: tc.channel, PointID: tc.pointID})}
		if errs := validateAlarmSettings(rows); len(errs) != 0 {
			t.Fatalf("kind %s bị từ chối: %v", tc.kind, errs)
		}
	}
}

// Kind lạ vẫn bị từ chối, và thông báo phải liệt kê đủ tập hợp lệ mới.
func TestAlarmSourceRejectsUnknownKindAndListsModbus(t *testing.T) {
	rows := []AlarmSetting{alarmRow(AlarmSource{Kind: "MODBUS", Channel: 1, PointID: "EXT-01"})}
	errs := validateAlarmSettings(rows)
	if len(errs) == 0 {
		t.Fatal("kind lạ vẫn được nhận")
	}
	if !strings.Contains(configValidationSummary(errs), alarmSourceKindModbus) {
		t.Fatalf("thông báo chưa liệt kê MB_RTU: %s", configValidationSummary(errs))
	}
}

/* Nguồn VP ghi ra tệp phải kèm `boundPointId`.
 *
 * Core nạp CÙNG tệp `alarm_settings.conf` này và không biết ánh xạ điểm ảo →
 * slot. Thiếu trường này, Core in `vp_missing_bound` và bỏ nạp cả cấu hình —
 * tức mọi cảnh báo phần cứng của tủ ngừng hoạt động, im lặng. */
func TestSaveAlarmSettingsWritesBoundPointIDForVirtualSources(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1,"boundPointId":"AV-07"}]}`)

	rows := []AlarmSetting{alarmRow(AlarmSource{Kind: "VP", Channel: 1, PointID: "VP1"})}
	if err := app.SaveAlarmSettings(context.Background(), rows); err != nil {
		t.Fatalf("lưu: %v", err)
	}
	data, err := os.ReadFile(app.alarmSettingsPath())
	if err != nil {
		t.Fatalf("đọc tệp: %v", err)
	}
	var written []AlarmSetting
	if err := json.Unmarshal(data, &written); err != nil {
		t.Fatalf("giải mã: %v (raw=%s)", err, data)
	}
	if got := written[0].Sources[0].BoundPointID; got != "AV-07" {
		t.Fatalf("boundPointId = %q; muốn AV-07 — thiếu nó Core bỏ nạp toàn bộ cảnh báo", got)
	}
	// Bề mặt API giữ nguyên `VP1`: vòng đọc-ghi của web-api không được đổi nghĩa.
	if got := written[0].Sources[0].PointID; got != "VP1" {
		t.Fatalf("pointId = %q; muốn giữ VP1", got)
	}
}

/* Số kênh VP KHÔNG được dùng để suy slot.
 *
 * Kênh VP và slot Core là hai dãy độc lập (`ISS-PIO-18`). Test này khoá đúng
 * điều đó: VP1 nằm trên `AV-07`, không phải `AV-01`. */
func TestBoundPointIDComesFromConfigNotChannelNumber(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	seedVPConfig(t, app, `{"items":[{"id":"VP1","tag":"sp","signalType":"float","enabled":true,"writable":true,"value":1,"boundPointId":"AV-07"}]}`)

	rows := app.resolveAlarmSourceBindings([]AlarmSetting{alarmRow(AlarmSource{Kind: "VP", Channel: 1, PointID: "VP1"})})
	if got := rows[0].Sources[0].BoundPointID; got == "AV-01" {
		t.Fatal("slot bị suy từ số kênh VP thay vì đọc cấu hình — sẽ gắn cảnh báo vào điểm khác")
	} else if got != "AV-07" {
		t.Fatalf("boundPointId = %q; muốn AV-07", got)
	}
}

/* Không tra được điểm ảo ⇒ để TRỐNG, không bịa slot.
 *
 * Bịa một slot là đem cảnh báo gắn vào một điểm khác, và không ai phát hiện cho
 * tới lúc nó không kêu. Core sẽ từ chối đúng dòng đó và nói ra. */
func TestResolveLeavesBoundEmptyWhenVirtualPointMissing(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	rows := app.resolveAlarmSourceBindings([]AlarmSetting{alarmRow(AlarmSource{Kind: "VP", Channel: 9, PointID: "VP9"})})
	if got := rows[0].Sources[0].BoundPointID; got != "" {
		t.Fatalf("boundPointId = %q; điểm ảo không tồn tại thì phải để trống", got)
	}
}

// Nguồn không phải VP không được mang `boundPointId` — một trường thừa ở đó chỉ
// làm người đọc tệp cấu hình đoán sai nó có ý nghĩa gì.
func TestResolveClearsBoundPointIDForNonVirtualSources(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	rows := app.resolveAlarmSourceBindings([]AlarmSetting{
		alarmRow(AlarmSource{Kind: "UI", Channel: 1, PointID: "UI-01", BoundPointID: "AV-01"}),
	})
	if got := rows[0].Sources[0].BoundPointID; got != "" {
		t.Fatalf("boundPointId = %q trên nguồn UI", got)
	}
}
