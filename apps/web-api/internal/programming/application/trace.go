package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"mkddc-web/internal/programming/coreipc"
	programmingstore "mkddc-web/internal/programming/store"
)

// traceCallTimeout ngắn có chủ ý: TRACE_START/STOP là lệnh admin hiếm gọi, và
// endpoint IPC của Core là vòng poll ĐƠN LUỒNG — chờ lâu ở đây chiếm dụng toàn
// bộ endpoint, không chỉ request này.
const traceCallTimeout = 2 * time.Second

// traceStartPayload: `[sessionId, samplePeriodMs, durationMs, [[instanceId, variableName], ...]]`.
// Biến khai bằng TÊN vì số slot là kết quả của một lần biên dịch cụ thể và không
// tồn tại ở bất kỳ nơi nào BE nhìn thấy — Revision chỉ có tên biến.
type traceStartPayload struct {
	_              struct{} `cbor:",toarray"`
	SessionID      string
	SamplePeriodMS uint32
	DurationMS     uint32
	Variables      [][2]string
}

// traceSessionPayload: `[sessionId]` cho TRACE_STOP.
type traceSessionPayload struct {
	_         struct{} `cbor:",toarray"`
	SessionID string
}

// traceReadPayload: `[sessionId, fromSequence]` cho TRACE_READ (F18).
// `fromSequence` là số thứ tự tuyệt đối (từ 1) của mẫu đầu tiên BE CHƯA có.
type traceReadPayload struct {
	_            struct{} `cbor:",toarray"`
	SessionID    string
	FromSequence uint64
}

// traceReadReply là thân trả về của TRACE_READ (F18):
// `[state, droppedCount, [[timestampNs, [[valid, bits], ...]], ...], firstSequence, nextSequence]`.
//
// Core trả TỐI ĐA một lô (≤ 200 mẫu, dưới trần 256 phần tử của `coreipc` và
// trần payload 32 KiB) bắt đầu từ `max(fromSequence, mẫu cũ nhất còn giữ)`.
// `firstSequence` là số của `Samples[0]`; `nextSequence` là số mẫu kế tiếp Core
// sẽ ghi. Bản cũ trả TRỌN ring: ở 10 ms nó vượt trần 256 phần tử sau 2,56 s, mọi
// lần đọc sau đó giải mã hỏng và phiên rơi âm thầm về poll monitor.
//
// `bits` là 8 byte THÔ của ô nhớ, không phải số đã diễn giải: kiểu của ô là dữ
// liệu của package, và diễn giải hai lần ở hai bên là hai chỗ để lệch nhau.
type traceReadReply struct {
	_             struct{} `cbor:",toarray"`
	State         string
	Dropped       uint32
	Samples       []traceReadSample
	FirstSequence uint64
	NextSequence  uint64
}

type traceReadSample struct {
	_           struct{} `cbor:",toarray"`
	TimestampNS uint64
	Values      []traceReadCell
}

type traceReadCell struct {
	_     struct{} `cbor:",toarray"`
	Valid bool
	Bits  uint64
}

// F18 — nhịp đọc ring Core tối thiểu và cửa sổ lỗi đọc liên tiếp. Ring giữ
// mẫu theo số thứ tự nên đọc mỗi 100 ms (≤ 10 mẫu ở 10 ms) là đủ; đọc mỗi 10 ms
// chỉ nhân số lần mở socket lên 10 lần mà không thêm mẫu nào. Là biến để test
// rút ngắn được cửa sổ lỗi.
var (
	traceCoreReadMinInterval = 100 * time.Millisecond
	traceCoreReadFailWindow  = 3 * time.Second
)

// traceCoreReadMaxBatchesPerTick — số lô tối đa rút trong một nhịp khi Core còn
// mẫu chưa đọc (bắt kịp sau một lần chậm) mà không giữ khoá quá lâu.
const traceCoreReadMaxBatchesPerTick = 8

const (
	maxConcurrentTraces = 4
	maxTraceValueCells  = 10000
	maxRetainedTraces   = 32
)

type TraceRequest struct {
	SchemaVersion  string   `json:"schemaVersion"`
	VariableIDs    []string `json:"variableIds"`
	DurationMS     int      `json:"durationMs"`
	SamplePeriodMS int      `json:"samplePeriodMs"`
	// SampleMode — U-09 (REC-DDC-FIELD-USE-20260927). Rỗng hoặc `EVERY_SAMPLE`
	// giữ mọi mẫu như trước. `ON_CHANGE` chỉ giữ mẫu Core khi có ít nhất một ô
	// khác mẫu đã giữ trước đó; mỗi mẫu mang `cycle` nên người đọc biết các chu
	// kỳ ở giữa giống hệt mẫu trước. Cùng trần 10 000 ô, phiên ghi được dài hơn
	// nhiều: 27 biến trước chỉ đủ ≈ 37 s ở 100 ms.
	SampleMode string `json:"sampleMode,omitempty"`
}

const (
	traceSampleModeEvery    = "EVERY_SAMPLE"
	traceSampleModeOnChange = "ON_CHANGE"
)

type TraceAccepted struct {
	TraceID       string `json:"traceId"`
	StatusURL     string `json:"statusUrl"`
	State         string `json:"state"`
	RequestHash   string `json:"requestHash"`
	AcceptedAt    string `json:"acceptedAt"`
	CorrelationID string `json:"correlationId"`
}

type TraceValueView struct {
	VariableID        string  `json:"variableId"`
	ProgramValue      any     `json:"programValue"`
	ActualValue       any     `json:"actualValue"`
	OverriddenBy      *string `json:"overriddenBy"`
	EffectivePriority *int    `json:"effectivePriority"`
	Quality           string  `json:"quality"`
	Freshness         string  `json:"freshness"`
}

type TraceSampleView struct {
	Sequence   int64  `json:"sequence"`
	ObservedAt string `json:"observedAt"`
	// Cycle — số thứ tự tuyệt đối của mẫu trong ring Core (một mẫu mỗi chu kỳ
	// lấy mẫu hiệu lực). Chỉ có ở mẫu Core; với `ON_CHANGE`, khoảng hở giữa hai
	// `cycle` là các chu kỳ có giá trị y hệt mẫu trước.
	Cycle  uint64           `json:"cycle,omitempty"`
	Values []TraceValueView `json:"values"`
}

