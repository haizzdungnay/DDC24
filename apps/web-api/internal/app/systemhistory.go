package app

import (
	"net/http"
	"sync"
	"time"
)

// Lịch sử 60 phút của CPU/RAM/nhiệt độ — `T57-3.4` (Plan 57 §6.6-P2a).
//
// VÌ SAO KHÔNG DÙNG HISTORIAN
//
// Historian lưu **chuỗi thời gian theo point** — dữ liệu quá trình, có quality,
// có tier, có retention nhiều ngày. Số đo sức khoẻ máy chủ không phải point:
// nó không có quality, không ai trend nó cùng nhiệt độ gió cấp, và giữ nó 90
// ngày là giữ thứ không ai đọc. Nhét vào historian là làm hỏng ngữ nghĩa của
// historian để đổi lấy một biểu đồ 60 phút.
//
// VÌ SAO CHỈ 60 PHÚT VÀ CHỈ TRONG BỘ NHỚ
//
// Câu hỏi mà biểu đồ này trả lời là "vừa nãy có gì bất thường không?" — chẩn
// đoán tại chỗ, ngay sau khi thấy một triệu chứng. Câu hỏi dài hạn ("thiết bị
// này có xu hướng nóng lên không?") cần một kho khác và một quyết định khác.
// Mất khi khởi động lại là **đúng ngữ nghĩa**: sau restart thì trạng thái trước
// đó không còn giải thích được điều gì về tiến trình hiện tại.

const (
	systemHistoryWindow   = time.Hour
	systemHistoryInterval = 15 * time.Second
	// 60 phút / 15 giây = 240 mẫu; cấp thêm chỗ để nhịp lấy mẫu trôi không làm
	// mất mẫu đầu dải.
	systemHistoryCapacity = 260
)

type SystemHistorySample struct {
	At         string   `json:"at"`
	CPUPercent *float64 `json:"cpuPercent"`
	RAMPercent *float64 `json:"ramPercent"`
	TempC      *float64 `json:"tempC"`
}

type SystemHistoryResponse struct {
	SchemaVersion int    `json:"schemaVersion"`
	GeneratedAt   string `json:"generatedAt"`
	WindowS       int    `json:"windowS"`
	IntervalS     int    `json:"intervalS"`
	// SinceRestart nói thẳng rằng vòng nhớ bắt đầu từ lần khởi động dịch vụ —
	// người đọc phải biết vì sao biểu đồ ngắn hơn 60 phút ngay sau khi restart.
	SinceRestart string                `json:"sinceRestart"`
	Samples      []SystemHistorySample `json:"samples"`
}

// SystemHistoryRing là vòng nhớ mẫu sức khoẻ máy chủ.
type SystemHistoryRing struct {
	mu       sync.Mutex
	samples  []SystemHistorySample
	started  time.Time
	lastAt   time.Time
	interval time.Duration
}

func NewSystemHistoryRing(now time.Time) *SystemHistoryRing {
	return &SystemHistoryRing{started: now, interval: systemHistoryInterval}
}

// Observe ghi một mẫu nếu đã tới nhịp.
//
// Gọi từ chính đường `GET /system/status` thay vì dựng một goroutine lấy mẫu
// riêng: trang Chẩn đoán vốn poll endpoint đó, nên dữ liệu đã đi qua đây rồi.
// Thêm một vòng lặp nền để lấy lại đúng số đó là thêm một vòng đời phải quản lý
// mà không thêm thông tin nào.
func (r *SystemHistoryRing) Observe(now time.Time, metrics OSMetrics) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.lastAt.IsZero() && now.Sub(r.lastAt) < r.interval {
		return
	}
	r.lastAt = now
	r.samples = append(r.samples, SystemHistorySample{
		At:         now.UTC().Format(time.RFC3339),
		CPUPercent: metrics.CPUPercent,
		RAMPercent: metrics.RAMPercent,
		TempC:      metrics.TempC,
	})
	if len(r.samples) > systemHistoryCapacity {
		r.samples = append([]SystemHistorySample(nil), r.samples[len(r.samples)-systemHistoryCapacity:]...)
	}
}

func (r *SystemHistoryRing) Snapshot(now time.Time) SystemHistoryResponse {
	response := SystemHistoryResponse{
		SchemaVersion: 1,
		GeneratedAt:   now.UTC().Format(time.RFC3339),
		WindowS:       int(systemHistoryWindow / time.Second),
		IntervalS:     int(systemHistoryInterval / time.Second),
		Samples:       []SystemHistorySample{},
	}
	if r == nil {
		return response
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	response.SinceRestart = r.started.UTC().Format(time.RFC3339)
	cutoff := now.Add(-systemHistoryWindow)
	for _, sample := range r.samples {
		at, err := time.Parse(time.RFC3339, sample.At)
		if err != nil || at.Before(cutoff) {
			continue
		}
		response.Samples = append(response.Samples, sample)
	}
	return response
}

func (a *App) handleSystemHistory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.systemHistory.Snapshot(time.Now()))
}
