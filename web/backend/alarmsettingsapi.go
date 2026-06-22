package main

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
	if errs := validateAlarmSettings(rows); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	if err := a.SaveAlarmSettings(r.Context(), rows); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	applied, warnings := a.dispatchReload(reloadSIGHUPCore)
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "alarm-settings", "alarm_settings.conf", "applied", r.RemoteAddr)
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "applied", Applied: applied, Reload: reloadSIGHUPCore, Warnings: warnings})
}

func validateAlarmSettings(rows []AlarmSetting) []configValidationError {
	var errs []configValidationError
	seen := make(map[string]int, len(rows))
	for i, row := range rows {
		base := fmt.Sprintf("[%d]", i)

		id := strings.TrimSpace(row.PointID)
		if id == "" {
			addConfigErr(&errs, base+".pointId", "is required")
		} else if first, ok := seen[id]; ok {
			addConfigErr(&errs, base+".pointId", fmt.Sprintf("duplicates [%d].pointId", first))
		} else {
			seen[id] = i
		}

		if strings.TrimSpace(row.Label) == "" {
			addConfigErr(&errs, base+".label", "is required")
		}

		if !validPriorities[row.Priority] {
			addConfigErr(&errs, base+".priority", "must be one of: low, medium, high, critical")
		}

		if row.DelayS < 0 {
			addConfigErr(&errs, base+".delayS", "must be >= 0")
		}

		if row.Enabled {
			if row.HH < row.H {
				addConfigErr(&errs, base+".hh", "must be >= h when enabled")
			}
			if row.H < row.L {
				addConfigErr(&errs, base+".h", "must be >= l when enabled")
			}
			if row.L < row.LL {
				addConfigErr(&errs, base+".l", "must be >= ll when enabled")
			}
		}
	}
	return errs
}
