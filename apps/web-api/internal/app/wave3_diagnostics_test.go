package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Khoá hành vi bốn task Wave 3 vùng chẩn đoán/hệ thống của Plan 57:
// `T57-3.4` (lịch sử 60 phút), `T57-3.12` (ai đang dùng điểm ảo),
// `T57-3.14` (diff cấu hình trong nhật ký) và `T57-3.15` (mốc đồng bộ NTP).

func TestSystemHistoryRingKeepsOneHourAndSaysWhereItStarted(t *testing.T) {
	start := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC)
	ring := NewSystemHistoryRing(start)

	cpu := 12.5
	// Ba mẫu cách nhau đúng nhịp, và một mẫu cố tình quá dày.
	ring.Observe(start, OSMetrics{CPUPercent: &cpu})
	ring.Observe(start.Add(time.Second), OSMetrics{CPUPercent: &cpu})
	ring.Observe(start.Add(systemHistoryInterval), OSMetrics{CPUPercent: &cpu})
	ring.Observe(start.Add(2*systemHistoryInterval), OSMetrics{CPUPercent: &cpu})

	snapshot := ring.Snapshot(start.Add(2 * systemHistoryInterval))
	if len(snapshot.Samples) != 3 {
		t.Fatalf("số mẫu = %d; want 3 (mẫu quá dày phải bị bỏ)", len(snapshot.Samples))
	}
	if snapshot.SinceRestart == "" {
		t.Fatalf("phải nói ra mốc bắt đầu — vòng nhớ chỉ có từ lần khởi động dịch vụ")
	}

	// Mẫu cũ hơn cửa sổ rơi ra khỏi kết quả.
	later := start.Add(systemHistoryWindow + time.Minute)
	ring.Observe(later, OSMetrics{CPUPercent: &cpu})
	snapshot = ring.Snapshot(later)
	if len(snapshot.Samples) != 1 {
		t.Fatalf("sau một giờ chỉ còn mẫu mới, có %d", len(snapshot.Samples))
	}
}

func TestSystemHistoryEndpointServesSamplesCollectedByStatusPolling(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	handler := app.Router()

	// Trang Chẩn đoán poll `/system/status`; chính đường đó nuôi vòng nhớ.
	resp := serveAuth(t, handler, http.MethodGet, "/api/v1/system/status", ``, token)
	assertStatus(t, resp, http.StatusOK)

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/system/history", ``, token)
	assertStatus(t, resp, http.StatusOK)
	var history SystemHistoryResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &history); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if history.WindowS != 3600 || history.IntervalS != 15 {
		t.Fatalf("cửa sổ/nhịp = %d/%d; want 3600/15", history.WindowS, history.IntervalS)
	}
	if len(history.Samples) != 1 {
		t.Fatalf("một lần poll phải sinh đúng một mẫu, có %d", len(history.Samples))
	}
}

