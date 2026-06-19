package main

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

func (a *AuditLogger) Change(user, action, target, result, remote string) {
	if a == nil || a.logger == nil {
		return
	}
	a.logger.Printf("AUDIT change ts=%s user=%s action=%s target=%s result=%s remote=%s",
		time.Now().UTC().Format(time.RFC3339), sanitizeAudit(user, 32), sanitizeAudit(action, 32), sanitizeAudit(target, 64), sanitizeAudit(result, 32), sanitizeAudit(remote, 64))
}

func sanitizeAudit(value string, max int) string {
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
