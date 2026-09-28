package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

type fakeOS struct{}

func (fakeOS) ReadMetrics(context.Context) (OSMetrics, error) {
	cpu := 12.5
	clock := 1512.5
	ram := 34.75
	temp := 42.25
	up := uint64(12345)
	return OSMetrics{CPUPercent: &cpu, CPUClockMhz: &clock, RAMPercent: &ram, TempC: &temp, UptimeS: &up}, nil
}

type fakeCore struct{}

func (fakeCore) ReadStatus(context.Context) (CoreStatus, error) {
	last := uint32(7)
	return CoreStatus{
		CoreAvailable: true,
		IobusPresent:  true,
		Versions:      VersionStatus{MCUFW: "1.0", Iobus: "1.2.0", Core: "1.1.0"},
		IOP:           IOPStatus{Status: "normal", CRCErrors: 1, Timeouts: 2, SeqErrors: 3, LastIORespMS: &last},
		Scan:          ScanStatus{Count: 99, Overrun: 4},
	}, nil
}

func TestSystemStatusHandler(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	// T63-103: số đo đến từ collector nền, không từ lần gọi trong handler.
	startOSMetricsCollector(t, app)

	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	checks := map[string]float64{
		"cpu_percent":   12.5,
		"cpu_clock_mhz": 1512.5,
		"ram_percent":   34.75,
		"tempC":         42.25,
		"uptimeS":       12345,
	}
	for key, want := range checks {
		got, ok := resp[key].(float64)
		if !ok || got != want {
			t.Fatalf("%s = %v; want %v", key, resp[key], want)
		}
	}
	if resp["overall"] != "ok" {
		t.Fatalf("overall = %v", resp["overall"])
	}
}

// WEB-UX-001: Dashboard phải lấy định danh thiết bị từ đây thay vì gán cứng.
// Hai nhánh đều được kiểm: có `device.conf` thì trả đúng giá trị đã cấu hình;
// không có thì các field phải VẮNG MẶT hẳn khỏi JSON (`omitempty`) để UI hiện
// `—`. Trả chuỗi rỗng hay giá trị mặc định sẽ khiến UI tưởng là dữ liệu thật.
func TestSystemStatusExposesDeviceIdentity(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	device := ConfigDevice{DeviceID: 24, DeviceName: "DDC-Tang-3", Description: "AHU khu B", Location: "Tủ ĐK tầng 3"}
	body, err := json.Marshal(device)
	if err != nil {
		t.Fatalf("marshal device config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.ConfigDir, "device.conf"), body, 0o600); err != nil {
		t.Fatalf("write device.conf: %v", err)
	}

	resp := systemStatusJSON(t, cfg)
	for key, want := range map[string]string{
		"device_name": "DDC-Tang-3",
		"description": "AHU khu B",
		"location":    "Tủ ĐK tầng 3",
	} {
		if got, _ := resp[key].(string); got != want {
			t.Fatalf("%s = %v; want %q", key, resp[key], want)
		}
	}
	if _, ok := resp["system_time"].(string); !ok {
		t.Fatalf("system_time thiếu hoặc không phải chuỗi: %v", resp["system_time"])
	}
}

func TestSystemStatusOmitsDeviceIdentityWhenUnconfigured(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	resp := systemStatusJSON(t, testConfig(t, users))
	for _, key := range []string{"device_name", "description", "location"} {
		if _, present := resp[key]; present {
			t.Fatalf("%s phải vắng mặt khi chưa cấu hình, nhưng có giá trị %v", key, resp[key])
		}
	}
}

func systemStatusJSON(t *testing.T, cfg Config) map[string]any {
	t.Helper()
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func TestReadCPUClockMhz(t *testing.T) {
	sysRoot := t.TempDir()
	dir := filepath.Join(sysRoot, "devices", "system", "cpu", "cpu0", "cpufreq")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir cpufreq: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "scaling_cur_freq"), []byte("1512000\n"), 0o644); err != nil {
		t.Fatalf("write cpufreq: %v", err)
	}

	got, err := readCPUClockMhz(sysRoot)
	if err != nil {
		t.Fatalf("readCPUClockMhz: %v", err)
	}
	if got != 1512 {
		t.Fatalf("clock = %v; want 1512", got)
	}
}

func TestReadTempCPrefersCPUThermalZone(t *testing.T) {
	sysRoot := t.TempDir()
	writeThermalZone(t, sysRoot, "thermal_zone0", "gpu", "50000")
	writeThermalZone(t, sysRoot, "thermal_zone1", "x86_pkg_temp", "42000")

	got, err := readTempC(sysRoot)
	if err != nil {
		t.Fatalf("readTempC: %v", err)
	}
	if got != 42 {
		t.Fatalf("temp = %v; want 42", got)
	}
}

func writeThermalZone(t *testing.T, sysRoot, zone, zoneType, temp string) {
	t.Helper()
	dir := filepath.Join(sysRoot, "class", "thermal", zone)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir thermal zone: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "type"), []byte(zoneType), 0o644); err != nil {
		t.Fatalf("write thermal type: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "temp"), []byte(temp), 0o644); err != nil {
		t.Fatalf("write thermal temp: %v", err)
	}
}

func TestSystemStatusRequiresAuth(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	app, err := NewApp(testConfig(t, users), nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/status", nil)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}
