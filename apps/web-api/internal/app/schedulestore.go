package app

// Lưu trữ Schedule Object v3.1 + lịch sử revision + audit
// (Plan 50 SCHD-122, 123, 130, 142).
//
// Bố cục trên đĩa:
//
//	/data/config/schedule.conf                       ← tập lịch đang dùng
//	/data/config/schedule.conf.v1.bak                ← bản định dạng cũ, KHÔNG xoá
//	/data/config/schedule.d/<SCH-ID>/rev-000005.json ← ≥10 revision gần nhất
//	/data/config/schedule.d/<SCH-ID>/revisions.json  ← chỉ mục revision
//	/data/config/schedule.d/<SCH-ID>/audit.jsonl     ← append-only
//
// Tách theo lịch thay vì một tệp lịch sử khổng lồ vì thao tác thường gặp là
// "xem lịch sử của MỘT lịch", và vì hỏng một tệp không kéo theo mất lịch sử của
// 63 lịch còn lại.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var errScheduleNotFound = errors.New("schedule not found")

// scheduleMutex tuần tự hoá đọc-sửa-ghi. Hai request PUT song song trên cùng
// tệp là cách chắc chắn để mất một bản chỉnh sửa.
var scheduleMutex sync.Mutex

type scheduleFile struct {
	Schedules []ScheduleObject `json:"schedules"`
	// HolidayGroups đi cùng tệp để core nạp một lần; xem
	// load_schedule_config() phía C++ nhận cả hai hình dạng.
	HolidayGroups []scheduleHolidayGroup `json:"holiday_groups,omitempty"`
}

type scheduleHolidayGroup struct {
	GroupID string   `json:"group_id"`
	Name    string   `json:"name,omitempty"`
	Dates   []string `json:"dates"`
}

func (a *App) schedulePath() string {
	if a != nil && a.cfg.ScheduleConfPath != "" {
		return a.cfg.ScheduleConfPath
	}
	return a.configPath("schedule.conf")
}

func (a *App) scheduleStateDir() string {
	return filepath.Join(filepath.Dir(a.schedulePath()), "schedule.d")
}

func (a *App) scheduleRevisionDir(id string) string {
	return filepath.Join(a.scheduleStateDir(), id)
}

// ── Nạp ───────────────────────────────────────────────────────────────────

// LoadSchedules đọc tập lịch. Gặp định dạng cũ thì chuyển đổi, ghi bản v3.1 và
// giữ bản cũ thành .v1.bak (ADR-023 QĐ-6).
func (a *App) LoadSchedules(ctx context.Context) ([]ScheduleObject, error) {
	list, _, err := a.loadSchedulesWithNotes(ctx)
	return list, err
}

func (a *App) loadSchedulesWithNotes(ctx context.Context) ([]ScheduleObject, []string, error) {
	select {
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	default:
	}

	path := a.schedulePath()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []ScheduleObject{}, nil, nil
		}
		return nil, nil, fmt.Errorf("đọc %s: %w", path, err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return []ScheduleObject{}, nil, nil
	}

	if isScheduleV1Payload(data) {
		now := time.Now().UTC().Format(time.RFC3339)
		migrated, notes, mErr := migrateSchedulesV1(data, now)
		if mErr != nil {
			return nil, nil, mErr
		}
		// Giữ bản cũ TRƯỚC khi ghi đè. Nếu bước sao lưu hỏng thì dừng — thà
		// không di trú còn hơn di trú mà mất đường lùi.
		backup := path + ".v1.bak"
		if _, statErr := os.Stat(backup); errors.Is(statErr, os.ErrNotExist) {
			if wErr := writeConfigFileAtomic(backup, data, 0o600); wErr != nil {
				return nil, nil, fmt.Errorf("sao lưu %s: %w", backup, wErr)
			}
		}
		if wErr := a.writeScheduleFile(migrated, nil); wErr != nil {
			return nil, nil, wErr
		}
		notes = append([]string{fmt.Sprintf(
			"%d lịch đã chuyển từ định dạng cũ sang v3.1; bản cũ giữ tại %s. "+
				"Hãy kiểm tra rồi publish lại — mọi lịch đang ở trạng thái DRAFT và đang tắt.",
			len(migrated), filepath.Base(backup))}, notes...)
		return migrated, notes, nil
	}

	list, groups, err := decodeScheduleFile(data)
	if err != nil {
		return nil, nil, fmt.Errorf("đọc %s: %w", path, err)
	}
	_ = groups
	normalizeSchedules(list)
	return list, nil, nil
}

