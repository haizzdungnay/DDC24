package application

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

const (
	monitorProjectID  = "11111111-1111-4111-8111-111111111111"
	monitorDraftID    = "22222222-2222-4222-8222-222222222222"
	monitorRevisionID = "33333333-3333-4333-8333-333333333333"
	monitorProgramID  = "44444444-4444-4444-8444-444444444444"
	monitorVariableID = "55555555-5555-4555-8555-555555555555"
	monitorBindingID  = "66666666-6666-4666-8666-666666666666"
)

type fakeMonitorProvider struct {
	snapshot MonitorTruthSnapshot
	err      error
}

func (f fakeMonitorProvider) ReadProgrammingMonitorSnapshot(context.Context) (MonitorTruthSnapshot, error) {
	return f.snapshot, f.err
}

func newMonitorTraceService(t *testing.T) *RuntimeService {
	t.Helper()
	store := openAuditTestStore(t)
	key := sha256.Sum256([]byte("monitor-project-key"))
	request := sha256.Sum256([]byte("monitor-project-request"))
	_, draft, err := store.CreateProject(context.Background(), programmingstore.CreateProjectParams{
		ProjectID: monitorProjectID, DraftID: monitorDraftID, Name: "AHU-01",
		ContentJSON: []byte(`{"schemaVersion":1}`), ActorID: "admin", Role: "admin",
		AuditID: "77777777-7777-4777-8777-777777777777", CorrelationID: "monitor-test-00001",
		At: time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC), IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	key = sha256.Sum256([]byte("monitor-revision-key"))
	request = sha256.Sum256([]byte("monitor-revision-request"))
	_, err = store.CreateRevision(context.Background(), programmingstore.CreateRevisionParams{
		RevisionID: monitorRevisionID, ProjectID: monitorProjectID, DraftID: monitorDraftID,
		ExpectedDraftETag: draft.ETag, ManifestJSON: []byte(`{"schemaVersion":1}`),
		Objects: []programmingstore.RevisionObjectInput{
			{ObjectID: monitorVariableID, Kind: "VARIABLE", PayloadJSON: []byte(`{"variableId":"` + monitorVariableID + `","programId":"` + monitorProgramID + `","name":"SupplySetpoint"}`)},
			{ObjectID: monitorBindingID, Kind: "BINDING", PayloadJSON: []byte(`{"variableId":"` + monitorVariableID + `","point":{"category":"LOCAL","pointId":"AO-01"},"direction":"WRITE","dataType":"REAL","unit":"V"}`)},
		},
		ActorID: "admin", Role: "admin", AuditID: "88888888-8888-4888-8888-888888888888",
		CorrelationID: "monitor-test-00002", At: time.Date(2026, 8, 13, 12, 0, 1, 0, time.UTC),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err != nil {
		t.Fatalf("CreateRevision: %v", err)
	}
	programValue := 41.0
	priority := 2
	remaining := int64(272)
	fixed := time.Date(2026, 8, 13, 12, 0, 2, 0, time.UTC)
	reader := &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)}
	provider := fakeMonitorProvider{snapshot: MonitorTruthSnapshot{
		ObservedAt: fixed.Format(time.RFC3339Nano), SafeState: false,
		Task:   &TaskMetricsView{TaskID: "main", PeriodMS: 1000, BudgetMS: 200, State: "RUNNING", RunCount: 10, LastExecNS: 1200, MaxExecNS: 3000, OverrunCount: 1},
		Points: []MonitorPointTruth{{Category: "LOCAL", PointID: "AO-01", ObservedAt: fixed.Format(time.RFC3339Nano), ActualValue: 62.0, ProgramValue: &programValue, Source: "manual", EffectivePriority: &priority, OverrideActor: "operator-1", OverrideRemainingS: &remaining, Quality: "GOOD", Unit: "V"}},
	}}
	id := 0
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: reader, Store: store, Monitor: provider, ControllerID: "controller-local",
		Now: func() time.Time { return fixed },
		NewID: func() string {
			id++
			return fmt.Sprintf("99999999-9999-4999-8999-%012d", id)
		},
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	return service
}

func stringPointer(value string) *string { return &value }

func TestGetMonitorSeparatesProgramActualAndOverrideTruth(t *testing.T) {
	service := newMonitorTraceService(t)
	page, err := service.GetMonitor(context.Background())
	if err != nil {
		t.Fatalf("GetMonitor: %v", err)
	}
	if page.ActiveRevisionID == nil || *page.ActiveRevisionID != monitorRevisionID || len(page.Items) != 1 {
		t.Fatalf("monitor page identity sai: %+v", page)
	}
	item := page.Items[0]
	if item.ProgramValue != 41.0 || item.ActualValue != 62.0 || item.OverriddenBy == nil || *item.OverriddenBy != "manual" {
		t.Fatalf("program/actual/owner không tách đúng: %+v", item)
	}
	if item.EffectivePriority == nil || *item.EffectivePriority != 2 || item.OverrideRemainingS == nil || *item.OverrideRemainingS != 272 || item.OverrideActor == nil || *item.OverrideActor != "operator-1" {
		t.Fatalf("priority/TTL/actor sai: %+v", item)
	}
	if item.Freshness != "LIVE" || item.Quality != "GOOD" || page.Task == nil || page.Task.OverrunCount != 1 {
		t.Fatalf("freshness/quality/task sai: %+v", page)
	}
}

func TestTraceIsBoundedIdempotentAndCanStop(t *testing.T) {
	service := newMonitorTraceService(t)
	request := TraceRequest{SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID}, DurationMS: 1000, SamplePeriodMS: 1000}
	actor := Actor{ID: "admin", Role: "admin"}
	accepted, err := service.CreateTrace(context.Background(), request, actor, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "trace-test-000001")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}
	replay, err := service.CreateTrace(context.Background(), request, actor, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "trace-test-000002")
	if err != nil || replay.TraceID != accepted.TraceID {
		t.Fatalf("idempotent replay = %+v err=%v", replay, err)
	}
	view, err := service.GetTrace(accepted.TraceID)
	if err != nil || len(view.Samples) != 1 || len(view.Samples[0].Values) != 1 {
		t.Fatalf("trace initial = %+v err=%v", view, err)
	}
	if err := service.StopTrace(context.Background(), accepted.TraceID, actor, "trace-test-000003"); err != nil {
		t.Fatalf("StopTrace: %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		view, err = service.GetTrace(accepted.TraceID)
		if err == nil && view.State == "STOPPED" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if view.State != "STOPPED" || view.StopReason == nil || *view.StopReason != "USER_STOPPED" || len(view.Samples) > maxTraceValueCells {
		t.Fatalf("trace terminal/bounded sai: %+v", view)
	}
}

func TestTraceStoreEvictsOldestTerminalSessionAtRetentionLimit(t *testing.T) {
	service := newMonitorTraceService(t)
	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	service.traces.mu.Lock()
	for index := 0; index < maxRetainedTraces; index++ {
		traceID := fmt.Sprintf("88888888-8888-4888-8888-%012d", index)
		idempotencyID := fmt.Sprintf("admin%cidem-%d", 0, index)
		service.traces.sessions[traceID] = &traceSession{
			view:          TraceView{TraceID: traceID, State: "COMPLETED"},
			idempotencyID: idempotencyID, createdAt: base.Add(time.Duration(index) * time.Second),
		}
		service.traces.idempotency[idempotencyID] = traceIdempotency{traceID: traceID}
	}
	if !service.evictTraceForCapacityLocked() {
		service.traces.mu.Unlock()
		t.Fatal("phải giải phóng được session terminal cũ nhất")
	}
	_, oldestPresent := service.traces.sessions["88888888-8888-4888-8888-000000000000"]
	_, oldestIdempotencyPresent := service.traces.idempotency[fmt.Sprintf("admin%cidem-0", 0)]
	remaining := len(service.traces.sessions)
	service.traces.mu.Unlock()
	if oldestPresent || oldestIdempotencyPresent || remaining != maxRetainedTraces-1 {
		t.Fatalf("retention eviction sai: oldest=%v idem=%v remaining=%d", oldestPresent, oldestIdempotencyPresent, remaining)
	}
}

func TestTraceFailsClosedWhenMonitorSourceBecomesUnavailable(t *testing.T) {
	service := newMonitorTraceService(t)
	accepted, err := service.CreateTrace(context.Background(), TraceRequest{
		SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID}, DurationMS: 1000, SamplePeriodMS: 100,
	}, Actor{ID: "admin", Role: "admin"}, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "trace-test-000004")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}
	service.monitor = fakeMonitorProvider{err: errors.New("snapshot offline")}
	deadline := time.Now().Add(time.Second)
	var view TraceView
	for time.Now().Before(deadline) {
		view, err = service.GetTrace(accepted.TraceID)
		if err == nil && view.State == "FAILED" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if view.State != "FAILED" || view.StopReason == nil || *view.StopReason != "SOURCE_UNAVAILABLE" || view.DroppedSamples != 1 {
		t.Fatalf("source unavailable không fail-closed: %+v err=%v", view, err)
	}
}
