package app

import (
	"fmt"
	"net/http"
	"strings"
)

var validPriorities = map[string]bool{
	"low":      true,
	"medium":   true,
	"high":     true,
	"critical": true,
	"flexible": true,
}

var validAlarmClearModes = map[string]bool{
	"auto":   true,
	"manual": true,
}

var validAlarmSeverities = map[string]bool{
	"critical": true,
	"high":     true,
	"medium":   true,
	"low":      true,
	"info":     true,
}

var validSeverityRuleOps = map[string]bool{
	">=": true,
	"<=": true,
}

func (a *App) handleGetAlarmSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := a.LoadAlarmSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *App) handlePutAlarmSettings(w http.ResponseWriter, r *http.Request) {
	var rows []AlarmSetting
	if err := decodeConfigBody(w, r, &rows); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if rows == nil {
		rows = []AlarmSetting{}
	}
	normalizeAlarmSettings(rows)
	if errs := a.validateAlarmSettingsForSave(rows); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	before, beforeErr := a.LoadAlarmSettings(r.Context())
	if err := a.SaveAlarmSettings(r.Context(), rows); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	applied, warnings := a.dispatchReload(reloadSIGHUPCore)
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	if beforeErr == nil {
		a.recordAlarmSettingHistory(r.Context(), user, before, rows)
	} else if a.logger != nil {
		a.logger.Printf("WARN alarm_settings history skipped old_load err=%v", beforeErr)
	}
	a.audit.Change(user, "alarm-settings", "alarm_settings.conf", "applied", r.RemoteAddr)
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "applied", Applied: applied, Reload: reloadSIGHUPCore, Warnings: warnings})
}

func validateAlarmSettings(rows []AlarmSetting) []configValidationError {
	var errs []configValidationError
	if len(rows) > maxAlarms {
		addConfigErr(&errs, "$", fmt.Sprintf("must contain at most %d alarms", maxAlarms))
	}
	seen := make(map[string]int, len(rows))
	bacnetPublished := 0
	for i, row := range rows {
		base := fmt.Sprintf("[%d]", i)

		id := strings.TrimSpace(row.ID)
		if id == "" {
			addConfigErr(&errs, base+".id", "is required")
		} else if !validAlarmID(row.ID) {
			addConfigErr(&errs, base+".id", "must not contain whitespace, slash, or backslash")
		} else if first, ok := seen[id]; ok {
			addConfigErr(&errs, base+".id", fmt.Sprintf("duplicates [%d].id", first))
		} else {
			seen[id] = i
		}

		if strings.TrimSpace(row.Label) == "" {
			addConfigErr(&errs, base+".label", "is required")
		}

		if !validAlarmType(row.AlarmType) {
			addConfigErr(&errs, base+".alarmType", "must be integer in range 0..7")
		} else if row.Enabled && deferredAlarmType(row.AlarmType) {
			addConfigErr(&errs, base+".alarmType", fmt.Sprintf("alarm type %d not yet supported; must be disabled", row.AlarmType))
		}

		if row.Sources == nil {
			addConfigErr(&errs, base+".sources", "is required")
		}
		if len(row.Sources) > maxSourcesPerAlarm {
			addConfigErr(&errs, base+".sources", fmt.Sprintf("must contain at most %d sources", maxSourcesPerAlarm))
		}
		if row.Enabled && row.AlarmType != alarmTypeDisabled && len(row.Sources) == 0 {
			addConfigErr(&errs, base+".sources", "must contain at least one source when enabled")
		}
		seenSources := make(map[string]int, len(row.Sources))
		for j, source := range row.Sources {
			validateAlarmSource(&errs, fmt.Sprintf("%s.sources[%d]", base, j), j, source, seenSources)
		}

		if !validPriorities[row.Priority] {
			addConfigErr(&errs, base+".priority", "must be one of: low, medium, high, critical, flexible")
		}

		if !validAlarmClearModes[row.ClearMode] {
			addConfigErr(&errs, base+".clearMode", "must be one of: auto, manual")
		}

		if row.DelayS < 0 {
			addConfigErr(&errs, base+".delayS", "must be >= 0")
		}

		if row.PublishBacnet && row.Enabled {
			bacnetPublished++
		}
		if row.NotificationClass != nil {
			if *row.NotificationClass < 1 || *row.NotificationClass > 4 {
				addConfigErr(&errs, base+".notificationClass", "must be integer in range 1..4")
			}
			if !row.PublishBacnet {
				addConfigErr(&errs, base+".notificationClass", "requires publishBacnet=true")
			}
		}

		if row.Params == nil {
			addConfigErr(&errs, base+".params", "is required")
		} else if validAlarmType(row.AlarmType) {
			validateAlarmParams(&errs, base+".params", row.AlarmType, row.Params)
			if row.Priority == "flexible" && len(row.Params.SeverityRules) == 0 {
				addConfigErr(&errs, base+".params.severityRules", "must contain at least one rule when priority is flexible")
			}
		}
	}
	if bacnetPublished > maxBacnetPublishedAlarms {
		addConfigErr(&errs, "$.publishBacnet", fmt.Sprintf("enabled BACnet-published alarms must be <= %d", maxBacnetPublishedAlarms))
	}
	return errs
}

