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
	body := validSchedulesJSON(8)
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
	if resp.Result != "applied" || resp.Reload != reloadSIGHUPCore {
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
	if len(saved) != 8 || saved[0].ID != "SCH-01" || saved[0].Cells[0].Value != "ON" {
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
	if len(got) != 8 || got[7].ID != "SCH-08" {
		t.Fatalf("GET schedules = %+v", got)
	}
}

func TestSchedulesValidationRejectsBadInputWithoutWrite(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{name: "bad value", body: `[{"id":"SCH-01","label":"Bad","cells":[{"day":"T2","value":"MAYBE","start":"08:00","end":"17:00"}]}]`},
		{name: "bad time", body: `[{"id":"SCH-01","label":"Bad","cells":[{"day":"T2","value":"ON","start":"24:00","end":"17:00"}]}]`},
		{name: "duplicate id", body: `[{"id":"SCH-01","label":"A","cells":[]},{"id":"SCH-01","label":"B","cells":[]}]`},
		{name: "empty id", body: `[{"id":"","label":"Bad","cells":[]}]`},
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
		rows = append(rows, ScheduleRow{
			ID:    "SCH-" + twoDigits(i),
			Label: "Schedule " + twoDigits(i),
			Cells: []ScheduleCell{{Day: "T2", Value: "ON", Start: "08:00", End: "17:00"}},
		})
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
