package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigPutValidateFailDoesNotWriteFile(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "device.conf")

	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/device", `{"device_id":0,"device_name":""}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("device.conf written after validation failure: %v", err)
	}
}

func TestConfigPutWritesAtomicAndReturnsReloadTarget(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	body := `{"device_id":1001,"device_name":"FCU-Zone-3F-A","description":"test","location":"lab"}`

	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/device", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp ConfigPutResult
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Reload != reloadSIGHUPIobus {
		t.Fatalf("reload = %q; want %q", resp.Reload, reloadSIGHUPIobus)
	}

	path := filepath.Join(app.cfg.ConfigDir, "device.conf")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read device.conf: %v", err)
	}
	var got ConfigDevice
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("parse device.conf: %v", err)
	}
	if got.DeviceID != 1001 || got.DeviceName != "FCU-Zone-3F-A" {
		t.Fatalf("device.conf = %+v", got)
	}
	entries, err := os.ReadDir(app.cfg.ConfigDir)
	if err != nil {
		t.Fatalf("read config dir: %v", err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp") {
			t.Fatalf("temp file left behind: %s", entry.Name())
		}
	}
}

func TestConfigPutInvalidDeviceReturnsBadRequest(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/device", `{"device_id":4194303,"device_name":"bad"}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func newTestAppWithAdmin(t *testing.T) (*App, string) {
	t.Helper()
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
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

func newAuthRequest(method, path, body, token string) *http.Request {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	return req
}