func (a *App) validateAlarmSettingsForSave(rows []AlarmSetting) []configValidationError {
	errs := validateAlarmSettings(rows)
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
		for j, source := range row.Sources {
			if source.Kind != "VP" {
				continue
			}
			path := fmt.Sprintf("[%d].sources[%d]", i, j)
			if row.AlarmType != alarmTypeHighLowInput {
				addConfigErr(&errs, path+".pointId", "VP virtual point sources support high/low alarms only")
				continue
			}
			expected := formatVirtualPointID(source.Channel)
			item, ok := byID[canonicalVirtualPointID(source.PointID)]
			if !ok || item.ID != canonicalVirtualPointID(expected) {
				addConfigErr(&errs, path+".pointId", "must reference an enabled virtual point")
				continue
			}
			if !virtualPointNumericSignalType(item.SignalType) {
				addConfigErr(&errs, path+".pointId", "must reference an integer or float virtual point")
			}
		}
	}
	return errs
}

func normalizeAlarmSettings(rows []AlarmSetting) {
	for i := range rows {
		if rows[i].ClearMode == "" {
			rows[i].ClearMode = "auto"
		}
		for j := range rows[i].Sources {
			rows[i].Sources[j].Kind = normalizeVirtualPointKind(rows[i].Sources[j].Kind)
			if rows[i].Sources[j].Kind == "VP" {
				if channel, ok := virtualPointChannel(rows[i].Sources[j].PointID); ok {
					rows[i].Sources[j].Channel = channel
				}
				if rows[i].Sources[j].Channel > 0 {
					rows[i].Sources[j].PointID = formatVirtualPointID(rows[i].Sources[j].Channel)
				}
			}
		}
	}
}

func validAlarmType(alarmType int) bool {
	return alarmType >= alarmTypeDisabled && alarmType <= alarmTypePISequence
}

func deferredAlarmType(alarmType int) bool {
	switch alarmType {
	case alarmTypeSetpointDeviation, alarmTypeFanState, alarmTypeDigitalOutput, alarmTypeAnalogOutput, alarmTypePISequence:
		return true
	default:
		return false
	}
}

func validateAlarmSource(errs *[]configValidationError, path string, index int, source AlarmSource, seen map[string]int) {
	source.Kind = normalizeVirtualPointKind(source.Kind)
	maxChannel := 0
	switch source.Kind {
	case "UI":
		maxChannel = 16
	case "AO", "DO":
		maxChannel = 4
	case "VP":
		maxChannel = virtualPointTotalCapacity
	default:
		addConfigErr(errs, path+".kind", "must be one of: UI, AO, DO, VP")
	}
	if maxChannel > 0 && (source.Channel < 1 || source.Channel > maxChannel) {
		addConfigErr(errs, path+".channel", fmt.Sprintf("must be integer in range 1..%d for %s", maxChannel, source.Kind))
	}
	pointID := strings.TrimSpace(source.PointID)
	if pointID == "" {
		addConfigErr(errs, path+".pointId", "is required")
	} else if maxChannel > 0 && source.Channel >= 1 && source.Channel <= maxChannel {
		expected := formatPointID(source.Kind, source.Channel)
		if source.Kind == "VP" {
			expected = formatVirtualPointID(source.Channel)
			if canonicalVirtualPointID(source.PointID) != canonicalVirtualPointID(expected) {
				addConfigErr(errs, path+".pointId", fmt.Sprintf("must be %s for %s channel %d", expected, source.Kind, source.Channel))
			}
		} else if source.PointID != expected {
			addConfigErr(errs, path+".pointId", fmt.Sprintf("must be %s for %s channel %d", expected, source.Kind, source.Channel))
		}
	}
	if maxChannel == 0 || source.Channel < 1 || source.Channel > maxChannel {
		return
	}
	key := fmt.Sprintf("%s:%d", source.Kind, source.Channel)
	if first, ok := seen[key]; ok {
		addConfigErr(errs, path, fmt.Sprintf("duplicates sources[%d]", first))
		return
	}
	seen[key] = index
}

func validateAlarmParams(errs *[]configValidationError, path string, alarmType int, params *AlarmParams) {
	if params.Hysteresis != nil && *params.Hysteresis < 0 {
		addConfigErr(errs, path+".hysteresis", "must be >= 0")
	}
	validateSeverityRules(errs, path+".severityRules", params.SeverityRules)
	switch alarmType {
	case alarmTypeHighLowInput:
		validateHighLowParams(errs, path, params)
	case alarmTypeRuntimeHours:
		if params.RuntimeHours == nil {
			addConfigErr(errs, path+".runtimeHours", "is required for alarmType 3")
		} else if *params.RuntimeHours <= 0 {
			addConfigErr(errs, path+".runtimeHours", "must be > 0")
		}
	}
}

func validateSeverityRules(errs *[]configValidationError, path string, rules []SeverityRule) {
	for i, rule := range rules {
		base := fmt.Sprintf("%s[%d]", path, i)
		if !validAlarmSeverities[rule.Severity] {
			addConfigErr(errs, base+".severity", "must be one of: critical, high, medium, low, info")
		}
		if !validSeverityRuleOps[rule.Op] {
			addConfigErr(errs, base+".op", "must be one of: >=, <=")
		}
	}
}

func validateHighLowParams(errs *[]configValidationError, path string, params *AlarmParams) {
	if params.HH == nil {
		addConfigErr(errs, path+".hh", "is required for alarmType 1")
	}
	if params.H == nil {
		addConfigErr(errs, path+".h", "is required for alarmType 1")
	}
	if params.L == nil {
		addConfigErr(errs, path+".l", "is required for alarmType 1")
	}
	if params.LL == nil {
		addConfigErr(errs, path+".ll", "is required for alarmType 1")
	}
	if params.HH == nil || params.H == nil || params.L == nil || params.LL == nil {
		return
	}
	if *params.HH < *params.H {
		addConfigErr(errs, path+".hh", "must be >= h")
	}
	if *params.H < *params.L {
		addConfigErr(errs, path+".h", "must be >= l")
	}
	if *params.L < *params.LL {
		addConfigErr(errs, path+".l", "must be >= ll")
	}
}