func decodeScheduleFile(data []byte) ([]ScheduleObject, []scheduleHolidayGroup, error) {
	trimmed := strings.TrimLeft(string(data), " \t\r\n")
	if strings.HasPrefix(trimmed, "[") {
		var list []ScheduleObject
		if err := json.Unmarshal(data, &list); err != nil {
			return nil, nil, err
		}
		return list, nil, nil
	}
	var wrapper scheduleFile
	if err := json.Unmarshal(data, &wrapper); err != nil {
		return nil, nil, err
	}
	return wrapper.Schedules, wrapper.HolidayGroups, nil
}

// normalizeSchedules bù các trường dẫn xuất và bảo đảm mảng không bao giờ nil —
// `null` trong JSON trả về cho frontend là một nguồn lỗi không cần thiết.
func normalizeSchedules(list []ScheduleObject) {
	for i := range list {
		s := &list[i]
		if s.SchemaVersion == "" {
			s.SchemaVersion = scheduleSchemaVersion
		}
		if s.Timezone == "" {
			s.Timezone = "Asia/Ho_Chi_Minh"
		}
		if s.Status == "" {
			s.Status = scheduleStatusDraft
		}
		if s.PriorityForWriting == 0 {
			s.PriorityForWriting = 16
		}
		// Dẫn xuất, luôn ghi đè: client không được tự đặt.
		s.CorePriorityLevel = scheduleCorePriorityLevel
		if s.ExceptionSchedule == nil {
			s.ExceptionSchedule = []ScheduleException{}
		}
		if s.TargetObjects == nil {
			s.TargetObjects = []ScheduleTargetObject{}
		}
		for _, d := range s.WeeklySchedule.Days() {
			if *d.Events == nil {
				*d.Events = []ScheduleTimeValue{}
			}
		}
		for j := range s.TargetObjects {
			t := &s.TargetObjects[j]
			if t.TargetType == "INTERNAL_POINT" && t.Channel != nil && t.PointID == "" {
				t.PointID = formatSchedulePointID(t.PointKind, *t.Channel)
			}
		}
	}
}

// ── Ghi ───────────────────────────────────────────────────────────────────

func (a *App) writeScheduleFile(list []ScheduleObject, groups []scheduleHolidayGroup) error {
	if list == nil {
		list = []ScheduleObject{}
	}
	normalizeSchedules(list)
	payload := scheduleFile{Schedules: list, HolidayGroups: groups}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("mã hoá schedules: %w", err)
	}
	data = append(data, '\n')

	path := a.schedulePath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("tạo thư mục cấu hình: %w", err)
	}
	_ = os.Chmod(dir, 0o700)
	if err := writeConfigFileAtomic(path, data, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}

// SaveSchedules ghi cả tập. Dùng cho nhập hàng loạt và cho di trú.
func (a *App) SaveSchedules(ctx context.Context, list []ScheduleObject) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()
	return a.writeScheduleFile(list, nil)
}

// ── Revision ──────────────────────────────────────────────────────────────

type scheduleRevisionIndex struct {
	Entries []ScheduleRevisionInfo `json:"entries"`
}

// appendScheduleRevision lưu ảnh chụp một revision và cắt bớt bản quá cũ.
// Đặc tả §13.3 đòi giữ tối thiểu 10 bản gần nhất.
func (a *App) appendScheduleRevision(obj ScheduleObject, actor, reason string, rollbackOf *uint64) error {
	dir := a.scheduleRevisionDir(obj.ScheduleID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("tạo thư mục revision: %w", err)
	}

	// Ảnh chụp là CẤU HÌNH, không kèm runtime — runtime là sự thật nhất thời
	// của controller, lưu vào lịch sử là lưu một thứ không tái lập được.
	snapshot := obj
	snapshot.Runtime = nil
	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	file := filepath.Join(dir, fmt.Sprintf("rev-%06d.json", obj.Revision))
	if err := writeConfigFileAtomic(file, append(data, '\n'), 0o600); err != nil {
		return err
	}

	index, err := a.loadScheduleRevisionIndex(obj.ScheduleID)
	if err != nil {
		return err
	}
	index.Entries = append(index.Entries, ScheduleRevisionInfo{
		Revision:   obj.Revision,
		CreatedAt:  obj.UpdatedAt,
		CreatedBy:  actor,
		Reason:     reason,
		Published:  obj.Status == scheduleStatusPublished || obj.Status == scheduleStatusActive,
		RollbackOf: rollbackOf,
	})
	sort.Slice(index.Entries, func(i, j int) bool {
		return index.Entries[i].Revision > index.Entries[j].Revision
	})
	if len(index.Entries) > maxScheduleRevisions {
		for _, old := range index.Entries[maxScheduleRevisions:] {
			_ = os.Remove(filepath.Join(dir, fmt.Sprintf("rev-%06d.json", old.Revision)))
		}
		index.Entries = index.Entries[:maxScheduleRevisions]
	}
	return a.saveScheduleRevisionIndex(obj.ScheduleID, index)
}

