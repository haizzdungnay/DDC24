package app

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	webAuth "mkddc-web/internal/auth"
)

// ActivitySchemaVersion tăng khi hình dạng `ActivityEvent` đổi theo cách phá
// tương thích. FE fail-closed khi thấy version lạ thay vì đoán default.
const ActivitySchemaVersion = 1

const (
	activityCapacity   = 2000 // số sự kiện giữ lại (retention theo dung lượng)
	activityCompactAt  = 3000 // số dòng trong file trước khi nén lại
	activityMaxPage    = 200
	activityDefaultTop = 50
)

// ActivityEvent là một dòng nhật ký vận hành đã chuẩn hoá.
//
// Khác với `AlarmHistoryEvent` (vòng đời cảnh báo) và journal thô (debug),
// Activity trả lời đúng một câu hỏi của người trực: "ai đã làm gì trên thiết bị
// này, lúc nào, và kết quả ra sao" — PA3 §8.7.
type ActivityEvent struct {
	ID            uint64 `json:"id"`
	Time          string `json:"time"`
	Kind          string `json:"kind"` // user | system
	Actor         string `json:"actor"`
	Role          string `json:"role,omitempty"`
	Action        string `json:"action"`
	ObjectType    string `json:"objectType,omitempty"`
	ObjectID      string `json:"objectId,omitempty"`
	Outcome       string `json:"outcome"`
	ReasonCode    string `json:"reasonCode,omitempty"`
	CorrelationID string `json:"correlationId,omitempty"`
	Detail        string `json:"detail,omitempty"`
}

type ActivityPage struct {
	SchemaVersion int             `json:"schemaVersion"`
	GeneratedAt   string          `json:"generatedAt"`
	Items         []ActivityEvent `json:"items"`
	NextCursor    *uint64         `json:"nextCursor"`
	Retained      int             `json:"retained"`
	Capacity      int             `json:"capacity"`
}

// ActivityStore giữ một vòng nhớ có giới hạn, đồng thời nối đuôi ra một tệp
// JSONL để sống sót qua restart `mkddc-web`.
//
// Tệp CỐ Ý là append-only trong đường nóng: ghi lại toàn bộ mỗi lần có sự kiện
// sẽ biến một lần bấm nút thành một lần rewrite vài trăm KB trên eMMC. Nén chỉ
// chạy khi số dòng vượt `activityCompactAt`.
type ActivityStore struct {
	mu       sync.Mutex
	path     string
	events   []ActivityEvent // cũ → mới
	nextID   uint64
	lines    int
	now      func() time.Time
	writeErr error
}

func NewActivityStore(path string) *ActivityStore {
	store := &ActivityStore{path: path, now: func() time.Time { return time.Now().UTC() }}
	store.load()
	return store
}

func (s *ActivityStore) load() {
	if s == nil || s.path == "" {
		return
	}
	file, err := os.Open(s.path)
	if err != nil {
		return
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event ActivityEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			// Một dòng hỏng (mất điện giữa lúc ghi) không được làm mất cả kho.
			continue
		}
		s.lines++
		s.events = append(s.events, event)
		if event.ID >= s.nextID {
			s.nextID = event.ID + 1
		}
	}
	if len(s.events) > activityCapacity {
		s.events = append([]ActivityEvent(nil), s.events[len(s.events)-activityCapacity:]...)
	}
	if s.nextID == 0 {
		s.nextID = 1
	}
}

// RecordActivity thoả `webAuth.AuditSink`.
func (s *ActivityStore) RecordActivity(record webAuth.AuditRecord) {
	if s == nil {
		return
	}
	s.Append(ActivityEvent{
		Kind:          record.Kind,
		Actor:         record.Actor,
		Role:          record.Role,
		Action:        record.Action,
		ObjectType:    record.ObjectType,
		ObjectID:      record.ObjectID,
		Outcome:       record.Outcome,
		ReasonCode:    record.ReasonCode,
		CorrelationID: record.CorrelationID,
		Detail:        record.Detail,
	})
}

func (s *ActivityStore) Append(event ActivityEvent) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.nextID == 0 {
		s.nextID = 1
	}
	event.ID = s.nextID
	s.nextID++
	if strings.TrimSpace(event.Time) == "" {
		event.Time = s.now().Format(time.RFC3339Nano)
	}
	if strings.TrimSpace(event.Kind) == "" {
		event.Kind = "user"
	}
	if strings.TrimSpace(event.Actor) == "" {
		event.Actor = "-"
	}
	if strings.TrimSpace(event.Outcome) == "" {
		event.Outcome = "unknown"
	}
	s.events = append(s.events, event)
	if len(s.events) > activityCapacity {
		s.events = append([]ActivityEvent(nil), s.events[len(s.events)-activityCapacity:]...)
	}
	s.persistLocked(event)
}

