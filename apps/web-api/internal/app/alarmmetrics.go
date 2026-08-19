package app

import (
	"context"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

// Chỉ số hệ alarm ISA-18.2 §16 — `T57-3.3` (`ADR-044`, thi hành `ADR-036`).
//
// VÌ SAO CÁC CON SỐ NÀY LÀ CHỈ SỐ AN TOÀN CHỨ KHÔNG PHẢI THỐNG KÊ CHO VUI
//
// ISA-18.2 đặt ngưỡng "hệ alarm còn quản lý được" bằng chính nhịp cảnh báo:
// quá 10 cảnh báo trong 10 phút là **alarm flood**, trạng thái mà người vận
// hành không còn đọc kịp và bắt đầu bỏ qua cả những cảnh báo thật. Không đo
// được nhịp đó thì không ai biết hệ đang ở phía nào của ngưỡng.
//
// BA LUẬT CỦA `ADR-044`
//
//  1. **Tính tại thời điểm hỏi**, không có tiến trình tổng hợp nền. Một daemon
//     tổng hợp là thêm một nguồn có thể lệch với nhật ký gốc; đọc thẳng nhật ký
//     thì không có gì để lệch.
//  2. **Cửa sổ tối đa 7 ngày.** Kho giữ 90 ngày, nhưng quét cả 90 ngày cho một
//     lần mở trang trên bo nhúng là tự tạo một điểm treo.
//  3. **Thiếu nhật ký ⇒ 503 nói rõ.** Cấm trả `0`: trên màn hình an toàn,
//     "không có cảnh báo nào" và "không đọc được nhật ký" là hai tình trạng
//     đối lập, và nhầm chúng là nhầm theo hướng nguy hiểm.

const (
	// Ngưỡng flood của ISA-18.2: > 10 cảnh báo mới trong 10 phút.
	alarmFloodThreshold = 10
	alarmMetricsMaxTop  = 10
)

type AlarmTopRepeating struct {
	AlarmID string `json:"alarmId"`
	Name    string `json:"name,omitempty"`
	Count   int    `json:"count"`
}

type AlarmShelvedExpiring struct {
	AlarmID   string `json:"alarmId"`
	Name      string `json:"name,omitempty"`
	ShelvedAt string `json:"shelvedAt"`
}

type AlarmMetricsResponse struct {
	SchemaVersion int    `json:"schemaVersion"`
	GeneratedAt   string `json:"generatedAt"`
	Window        string `json:"window"`
	WindowS       int    `json:"windowS"`
	// Rate10m là nhịp trong 10 phút gần nhất — con số so trực tiếp với ngưỡng
	// flood, bất kể cửa sổ đang hỏi là bao lâu.
	Rate10m      int                    `json:"rate10m"`
	RatePerHour  float64                `json:"ratePerHour"`
	TotalRaised  int                    `json:"totalRaised"`
	Flooding     bool                   `json:"flooding"`
	TopRepeating []AlarmTopRepeating    `json:"topRepeating"`
	Shelved      []AlarmShelvedExpiring `json:"shelved"`
}

var alarmMetricsWindows = map[string]time.Duration{
	"10m": 10 * time.Minute,
	"1h":  time.Hour,
	"24h": 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
}

func (a *App) handleAlarmMetrics(w http.ResponseWriter, r *http.Request) {
	windowKey := strings.TrimSpace(r.URL.Query().Get("window"))
	if windowKey == "" {
		windowKey = "24h"
	}
	window, ok := alarmMetricsWindows[windowKey]
	if !ok {
		writeError(w, http.StatusBadRequest, "window must be one of 10m, 1h, 24h, 7d")
		return
	}

	// `ADR-044` điều 3: không đọc được nhật ký thì nói ra, tuyệt đối không trả 0.
	if a.alarmHistory == nil || a.alarmHistory.path == "" {
		writeError(w, http.StatusServiceUnavailable, "alarm history store is not configured")
		return
	}
	if _, err := os.Stat(a.alarmHistory.path); err != nil {
		writeError(w, http.StatusServiceUnavailable, "alarm history is unreadable: "+err.Error())
		return
	}

	now := time.Now().UTC()
	from := now.Add(-window)
	events, err := a.alarmHistory.ListFiltered(r.Context(), alarmHistoryMaxLimit, AlarmHistoryFilter{From: &from})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "cannot read alarm history: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, computeAlarmMetrics(events, now, windowKey, window))
}

// computeAlarmMetrics thuần hoá phần tính toán để test được mà không cần tệp.
func computeAlarmMetrics(events []AlarmHistoryEvent, now time.Time, windowKey string, window time.Duration) AlarmMetricsResponse {
	response := AlarmMetricsResponse{
		SchemaVersion: 1,
		GeneratedAt:   now.Format(time.RFC3339),
		Window:        windowKey,
		WindowS:       int(window / time.Second),
		TopRepeating:  []AlarmTopRepeating{},
		Shelved:       []AlarmShelvedExpiring{},
	}

	counts := map[string]int{}
	names := map[string]string{}
	tenMinutesAgo := now.Add(-10 * time.Minute)

	for _, event := range events {
		at, err := time.Parse(time.RFC3339Nano, event.Time)
		if err != nil {
			at, err = time.Parse(time.RFC3339, event.Time)
			if err != nil {
				continue
			}
		}
		at = at.UTC()
		if at.Before(now.Add(-window)) || at.After(now.Add(time.Minute)) {
			continue
		}

		if isAlarmRaiseEvent(event.Event) {
			response.TotalRaised++
			counts[event.AlarmID]++
			// `Message` là chuỗi người đọc được; `AlarmHistoryEvent` không có
			// trường tên riêng, và bịa một trường mới chỉ để hiển thị là mở
			// rộng hợp đồng cho một nhu cầu trình bày.
			if event.Message != "" {
				names[event.AlarmID] = event.Message
			}
			if at.After(tenMinutesAgo) {
				response.Rate10m++
			}
		}
		if strings.EqualFold(event.Status, "shelved") {
			response.Shelved = append(response.Shelved, AlarmShelvedExpiring{
				AlarmID: event.AlarmID, Name: event.Message, ShelvedAt: event.Time,
			})
		}
	}

	hours := window.Hours()
	if hours > 0 {
		response.RatePerHour = float64(response.TotalRaised) / hours
	}
	response.Flooding = response.Rate10m > alarmFloodThreshold

	for id, count := range counts {
		response.TopRepeating = append(response.TopRepeating, AlarmTopRepeating{AlarmID: id, Name: names[id], Count: count})
	}
	sort.Slice(response.TopRepeating, func(i, j int) bool {
		if response.TopRepeating[i].Count == response.TopRepeating[j].Count {
			return response.TopRepeating[i].AlarmID < response.TopRepeating[j].AlarmID
		}
		return response.TopRepeating[i].Count > response.TopRepeating[j].Count
	})
	if len(response.TopRepeating) > alarmMetricsMaxTop {
		response.TopRepeating = response.TopRepeating[:alarmMetricsMaxTop]
	}

	// Cảnh báo bị treo: mới nhất trước, và chỉ giữ một mục cho mỗi cảnh báo.
	sort.Slice(response.Shelved, func(i, j int) bool { return response.Shelved[i].ShelvedAt > response.Shelved[j].ShelvedAt })
	seen := map[string]bool{}
	unique := response.Shelved[:0]
	for _, item := range response.Shelved {
		if seen[item.AlarmID] {
			continue
		}
		seen[item.AlarmID] = true
		unique = append(unique, item)
	}
	response.Shelved = unique

	return response
}

// isAlarmRaiseEvent — chỉ thời điểm cảnh báo BẬT mới tính vào nhịp.
//
// `acked`/`ended` là diễn biến xử lý; đếm chúng vào nhịp sẽ làm một ca trực xử
// lý tốt trông như một trận flood.
func isAlarmRaiseEvent(event string) bool {
	switch strings.ToLower(strings.TrimSpace(event)) {
	case "started", "returned", "raised", "":
		return true
	default:
		return false
	}
}

// ── Xoay vòng và retention (`ADR-036` điều kiện tiên quyết) ────────────────

const (
	alarmHistoryRetentionDays = 90
	// Trần kích thước trước khi cắt bớt. `alarm_history.jsonl` trước đây KHÔNG
	// có xoay vòng, không có retention, và bị đọc bằng quét toàn tệp: một trận
	// alarm flood kéo dài sẽ vừa làm tệp phình vừa làm mọi truy vấn chậm dần.
	alarmHistoryMaxBytes = 8 << 20
)

// Prune cắt nhật ký cảnh báo theo tuổi và theo kích thước.
//
// Chạy theo lịch trong `StartAlarmHistory` chứ không chạy trong `Append`: cắt
// tệp ngay trên đường ghi một sự kiện an toàn là đặt một thao tác I/O dài vào
// đúng lúc hệ đang bận nhất — chính lúc alarm flood.
func (s *AlarmHistoryStore) Prune(now time.Time) error {
	if s == nil || s.path == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	info, err := os.Stat(s.path)
	if err != nil {
		return nil // chưa có tệp thì không có gì để cắt
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	cutoff := now.Add(-alarmHistoryRetentionDays * 24 * time.Hour)
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if at, ok := alarmHistoryLineTime(line); ok && at.Before(cutoff) {
			continue
		}
		kept = append(kept, line)
	}

	// Vẫn quá lớn sau khi cắt theo tuổi ⇒ giữ phần MỚI NHẤT. Mất phần cũ là
	// đánh đổi có chủ đích: nhật ký gần đây mới trả lời được câu hỏi đang hỏi.
	joined := strings.Join(kept, "\n")
	for len(joined) > alarmHistoryMaxBytes && len(kept) > 1 {
		kept = kept[len(kept)/4:]
		joined = strings.Join(kept, "\n")
	}

	if len(kept) == len(lines) && int64(len(joined)+1) == info.Size() {
		return nil // không có gì đổi; không ghi lại để khỏi mòn flash
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, []byte(joined+"\n"), alarmSettingsFilePerm); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func alarmHistoryLineTime(line string) (time.Time, bool) {
	marker := `"time":"`
	index := strings.Index(line, marker)
	if index < 0 {
		return time.Time{}, false
	}
	rest := line[index+len(marker):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return time.Time{}, false
	}
	value := rest[:end]
	if at, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return at.UTC(), true
	}
	if at, err := time.Parse(time.RFC3339, value); err == nil {
		return at.UTC(), true
	}
	return time.Time{}, false
}

// StartAlarmHistoryPrune chạy vòng cắt nhật ký mỗi 6 giờ.
func (a *App) StartAlarmHistoryPrune(ctx context.Context) {
	if a == nil || a.alarmHistory == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		if err := a.alarmHistory.Prune(time.Now().UTC()); err != nil {
			a.logger.Printf("WARN alarm_history prune err=%v", err)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := a.alarmHistory.Prune(time.Now().UTC()); err != nil {
					a.logger.Printf("WARN alarm_history prune err=%v", err)
				}
			}
		}
	}()
}
