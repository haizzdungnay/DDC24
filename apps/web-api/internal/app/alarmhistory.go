package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	alarmHistoryDefaultLimit = 200
	alarmHistoryMaxLimit     = 1000
)

type AlarmHistoryStore struct {
	path string
	mu   sync.Mutex
}

func NewAlarmHistoryStore(path string) *AlarmHistoryStore {
	return &AlarmHistoryStore{path: path}
}

func (s *AlarmHistoryStore) Append(ctx context.Context, event AlarmHistoryEvent) error {
	if s == nil || s.path == "" {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if event.EventID == "" {
		event.EventID = requestID()
	}
	if event.Time == "" {
		event.Time = time.Now().UTC().Format(time.RFC3339Nano)
	}
	line, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode alarm history: %w", err)
	}
	line = append(line, '\n')

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), alarmSettingsDirPerm); err != nil {
		return fmt.Errorf("prepare alarm history dir: %w", err)
	}
	_ = os.Chmod(filepath.Dir(s.path), alarmSettingsDirPerm)
	f, err := os.OpenFile(s.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, alarmSettingsFilePerm)
	if err != nil {
		return fmt.Errorf("open alarm history: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(line); err != nil {
		return fmt.Errorf("write alarm history: %w", err)
	}
	_ = os.Chmod(s.path, alarmSettingsFilePerm)
	return nil
}

type AlarmHistoryFilter struct {
	Text       string
	Alarm      string
	Name       string
	From       *time.Time
	To         *time.Time
	Events     map[string]bool
	Severities map[string]bool
	Statuses   map[string]bool
}

func (s *AlarmHistoryStore) List(ctx context.Context, limit int) ([]AlarmHistoryEvent, error) {
	return s.ListFiltered(ctx, limit, AlarmHistoryFilter{})
}

func (s *AlarmHistoryStore) ListFiltered(ctx context.Context, limit int, filter AlarmHistoryFilter) ([]AlarmHistoryEvent, error) {
	if s == nil || s.path == "" {
		return []AlarmHistoryEvent{}, nil
	}
	if limit == 0 {
		limit = alarmHistoryDefaultLimit
	}
	if limit > alarmHistoryMaxLimit {
		limit = alarmHistoryMaxLimit
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []AlarmHistoryEvent{}, nil
		}
		return nil, fmt.Errorf("read alarm history: %w", err)
	}
	defer f.Close()

	capHint := limit
	if capHint < 0 {
		capHint = alarmHistoryDefaultLimit
	}
	events := make([]AlarmHistoryEvent, 0, capHint)
	/* T63-108 (PERF-API-03): giữ `limit` sự kiện CUỐI bằng vòng đệm, không dịch
	 * mảng. Bản trước `copy(events, events[1:])` sau MỖI sự kiện vượt `limit`:
	 * O(số dòng × limit). Với tệp lịch sử 20 000 dòng và `limit = 1000` (đúng
	 * mức `/alarms` dùng khi Core im và mức trang Cảnh báo/metrics dùng), đo
	 * HOST ~190 ms CPU cho MỘT lượt đọc — và tệp này chỉ có thêm, không bao giờ
	 * ngắn lại. Vòng đệm cho cùng kết quả (cùng các sự kiện, cùng thứ tự) với
	 * O(số dòng). */
	head := 0
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		var event AlarmHistoryEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		if !alarmHistoryMatches(event, filter) {
			continue
		}
		if limit > 0 && len(events) == limit {
			events[head] = event
			head = (head + 1) % limit
			continue
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan alarm history: %w", err)
	}
	if head > 0 {
		// Phần tử cũ nhất đang ở `head`: xoay về đúng thứ tự trong tệp.
		ordered := make([]AlarmHistoryEvent, 0, len(events))
		ordered = append(ordered, events[head:]...)
		events = append(ordered, events[:head]...)
	}
	return events, nil
}

type AlarmHistoryTracker struct {
	mu      sync.Mutex
	visible map[string]AlarmDTO
}