// TracePinView — `T59-810`. Tuple Active mà phiên Trace được NEO vào lúc tạo.
//
// Một phiên Trace kéo dài qua một lần cutover sẽ ghép mẫu của hai chương trình
// KHÁC NHAU vào cùng một đồ thị, và người đọc không có cách nào nhìn ra chỗ
// nối. Neo tuple lúc tạo rồi dừng phiên khi tuple trôi là cách duy nhất để dãy
// mẫu chỉ thuộc về đúng một Revision.
type TracePinView struct {
	RevisionID *string           `json:"revisionId"`
	Producer   ProducerStampView `json:"producer"`
}

type TraceView struct {
	TraceID        string       `json:"traceId"`
	State          string       `json:"state"`
	Pin            TracePinView `json:"pin"`
	VariableIDs    []string     `json:"variableIds"`
	DurationMS     int          `json:"durationMs"`
	SamplePeriodMS int          `json:"samplePeriodMs"`
	// EffectiveSamplePeriodMS là chu kỳ lấy mẫu THẬT = max(yêu cầu, base step
	// Core) (ADR-061 mục 4.6). Core chỉ lấy mẫu được ở ranh giới base step, nên
	// hứa một chu kỳ nhanh hơn là hứa những mẫu không tồn tại.
	EffectiveSamplePeriodMS int     `json:"effectiveSamplePeriodMs"`
	StartedAt               string  `json:"startedAt"`
	UpdatedAt               string  `json:"updatedAt"`
	StopReason              *string `json:"stopReason"`
	// Source — nguồn mẫu của phiên (U-02, REC-DDC-FIELD-USE-20260927):
	// `CORE` = Core lấy mẫu tại ranh giới quét, mỗi mẫu đúng một chu kỳ;
	// `MONITOR_POLL` = Core không nhận phiên (thường vì đang phục vụ phiên khác),
	// BE đọc snapshot monitor theo nhịp riêng nên chỉ là dữ liệu XẤP XỈ. Rỗng
	// (không gửi khoá) trong khoảnh khắc trước khi Core trả lời TRACE_START.
	Source string `json:"source,omitempty"`
	// SampleMode của phiên (`EVERY_SAMPLE` | `ON_CHANGE`), luôn có.
	SampleMode     string            `json:"sampleMode"`
	DroppedSamples uint32            `json:"droppedSamples"`
	Samples        []TraceSampleView `json:"samples"`
}

// Giá trị của `TraceView.Source`.
const (
	traceSourceCore        = "CORE"
	traceSourceMonitorPoll = "MONITOR_POLL"
)

type traceSession struct {
	view          TraceView
	actor         Actor
	correlationID string
	requestHash   string
	idempotencyID string
	createdAt     time.Time
	stop          chan struct{}
	stopOnce      sync.Once
	maxSamples    int
	// T59-408/T59-501: thứ tự biến ĐÃ GỬI xuống Core ở `TRACE_START`. Ô trong
	// mỗi mẫu Core trả về song song 1-1 với danh sách này, nên đây là thứ duy
	// nhất dịch được ô thứ n trở lại `variableId`. Rỗng = Core không nhận phiên,
	// đường dự phòng poll monitor được dùng.
	coreVariableIDs []string
	// Kiểu dữ liệu theo `variableId`, để diễn giải bit thô Core gửi lên.
	coreDataTypes map[string]string
	// F18 — số thứ tự tuyệt đối của mẫu Core kế tiếp BE cần đọc (từ 1).
	coreNextSequence uint64
	// F18 — mốc neo đổi CLOCK_MONOTONIC của Core sang giờ tường, chụp MỘT lần
	// ở lần đọc đầu. Tính lại mỗi lô làm độ lệch nhảy theo khoảng giữa hai lần
	// chụp `wallNow`/`monoNow`, và mẫu đầu của lô sau có thể đứng TRƯỚC mẫu cuối
	// của lô trước.
	coreClockAnchored bool
	coreClockWall     time.Time
	coreClockMono     uint64
}

type traceIdempotency struct {
	requestHash string
	traceID     string
}

type runtimeTraceStore struct {
	mu          sync.RWMutex
	sessions    map[string]*traceSession
	idempotency map[string]traceIdempotency
}

func newRuntimeTraceStore() *runtimeTraceStore {
	return &runtimeTraceStore{sessions: map[string]*traceSession{}, idempotency: map[string]traceIdempotency{}}
}