func (s *ActivityStore) persistLocked(event ActivityEvent) {
	if s.path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o750); err != nil {
		s.writeErr = err
		return
	}
	if s.lines >= activityCompactAt {
		s.compactLocked()
	}
	line, err := json.Marshal(event)
	if err != nil {
		s.writeErr = err
		return
	}
	file, err := os.OpenFile(s.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		s.writeErr = err
		return
	}
	defer file.Close()
	if _, err := file.Write(append(line, '\n')); err != nil {
		s.writeErr = err
		return
	}
	s.lines++
	s.writeErr = nil
}

func (s *ActivityStore) compactLocked() {
	tmp := s.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_TRUNC|os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		s.writeErr = err
		return
	}
	writer := bufio.NewWriter(file)
	for _, event := range s.events {
		line, err := json.Marshal(event)
		if err != nil {
			continue
		}
		_, _ = writer.Write(append(line, '\n'))
	}
	flushErr := writer.Flush()
	closeErr := file.Close()
	if flushErr != nil || closeErr != nil {
		_ = os.Remove(tmp)
		s.writeErr = flushErr
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		s.writeErr = err
		return
	}
	s.lines = len(s.events)
}

type activityQuery struct {
	limit    int
	before   uint64
	hasCurs  bool
	kind     string
	action   string
	objectID string
}

// Query trả về trang sự kiện MỚI NHẤT trước, kèm con trỏ cho trang kế tiếp.
func (s *ActivityStore) Query(q activityQuery) ActivityPage {
	page := ActivityPage{SchemaVersion: ActivitySchemaVersion, Items: []ActivityEvent{}, Capacity: activityCapacity}
	if s == nil {
		page.GeneratedAt = time.Now().UTC().Format(time.RFC3339Nano)
		return page
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	page.GeneratedAt = s.now().Format(time.RFC3339Nano)
	page.Retained = len(s.events)
	limit := q.limit
	if limit <= 0 {
		limit = activityDefaultTop
	}
	if limit > activityMaxPage {
		limit = activityMaxPage
	}
	for i := len(s.events) - 1; i >= 0; i-- {
		event := s.events[i]
		if q.hasCurs && event.ID >= q.before {
			continue
		}
		if q.kind != "" && event.Kind != q.kind {
			continue
		}
		if q.action != "" && !strings.Contains(event.Action, q.action) {
			continue
		}
		if q.objectID != "" && !strings.EqualFold(event.ObjectID, q.objectID) {
			continue
		}
		if len(page.Items) == limit {
			cursor := page.Items[len(page.Items)-1].ID
			page.NextCursor = &cursor
			break
		}
		page.Items = append(page.Items, event)
	}
	return page
}

func (a *App) handleGetActivity(w http.ResponseWriter, r *http.Request) {
	if a.activity == nil {
		writeError(w, http.StatusServiceUnavailable, "activity store unavailable")
		return
	}
	query := r.URL.Query()
	q := activityQuery{
		kind:     strings.ToLower(strings.TrimSpace(query.Get("kind"))),
		action:   strings.ToLower(strings.TrimSpace(query.Get("action"))),
		objectID: strings.TrimSpace(query.Get("objectId")),
	}
	if q.kind != "" && q.kind != "user" && q.kind != "system" {
		writeError(w, http.StatusBadRequest, "kind must be user or system")
		return
	}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		q.limit = limit
	}
	if raw := strings.TrimSpace(query.Get("before")); raw != "" {
		cursor, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "before must be an event id")
			return
		}
		q.before = cursor
		q.hasCurs = true
	}
	writeJSON(w, http.StatusOK, s2Page(a.activity.Query(q)))
}

func s2Page(page ActivityPage) ActivityPage {
	if page.Items == nil {
		page.Items = []ActivityEvent{}
	}
	return page
}

// RecordSystemActivity ghi một sự kiện do chính thiết bị sinh ra (không có
// actor người dùng), ví dụ Core tự nhả override khi TTL hết hạn.
func (a *App) RecordSystemActivity(action, objectType, objectID, outcome, reasonCode, detail string) {
	if a == nil || a.activity == nil {
		return
	}
	a.activity.Append(ActivityEvent{
		Kind:       "system",
		Actor:      "system",
		Action:     webAuth.SanitizeAudit(action, 48),
		ObjectType: webAuth.SanitizeAudit(objectType, 24),
		ObjectID:   webAuth.SanitizeAudit(objectID, 64),
		Outcome:    webAuth.SanitizeAudit(outcome, 24),
		ReasonCode: webAuth.SanitizeAudit(reasonCode, 48),
		Detail:     detail,
	})
}

func (a *App) activityPath() string {
	if a == nil {
		return ""
	}
	dir := strings.TrimSpace(a.cfg.ConfigDir)
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "activity.jsonl")
}
