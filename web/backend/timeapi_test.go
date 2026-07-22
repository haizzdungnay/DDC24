package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeTimeService struct {
	status   TimeStatus
	applyErr error
	applied  []ConfigTime
}

func (f *fakeTimeService) Status(context.Context, ConfigTime) (TimeStatus, error) {
	return f.status, nil
}

func (f *fakeTimeService) Apply(_ context.Context, cfg ConfigTime) ([]string, error) {
	f.applied = append(f.applied, cfg)
	return nil, f.applyErr
}

func TestGetTimeConfigReturnsDefaultRevision(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.time = &fakeTimeService{}
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, newAuthRequest(http.MethodGet, "/api/v1/system/config/time", "", token))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if got := w.Body.String(); !timeContainsAll(got, `"timezone":"UTC"`, `"revision":1`) {
		t.Fatalf("body = %s", got)
	}
}

func TestTimeStatusUsesService(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleViewer, fakeCore{})
	app.time = &fakeTimeService{status: TimeStatus{
		NowUTC: "2026-07-18T03:00:00Z", NowLocal: "2026-07-18T10:00:00+07:00",
		Timezone: "Asia/Ho_Chi_Minh", Mode: "ntp", Synchronized: true,
		Health: "healthy", Warnings: []string{},
	}}
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, newAuthRequest(http.MethodGet, "/api/v1/system/time/status", "", token))
	if w.Code != http.StatusOK || !timeContainsAll(w.Body.String(), `"synchronized":true`, `"health":"healthy"`) {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestPutTimeConfigAppliesThenPersistsSanitizedConfig(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	service := &fakeTimeService{}
	app.time = service
	body := `{"timezone":"Asia/Ho_Chi_Minh","ntp_enabled":false,"ntp_servers":["pool.ntp.org"],"system_time":"2026-07-18T10:00:00+07:00","baseRevision":1,"operationId":"time-op-1"}`
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", body, token))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if len(service.applied) != 1 || service.applied[0].SystemTime == "" {
		t.Fatalf("applied = %+v", service.applied)
	}
	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "time.conf"))
	if err != nil {
		t.Fatalf("read time.conf: %v", err)
	}
	if got := string(data); !timeContainsAll(got, `"system_time": ""`, `"revision": 2`) {
		t.Fatalf("time.conf = %s", got)
	}
}

func TestPutTimeConfigApplyFailureDoesNotWrite(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.time = &fakeTimeService{applyErr: errors.New("permission denied")}
	body := `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"","baseRevision":1,"operationId":"time-op-2"}`
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", body, token))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(app.cfg.ConfigDir, "time.conf")); !os.IsNotExist(err) {
		t.Fatalf("time.conf exists after apply failure: %v", err)
	}
}

func TestPutTimeConfigRejectsStaleRevisionAndInvalidInput(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.time = &fakeTimeService{}
	tests := []struct {
		name string
		body string
		code int
	}{
		{"stale", `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"","baseRevision":9,"operationId":"time-op-3"}`, http.StatusConflict},
		{"manual while ntp enabled", `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"2026-07-18T03:00:00Z","baseRevision":1,"operationId":"time-op-4"}`, http.StatusBadRequest},
		{"unknown field", `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"","baseRevision":1,"operationId":"time-op-5","root":true}`, http.StatusBadRequest},
		{"empty ntp servers", `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":[],"system_time":"","baseRevision":1,"operationId":"time-op-6"}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			app.Router().ServeHTTP(w, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", tt.body, token))
			if w.Code != tt.code {
				t.Fatalf("status = %d want=%d body=%s", w.Code, tt.code, w.Body.String())
			}
		})
	}
}

func TestPutTimeConfigRetryIsIdempotentAcrossRestart(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	service := &fakeTimeService{}
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	app.time = service
	token, _, _ := app.auth.Authenticate("admin", "admin123", "test")
	body := `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"","baseRevision":1,"operationId":"time-retry-1"}`
	first := httptest.NewRecorder()
	app.Router().ServeHTTP(first, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", body, token))
	if first.Code != http.StatusOK || len(service.applied) != 1 {
		t.Fatalf("first status=%d applied=%d body=%s", first.Code, len(service.applied), first.Body.String())
	}

	restarted, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	restarted.time = service
	token, _, _ = restarted.auth.Authenticate("admin", "admin123", "test")
	retry := httptest.NewRecorder()
	restarted.Router().ServeHTTP(retry, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", body, token))
	if retry.Code != http.StatusOK || len(service.applied) != 1 {
		t.Fatalf("retry status=%d applied=%d body=%s", retry.Code, len(service.applied), retry.Body.String())
	}
}

func TestPutTimeConfigRejectsOperationIDReuseWithDifferentPayload(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.time = &fakeTimeService{}
	firstBody := `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"","baseRevision":1,"operationId":"time-reuse-1"}`
	first := httptest.NewRecorder()
	app.Router().ServeHTTP(first, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", firstBody, token))
	if first.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
	}
	reused := httptest.NewRecorder()
	reusedBody := `{"timezone":"Asia/Ho_Chi_Minh","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"","baseRevision":2,"operationId":"time-reuse-1"}`
	app.Router().ServeHTTP(reused, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", reusedBody, token))
	if reused.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", reused.Code, reused.Body.String())
	}
}

func TestPutTimeConfigBlocksWhenJournalNeedsRecovery(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.time = &fakeTimeService{}
	journal := `{"operationId":"interrupted","requestHash":"abc","state":"os_applied","result":{"result":"failed","applied":false,"reload":"system","warnings":[]}}`
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "time_operation.json"), []byte(journal), 0o600); err != nil {
		t.Fatal(err)
	}
	body := `{"timezone":"UTC","ntp_enabled":true,"ntp_servers":["pool.ntp.org"],"system_time":"","baseRevision":1,"operationId":"time-after-crash"}`
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, newAuthRequest(http.MethodPut, "/api/v1/system/config/time", body, token))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func timeContainsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !strings.Contains(value, part) {
			return false
		}
	}
	return true
}