func (s *RuntimeService) CreateTrace(ctx context.Context, request TraceRequest, actor Actor, idempotencyKey, correlationID string) (TraceAccepted, error) {
	if err := validateTraceRequest(request); err != nil || actor.ID == "" || actor.Role == "" || idempotencyKey == "" {
		return TraceAccepted{}, ErrInvalidRequest
	}
	canonical, _ := json.Marshal(request)
	digest := sha256.Sum256(canonical)
	requestHash := hex.EncodeToString(digest[:])
	idempotencyIdentity := actor.ID + "\x00" + idempotencyKey

	s.traces.mu.RLock()
	if replay, ok := s.traces.idempotency[idempotencyIdentity]; ok {
		if replay.requestHash != requestHash {
			s.traces.mu.RUnlock()
			return TraceAccepted{}, programmingstore.ErrIdempotencyConflict
		}
		session := s.traces.sessions[replay.traceID]
		accepted := traceAcceptedFrom(session, correlationID)
		s.traces.mu.RUnlock()
		return accepted, nil
	}
	s.traces.mu.RUnlock()

	monitor, err := s.GetMonitor(ctx)
	if err != nil {
		return TraceAccepted{}, err
	}
	available := make(map[string]struct{}, len(monitor.Items))
	for _, item := range monitor.Items {
		available[item.VariableID] = struct{}{}
	}
	for _, variableID := range request.VariableIDs {
		if _, ok := available[variableID]; !ok {
			return TraceAccepted{}, ErrInvalidRequest
		}
	}

	traceID := s.newID()
	if _, err := uuid.Parse(traceID); err != nil {
		return TraceAccepted{}, fmt.Errorf("trace id generator không trả UUID: %w", err)
	}
	now := s.now().UTC()
	effectivePeriod := effectiveTraceSamplePeriodMS(request.SamplePeriodMS, monitor.Task)
	maxSamples := maxTraceValueCells / len(request.VariableIDs)
	requestedSamples := request.DurationMS/effectivePeriod + 1
	if maxSamples > requestedSamples {
		maxSamples = requestedSamples
	}
	session := &traceSession{
		view: TraceView{
			TraceID: traceID, State: "RUNNING", VariableIDs: append([]string(nil), request.VariableIDs...),
			// Neo vào ĐÚNG snapshot vừa dùng để xác thực danh sách biến — không
			// đọc lại, vì đọc lại là mở một khe cho cutover chen vào giữa hai
			// lần đọc và phiên sẽ neo vào một tuple khác tuple đã kiểm.
			Pin:        TracePinView{RevisionID: monitor.ActiveRevisionID, Producer: monitor.Producer},
			DurationMS: request.DurationMS, SamplePeriodMS: request.SamplePeriodMS,
			EffectiveSamplePeriodMS: effectivePeriod, SampleMode: traceSampleMode(request.SampleMode),
			StartedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano),
			Samples: make([]TraceSampleView, 0, maxSamples),
		},
		actor: actor, correlationID: correlationID, requestHash: requestHash,
		idempotencyID: idempotencyIdentity, createdAt: now,
		stop: make(chan struct{}), maxSamples: maxSamples,
	}
	// Kiểm tra lại idempotency và quota trong cùng critical section với thao tác
	// đăng ký session. Hai request đồng thời không được cùng nhìn thấy một slot
	// trống rồi cùng vượt maxConcurrentTraces.
	s.traces.mu.Lock()
	if replay, ok := s.traces.idempotency[idempotencyIdentity]; ok {
		if replay.requestHash != requestHash {
			s.traces.mu.Unlock()
			return TraceAccepted{}, programmingstore.ErrIdempotencyConflict
		}
		replayed := traceAcceptedFrom(s.traces.sessions[replay.traceID], correlationID)
		s.traces.mu.Unlock()
		return replayed, nil
	}
	running := 0
	for _, existing := range s.traces.sessions {
		if existing.view.State == "RUNNING" {
			running++
		}
	}
	if running >= maxConcurrentTraces {
		s.traces.mu.Unlock()
		return TraceAccepted{}, fmt.Errorf("đã đạt quota %d trace đồng thời", maxConcurrentTraces)
	}
	if !s.evictTraceForCapacityLocked() {
		s.traces.mu.Unlock()
		return TraceAccepted{}, fmt.Errorf("không còn dung lượng lưu trace bounded")
	}
	if err := s.commitTraceAudit(ctx, session, "TRACE_START", "ACCEPTED"); err != nil {
		s.traces.mu.Unlock()
		return TraceAccepted{}, err
	}
	s.traces.sessions[traceID] = session
	s.traces.idempotency[idempotencyIdentity] = traceIdempotency{requestHash: requestHash, traceID: traceID}
	s.traces.mu.Unlock()
	// Bảo Core BẮT ĐẦU lấy mẫu tại ranh giới quét. Core lấy mẫu chính xác theo
	// chu kỳ và mọi biến trong một mẫu đến từ ĐÚNG một chu kỳ — thứ mà việc BE
	// poll ở nhịp riêng của nó không bao giờ bảo đảm được.
	//
	// Lỗi ở đây KHÔNG huỷ phiên: đường lấy mẫu dự phòng (poll monitor) vẫn cho
	// dữ liệu dùng được, và mất trace hoàn toàn vì Core bận là tệ hơn.
	// Core nhận phiên thì KHÔNG lấy mẫu đầu bằng poll: mẫu đầu sẽ tới từ ring
	// cùng nguồn với mọi mẫu sau. Trộn hai nguồn trong một dãy tạo ra một đồ thị
	// mà điểm đầu tiên đến từ nơi khác các điểm còn lại.
	coreRequest := request
	coreRequest.SamplePeriodMS = effectivePeriod
	coreAccepted := s.startCoreTrace(ctx, traceID, coreRequest, monitor)
	s.setTraceSource(traceID, coreAccepted)
	if !coreAccepted {
		if !s.captureTraceSample(traceID, monitor) {
			_ = s.finishTrace(traceID, "COMPLETED", "QUOTA_REACHED")
			return traceAcceptedFrom(session, correlationID), nil
		}
	}
	go s.runTrace(traceID)
	return traceAcceptedFrom(session, correlationID), nil
}

func traceSampleMode(requested string) string {
	if requested == traceSampleModeOnChange {
		return traceSampleModeOnChange
	}
	return traceSampleModeEvery
}

// traceValuesEqual — hai mẫu Core có cùng mọi ô (giá trị, chất lượng, độ tươi).
func traceValuesEqual(left, right []TraceValueView) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		a, b := left[index], right[index]
		if a.VariableID != b.VariableID || a.Quality != b.Quality || a.Freshness != b.Freshness ||
			a.ProgramValue != b.ProgramValue || a.ActualValue != b.ActualValue {
			return false
		}
	}
	return true
}

// Dải chu kỳ lấy mẫu Trace (ADR-061 mục 4.6): từ một base step 10 ms tới chu kỳ
// chậm nhất 50 000 ms của tập — khớp OpenAPI `ProgrammingTraceRequest`.
const (
	traceMinSamplePeriodMS = baseStepMs
	traceMaxSamplePeriodMS = 50000
)

