package application

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"sync"
	"testing"
	"time"

	"mkddc-web/internal/programming/coreipc"
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

// `ISS-STED-21` — fake này bị ĐỌC bởi goroutine chạy trace và bị GHI bởi thân
// test. Trước lát này test đổi nguồn bằng cách gán lại `service.monitor` giữa
// chừng, tức ghi một trường mà goroutine kia đang đọc — `go test -race` (cấu
// hình CI dùng) báo đúng một cuộc đua thật.
//
// Sản phẩm KHÔNG làm vậy: `monitor` được đặt lúc dựng service và không đổi
// nữa. Nên chỗ hỏng là ở test, và cách sửa đúng là để CHÍNH FAKE đổi câu trả
// lời một cách an toàn, thay vì tráo trường của service.
type fakeMonitorProvider struct {
	mu       sync.Mutex
	snapshot MonitorTruthSnapshot
	err      error
}

func (f *fakeMonitorProvider) ReadProgrammingMonitorSnapshot(context.Context) (MonitorTruthSnapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.snapshot, f.err
}

// fail làm nguồn snapshot "mất" giữa lúc trace đang chạy — đúng kịch bản test
// cần, nhưng qua khoá thay vì qua một phép gán không đồng bộ.
func (f *fakeMonitorProvider) fail(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

// set đổi snapshot đang phát ra (ví dụ: Core khởi động lại, mốc monotonic lùi)
// mà không tráo trường `monitor` của service.
func (f *fakeMonitorProvider) set(snapshot MonitorTruthSnapshot) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.snapshot = snapshot
	f.err = nil
}