func NewAlarmHistoryTracker() *AlarmHistoryTracker {
	return &AlarmHistoryTracker{visible: map[string]AlarmDTO{}}
}

func (t *AlarmHistoryTracker) Reconcile(alarms []AlarmDTO, now time.Time) []AlarmHistoryEvent {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	next := make(map[string]AlarmDTO, len(alarms))
	events := make([]AlarmHistoryEvent, 0)
	for _, alarm := range alarms {
		id := strings.TrimSpace(alarm.ID)
		if id == "" {
			continue
		}
		alarm.ID = id
		next[id] = alarm
		prev, existed := t.visible[id]
		if !existed {
			if alarmConditionActive(alarm.Status) {
				events = append(events, historyEventFromAlarm("started", alarm, alarm.Time, ""))
			}
			continue
		}
		if !alarmConditionActive(prev.Status) && alarmConditionActive(alarm.Status) {
			events = append(events, historyEventFromAlarm("started", alarm, now.Format(time.RFC3339Nano), ""))
		}
		if alarmConditionActive(prev.Status) && !alarmConditionActive(alarm.Status) {
			events = append(events, historyEndEvent(alarm, now.Format(time.RFC3339Nano)))
		}
	}
	for id, prev := range t.visible {
		if _, ok := next[id]; ok {
			continue
		}
		if alarmConditionActive(prev.Status) {
			events = append(events, historyEndEvent(prev, now.Format(time.RFC3339Nano)))
		}
	}
	t.visible = next
	return events
}

func alarmConditionActive(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "acked":
		return true
	default:
		return false
	}
}

func historyEventFromAlarm(eventType string, alarm AlarmDTO, timestamp string, user string) AlarmHistoryEvent {
	if strings.TrimSpace(timestamp) == "" {
		timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return AlarmHistoryEvent{
		Time:         timestamp,
		Event:        eventType,
		AlarmID:      alarm.ID,
		User:         user,
		Severity:     alarm.Severity,
		Status:       alarm.Status,
		Message:      alarm.Message,
		Source:       alarm.Source,
		Value:        alarm.Value,
		Detail:       alarm.Detail,
		TriggerLevel: alarm.TriggerLevel,
		Threshold:    alarm.Threshold,
		Active:       alarm.Active,
	}
}

func historyEndEvent(alarm AlarmDTO, timestamp string) AlarmHistoryEvent {
	event := historyEventFromAlarm("ended", alarm, timestamp, "")
	event.Status = "normal"
	return event
}

func (a *App) handleAlarmHistory(w http.ResponseWriter, r *http.Request) {
	if a.alarmHistory == nil {
		writeJSON(w, http.StatusOK, []AlarmHistoryEvent{})
		return
	}
	limit, err := parseAlarmHistoryLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	filter, err := parseAlarmHistoryFilter(r.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	events, err := a.alarmHistory.ListFiltered(r.Context(), limit, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, events)
}

func (a *App) StartAlarmHistory(ctx context.Context) {
	if a == nil || a.alarmHistory == nil || a.alarmTracker == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				alarms, degraded := a.currentAlarms(ctx)
				if degraded {
					continue
				}
				a.recordAlarmSnapshot(ctx, alarms)
			}
		}
	}()
}

func parseAlarmHistoryLimit(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return alarmHistoryDefaultLimit, nil
	}
	if strings.EqualFold(raw, "all") {
		return -1, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit <= 0 || limit > alarmHistoryMaxLimit {
		return 0, fmt.Errorf("limit must be integer in range 1..%d or all", alarmHistoryMaxLimit)
	}
	return limit, nil
}