// effectiveTraceSamplePeriodMS = max(yêu cầu, base step Core). Base step đọc từ
// `baseStepUs` mà Core công bố khi có (làm tròn lên ms); Core đời cũ không gửi
// khoá đó thì dùng base step của profile (10 ms).
func effectiveTraceSamplePeriodMS(requested int, task *TaskMetricsView) int {
	baseStep := baseStepMs
	if task != nil && task.BaseStepUS != nil && *task.BaseStepUS > 0 {
		baseStep = int((*task.BaseStepUS + 999) / 1000)
	}
	if requested < baseStep {
		return baseStep
	}
	return requested
}

func validateTraceRequest(request TraceRequest) error {
	if request.SchemaVersion != "1.0" || len(request.VariableIDs) < 1 || len(request.VariableIDs) > 32 ||
		request.DurationMS < 1000 || request.DurationMS > 600000 ||
		request.SamplePeriodMS < traceMinSamplePeriodMS || request.SamplePeriodMS > traceMaxSamplePeriodMS {
		return ErrInvalidRequest
	}
	switch request.SampleMode {
	case "", traceSampleModeEvery, traceSampleModeOnChange:
	default:
		return ErrInvalidRequest
	}
	seen := make(map[string]struct{}, len(request.VariableIDs))
	for _, id := range request.VariableIDs {
		if _, err := uuid.Parse(id); err != nil {
			return ErrInvalidRequest
		}
		if _, duplicate := seen[id]; duplicate {
			return ErrInvalidRequest
		}
		seen[id] = struct{}{}
	}
	return nil
}

func traceAcceptedFrom(session *traceSession, correlationID string) TraceAccepted {
	return TraceAccepted{
		TraceID:   session.view.TraceID,
		StatusURL: "/api/v1/programming/runtime/traces/" + session.view.TraceID,
		State:     session.view.State, RequestHash: session.requestHash,
		AcceptedAt: session.view.StartedAt, CorrelationID: correlationID,
	}
}

// traceTupleDrifted — tuple Active đã rời khỏi chỗ phiên Trace được neo.
//
// Hai dạng trôi, và cả hai đều làm dãy mẫu mất nghĩa:
//   - đổi Revision  ⇒ mẫu sau thuộc một chương trình khác;
//   - producer lùi mốc ⇒ Core đã restart, bộ đếm và trạng thái FB đã khác.
//
// Dấu không đọc được cũng tính là trôi: một snapshot không biết mình từ đâu
// tới thì không chứng minh được nó vẫn thuộc tuple đã neo.
func traceTupleDrifted(pin TracePinView, current MonitorPageView) bool {
	if (pin.RevisionID == nil) != (current.ActiveRevisionID == nil) {
		return true
	}
	if pin.RevisionID != nil && *pin.RevisionID != *current.ActiveRevisionID {
		return true
	}
	pinned, pinnedOK := parseMonotonicNs(pin.Producer.CapturedMonotonicNs)
	now, nowOK := parseMonotonicNs(current.Producer.CapturedMonotonicNs)
	if !pinnedOK || !nowOK {
		return true
	}
	return now < pinned
}

