package auth

import (
	"log"
	"strings"
	"time"
)

type AuditLogger struct {
	logger *log.Logger
}

func NewAuditLogger(logger *log.Logger) *AuditLogger {
	return &AuditLogger{logger: logger}
}

func (a *AuditLogger) Login(username, role, result, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	a.logger.Printf("AUDIT login ts=%s user=%s role=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16), result, sanitizeAudit(remote, 64))
}

func (a *AuditLogger) PointMetadata(user, pointID, field, oldValue, newValue, result, requestID, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	a.logger.Printf("AUDIT point_metadata ts=%s point_id=%s field=%s old=%s new=%s actor=%s request_id=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(pointID, 64), sanitizeAudit(field, 16), sanitizeAuditValue(oldValue, 128), sanitizeAuditValue(newValue, 128), sanitizeAudit(user, 32), sanitizeAudit(requestID, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}

func sanitizeAuditValue(value string, max int) string {
	var b strings.Builder
	for _, r := range value {
		if r < 0x20 || r == 0x7f || r == ' ' || r == '\t' {
			b.WriteByte('_')
		} else {
			b.WriteRune(r)
		}
		if b.Len() >= max {
			break
		}
	}
	if b.Len() == 0 {
		return "-"
	}
	return b.String()
}

func (a *AuditLogger) Change(user, action, target, result, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	a.logger.Printf("AUDIT change ts=%s user=%s action=%s target=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(user, 32), sanitizeAudit(action, 32), sanitizeAudit(target, 64), sanitizeAudit(result, 32), sanitizeAudit(remote, 64))
}

func (a *AuditLogger) HMI(user string, role Role, requestID, action, target, reason, result, reasonCode, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	a.logger.Printf("AUDIT hmi ts=%s request_id=%s user=%s role=%s action=%s target=%s reason=%s result=%s reason_code=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(requestID, 64), sanitizeAudit(user, 32),
		sanitizeAudit(string(role), 16), sanitizeAudit(action, 32), sanitizeAudit(target, 64),
		sanitizeAudit(reason, 80), sanitizeAudit(result, 16), sanitizeAudit(reasonCode, 32), sanitizeAudit(remote, 64))
}

func (a *AuditLogger) PointForce(principal *Principal, id string, release bool, result string, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	username, role := principalIdentity(principal)
	op := "force"
	if release {
		op = "release"
	}
	a.logger.Printf("AUDIT point_force ts=%s user=%s role=%s point=%s op=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
		sanitizeAudit(id, 64), op, sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}

func (a *AuditLogger) AlarmAck(principal *Principal, id string, result string, remote string) {
	a.alarmAction("alarm_ack", principal, id, result, remote)
}

func (a *AuditLogger) AlarmSuppress(principal *Principal, id string, result string, remote string) {
	a.alarmAction("alarm_suppress", principal, id, result, remote)
}

func (a *AuditLogger) alarmAction(action string, principal *Principal, id string, result string, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	username, role := principalIdentity(principal)
	a.logger.Printf("AUDIT %s ts=%s user=%s role=%s alarm=%s result=%s remote=%s",
		action, time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
		sanitizeAudit(id, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}

func (a *AuditLogger) CommissioningTest(principal *Principal, id string, result string, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	username, role := principalIdentity(principal)
	a.logger.Printf("AUDIT commissioning_test ts=%s user=%s role=%s point=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
		sanitizeAudit(id, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
}

func principalIdentity(principal *Principal) (string, string) {
	if principal == nil {
		return "-", "-"
	}
	return principal.Username, string(principal.Role)
}

func SanitizeAudit(value string, max int) string {
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '.' || r == '@' || r == '-' || r == ':' {
			b.WriteRune(r)
		}
		if b.Len() >= max {
			break
		}
	}
	if b.Len() == 0 {
		return "-"
	}
	return b.String()
}

func sanitizeAudit(value string, max int) string {
	return SanitizeAudit(value, max)
}
