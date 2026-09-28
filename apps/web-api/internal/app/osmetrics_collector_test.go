package app

// T63-103 (PERF-API-02, Plan 63 §4.2) — collector số đo hệ điều hành: khởi động,
// lỗi, mẫu cũ và tắt theo context.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// startOSMetricsCollector chạy collector của app như StartSampler, chờ mẫu đầu,
// và dừng nó khi test xong.
func startOSMetricsCollector(t *testing.T, app *App) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	app.osMetrics.Start(ctx)
	t.Cleanup(func() {
		cancel()
		app.osMetrics.Stop()
	})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, fresh := app.osMetrics.Snapshot(); fresh.State == OSMetricsStateOK {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("collector không có mẫu đầu trong 3 s")
}

// scriptedOS trả lần lượt các kết quả đã soạn; hết kịch bản thì lặp lại kết quả cuối.
type scriptedOS struct {
	mu    sync.Mutex
	steps []scriptedStep
	calls int
}

type scriptedStep struct {
	cpu float64
	err error
}

func (s *scriptedOS) ReadMetrics(context.Context) (OSMetrics, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	step := s.steps[min(s.calls, len(s.steps)-1)]
	s.calls++
	if step.err != nil {
		return OSMetrics{}, step.err
	}
	cpu := step.cpu
	return OSMetrics{CPUPercent: &cpu}, nil
}

type fakeCollectorClock struct{ now time.Time }

func (c *fakeCollectorClock) advance(d time.Duration) { c.now = c.now.Add(d) }

func newScriptedCollector(steps ...scriptedStep) (*OSMetricsCollector, *fakeCollectorClock) {
	clock := &fakeCollectorClock{now: time.Unix(1_790_000_000, 0)}
	c := NewOSMetricsCollector(&scriptedOS{steps: steps}, osMetricsInterval, osMetricsStaleAfter)
	c.now = func() time.Time { return clock.now }
	return c, clock
}

// Khởi động: chưa có mẫu ⇒ `unknown`, không số nào, sampledAt/ageMs null.
func TestOSMetricsCollectorUnknownBeforeFirstSample(t *testing.T) {
	c, _ := newScriptedCollector(scriptedStep{cpu: 30})
	metrics, fresh := c.Snapshot()
	if fresh.State != OSMetricsStateUnknown || fresh.SampledAt != nil || fresh.AgeMs != nil {
		t.Fatalf("fresh = %+v; want unknown, sampledAt/ageMs null", fresh)
	}
	if metrics.CPUPercent != nil || metrics.UptimeS != nil {
		t.Fatalf("metrics = %+v; want rỗng khi chưa có mẫu", metrics)
	}
	if fresh.IntervalMs != 1000 || fresh.StaleAfterMs != 2000 {
		t.Fatalf("intervalMs/staleAfterMs = %d/%d; want 1000/2000", fresh.IntervalMs, fresh.StaleAfterMs)
	}
}

// Mẫu mới ⇒ ok và có tuổi; cũ quá 2 s ⇒ `stale`, số đo bị giữ lại chứ không phát.
func TestOSMetricsCollectorMarksSampleStaleAfterTwoSeconds(t *testing.T) {
	c, clock := newScriptedCollector(scriptedStep{cpu: 30})
	c.sampleOnce(context.Background())

	metrics, fresh := c.Snapshot()
	if fresh.State != OSMetricsStateOK || fresh.AgeMs == nil || *fresh.AgeMs != 0 || fresh.SampledAt == nil {
		t.Fatalf("ngay sau mẫu: fresh = %+v; want ok, ageMs 0", fresh)
	}
	if metrics.CPUPercent == nil || *metrics.CPUPercent != 30 {
		t.Fatalf("cpu = %v; want 30", metrics.CPUPercent)
	}

	clock.advance(2 * time.Second)
	if _, fresh := c.Snapshot(); fresh.State != OSMetricsStateOK || *fresh.AgeMs != 2000 {
		t.Fatalf("tuổi đúng 2 s: fresh = %+v; want vẫn ok", fresh)
	}
	clock.advance(time.Millisecond)
	metrics, fresh = c.Snapshot()
	if fresh.State != OSMetricsStateStale || *fresh.AgeMs != 2001 {
		t.Fatalf("tuổi 2,001 s: fresh = %+v; want stale, ageMs 2001", fresh)
	}
	if metrics.CPUPercent != nil {
		t.Fatalf("stale mà vẫn phát cpu = %v", *metrics.CPUPercent)
	}
}

