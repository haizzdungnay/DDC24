package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchedulesMissingFileReturnsEmptyArray(t *testing.T) {
	app, token := newScheduleTestApp(t)
	req := newAuthRequest(http.MethodGet, "/api/v1/schedules", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestSchedulesPutValidWritesFileAndGetRoundTrips(t *testing.T) {
	app, token := newScheduleTestApp(t)
	body := validSchedulesJSON(64)
	req := newAuthRequest(http.MethodPut, "/api/v1/schedules", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp ConfigPutResult
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Result != "failed" || resp.Applied || resp.Reload != reloadSIGHUPCore {
		t.Fatalf("resp = %+v", resp)
	}

	data, err := os.ReadFile(app.schedulePath())
	if err != nil {
		t.Fatalf("read schedule.conf: %v", err)
	}
	var saved []ScheduleRow
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatalf("parse schedule.conf: %v", err)
	}
	if len(saved) != 64 || saved[0].ID != "SCH-01" || saved[0].ScheduleType != "analog_output_value" || *saved[0].Value != 42 {
		t.Fatalf("saved = %+v", saved)
	}

	req = newAuthRequest(http.MethodGet, "/api/v1/schedules", "", token)
	w = httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d body=%s", w.Code, w.Body.String())
	}
	var got []ScheduleRow
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode GET: %v", err)
	}
	if len(got) != 64 || got[63].ID != "SCH-64" || got[0].Target == nil || *got[0].Target.Channel != 1 || got[63].Target == nil || got[63].Target.Channel == nil || *got[63].Target.Channel != 1 || got[63].Target.PointID != "MSV-01" {
		t.Fatalf("GET schedules = %+v", got)
	}
}

func TestSchedulesValidationRejectsBadInputWithoutWrite(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{name: "too many", body: validSchedulesJSON(65)},
		{name: "bad type", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"bad","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AO","channel":1},"value":42}]`},
		{name: "bad day", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":["moonday"],"target":{"kind":"AO","channel":1},"value":42}]`},
		{name: "missing day", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":[],"target":{"kind":"AO","channel":1},"value":42}]`},
		{name: "bad start time", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"analog_output_value","startTime":"24:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AO","channel":1},"value":42}]`},
		{name: "same start end", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"08:00","weekdays":["monday"],"target":{"kind":"AO","channel":1},"value":42}]`},
		{name: "disabled bad time", body: `[{"id":"SCH-01","label":"Bad","enabled":false,"scheduleType":"analog_output_value","startTime":"24:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AO","channel":1},"value":42}]`},
		{name: "disabled missing day", body: `[{"id":"SCH-01","label":"Bad","enabled":false,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":[],"target":{"kind":"AO","channel":1},"value":42}]`},
		{name: "bad target", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AO","channel":5},"value":42}]`},
		{name: "bad target point id", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AO","channel":1,"pointId":"AO-02"},"value":42}]`},
		{name: "bad value", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AO","channel":1},"value":101}]`},
		{name: "bad controller target", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"controller_operation_mode","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"MSV","channel":2},"value":1}]`},
		{name: "bad controller point id", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"controller_operation_mode","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"MSV","channel":1,"pointId":"MSV-02"},"value":1}]`},
		{name: "bad holiday date", body: `[{"id":"SCH-01","label":"Bad","enabled":true,"scheduleType":"holiday_period","startDate":"02-30","endDate":"03-01","weekdays":[]}]`},
		{name: "bad id", body: `[{"id":"BAD-01","label":"Bad","enabled":false,"scheduleType":"not_active","weekdays":[]}]`},
		{name: "duplicate id", body: `[{"id":"SCH-01","label":"A","enabled":false,"scheduleType":"not_active","weekdays":[]},{"id":"SCH-01","label":"B","enabled":false,"scheduleType":"not_active","weekdays":[]}]`},
		{name: "empty id", body: `[{"id":"","label":"Bad","enabled":false,"scheduleType":"not_active","weekdays":[]}]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, token := newScheduleTestApp(t)
			req := newAuthRequest(http.MethodPut, "/api/v1/schedules", tc.body, token)
			w := httptest.NewRecorder()
			app.Router().ServeHTTP(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
			}
			if _, err := os.Stat(app.schedulePath()); !os.IsNotExist(err) {
				t.Fatalf("schedule.conf written after validation failure: %v", err)
			}
		})
	}
}

func TestSchedulesAcceptVirtualOutputTargets(t *testing.T) {
	app, token := newScheduleTestApp(t)
	body := `[
		{"id":"SCH-VO-A","label":"VO analog","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AV","channel":17,"pointId":"AV-17"},"value":42},
		{"id":"SCH-VO-B","label":"VO binary","enabled":true,"scheduleType":"digital_output_value","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"BV","channel":9,"pointId":"BV-09"},"value":1}
	]`
	req := newAuthRequest(http.MethodPut, "/api/v1/schedules", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestSchedulesAcceptCanonicalVirtualPointIDs(t *testing.T) {
	app, token := newScheduleTestApp(t)
	body := `[
		{"id":"SCH-VO-A","label":"VO analog","enabled":true,"scheduleType":"analog_output_value","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"AV","channel":17,"pointId":"AV17"},"value":42},
		{"id":"SCH-VO-B","label":"VO binary","enabled":true,"scheduleType":"digital_output_value","startTime":"08:00","endTime":"17:00","weekdays":["monday"],"target":{"kind":"BV","channel":9,"pointId":"BV9"},"value":1}
	]`
	req := newAuthRequest(http.MethodPut, "/api/v1/schedules", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func newScheduleTestApp(t *testing.T) (*App, string) {
	t.Helper()
	app, token := newTestAppWithAdmin(t)
	app.cfg.ScheduleConfPath = filepath.Join(t.TempDir(), "schedule.conf")
	pidfile := filepath.Join(t.TempDir(), "core.pid")
	if err := os.WriteFile(pidfile, []byte("999999"), 0o600); err != nil {
		t.Fatalf("write pidfile: %v", err)
	}
	app.cfg.CorePidPath = pidfile
	return app, token
}

func validSchedulesJSON(count int) string {
	rows := make([]ScheduleRow, 0, count)
	for i := 1; i <= count; i++ {
		channel := ((i - 1) % 4) + 1
		value := float64(42)
		rows = append(rows, ScheduleRow{
			ID:           "SCH-" + twoDigits(i),
			Label:        "Schedule " + twoDigits(i),
			Notes:        "demo",
			Enabled:      true,
			ScheduleType: "analog_output_value",
			StartTime:    "08:00",
			EndTime:      "17:00",
			Weekdays:     []string{"monday", "wednesday"},
			Target:       &ScheduleTarget{Kind: "AO", Channel: &channel},
			Value:        &value,
		})
		if i == count {
			mode := float64(1)
			rows[i-1].ScheduleType = "controller_operation_mode"
			rows[i-1].Target = nil
			rows[i-1].Value = &mode
		}
	}
	data, err := json.Marshal(rows)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func twoDigits(value int) string {
	if value < 10 {
		return "0" + string(rune('0'+value))
	}
	return string(rune('0'+value/10)) + string(rune('0'+value%10))
}
