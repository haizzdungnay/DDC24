package app

// POST /api/v1/alarm-settings/simulate — `T57-2.13` (`ADR-048`, thi hành `ADR-035`).
//
// VÌ SAO ĐÂY CHỈ LÀ MỘT CÁI VỎ
//
// Ngữ nghĩa luật cảnh báo — thứ tự HH/H/L/LL, vùng trễ, trễ kích hoạt, cách
// chọn mức nghiêm trọng theo luật — nằm ở Core
// (`apps/core/domain/alarm/alarm_primitives.hpp`). Viết lại nó trong Go để mô
// phỏng sẽ đúng cho tới ngày hai bản lệch nhau, và ngày đó không ai biết:
// người dùng chỉ thấy "mô phỏng bảo sẽ báo động mà thiết bị thì không".
//
// Đây chính là nguyên tắc PM/CTO đã ràng buộc cho Scheduler ở Plan 50/`ADR-023`
// và đã hiện thực bằng `mkddc-schedule-sim`. Cảnh báo đi cùng đường: binary
// `mkddc-alarm-sim`. Thiếu binary ⇒ **503 nói rõ thiếu gì**, tuyệt đối không
// rơi về một bản tính xấp xỉ — một bản gần đúng sẽ được tin như bản thật đúng
// lúc người dùng đang đặt ngưỡng an toàn.

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	alarmSimTimeout    = 10 * time.Second
	alarmSimMaxSamples = 1000
)

// AlarmSimulateRequest — bản nháp luật cộng chuỗi mẫu để thử.
type AlarmSimulateRequest struct {
	Setting AlarmSetting        `json:"setting"`
	Samples []AlarmSimSampleDTO `json:"samples"`
}

type AlarmSimSampleDTO struct {
	// T là mốc thời gian ISO-8601. Mô phỏng luật có TRỄ KÍCH HOẠT nên khoảng
	// cách giữa các mẫu là dữ liệu, không phải trang trí.
	T     string  `json:"t"`
	Value float64 `json:"value"`
}

type AlarmSimEvent struct {
	At       string  `json:"at"`
	Event    string  `json:"event"`
	Severity string  `json:"severity,omitempty"`
	Value    float64 `json:"value"`
	Reason   string  `json:"reason,omitempty"`
}

type AlarmSimulateResult struct {
	SchemaVersion int             `json:"schemaVersion"`
	Events        []AlarmSimEvent `json:"events"`
	Engine        string          `json:"engine"`
}

// alarmSimBinary tìm `mkddc-alarm-sim` theo cùng thứ tự với
// `scheduleSimBinary`: biến môi trường, PATH, rồi cạnh chính binary web-api.
func alarmSimBinary() (string, error) {
	if path := os.Getenv("MKDDC_ALARM_SIM"); path != "" {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
		// Nêu CẢ tên binary lẫn biến môi trường: người đọc thông điệp này là kỹ
		// thuật viên đang tìm xem thiếu gói nào, và tên gói là thứ họ tra.
		return "", fmt.Errorf("không tìm thấy mkddc-alarm-sim: MKDDC_ALARM_SIM trỏ tới %s nhưng không có tệp ở đó", path)
	}
	if path, err := exec.LookPath("mkddc-alarm-sim"); err == nil {
		return path, nil
	}
	if self, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(self), "mkddc-alarm-sim")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("không tìm thấy mkddc-alarm-sim")
}

func (a *App) handleSimulateAlarmSetting(w http.ResponseWriter, r *http.Request) {
	var req AlarmSimulateRequest
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Samples) == 0 {
		writeError(w, http.StatusBadRequest, "cần ít nhất một mẫu để mô phỏng")
		return
	}
	if len(req.Samples) > alarmSimMaxSamples {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("tối đa %d mẫu mỗi lần gọi", alarmSimMaxSamples))
		return
	}

	bin, err := alarmSimBinary()
	if err != nil {
		// `ADR-048` điều 1. Câu chữ phải nói rõ THIẾU GÌ, vì người đọc là kỹ
		// thuật viên đứng trước một thiết bị chưa cài đủ gói.
		writeError(w, http.StatusServiceUnavailable,
			fmt.Sprintf("không mô phỏng được: %s. Ngữ nghĩa luật cảnh báo thuộc Core, "+
				"nên backend không tự tính thay — kể cả gần đúng.", err.Error()))
		return
	}

	events, err := runAlarmSim(r.Context(), bin, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "mô phỏng thất bại: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, AlarmSimulateResult{SchemaVersion: 1, Events: events, Engine: filepath.Base(bin)})
}

// runAlarmSimProcess là ĐƯỜNG DUY NHẤT tới binary engine.
//
// `T57-2.13` (mô phỏng theo chuỗi gõ tay) và `T57-3.13` (ước lượng theo lịch sử)
// dùng chung hàm này. Hai đường gọi riêng là hai cơ hội để cờ dòng lệnh, timeout
// hay cách đọc lỗi trôi khỏi nhau — và khi trôi thì hai màn hình sẽ nói hai điều
// khác nhau về cùng một luật.
func runAlarmSimProcess(ctx context.Context, bin string, payload []byte) ([]byte, error) {
	runCtx, cancel := context.WithTimeout(ctx, alarmSimTimeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, bin, "--stdin-json")
	cmd.Stdin = strings.NewReader(string(payload))
	stdout, err := cmd.Output()
	if err != nil {
		detail := err.Error()
		var exitErr *exec.ExitError
		if ok := asExitError(err, &exitErr); ok && len(exitErr.Stderr) > 0 {
			detail = strings.TrimSpace(string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("%s", detail)
	}
	return stdout, nil
}
