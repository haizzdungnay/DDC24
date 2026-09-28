package app

// T63-103 (PERF-API-02) — handler không được chờ việc lấy mẫu hệ điều hành.
//
// File này cố ý chỉ dùng API có từ trước T63-103, cộng một helper
// `startOSMetricsCollector` (osmetrics_collector_test.go). Nhờ vậy chạy được trên
// mã cũ, với helper thay bằng no-op, để chứng minh test ĐỎ khi bỏ bản sửa: mã cũ
// gọi `ReadMetrics` ngay trong handler nên mỗi request chờ trọn thời gian đọc.

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// slowOS mô phỏng LinuxOSReader: một lần đọc tốn `delay` (bản thật chờ 100 ms
// giữa hai mẫu /proc/stat). Tôn trọng ctx như bản thật.
type slowOS struct{ delay time.Duration }

func (s slowOS) ReadMetrics(ctx context.Context) (OSMetrics, error) {
	select {
	case <-time.After(s.delay):
	case <-ctx.Done():
		return OSMetrics{}, ctx.Err()
	}
	cpu := 12.5
	up := uint64(777)
	return OSMetrics{CPUPercent: &cpu, UptimeS: &up}, nil
}

func slowOSApp(t *testing.T, delay time.Duration) (*App, string) {
	t.Helper()
	users := writeTestUsers(t, "admin123", RoleAdmin)
	app, err := NewApp(testConfig(t, users), nil, fakeCore{}, slowOS{delay: delay})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	return app, token
}

// requestLatencies gọi `path` n lần và trả thời gian từng lần đã sắp xếp.
func requestLatencies(t *testing.T, app *App, token, path string, n int) ([]time.Duration, []byte) {
	t.Helper()
	var last []byte
	out := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		code, body := shmGetJSON(t, app, token, path)
		out = append(out, time.Since(start))
		if code != http.StatusOK {
			t.Fatalf("%s: status = %d body=%s", path, code, body)
		}
		last = body
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, last
}

// AC T63-103: `/system/status` đọc bản chụp của collector; một lần đọc /proc chậm
// 200 ms không còn nằm trên đường request.
func TestSystemStatusDoesNotWaitForOSSampling(t *testing.T) {
	app, token := slowOSApp(t, 200*time.Millisecond)
	startOSMetricsCollector(t, app)

	lat, body := requestLatencies(t, app, token, "/api/v1/system/status", 20)
	if worst := lat[len(lat)-1]; worst > 50*time.Millisecond {
		t.Fatalf("/system/status chậm nhất %v; want < 50ms (không chờ lấy mẫu 200ms)", worst)
	}
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got, _ := resp["cpu_percent"].(float64); got != 12.5 {
		t.Fatalf("cpu_percent = %v; want 12.5 từ collector", resp["cpu_percent"])
	}
	t.Logf("/system/status: p50=%v max=%v", lat[len(lat)/2], lat[len(lat)-1])
}

// AC T63-103: `/overview` dùng CHUNG collector, không tự lấy mẫu.
func TestOverviewDoesNotWaitForOSSampling(t *testing.T) {
	app, token := slowOSApp(t, 200*time.Millisecond)
	startOSMetricsCollector(t, app)

	lat, body := requestLatencies(t, app, token, "/api/v1/overview", 20)
	if worst := lat[len(lat)-1]; worst > 50*time.Millisecond {
		t.Fatalf("/overview chậm nhất %v; want < 50ms (không chờ lấy mẫu 200ms)", worst)
	}
	var resp struct {
		Controller struct {
			UptimeS uint64 `json:"uptimeS"`
		} `json:"controller"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Controller.UptimeS != 777 {
		t.Fatalf("controller.uptimeS = %d; want 777 từ collector", resp.Controller.UptimeS)
	}
	t.Logf("/overview: p50=%v max=%v", lat[len(lat)/2], lat[len(lat)-1])
}

// Bộ đếm /proc/stat không tăng giữa hai mẫu ⇒ CPU KHÔNG BIẾT, không phải 0 %.
// Mã cũ trả `cpu_percent: 0` cho ca này.
func TestLinuxOSReaderOmitsCPUWhenCounterDoesNotAdvance(t *testing.T) {
	procRoot := t.TempDir()
	files := map[string]string{
		"stat":    "cpu  100 0 50 850 0 0 0 0 0 0\ncpu0 100 0 50 850 0 0 0 0 0 0\n",
		"meminfo": "MemTotal:       1000000 kB\nMemAvailable:    600000 kB\n",
		"uptime":  "12345.67 40000.00\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(procRoot, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	metrics, err := LinuxOSReader{ProcRoot: procRoot, SysRoot: t.TempDir()}.ReadMetrics(context.Background())
	if err != nil {
		t.Fatalf("ReadMetrics: %v (RAM và uptime vẫn đọc được)", err)
	}
	if metrics.CPUPercent != nil {
		t.Fatalf("cpu_percent = %v; want vắng mặt khi bộ đếm không tăng", *metrics.CPUPercent)
	}
	if metrics.RAMPercent == nil || *metrics.RAMPercent != 40 {
		t.Fatalf("ram_percent = %v; want 40", metrics.RAMPercent)
	}
}
