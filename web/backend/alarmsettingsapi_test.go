package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestAlarmSettingsMissingFileReturnsEmptyArray(t *testing.T) {
	app, token := newAlarmSettingsTestApp(t)
	req := newAuthRequest(http.MethodGet, "/api/v1/alarm-settings", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestAlarmSettingsPutValidWritesFileAndGetRoundTrips(t *testing.T) {
	app, token := newAlarmSettingsTestApp(t)
	body := validAlarmSettingsJSON(3)
	req := newAuthRequest(http.MethodPut, "/api/v1/alarm-settings", body, token)
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

	data, err := os.ReadFile(app.alarmSettingsPath())
	if err != nil {
		t.Fatalf("read alarm_settings.conf: %v", err)
	}
	var saved []AlarmSetting
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatalf("parse alarm_settings.conf: %v", err)
	}
	if len(saved) != 3 || saved[0].PointID != "AI-01" || saved[0].HH != 31.0 {
		t.Fatalf("saved = %+v", saved)
	}

	req = newAuthRequest(http.MethodGet, "/api/v1/alarm-settings", "", token)
	w = httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d body=%s", w.Code, w.Body.String())
	}
	var got []AlarmSetting
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode GET: %v", err)
	}
	if len(got) != 3 || got[2].PointID != "AI-03" {
		t.Fatalf("GET alarm_settings = %+v", got)
	}
}

func TestAlarmSettingsValidationRejectsBadInputWithoutWrite(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{
			name: "bad priority",
			body: `[{"pointId":"AI-01","label":"Temp","enabled":true,"hh":30,"h":28,"l":18,"ll":16,"delayS":0,"priority":"urgent"}]`,
		},
		{
			name: "hh less than h when enabled",
			body: `[{"pointId":"AI-01","label":"Temp","enabled":true,"hh":25,"h":28,"l":18,"ll":16,"delayS":0,"priority":"high"}]`,
		},
		{
			name: "duplicate pointId",
			body: `[{"pointId":"AI-01","label":"A","enabled":false,"hh":0,"h":0,"l":0,"ll":0,"delayS":0,"priority":"low"},{"pointId":"AI-01","label":"B","enabled":false,"hh":0,"h":0,"l":0,"ll":0,"delayS":0,"priority":"low"}]`,
		},
		{
			name: "empty pointId",
			body: `[{"pointId":"","label":"Bad","enabled":false,"hh":0,"h":0,"l":0,"ll":0,"delayS":0,"priority":"low"}]`,
		},
		{
			name: "negative delayS",
			body: `[{"pointId":"AI-01","label":"Temp","enabled":false,"hh":0,"h":0,"l":0,"ll":0,"delayS":-1,"priority":"high"}]`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, token := newAlarmSettingsTestApp(t)
			req := newAuthRequest(http.MethodPut, "/api/v1/alarm-settings", tc.body, token)
			w := httptest.NewRecorder()
			app.Router().ServeHTTP(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
			}
			if _, err := os.Stat(app.alarmSettingsPath()); !os.IsNotExist(err) {
				t.Fatalf("alarm_settings.conf written after validation failure: %v", err)
			}
		})
	}
}

func TestAlarmSettingsPutRequiresAdmin(t *testing.T) {
	app, _, viewer := newAlarmSettingsTestAppMultiUser(t)
	req := newAuthRequest(http.MethodPut, "/api/v1/alarm-settings", `[]`, viewer)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("viewer PUT status = %d; want 403", w.Code)
	}
}

func TestAlarmSettingsGetAccessibleToViewer(t *testing.T) {
	app, _, viewer := newAlarmSettingsTestAppMultiUser(t)
	req := newAuthRequest(http.MethodGet, "/api/v1/alarm-settings", "", viewer)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("viewer GET status = %d; want 200", w.Code)
	}
}

func newAlarmSettingsTestApp(t *testing.T) (*App, string) {
	t.Helper()
	users := writeMultiTestUsers(t)
	cfg := testConfigAlarmSettings(t, users)
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	return app, token
}

func newAlarmSettingsTestAppMultiUser(t *testing.T) (*App, string, string) {
	t.Helper()
	users := writeMultiTestUsers(t)
	cfg := testConfigAlarmSettings(t, users)
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	adminToken, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate admin: %v", err)
	}
	viewerToken, _, err := app.auth.Authenticate("viewer", "viewer123", "test")
	if err != nil {
		t.Fatalf("Authenticate viewer: %v", err)
	}
	return app, adminToken, viewerToken
}

func writeMultiTestUsers(t *testing.T) string {
	t.Helper()
	adminHash, err := bcrypt.GenerateFromPassword([]byte("admin123"), 12)
	if err != nil {
		t.Fatalf("bcrypt admin: %v", err)
	}
	viewerHash, err := bcrypt.GenerateFromPassword([]byte("viewer123"), 12)
	if err != nil {
		t.Fatalf("bcrypt viewer: %v", err)
	}
	path := filepath.Join(t.TempDir(), "users.conf")
	usersFile := map[string]any{
		"_schema_version": "1.0",
		"users": []map[string]string{
			{"username": "admin", "role": string(RoleAdmin), "pw_bcrypt": string(adminHash)},
			{"username": "viewer", "role": string(RoleViewer), "pw_bcrypt": string(viewerHash)},
		},
	}
	data, err := json.Marshal(usersFile)
	if err != nil {
		t.Fatalf("marshal users: %v", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write users: %v", err)
	}
	return path
}

func testConfigAlarmSettings(t *testing.T, usersConf string) Config {
	t.Helper()
	cfg := testConfig(t, usersConf)
	cfg.AlarmConfPath = filepath.Join(t.TempDir(), "alarm_settings.conf")
	pidfile := filepath.Join(t.TempDir(), "core.pid")
	if err := os.WriteFile(pidfile, []byte("999999"), 0o600); err != nil {
		t.Fatalf("write pidfile: %v", err)
	}
	cfg.CorePidPath = pidfile
	return cfg
}

func validAlarmSettingsJSON(count int) string {
	priorities := []string{"low", "medium", "high", "critical"}
	rows := make([]AlarmSetting, 0, count)
	for i := 1; i <= count; i++ {
		rows = append(rows, AlarmSetting{
			PointID:  "AI-" + twoDigits(i),
			Label:    "Point " + twoDigits(i),
			Enabled:  true,
			HH:       float64(25+i) + 5.0,
			H:        float64(25 + i),
			L:        float64(20 - i),
			LL:       float64(20-i) - 2.0,
			DelayS:   float64(i * 10),
			Priority: priorities[(i-1)%len(priorities)],
		})
	}
	data, err := json.Marshal(rows)
	if err != nil {
		panic(err)
	}
	return string(data)
}
