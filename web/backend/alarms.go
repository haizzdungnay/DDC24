package main

import (
	"encoding/json"
	"io"
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
	if err == nil {
		a.recordAlarmSnapshot(r.Context(), alarms)
	}
	writeJSON(w, http.StatusOK, a.mergeAlarmHistoryRows(r.Context(), alarms, err != nil))
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
	action, err := decodeAlarmActionRequest(w, r, true)
	if err != nil {
		a.audit.AlarmAck(principal, id, "invalid", r.RemoteAddr)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := acker.AckAlarm(r.Context(), id, action); err != nil {
		a.audit.AlarmAck(principal, id, "rejected", r.RemoteAddr)
		writeError(w, ackAlarmErrorStatus(err), ackAlarmErrorMessage(err))
		return
	}
	a.audit.AlarmAck(principal, id, "accepted", r.RemoteAddr)
	user := principal.Username
	if reader, ok := a.core.(alarmReader); ok {
		alarms, err := reader.ReadAlarms(r.Context())
		if err == nil {
			if alarms == nil {
				alarms = []AlarmDTO{}
			}
			a.recordAlarmSnapshot(r.Context(), alarms)
			a.recordAlarmAck(r.Context(), id, user, alarms)
			writeJSON(w, http.StatusOK, a.mergeAlarmHistoryRows(r.Context(), alarms, false))
			return
		}
		if a.logger != nil {
			a.logger.Printf("WARN alarms_read_after_ack degraded id=%s err=%v", id, err)
		}
	}
	a.recordAlarmAck(r.Context(), id, user, nil)
	writeJSON(w, http.StatusOK, map[string]any{"result": "acked", "id": id})
}

// handleSuppressAlarm handles POST /api/v1/alarms/{id}/suppress (RBAC operator+).
func (a *App) handleSuppressAlarm(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || !RoleAllows(principal.Role, RoleOperator) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" || !validAlarmID(id) {
		a.audit.AlarmSuppress(principal, id, "invalid", r.RemoteAddr)
		writeError(w, http.StatusBadRequest, "invalid alarm id")
		return
	}
	suppressor, ok := a.core.(alarmSuppressor)
	if !ok {
		a.audit.AlarmSuppress(principal, id, "unsupported", r.RemoteAddr)
		writeError(w, http.StatusConflict, "alarm suppress unsupported")
		return
	}
	action, err := decodeAlarmActionRequest(w, r, false)
	if err != nil {
		a.audit.AlarmSuppress(principal, id, "invalid", r.RemoteAddr)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := suppressor.SuppressAlarm(r.Context(), id, action); err != nil {
		a.audit.AlarmSuppress(principal, id, "rejected", r.RemoteAddr)
		writeError(w, ackAlarmErrorStatus(err), suppressAlarmErrorMessage(err))
		return
	}
	a.audit.AlarmSuppress(principal, id, "accepted", r.RemoteAddr)
	if reader, ok := a.core.(alarmReader); ok {
		alarms, err := reader.ReadAlarms(r.Context())
		if err == nil {
			if alarms == nil {
				alarms = []AlarmDTO{}
			}
			a.recordAlarmSnapshot(r.Context(), alarms)
			writeJSON(w, http.StatusOK, a.mergeAlarmHistoryRows(r.Context(), alarms, false))
			return
		}
		if a.logger != nil {
			a.logger.Printf("WARN alarms_read_after_suppress degraded id=%s err=%v", id, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": "suppressed", "id": id})
}

// handleReturnAlarm handles POST /api/v1/alarms/{id}/return (RBAC operator+).
func (a *App) handleReturnAlarm(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || !RoleAllows(principal.Role, RoleOperator) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" || !validAlarmID(id) {
		writeError(w, http.StatusBadRequest, "invalid alarm id")
		return
	}
	returner, ok := a.core.(alarmReturner)
	if !ok {
		writeError(w, http.StatusConflict, "alarm return unsupported")
		return
	}
	if err := returner.ReturnAlarm(r.Context(), id); err != nil {
		writeError(w, ackAlarmErrorStatus(err), ackAlarmErrorMessage(err))
		return
	}
	user := principal.Username
	if reader, ok := a.core.(alarmReader); ok {
		alarms, err := reader.ReadAlarms(r.Context())
		if err == nil {
			if alarms == nil {
				alarms = []AlarmDTO{}
			}
			a.recordAlarmSnapshot(r.Context(), alarms)
			a.recordAlarmReturn(r.Context(), id, user, alarms)
			writeJSON(w, http.StatusOK, a.mergeAlarmHistoryRows(r.Context(), alarms, false))
			return
		}
		if a.logger != nil {
			a.logger.Printf("WARN alarms_read_after_return degraded id=%s err=%v", id, err)
		}
	}
	a.recordAlarmReturn(r.Context(), id, user, nil)
	writeJSON(w, http.StatusOK, map[string]any{"result": "returned", "id": id})
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

func decodeAlarmActionRequest(w http.ResponseWriter, r *http.Request, allowEmpty bool) (AlarmActionRequest, error) {
	if r.Body == nil || r.Body == http.NoBody || r.ContentLength == 0 {
		if !allowEmpty {
			return AlarmActionRequest{}, errMissingAlarmAction
		}
		permanent := true
		return AlarmActionRequest{Permanent: &permanent}, nil
	}
	var action AlarmActionRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	dec.DisallowUnknownFields()
	if err := dec.Decode(&action); err != nil {
		if err == io.EOF {
			if !allowEmpty {
				return AlarmActionRequest{}, errMissingAlarmAction
			}
			permanent := true
			return AlarmActionRequest{Permanent: &permanent}, nil
		}
		return AlarmActionRequest{}, err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return AlarmActionRequest{}, errExtraAlarmActionJSON
		}
		return AlarmActionRequest{}, err
	}
	return normalizeAlarmActionRequest(action, allowEmpty)
}

func normalizeAlarmActionRequest(action AlarmActionRequest, allowEmpty bool) (AlarmActionRequest, error) {
	if action.DurationS != nil && *action.DurationS <= 0 {
		return AlarmActionRequest{}, errInvalidAlarmDuration
	}
	if action.Permanent != nil && *action.Permanent && action.DurationS != nil {
		return AlarmActionRequest{}, errInvalidAlarmDurationWithPermanent
	}
	if action.Permanent != nil && !*action.Permanent && action.DurationS == nil {
		return AlarmActionRequest{}, errMissingAlarmDuration
	}
	if action.Permanent == nil && action.DurationS == nil {
		if !allowEmpty {
			return AlarmActionRequest{}, errMissingAlarmAction
		}
		permanent := true
		action.Permanent = &permanent
	}
	if action.Permanent == nil && action.DurationS != nil {
		permanent := false
		action.Permanent = &permanent
	}
	return action, nil
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

func suppressAlarmErrorMessage(err error) string {
	switch ackAlarmErrorStatus(err) {
	case http.StatusBadRequest:
		return "invalid alarm id"
	case http.StatusForbidden:
		return "alarm suppress forbidden"
	case http.StatusNotFound:
		return "alarm not found"
	default:
		return "alarm suppress rejected"
	}
}

var errInvalidAlarmDuration = alarmActionError("durationS must be > 0")
var errInvalidAlarmDurationWithPermanent = alarmActionError("durationS cannot be set when permanent is true")
var errMissingAlarmDuration = alarmActionError("durationS is required when permanent is false")
var errMissingAlarmAction = alarmActionError("alarm action body is required")
var errExtraAlarmActionJSON = alarmActionError("alarm action body must contain one JSON object")

type alarmActionError string

func (e alarmActionError) Error() string {
	return string(e)
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

func (a *AuditLogger) AlarmSuppress(principal *Principal, id string, result string, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	username := "-"
	role := "-"
	if principal != nil {
		username = principal.Username
		role = string(principal.Role)
	}
	a.logger.Printf("AUDIT alarm_suppress ts=%s user=%s role=%s alarm=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
		sanitizeAudit(id, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}
