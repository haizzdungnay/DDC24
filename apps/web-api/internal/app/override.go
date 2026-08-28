package app

import (
	"context"
	"strings"
	"sync"
	"time"
)

// OverrideRegistry theo dõi các lệnh Local Manual đang có TTL.
//
// # VÌ SAO CẦN — PA3-F05
//
// Trước PA3, thời hạn override sống ở HAI chỗ sai:
//
//  1. `MonitorPage.tsx` giữ một `window.setTimeout` trong tab trình duyệt. Đóng
//     tab là mất hẹn giờ, và output ở lại trạng thái ép tay vĩnh viễn.
//  2. `ws.go` giữ `map[string]time.Time` gắn với MỘT kết nối WebSocket. Rớt
//     mạng là mất hẹn giờ y hệt; và ngược lại, giữ socket sống là giữ được
//     quyền ghi quá hạn.
//
// Cả hai đều đặt an toàn của một output vật lý vào tay thứ dễ biến mất nhất
// trong hệ thống. Nay TTL do Core sở hữu (`scan_loop` tự `release_ao/do` khi
// `manual_*_expiry_ns_` tới hạn) và registry này chỉ là BẢN SAO ĐỌC dùng để
// hiển thị đồng hồ đếm ngược — nó không bao giờ tự phát lệnh release.
//
// Vì là bản sao, registry được làm mới bằng `query` tới Core (op không mutation)
// chứ không tự trừ dần theo đồng hồ cục bộ: Core mới là nơi biết lệnh còn sống
// hay đã bị một nguồn ưu tiên cao hơn giành mất.
type OverrideRegistry struct {
	mu      sync.Mutex
	entries map[string]*overrideEntry
	now     func() time.Time
}

type overrideEntry struct {
	pointID     string
	user        string
	requestedS  uint32
	remainingS  uint32
	activeSrc   string
	observedAt  time.Time
	lastQueryAt time.Time
}

// overrideQuerier là cửa duy nhất registry dùng để hỏi Core. Tách interface để
// test không cần socket thật.
type overrideQuerier interface {
	QueryPoint(ctx context.Context, id, user string) (PointDTO, error)
}

const overrideQueryInterval = 900 * time.Millisecond

func NewOverrideRegistry() *OverrideRegistry {
	return &OverrideRegistry{entries: map[string]*overrideEntry{}, now: func() time.Time { return time.Now() }}
}

// Note ghi lại kết quả một lệnh override vừa được Core chấp nhận.
// `remainingS = 0` ⇒ Core không cấp TTL ⇒ không có gì để đếm ngược.
func (r *OverrideRegistry) Note(pointID, user string, requestedS, remainingS uint32, activeSource string) {
	if r == nil {
		return
	}
	id := canonicalPointID(pointID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if remainingS == 0 {
		delete(r.entries, id)
		return
	}
	now := r.now()
	r.entries[id] = &overrideEntry{
		pointID:     id,
		user:        user,
		requestedS:  requestedS,
		remainingS:  remainingS,
		activeSrc:   activeSource,
		observedAt:  now,
		lastQueryAt: now,
	}
}

func (r *OverrideRegistry) Forget(pointID string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	delete(r.entries, canonicalPointID(pointID))
	r.mu.Unlock()
}

// TrackedIDs trả về danh sách point còn đang theo dõi (bản sao, an toàn ra ngoài khoá).
func (r *OverrideRegistry) TrackedIDs() []string {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	ids := make([]string, 0, len(r.entries))
	for id := range r.entries {
		ids = append(ids, id)
	}
	return ids
}

// Refresh hỏi Core trạng thái thật của các point đang theo dõi và loại bỏ mục
// nào Core đã nhả. Chỉ hỏi lại sau `overrideQueryInterval` để một trang có 4
// tab mở không biến thành 4 lần IPC mỗi giây cho cùng một point.
func (r *OverrideRegistry) Refresh(ctx context.Context, querier overrideQuerier) {
	if r == nil || querier == nil {
		return
	}
	now := r.now()
	r.mu.Lock()
	stale := make([]*overrideEntry, 0, len(r.entries))
	for _, entry := range r.entries {
		if now.Sub(entry.lastQueryAt) >= overrideQueryInterval {
			stale = append(stale, entry)
		}
	}
	r.mu.Unlock()

	for _, entry := range stale {
		point, err := querier.QueryPoint(ctx, entry.pointID, "web")
		r.mu.Lock()
		current, ok := r.entries[entry.pointID]
		if !ok {
			r.mu.Unlock()
			continue
		}
		current.lastQueryAt = r.now()
		if err != nil {
			// Core không trả lời: GIỮ nguyên mục đang có. Xoá ở đây sẽ làm
			// giao diện báo "đã nhả" trong khi output vật lý vẫn bị ép.
			r.mu.Unlock()
			continue
		}
		if point.OverrideExpiresInS == nil || *point.OverrideExpiresInS == 0 {
			delete(r.entries, entry.pointID)
			r.mu.Unlock()
			continue
		}
		current.remainingS = *point.OverrideExpiresInS
		current.activeSrc = point.Priority
		current.observedAt = r.now()
		r.mu.Unlock()
	}
}

type overrideSnapshot struct {
	RemainingS   uint32
	ActiveSource string
	User         string
	ObservedAt   time.Time
}

// Snapshot trả bản sao trạng thái override đang biết, đã trừ đi thời gian trôi
// qua kể từ lần Core trả lời gần nhất. Con số này là ƯỚC LƯỢNG giữa hai lần
// query, và không bao giờ được dùng để quyết định có nhả lệnh hay không.
func (r *OverrideRegistry) Snapshot() map[string]overrideSnapshot {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.entries) == 0 {
		return nil
	}
	now := r.now()
	out := make(map[string]overrideSnapshot, len(r.entries))
	for id, entry := range r.entries {
		elapsed := uint32(now.Sub(entry.observedAt) / time.Second)
		if elapsed >= entry.remainingS {
			continue
		}
		out[id] = overrideSnapshot{
			RemainingS:   entry.remainingS - elapsed,
			ActiveSource: entry.activeSrc,
			User:         entry.user,
			ObservedAt:   entry.observedAt,
		}
	}
	return out
}

// commandablePointID nói một point có phải slot vật lý mà Core cho phép
// override không. VP đi đường ghi cấu hình riêng, không có TTL Core.
func commandablePointID(id string) bool {
	prefix, _, ok := parsePointID(canonicalPointID(id))
	if !ok {
		return false
	}
	switch strings.ToUpper(prefix) {
	case "AO", "DO":
		return true
	default:
		return false
	}
}
