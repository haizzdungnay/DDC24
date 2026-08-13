package app

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

func TestConfigNetworkPutRejectsEthernetMutation(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "network.conf")
	original := `{"eth":{"mode":"static","ip":"10.1.2.3","netmask":"255.255.255.0","gateway":"10.1.2.1"},"wifi":{"enabled":false,"mode":"dhcp","ssid":"lab-wifi"},"hostname":"ddc-lab"}`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	body := `{"eth":{"mode":"dhcp"},"wifi":{"enabled":false,"mode":"dhcp","ssid":"lab-wifi"},"hostname":"ddc-lab"}`

	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/network", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != original {
		t.Fatalf("network.conf changed after rejected Ethernet mutation: %s", data)
	}
}

func TestConfigNetworkPutWithoutEthernetPreservesLegacyShadow(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(app.cfg.ConfigDir, "network.conf")
	original := `{"eth":{"mode":"static","ip":"10.1.2.3","netmask":"255.255.255.0","gateway":"10.1.2.1"},"wifi":{"enabled":false,"mode":"dhcp","ssid":"lab-wifi"},"hostname":"ddc-lab"}`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	body := `{"wifi":{"enabled":true,"mode":"dhcp","ssid":"new-wifi"},"hostname":"ddc-new"}`

	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/network", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var network ConfigNetwork
	readJSONFile(t, path, &network)
	if stringValue(network.Eth, "ip") != "10.1.2.3" || stringValue(network.Wifi, "ssid") != "new-wifi" {
		t.Fatalf("network.conf = %+v", network)
	}
}

func TestValidateConfigIOAcceptsAIUniversalInputFields(t *testing.T) {
	cfg := ConfigIO{
		UI: []map[string]any{
			{
				"ch":         16,
				"type":       "2-10V",
				"unit":       "degC",
				"name":       "Supply Temp",
				"enabled":    true,
				"invert":     true,
				"range_mult": 3,
			},
		},
	}

	if errs := validateConfigIO(cfg); len(errs) != 0 {
		t.Fatalf("validateConfigIO() errors = %+v; want none", errs)
	}
}

func TestValidateConfigIORejectsInvalidAIUniversalInputFields(t *testing.T) {
	tests := []struct {
		name string
		item map[string]any
		path string
	}{
		{
			name: "range_mult out of range",
			item: map[string]any{"ch": 1, "type": "0-10V", "range_mult": 9},
			path: "ui[0].range_mult",
		},
		{
			name: "invert must be boolean",
			item: map[string]any{"ch": 1, "type": "dry", "invert": "yes"},
			path: "ui[0].invert",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errs := validateConfigIO(ConfigIO{UI: []map[string]any{tt.item}})
			if !hasConfigErrorPath(errs, tt.path) {
				t.Fatalf("validateConfigIO() errors = %+v; want path %q", errs, tt.path)
			}
		})
	}
}

func TestValidateConfigIOAcceptsAoBacnetProperties(t *testing.T) {
	cfg := ConfigIO{AO: []map[string]any{{
		"ch": 1, "mode": "0-10V", "name": "CW VALVE", "units": "percent",
		"min_pv": 0.0, "max_pv": 100.0,
	}}}
	if errs := validateConfigIO(cfg); len(errs) != 0 {
		t.Fatalf("validateConfigIO() errors = %+v; want none", errs)
	}
}

func TestValidateConfigIORejectsInvalidAoBacnetProperties(t *testing.T) {
	tests := []struct {
		name string
		item map[string]any
		path string
	}{
		{"unknown units", map[string]any{"ch": 1, "mode": "0-10V", "units": "banana"}, "ao[0].units"},
		{"reversed range", map[string]any{"ch": 1, "mode": "0-10V", "min_pv": 100.0, "max_pv": 0.0}, "ao[0].max_pv"},
		{"long name", map[string]any{"ch": 1, "mode": "0-10V", "name": strings.Repeat("x", 65)}, "ao[0].name"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errs := validateConfigIO(ConfigIO{AO: []map[string]any{tt.item}})
			if !hasConfigErrorPath(errs, tt.path) {
				t.Fatalf("validateConfigIO() errors = %+v; want path %q", errs, tt.path)
			}
		})
	}
}