func parseAlarmHistoryFilter(values url.Values) (AlarmHistoryFilter, error) {
	from, err := parseHistoryTime(values.Get("from"), false)
	if err != nil {
		return AlarmHistoryFilter{}, err
	}
	to, err := parseHistoryTime(values.Get("to"), true)
	if err != nil {
		return AlarmHistoryFilter{}, err
	}
	return AlarmHistoryFilter{
		Text:       firstHistoryParam(values, "text", "q"),
		Alarm:      firstHistoryParam(values, "alarm", "alarmId", "id"),
		Name:       firstHistoryParam(values, "name"),
		From:       from,
		To:         to,
		Events:     parseHistorySet(values.Get("event"), normalizeHistoryEvent),
		Severities: parseHistorySet(values.Get("severity"), strings.ToLower),
		Statuses:   parseHistorySet(values.Get("status"), normalizeHistoryStatus),
	}, nil
}

func firstHistoryParam(values url.Values, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(values.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

func parseHistoryTime(raw string, endOfDay bool) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return &parsed, nil
	}
	if parsed, err := time.Parse("2006-01-02", raw); err == nil {
		if endOfDay {
			parsed = parsed.Add(24*time.Hour - time.Nanosecond)
		}
		return &parsed, nil
	}
	return nil, fmt.Errorf("time filter must be RFC3339 or YYYY-MM-DD")
}

func parseHistorySet(raw string, normalize func(string) string) map[string]bool {
	out := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		item := normalize(strings.TrimSpace(part))
		if item != "" {
			out[item] = true
		}
	}
	return out
}

func normalizeHistoryEvent(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "start":
		return "started"
	case "end":
		return "ended"
	case "ack":
		return "acked"
	default:
		return strings.ToLower(strings.TrimSpace(raw))
	}
}

func normalizeHistoryStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "clear", "cleared", "end", "ended":
		return "normal"
	default:
		return strings.ToLower(strings.TrimSpace(raw))
	}
}

func alarmHistoryMatches(event AlarmHistoryEvent, filter AlarmHistoryFilter) bool {
	if filter.Text != "" && !strings.Contains(strings.ToLower(alarmHistorySearchText(event)), strings.ToLower(filter.Text)) {
		return false
	}
	if filter.Alarm != "" && !strings.Contains(strings.ToLower(alarmHistoryAlarmText(event)), strings.ToLower(filter.Alarm)) {
		return false
	}
	if filter.Name != "" && !strings.Contains(strings.ToLower(alarmHistoryNameText(event)), strings.ToLower(filter.Name)) {
		return false
	}
	if len(filter.Events) > 0 && !alarmHistoryEventMatches(event.Event, filter.Events) {
		return false
	}
	if len(filter.Severities) > 0 && !filter.Severities[strings.ToLower(event.Severity)] {
		return false
	}
	if len(filter.Statuses) > 0 && !filter.Statuses[normalizeHistoryStatus(event.Status)] {
		return false
	}
	if filter.From != nil || filter.To != nil {
		eventTime, err := time.Parse(time.RFC3339Nano, event.Time)
		if err != nil {
			return false
		}
		if filter.From != nil && eventTime.Before(*filter.From) {
			return false
		}
		if filter.To != nil && eventTime.After(*filter.To) {
			return false
		}
	}
	return true
}

func alarmHistoryEventMatches(raw string, allowed map[string]bool) bool {
	event := normalizeHistoryEvent(raw)
	if allowed[event] {
		return true
	}
	return allowed["setting"] && strings.HasPrefix(event, "setting_")
}

func alarmHistorySearchText(event AlarmHistoryEvent) string {
	parts := []string{
		event.EventID, event.Event, event.AlarmID, event.User, event.Severity,
		event.Status, event.Message, event.Source, event.Value, event.Detail,
		event.TriggerLevel, event.Threshold,
	}
	if event.Before != nil {
		parts = append(parts, event.Before.ID, event.Before.Label, event.Before.Priority)
	}
	if event.After != nil {
		parts = append(parts, event.After.ID, event.After.Label, event.After.Priority)
	}
	return strings.Join(parts, " ")
}

func alarmHistoryAlarmText(event AlarmHistoryEvent) string {
	parts := []string{event.AlarmID, event.Source}
	if event.Before != nil {
		parts = append(parts, event.Before.ID)
	}
	if event.After != nil {
		parts = append(parts, event.After.ID)
	}
	return strings.Join(parts, " ")
}

