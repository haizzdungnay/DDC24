package app

// Validate Schedule Object v3.1.
//
// Mọi finding mang MÃ đặc tả §11 và JSON path, để giao diện bấm vào là nhảy tới
// đúng ô sai thay vì bắt người dùng đọc một bức tường chữ (nguyên tắc N4).

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

var (
	scheduleIDRe   = regexp.MustCompile(`^SCH-[A-Za-z0-9_-]{1,60}$`)
	exceptionIDRe  = regexp.MustCompile(`^EXC-[A-Za-z0-9_-]{1,60}$`)
	targetIDRe     = regexp.MustCompile(`^TGT-[A-Za-z0-9_-]{1,60}$`)
	calendarIDRe   = regexp.MustCompile(`^CAL-[A-Za-z0-9_-]{1,60}$`)
	holidayGroupRe = regexp.MustCompile(`^HG-[A-Za-z0-9_-]{1,60}$`)
	scheduleTimeRe = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$`)
	scheduleDateRe = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)
)

var scheduleValueTypes = map[string]bool{
	"BINARY": true, "BOOLEAN": true, "REAL": true, "UNSIGNED": true, "ENUMERATED": true,
}

// Trần kênh theo loại điểm, khớp contracts/shm/mkddc_shm.h:69-74.
var schedulePointKindLimits = map[string]int{
	"AO": 4, "DO": 4, "AV": 32, "BV": 16, "MSV": 8, "EXT": 256,
}

// Kiểu điểm nào chứa nổi kiểu giá trị nào (SCH-TARGET-003).
var allSchedulePointKinds = []string{"DO", "AO", "BV", "AV", "MSV", "EXT"}

var scheduleKindForValueType = map[string][]string{
	"BINARY":     allSchedulePointKinds,
	"BOOLEAN":    allSchedulePointKinds,
	"REAL":       allSchedulePointKinds,
	"UNSIGNED":   allSchedulePointKinds,
	"ENUMERATED": allSchedulePointKinds,
}

type scheduleFindings struct {
	items []ScheduleValidationFinding
}

func (f *scheduleFindings) add(code, path, message string) {
	f.items = append(f.items, ScheduleValidationFinding{
		Code: code, Path: path, Message: message, Severity: "error",
	})
}

func (f *scheduleFindings) warn(code, path, message string) {
	f.items = append(f.items, ScheduleValidationFinding{
		Code: code, Path: path, Message: message, Severity: "warning",
	})
}

// validateScheduleObject kiểm một Schedule Object độc lập, lấy "hôm nay" từ
// đồng hồ hệ thống. Dùng ở đường HTTP.
func validateScheduleObject(s *ScheduleObject) []ScheduleValidationFinding {
	return validateScheduleObjectAt(s, time.Now().UTC())
}

// validateScheduleObjectAt nhận mốc thời gian tường minh.
//
// P1-10: phát hiện xung đột ngoại lệ `WEEK_N_DAY` phải liệt kê ngày thật trong
// 12 tháng tới, nên nó phụ thuộc "hôm nay". Bản đầu gọi `time.Now()` ở tầng
// sâu, khiến cùng một cấu hình có thể cho kết quả validate khác nhau tuỳ thời
// điểm chạy — và test không thể khẳng định điều gì ổn định.
func validateScheduleObjectAt(s *ScheduleObject, now time.Time) []ScheduleValidationFinding {
	f := &scheduleFindings{}

	if s.SchemaVersion != scheduleSchemaVersion {
		f.add(errSchedBadWeekly, "$.schema_version",
			fmt.Sprintf("phải là %q, nhận %q", scheduleSchemaVersion, s.SchemaVersion))
	}
	if !scheduleIDRe.MatchString(s.ScheduleID) {
		f.add(errSchedBadWeekly, "$.schedule_id", "phải khớp ^SCH-[A-Za-z0-9_-]{1,60}$")
	}
	if strings.TrimSpace(s.ScheduleName) == "" {
		f.add(errSchedBadWeekly, "$.schedule_name", "bắt buộc")
	} else if len([]rune(s.ScheduleName)) > 64 {
		f.add(errSchedBadWeekly, "$.schedule_name", "tối đa 64 ký tự")
	}
	if !scheduleValueTypes[s.ValueType] {
		f.add(errSchedBadWeekly, "$.value_type",
			"phải là BINARY, BOOLEAN, REAL, UNSIGNED hoặc ENUMERATED")
		// Không kiểm tiếp được khi chưa biết kiểu giá trị.
		return f.items
	}
	if s.PriorityForWriting < 1 || s.PriorityForWriting > 16 {
		f.add(errSchedBadWeekly, "$.priority_for_writing", "phải trong khoảng 1..16")
	}
	if strings.TrimSpace(s.Timezone) == "" {
		f.add(errSchedBadTimezone, "$.timezone", "bắt buộc")
	} else if _, err := time.LoadLocation(s.Timezone); err != nil {
		f.add(errSchedBadTimezone, "$.timezone",
			fmt.Sprintf("không phải tên IANA hợp lệ: %s", s.Timezone))
	}

	validateScheduleDefault(f, s)
	validateScheduleEffectivePeriod(f, s)
	validateScheduleWeekly(f, s)
	validateScheduleExceptions(f, s, now)
	validateScheduleTargets(f, s)

	return f.items
}

func validateScheduleDefault(f *scheduleFindings, s *ScheduleObject) {
	// Thiếu schedule_default là SCH-CONFIG-001. Không có nó thì runtime không
	// biết ghi gì khi không event nào hiệu lực.
	if s.ScheduleDefault.Value == nil {
		f.add(errSchedMissingDefault, "$.schedule_default.value",
			"bắt buộc — đây là giá trị khi không event nào hiệu lực")
		return
	}
	if !scheduleValueMatchesType(s.ScheduleDefault.Value, s.ValueType) {
		f.add(errSchedBadWeekly, "$.schedule_default.value",
			scheduleValueTypeHint(s.ValueType))
	}
}

func validateScheduleEffectivePeriod(f *scheduleFindings, s *ScheduleObject) {
	start := s.EffectivePeriod.StartDate
	end := s.EffectivePeriod.EndDate
	if start != nil && !scheduleDateRe.MatchString(*start) {
		f.add(errSchedBadWeekly, "$.effective_period.start_date", "phải là YYYY-MM-DD")
	}
	if end != nil && !scheduleDateRe.MatchString(*end) {
		f.add(errSchedBadWeekly, "$.effective_period.end_date",
			"phải là YYYY-MM-DD, hoặc null nếu không có ngày kết thúc")
	}
	if start != nil && end != nil &&
		scheduleDateRe.MatchString(*start) && scheduleDateRe.MatchString(*end) && *end < *start {
		f.add(errSchedBadWeekly, "$.effective_period.end_date",
			"ngày kết thúc phải sau hoặc bằng ngày bắt đầu")
	}
}

func validateScheduleWeekly(f *scheduleFindings, s *ScheduleObject) {
	for _, day := range s.WeeklySchedule.Days() {
		path := "$.weekly_schedule." + day.Key
		events := *day.Events
		if len(events) > maxScheduleDayEvents {
			f.add(errSchedBadWeekly, path,
				fmt.Sprintf("tối đa %d mốc trong một ngày", maxScheduleDayEvents))
		}
		validateScheduleTimeValues(f, path, events, s.ValueType)
	}
}

func validateScheduleTimeValues(f *scheduleFindings, base string, events []ScheduleTimeValue, valueType string) {
	seen := make(map[string]int, len(events))
	for i, ev := range events {
		path := fmt.Sprintf("%s[%d]", base, i)
		if !scheduleTimeRe.MatchString(ev.Time) {
			f.add(errSchedBadWeekly, path+".time", "phải là HH:mm:ss")
		} else if first, dup := seen[ev.Time]; dup {
			// Hai event cùng thời điểm không phải thứ để đoán ý người dùng.
			f.add(errSchedBadWeekly, path+".time",
				fmt.Sprintf("trùng thời điểm với [%d]; một thời điểm chỉ được có một giá trị", first))
		} else {
			seen[ev.Time] = i
		}
		if !scheduleValueMatchesType(ev.Value, valueType) {
			f.add(errSchedBadWeekly, path+".value", scheduleValueTypeHint(valueType))
		}
	}
}

func validateScheduleExceptions(f *scheduleFindings, s *ScheduleObject, now time.Time) {
	if len(s.ExceptionSchedule) > maxScheduleExceptions {
		f.add(errSchedExceptionConflit, "$.exception_schedule",
			fmt.Sprintf("tối đa %d ngoại lệ", maxScheduleExceptions))
	}
	seenID := make(map[string]int, len(s.ExceptionSchedule))
	for i, ex := range s.ExceptionSchedule {
		base := fmt.Sprintf("$.exception_schedule[%d]", i)
		if !exceptionIDRe.MatchString(ex.ExceptionID) {
			f.add(errSchedExceptionConflit, base+".exception_id",
				"phải khớp ^EXC-[A-Za-z0-9_-]{1,60}$")
		} else if first, dup := seenID[ex.ExceptionID]; dup {
			f.add(errSchedExceptionConflit, base+".exception_id",
				fmt.Sprintf("trùng với [%d]", first))
		} else {
			seenID[ex.ExceptionID] = i
		}
		if strings.TrimSpace(ex.Name) == "" {
			f.add(errSchedExceptionConflit, base+".name", "bắt buộc")
		}
		if ex.EventPriority < 1 || ex.EventPriority > 16 {
			f.add(errSchedExceptionConflit, base+".event_priority", "phải trong khoảng 1..16")
		}
		if len(ex.TimeValues) == 0 {
			f.add(errSchedExceptionConflit, base+".time_values", "phải có ít nhất một mốc")
		}
		validateScheduleTimeValues(f, base+".time_values", ex.TimeValues, s.ValueType)
		validateScheduleDateRule(f, base+".date_rule", ex.DateRule)
	}
	detectScheduleExceptionConflicts(f, s, now)
}

func validateScheduleDateRule(f *scheduleFindings, base string, rule ScheduleDateRule) {
	switch rule.Type {
	case "DATE":
		if !scheduleDateRe.MatchString(rule.Date) {
			f.add(errSchedExceptionConflit, base+".date", "phải là YYYY-MM-DD")
		}
	case "DATE_RANGE":
		if !scheduleDateRe.MatchString(rule.StartDate) {
			f.add(errSchedExceptionConflit, base+".start_date", "phải là YYYY-MM-DD")
		}
		if !scheduleDateRe.MatchString(rule.EndDate) {
			f.add(errSchedExceptionConflit, base+".end_date", "phải là YYYY-MM-DD")
		}
		if scheduleDateRe.MatchString(rule.StartDate) && scheduleDateRe.MatchString(rule.EndDate) &&
			rule.EndDate < rule.StartDate {
			f.add(errSchedExceptionConflit, base+".end_date", "phải sau hoặc bằng start_date")
		}
	case "WEEK_N_DAY":
		if rule.Month == nil || *rule.Month < 0 || *rule.Month > 12 {
			f.add(errSchedExceptionConflit, base+".month", "0 = mọi tháng, hoặc 1..12")
		}
		if rule.WeekOfMonth == nil || *rule.WeekOfMonth < 1 || *rule.WeekOfMonth > 6 {
			f.add(errSchedExceptionConflit, base+".week_of_month",
				"1..5 = tuần thứ N, 6 = tuần cuối cùng (quy ước BACnet)")
		}
		if rule.DayOfWeek == nil || *rule.DayOfWeek < 1 || *rule.DayOfWeek > 7 {
			f.add(errSchedExceptionConflit, base+".day_of_week", "1 = Thứ Hai … 7 = Chủ nhật")
		}
	case "CALENDAR_REFERENCE":
		if !calendarIDRe.MatchString(rule.CalendarID) {
			f.add(errSchedExceptionConflit, base+".calendar_id", "phải khớp ^CAL-[A-Za-z0-9_-]{1,60}$")
		}
	case "HOLIDAY_GROUP":
		if !holidayGroupRe.MatchString(rule.GroupID) {
			f.add(errSchedExceptionConflit, base+".group_id", "phải khớp ^HG-[A-Za-z0-9_-]{1,60}$")
		}
	default:
		f.add(errSchedExceptionConflit, base+".type",
			"phải là DATE, DATE_RANGE, WEEK_N_DAY, CALENDAR_REFERENCE hoặc HOLIDAY_GROUP")
	}
}

// detectScheduleExceptionConflicts bắt trường hợp hai ngoại lệ chắc chắn cùng
// rơi vào một ngày và cùng event_priority. Đặc tả §7.3 nói rõ: hệ thống KHÔNG
// tự chọn — phải báo để người dùng quyết.
//
// Chỉ so được các quy tắc suy ra ngày trực tiếp (DATE, DATE_RANGE, WEEK_N_DAY).
// CALENDAR_REFERENCE và HOLIDAY_GROUP phụ thuộc dữ liệu ngoài nên runtime phát
// hiện, không phải lớp validate này.
func detectScheduleExceptionConflicts(f *scheduleFindings, s *ScheduleObject, now time.Time) {
	for i := 0; i < len(s.ExceptionSchedule); i++ {
		for j := i + 1; j < len(s.ExceptionSchedule); j++ {
			a, b := s.ExceptionSchedule[i], s.ExceptionSchedule[j]
			if a.EventPriority != b.EventPriority {
				continue
			}
			if day, overlap := scheduleRulesOverlap(a.DateRule, b.DateRule, now); overlap {
				f.add(errSchedExceptionConflit,
					fmt.Sprintf("$.exception_schedule[%d].event_priority", j),
					fmt.Sprintf("%s và %s cùng rơi vào %s và cùng event_priority = %d; "+
						"hệ thống không tự chọn, hãy đổi priority một trong hai",
						a.ExceptionID, b.ExceptionID, day, a.EventPriority))
			}
		}
	}
}

func scheduleRulesOverlap(a, b ScheduleDateRule, now time.Time) (string, bool) {
	da, oka := scheduleRuleDatesFrom(a, now)
	db, okb := scheduleRuleDatesFrom(b, now)
	if !oka || !okb {
		return "", false
	}
	set := make(map[string]bool, len(da))
	for _, d := range da {
		set[d] = true
	}
	for _, d := range db {
		if set[d] {
			return d, true
		}
	}
	return "", false
}

func scheduleRuleDatesFrom(rule ScheduleDateRule, from time.Time) ([]string, bool) {
	const layout = "2006-01-02"
	switch rule.Type {
	case "DATE":
		if !scheduleDateRe.MatchString(rule.Date) {
			return nil, false
		}
		return []string{rule.Date}, true

	case "DATE_RANGE":
		start, err1 := time.Parse(layout, rule.StartDate)
		end, err2 := time.Parse(layout, rule.EndDate)
		if err1 != nil || err2 != nil || end.Before(start) {
			return nil, false
		}
		var out []string
		for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
			out = append(out, d.Format(layout))
			if len(out) > 400 {
				break
			}
		}
		return out, true

	case "WEEK_N_DAY":
		if rule.Month == nil || rule.WeekOfMonth == nil || rule.DayOfWeek == nil {
			return nil, false
		}
		var out []string
		day := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC)
		for m := 0; m < 12; m++ {
			month := day.AddDate(0, m, 0)
			if *rule.Month != 0 && int(month.Month()) != *rule.Month {
				continue
			}
			if d, ok := scheduleWeekNDayDate(month.Year(), int(month.Month()),
				*rule.WeekOfMonth, *rule.DayOfWeek); ok {
				out = append(out, d)
			}
		}
		return out, true
	}
	// CALENDAR_REFERENCE / HOLIDAY_GROUP phụ thuộc dữ liệu ngoài.
	return nil, false
}

// scheduleWeekNDayDate: week 1..5 là lần xuất hiện thứ N; week 6 là lần CUỐI
// CÙNG trong tháng (quy ước BACnet), không phải tuần thứ sáu.
func scheduleWeekNDayDate(year, month, week, isoDayOfWeek int) (string, bool) {
	first := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	firstISO := int(first.Weekday())
	if firstISO == 0 {
		firstISO = 7
	}
	offset := (isoDayOfWeek - firstISO + 7) % 7
	daysInMonth := time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()

	if week == 6 {
		last := offset + 1
		for last+7 <= daysInMonth {
			last += 7
		}
		return time.Date(year, time.Month(month), last, 0, 0, 0, 0, time.UTC).Format("2006-01-02"), true
	}
	day := offset + 1 + (week-1)*7
	if day > daysInMonth {
		return "", false
	}
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC).Format("2006-01-02"), true
}

func validateScheduleTargets(f *scheduleFindings, s *ScheduleObject) {
	if len(s.TargetObjects) > maxScheduleTargets {
		f.add(errSchedTargetNotFound, "$.target_objects",
			fmt.Sprintf("tối đa %d target trên một lịch", maxScheduleTargets))
	}
	seenID := make(map[string]int, len(s.TargetObjects))
	seenPoint := make(map[string]int, len(s.TargetObjects))
	allowedKinds := scheduleKindForValueType[s.ValueType]

	for i, t := range s.TargetObjects {
		base := fmt.Sprintf("$.target_objects[%d]", i)
		if !targetIDRe.MatchString(t.TargetID) {
			f.add(errSchedTargetNotFound, base+".target_id", "phải khớp ^TGT-[A-Za-z0-9_-]{1,60}$")
		} else if first, dup := seenID[t.TargetID]; dup {
			f.add(errSchedTargetNotFound, base+".target_id", fmt.Sprintf("trùng với [%d]", first))
		} else {
			seenID[t.TargetID] = i
		}

		switch t.TargetType {
		case "INTERNAL_POINT":
			limit, known := schedulePointKindLimits[t.PointKind]
			if !known {
				f.add(errSchedTargetNotFound, base+".point_kind",
					"phải là AO, DO, AV, BV, MSV hoặc EXT")
				continue
			}
			if t.Channel == nil || *t.Channel < 1 || *t.Channel > limit {
				f.add(errSchedTargetNotFound, base+".channel",
					fmt.Sprintf("%s chỉ có kênh 1..%d trên phần cứng này", t.PointKind, limit))
				continue
			}
			if !scheduleKindAllowed(allowedKinds, t.PointKind) {
				f.add(errSchedTargetTypeBad, base+".point_kind",
					fmt.Sprintf("kiểu giá trị %s không ghi được vào %s; chấp nhận: %s",
						s.ValueType, t.PointKind, strings.Join(allowedKinds, ", ")))
				continue
			}
			key := fmt.Sprintf("%s-%d", t.PointKind, *t.Channel)
			if first, dup := seenPoint[key]; dup {
				f.add(errSchedTargetNotFound, base+".channel",
					fmt.Sprintf("điểm %s đã được [%d] dùng; một lịch không được ghi cùng điểm hai lần",
						key, first))
			} else {
				seenPoint[key] = i
			}
			expected := formatSchedulePointID(t.PointKind, *t.Channel)
			if t.PointID != "" && t.PointID != expected {
				f.add(errSchedTargetNotFound, base+".point_id",
					fmt.Sprintf("phải là %s", expected))
			}
			if t.StaggeredDelaySeconds != nil && (*t.StaggeredDelaySeconds < 0 || *t.StaggeredDelaySeconds > 300) {
				f.add(errSchedTargetNotFound, base+".staggered_delay_seconds", "độ trễ khởi động so le phải từ 0 đến 300 giây")
			}
			if t.InactiveAction != "" && t.InactiveAction != "WRITE_VALUE" && t.InactiveAction != "RELINQUISH" {
				f.add(errSchedTargetNotFound, base+".inactive_action", "phải là WRITE_VALUE hoặc RELINQUISH")
			}

		case "BACNET_OBJECT":
			// ADR-023 QĐ-4: BACnet Schedule/Calendar thuộc P4. Từ chối thẳng
			// còn hơn im lặng bỏ qua rồi để người dùng tưởng lịch đang điều
			// khiển thiết bị.
			f.add(errSchedTargetNotWrite, base+".target_type",
				"target BACnet chưa hỗ trợ ở bản này (ADR-023 QĐ-4, dự kiến pha P4)")

		default:
			f.add(errSchedTargetNotFound, base+".target_type",
				"phải là INTERNAL_POINT hoặc BACNET_OBJECT")
		}
	}

	if len(s.TargetObjects) == 0 && s.Enabled {
		f.warn(errSchedTargetNotFound, "$.target_objects",
			"lịch đang bật nhưng chưa có target nào — nó sẽ không điều khiển gì cả")
	}
}

func formatSchedulePointID(kind string, channel int) string {
	return fmt.Sprintf("%s-%02d", kind, channel)
}

func scheduleKindAllowed(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// scheduleValueMatchesType kiểm giá trị có đúng kiểu đã khai báo không. JSON
// decode với UseNumber nên số về dạng json.Number.
func scheduleValueMatchesType(v any, valueType string) bool {
	if v == nil {
		return false
	}
	switch valueType {
	case "BINARY":
		s, ok := v.(string)
		return ok && (s == "ACTIVE" || s == "INACTIVE")
	case "BOOLEAN":
		_, ok := v.(bool)
		return ok
	case "REAL":
		f, ok := scheduleNumber(v)
		return ok && !math.IsNaN(f) && !math.IsInf(f, 0)
	case "UNSIGNED", "ENUMERATED":
		f, ok := scheduleNumber(v)
		return ok && !math.IsNaN(f) && !math.IsInf(f, 0) && f >= 0 && math.Trunc(f) == f
	}
	return false
}

func scheduleNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case float64:
		return n, true
	case int:
		return float64(n), true
	}
	return 0, false
}

func scheduleValueTypeHint(valueType string) string {
	switch valueType {
	case "BINARY":
		return `phải là chuỗi "ACTIVE" hoặc "INACTIVE"`
	case "BOOLEAN":
		return "phải là true hoặc false"
	case "REAL":
		return "phải là số hữu hạn"
	case "UNSIGNED", "ENUMERATED":
		return "phải là số nguyên không âm"
	}
	return "không khớp value_type"
}

// validateScheduleCollection kiểm toàn bộ tập lịch: trần 64, trùng ID, và cảnh
// báo khi nhiều lịch cùng ghi một điểm (hợp lệ nhưng người dùng cần biết vì
// runtime sẽ phân xử bằng priority_for_writing).
func validateScheduleCollection(list []ScheduleObject) []ScheduleValidationFinding {
	return validateScheduleCollectionAt(list, time.Now().UTC())
}

func validateScheduleCollectionAt(list []ScheduleObject, now time.Time) []ScheduleValidationFinding {
	f := &scheduleFindings{}
	if len(list) > maxSchedules {
		f.add(errSchedBadWeekly, "$", fmt.Sprintf("tối đa %d lịch trên một controller", maxSchedules))
	}
	seen := make(map[string]int, len(list))
	pointOwner := make(map[string]string)

	for i := range list {
		s := &list[i]
		if first, dup := seen[s.ScheduleID]; dup {
			f.add(errSchedBadWeekly, fmt.Sprintf("$[%d].schedule_id", i),
				fmt.Sprintf("trùng với [%d]", first))
		} else {
			seen[s.ScheduleID] = i
		}
		for _, finding := range validateScheduleObjectAt(s, now) {
			finding.Path = fmt.Sprintf("$[%d]%s", i, strings.TrimPrefix(finding.Path, "$"))
			f.items = append(f.items, finding)
		}
		for _, t := range s.TargetObjects {
			if t.TargetType != "INTERNAL_POINT" || t.Channel == nil {
				continue
			}
			key := fmt.Sprintf("%s-%d", t.PointKind, *t.Channel)
			if owner, exists := pointOwner[key]; exists && owner != s.ScheduleID {
				f.warn(errSchedTargetNotFound, fmt.Sprintf("$[%d].target_objects", i),
					fmt.Sprintf("%s cũng được %s điều khiển; runtime sẽ phân xử bằng "+
						"priority_for_writing", key, owner))
			} else {
				pointOwner[key] = s.ScheduleID
			}
		}
	}
	return f.items
}

func scheduleFindingsHaveError(findings []ScheduleValidationFinding) bool {
	for _, f := range findings {
		if f.Severity != "warning" {
			return true
		}
	}
	return false
}
