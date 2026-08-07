package app

// Di trú schedule.conf từ định dạng cũ sang Schedule Object v3.1
// (ADR-023 QĐ-6, Plan 50 SCHD-141..143).
//
// Bo lab và mọi bo đã giao đang chạy định dạng cũ. Áp định dạng mới đè lên là
// mất toàn bộ cấu hình đang vận hành — loại sự cố khách hàng nhớ rất lâu. Nên:
// nhận diện định dạng khi nạp, chuyển đổi một chiều, GIỮ bản cũ thành .bak, và
// đánh cờ migrated_from_v1 để giao diện bắt người dùng review trước khi publish.

import (
	"encoding/json"
	"fmt"
	"strings"
)

// scheduleRowV1 là hình dạng cũ: một khoảng giờ, một giá trị, một target.
type scheduleRowV1 struct {
	ID           string            `json:"id"`
	Label        string            `json:"label"`
	Notes        string            `json:"notes,omitempty"`
	Enabled      bool              `json:"enabled"`
	ScheduleType string            `json:"scheduleType"`
	TimeOfDay    string            `json:"timeOfDay,omitempty"`
	StartTime    string            `json:"startTime,omitempty"`
	EndTime      string            `json:"endTime,omitempty"`
	StartDate    string            `json:"startDate,omitempty"`
	EndDate      string            `json:"endDate,omitempty"`
	Weekdays     []string          `json:"weekdays"`
	Target       *scheduleTargetV1 `json:"target,omitempty"`
	Value        *float64          `json:"value,omitempty"`
}

type scheduleTargetV1 struct {
	Kind    string `json:"kind"`
	Channel *int   `json:"channel,omitempty"`
	PointID string `json:"pointId,omitempty"`
}

var scheduleV1WeekdayKey = map[string]string{
	"monday": "MON", "tuesday": "TUE", "wednesday": "WED", "thursday": "THU",
	"friday": "FRI", "saturday": "SAT", "sunday": "SUN",
}

// isScheduleV1Payload nhận diện định dạng cũ. Bản v3.1 luôn có schema_version;
// bản cũ luôn có scheduleType. Không đoán theo cảm tính.
func isScheduleV1Payload(data []byte) bool {
	var probe []map[string]json.RawMessage
	if err := json.Unmarshal(data, &probe); err != nil {
		return false
	}
	for _, row := range probe {
		if _, ok := row["schema_version"]; ok {
			return false
		}
		if _, ok := row["scheduleType"]; ok {
			return true
		}
	}
	return false
}

