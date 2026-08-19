package auth

import (
	"log"
	"strings"
	"sync"
	"time"
)

// AuditRecord là một sự kiện audit đã chuẩn hoá, đủ để một kho Activity bền
// vững lưu lại và trả về cho UI (PA3-103/104).
//
// VÌ SAO CẦN
//
// Trước PA3, mọi vết audit chỉ tồn tại dưới dạng dòng `AUDIT …` trong journal.
// Muốn biết "ai vừa ép AO-02 và kết quả ra sao" phải SSH vào bo và đọc
// journalctl — Landing Page không có cách nào hiển thị, và parse journal trong
// một HTTP request là đường vừa chậm vừa dễ vỡ (PA3-D03).
//
// REDACTION
//
// Struct này CỐ Ý không có trường `payload` tự do. Mọi trường đều đi qua
// `SanitizeAudit`/`sanitizeAuditValue` trước khi tới sink, nên không có đường
// nào để một password/token lọt vào kho Activity.
type AuditRecord struct {
	Kind          string // "user" | "system"
	Action        string
	Actor         string
	Role          string
	ObjectType    string
	ObjectID      string
	Outcome       string
	ReasonCode    string
	CorrelationID string
	Detail        string
}

// AuditSink nhận bản sao đã chuẩn hoá của mỗi vết audit. Ghi vào sink phải
// KHÔNG BAO GIỜ chặn đường xử lý request; hiện thực nào có I/O chậm phải tự
// đẩy sang goroutine của nó.
type AuditSink interface {
	RecordActivity(AuditRecord)
}

type AuditLogger struct {
	logger *log.Logger
	mu     sync.RWMutex
	sink   AuditSink
}

func NewAuditLogger(logger *log.Logger) *AuditLogger {
	return &AuditLogger{logger: logger}
}

// SetSink gắn kho Activity. Gọi với nil để tháo.
func (a *AuditLogger) SetSink(sink AuditSink) {
	if a == nil {
		return
	}
	a.mu.Lock()
	a.sink = sink
	a.mu.Unlock()
}

func (a *AuditLogger) emit(record AuditRecord) {
	if a == nil {
		return
	}
	a.mu.RLock()
	sink := a.sink
	a.mu.RUnlock()
	if sink == nil {
		return
	}
	sink.RecordActivity(AuditRecord{
		Kind:          orDefault(record.Kind, "user"),
		Action:        SanitizeAudit(record.Action, 48),
		Actor:         SanitizeAudit(record.Actor, 32),
		Role:          SanitizeAudit(record.Role, 16),
		ObjectType:    SanitizeAudit(record.ObjectType, 24),
		ObjectID:      SanitizeAudit(record.ObjectID, 64),
		Outcome:       SanitizeAudit(record.Outcome, 24),
		ReasonCode:    SanitizeAudit(record.ReasonCode, 48),
		CorrelationID: SanitizeAudit(record.CorrelationID, 64),
		Detail:        sanitizeAuditValue(record.Detail, 160),
	})
}

func orDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func (a *AuditLogger) Login(username, role, result, remote string) {
	if a == nil {
		return
	}
	if a.logger != nil {
		a.logger.Printf("AUDIT login ts=%s user=%s role=%s result=%s remote=%s",
			time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16), result, sanitizeAudit(remote, 64))
	}
	a.emit(AuditRecord{Action: "login", Actor: username, Role: role, ObjectType: "session", ObjectID: username, Outcome: result})
}