func TestValidateConfigIOAcceptsFullEasySetAIFields(t *testing.T) {
	cfg := ConfigIO{
		UI: []map[string]any{
			{
				"ch":             1,
				"type":           "potentiometer",
				"filter_samples": 3,
				"sensor_cal":     1.5,
				"math_func":      2,
				"note":           "Summary notes for AI-01",
			},
		},
	}

	if errs := validateConfigIO(cfg); len(errs) != 0 {
		t.Fatalf("validateConfigIO() errors = %+v; want none", errs)
	}
}

func TestValidateConfigIORejectsInvalidFullEasySetAIFields(t *testing.T) {
	tests := []struct {
		name string
		item map[string]any
		path string
	}{
		{
			name: "filter_samples out of range",
			item: map[string]any{"ch": 1, "type": "0-10V", "filter_samples": 200},
			path: "ui[0].filter_samples",
		},
		{
			name: "math_func out of range",
			item: map[string]any{"ch": 1, "type": "0-10V", "math_func": 9},
			path: "ui[0].math_func",
		},
		{
			name: "sensor_cal out of range",
			item: map[string]any{"ch": 1, "type": "0-10V", "sensor_cal": 99},
			path: "ui[0].sensor_cal",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errs := validateConfigIO(ConfigIO{UI: []map[string]any{tt.item}})
			if !hasConfigErrorPath(errs, tt.path) {
				t.Fatalf("validateConfigIO() errors = %+v; want path %q", errs, tt.path)
			}
		})
	}
}

func hasConfigErrorPath(errs []configValidationError, path string) bool {
	for _, err := range errs {
		if err.Path == path {
			return true
		}
	}
	return false
}

func TestIOBundleApplyFailureRestoresBothFiles(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	ioPath := filepath.Join(app.cfg.ConfigDir, "io_config.conf")
	safePath := filepath.Join(app.cfg.ConfigDir, "io_safe_state.conf")
	oldIO := []byte("{\"revision\":7,\"checksum\":\"old\",\"ui\":[],\"ao\":[],\"do\":[]}\n")
	oldSafe := []byte("{\"revision\":7,\"checksum\":\"old\",\"ao\":[],\"do\":[]}\n")
	if err := os.WriteFile(ioPath, oldIO, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(safePath, oldSafe, 0o644); err != nil {
		t.Fatal(err)
	}
	coreAttempts := 0
	app.reloadDispatcher = func(target string) (bool, []string) {
		if target == reloadSIGHUPCore {
			coreAttempts++
			if coreAttempts == 1 {
				return false, []string{"core reload failed"}
			}
		}
		return true, nil
	}
	body := `{"base_revision":7,"io":{"ui":[],"ao":[],"do":[]},"safe_state":{"ao":[],"do":[]}}`
	w := modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/system/config/io-bundle", body)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "đã phục hồi revision 7") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	gotIO, _ := os.ReadFile(ioPath)
	gotSafe, _ := os.ReadFile(safePath)
	if string(gotIO) != string(oldIO) || string(gotSafe) != string(oldSafe) {
		t.Fatalf("rollback không nguyên tử: io=%s safe=%s", gotIO, gotSafe)
	}
}

func TestIOBundleOmittedCollectionsPersistAsArrays(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }

	body := `{"io":{},"safe_state":{}}`
	w := modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/system/config/io-bundle", body)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	ioData, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "io_config.conf"))
	if err != nil {
		t.Fatal(err)
	}
	safeData, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "io_safe_state.conf"))
	if err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{"io": ioData, "safe-state": safeData} {
		if bytes.Contains(data, []byte(`: null`)) {
			t.Fatalf("%s còn collection null: %s", name, data)
		}
	}
	for _, field := range []string{`"ui": []`, `"ao": []`, `"do": []`} {
		if !bytes.Contains(ioData, []byte(field)) {
			t.Fatalf("io thiếu %s: %s", field, ioData)
		}
	}
	for _, field := range []string{`"ao": []`, `"do": []`} {
		if !bytes.Contains(safeData, []byte(field)) {
			t.Fatalf("safe-state thiếu %s: %s", field, safeData)
		}
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
