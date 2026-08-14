package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	programmingstore "mkddc-web/internal/programming/store"
)

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
	if !s.captureTraceSample(traceID, monitor) {
		_ = s.finishTrace(traceID, "COMPLETED", "QUOTA_REACHED")
		return traceAcceptedFrom(session, correlationID), nil
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
