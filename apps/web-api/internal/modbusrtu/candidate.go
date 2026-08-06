package modbusrtu

import (
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

// Trạng thái vòng đời của bản nháp cấu hình (MBR-B203/B303).
const (
	ConfigStateClean    = "CLEAN"    // candidate == active
	ConfigStateDirty    = "DIRTY"    // có thay đổi chưa apply
	ConfigStateApplying = "APPLYING" // đang trong transaction apply
	ConfigStateFailed   = "FAILED"   // apply gần nhất thất bại, candidate còn nguyên
)

var (
	ErrRevisionConflict = errors.New("base_revision không khớp cấu hình đang chạy")
	ErrNoCandidate      = errors.New("chưa có bản nháp nào để apply")
)

// Candidate là bản nháp cấu hình đang soạn, BỀN VỮNG trên đĩa.
//
// Vì sao phải bền vững: bản trước không có candidate — mỗi thao tác CRUD ghi
// thẳng vào cấu hình đang chạy và restart iobus (D-09). Sửa 20 Point nghĩa là
// 20 lần gián đoạn I/O hiện trường, và một lần gõ nhầm ở Point thứ 3 đã kịp
// xuống thiết bị trước khi người dùng phát hiện. Với candidate, người dùng
// soạn thoải mái rồi apply MỘT lần; và vì nó nằm trên đĩa nên đóng trình duyệt
// hay restart web-api không mất bản nháp.
type Candidate struct {
	Config       Config    `json:"config"`
	BaseRevision uint64    `json:"base_revision"`
	Checksum     string    `json:"checksum"`
	UpdatedAt    time.Time `json:"updated_at"`
	UpdatedBy    string    `json:"updated_by"`
	OperationID  string    `json:"operation_id,omitempty"`
	State        string    `json:"state"`
	LastError    string    `json:"last_error,omitempty"`
}

// CandidateStore quản lý bản nháp trên đĩa.
type CandidateStore struct {
	Path      string
	WriteFile FileWriter

	mu sync.Mutex
	// Bộ nhớ idempotency: operation_id → revision đã apply.
	// OD/DATA_MODEL §7.2 yêu cầu cửa sổ ≥15 phút.
	operations map[string]operationRecord
}

type operationRecord struct {
	Revision uint64
	At       time.Time
}

const operationTTL = 30 * time.Minute

func (s *CandidateStore) Load() (Candidate, bool, error) {
	raw, err := os.ReadFile(s.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return Candidate{}, false, nil
		}
		return Candidate{}, false, err
	}
	var candidate Candidate
	if err := json.Unmarshal(raw, &candidate); err != nil {
		// Candidate hỏng KHÔNG được làm chết đường cấu hình: nó chỉ là bản nháp.
		// Báo lỗi để caller xoá và bắt đầu lại từ cấu hình đang chạy.
		return Candidate{}, false, fmt.Errorf("bản nháp hỏng: %w", err)
	}
	return candidate, true, nil
}