// migrateSchedulesV1 chuyển cả tập sang v3.1.
//
// Quy tắc chuyển một hàng có giờ:
//
//	startTime=08:00 endTime=17:00 value=1 weekdays=[MON..FRI] target=DO-01
//	  → weekly_schedule.MON..FRI = [ {08:00:00, giá trị}, {17:00:00, mặc định} ]
//
// Mốc thứ hai KHÔNG phải trang trí: mô hình cũ ngầm định "hết giờ thì thôi tác
// động", mô hình mới phải nói ra bằng một mốc trả về mặc định, nếu không giá
// trị sẽ dính lại qua đêm.
//
// `holiday_period` cũ tắt TOÀN CỤC mọi lịch. Để giữ đúng hành vi người dùng
// đang thấy, mỗi khoảng lễ trở thành một exception event_priority = 1 gắn vào
// MỌI lịch đang bật.
func migrateSchedulesV1(data []byte, now string) ([]ScheduleObject, []string, error) {
	var rows []scheduleRowV1
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, nil, fmt.Errorf("đọc schedule.conf định dạng cũ: %w", err)
	}

	var out []ScheduleObject
	var notes []string
	var holidays []scheduleRowV1

	for _, row := range rows {
		switch row.ScheduleType {
		case "holiday_period":
			holidays = append(holidays, row)
			continue
		case "not_active":
			notes = append(notes, fmt.Sprintf(
				"%s là hàng not_active của định dạng cũ — đã chuyển thành lịch DRAFT đang tắt", row.ID))
		}
		obj, note := migrateScheduleRowV1(row, now)
		if note != "" {
			notes = append(notes, note)
		}
		out = append(out, obj)
	}

	if len(holidays) > 0 {
		exceptions := make([]ScheduleException, 0, len(holidays))
		for i, h := range holidays {
			start, end := scheduleV1HolidayRange(h, scheduleMigrationYear(now))
			if start == "" || end == "" {
				notes = append(notes, fmt.Sprintf("%s có ngày lễ không đọc được, đã bỏ qua", h.ID))
				continue
			}
			exceptions = append(exceptions, ScheduleException{
				ExceptionID:   fmt.Sprintf("EXC-HOLIDAY-%03d", i+1),
				Name:          firstNonEmptyScheduleField(h.Label, h.ID),
				DateRule:      ScheduleDateRule{Type: "DATE_RANGE", StartDate: start, EndDate: end},
				EventPriority: 1,
			})
		}
		for i := range out {
			for _, ex := range exceptions {
				copyEx := ex
				// Ngoại lệ ghi giá trị mặc định của chính lịch đó — tương đương
				// hành vi "ngừng tác động" của holiday_period cũ.
				copyEx.TimeValues = []ScheduleTimeValue{{Time: "00:00:00", Value: out[i].ScheduleDefault.Value}}
				out[i].ExceptionSchedule = append(out[i].ExceptionSchedule, copyEx)
			}
		}
		if len(exceptions) > 0 {
			notes = append(notes, fmt.Sprintf(
				"%d khoảng ngày lễ của định dạng cũ đã thành ngoại lệ event_priority=1 trên %d lịch; "+
					"trước đây chúng tắt TOÀN BỘ hệ thống lịch, nay chỉ ghi đè từng lịch",
				len(exceptions), len(out)))
		}
	}

	if len(out) > 0 {
		// R-01-B: khác biệt ngữ nghĩa quan trọng nhất của đợt di trú, và nó
		// KHÔNG nhìn thấy được khi chỉ so cấu hình trước/sau.
		//
		// Mô hình cũ NHẢ QUYỀN ngoài khoảng giờ (release_ao/release_do), nên
		// mức 4 tắt và logic nội bộ mức 5 điều khiển được điểm đó. Mô hình v3.1
		// luôn ghi một giá trị — weekly hoặc schedule_default — nên mức 4 GIỮ
		// điểm suốt ngày và chặn mức 5.
		//
		// Đặc tả §10.1 bước 6 cố ý như vậy, nên đây không phải lỗi. Nhưng nếu
		// một điểm đang được cả lịch lẫn logic ST điều khiển thì hành vi sau
		// nâng cấp SẼ KHÁC. Người dùng phải biết trước khi bật lại lịch.
		notes = append(notes, "LƯU Ý HÀNH VI: mô hình cũ nhả quyền điều khiển ngoài "+
			"khoảng giờ, mô hình v3.1 giữ điểm ở giá trị mặc định suốt ngày. Điểm nào "+
			"đang được cả lịch lẫn logic nội bộ điều khiển sẽ đổi hành vi sau khi bật "+
			"lại lịch. Mọi lịch đang TẮT nên chưa có gì thay đổi cho tới khi bạn bật.")
	}
	return out, notes, nil
}