func (a *App) loadScheduleRevisionIndex(id string) (scheduleRevisionIndex, error) {
	var index scheduleRevisionIndex
	path := filepath.Join(a.scheduleRevisionDir(id), "revisions.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return scheduleRevisionIndex{Entries: []ScheduleRevisionInfo{}}, nil
		}
		return index, fmt.Errorf("đọc chỉ mục revision: %w", err)
	}
	if err := json.Unmarshal(data, &index); err != nil {
		return index, fmt.Errorf("đọc chỉ mục revision: %w", err)
	}
	if index.Entries == nil {
		index.Entries = []ScheduleRevisionInfo{}
	}
	return index, nil
}

func (a *App) saveScheduleRevisionIndex(id string, index scheduleRevisionIndex) error {
	data, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(a.scheduleRevisionDir(id), "revisions.json")
	return writeConfigFileAtomic(path, append(data, '\n'), 0o600)
}

func (a *App) listScheduleRevisions(id string) ([]ScheduleRevisionInfo, error) {
	index, err := a.loadScheduleRevisionIndex(id)
	if err != nil {
		return nil, err
	}
	return index.Entries, nil
}

func (a *App) loadScheduleRevision(id string, revision uint64) (ScheduleObject, error) {
	var obj ScheduleObject
	path := filepath.Join(a.scheduleRevisionDir(id), fmt.Sprintf("rev-%06d.json", revision))
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return obj, fmt.Errorf("revision %d không còn được lưu (giữ tối đa %d bản gần nhất)",
				revision, maxScheduleRevisions)
		}
		return obj, err
	}
	if err := json.Unmarshal(data, &obj); err != nil {
		return obj, err
	}
	return obj, nil
}

// ── Audit ─────────────────────────────────────────────────────────────────

// appendScheduleAudit ghi thêm một dòng. Append-only: đặc tả §20 cấm mọi vai
// trò sửa hoặc xoá, nên ở đây không có hàm nào làm được việc đó.
func (a *App) appendScheduleAudit(entry ScheduleAuditEntry) error {
	dir := a.scheduleRevisionDir(entry.ScheduleID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "audit.jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(line, '\n'))
	return err
}

func (a *App) listScheduleAudit(id string) ([]ScheduleAuditEntry, error) {
	path := filepath.Join(a.scheduleRevisionDir(id), "audit.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []ScheduleAuditEntry{}, nil
		}
		return nil, err
	}
	out := []ScheduleAuditEntry{}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var entry ScheduleAuditEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			// Một dòng hỏng không được làm mất cả nhật ký.
			continue
		}
		out = append(out, entry)
	}
	// Mới nhất lên đầu.
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out, nil
}

// removeScheduleState xoá lịch sử của một lịch đã bị xoá hẳn.
func (a *App) removeScheduleState(id string) error {
	return os.RemoveAll(a.scheduleRevisionDir(id))
}

// ── Tiện ích ──────────────────────────────────────────────────────────────

func findSchedule(list []ScheduleObject, id string) (int, bool) {
	for i := range list {
		if list[i].ScheduleID == id {
			return i, true
		}
	}
	return -1, false
}

func nextScheduleID(list []ScheduleObject) string {
	used := make(map[string]bool, len(list))
	for _, s := range list {
		used[s.ScheduleID] = true
	}
	for i := 1; i <= maxSchedules; i++ {
		id := fmt.Sprintf("SCH-%03d", i)
		if !used[id] {
			return id
		}
	}
	return ""
}