// Collector lỗi: chưa từng thành công ⇒ unknown kèm lastError; lỗi sau một mẫu tốt
// ⇒ giữ mẫu cũ cho tới khi nó hoá stale, KHÔNG thay bằng 0.
func TestOSMetricsCollectorErrorKeepsLastGoodSampleUntilStale(t *testing.T) {
	boom := errors.New("đọc /proc/stat lỗi")
	c, clock := newScriptedCollector(scriptedStep{err: boom}, scriptedStep{err: boom}, scriptedStep{cpu: 42}, scriptedStep{err: boom})
	var logs []string
	c.logf = func(format string, args ...any) { logs = append(logs, fmt.Sprintf(format, args...)) }

	c.sampleOnce(context.Background())
	c.sampleOnce(context.Background()) // lỗi lần hai: không log thêm
	if _, fresh := c.Snapshot(); fresh.State != OSMetricsStateUnknown || fresh.LastError != boom.Error() {
		t.Fatalf("lỗi ngay mẫu đầu: fresh = %+v; want unknown + lastError", fresh)
	}

	c.sampleOnce(context.Background())
	if len(logs) != 2 || !strings.HasPrefix(logs[0], "WARN os_metrics sample_failed") ||
		logs[1] != "INFO os_metrics sample_recovered" {
		t.Fatalf("logs = %q; want đúng một WARN khi bắt đầu lỗi và một INFO khi hồi phục", logs)
	}
	clock.advance(time.Second)
	c.sampleOnce(context.Background()) // lỗi, mẫu 42 giữ nguyên
	metrics, fresh := c.Snapshot()
	if fresh.State != OSMetricsStateOK || fresh.LastError != boom.Error() || *fresh.AgeMs != 1000 {
		t.Fatalf("lỗi sau mẫu tốt: fresh = %+v; want ok, ageMs 1000, lastError", fresh)
	}
	if metrics.CPUPercent == nil || *metrics.CPUPercent != 42 {
		t.Fatalf("cpu = %v; want 42 (mẫu tốt gần nhất)", metrics.CPUPercent)
	}

	clock.advance(1001 * time.Millisecond)
	metrics, fresh = c.Snapshot()
	if fresh.State != OSMetricsStateStale || metrics.CPUPercent != nil {
		t.Fatalf("lỗi kéo dài quá 2 s: fresh = %+v cpu = %v; want stale, không cpu", fresh, metrics.CPUPercent)
	}
}

// blockingOS chặn cho tới khi ctx bị huỷ — mô phỏng /proc treo — và ghi lại việc
// nó đã được giải phóng bằng ctx.
type blockingOS struct {
	calls    atomic.Int32
	entered  chan struct{}
	released atomic.Bool
}

func (b *blockingOS) ReadMetrics(ctx context.Context) (OSMetrics, error) {
	if b.calls.Add(1) == 1 {
		close(b.entered)
	}
	<-ctx.Done()
	b.released.Store(true)
	return OSMetrics{}, ctx.Err()
}

