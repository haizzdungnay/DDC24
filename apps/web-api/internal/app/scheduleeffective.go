package app

// GET /api/v1/schedules/effective — `T57-3.5` và `T57-3.6` (`ADR-045`, thi hành `ADR-038`).
//
// CÂU HỎI ĐANG TRẢ LỜI
//
// "Điểm này, trong khoảng thời gian này, thực tế bị lịch nào điều khiển?" Khi
// ba lịch cùng chạm một điểm, giao diện hiện tại chỉ nói được từng lịch NÓI GÌ,
// không nói được lịch nào THẮNG. Người vận hành phải tự phân xử priority 1..16
// trong đầu — và họ sẽ sai đúng vào ca trực mà các lịch chồng nhau.
//
// VÌ SAO CHỈ LÀ VỎ
//
// `schedule_runtime.hpp` ghi rõ `evaluate_schedule` là hàm mà "backend gọi
// CHÍNH hàm này qua vỏ C; cấm cài lại thuật toán ở nơi khác". Bản hợp nhất
// nhiều lịch trên một point dùng chế độ `--point` của cùng binary, dùng lại
// phân xử `priority_for_writing` của `ScheduleRuntime`.
//
// CẢNH BÁO XUNG ĐỘT KHI SOẠN (`T57-3.6`) dùng CHÍNH dữ liệu này, chỉ khác cách
// trình bày: mở endpoint thứ hai cho cùng một câu hỏi là tự tạo hai đường sẽ
// trôi khỏi nhau.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

const scheduleEffectiveMaxRange = 7 * 24 * time.Hour

type ScheduleEffectiveSegment struct {
	From string `json:"from"`
	To   string `json:"to"`
	// Value là giá trị đang có hiệu lực; `null` = không lịch nào ghi trong đoạn.
	Value any `json:"value"`
	// ScheduleID rỗng nghĩa là khoảng KHÔNG có lịch nào — đó là một câu trả lời
	// hợp lệ và phải phân biệt được với "chưa tính được".
	ScheduleID   string `json:"scheduleId,omitempty"`
	ScheduleName string `json:"scheduleName,omitempty"`
	Priority     int    `json:"priority,omitempty"`
	// Reason nói VÌ SAO lịch này thắng, ví dụ "priority 8 < 12".
	Reason string `json:"reason,omitempty"`
}

type ScheduleEffectiveConflict struct {
	At          string   `json:"at"`
	ScheduleIDs []string `json:"scheduleIds"`
	WinnerID    string   `json:"winnerId"`
	Detail      string   `json:"detail,omitempty"`
}

type ScheduleEffectiveResponse struct {
	SchemaVersion int                         `json:"schemaVersion"`
	PointID       string                      `json:"pointId"`
	From          string                      `json:"from"`
	To            string                      `json:"to"`
	Segments      []ScheduleEffectiveSegment  `json:"segments"`
	Conflicts     []ScheduleEffectiveConflict `json:"conflicts"`
	Engine        string                      `json:"engine"`
}

func (a *App) handleScheduleEffective(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	pointID := strings.TrimSpace(query.Get("pointId"))
	if pointID == "" {
		writeError(w, http.StatusBadRequest, "pointId là bắt buộc")
		return
	}

	now := time.Now().UTC()
	from, err := parseEffectiveBound(query.Get("from"), now)
	if err != nil {
		writeError(w, http.StatusBadRequest, "from: "+err.Error())
		return
	}
	to, err := parseEffectiveBound(query.Get("to"), now.Add(24*time.Hour))
	if err != nil {
		writeError(w, http.StatusBadRequest, "to: "+err.Error())
		return
	}
	if !to.After(from) {
		writeError(w, http.StatusBadRequest, "to phải sau from")
		return
	}
	// `ADR-045` điều 3: dài hơn thì từ chối, KHÔNG cắt im lặng — người dùng hỏi
	// 30 ngày mà nhận 7 ngày sẽ đọc kết quả như thể đó là 30 ngày.
	if to.Sub(from) > scheduleEffectiveMaxRange {
		writeError(w, http.StatusBadRequest, "khoảng hỏi tối đa 7 ngày")
		return
	}

	bin, err := scheduleSimBinary()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable,
			fmt.Sprintf("không tính được hiệu lực thực tế: %s. Ngữ nghĩa lịch thuộc Core "+
				"nên backend không tự tính thay.", err.Error()))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), scheduleSimTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin,
		"--config", a.schedulePath(),
		"--point", pointID,
		"--from", from.Format(time.RFC3339),
		"--to", to.Format(time.RFC3339),
		"--step-sec", "60",
	)
	stdout, err := cmd.Output()
	if err != nil {
		detail := err.Error()
		var exitErr *exec.ExitError
		if ok := asExitError(err, &exitErr); ok && len(exitErr.Stderr) > 0 {
			detail = strings.TrimSpace(string(exitErr.Stderr))
		}
		writeError(w, http.StatusInternalServerError, "tính hiệu lực thực tế thất bại: "+detail)
		return
	}

	var raw struct {
		Segments  []ScheduleEffectiveSegment  `json:"segments"`
		Conflicts []ScheduleEffectiveConflict `json:"conflicts"`
	}
	if err := json.Unmarshal(stdout, &raw); err != nil {
		writeError(w, http.StatusInternalServerError, "không đọc được kết quả: "+err.Error())
		return
	}
	if raw.Segments == nil {
		raw.Segments = []ScheduleEffectiveSegment{}
	}
	if raw.Conflicts == nil {
		raw.Conflicts = []ScheduleEffectiveConflict{}
	}

	writeJSON(w, http.StatusOK, ScheduleEffectiveResponse{
		SchemaVersion: 1,
		PointID:       pointID,
		From:          from.Format(time.RFC3339),
		To:            to.Format(time.RFC3339),
		Segments:      raw.Segments,
		Conflicts:     raw.Conflicts,
		Engine:        "mkddc-schedule-sim --point",
	})
}

func parseEffectiveBound(raw string, fallback time.Time) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, nil
	}
	instant, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("phải là mốc ISO-8601 (RFC3339)")
	}
	return instant.UTC(), nil
}
