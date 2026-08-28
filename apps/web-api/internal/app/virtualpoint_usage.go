package app

import (
	"net/http"
	"strings"
)

// "Ai đang dùng điểm ảo này" — `T57-3.12` (Plan 57 §6.11-P2).
//
// VÌ SAO CẦN
//
// Xoá một điểm ảo hôm nay là một cú bấm không hậu quả nhìn thấy được. Hậu quả
// xuất hiện sau đó: một luật cảnh báo mất nguồn, một lịch vận hành mất đích
// ghi, một chương trình ST mất binding — và không ai nối được sự cố ngược lại
// với thao tác xoá vì giữa chúng có thể là vài ngày.
//
// Endpoint này trả lời câu hỏi đó TRƯỚC khi xoá. Nó **không** chặn xoá: quyết
// định vẫn thuộc về người vận hành, thứ họ thiếu chỉ là dữ kiện.
//
// NGUYÊN TẮC: chỉ liệt kê tham chiếu ĐỌC ĐƯỢC TỪ CẤU HÌNH THẬT. Không suy đoán
// theo tên, không "có thể liên quan" — một danh sách phỏng đoán sẽ khiến người
// dùng bỏ qua cả danh sách.

type VirtualPointReference struct {
	// Kind: `alarm` | `schedule` | `program`.
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
	// Detail nói rõ tham chiếu ở ĐÂU trong đối tượng đó.
	Detail string `json:"detail,omitempty"`
}

type VirtualPointUsageResponse struct {
	SchemaVersion int                     `json:"schemaVersion"`
	PointID       string                  `json:"pointId"`
	Tag           string                  `json:"tag,omitempty"`
	References    []VirtualPointReference `json:"references"`
	// Scanned nói ra PHẠM VI đã quét, để người đọc biết danh sách rỗng nghĩa là
	// gì. Thiếu điều này thì "không có tham chiếu" là một lời hứa không có cơ sở.
	Scanned []string `json:"scanned"`
	// Incomplete = có nguồn không đọc được. Danh sách khi đó là KHÔNG ĐẦY ĐỦ và
	// giao diện phải nói ra trước khi người dùng bấm xoá.
	Incomplete bool     `json:"incomplete"`
	Errors     []string `json:"errors,omitempty"`
}

func (a *App) handleVirtualPointUsage(w http.ResponseWriter, r *http.Request) {
	id := canonicalVirtualPointID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing virtual point id")
		return
	}

	response := VirtualPointUsageResponse{
		SchemaVersion: 1,
		PointID:       id,
		References:    []VirtualPointReference{},
		Scanned:       []string{"alarm-settings", "schedules"},
	}

	vpConfig, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err == nil {
		if index := virtualPointIndex(vpConfig.Items, id); index >= 0 {
			response.Tag = vpConfig.Items[index].Tag
		}
	}

	// Cảnh báo: một nguồn `VP` trỏ tới điểm này.
	if settings, err := a.LoadAlarmSettings(r.Context()); err != nil {
		response.Incomplete = true
		response.Errors = append(response.Errors, "alarm-settings: "+err.Error())
	} else {
		for _, setting := range settings {
			for _, source := range setting.Sources {
				if !matchesVirtualPoint(source.Kind, source.PointID, source.Channel, id, response.Tag) {
					continue
				}
				response.References = append(response.References, VirtualPointReference{
					Kind: "alarm", ID: setting.ID, Name: setting.Label,
					Detail: "nguồn kích hoạt",
				})
				break
			}
		}
	}

	// Lịch vận hành: một target trỏ tới điểm này.
	if schedules, _, err := a.loadSchedulesWithNotes(r.Context()); err != nil {
		response.Incomplete = true
		response.Errors = append(response.Errors, "schedules: "+err.Error())
	} else {
		for _, schedule := range schedules {
			for _, target := range schedule.TargetObjects {
				if !matchesVirtualPoint(target.PointKind, target.PointID, valueOrZero(target.Channel), id, response.Tag) {
					continue
				}
				response.References = append(response.References, VirtualPointReference{
					Kind: "schedule", ID: schedule.ScheduleID, Name: schedule.ScheduleName,
					Detail: "đối tượng đích",
				})
				break
			}
		}
	}

	writeJSON(w, http.StatusOK, response)
}

// matchesVirtualPoint so khớp một tham chiếu với điểm ảo đang hỏi.
//
// So theo cả `pointId` chuẩn hoá lẫn `tag`: hai cách viết cùng tồn tại trong
// cấu hình thật (nguồn cảnh báo dùng `pointId`, một số nơi khác ghi tag), và bỏ
// sót một cách viết nghĩa là báo "không ai dùng" cho một điểm đang được dùng —
// đúng kiểu sai nguy hiểm nhất của tính năng này.
func matchesVirtualPoint(kind, pointID string, channel int, wantID, wantTag string) bool {
	if !strings.EqualFold(strings.TrimSpace(kind), "VP") && !strings.EqualFold(strings.TrimSpace(kind), "virtual") {
		return false
	}
	if canonicalVirtualPointID(pointID) == wantID {
		return true
	}
	if wantTag != "" && strings.EqualFold(strings.TrimSpace(pointID), wantTag) {
		return true
	}
	if channel > 0 && formatVirtualPointID(channel) == wantID {
		return true
	}
	return false
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