func alarmHistoryNameText(event AlarmHistoryEvent) string {
	parts := []string{event.Message}
	if event.Before != nil {
		parts = append(parts, event.Before.Label)
	}
	if event.After != nil {
		parts = append(parts, event.After.Label)
	}
	return strings.Join(parts, " ")
}

func (a *App) recordAlarmSnapshot(ctx context.Context, alarms []AlarmDTO) {
	if a == nil || a.alarmHistory == nil || a.alarmTracker == nil {
		return
	}
	events := a.alarmTracker.Reconcile(alarms, time.Now().UTC())
	for _, event := range events {
		a.appendAlarmHistory(ctx, event)
	}
}

func (a *App) recordAlarmAck(ctx context.Context, id string, user string, alarms []AlarmDTO) {
	if a == nil || a.alarmHistory == nil {
		return
	}
	var event AlarmHistoryEvent
	for _, alarm := range alarms {
		if alarm.ID == id {
			event = historyEventFromAlarm("acked", alarm, time.Now().UTC().Format(time.RFC3339Nano), user)
			event.Status = "acked"
			event.Active = true
			break
		}
	}
	if event.Event == "" {
		event = AlarmHistoryEvent{
			Time:    time.Now().UTC().Format(time.RFC3339Nano),
			Event:   "acked",
			AlarmID: id,
			User:    user,
			Status:  "acked",
			Active:  true,
		}
	}
	a.appendAlarmHistory(ctx, event)
}

func (a *App) recordAlarmReturn(ctx context.Context, id string, user string, alarms []AlarmDTO) {
	if a == nil || a.alarmHistory == nil {
		return
	}
	var event AlarmHistoryEvent
	for _, alarm := range alarms {
		if alarm.ID == id {
			event = historyEventFromAlarm("returned", alarm, time.Now().UTC().Format(time.RFC3339Nano), user)
			event.Status = "active"
			event.Active = true
			break
		}
	}
	if event.Event == "" {
		event = AlarmHistoryEvent{
			Time:    time.Now().UTC().Format(time.RFC3339Nano),
			Event:   "returned",
			AlarmID: id,
			User:    user,
			Status:  "active",
			Active:  true,
		}
	}
	a.appendAlarmHistory(ctx, event)
}

func (a *App) mergeAlarmHistoryRows(ctx context.Context, alarms []AlarmDTO, includeMissing bool) []AlarmDTO {
	if a == nil || a.alarmHistory == nil {
		return alarms
	}
	/* T63-108 (PERF-API-03): chỉ đọc kho lịch sử khi THẬT SỰ cần dựng lại hàng
	 * từ lịch sử (`includeMissing` — Core không đọc được). Bản trước đọc trọn
	 * tệp lịch sử (quét + giải mã JSON từng dòng, giữ 1000 dòng cuối, dưới khoá
	 * của kho — khoá mà vòng ghi lịch sử mỗi giây cũng cần) ở MỌI lượt
	 * `GET /alarms`, rồi bỏ đi toàn bộ kết quả vì vòng lặp bên dưới `continue`
	 * mọi sự kiện khi `includeMissing == false`. `/alarms` là GET bị poll dày
	 * nhất của trang Cảnh báo (2 s), nên đó là I/O vô ích tỷ lệ với cỡ lịch sử. */
	var events []AlarmHistoryEvent
	if includeMissing {
		var err error
		events, err = a.alarmHistory.ListFiltered(ctx, alarmHistoryMaxLimit, AlarmHistoryFilter{})
		if err != nil {
			return alarms
		}
	}
	byID := make(map[string]AlarmDTO, len(alarms))
	liveIDs := make(map[string]bool, len(alarms))
	order := make([]string, 0, len(alarms))
	for _, alarm := range alarms {
		if strings.TrimSpace(alarm.ID) == "" {
			continue
		}
		if !containsString(order, alarm.ID) {
			order = append(order, alarm.ID)
		}
		byID[alarm.ID] = alarm
		liveIDs[alarm.ID] = true
	}
	for _, event := range events {
		id := strings.TrimSpace(event.AlarmID)
		if id == "" {
			continue
		}
		if liveIDs[id] {
			continue
		}
		if !includeMissing {
			continue
		}
		switch normalizeHistoryEvent(event.Event) {
		case "started", "returned":
			if !containsString(order, id) {
				order = append(order, id)
			}
			byID[id] = alarmDTOFromHistory(event, "active", true)
		case "acked":
			if !containsString(order, id) {
				order = append(order, id)
			}
			byID[id] = alarmDTOFromHistory(event, "acked", true)
		case "ended":
			if !containsString(order, id) {
				order = append(order, id)
			}
			byID[id] = alarmDTOFromHistory(event, "cleared", false)
		}
	}
	out := make([]AlarmDTO, 0, len(order))
	for _, id := range order {
		if alarm, ok := byID[id]; ok {
			out = append(out, alarm)
		}
	}
	return out
}

