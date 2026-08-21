package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
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

// traceSessionPayload: `[sessionId]` cho TRACE_STOP và TRACE_READ.
type traceSessionPayload struct {
	_         struct{} `cbor:",toarray"`
	SessionID string
}

// traceReadReply là thân trả về của TRACE_READ:
// `[state, droppedCount, [[timestampNs, [[valid, bits], ...]], ...]]`.
//
// `bits` là 8 byte THÔ của ô nhớ, không phải số đã diễn giải: kiểu của ô là dữ
// liệu của package, và diễn giải hai lần ở hai bên là hai chỗ để lệch nhau.
type traceReadReply struct {
	_       struct{} `cbor:",toarray"`
	State   string
	Dropped uint32
	Samples []traceReadSample
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
}

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
	Sequence   int64            `json:"sequence"`
	ObservedAt string           `json:"observedAt"`
	Values     []TraceValueView `json:"values"`
}

type TraceView struct {
	TraceID        string            `json:"traceId"`
	State          string            `json:"state"`
	VariableIDs    []string          `json:"variableIds"`
	DurationMS     int               `json:"durationMs"`
	SamplePeriodMS int               `json:"samplePeriodMs"`
	StartedAt      string            `json:"startedAt"`
	UpdatedAt      string            `json:"updatedAt"`
	StopReason     *string           `json:"stopReason"`
	DroppedSamples uint32            `json:"droppedSamples"`
	Samples        []TraceSampleView `json:"samples"`
}

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
	maxSamples := maxTraceValueCells / len(request.VariableIDs)
	requestedSamples := request.DurationMS/request.SamplePeriodMS + 1
	if maxSamples > requestedSamples {
		maxSamples = requestedSamples
	}
	session := &traceSession{
		view: TraceView{
			TraceID: traceID, State: "RUNNING", VariableIDs: append([]string(nil), request.VariableIDs...),
			DurationMS: request.DurationMS, SamplePeriodMS: request.SamplePeriodMS,
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
	if !s.startCoreTrace(ctx, traceID, request, monitor) {
		if !s.captureTraceSample(traceID, monitor) {
			_ = s.finishTrace(traceID, "COMPLETED", "QUOTA_REACHED")
			return traceAcceptedFrom(session, correlationID), nil
		}
	}
	go s.runTrace(traceID)
	return traceAcceptedFrom(session, correlationID), nil
}

func validateTraceRequest(request TraceRequest) error {
	if request.SchemaVersion != "1.0" || len(request.VariableIDs) < 1 || len(request.VariableIDs) > 32 ||
		request.DurationMS < 1000 || request.DurationMS > 600000 ||
		request.SamplePeriodMS < 100 || request.SamplePeriodMS > 30000 {
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

func (s *RuntimeService) runTrace(traceID string) {
	s.traces.mu.RLock()
	session := s.traces.sessions[traceID]
	s.traces.mu.RUnlock()
	if session == nil {
		return
	}
	ticker := time.NewTicker(time.Duration(session.view.SamplePeriodMS) * time.Millisecond)
	timer := time.NewTimer(time.Duration(session.view.DurationMS) * time.Millisecond)
	defer ticker.Stop()
	defer timer.Stop()
	for {
		select {
		case <-ticker.C:
			// Nguồn ĐÚNG trước: mẫu Core lấy tại ranh giới quét. Chỉ khi Core
			// không có phiên này mới rơi về poll monitor — và khi đó đồ thị là
			// dữ liệu xấp xỉ, không phải dữ liệu của một chu kỳ.
			if reply, ok := s.readCoreTrace(context.Background(), traceID); ok {
				if !s.applyCoreTraceSamples(traceID, reply) {
					_ = s.finishTrace(traceID, "COMPLETED", "QUOTA_REACHED")
					return
				}
				continue
			}
			monitor, err := s.GetMonitor(context.Background())
			if err != nil {
				s.traces.mu.Lock()
				if current := s.traces.sessions[traceID]; current != nil && current.view.State == "RUNNING" {
					current.view.DroppedSamples++
					current.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
				}
				s.traces.mu.Unlock()
				_ = s.finishTrace(traceID, "FAILED", "SOURCE_UNAVAILABLE")
				return
			}
			if !s.captureTraceSample(traceID, monitor) {
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

// applyCoreTraceSamples thay TOÀN BỘ dãy mẫu bằng thứ Core đang giữ.
//
// Thay chứ không nối thêm: ring của Core là bounded và có thể đã ghi đè mẫu cũ
// nhất. Nối thêm sẽ tạo ra một dãy vừa trùng lặp vừa thiếu, và số `dropped` của
// Core không còn giải thích được khoảng trống nào.
func (s *RuntimeService) applyCoreTraceSamples(traceID string, reply traceReadReply) bool {
	s.traces.mu.Lock()
	defer s.traces.mu.Unlock()
	session := s.traces.sessions[traceID]
	if session == nil || session.view.State != "RUNNING" {
		return false
	}
	samples := make([]TraceSampleView, 0, len(reply.Samples))
	for index, incoming := range reply.Samples {
		if len(samples) >= session.maxSamples {
			break
		}
		if len(incoming.Values) != len(session.coreVariableIDs) {
			// Số ô lệch số biến đã khai: mẫu này không dịch được về `variableId`
			// nào cả. Đếm là rơi thay vì ghép bừa theo vị trí.
			session.view.DroppedSamples++
			continue
		}
		sample := TraceSampleView{
			Sequence:   int64(index + 1),
			ObservedAt: s.now().UTC().Add(-time.Duration(0)).Format(time.RFC3339Nano),
			Values:     make([]TraceValueView, 0, len(incoming.Values)),
		}
		for position, cell := range incoming.Values {
			variableID := session.coreVariableIDs[position]
			value := TraceValueView{
				VariableID: variableID,
				Quality:    "GOOD",
				Freshness:  "FRESH",
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
		samples = append(samples, sample)
	}
	session.view.Samples = samples
	if reply.Dropped > 0 {
		session.view.DroppedSamples = reply.Dropped
	}
	session.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
	if reply.State == "COMPLETED" || reply.State == "STOPPED" {
		return false
	}
	return len(session.view.Samples) < session.maxSamples
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
	session.view.Samples = append(session.view.Samples, sample)
	session.view.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
	return len(session.view.Samples) < session.maxSamples
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
	response, ok := s.callCoreTrace(ctx, coreipc.ActionTraceStart, payload)
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
	_, _ = s.callCoreTrace(ctx, coreipc.ActionTraceStop, payload)
}

func (s *RuntimeService) callCoreTrace(ctx context.Context, action coreipc.Action,
	payload []byte) (coreipc.Response, bool) {
	request := coreipc.NewRequest(action, uuidBytes(s.newID()), uuidBytes(s.newID()),
		s.controllerID, "", "", coreipc.FutureDeadline(traceCallTimeout), payload)
	callCtx, cancel := context.WithTimeout(ctx, traceCallTimeout)
	defer cancel()
	response, err := s.runtime.Call(callCtx, request)
	if err != nil {
		return coreipc.Response{}, false
	}
	return response, true
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
	s.traces.mu.RUnlock()
	if !hasCore {
		return traceReadReply{}, false
	}
	payload, err := coreipc.EncodePayload(traceSessionPayload{SessionID: traceID})
	if err != nil {
		return traceReadReply{}, false
	}
	response, ok := s.callCoreTrace(ctx, coreipc.ActionTraceRead, payload)
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
	})
	_, err := s.store.CommitAudit(ctx, programmingstore.AuditInput{
		AuditID: s.newID(), ActorID: session.actor.ID, Role: session.actor.Role,
		Action: action, TargetType: "TRACE", TargetID: session.view.TraceID,
		OccurredAtUTCMS: s.now().UTC().UnixMilli(), ResultCode: result,
		CorrelationID: session.correlationID, DetailsJSON: details,
	})
	return err
}
