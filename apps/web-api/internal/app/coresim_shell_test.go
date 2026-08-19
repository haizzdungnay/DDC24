package app

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Hai endpoint VỎ gọi binary Core — `T57-2.13` (`ADR-048`) và `T57-3.5`/`T57-3.6`
// (`ADR-045`).
//
// Điều quan trọng nhất cần khoá KHÔNG phải là "chạy đúng khi có binary", mà là
// **hành vi khi THIẾU binary**: phải trả 503 kèm lý do, và tuyệt đối không rơi
// về một bản tính xấp xỉ trong Go. Một bản gần đúng sẽ được người dùng tin như
// bản thật đúng lúc họ đang đặt ngưỡng an toàn hoặc đọc lịch điều khiển.

func withoutSimBinaries(t *testing.T) {
	t.Helper()
	// PATH rỗng + biến môi trường trỏ vào chỗ không có gì ⇒ chắc chắn không tìm
	// thấy binary, kể cả trên máy dev đã cài sẵn.
	t.Setenv("PATH", t.TempDir())
	t.Setenv("MKDDC_ALARM_SIM", filepath.Join(t.TempDir(), "khong-ton-tai"))
	t.Setenv("MKDDC_SCHEDULE_SIM", filepath.Join(t.TempDir(), "khong-ton-tai"))
}

func TestAlarmSimulateReturns503WithReasonWhenEngineMissing(t *testing.T) {
	withoutSimBinaries(t)
	app, token := newTestAppWithAdmin(t)

	body := `{"setting":{"id":"ALM-1","label":"thử","enabled":true,"alarmType":1,"priority":"high","clearMode":"auto","delayS":0,` +
		`"sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],"params":{"hh":30,"h":28,"l":18,"ll":16}},` +
		`"samples":[{"t":"2026-08-19T10:00:00Z","value":20},{"t":"2026-08-19T10:01:00Z","value":31}]}`
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarm-settings/simulate", body, token)
	assertStatus(t, resp, http.StatusServiceUnavailable)

	text := resp.Body.String()
	if !strings.Contains(text, "mkddc-alarm-sim") {
		t.Fatalf("503 phải nói rõ thiếu binary nào: %s", text)
	}
	if !strings.Contains(text, "Core") {
		t.Fatalf("503 phải nói rõ vì sao backend không tự tính thay: %s", text)
	}
}

func TestAlarmSimulateRejectsEmptyAndOversizedSampleSets(t *testing.T) {
	withoutSimBinaries(t)
	app, token := newTestAppWithAdmin(t)
	handler := app.Router()

	setting := `"setting":{"id":"ALM-1","label":"thử","enabled":true,"alarmType":1,"priority":"high","clearMode":"auto","delayS":0,` +
		`"sources":[],"params":{"hh":30,"h":28,"l":18,"ll":16}}`

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/alarm-settings/simulate", `{`+setting+`,"samples":[]}`, token)
	assertStatus(t, resp, http.StatusBadRequest)

	samples := make([]string, 0, alarmSimMaxSamples+1)
	for index := 0; index <= alarmSimMaxSamples; index++ {
		samples = append(samples, `{"t":"2026-08-19T10:00:00Z","value":1}`)
	}
	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/alarm-settings/simulate",
		`{`+setting+`,"samples":[`+strings.Join(samples, ",")+`]}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestScheduleEffectiveReturns503WithReasonWhenEngineMissing(t *testing.T) {
	withoutSimBinaries(t)
	app, token := newTestAppWithAdmin(t)

	resp := serveAuth(t, app.Router(), http.MethodGet,
		"/api/v1/schedules/effective?pointId=AO-01&from=2026-08-19T00:00:00Z&to=2026-08-19T12:00:00Z", ``, token)
	assertStatus(t, resp, http.StatusServiceUnavailable)
	if !strings.Contains(resp.Body.String(), "Core") {
		t.Fatalf("503 phải nói rõ ngữ nghĩa lịch thuộc Core: %s", resp.Body.String())
	}
}

func TestScheduleEffectiveValidatesRangeInsteadOfSilentlyTruncating(t *testing.T) {
	withoutSimBinaries(t)
	app, token := newTestAppWithAdmin(t)
	handler := app.Router()

	// Thiếu pointId.
	resp := serveAuth(t, handler, http.MethodGet, "/api/v1/schedules/effective", ``, token)
	assertStatus(t, resp, http.StatusBadRequest)

	// Khoảng ngược.
	resp = serveAuth(t, handler, http.MethodGet,
		"/api/v1/schedules/effective?pointId=AO-01&from=2026-08-19T12:00:00Z&to=2026-08-19T00:00:00Z", ``, token)
	assertStatus(t, resp, http.StatusBadRequest)

	// Quá 7 ngày: từ chối, KHÔNG cắt xuống 7 ngày rồi trả như thường.
	resp = serveAuth(t, handler, http.MethodGet,
		"/api/v1/schedules/effective?pointId=AO-01&from=2026-08-01T00:00:00Z&to=2026-08-19T00:00:00Z", ``, token)
	assertStatus(t, resp, http.StatusBadRequest)
	if !strings.Contains(resp.Body.String(), "7") {
		t.Fatalf("phải nói rõ trần 7 ngày: %s", resp.Body.String())
	}
}

func TestSimBinaryLookupPrefersEnvironmentOverride(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "mkddc-alarm-sim")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	t.Setenv("MKDDC_ALARM_SIM", fake)

	path, err := alarmSimBinary()
	if err != nil {
		t.Fatalf("alarmSimBinary: %v", err)
	}
	if path != fake {
		t.Fatalf("path = %q; want %q", path, fake)
	}
}
