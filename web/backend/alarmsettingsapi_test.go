package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
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
	if len(saved) != 3 || saved[0].ID != "ALM-001" || saved[0].Params == nil || saved[0].Params.HH == nil || *saved[0].Params.HH != 31.0 {
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
	if len(got) != 3 || got[2].ID != "ALM-003" {
		t.Fatalf("GET alarm_settings = %+v", got)
	}
}

func TestAlarmSettingsPutRecordsChangedAndDeletedHistory(t *testing.T) {
	app, token := newAlarmSettingsTestApp(t)
	handler := app.Router()
	initial := validAlarmRows(2)
	if err := saveAlarmSettingsFile(context.Background(), app.alarmSettingsPath(), initial); err != nil {
		t.Fatalf("seed alarm settings: %v", err)
	}

	updated := validAlarmRows(1)
	updated[0].Label = "Supply air updated"
	req := newAuthRequest(http.MethodPut, "/api/v1/alarm-settings", alarmSettingsJSON(t, updated), token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}

	assertAlarmHistory(t, handler, token, []alarmHistoryExpectation{
		{Event: "setting_changed", AlarmID: "ALM-001", Message: "Supply air updated", User: "admin"},
		{Event: "setting_deleted", AlarmID: "ALM-002", Message: "Point 002", User: "admin"},
	})
}

func TestValidateAlarmSettingsAcceptsEntityRoundTrip(t *testing.T) {
	rows := validAlarmRows(1)
	data, err := json.Marshal(rows)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got []AlarmSetting
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if errs := validateAlarmSettings(got); len(errs) > 0 {
		t.Fatalf("validation errors = %+v", errs)
	}
}

func TestValidateAlarmSettingsAcceptsFlexibleSeverityRules(t *testing.T) {
	rows := validAlarmRows(1)
	rows[0].Priority = "flexible"
	rows[0].Params.SeverityRules = []SeverityRule{{Severity: "critical", Op: ">=", Value: 90}}
	if errs := validateAlarmSettings(rows); len(errs) > 0 {
		t.Fatalf("validation errors = %+v", errs)
	}
}

