package app

// POST /api/v1/schedules/{id}/simulate — SCHD-133.
//
// Mô phỏng chạy bằng ĐÚNG engine đánh giá của controller, gọi qua binary
// `mkddc-schedule-sim`. Đây là yêu cầu PM/CTO đặt ra khi duyệt Plan 50, không
// phải lựa chọn kỹ thuật tuỳ ý: cài lại thuật toán trong Go sẽ đúng cho tới
// ngày hai bản lệch nhau, và ngày đó không ai biết — người dùng chỉ thấy "mô
// phỏng bảo BẬT mà thiết bị vẫn tắt".
//
// Hệ quả: thiếu binary thì trả 503 kèm lời giải thích, TUYỆT ĐỐI không rơi về
// một bản tính toán trong Go.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const scheduleSimTimeout = 10 * time.Second

// scheduleSimBinary tìm mkddc-schedule-sim: biến môi trường trước, rồi PATH,
// rồi cạnh chính binary web-api (bố cục cài đặt trên bo).
func scheduleSimBinary() (string, error) {
	if p := os.Getenv("MKDDC_SCHEDULE_SIM"); p != "" {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		return "", fmt.Errorf("MKDDC_SCHEDULE_SIM trỏ tới %s nhưng không có tệp ở đó", p)
	}
	if p, err := exec.LookPath("mkddc-schedule-sim"); err == nil {
		return p, nil
	}
	if self, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(self), "mkddc-schedule-sim")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("không tìm thấy mkddc-schedule-sim")
}

type scheduleSimOutput struct {
	Transitions []scheduleSimTransitionRaw  `json:"transitions"`
	Gaps        []ScheduleSimulateGap       `json:"gaps"`
	Conflicts   []ScheduleValidationFinding `json:"conflicts"`
}

type scheduleSimTransitionRaw struct {
	At                 string   `json:"at"`
	Source             string   `json:"source"`
	SourceExceptionID  *string  `json:"source_exception_id"`
	Value              float64  `json:"value"`
	TargetIDs          []string `json:"target_ids"`
	PriorityForWriting int      `json:"priority_for_writing"`
}

func (a *App) handleSimulateSchedule(w http.ResponseWriter, r *http.Request) {
	var req ScheduleSimulateRequest
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	_, obj, ok := a.mustLoadSchedule(w, r)
	if !ok {
		return
	}

	days := 0
	switch req.Range {
	case "7_DAYS":
		days = 7
	case "30_DAYS":
		days = 30
	case "SPECIFIC_DAY":
		days = 1
	default:
		writeError(w, http.StatusBadRequest, "range phải là 7_DAYS, 30_DAYS hoặc SPECIFIC_DAY")
		return
	}

	start := req.StartDate
	if start == "" {
		loc, err := time.LoadLocation(obj.Timezone)
		if err != nil {
			loc = time.UTC
		}
		start = time.Now().In(loc).Format("2006-01-02")
	}
	if !scheduleDateRe.MatchString(start) {
		writeError(w, http.StatusBadRequest, "start_date phải là YYYY-MM-DD")
		return
	}

	bin, err := scheduleSimBinary()
	if err != nil {
		// Nói thật thay vì tự tính trong Go. Một con số sai ở đây dẫn tới một
		// lịch sai được publish xuống thiết bị thật.
		writeError(w, http.StatusServiceUnavailable,
			fmt.Sprintf("không mô phỏng được: %s. Mô phỏng phải dùng chung engine "+
				"đánh giá với controller nên backend không tự tính thay.", err.Error()))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), scheduleSimTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin,
		"--config", a.schedulePath(),
		"--schedule", obj.ScheduleID,
		"--start", start,
		"--days", strconv.Itoa(days),
		"--step-sec", "60",
	)
	stdout, err := cmd.Output()
	if err != nil {
		detail := err.Error()
		var exitErr *exec.ExitError
		if ok := asExitError(err, &exitErr); ok && len(exitErr.Stderr) > 0 {
			detail = strings.TrimSpace(string(exitErr.Stderr))
		}
		writeError(w, http.StatusInternalServerError, "mô phỏng thất bại: "+detail)
		return
	}

	var raw scheduleSimOutput
	if err := json.Unmarshal(stdout, &raw); err != nil {
		writeError(w, http.StatusInternalServerError, "không đọc được kết quả mô phỏng: "+err.Error())
		return
	}

	result := ScheduleSimulateResult{
		Transitions: make([]ScheduleSimulateTransition, 0, len(raw.Transitions)),
		Conflicts:   raw.Conflicts,
		Gaps:        raw.Gaps,
	}
	if result.Conflicts == nil {
		result.Conflicts = []ScheduleValidationFinding{}
	}
	if result.Gaps == nil {
		result.Gaps = []ScheduleSimulateGap{}
	}
	for _, t := range raw.Transitions {
		result.Transitions = append(result.Transitions, ScheduleSimulateTransition{
			At:                 t.At,
			Source:             t.Source,
			SourceExceptionID:  t.SourceExceptionID,
			Value:              decodeScheduleValue(t.Value, obj.ValueType),
			TargetIDs:          t.TargetIDs,
			PriorityForWriting: t.PriorityForWriting,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

func asExitError(err error, out **exec.ExitError) bool {
	if e, ok := err.(*exec.ExitError); ok {
		*out = e
		return true
	}
	return false
}