func alarmDTOFromHistory(event AlarmHistoryEvent, status string, active bool) AlarmDTO {
	return AlarmDTO{
		ID:           event.AlarmID,
		Time:         event.Time,
		Severity:     alarmFirstNonEmpty(event.Severity, "info"),
		Status:       status,
		Message:      alarmFirstNonEmpty(event.Message, "Alarm "+event.AlarmID),
		Source:       alarmFirstNonEmpty(event.Source, "SYSTEM"),
		Value:        event.Value,
		Detail:       event.Detail,
		TriggerLevel: event.TriggerLevel,
		Threshold:    event.Threshold,
		Active:       active,
		Returnable:   boolPtr(false),
	}
}

func alarmFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func (a *App) recordAlarmSettingHistory(ctx context.Context, user string, before []AlarmSetting, after []AlarmSetting) {
	if a == nil || a.alarmHistory == nil {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	beforeByID := alarmSettingsByID(before)
	afterByID := alarmSettingsByID(after)
	for _, id := range sortedAlarmSettingIDs(afterByID) {
		next := afterByID[id]
		prev, existed := beforeByID[id]
		nextCopy := next
		event := AlarmHistoryEvent{Time: now, AlarmID: id, User: user, Message: next.Label}
		switch {
		case !existed:
			event.Event = "setting_created"
			event.After = &nextCopy
		case !reflect.DeepEqual(prev, next):
			prevCopy := prev
			event.Event = "setting_changed"
			event.Before = &prevCopy
			event.After = &nextCopy
		default:
			continue
		}
		a.appendAlarmHistory(ctx, event)
	}
	for _, id := range sortedAlarmSettingIDs(beforeByID) {
		prev := beforeByID[id]
		if _, ok := afterByID[id]; ok {
			continue
		}
		prevCopy := prev
		a.appendAlarmHistory(ctx, AlarmHistoryEvent{
			Time:    now,
			Event:   "setting_deleted",
			AlarmID: id,
			User:    user,
			Message: prev.Label,
			Before:  &prevCopy,
		})
	}
}

func alarmSettingsByID(rows []AlarmSetting) map[string]AlarmSetting {
	out := make(map[string]AlarmSetting, len(rows))
	for _, row := range rows {
		id := strings.TrimSpace(row.ID)
		if id != "" {
			out[id] = row
		}
	}
	return out
}

func sortedAlarmSettingIDs(rows map[string]AlarmSetting) []string {
	ids := make([]string, 0, len(rows))
	for id := range rows {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (a *App) appendAlarmHistory(ctx context.Context, event AlarmHistoryEvent) {
	if a == nil || a.alarmHistory == nil {
		return
	}
	if err := a.alarmHistory.Append(ctx, event); err != nil && a.logger != nil {
		a.logger.Printf("WARN alarm_history append failed event=%s alarm=%s err=%v", event.Event, event.AlarmID, err)
	}
}

func (a *App) alarmHistoryPath() string {
	if a != nil && a.cfg.AlarmHistoryPath != "" {
		return a.cfg.AlarmHistoryPath
	}
	return a.configPath("alarm_history.jsonl")
}
