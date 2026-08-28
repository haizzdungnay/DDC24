package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// `T57-3.3` (`ADR-044`) và điều kiện tiên quyết xoay vòng của `ADR-036`.
//
// Đây là chỉ số AN TOÀN: `rate10m` so trực tiếp với ngưỡng flood 10/10 phút của
// ISA-18.2. Đếm sai theo hướng thấp làm hệ trông bình thường trong lúc người
// vận hành đang chìm trong cảnh báo.

func alarmEvent(id, event, status string, at time.Time) AlarmHistoryEvent {
	return AlarmHistoryEvent{
		EventID: id + at.Format("150405"), AlarmID: id, Event: event, Status: status,
		Message: "Nhiệt độ cao", Time: at.UTC().Format(time.RFC3339Nano),
	}
}

func TestAlarmMetricsCountsOnlyRaiseEvents(t *testing.T) {
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	events := []AlarmHistoryEvent{
		alarmEvent("ALM-1", "started", "active", now.Add(-2*time.Minute)),
		alarmEvent("ALM-1", "acked", "acked", now.Add(-1*time.Minute)),
		alarmEvent("ALM-1", "ended", "cleared", now.Add(-30*time.Second)),
	}

	metrics := computeAlarmMetrics(events, now, "1h", time.Hour)
	if metrics.TotalRaised != 1 {
		t.Fatalf("TotalRaised = %d; want 1 — ack/end là diễn biến xử lý, không phải cảnh báo mới", metrics.TotalRaised)
	}
	if metrics.Rate10m != 1 {
		t.Fatalf("Rate10m = %d; want 1", metrics.Rate10m)
	}
}

func TestAlarmMetricsFlagsFloodAtIsaThreshold(t *testing.T) {
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	events := []AlarmHistoryEvent{}
	for index := 0; index < alarmFloodThreshold; index++ {
		events = append(events, alarmEvent("ALM-"+string(rune('A'+index)), "started", "active", now.Add(-time.Duration(index)*time.Second)))
	}

	metrics := computeAlarmMetrics(events, now, "10m", 10*time.Minute)
	if metrics.Flooding {
		t.Fatalf("đúng bằng ngưỡng thì CHƯA phải flood (ISA-18.2 nói 'quá 10')")
	}

	events = append(events, alarmEvent("ALM-X", "started", "active", now))
	metrics = computeAlarmMetrics(events, now, "10m", 10*time.Minute)
	if !metrics.Flooding {
		t.Fatalf("11 cảnh báo trong 10 phút phải là flood")
	}
}

func TestAlarmMetricsRanksRepeatingAlarms(t *testing.T) {
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	events := []AlarmHistoryEvent{
		alarmEvent("ALM-NOISY", "started", "active", now.Add(-40*time.Minute)),
		alarmEvent("ALM-NOISY", "started", "active", now.Add(-30*time.Minute)),
		alarmEvent("ALM-NOISY", "started", "active", now.Add(-20*time.Minute)),
		alarmEvent("ALM-QUIET", "started", "active", now.Add(-15*time.Minute)),
	}

	metrics := computeAlarmMetrics(events, now, "24h", 24*time.Hour)
	if len(metrics.TopRepeating) != 2 {
		t.Fatalf("top repeating = %d mục; want 2", len(metrics.TopRepeating))
	}
	if metrics.TopRepeating[0].AlarmID != "ALM-NOISY" || metrics.TopRepeating[0].Count != 3 {
		t.Fatalf("xếp hạng sai: %+v", metrics.TopRepeating)
	}
	// Nhịp/giờ phải chia theo ĐỘ DÀI CỬA SỔ, không phải theo số mẫu.
	if metrics.RatePerHour < 0.16 || metrics.RatePerHour > 0.17 {
		t.Fatalf("RatePerHour = %f; want ~0.1667 (4 cảnh báo / 24 h)", metrics.RatePerHour)
	}
}

func TestAlarmMetricsIgnoresEventsOutsideWindow(t *testing.T) {
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	events := []AlarmHistoryEvent{
		alarmEvent("ALM-OLD", "started", "active", now.Add(-2*time.Hour)),
		alarmEvent("ALM-NEW", "started", "active", now.Add(-5*time.Minute)),
	}

	metrics := computeAlarmMetrics(events, now, "1h", time.Hour)
	if metrics.TotalRaised != 1 {
		t.Fatalf("TotalRaised = %d; want 1", metrics.TotalRaised)
	}
}

func TestAlarmMetricsEndpointRejectsUnknownWindow(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms/metrics?window=99y", ``, token)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestAlarmMetricsEndpointSaysUnavailableInsteadOfReturningZero(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	// Chưa có tệp nhật ký nào: `ADR-044` điều 3 cấm trả 0 trong tình huống này.
	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms/metrics?window=1h", ``, token)
	assertStatus(t, resp, http.StatusServiceUnavailable)
	if !strings.Contains(resp.Body.String(), "alarm history") {
		t.Fatalf("503 phải kèm lý do đọc được: %s", resp.Body.String())
	}
}

func TestAlarmHistoryPruneDropsOldLinesAndKeepsRecent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "alarm_history.jsonl")
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)

	old := alarmEvent("ALM-OLD", "started", "active", now.AddDate(0, 0, -(alarmHistoryRetentionDays+5)))
	recent := alarmEvent("ALM-NEW", "started", "active", now.Add(-time.Hour))
	lines := []string{}
	for _, event := range []AlarmHistoryEvent{old, recent} {
		data, _ := json.Marshal(event)
		lines = append(lines, string(data))
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	store := NewAlarmHistoryStore(path)
	if err := store.Prune(now); err != nil {
		t.Fatalf("Prune: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if strings.Contains(string(data), "ALM-OLD") {
		t.Fatalf("dòng quá %d ngày vẫn còn: %s", alarmHistoryRetentionDays, data)
	}
	if !strings.Contains(string(data), "ALM-NEW") {
		t.Fatalf("dòng còn hạn bị cắt mất: %s", data)
	}
}

func TestAlarmHistoryPruneLeavesFileUntouchedWhenNothingToDrop(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "alarm_history.jsonl")
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	data, _ := json.Marshal(alarmEvent("ALM-NEW", "started", "active", now.Add(-time.Hour)))
	if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}

	store := NewAlarmHistoryStore(path)
	if err := store.Prune(now); err != nil {
		t.Fatalf("Prune: %v", err)
	}

	after, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	// Ghi lại một tệp không đổi là mòn flash vô ích trên bo nhúng.
	if !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("không có gì để cắt mà vẫn ghi lại tệp")
	}
}
