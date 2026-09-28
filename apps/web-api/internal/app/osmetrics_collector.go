package app

// T63-103 (PERF-API-02, Plan 63 §4.2) — MỘT collector nền lấy mẫu số đo hệ điều
// hành mỗi giây, dùng chung cho `GET /api/v1/system/status` và `GET
// /api/v1/overview`.
//
// Trước bản này, mỗi request gọi thẳng `LinuxOSReader.ReadMetrics`, hàm đó đọc
// `/proc/stat` hai lần cách nhau 100 ms để tính CPU. Mọi request `/system/status`
// vì thế chờ ít nhất 100 ms, và `/overview` chờ đúng 100 ms đó chỉ để lấy
// uptime. Hai trang poll mỗi giây nhân lên thành một hàng đợi chờ đồng hồ.
//
// Quy tắc fail-safe: chưa có mẫu nào (`unknown`) hoặc mẫu gần nhất cũ quá
// osMetricsStaleAfter (`stale`) thì KHÔNG phát số nào: mọi trường số cũ
// (`cpu_percent`, `ram_percent`, `tempC`, `uptimeS`, …) vắng mặt, còn khối
// `osMetrics` nói rõ vì sao. Không bao giờ trả CPU = 0 thay cho "không biết".

import (
	"context"
	"sync"
	"time"
)

const (
	// osMetricsInterval: nhịp lấy mẫu (Plan 63 T63-103: collector 1 s).
	osMetricsInterval = time.Second
	// osMetricsStaleAfter: mẫu cũ hơn ngưỡng này là `stale`. Gấp đôi nhịp lấy
	// mẫu: lỡ đúng MỘT nhịp (một lần đọc /proc chậm) chưa phải là mất dữ liệu,
	// lỡ hai nhịp liền thì collector đã thật sự đứng.
	osMetricsStaleAfter = 2 * time.Second
)

const (
	OSMetricsStateOK      = "ok"
	OSMetricsStateUnknown = "unknown" // chưa có lần lấy mẫu nào thành công
	OSMetricsStateStale   = "stale"   // mẫu gần nhất cũ hơn staleAfterMs
)

// OSMetricsFreshness đi cùng response để người đọc biết số đo cũ tới mức nào.
// `sampledAt`/`ageMs` là null khi chưa từng có mẫu.
type OSMetricsFreshness struct {
	State        string  `json:"state"`
	SampledAt    *string `json:"sampledAt"`
	AgeMs        *int64  `json:"ageMs"`
	IntervalMs   int64   `json:"intervalMs"`
	StaleAfterMs int64   `json:"staleAfterMs"`
	// LastError là lỗi của lần lấy mẫu gần nhất, rỗng khi lần đó thành công.
	LastError string `json:"lastError,omitempty"`
}

// OSMetricsCollector giữ mẫu gần nhất. Handler chỉ đọc bản chụp, không bao giờ
// chờ /proc.
type OSMetricsCollector struct {
	reader     OSReader
	interval   time.Duration
	staleAfter time.Duration
	now        func() time.Time
	// logf ghi log CHỈ khi chuyển trạng thái (bắt đầu lỗi / hồi phục), không mỗi
	// giây một dòng. nil = không log.
	logf func(format string, args ...any)

	mu        sync.RWMutex
	metrics   OSMetrics
	sampledAt time.Time // zero = chưa có mẫu
	lastErr   string

	lifeMu  sync.Mutex
	started bool
	cancel  context.CancelFunc
	done    chan struct{}
}

func NewOSMetricsCollector(reader OSReader, interval, staleAfter time.Duration) *OSMetricsCollector {
	return &OSMetricsCollector{reader: reader, interval: interval, staleAfter: staleAfter, now: time.Now}
}

// Start chạy vòng lấy mẫu tới khi ctx bị huỷ hoặc Stop được gọi. Mẫu đầu lấy
// NGAY, không chờ hết nhịp đầu tiên. Gọi lại lần hai không có tác dụng.
func (c *OSMetricsCollector) Start(ctx context.Context) {
	if c == nil {
		return
	}
	c.lifeMu.Lock()
	defer c.lifeMu.Unlock()
	if c.started {
		return
	}
	c.started = true
	runCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.done = make(chan struct{})
	go c.run(runCtx, c.done)
}

// Stop huỷ vòng lấy mẫu và chờ goroutine thoát. An toàn khi gọi nhiều lần hoặc
// khi chưa Start.
func (c *OSMetricsCollector) Stop() {
	if c == nil {
		return
	}
	c.lifeMu.Lock()
	cancel, done := c.cancel, c.done
	c.lifeMu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	<-done
}

func (c *OSMetricsCollector) run(ctx context.Context, done chan struct{}) {
	defer close(done)
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	c.sampleOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.sampleOnce(ctx)
		}
	}
}

// sampleOnce lấy một mẫu. Mỗi lần đọc bị chặn bởi đúng một nhịp: một /proc treo
// không giữ collector mãi, mẫu cũ tự hoá `stale`. Lỗi thì GIỮ mẫu cũ (không xoá,
// không ghi đè bằng số 0) để tuổi của nó nói thật.
func (c *OSMetricsCollector) sampleOnce(ctx context.Context) {
	sampleCtx, cancel := context.WithTimeout(ctx, c.interval)
	defer cancel()
	metrics, err := c.reader.ReadMetrics(sampleCtx)
	if ctx.Err() != nil {
		return // đang tắt: không ghi mẫu dở
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		if c.lastErr == "" && c.logf != nil {
			c.logf("WARN os_metrics sample_failed err=%v", err)
		}
		c.lastErr = err.Error()
		return
	}
	if c.lastErr != "" && c.logf != nil {
		c.logf("INFO os_metrics sample_recovered")
	}
	c.metrics = metrics
	c.sampledAt = c.now()
	c.lastErr = ""
}

// Snapshot trả số đo khi mẫu còn mới. `unknown`/`stale` trả OSMetrics rỗng (mọi
// con trỏ nil) để handler không phát ra con số nào cho thứ không biết.
func (c *OSMetricsCollector) Snapshot() (OSMetrics, OSMetricsFreshness) {
	fresh := OSMetricsFreshness{State: OSMetricsStateUnknown}
	if c == nil {
		return OSMetrics{}, fresh
	}
	fresh.IntervalMs = c.interval.Milliseconds()
	fresh.StaleAfterMs = c.staleAfter.Milliseconds()
	now := c.now()
	c.mu.RLock()
	metrics, at, lastErr := c.metrics, c.sampledAt, c.lastErr
	c.mu.RUnlock()
	fresh.LastError = lastErr
	if at.IsZero() {
		return OSMetrics{}, fresh
	}
	age := now.Sub(at)
	if age < 0 {
		age = 0
	}
	sampledAt := at.UTC().Format(time.RFC3339Nano)
	ageMs := age.Milliseconds()
	fresh.SampledAt = &sampledAt
	fresh.AgeMs = &ageMs
	if age > c.staleAfter {
		fresh.State = OSMetricsStateStale
		return OSMetrics{}, fresh
	}
	fresh.State = OSMetricsStateOK
	return metrics, fresh
}