func (a *AuditLogger) PointMetadata(user, pointID, field, oldValue, newValue, result, requestID, remote string) {
	if a == nil {
		return
	}
	if a.logger != nil {
		a.logger.Printf("AUDIT point_metadata ts=%s point_id=%s field=%s old=%s new=%s actor=%s request_id=%s result=%s remote=%s",
			time.Now().UTC().Format(time.RFC3339), sanitizeAudit(pointID, 64), sanitizeAudit(field, 16), sanitizeAuditValue(oldValue, 128), sanitizeAuditValue(newValue, 128), sanitizeAudit(user, 32), sanitizeAudit(requestID, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
	}
	a.emit(AuditRecord{
		Action: "point_metadata", Actor: user, ObjectType: "point", ObjectID: pointID,
		Outcome: result, CorrelationID: requestID,
		Detail: field + ": " + sanitizeAuditValue(oldValue, 48) + " -> " + sanitizeAuditValue(newValue, 48),
	})
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
	a.ChangeWithDetail(user, action, target, result, remote, "")
}

// ChangeWithDetail — `T57-3.14`: vết sửa cấu hình mang theo TÓM TẮT KHÁC BIỆT.
//
// Trước đây nhật ký chỉ nói "ai đó đã sửa `io_config.conf` lúc 14:03". Khi điều
// tra một sự cố, câu hỏi luôn là *sửa cái gì*, và câu trả lời trước đây chỉ có
// bằng cách so hai bản sao lưu — nếu còn bản sao lưu.
//
// `detail` phải là tóm tắt ĐÃ RÚT GỌN chứ không phải cả tệp cấu hình: nhật ký
// hoạt động là vòng nhớ có hạn, nhét nguyên một config vào một sự kiện sẽ đẩy
// hàng chục sự kiện khác ra khỏi vòng.
func (a *AuditLogger) ChangeWithDetail(user, action, target, result, remote, detail string) {
	if a == nil {
		return
	}
	if a.logger != nil {
		a.logger.Printf("AUDIT change ts=%s user=%s action=%s target=%s result=%s remote=%s detail=%s",
			time.Now().UTC().Format(time.RFC3339), sanitizeAudit(user, 32), sanitizeAudit(action, 32), sanitizeAudit(target, 64), sanitizeAudit(result, 32), sanitizeAudit(remote, 64), sanitizeAuditValue(detail, 256))
	}
	a.emit(AuditRecord{Action: action, Actor: user, ObjectType: "config", ObjectID: target, Outcome: result, Detail: detail})
}

func (a *AuditLogger) HMI(user string, role Role, requestID, action, target, reason, result, reasonCode, remote string) {
	if a == nil {
		return
	}
	if a.logger != nil {
		a.logger.Printf("AUDIT hmi ts=%s request_id=%s user=%s role=%s action=%s target=%s reason=%s result=%s reason_code=%s remote=%s",
			time.Now().UTC().Format(time.RFC3339), sanitizeAudit(requestID, 64), sanitizeAudit(user, 32),
			sanitizeAudit(string(role), 16), sanitizeAudit(action, 32), sanitizeAudit(target, 64),
			sanitizeAudit(reason, 80), sanitizeAudit(result, 16), sanitizeAudit(reasonCode, 32), sanitizeAudit(remote, 64))
	}
	a.emit(AuditRecord{
		Action: "hmi_" + action, Actor: user, Role: string(role), ObjectType: "point", ObjectID: target,
		Outcome: result, ReasonCode: reasonCode, CorrelationID: requestID, Detail: reason,
	})
}

func (a *AuditLogger) PointForce(principal *Principal, id string, release bool, result string, remote string) {
	if a == nil {
		return
	}
	username, role := principalIdentity(principal)
	op := "force"
	if release {
		op = "release"
	}
	if a.logger != nil {
		a.logger.Printf("AUDIT point_force ts=%s user=%s role=%s point=%s op=%s result=%s remote=%s",
			time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
			sanitizeAudit(id, 64), op, sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
	}
	a.emit(AuditRecord{Action: "point_" + op, Actor: username, Role: role, ObjectType: "point", ObjectID: id, Outcome: result})
}

// PointOverride ghi một lệnh override có TTL do Core sở hữu (PA3-107).
// `ttlS = 0` nghĩa là lệnh không kèm TTL, không phải "hết hạn ngay".
func (a *AuditLogger) PointOverride(principal *Principal, id string, ttlS uint32, remainingS uint32, result, reasonCode, correlationID, remote string) {
	if a == nil {
		return
	}
	username, role := principalIdentity(principal)
	if a.logger != nil {
		a.logger.Printf("AUDIT point_override ts=%s user=%s role=%s point=%s ttl_s=%d remaining_s=%d result=%s reason_code=%s request_id=%s remote=%s",
			time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
			sanitizeAudit(id, 64), ttlS, remainingS, sanitizeAudit(result, 16), sanitizeAudit(reasonCode, 32),
			sanitizeAudit(correlationID, 64), sanitizeAudit(remote, 64))
	}
	detail := "ttlS=" + itoa(int(ttlS))
	if remainingS > 0 {
		detail += " remainingS=" + itoa(int(remainingS))
	}
	a.emit(AuditRecord{
		Action: "point_override", Actor: username, Role: role, ObjectType: "point", ObjectID: id,
		Outcome: result, ReasonCode: reasonCode, CorrelationID: correlationID, Detail: detail,
	})
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buf [20]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func (a *AuditLogger) AlarmAck(principal *Principal, id string, result string, remote string) {
	a.alarmAction("alarm_ack", principal, id, result, remote)
}

func (a *AuditLogger) AlarmSuppress(principal *Principal, id string, result string, remote string) {
	a.alarmAction("alarm_suppress", principal, id, result, remote)
}

func (a *AuditLogger) alarmAction(action string, principal *Principal, id string, result string, remote string) {
	if a == nil {
		return
	}
	username, role := principalIdentity(principal)
	if a.logger != nil {
		a.logger.Printf("AUDIT %s ts=%s user=%s role=%s alarm=%s result=%s remote=%s",
			action, time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
			sanitizeAudit(id, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
	}
	a.emit(AuditRecord{Action: action, Actor: username, Role: role, ObjectType: "alarm", ObjectID: id, Outcome: result})
}

func (a *AuditLogger) CommissioningTest(principal *Principal, id string, result string, remote string) {
	if a == nil {
		return
	}
	username, role := principalIdentity(principal)
	if a.logger != nil {
		a.logger.Printf("AUDIT commissioning_test ts=%s user=%s role=%s point=%s result=%s remote=%s",
			time.Now().UTC().Format(time.RFC3339), sanitizeAudit(username, 32), sanitizeAudit(role, 16),
			sanitizeAudit(id, 64), sanitizeAudit(result, 16), sanitizeAudit(remote, 64))
	}
	a.emit(AuditRecord{Action: "commissioning_test", Actor: username, Role: role, ObjectType: "point", ObjectID: id, Outcome: result})
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