func TestAlarmSettingsValidationRejectsBadInputWithoutWrite(t *testing.T) {
	cases := []struct {
		name string
		rows []AlarmSetting
	}{
		{
			name: "bad priority",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].Priority = "urgent"
			}),
		},
		{
			name: "bad clear mode",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].ClearMode = "sometimes"
			}),
		},
		{
			name: "flexible priority without severity rules",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].Priority = "flexible"
			}),
		},
		{
			name: "bad severity rule",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].Priority = "flexible"
				rows[0].Params.SeverityRules = []SeverityRule{{Severity: "urgent", Op: ">", Value: 90}}
			}),
		},
		{
			name: "deferred type enabled",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].AlarmType = alarmTypeSetpointDeviation
				rows[0].Params = &AlarmParams{}
			}),
		},
		{
			name: "source channel out of range",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].Sources[0].Channel = 17
				rows[0].Sources[0].PointID = "UI-17"
			}),
		},
		{
			name: "pointId mismatch",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].Sources[0].PointID = "UI-02"
			}),
		},
		{
			name: "more than max alarms",
			rows: validAlarmRows(maxAlarms + 1),
		},
		{
			name: "more than max sources",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].Sources = validAlarmSources(maxSourcesPerAlarm + 1)
			}),
		},
		{
			name: "more than max bacnet published",
			rows: mutateAlarmRows(maxBacnetPublishedAlarms+1, func(rows []AlarmSetting) {
				for i := range rows {
					rows[i].PublishBacnet = true
				}
			}),
		},
		{
			name: "hh less than h",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].Params.HH = floatPtr(25)
			}),
		},
		{
			name: "runtimeHours not positive",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].AlarmType = alarmTypeRuntimeHours
				rows[0].Params = &AlarmParams{RuntimeHours: floatPtr(0)}
			}),
		},
		{
			name: "notification class out of range",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].PublishBacnet = true
				rows[0].NotificationClass = intPtr(5)
			}),
		},
		{
			name: "duplicate id",
			rows: mutateAlarmRows(2, func(rows []AlarmSetting) {
				rows[1].ID = rows[0].ID
			}),
		},
		{
			name: "empty id",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].ID = ""
			}),
		},
		{
			name: "negative delayS",
			rows: mutateAlarmRows(1, func(rows []AlarmSetting) {
				rows[0].DelayS = -1
			}),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, token := newAlarmSettingsTestApp(t)
			req := newAuthRequest(http.MethodPut, "/api/v1/alarm-settings", alarmSettingsJSON(t, tc.rows), token)
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

func TestLoadAlarmSettingsMigratesLegacyRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "alarm_settings.conf")
	legacy := `[{"pointId":"AI-01","label":"Temp","enabled":true,"hh":30,"h":28,"l":18,"ll":16,"delayS":0,"priority":"high"}]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("write legacy: %v", err)
	}
	rows, err := loadAlarmSettingsFile(context.Background(), path)
	if err != nil {
		t.Fatalf("load legacy: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	got := rows[0]
	if got.ID != "ALM-AI-01" || got.AlarmType != alarmTypeHighLowInput || got.PublishBacnet {
		t.Fatalf("migrated row = %+v", got)
	}
	if got.ClearMode != "auto" {
		t.Fatalf("migrated clearMode = %q; want auto", got.ClearMode)
	}
	if len(got.Sources) != 1 || got.Sources[0].Kind != "UI" || got.Sources[0].Channel != 1 || got.Sources[0].PointID != "UI-01" {
		t.Fatalf("migrated sources = %+v", got.Sources)
	}
	if got.Params == nil || got.Params.HH == nil || *got.Params.HH != 30 {
		t.Fatalf("migrated params = %+v", got.Params)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read after load: %v", err)
	}
	if string(data) != legacy {
		t.Fatalf("load rewrote file: %s", string(data))
	}
}

func TestAlarmSettingsEmptyAndNilBecomeEmptyArrays(t *testing.T) {
	path := filepath.Join(t.TempDir(), "alarm_settings.conf")
	if err := os.WriteFile(path, []byte("null"), 0o600); err != nil {
		t.Fatalf("write null: %v", err)
	}
	rows, err := loadAlarmSettingsFile(context.Background(), path)
	if err != nil {
		t.Fatalf("load null: %v", err)
	}
	if rows == nil || len(rows) != 0 {
		t.Fatalf("rows = %#v", rows)
	}
	out := filepath.Join(t.TempDir(), "alarm_settings.conf")
	if err := saveAlarmSettingsFile(context.Background(), out, nil); err != nil {
		t.Fatalf("save nil: %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read nil save: %v", err)
	}
	if strings.TrimSpace(string(data)) != "[]" {
		t.Fatalf("saved nil = %s", string(data))
	}
}

func TestSaveAlarmSettingsFileUsesGroupConfigPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not preserve POSIX config permission bits")
	}
	path := filepath.Join(t.TempDir(), "config", "alarm_settings.conf")
	if err := saveAlarmSettingsFile(context.Background(), path, validAlarmRows(1)); err != nil {
		t.Fatalf("save alarm settings: %v", err)
	}
	dirInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatalf("stat dir: %v", err)
	}
	if got := dirInfo.Mode().Perm(); got != 0o770 {
		t.Fatalf("dir mode = %o; want 770", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat file: %v", err)
	}
	if got := info.Mode().Perm(); got != alarmSettingsFilePerm {
		t.Fatalf("file mode = %o; want %o", got, alarmSettingsFilePerm)
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
	data, err := json.Marshal(validAlarmRows(count))
	if err != nil {
		panic(err)
	}
	return string(data)
}

func validAlarmRows(count int) []AlarmSetting {
	rows := make([]AlarmSetting, 0, count)
	for i := 1; i <= count; i++ {
		rows = append(rows, validAlarmSetting(i))
	}
	return rows
}

func mutateAlarmRows(count int, mutate func([]AlarmSetting)) []AlarmSetting {
	rows := validAlarmRows(count)
	mutate(rows)
	return rows
}

func alarmSettingsJSON(t *testing.T, rows []AlarmSetting) string {
	t.Helper()
	data, err := json.Marshal(rows)
	if err != nil {
		t.Fatalf("marshal alarm settings: %v", err)
	}
	return string(data)
}

func validAlarmSetting(i int) AlarmSetting {
	priorities := []string{"low", "medium", "high", "critical"}
	channel := ((i - 1) % 16) + 1
	hh := float64(30 + i)
	h := float64(27 + i)
	l := float64(17 - (i % 3))
	ll := l - 2
	return AlarmSetting{
		ID:            fmt.Sprintf("ALM-%03d", i),
		Label:         fmt.Sprintf("Point %03d", i),
		Enabled:       true,
		AlarmType:     alarmTypeHighLowInput,
		Sources:       []AlarmSource{{Kind: "UI", Channel: channel, PointID: formatPointID("UI", channel)}},
		Priority:      priorities[(i-1)%len(priorities)],
		ClearMode:     "auto",
		DelayS:        float64(i * 10),
		PublishBacnet: false,
		Params:        &AlarmParams{HH: &hh, H: &h, L: &l, LL: &ll},
	}
}

func validAlarmSources(count int) []AlarmSource {
	sources := make([]AlarmSource, 0, count)
	for i := 1; i <= count; i++ {
		switch {
		case i <= 16:
			sources = append(sources, AlarmSource{Kind: "UI", Channel: i, PointID: formatPointID("UI", i)})
		case i <= 20:
			channel := i - 16
			sources = append(sources, AlarmSource{Kind: "AO", Channel: channel, PointID: formatPointID("AO", channel)})
		default:
			channel := i - 20
			sources = append(sources, AlarmSource{Kind: "DO", Channel: channel, PointID: formatPointID("DO", channel)})
		}
	}
	return sources
}

func floatPtr(value float64) *float64 {
	return &value
}

func intPtr(value int) *int {
	return &value
}