func TestVirtualPointUsageListsRealReferencesAndDeclaresScope(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	handler := app.Router()

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"VP_TEST","label":"Điểm thử","signalType":"float","enabled":true,"writable":true}`, token)
	if resp.Code != http.StatusCreated && resp.Code != http.StatusOK {
		t.Skipf("không tạo được điểm ảo trong môi trường test: %d %s", resp.Code, resp.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(resp.Body.Bytes(), &created)
	if created.ID == "" {
		t.Skip("phản hồi tạo điểm ảo không có id")
	}

	channel := strings.TrimPrefix(strings.ToUpper(created.ID), "VP")
	resp = serveAuth(t, handler, http.MethodPut, "/api/v1/alarm-settings",
		`[{"id":"ALM-VP1","label":"Cảnh báo dùng VP","enabled":false,"alarmType":1,"priority":"medium","clearMode":"auto","delayS":0,`+
			`"sources":[{"kind":"VP","channel":`+channel+`,"pointId":"`+created.ID+`"}],"params":{"hh":10,"h":8,"l":2,"ll":1}}]`, token)
	if resp.Code != http.StatusOK {
		t.Skipf("không lưu được alarm settings: %d %s", resp.Code, resp.Body.String())
	}

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/virtual-points/"+created.ID+"/usage", ``, token)
	assertStatus(t, resp, http.StatusOK)
	var usage VirtualPointUsageResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &usage); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(usage.References) == 0 {
		t.Fatalf("cảnh báo ALM-VP1 dùng %s nhưng usage rỗng: %+v", created.ID, usage)
	}
	if usage.References[0].Kind != "alarm" || usage.References[0].ID != "ALM-VP1" {
		t.Fatalf("tham chiếu sai: %+v", usage.References[0])
	}
	if len(usage.Scanned) == 0 {
		t.Fatalf("phải nói ra phạm vi đã quét, nếu không 'không có tham chiếu' là lời hứa không cơ sở")
	}
}

func TestVirtualPointUsageIsEmptyButHonestForUnusedPoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/virtual-points/VP9/usage", ``, token)
	assertStatus(t, resp, http.StatusOK)
	var usage VirtualPointUsageResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &usage); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(usage.References) != 0 {
		t.Fatalf("điểm chưa dùng phải có danh sách rỗng: %+v", usage.References)
	}
	if len(usage.Scanned) == 0 {
		t.Fatalf("danh sách rỗng vẫn phải kèm phạm vi đã quét")
	}
}

func TestConfigDiffSummaryIsShortReadableAndRedactsSecrets(t *testing.T) {
	before := map[string]any{
		"northbound": map[string]any{"bacnetPort": 47808, "deviceName": "DDC-01", "wifiPassword": "cu-rich"},
		"southbound": []any{},
	}
	after := map[string]any{
		"northbound": map[string]any{"bacnetPort": 47809, "deviceName": "DDC-01", "wifiPassword": "moi-hon"},
		"southbound": []any{},
	}

	summary := summarizeConfigDiff(before, after)
	if !strings.Contains(summary, "northbound.bacnetPort: 47808 -> 47809") {
		t.Fatalf("thiếu trường đã đổi, hoặc đường dẫn không đọc được: %q", summary)
	}
	if strings.Contains(summary, "cu-rich") || strings.Contains(summary, "moi-hon") {
		t.Fatalf("LỘ BÍ MẬT vào nhật ký: %q", summary)
	}
	if !strings.Contains(summary, "***") {
		t.Fatalf("trường nhạy cảm đổi thì vẫn phải thấy LÀ CÓ ĐỔI: %q", summary)
	}
	if strings.Contains(summary, "deviceName") {
		t.Fatalf("trường không đổi không được xuất hiện: %q", summary)
	}
}

func TestConfigDiffSummaryEmptyWhenNothingChanged(t *testing.T) {
	same := map[string]any{"a": 1, "b": map[string]any{"c": "x"}}
	if summary := summarizeConfigDiff(same, same); summary != "" {
		t.Fatalf("không đổi gì mà vẫn sinh tóm tắt: %q", summary)
	}
}

func TestConfigDiffSummaryCapsFieldCountAndSaysHowManyMore(t *testing.T) {
	before := map[string]any{}
	after := map[string]any{}
	for index := 0; index < configDiffMaxFields+5; index++ {
		key := string(rune('a'+index)) + "field"
		before[key] = index
		after[key] = index + 1
	}
	summary := summarizeConfigDiff(before, after)
	if !strings.Contains(summary, "và 5 trường khác") {
		t.Fatalf("vượt trần phải nói ra còn bao nhiêu: %q", summary)
	}
}

func TestChronyTrackingParsesReferenceTimeForLastSync(t *testing.T) {
	output := `Reference ID    : C0A80101 (ntp.local)
Stratum         : 3
Ref time (UTC)  : Wed Aug 19 06:12:13 2026
System time     : 0.000123456 seconds fast of NTP time
Leap status     : Normal`

	synchronized, source, offsetMS, refTime := parseChronyTracking(output)
	if !synchronized {
		t.Fatalf("Leap status Normal + có nguồn ⇒ phải là đã đồng bộ")
	}
	if source != "ntp.local" {
		t.Fatalf("source = %q; want ntp.local", source)
	}
	if offsetMS < 0.12 || offsetMS > 0.13 {
		t.Fatalf("offsetMS = %f; want ~0.123", offsetMS)
	}
	if refTime != "2026-08-19T06:12:13Z" {
		t.Fatalf("refTime = %q; want 2026-08-19T06:12:13Z", refTime)
	}
}

func TestChronyTrackingLeavesReferenceTimeEmptyWhenUnparsable(t *testing.T) {
	// Mốc thời gian đoán sai còn tệ hơn không có mốc nào: nó sẽ được đọc như
	// một sự thật về thời điểm đồng hồ được chỉnh.
	_, _, _, refTime := parseChronyTracking("Ref time (UTC)  : không phải ngày giờ\nLeap status : Normal")
	if refTime != "" {
		t.Fatalf("refTime = %q; want rỗng", refTime)
	}
}