func migrateScheduleRowV1(row scheduleRowV1, now string) (ScheduleObject, string) {
	valueType, defaultValue := scheduleV1ValueType(row.ScheduleType)
	obj := ScheduleObject{
		SchemaVersion: scheduleSchemaVersion,
		ScheduleID:    normalizeScheduleID(row.ID),
		ScheduleName:  firstNonEmptyScheduleField(row.Label, row.ID),
		Description:   row.Notes,
		// Bắt buộc review trước khi chạy lại: chuyển đổi tự động không phải là
		// lý do để bỏ qua mắt người.
		Enabled:            false,
		Status:             scheduleStatusDraft,
		Timezone:           "Asia/Ho_Chi_Minh",
		EffectivePeriod:    ScheduleEffectivePeriod{},
		ValueType:          valueType,
		PriorityForWriting: 16,
		CorePriorityLevel:  scheduleCorePriorityLevel,
		ScheduleDefault:    ScheduleValue{Value: defaultValue},
		WeeklySchedule:     ScheduleWeekly{},
		ExceptionSchedule:  []ScheduleException{},
		TargetObjects:      []ScheduleTargetObject{},
		Revision:           1,
		MigratedFromV1:     true,
		CreatedAt:          now,
		CreatedBy:          "migration",
		UpdatedAt:          now,
		UpdatedBy:          "migration",
	}
	emptyScheduleWeek(&obj.WeeklySchedule)

	var note string
	start := firstNonEmptyScheduleField(row.StartTime, row.TimeOfDay)
	if start != "" && row.EndTime != "" && row.Value != nil {
		onValue := scheduleV1Value(valueType, *row.Value)
		events := []ScheduleTimeValue{
			{Time: start + ":00", Value: onValue},
			{Time: row.EndTime + ":00", Value: defaultValue},
		}
		for _, wd := range row.Weekdays {
			key, ok := scheduleV1WeekdayKey[strings.ToLower(wd)]
			if !ok {
				continue
			}
			setScheduleDay(&obj.WeeklySchedule, key, events)
		}
	}

	if row.Target != nil && row.Target.Channel != nil {
		kind := scheduleV1TargetKind(row.Target.Kind)
		if kind == "" {
			note = fmt.Sprintf("%s có target kiểu %q không ánh xạ được, đã bỏ target",
				obj.ScheduleID, row.Target.Kind)
		} else {
			ch := *row.Target.Channel
			obj.TargetObjects = append(obj.TargetObjects, ScheduleTargetObject{
				TargetID:   "TGT-001",
				TargetType: "INTERNAL_POINT",
				PointKind:  kind,
				Channel:    &ch,
				PointID:    formatSchedulePointID(kind, ch),
			})
		}
	}
	return obj, note
}

// scheduleV1ValueType ánh xạ 7 scheduleType cũ sang value_type v3.1 và giá trị
// mặc định tương ứng.
func scheduleV1ValueType(scheduleType string) (string, any) {
	switch scheduleType {
	case "fan_state_value", "digital_output_value":
		return "BINARY", "INACTIVE"
	case "analog_output_value", "control_loop_setpoint":
		return "REAL", float64(0)
	case "controller_operation_mode":
		return "ENUMERATED", float64(0)
	}
	return "BINARY", "INACTIVE"
}

func scheduleV1Value(valueType string, raw float64) any {
	switch valueType {
	case "BINARY":
		if raw != 0 {
			return "ACTIVE"
		}
		return "INACTIVE"
	case "BOOLEAN":
		return raw != 0
	}
	return raw
}

// scheduleV1TargetKind: VP/AV của định dạng cũ là điểm ảo analog.
func scheduleV1TargetKind(kind string) string {
	switch strings.ToUpper(strings.TrimSpace(kind)) {
	case "AO":
		return "AO"
	case "DO":
		return "DO"
	case "VP", "AV":
		return "AV"
	case "BV":
		return "BV"
	case "MSV":
		return "MSV"
	}
	return ""
}

func scheduleV1HolidayRange(row scheduleRowV1, year string) (string, string) {
	// Định dạng cũ dùng MM-DD không có năm. Gắn năm hiện tại — người dùng phải
	// review nên đây là điểm xuất phát, không phải kết luận.
	if len(row.StartDate) != 5 || len(row.EndDate) != 5 {
		return "", ""
	}
	return year + "-" + row.StartDate, year + "-" + row.EndDate
}

// scheduleMigrationYear lấy năm từ mốc thời gian RFC3339 của lần di trú.
func scheduleMigrationYear(now string) string {
	if len(now) >= 4 {
		return now[:4]
	}
	return "2026"
}

func normalizeScheduleID(id string) string {
	id = strings.TrimSpace(id)
	if scheduleIDRe.MatchString(id) {
		return id
	}
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			return r
		}
		return '-'
	}, id)
	cleaned = strings.TrimPrefix(cleaned, "SCH-")
	if cleaned == "" {
		cleaned = "MIGRATED"
	}
	if len(cleaned) > 60 {
		cleaned = cleaned[:60]
	}
	return "SCH-" + cleaned
}

func emptyScheduleWeek(w *ScheduleWeekly) {
	for _, d := range w.Days() {
		*d.Events = []ScheduleTimeValue{}
	}
}

func setScheduleDay(w *ScheduleWeekly, key string, events []ScheduleTimeValue) {
	for _, d := range w.Days() {
		if d.Key == key {
			cloned := make([]ScheduleTimeValue, len(events))
			copy(cloned, events)
			*d.Events = cloned
			return
		}
	}
}

func firstNonEmptyScheduleField(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
