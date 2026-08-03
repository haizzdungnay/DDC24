package app

import (
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
)

var scheduleTimePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
var scheduleDatePattern = regexp.MustCompile(`^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)
var scheduleIDPattern = regexp.MustCompile(`^SCH-[A-Za-z0-9_-]+$`)

const maxSchedules = 64

var scheduleTypes = map[string]bool{
	"not_active":                true,
	"controller_operation_mode": true,
	"control_loop_setpoint":     true,
	"analog_output_value":       true,
	"fan_state_value":           true,
	"digital_output_value":      true,
	"holiday_period":            true,
}

var scheduleWeekdays = map[string]bool{
	"monday":    true,
	"tuesday":   true,
	"wednesday": true,
	"thursday":  true,
	"friday":    true,
	"saturday":  true,
	"sunday":    true,
}

func (a *App) handleGetSchedules(w http.ResponseWriter, r *http.Request) {
	rows, err := a.LoadSchedules(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *App) handlePutSchedules(w http.ResponseWriter, r *http.Request) {
	var rows []ScheduleRow
	if err := decodeConfigBody(w, r, &rows); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if rows == nil {
		rows = []ScheduleRow{}
	}
	normalizeSchedules(rows)
	if errs := a.validateSchedulesForSave(rows); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	if err := a.SaveSchedules(r.Context(), rows); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	applied, warnings := a.dispatchReload(reloadSIGHUPCore)
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "schedules", "schedule.conf", "applied", r.RemoteAddr)
	result := "success"
	if !applied {
		result = "failed"
	}
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: result, Applied: applied, Reload: reloadSIGHUPCore, Warnings: warnings})
}

func validateSchedules(rows []ScheduleRow) []configValidationError {
	var errs []configValidationError
	if len(rows) > maxSchedules {
		addConfigErr(&errs, "$", fmt.Sprintf("must contain at most %d schedules", maxSchedules))
	}
	seen := make(map[string]int, len(rows))
	for i, row := range rows {
		base := fmt.Sprintf("[%d]", i)
		id := strings.TrimSpace(row.ID)
		if id == "" {
			addConfigErr(&errs, base+".id", "is required")
		} else if id != row.ID {
			addConfigErr(&errs, base+".id", "must not contain leading or trailing spaces")
		} else if len(id) > 64 {
			addConfigErr(&errs, base+".id", "must be at most 64 characters")
		} else if !scheduleIDPattern.MatchString(id) {
			addConfigErr(&errs, base+".id", "must match ^SCH-[A-Za-z0-9_-]+$")
		} else if first, ok := seen[id]; ok {
			addConfigErr(&errs, base+".id", fmt.Sprintf("duplicates [%d].id", first))
		} else {
			seen[id] = i
		}
		if strings.TrimSpace(row.Label) == "" {
			addConfigErr(&errs, base+".label", "is required")
		} else if len(row.Label) > 80 {
			addConfigErr(&errs, base+".label", "must be at most 80 characters")
		}
		if len(row.Notes) > 1024 {
			addConfigErr(&errs, base+".notes", "must be at most 1024 characters")
		}
		if !scheduleTypes[row.ScheduleType] {
			addConfigErr(&errs, base+".scheduleType", "is invalid")
		}
		for j, day := range row.Weekdays {
			if !scheduleWeekdays[day] {
				addConfigErr(&errs, fmt.Sprintf("%s.weekdays[%d]", base, j), "is invalid")
			}
		}
		executable := row.ScheduleType != "not_active" && row.ScheduleType != "holiday_period"
		if executable {
			if !scheduleTimePattern.MatchString(row.StartTime) {
				addConfigErr(&errs, base+".startTime", "must be HH:MM")
			}
			if !scheduleTimePattern.MatchString(row.EndTime) {
				addConfigErr(&errs, base+".endTime", "must be HH:MM")
			}
			if scheduleTimePattern.MatchString(row.StartTime) && row.StartTime == row.EndTime {
				addConfigErr(&errs, base+".endTime", "must differ from startTime")
			}
			if len(row.Weekdays) == 0 {
				addConfigErr(&errs, base+".weekdays", "must contain at least one weekday")
			}
		} else if row.ScheduleType == "holiday_period" {
			if !validScheduleDate(row.StartDate) {
				addConfigErr(&errs, base+".startDate", "must be MM-DD")
			}
			if !validScheduleDate(row.EndDate) {
				addConfigErr(&errs, base+".endDate", "must be MM-DD")
			}
		}
		validateScheduleAction(&errs, base, row)
	}
	return errs
}

func (a *App) validateSchedulesForSave(rows []ScheduleRow) []configValidationError {
	errs := validateSchedules(rows)
	if a == nil {
		return errs
	}
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		addConfigErr(&errs, "$.virtual_points", "could not load virtual_points.conf")
		return errs
	}
	cfg = normalizeVirtualPointsConfig(cfg)
	byID := make(map[string]VirtualPoint, len(cfg.Items))
	for _, item := range cfg.Items {
		item = normalizeVirtualPoint(item)
		if item.Enabled {
			byID[item.ID] = item
		}
	}
	for i, row := range rows {
		if row.Target == nil || normalizeVirtualPointKind(row.Target.Kind) != "VP" || row.Target.Channel == nil {
			continue
		}
		path := fmt.Sprintf("[%d].target", i)
		expected := formatVirtualPointID(*row.Target.Channel)
		item, ok := byID[canonicalVirtualPointID(row.Target.PointID)]
		if !ok || item.ID != canonicalVirtualPointID(expected) {
			addConfigErr(&errs, path+".pointId", "must reference an enabled virtual point")
			continue
		}
		if !item.Writable {
			addConfigErr(&errs, path+".pointId", "must reference a writable virtual point")
		}
		if item.SignalType != virtualPointSignalInteger && item.SignalType != virtualPointSignalFloat {
			addConfigErr(&errs, path+".pointId", "must reference an integer or float virtual point")
		}
		if item.SignalType == virtualPointSignalInteger && (row.Value == nil || math.Trunc(*row.Value) != *row.Value) {
			addConfigErr(&errs, path+".value", "must be an integer for integer virtual points")
		}
	}
	return errs
}

func normalizeSchedules(rows []ScheduleRow) {
	for i := range rows {
		if rows[i].StartTime == "" && rows[i].TimeOfDay != "" {
			rows[i].StartTime = rows[i].TimeOfDay
		}
		if rows[i].TimeOfDay == "" && rows[i].StartTime != "" {
			rows[i].TimeOfDay = rows[i].StartTime
		}
		if rows[i].Target != nil {
			rows[i].Target.Kind = normalizeVirtualPointKind(rows[i].Target.Kind)
			if rows[i].Target.Channel == nil && rows[i].Target.PointID != "" {
				if channel, ok := virtualPointChannel(rows[i].Target.PointID); ok {
					rows[i].Target.Channel = &channel
				}
			}
			if rows[i].Target.Channel != nil {
				if rows[i].Target.Kind == "VP" {
					rows[i].Target.PointID = formatVirtualPointID(*rows[i].Target.Channel)
				} else if rows[i].Target.PointID == "" {
					rows[i].Target.PointID = formatPointID(rows[i].Target.Kind, *rows[i].Target.Channel)
				}
			}
		}
	}
}

func normalizeVirtualPointKind(kind string) string {
	kind = strings.ToUpper(strings.TrimSpace(kind))
	if kind == "AV" {
		return "VP"
	}
	return kind
}

func validScheduleDate(value string) bool {
	if !scheduleDatePattern.MatchString(value) {
		return false
	}
	month := int(value[0]-'0')*10 + int(value[1]-'0')
	day := int(value[3]-'0')*10 + int(value[4]-'0')
	days := [...]int{31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
	return month >= 1 && month <= 12 && day >= 1 && day <= days[month-1]
}

func validateScheduleAction(errs *[]configValidationError, base string, row ScheduleRow) {
	if row.Target != nil {
		row.Target.Kind = normalizeVirtualPointKind(row.Target.Kind)
	}
	switch row.ScheduleType {
	case "not_active", "holiday_period":
		return
	case "controller_operation_mode":
		if !validScheduleInt(row.Value, 0, 2) {
			addConfigErr(errs, base+".value", "must be integer 0..2")
		}
		validateScheduleTarget(errs, base+".target", row.Target, "VP", 1, virtualPointTotalCapacity)
	case "control_loop_setpoint":
		validateScheduleTarget(errs, base+".target", row.Target, "VP", 1, virtualPointTotalCapacity)
		if !validScheduleNumber(row.Value) {
			addConfigErr(errs, base+".value", "must be finite number")
		}
	case "analog_output_value":
		validateScheduleTargetOneOf(errs, base+".target", row.Target, []scheduleTargetSpec{{kind: "AO", minChannel: 1, maxChannel: 4}, {kind: "VP", minChannel: 1, maxChannel: virtualPointTotalCapacity}})
		if !validScheduleRange(row.Value, 0, 100) {
			addConfigErr(errs, base+".value", "must be finite number 0..100")
		}
	case "fan_state_value", "digital_output_value":
		validateScheduleTargetOneOf(errs, base+".target", row.Target, []scheduleTargetSpec{{kind: "DO", minChannel: 1, maxChannel: 4}})
		if !validScheduleInt(row.Value, 0, 1) {
			addConfigErr(errs, base+".value", "must be 0 or 1")
		}
	}
}

type scheduleTargetSpec struct {
	kind       string
	minChannel int
	maxChannel int
}

func validateScheduleTargetOneOf(errs *[]configValidationError, path string, target *ScheduleTarget, specs []scheduleTargetSpec) {
	if target == nil {
		addConfigErr(errs, path, "is required")
		return
	}
	for _, spec := range specs {
		if target.Kind == spec.kind {
			validateScheduleTarget(errs, path, target, spec.kind, spec.minChannel, spec.maxChannel)
			return
		}
	}
	kinds := make([]string, 0, len(specs))
	for _, spec := range specs {
		kinds = append(kinds, spec.kind)
	}
	addConfigErr(errs, path+".kind", "must be one of: "+strings.Join(kinds, ", "))
}

func validateScheduleTarget(errs *[]configValidationError, path string, target *ScheduleTarget, kind string, minChannel int, maxChannel int) {
	if target == nil {
		addConfigErr(errs, path, "is required")
		return
	}
	if target.Kind != kind {
		addConfigErr(errs, path+".kind", "must be "+kind)
	}
	if target.Channel == nil {
		addConfigErr(errs, path+".channel", "is required")
		return
	}
	if *target.Channel < minChannel || *target.Channel > maxChannel {
		addConfigErr(errs, path+".channel", fmt.Sprintf("must be %d..%d", minChannel, maxChannel))
	}
	if target.PointID != "" {
		expected := fmt.Sprintf("%s-%02d", kind, *target.Channel)
		if kind == "VP" {
			expected = formatVirtualPointID(*target.Channel)
		}
		if !schedulePointIDMatches(target.PointID, expected, kind) {
			addConfigErr(errs, path+".pointId", "must match "+expected)
		}
	}
}

func schedulePointIDMatches(got string, want string, kind string) bool {
	switch kind {
	case "VP":
		return canonicalVirtualPointID(got) == canonicalVirtualPointID(want)
	case "AV", "BV", "MSV":
		return canonicalPointID(got) == canonicalPointID(want)
	default:
		return got == want
	}
}

func validScheduleNumber(value *float64) bool {
	return value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0)
}

func validScheduleRange(value *float64, min float64, max float64) bool {
	return validScheduleNumber(value) && *value >= min && *value <= max
}

func validScheduleInt(value *float64, min int, max int) bool {
	return validScheduleRange(value, float64(min), float64(max)) && math.Trunc(*value) == *value
}