func parseMonotonicNs(value string) (uint64, bool) {
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func (s *RuntimeService) runTrace(traceID string) {
	s.traces.mu.RLock()
	session := s.traces.sessions[traceID]
	s.traces.mu.RUnlock()
	if session == nil {
		return
	}
	// Nhịp poll theo chu kỳ HIỆU LỰC (ADR-061 mục 4.6): nhanh hơn base step Core
	// chỉ đọc lại cùng một snapshot và tốn IPC mà không thêm mẫu nào mới.
	tickPeriod := session.view.EffectiveSamplePeriodMS
	if tickPeriod <= 0 {
		tickPeriod = session.view.SamplePeriodMS
	}
	tick := time.Duration(tickPeriod) * time.Millisecond
	s.traces.mu.RLock()
	coreBacked := len(session.coreVariableIDs) > 0
	s.traces.mu.RUnlock()
	// F18: phiên Core giữ mẫu theo số thứ tự trong ring, nên BE không cần đọc
	// theo nhịp lấy mẫu — chỉ cần đọc trước khi ring kịp ghi đè.
	if coreBacked && tick < traceCoreReadMinInterval {
		tick = traceCoreReadMinInterval
	}
	ticker := time.NewTicker(tick)
	var coreFailingSince time.Time
	timer := time.NewTimer(time.Duration(session.view.DurationMS) * time.Millisecond)
	defer ticker.Stop()
	defer timer.Stop()
	for {
		select {
		case <-ticker.C:
			/* `T59-810` — kiểm tuple TRƯỚC khi lấy mẫu, ở CẢ HAI đường.
			 *
			 * Đặt phép kiểm sau khi lấy mẫu nghĩa là mẫu đầu tiên của Revision
			 * mới đã lọt vào dãy rồi mới bị phát hiện — và một điểm lạ trong đồ
			 * thị còn khó lần hơn là không có điểm nào. Chi phí là một lần đọc
			 * monitor mỗi chu kỳ; `CoreClient` đã coalesce nên nó không thêm
			 * một scan-cycle nào của Core.
			 */
			tuple, tupleErr := s.GetMonitor(context.Background())
			if tupleErr != nil {
				// Nhịp này KHÔNG lấy được mẫu ⇒ đúng nghĩa một mẫu bị rơi.
				s.traces.mu.Lock()
				if current := s.traces.sessions[traceID]; current != nil && current.view.State == "RUNNING" {
					current.view.DroppedSamples++
					current.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
				}
				s.traces.mu.Unlock()
				_ = s.finishTrace(traceID, "FAILED", "SOURCE_UNAVAILABLE")
				return
			}
			if traceTupleDrifted(session.view.Pin, tuple) {
				// KHÔNG tăng `DroppedSamples`: không có mẫu nào bị rơi, phiên
				// dừng có chủ đích vì nguồn đã là một chương trình khác. Gộp hai
				// tình huống này làm số `dropped` mất nghĩa.
				_ = s.finishTrace(traceID, "FAILED", "SOURCE_UNAVAILABLE")
				return
			}
			// Nguồn ĐÚNG trước: mẫu Core lấy tại ranh giới quét. Chỉ khi Core
			// KHÔNG nhận phiên này mới dùng poll monitor — và khi đó đồ thị là
			// dữ liệu xấp xỉ, không phải dữ liệu của một chu kỳ.
			if coreBacked {
				// F18: phiên Core KHÔNG bao giờ trộn mẫu poll monitor. Bản cũ trộn
				// khi một lần đọc hỏng: dãy mẫu đổi nguồn giữa chừng, mốc thời gian
				// chạy lùi và trùng nhau hàng chục lần, trong khi `droppedSamples`
				// vẫn báo 0. Đọc hỏng liên tục quá cửa sổ thì phiên thất bại tường
				// minh.
				keepGoing, readOK := s.drainCoreTrace(traceID)
				if !keepGoing {
					_ = s.finishTrace(traceID, "COMPLETED", "QUOTA_REACHED")
					return
				}
				if readOK {
					coreFailingSince = time.Time{}
					continue
				}
				now := time.Now()
				if coreFailingSince.IsZero() {
					coreFailingSince = now
				}
				s.traces.mu.Lock()
				if current := s.traces.sessions[traceID]; current != nil && current.view.State == "RUNNING" {
					current.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
				}
				s.traces.mu.Unlock()
				if now.Sub(coreFailingSince) >= traceCoreReadFailWindow {
					_ = s.finishTrace(traceID, "FAILED", "SOURCE_UNAVAILABLE")
					return
				}
				continue
			}
			// Dùng lại chính snapshot vừa kiểm tuple: đọc lần hai sẽ lấy mẫu từ
			// một snapshot KHÁC snapshot đã được xác nhận đúng tuple.
			if !s.captureTraceSample(traceID, tuple) {
				_ = s.finishTrace(traceID, "COMPLETED", "QUOTA_REACHED")
				return
			}
		case <-timer.C:
			_ = s.finishTrace(traceID, "COMPLETED", "DURATION_REACHED")
			return
		case <-session.stop:
			_ = s.finishTrace(traceID, "STOPPED", "USER_STOPPED")
			return
		}
	}
}

// drainCoreTrace — F18: rút các lô mẫu Core chưa đọc trong một nhịp. Trả
// `keepGoing=false` khi phiên đã đủ quota (hoặc không còn chạy), `readOK=false`
// khi lần đọc đầu tiên của nhịp này hỏng.
func (s *RuntimeService) drainCoreTrace(traceID string) (keepGoing bool, readOK bool) {
	for batch := 0; batch < traceCoreReadMaxBatchesPerTick; batch++ {
		reply, ok := s.readCoreTrace(context.Background(), traceID)
		if !ok {
			return true, batch > 0
		}
		more, room := s.applyCoreTraceSamples(traceID, reply)
		if !room {
			return false, true
		}
		if !more {
			return true, true
		}
	}
	return true, true
}

// applyCoreTraceSamples NỐI lô mẫu Core vừa đọc vào phiên (F18).
//
// Bản cũ THAY toàn bộ dãy bằng trọn ring mỗi lần đọc; với ring lớn hơn một lô
// thì cách đó không còn dùng được, và nó cũng giấu mất việc ring đã ghi đè mẫu
// chưa ai đọc. Nay mỗi mẫu có số thứ tự tuyệt đối:
//   - mẫu có số < `coreNextSequence` là mẫu đã có, bỏ qua;
//   - `firstSequence > coreNextSequence` nghĩa là ring đã ghi đè phần giữa
//     trước khi BE kịp đọc: phần hụt được CỘNG vào `droppedSamples` — đúng số
//     mẫu người xem đồ thị không bao giờ thấy.
//
// Trả `more` khi Core còn mẫu chưa đọc sau lô này, `room=false` khi phiên đã đủ
// quota hoặc Core đã kết thúc phiên.
func (s *RuntimeService) applyCoreTraceSamples(traceID string, reply traceReadReply) (more bool, room bool) {
	s.traces.mu.Lock()
	defer s.traces.mu.Unlock()
	session := s.traces.sessions[traceID]
	if session == nil || session.view.State != "RUNNING" {
		return false, false
	}
	if session.coreNextSequence == 0 {
		session.coreNextSequence = 1
	}
	if reply.FirstSequence > session.coreNextSequence {
		gap := reply.FirstSequence - session.coreNextSequence
		if gap > math.MaxUint32-uint64(session.view.DroppedSamples) {
			session.view.DroppedSamples = math.MaxUint32
		} else {
			session.view.DroppedSamples += uint32(gap)
		}
		session.coreNextSequence = reply.FirstSequence
	}
	if !session.coreClockAnchored {
		monotonicNow := s.monotonicNow
		if monotonicNow == nil {
			monotonicNow = coreipc.MonotonicNowNS
		}
		wallNow := s.now().UTC()
		if monoNow, monoErr := monotonicNow(); monoErr == nil {
			session.coreClockAnchored = true
			session.coreClockWall, session.coreClockMono = wallNow, monoNow
		}
	}
	for index, incoming := range reply.Samples {
		sequence := reply.FirstSequence + uint64(index)
		if sequence < session.coreNextSequence {
			continue
		}
		session.coreNextSequence = sequence + 1
		if len(session.view.Samples) >= session.maxSamples {
			break
		}
		if len(incoming.Values) != len(session.coreVariableIDs) {
			// Số ô lệch số biến đã khai: mẫu này không dịch được về `variableId`
			// nào cả. Đếm là rơi thay vì ghép bừa theo vị trí.
			session.view.DroppedSamples++
			continue
		}
		sample := TraceSampleView{
			Sequence:   int64(len(session.view.Samples) + 1),
			ObservedAt: s.coreSampleWallTime(session, incoming.TimestampNS).Format(time.RFC3339Nano),
			Cycle:      sequence,
			Values:     make([]TraceValueView, 0, len(incoming.Values)),
		}
		for position, cell := range incoming.Values {
			variableID := session.coreVariableIDs[position]
			value := TraceValueView{
				VariableID: variableID,
				Quality:    "GOOD",
				// U-03: enum của `ProgrammingTraceValue.freshness` là
				// LIVE | STALE | UNAVAILABLE. Mẫu Core lấy ngay tại ranh giới
				// quét nên là LIVE; bản cũ gửi "FRESH" nằm ngoài hợp đồng.
				Freshness: "LIVE",
			}
			if cell.Valid {
				value.ProgramValue = traceCellValue(session.coreDataTypes[variableID], cell.Bits)
			} else {
				// "Không đo được" KHÁC "đo được giá trị 0": để giá trị rỗng và
				// nói thẳng chất lượng, thay vì vẽ một điểm 0 lên đồ thị.
				value.Quality = "BAD"
				value.Freshness = "UNAVAILABLE"
			}
			value.ActualValue = value.ProgramValue
			sample.Values = append(sample.Values, value)
		}
		// U-09: `ON_CHANGE` bỏ mẫu y hệt mẫu đã giữ. Không phải mẫu rơi: `cycle`
		// của mẫu kế nói rõ các chu kỳ ở giữa có giá trị như mẫu trước.
		if session.view.SampleMode == traceSampleModeOnChange {
			if last := len(session.view.Samples) - 1; last >= 0 &&
				traceValuesEqual(session.view.Samples[last].Values, sample.Values) {
				continue
			}
		}
		session.view.Samples = append(session.view.Samples, sample)
	}
	session.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
	if reply.State == "COMPLETED" || reply.State == "STOPPED" {
		return false, false
	}
	if len(session.view.Samples) >= session.maxSamples {
		return false, false
	}
	return len(reply.Samples) > 0 && reply.NextSequence > session.coreNextSequence, true
}

// coreSampleWallTime — F18: đổi dấu CLOCK_MONOTONIC của một mẫu Core sang giờ
// tường theo mốc neo của PHIÊN, nên hai mẫu cách nhau Δ trên đồng hồ đơn điệu
// luôn cách nhau đúng Δ trên `observedAt`, dù chúng đến ở hai lô khác nhau.
// Chưa neo được (không đọc được đồng hồ) thì giữ thời điểm đọc, như F05c.
func (s *RuntimeService) coreSampleWallTime(session *traceSession, sampleNS uint64) time.Time {
	if !session.coreClockAnchored || sampleNS == 0 {
		return s.now().UTC()
	}
	return session.coreClockWall.Add(time.Duration(int64(sampleNS) - int64(session.coreClockMono)))
}

func (s *RuntimeService) captureTraceSample(traceID string, monitor MonitorPageView) bool {
	s.traces.mu.Lock()
	defer s.traces.mu.Unlock()
	session := s.traces.sessions[traceID]
	if session == nil || session.view.State != "RUNNING" || len(session.view.Samples) >= session.maxSamples {
		return false
	}
	selected := make(map[string]struct{}, len(session.view.VariableIDs))
	for _, id := range session.view.VariableIDs {
		selected[id] = struct{}{}
	}
	sample := TraceSampleView{Sequence: int64(len(session.view.Samples) + 1), Values: make([]TraceValueView, 0, len(selected))}
	for _, item := range monitor.Items {
		if _, ok := selected[item.VariableID]; !ok {
			continue
		}
		if sample.ObservedAt == "" || item.ObservedAt < sample.ObservedAt {
			sample.ObservedAt = item.ObservedAt
		}
		sample.Values = append(sample.Values, TraceValueView{
			VariableID: item.VariableID, ProgramValue: item.ProgramValue, ActualValue: item.ActualValue,
			OverriddenBy: item.OverriddenBy, EffectivePriority: item.EffectivePriority,
			Quality: item.Quality, Freshness: item.Freshness,
		})
	}
	if len(sample.Values) != len(selected) {
		session.view.DroppedSamples++
		return true
	}
	// F18: monitor được coalesce theo snapshot của Core, nên nhiều nhịp liền
	// nhau đọc lại ĐÚNG một snapshot. Ghi mỗi lần là tạo hàng chục mẫu cùng một
	// `observedAt` — trên bo 33–45 mẫu mỗi giây — trông như dữ liệu dày đặc
	// trong khi không có gì mới. Snapshot chưa đổi thì chưa có mẫu mới.
	if last := len(session.view.Samples) - 1; last >= 0 && session.view.Samples[last].ObservedAt == sample.ObservedAt {
		return true
	}
	// U-02: snapshot monitor đổi chậm hơn chu kỳ đã hứa (trên bo: 132–1 065 ms
	// cho phiên 100 ms). Mỗi chu kỳ nằm giữa hai snapshot là một mẫu người xem
	// không bao giờ thấy, nên phải cộng vào `droppedSamples` — bản cũ báo 0 và
	// đồ thị trông như có dữ liệu từng chu kỳ.
	if last := len(session.view.Samples) - 1; last >= 0 {
		session.view.DroppedSamples = saturatingAddUint32(session.view.DroppedSamples,
			tracePollMissedPeriods(session.view.Samples[last].ObservedAt, sample.ObservedAt,
				session.view.EffectiveSamplePeriodMS))
	}
	session.view.Samples = append(session.view.Samples, sample)
	session.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
	return len(session.view.Samples) < session.maxSamples
}

// setTraceSource ghi nguồn mẫu của phiên ngay khi biết Core có nhận hay không.
func (s *RuntimeService) setTraceSource(traceID string, coreAccepted bool) {
	s.traces.mu.Lock()
	defer s.traces.mu.Unlock()
	session := s.traces.sessions[traceID]
	if session == nil {
		return
	}
	if coreAccepted {
		session.view.Source = traceSourceCore
	} else {
		session.view.Source = traceSourceMonitorPoll
	}
}

// tracePollMissedPeriods — số chu kỳ lấy mẫu nằm lọt giữa hai snapshot monitor
// liên tiếp (U-02). Hai snapshot cách nhau đúng một chu kỳ ⇒ 0. Mốc không đọc
// được hoặc chạy lùi thì không đoán: trả 0.
func tracePollMissedPeriods(previous, current string, periodMS int) uint32 {
	if periodMS <= 0 {
		return 0
	}
	before, errBefore := time.Parse(time.RFC3339Nano, previous)
	after, errAfter := time.Parse(time.RFC3339Nano, current)
	if errBefore != nil || errAfter != nil || !after.After(before) {
		return 0
	}
	period := time.Duration(periodMS) * time.Millisecond
	// Làm tròn tới chu kỳ gần nhất: jitter vài ms của snapshot không được biến
	// thành một mẫu "rơi".
	periods := (after.Sub(before) + period/2) / period
	if periods <= 1 {
		return 0
	}
	if periods-1 > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(periods - 1)
}

func saturatingAddUint32(value, delta uint32) uint32 {
	if delta > math.MaxUint32-value {
		return math.MaxUint32
	}
	return value + delta
}

// startCoreTrace gửi TRACE_START xuống Core. `programId` của mỗi biến là
// instance id ở Core, `variableName` là tên trong mã nguồn — cả hai đều có sẵn
// trong monitor, nên BE không cần biết bố cục slot của artifact.
// Trả true khi Core ĐÃ NHẬN phiên và sẽ tự lấy mẫu. Caller dùng nó để KHÔNG
// lấy mẫu đầu bằng poll: trộn một mẫu poll vào một dãy mẫu boundary tạo ra một
// dãy mà mẫu đầu tiên đến từ nguồn khác mọi mẫu còn lại — và không có gì trên
// đồ thị nói ra điều đó.
func (s *RuntimeService) startCoreTrace(ctx context.Context, traceID string, request TraceRequest,
	monitor MonitorPageView) bool {
	if s.runtime == nil {
		return false
	}
	byID := make(map[string]MonitorSampleView, len(monitor.Items))
	for _, item := range monitor.Items {
		byID[item.VariableID] = item
	}
	variables := make([][2]string, 0, len(request.VariableIDs))
	for _, variableID := range request.VariableIDs {
		item, ok := byID[variableID]
		if !ok || item.ProgramID == "" || item.VariableName == "" {
			return false
		}
		variables = append(variables, [2]string{item.ProgramID, item.VariableName})
	}
	payload, err := coreipc.EncodePayload(traceStartPayload{
		SessionID: traceID, SamplePeriodMS: uint32(request.SamplePeriodMS),
		DurationMS: uint32(request.DurationMS), Variables: variables})
	if err != nil {
		return false
	}
	response, ok := s.callCoreTrace(ctx, traceID, coreipc.ActionTraceStart, payload)
	if !ok || response.Result != coreipc.ResultAccepted {
		// Core không nhận phiên: KHÔNG ghi thứ tự biến. `coreVariableIDs` rỗng
		// là tín hiệu cho vòng lấy mẫu dùng đường dự phòng — đoán rằng Core đang
		// lấy mẫu trong khi nó không nhận là cách chắc chắn nhất để trả về một
		// đồ thị rỗng mà không nói vì sao.
		return false
	}
	dataTypes := make(map[string]string, len(request.VariableIDs))
	for _, variableID := range request.VariableIDs {
		dataTypes[variableID] = byID[variableID].DataType
	}
	s.traces.mu.Lock()
	if session := s.traces.sessions[traceID]; session != nil {
		session.coreVariableIDs = append([]string(nil), request.VariableIDs...)
		session.coreDataTypes = dataTypes
	}
	s.traces.mu.Unlock()
	return true
}

// stopCoreTrace gửi TRACE_STOP. Gọi cả khi phiên kết thúc tự nhiên: để Core lấy
// mẫu tiếp cho một phiên BE đã đóng là giữ một vòng lấy mẫu không ai đọc.
func (s *RuntimeService) stopCoreTrace(ctx context.Context, traceID string) {
	if s.runtime == nil {
		return
	}
	payload, err := coreipc.EncodePayload(traceSessionPayload{SessionID: traceID})
	if err != nil {
		return
	}
	_, _ = s.callCoreTrace(ctx, traceID, coreipc.ActionTraceStop, payload)
}

func (s *RuntimeService) callCoreTrace(ctx context.Context, traceID string, action coreipc.Action,
	payload []byte) (coreipc.Response, bool) {
	actorID, correlationID := s.traceEnvelopeIdentity(traceID)
	request := coreipc.NewRequest(action, uuidBytes(s.newID()), uuidBytes(s.newID()),
		s.controllerID, actorID, correlationID, coreipc.FutureDeadline(traceCallTimeout), payload)
	callCtx, cancel := context.WithTimeout(ctx, traceCallTimeout)
	defer cancel()
	response, err := s.runtime.Call(callCtx, request)
	if err != nil {
		return coreipc.Response{}, false
	}
	return response, true
}

// traceEnvelopeIdentity — F05 (EV-PROG-FBD-ST-MB-20260925). Envelope IPC của
// TRACE_* phải mang actor thật và correlation hợp lệ: `Client.Call` chạy
// `ValidateRequest` trước khi mở socket, và TRACE_START/STOP là mutation nên
// thiếu actor bị chặn NGAY TẠI web-api. Bản cũ gửi actor/correlation rỗng, nên
// không phiên trace nào từng tới Core — mọi đồ thị trace trên bo đều là đường
// dự phòng poll monitor (~2 s/mẫu, `programValue` rỗng) mà không ai biết.
func (s *RuntimeService) traceEnvelopeIdentity(traceID string) (string, string) {
	s.traces.mu.RLock()
	var actorID, correlationID string
	if session := s.traces.sessions[traceID]; session != nil {
		actorID, correlationID = session.actor.ID, session.correlationID
	}
	s.traces.mu.RUnlock()
	if len(correlationID) < 16 || len(correlationID) > coreipc.MaxCorrelationID ||
		strings.ContainsAny(correlationID, " \t\r\n") {
		correlationID = s.newID()
	}
	return actorID, correlationID
}

// readCoreTrace rút mẫu từ ring của Core.
//
// Đây mới là NGUỒN ĐÚNG của một phiên trace: Core lấy mẫu tại ranh giới quét
// nên mọi biến trong một mẫu đến từ ĐÚNG một chu kỳ. Đường poll monitor lấy mẫu
// theo nhịp riêng của BE, nên hai biến trong cùng một "mẫu" có thể đến từ hai
// chu kỳ khác nhau — đồ thị trông hợp lý trong khi quan hệ nhân quả đã bị xáo.
//
// Trả `ok=false` khi phiên này không có ở Core; caller rơi về đường dự phòng.
func (s *RuntimeService) readCoreTrace(ctx context.Context, traceID string) (traceReadReply, bool) {
	if s.runtime == nil {
		return traceReadReply{}, false
	}
	s.traces.mu.RLock()
	session := s.traces.sessions[traceID]
	hasCore := session != nil && len(session.coreVariableIDs) > 0
	from := uint64(1)
	if session != nil && session.coreNextSequence > 0 {
		from = session.coreNextSequence
	}
	s.traces.mu.RUnlock()
	if !hasCore {
		return traceReadReply{}, false
	}
	payload, err := coreipc.EncodePayload(traceReadPayload{SessionID: traceID, FromSequence: from})
	if err != nil {
		return traceReadReply{}, false
	}
	response, ok := s.callCoreTrace(ctx, traceID, coreipc.ActionTraceRead, payload)
	if !ok || response.Result != coreipc.ResultOK {
		return traceReadReply{}, false
	}
	var reply traceReadReply
	if err := coreipc.DecodePayload(response.Payload, &reply); err != nil {
		return traceReadReply{}, false
	}
	return reply, true
}

// traceCellValue diễn giải 8 byte thô của một ô theo kiểu đã khai trong package.
// Kiểu không nhận ra thì trả `nil` thay vì đoán: một số sai kiểu trên đồ thị chẩn
// đoán tệ hơn một ô trống.
func traceCellValue(dataType string, bits uint64) any {
	switch dataType {
	case "BOOL":
		return bits&1 != 0
	case "INT", "DINT", "UINT":
		return int32(uint32(bits))
	case "REAL":
		return math.Float32frombits(uint32(bits))
	case "TIME":
		return int64(bits)
	default:
		return nil
	}
}

func (s *RuntimeService) finishTrace(traceID, state, reason string) error {
	s.traces.mu.Lock()
	session := s.traces.sessions[traceID]
	if session == nil || session.view.State != "RUNNING" {
		s.traces.mu.Unlock()
		return nil
	}
	session.view.State = state
	session.view.StopReason = &reason
	session.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
	s.traces.mu.Unlock()
	s.stopCoreTrace(context.Background(), traceID)
	return s.commitTraceAudit(context.Background(), session, "TRACE_FINISH", state)
}

func (s *RuntimeService) GetTrace(traceID string) (TraceView, error) {
	if _, err := uuid.Parse(traceID); err != nil {
		return TraceView{}, ErrInvalidRequest
	}
	s.traces.mu.RLock()
	defer s.traces.mu.RUnlock()
	session := s.traces.sessions[traceID]
	if session == nil {
		return TraceView{}, programmingstore.ErrNotFound
	}
	return cloneTraceView(session.view), nil
}

func (s *RuntimeService) StopTrace(ctx context.Context, traceID string, actor Actor, correlationID string) error {
	if _, err := uuid.Parse(traceID); err != nil || actor.ID == "" {
		return ErrInvalidRequest
	}
	s.traces.mu.Lock()
	session := s.traces.sessions[traceID]
	if session == nil {
		s.traces.mu.Unlock()
		return programmingstore.ErrNotFound
	}
	shouldStop := session.view.State == "RUNNING"
	if shouldStop {
		session.actor = actor
		session.correlationID = correlationID
	}
	s.traces.mu.Unlock()
	if !shouldStop {
		return nil
	}
	err := s.finishTrace(traceID, "STOPPED", "USER_STOPPED")
	session.stopOnce.Do(func() { close(session.stop) })
	return err
}

// evictTraceForCapacityLocked giữ tổng bộ nhớ session cố định. Session đang
// chạy không bao giờ bị đẩy; khi đầy, session terminal cũ nhất cùng idempotency
// record của nó được loại bỏ. Caller phải giữ traces.mu write lock.
func (s *RuntimeService) evictTraceForCapacityLocked() bool {
	if len(s.traces.sessions) < maxRetainedTraces {
		return true
	}
	var oldest *traceSession
	for _, session := range s.traces.sessions {
		if session.view.State == "RUNNING" {
			continue
		}
		if oldest == nil || session.createdAt.Before(oldest.createdAt) {
			oldest = session
		}
	}
	if oldest == nil {
		return false
	}
	delete(s.traces.sessions, oldest.view.TraceID)
	delete(s.traces.idempotency, oldest.idempotencyID)
	return true
}

func cloneTraceView(value TraceView) TraceView {
	clone := value
	clone.VariableIDs = append([]string(nil), value.VariableIDs...)
	clone.Samples = make([]TraceSampleView, len(value.Samples))
	for index, sample := range value.Samples {
		clone.Samples[index] = sample
		clone.Samples[index].Values = append([]TraceValueView(nil), sample.Values...)
	}
	return clone
}

func (s *RuntimeService) commitTraceAudit(ctx context.Context, session *traceSession, action, result string) error {
	if s.store == nil {
		return fmt.Errorf("Programming store chưa cấu hình cho audit trace")
	}
	details, _ := json.Marshal(map[string]any{
		"variableIds":    session.view.VariableIDs,
		"durationMs":     session.view.DurationMS,
		"samplePeriodMs": session.view.SamplePeriodMS,
		// Chu kỳ THẬT được ghi kèm: audit chỉ ghi số yêu cầu sẽ nói một phiên
		// 10 ms trong khi thiết bị lấy mẫu mỗi base step của nó.
		"effectiveSamplePeriodMs": session.view.EffectiveSamplePeriodMS,
	})
	_, err := s.store.CommitAudit(ctx, programmingstore.AuditInput{
		AuditID: s.newID(), ActorID: session.actor.ID, Role: session.actor.Role,
		Action: action, TargetType: "TRACE", TargetID: session.view.TraceID,
		OccurredAtUTCMS: s.now().UTC().UnixMilli(), ResultCode: result,
		CorrelationID: session.correlationID, DetailsJSON: details,
	})
	return err
}