func (s *CandidateStore) Save(candidate Candidate) error {
	if s.WriteFile == nil {
		return errors.New("candidate store thiếu WriteFile")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	candidate.UpdatedAt = time.Now().UTC()
	sum, err := Checksum(candidate.Config)
	if err != nil {
		return err
	}
	candidate.Checksum = sum
	data, err := json.MarshalIndent(candidate, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o755); err != nil {
		return err
	}
	return s.WriteFile(s.Path, append(data, '\n'), 0o644)
}

func (s *CandidateStore) Discard() error {
	err := os.Remove(s.Path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// RememberOperation ghi nhận một operation_id đã hoàn tất.
func (s *CandidateStore) RememberOperation(id string, revision uint64) {
	if strings.TrimSpace(id) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.operations == nil {
		s.operations = map[string]operationRecord{}
	}
	now := time.Now()
	for key, rec := range s.operations {
		if now.Sub(rec.At) > operationTTL {
			delete(s.operations, key)
		}
	}
	s.operations[id] = operationRecord{Revision: revision, At: now}
}

// LookupOperation trả revision đã apply cho một operation_id đã thấy.
//
// Vì sao cần: client mất kết nối sau khi server đã apply xong sẽ thử lại. Không
// có idempotency, lần thử thứ hai apply LẠI cùng nội dung và tăng revision lần
// nữa — FE thấy revision nhảy 2 bước và mọi client khác bị REVISION_CONFLICT
// oan.
func (s *CandidateStore) LookupOperation(id string) (uint64, bool) {
	if strings.TrimSpace(id) == "" {
		return 0, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.operations[id]
	if !ok || time.Since(rec.At) > operationTTL {
		return 0, false
	}
	return rec.Revision, true
}

// DiffEntry là một thay đổi giữa cấu hình đang chạy và bản nháp.
type DiffEntry struct {
	Kind   string `json:"kind"`   // bus | device | point
	Action string `json:"action"` // added | removed | modified
	ID     string `json:"id"`
	Field  string `json:"field,omitempty"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

// Diff so sánh cấu hình đang chạy với bản nháp.
//
// Trả về diff THEO TRƯỜNG chứ không chỉ "đã đổi": người vận hành sắp phát lệnh
// xuống thiết bị hiện trường cần biết chính xác cái gì đổi, không phải một dấu
// chấm than trên nút Apply.
func Diff(active, candidate Config) []DiffEntry {
	// Khởi tạo slice RỖNG chứ không để nil: `encoding/json` tuần tự hoá nil
	// slice thành `null`, và `null` buộc mọi consumer phải xử lý HAI hình dạng
	// cho cùng một sự thật "không có thay đổi nào". Một client quên nhánh null
	// sẽ nổ ngay ở `.length` — đúng lỗi làm trắng toàn bộ trang Modbus RTU
	// trên board ngày 2026-08-06.
	out := []DiffEntry{}

	activeBuses := indexBuses(active.Buses)
	candBuses := indexBuses(candidate.Buses)
	for _, id := range sortedKeys(activeBuses, candBuses) {
		before, hasBefore := activeBuses[id]
		after, hasAfter := candBuses[id]
		switch {
		case !hasBefore:
			out = append(out, DiffEntry{Kind: "bus", Action: "added", ID: id})
		case !hasAfter:
			out = append(out, DiffEntry{Kind: "bus", Action: "removed", ID: id})
		default:
			out = append(out, compareFields("bus", id, busFields(before), busFields(after))...)
		}
	}

	activeDevices := indexDevices(active.Devices)
	candDevices := indexDevices(candidate.Devices)
	for _, id := range sortedKeys(activeDevices, candDevices) {
		before, hasBefore := activeDevices[id]
		after, hasAfter := candDevices[id]
		switch {
		case !hasBefore:
			out = append(out, DiffEntry{Kind: "device", Action: "added", ID: id})
		case !hasAfter:
			out = append(out, DiffEntry{Kind: "device", Action: "removed", ID: id})
		default:
			out = append(out, compareFields("device", id, deviceFields(before), deviceFields(after))...)
		}
	}

	activePoints := indexPoints(active.Points)
	candPoints := indexPoints(candidate.Points)
	for _, id := range sortedKeys(activePoints, candPoints) {
		before, hasBefore := activePoints[id]
		after, hasAfter := candPoints[id]
		switch {
		case !hasBefore:
			out = append(out, DiffEntry{Kind: "point", Action: "added", ID: id})
		case !hasAfter:
			out = append(out, DiffEntry{Kind: "point", Action: "removed", ID: id})
		default:
			out = append(out, compareFields("point", id, pointFields(before), pointFields(after))...)
		}
	}
	return out
}

func compareFields(kind, id string, before, after map[string]string) []DiffEntry {
	var out []DiffEntry
	keys := make([]string, 0, len(before))
	for key := range before {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if before[key] == after[key] {
			continue
		}
		out = append(out, DiffEntry{Kind: kind, Action: "modified", ID: id, Field: key,
			Before: before[key], After: after[key]})
	}
	return out
}

func busFields(b Bus) map[string]string {
	b = NormalizeBus(b)
	return map[string]string{
		"display_name":     b.DisplayName,
		"port":             b.Port,
		"baud":             fmt.Sprint(b.Baud),
		"parity":           b.Parity,
		"stop_bits":        fmt.Sprint(b.StopBit),
		"offline_probe_ms": fmt.Sprint(b.OfflineProbeMs),
		"enabled":          fmt.Sprint(b.Enabled),
	}
}

func deviceFields(d Device) map[string]string {
	d = NormalizeDevice(d)
	return map[string]string{
		"display_name":         d.DisplayName,
		"bus_id":               deviceBusID(d),
		"slave_id":             fmt.Sprint(d.SlaveID),
		"poll_ms":              fmt.Sprint(d.PollMS),
		"timeout_ms":           fmt.Sprint(d.TimeoutMS),
		"retry":                fmt.Sprint(d.Retry),
		"offline_after_errors": fmt.Sprint(d.OfflineAfterErrors),
		"enabled":              fmt.Sprint(d.Enabled),
	}
}

func pointFields(p Point) map[string]string {
	p = NormalizePoint(p)
	fields := map[string]string{
		"device_id":     p.DeviceID,
		"tag_name":      p.TagName,
		"display_name":  p.DisplayName,
		"register_type": p.RegisterType,
		"address":       fmt.Sprint(p.Address),
		"data_type":     p.DataType,
		"byte_order":    p.ByteOrder,
		"word_order":    p.WordOrder,
		"scale":         fmt.Sprint(p.Scale),
		"offset":        fmt.Sprint(p.Offset),
		"unit":          p.Unit,
		"read_write":    p.ReadWrite,
		"enabled":       fmt.Sprint(p.Enabled),
	}
	if p.BitIndex != nil {
		fields["bit_index"] = fmt.Sprint(*p.BitIndex)
	}
	if p.MinValue != nil {
		fields["min_value"] = fmt.Sprint(*p.MinValue)
	}
	if p.MaxValue != nil {
		fields["max_value"] = fmt.Sprint(*p.MaxValue)
	}
	return fields
}

func indexBuses(items []Bus) map[string]Bus {
	out := make(map[string]Bus, len(items))
	for _, item := range items {
		out[NormalizeBus(item).BusID] = item
	}
	return out
}

func indexDevices(items []Device) map[string]Device {
	out := make(map[string]Device, len(items))
	for _, item := range items {
		out[strings.ToLower(strings.TrimSpace(item.DeviceID))] = item
	}
	return out
}

func indexPoints(items []Point) map[string]Point {
	out := make(map[string]Point, len(items))
	for _, item := range items {
		out[strings.ToLower(strings.TrimSpace(item.PointID))] = item
	}
	return out
}

func sortedKeys[T any](a, b map[string]T) []string {
	seen := map[string]struct{}{}
	for key := range a {
		seen[key] = struct{}{}
	}
	for key := range b {
		seen[key] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for key := range seen {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
