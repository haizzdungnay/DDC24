package main

import (
	"net/http"
	"strings"
	"time"
)

// handleAlarms handles GET /api/v1/alarms.
// Returns the current active/unacked alarm list from core.
func (a *App) handleAlarms(w http.ResponseWriter, r *http.Request) {
	reader, ok := a.core.(alarmReader)
	if !ok {
		writeJSON(w, http.StatusOK, []AlarmDTO{})
		return
	}
	alarms, err := reader.ReadAlarms(r.Context())
	if err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN alarms_read degraded err=%v", err)
		}
		alarms = []AlarmDTO{}
	}
	if alarms == nil {
		alarms = []AlarmDTO{}
	}
	writeJSON(w, http.StatusOK, alarms)
}

// handleAckAlarm handles POST /api/v1/alarms/{id}/ack (RBAC operator+).
func (a *App) handleAckAlarm(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || !RoleAllows(principal.Role, RoleOperator) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		a.audit.AlarmAck(principal, id, "invalid", r.RemoteAddr)
		writeError(w, http.StatusBadRequest, "missing alarm id")
		return
	}
	if !validAlarmID(id) {
		a.audit.AlarmAck(principal, id, "invalid", r.RemoteAddr)
		writeError(w, http.StatusBadRequest, "invalid alarm id")
		return
	}
	acker, ok := a.core.(alarmAcker)
	if !ok {
		a.audit.AlarmAck(principal, id, "unsupported", r.RemoteAddr)
		writeError(w, http.StatusConflict, "alarm ack unsupported")
		return
	}
	if err := acker.AckAlarm(r.Context(), id); err != nil {
		a.audit.AlarmAck(principal, id, "rejected", r.RemoteAddr)
		writeError(w, ackAlarmErrorStatus(err), ackAlarmErrorMessage(err))
		return
	}
	a.audit.AlarmAck(principal, id, "accepted", r.RemoteAddr)
	if reader, ok := a.core.(alarmReader); ok {
		alarms, err := reader.ReadAlarms(r.Context())
		if err == nil {
			if alarms == nil {
				alarms = []AlarmDTO{}
			}
			writeJSON(w, http.StatusOK, alarms)
			return
		}
		if a.logger != nil {
			a.logger.Printf("WARN alarms_read_after_ack degraded id=%s err=%v", id, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": "acked", "id": id})
}

func validAlarmID(id string) bool {
	if id == "" {
		return false
	}
	for _, r := range id {
		if r <= ' ' || r == '/' || r == '\\' {
			return false
		}
	}
	return true
}

func ackAlarmErrorStatus(err error) int {
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "invalid") || strings.Contains(msg, "bad request") || strings.Contains(msg, "missing"):
		return http.StatusBadRequest
	case strings.Contains(msg, "forbidden") || strings.Contains(msg, "permission") || strings.Contains(msg, "unauthor"):
		return http.StatusForbidden
	case strings.Contains(msg, "not found") || strings.Contains(msg, "unknown"):
		return http.StatusNotFound
	default:
		return http.StatusConflict
	}
}

func ackAlarmErrorMessage(err error) string {
	switch ackAlarmErrorStatus(err) {
	case http.StatusBadRequest:
		return "invalid alarm id"
	case http.StatusForbidden:
		return "alarm ack forbidden"
	case http.StatusNotFound:
		return "alarm not found"
	default:
		return "alarm ack rejected"
	}
}

func (a *AuditLogger) AlarmAck(principal *Principal, id string, result string, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	username := "-"
	role := "-"
	if principal != nil {
		username = principal.Username
		role = string(principal.Role)
	}
	a.logger.Printf("AUDIT alarm_ack ts=%s user=%s role=%s alarm=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
		sanitizeAudit(id, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}