// Tắt: huỷ context (SIGTERM ở Main) ⇒ lần đọc đang treo được giải phóng,
// goroutine thoát, không còn lần đọc nào sau đó; Stop gọi lại vô hại.
func TestOSMetricsCollectorStopsWhenContextCancelled(t *testing.T) {
	reader := &blockingOS{entered: make(chan struct{})}
	c := NewOSMetricsCollector(reader, time.Hour, 2*time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	c.Start(ctx)
	c.Start(ctx) // gọi lại: không sinh goroutine thứ hai
	<-reader.entered

	cancel()
	stopped := make(chan struct{})
	go func() {
		c.Stop()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("collector không thoát sau khi huỷ context")
	}
	if !reader.released.Load() {
		t.Fatal("lần đọc đang treo không nhận được huỷ context")
	}
	if _, fresh := c.Snapshot(); fresh.State != OSMetricsStateUnknown || fresh.LastError != "" {
		t.Fatalf("fresh = %+v; want unknown, không ghi lỗi của lần đọc bị huỷ khi tắt", fresh)
	}
	calls := reader.calls.Load()
	c.Stop()
	time.Sleep(20 * time.Millisecond)
	if got := reader.calls.Load(); got != calls || got != 1 {
		t.Fatalf("reader bị gọi %d lần (trước Stop lần hai: %d); want đúng 1", got, calls)
	}
}

// App.Close dừng collector mà StartSampler đã chạy.
func TestAppCloseStopsOSMetricsCollector(t *testing.T) {
	app, _ := newTestAppWithRole(t, RoleAdmin, fakeCore{})
	reader := &blockingOS{entered: make(chan struct{})}
	app.osMetrics = NewOSMetricsCollector(reader, time.Hour, 2*time.Hour)
	app.osMetrics.Start(context.Background())
	<-reader.entered
	done := make(chan error, 1)
	go func() { done <- app.Close() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("App.Close không dừng collector")
	}
	if !reader.released.Load() {
		t.Fatal("App.Close không huỷ lần đọc đang treo")
	}
}

type countingOS struct{ calls atomic.Int32 }

func (c *countingOS) ReadMetrics(context.Context) (OSMetrics, error) {
	c.calls.Add(1)
	cpu := 5.0
	return OSMetrics{CPUPercent: &cpu}, nil
}

// Lấy mẫu đầu NGAY khi Start rồi theo nhịp, không chờ hết nhịp đầu.
func TestOSMetricsCollectorSamplesImmediatelyThenPeriodically(t *testing.T) {
	reader := &countingOS{}
	c := NewOSMetricsCollector(reader, 10*time.Millisecond, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.Start(ctx)
	defer c.Stop()
	deadline := time.Now().Add(2 * time.Second)
	for reader.calls.Load() < 3 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	if got := reader.calls.Load(); got < 3 {
		t.Fatalf("reader gọi %d lần trong 2 s với nhịp 10 ms; want ≥ 3", got)
	}
	if _, fresh := c.Snapshot(); fresh.State != OSMetricsStateOK {
		t.Fatalf("fresh = %+v; want ok", fresh)
	}
}

// Qua HTTP: web vừa khởi động, collector chưa có mẫu ⇒ không trường số đo nào,
// `osMetrics.state = unknown`. Mã cũ trả `cpu_percent` từ lần đọc trong handler
// và không có khối `osMetrics`.
func TestSystemStatusAndOverviewReportUnknownBeforeFirstSample(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleAdmin, fakeCore{})

	_, body := shmGetJSON(t, app, token, "/api/v1/system/status")
	var status map[string]any
	if err := json.Unmarshal(body, &status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, key := range []string{"cpu_percent", "cpuPercent", "ram_percent", "tempC", "uptime_s", "uptimeS", "cpu_clock_mhz"} {
		if _, present := status[key]; present {
			t.Fatalf("%s = %v; want vắng mặt khi chưa có mẫu", key, status[key])
		}
	}
	block, _ := status["osMetrics"].(map[string]any)
	if block == nil || block["state"] != OSMetricsStateUnknown || block["sampledAt"] != nil || block["ageMs"] != nil {
		t.Fatalf("osMetrics = %v; want state unknown, sampledAt/ageMs null", status["osMetrics"])
	}

	_, body = shmGetJSON(t, app, token, "/api/v1/overview")
	var overview struct {
		Controller map[string]any     `json:"controller"`
		OSMetrics  OSMetricsFreshness `json:"osMetrics"`
	}
	if err := json.Unmarshal(body, &overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if _, present := overview.Controller["uptimeS"]; present {
		t.Fatalf("controller.uptimeS = %v; want vắng mặt khi chưa có mẫu", overview.Controller["uptimeS"])
	}
	if overview.OSMetrics.State != OSMetricsStateUnknown {
		t.Fatalf("overview osMetrics = %+v; want unknown", overview.OSMetrics)
	}
}

// Có mẫu: cả hai endpoint cùng một bản chụp, có sampledAt và ageMs.
func TestSystemStatusAndOverviewShareCollectorSample(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleAdmin, fakeCore{})
	startOSMetricsCollector(t, app)

	_, body := shmGetJSON(t, app, token, "/api/v1/system/status")
	var status struct {
		CPU       *float64           `json:"cpu_percent"`
		OSMetrics OSMetricsFreshness `json:"osMetrics"`
	}
	if err := json.Unmarshal(body, &status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if status.CPU == nil || *status.CPU != 12.5 || status.OSMetrics.State != OSMetricsStateOK ||
		status.OSMetrics.SampledAt == nil || status.OSMetrics.AgeMs == nil {
		t.Fatalf("system/status = %s; want cpu 12.5, osMetrics ok có sampledAt/ageMs", body)
	}
	if _, err := time.Parse(time.RFC3339Nano, *status.OSMetrics.SampledAt); err != nil {
		t.Fatalf("sampledAt = %q: %v", *status.OSMetrics.SampledAt, err)
	}

	_, body = shmGetJSON(t, app, token, "/api/v1/overview")
	var overview struct {
		OSMetrics OSMetricsFreshness `json:"osMetrics"`
	}
	if err := json.Unmarshal(body, &overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if overview.OSMetrics.SampledAt == nil || *overview.OSMetrics.SampledAt != *status.OSMetrics.SampledAt {
		t.Fatalf("overview sampledAt = %v; want cùng mẫu %q với /system/status",
			overview.OSMetrics.SampledAt, *status.OSMetrics.SampledAt)
	}
}

func TestCPUPercentBetweenRejectsNonAdvancingCounters(t *testing.T) {
	a := cpuSample{idle: 850, total: 1000}
	if _, ok := cpuPercentBetween(a, a); ok {
		t.Fatal("bộ đếm đứng yên: ok = true; want false (không phải 0 %)")
	}
	if _, ok := cpuPercentBetween(a, cpuSample{idle: 800, total: 1100}); ok {
		t.Fatal("idle lùi: ok = true; want false")
	}
	if got, ok := cpuPercentBetween(a, cpuSample{idle: 900, total: 1100}); !ok || got != 50 {
		t.Fatalf("delta 100, idle 50 ⇒ %v, %v; want 50, true", got, ok)
	}
}