// Trả về CẢ provider để test đổi nguồn snapshot một cách an toàn (`fail`),
// thay vì tráo trường `monitor` của service giữa lúc goroutine trace đang đọc.
func newMonitorTraceService(t *testing.T) (*RuntimeService, *fakeMonitorProvider) {
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
	provider := &fakeMonitorProvider{snapshot: MonitorTruthSnapshot{
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
	return service, provider
}

func stringPointer(value string) *string { return &value }

// newMonitorDraftV2Service dựng Revision đúng HÌNH DẠNG mà `SealRevision` sinh
// ra cho Draft v2: biến nằm trong `locals` của POU, KHÔNG có Revision object
// `VARIABLE` riêng. Nhóm test còn lại của file này dùng hình dạng v1, và chính
// vì vậy nó không bao giờ chạm được lỗi làm Runtime Monitor trả `items: []` cho
// mọi Revision thật.
func newMonitorDraftV2Service(t *testing.T) *RuntimeService {
	t.Helper()
	const objectID = "aaaaaaaa-1111-4111-8111-111111111111"
	store := openAuditTestStore(t)
	key := sha256.Sum256([]byte("monitor-v2-project-key"))
	request := sha256.Sum256([]byte("monitor-v2-project-request"))
	_, draft, err := store.CreateProject(context.Background(), programmingstore.CreateProjectParams{
		ProjectID: monitorProjectID, DraftID: monitorDraftID, Name: "AHU-01",
		ContentJSON: []byte(`{"schemaVersion":1}`), ActorID: "admin", Role: "admin",
		AuditID: "77777777-7777-4777-8777-777777777777", CorrelationID: "monitor-v2-00001",
		At: time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC), IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	key = sha256.Sum256([]byte("monitor-v2-revision-key"))
	request = sha256.Sum256([]byte("monitor-v2-revision-request"))
	pouPayload := `{"objectId":"` + objectID + `","kind":"PROGRAM","name":"AHU_MAIN","language":"ST",` +
		`"programConfig":{"programId":"` + monitorProgramID + `","periodMs":1000},` +
		`"locals":[{"variableId":"` + monitorVariableID + `","name":"SupplySetpoint","type":"REAL","class":"INPUT"}]}`
	_, err = store.CreateRevision(context.Background(), programmingstore.CreateRevisionParams{
		RevisionID: monitorRevisionID, ProjectID: monitorProjectID, DraftID: monitorDraftID,
		ExpectedDraftETag: draft.ETag, ManifestJSON: []byte(`{"schemaVersion":1}`),
		Objects: []programmingstore.RevisionObjectInput{
			{ObjectID: objectID, Kind: "PROGRAM", PayloadJSON: []byte(pouPayload)},
			{ObjectID: monitorBindingID, Kind: "BINDING", PayloadJSON: []byte(`{"variableId":"` + monitorVariableID + `","point":{"category":"LOCAL","pointId":"AO-01"},"direction":"WRITE","dataType":"REAL","unit":"V"}`)},
		},
		ActorID: "admin", Role: "admin", AuditID: "88888888-8888-4888-8888-888888888888",
		CorrelationID: "monitor-v2-00002", At: time.Date(2026, 8, 24, 12, 0, 1, 0, time.UTC),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err != nil {
		t.Fatalf("CreateRevision: %v", err)
	}
	fixed := time.Date(2026, 8, 24, 12, 0, 2, 0, time.UTC)
	programValue := 41.0
	reader := &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)}
	provider := &fakeMonitorProvider{snapshot: MonitorTruthSnapshot{
		ObservedAt: fixed.Format(time.RFC3339Nano),
		Points: []MonitorPointTruth{{Category: "LOCAL", PointID: "AO-01", ObservedAt: fixed.Format(time.RFC3339Nano),
			ActualValue: 62.0, ProgramValue: &programValue, Source: "program", Quality: "GOOD", Unit: "V"}},
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

// Hồi quy: Draft v2 seal biến vào `locals` của POU. Bản trước chỉ đọc Revision
// object `VARIABLE` (hình dạng v1) nên `variables` luôn rỗng, mọi Binding bị bỏ
// qua và màn Theo dõi hiện "Revision đang chạy chưa có biến ánh xạ" kể cả khi
// Program đang chạy với Binding hợp lệ. Phát hiện khi chạy lane E2E thật
// (`programming-real.spec.ts`) 2026-08-24.
func TestGetMonitorResolvesVariablesFromDraftV2Locals(t *testing.T) {
	service := newMonitorDraftV2Service(t)
	page, err := service.GetMonitor(context.Background())
	if err != nil {
		t.Fatalf("GetMonitor: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("Revision v2 có Binding hợp lệ nhưng monitor trả %d item: %+v", len(page.Items), page)
	}
	item := page.Items[0]
	if item.VariableID != monitorVariableID || item.VariableName != "SupplySetpoint" {
		t.Fatalf("identity biến sai: %+v", item)
	}
	// `programId` runtime (từ `programConfig`) chứ không phải `objectId` của POU:
	// trộn hai UUID này làm Monitor gắn biến vào một Program không tồn tại.
	if item.ProgramID != monitorProgramID {
		t.Fatalf("programId phải là identity runtime, nhận %q", item.ProgramID)
	}
	if item.ActualValue != 62.0 || item.ProgramValue != 41.0 || item.Quality != "GOOD" {
		t.Fatalf("giá trị/chất lượng không đi qua: %+v", item)
	}
}

func TestGetMonitorSeparatesProgramActualAndOverrideTruth(t *testing.T) {
	service, _ := newMonitorTraceService(t)
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
	service, _ := newMonitorTraceService(t)
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
	service, _ := newMonitorTraceService(t)
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
	service, monitorProvider := newMonitorTraceService(t)
	accepted, err := service.CreateTrace(context.Background(), TraceRequest{
		SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID}, DurationMS: 1000, SamplePeriodMS: 100,
	}, Actor{ID: "admin", Role: "admin"}, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "trace-test-000004")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}
	/* Đổi qua CHÍNH fake, không tráo trường của service: sản phẩm đặt `monitor`
	 * lúc dựng và không đổi nữa, nên một phép gán giữa chừng là thứ chỉ test
	 * làm — và nó ghi vào ô mà goroutine trace đang đọc. */
	monitorProvider.fail(errors.New("snapshot offline"))
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

// traceCoreReader mô phỏng Core CÓ ring trace: nhận `TRACE_START`, trả mẫu ở
// `TRACE_READ`. Nó KHÔNG mô phỏng luật lấy mẫu — luật đó do test C++ canh. Ở
// đây chỉ cần biết BE có thật sự đọc từ ring hay không.
// Bộ đếm ở đây bị goroutine trace tăng trong khi thân test đọc để khẳng định.
// Không có khoá thì đó là một cuộc đua, và `-race` báo đúng.
type traceCoreReader struct {
	fakeRuntimeStatusReader
	mu          sync.Mutex
	started     int
	readCalls   int
	stopCalls   int
	rejectStart bool
	samples     []traceReadSample
	state       string
	dropped     uint32
}

// counts trả về ảnh chụp nhất quán của ba bộ đếm. Đọc từng trường rời rạc sẽ
// cho một tổ hợp chưa từng tồn tại ở bất kỳ thời điểm nào.
func (f *traceCoreReader) counts() (started, reads, stops int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.started, f.readCalls, f.stopCalls
}

/* Đọc từng bộ đếm qua khoá. Ba hàm nhỏ thay vì để mỗi nơi tự lấy `counts()` —
 * chỗ dùng chỉ cần một số, và một tổ hợp ba số không ai đọc sẽ mời người ta so
 * hai giá trị chụp ở hai thời điểm khác nhau. */
func readerStarted(f *traceCoreReader) int   { s, _, _ := f.counts(); return s }
func readerReadCalls(f *traceCoreReader) int { _, r, _ := f.counts(); return r }
func readerStopCalls(f *traceCoreReader) int { _, _, s := f.counts(); return s }

func (f *traceCoreReader) Call(ctx context.Context, request coreipc.Request) (coreipc.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch request.Action {
	case coreipc.ActionTraceStart:
		f.started++
		if f.rejectStart {
			return coreipc.ResponseFor(request, coreipc.ResultRejected, "IPC-TRACE-REJECTED",
				"core.programming.ipc", nil), nil
		}
		return coreipc.ResponseFor(request, coreipc.ResultAccepted, "", "core.programming.ipc", nil), nil
	case coreipc.ActionTraceStop:
		f.stopCalls++
		return coreipc.ResponseFor(request, coreipc.ResultOK, "", "core.programming.ipc", nil), nil
	case coreipc.ActionTraceRead:
		f.readCalls++
		state := f.state
		if state == "" {
			state = "RUNNING"
		}
		payload, err := coreipc.EncodePayload(traceReadReply{
			State: state, Dropped: f.dropped, Samples: f.samples})
		if err != nil {
			return coreipc.Response{}, err
		}
		return coreipc.ResponseFor(request, coreipc.ResultOK, "", "core.programming.ipc", payload), nil
	}
	return f.fakeRuntimeStatusReader.Call(ctx, request)
}

// T59-408/T59-501 — mẫu trace phải đến từ RING CỦA CORE, không phải từ vòng poll
// monitor của BE.
//
// Trước bản vá, `TRACE_READ` không được gọi ở bất kỳ đâu: Core lấy mẫu tại ranh
// giới quét rồi ghi vào một ring KHÔNG AI ĐỌC, còn người dùng vẫn xem dãy mẫu
// poll theo nhịp riêng của BE. Hai biến trong cùng một "mẫu" khi đó có thể đến
// từ hai chu kỳ khác nhau — đồ thị trông hợp lý trong khi quan hệ nhân quả giữa
// chúng đã bị xáo.
func TestTraceSamplesComeFromCoreRingNotMonitorPolling(t *testing.T) {
	service, _ := newMonitorTraceService(t)
	reader := &traceCoreReader{
		fakeRuntimeStatusReader: fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)},
		samples: []traceReadSample{
			{TimestampNS: 1_000_000_000, Values: []traceReadCell{{Valid: true, Bits: uint64(math.Float32bits(21.5))}}},
			{TimestampNS: 2_000_000_000, Values: []traceReadCell{{Valid: false}}},
		},
		dropped: 3,
	}
	service.runtime = reader

	accepted, err := service.CreateTrace(context.Background(), TraceRequest{
		SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID},
		DurationMS: 2000, SamplePeriodMS: 100,
	}, Actor{ID: "admin", Role: "admin"}, "trace-idem-core-0001", "monitor-test-core01")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}
	if readerStarted(reader) != 1 {
		t.Fatalf("TRACE_START không được gửi xuống Core: %d", readerStarted(reader))
	}

	// Vòng lấy mẫu chạy nền; chờ tới khi có lần đọc ring đầu tiên.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		// Chờ CẢ HAI: đã đọc ring, VÀ mẫu đã được ghi vào phiên.
		//
		// Chỉ chờ "có mẫu" thì đường poll dự phòng cũng thoả, và test đo nhầm
		// nguồn. Chỉ chờ `readCalls > 0` thì thoát ngay khi lệnh đọc vừa tới
		// Core, trước khi `applyCoreTraceSamples` kịp ghi — một cuộc đua làm
		// test đỏ ngẫu nhiên. Với Core đã nhận phiên, mẫu CHỈ có thể đến từ
		// ring, nên hai điều kiện cùng đúng là mốc chắc chắn.
		view, err := service.GetTrace(accepted.TraceID)
		/* Đọc bộ đếm qua `counts()`: goroutine trace đang tăng chúng, nên đọc
		 * thẳng trường là một cuộc đua — `-race` báo đúng. */
		_, reads, _ := reader.counts()
		if reads > 0 && err == nil && len(view.Samples) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if readerReadCalls(reader) == 0 {
		t.Fatal("BE không bao giờ gọi TRACE_READ — ring của Core không ai đọc")
	}

	view, err := service.GetTrace(accepted.TraceID)
	if err != nil {
		t.Fatalf("GetTrace: %v", err)
	}
	if len(view.Samples) != 2 {
		t.Fatalf("số mẫu=%d, phải bằng số mẫu Core giữ", len(view.Samples))
	}
	first := view.Samples[0].Values[0]
	if first.VariableID != monitorVariableID {
		t.Fatalf("ô không dịch được về variableId: %+v", first)
	}
	// Bit thô được diễn giải theo kiểu đã khai trong package (REAL).
	if value, ok := first.ProgramValue.(float32); !ok || value != 21.5 {
		t.Fatalf("giá trị REAL diễn giải sai: %#v", first.ProgramValue)
	}
	// `valid=false` KHÁC giá trị 0: phải nói thẳng chất lượng, không vẽ điểm 0.
	second := view.Samples[1].Values[0]
	if second.ProgramValue != nil || second.Quality != "BAD" || second.Freshness != "UNAVAILABLE" {
		t.Fatalf("ô không đo được bị trình bày như giá trị thật: %+v", second)
	}
	// Số mẫu rơi của Core phải hiện ra, không bị giấu.
	if view.DroppedSamples != 3 {
		t.Fatalf("droppedSamples=%d, phải lấy từ Core", view.DroppedSamples)
	}

	_ = service.StopTrace(context.Background(), accepted.TraceID, Actor{ID: "admin", Role: "admin"}, "monitor-test-core02")
	if readerStopCalls(reader) == 0 {
		t.Fatal("TRACE_STOP không được gửi — Core lấy mẫu tiếp cho một phiên BE đã đóng")
	}
}

// Core từ chối phiên: BE KHÔNG được coi như Core đang lấy mẫu. Đoán rằng ring có
// dữ liệu trong khi Core chưa nhận là cách chắc chắn nhất để trả về một đồ thị
// rỗng mà không nói vì sao.
func TestTraceFallsBackToPollingWhenCoreRejectsSession(t *testing.T) {
	service, _ := newMonitorTraceService(t)
	reader := &traceCoreReader{
		fakeRuntimeStatusReader: fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)},
		rejectStart:             true,
	}
	service.runtime = reader

	accepted, err := service.CreateTrace(context.Background(), TraceRequest{
		SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID},
		DurationMS: 1000, SamplePeriodMS: 100,
	}, Actor{ID: "admin", Role: "admin"}, "trace-idem-core-0002", "monitor-test-core03")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}
	time.Sleep(300 * time.Millisecond)
	if readerReadCalls(reader) != 0 {
		t.Fatalf("BE đọc ring của một phiên Core chưa nhận: %d lần", readerReadCalls(reader))
	}
	view, err := service.GetTrace(accepted.TraceID)
	if err != nil {
		t.Fatalf("GetTrace: %v", err)
	}
	// Đường dự phòng vẫn cho dữ liệu dùng được — mất trace hoàn toàn vì Core bận
	// là tệ hơn.
	if len(view.Samples) == 0 {
		t.Fatal("đường dự phòng poll monitor không chạy khi Core từ chối")
	}
}
