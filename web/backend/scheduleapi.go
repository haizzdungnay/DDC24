package main

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

var scheduleTimePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

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
	if errs := validateSchedules(rows); len(errs) > 0 {
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
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "applied", Applied: applied, Reload: reloadSIGHUPCore, Warnings: warnings})
}

func validateSchedules(rows []ScheduleRow) []configValidationError {
	var errs []configValidationError
	seen := make(map[string]int, len(rows))
	for i, row := range rows {
		base := fmt.Sprintf("[%d]", i)
		id := strings.TrimSpace(row.ID)
		if id == "" {
			addConfigErr(&errs, base+".id", "is required")
		} else if first, ok := seen[id]; ok {
			addConfigErr(&errs, base+".id", fmt.Sprintf("duplicates [%d].id", first))
		} else {
			seen[id] = i
		}
		if strings.TrimSpace(row.Label) == "" {
			addConfigErr(&errs, base+".label", "is required")
		}
		for j, cell := range row.Cells {
			cellBase := fmt.Sprintf("%s.cells[%d]", base, j)
			validateScheduleCell(&errs, cellBase, cell)
		}
	}
	return errs
}

func validateScheduleCell(errs *[]configValidationError, path string, cell ScheduleCell) {
	if strings.TrimSpace(cell.Day) == "" {
		addConfigErr(errs, path+".day", "is required")
	}
	switch cell.Value {
	case "ON", "OFF", "OPEN", "CLOSE":
	default:
		addConfigErr(errs, path+".value", "must be one of ON, OFF, OPEN, CLOSE")
	}
	if !scheduleTimePattern.MatchString(cell.Start) {
		addConfigErr(errs, path+".start", "must be HH:MM")
	}
	if !scheduleTimePattern.MatchString(cell.End) {
		addConfigErr(errs, path+".end", "must be HH:MM")
	}
}
