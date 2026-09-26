package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
)

// Kiểm chứng phía Go của ADR-061: tập chu kỳ {10…50000} ms (C1), mã chẩn đoán
// riêng `ST-SCHED-001` (4.12), tương thích nâng cấp cho chu kỳ cũ 30000 ms
// (4.14), metric C2–C4 và sức khoẻ Task (4.9), Trace hiệu lực (4.6).

// C1 — ĐẶT chu kỳ qua Draft chỉ nhận đúng tập của profile. 5 ms (dưới base
// step) và 30000 ms (lớp của profile 2.1) phải bị từ chối, kèm mã chẩn đoán
// riêng để lớp HTTP nói được vì sao.
func TestDraftUpsertProgramRejectsPeriodOutsideCycleSet(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	objectID := objectUUID(1)
	base, err := saveOps(t, service, projectID, draftID, etag, "71000000-0000-4000-8000-000000000001",
		pouOp(objectID, "AHU", "PROGRAM"))
	if err != nil {
		t.Fatal(err)
	}
	for index, period := range []int{5, 20, 30000, 60000} {
		_, err := saveOps(t, service, projectID, draftID, base.ETag,
			fmt.Sprintf("71000000-0000-4000-8000-1000000000%02d", index), programOp(objectID, objectID, period))
		var periodError *PeriodNotAllowedError
		if !errors.Is(err, ErrInvalidRequest) || !errors.As(err, &periodError) ||
			periodError.DetailCode() != "ST-SCHED-001" || periodError.PeriodMs != float64(period) {
			t.Fatalf("chu kỳ %d ms không bị từ chối bằng ST-SCHED-001: %v", period, err)
		}
	}
	etagNow := base.ETag
	for index, period := range domain.AllowedPeriodMs {
		saved, err := saveOps(t, service, projectID, draftID, etagNow,
			fmt.Sprintf("71000000-0000-4000-8000-2000000000%02d", index), programOp(objectID, objectID, int(period)))
		if err != nil {
			t.Fatalf("chu kỳ %d ms của profile bị từ chối: %v", period, err)
		}
		etagNow = saved.ETag
	}
}

func TestSetTaskRejectsPeriodOutsideCycleSet(t *testing.T) {
	for _, period := range []int{5, 30000} {
		document := map[string]any{"programs": []any{
			map[string]any{"programId": "p1", "objectId": "p1", "periodMs": float64(1000)}}}
		raw := []byte(fmt.Sprintf(`{"op":"setTask","task":{"taskId":"main","periodMs":%d,"programOrder":[]}}`, period))
		var periodError *PeriodNotAllowedError
		if err := setTaskCompat(document, raw); !errors.As(err, &periodError) {
			t.Fatalf("setTask %d ms: %v", period, err)
		}
		if got := collectionOf(document, "programs")[0]["periodMs"]; got != float64(1000) {
			t.Fatalf("setTask bị từ chối vẫn ghi đè chu kỳ: %v", got)
		}
	}
}

// ADR-061 mục 4.14 — Draft đã lưu trước nâng cấp mang 30000 ms phải còn ĐỌC và
// SỬA được: một mutation không liên quan (thêm POU khác) không được hỏng vì chu
// kỳ cũ. Giá trị cũ được GIỮ NGUYÊN để người dùng thấy và tự chọn lại; nó không
// bị ép về 1000 ms.
func TestLegacyDraftPeriodStaysReadableAndEditable(t *testing.T) {
	service, projectID, draftID, etag := newV2Project(t)
	objectID := objectUUID(1)
	if _, err := saveOps(t, service, projectID, draftID, etag, "72000000-0000-4000-8000-000000000001",
		pouOp(objectID, "LEGACY", "PROGRAM"), programOp(objectID, objectID, 1000)); err != nil {
		t.Fatal(err)
	}
	document := draftDocument(t, service, projectID)
	collectionOf(document, "programs")[0]["periodMs"] = float64(30000)
	if err := validateDraftDocumentV2(document); err != nil {
		t.Fatalf("Draft cũ 30000 ms không còn hợp lệ về cấu trúc: %v", err)
	}
	content, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := applyDraftOperations(content, []json.RawMessage{pouOp(objectUUID(2), "OTHER", "FUNCTION")})
	if err != nil {
		t.Fatalf("mutation không liên quan hỏng vì chu kỳ cũ: %v", err)
	}
	var after map[string]any
	if err := json.Unmarshal(updated, &after); err != nil {
		t.Fatal(err)
	}
	if got := collectionOf(after, "programs")[0]["periodMs"]; got != float64(30000) {
		t.Fatalf("chu kỳ cũ bị đổi lặng lẽ: %v", got)
	}
	// Program mới tạo bằng op v1 KHÔNG kế thừa chu kỳ legacy, và mặc định là
	// 1000 ms — không phải phần tử đầu của tập (10 ms).
	if got := currentTaskPeriod(after); got != 1000 {
		t.Fatalf("chu kỳ mặc định=%v; want 1000", got)
	}
	if got := currentTaskPeriod(map[string]any{"programs": []any{}}); got != 1000 {
		t.Fatalf("chu kỳ mặc định của Draft rỗng=%v; want 1000", got)
	}
	// Chu kỳ lạ không thuộc cả tập mới lẫn tập legacy vẫn là dữ liệu hỏng.
	collectionOf(document, "programs")[0]["periodMs"] = float64(777)
	if err := validateDraftDocumentV2(document); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("chu kỳ 777 ms lọt qua validator Draft: %v", err)
	}
}

// legacyRevAPeriodSet mô phỏng tập chu kỳ "trước nâng cấp" để dựng một Check
// PASSED cho Revision 30000 ms qua ĐÚNG pipeline Check thật. Độ dài mảng sinh mã
// cố định là 8, nên 10000 ms được thay bằng 30000 ms — đủ để 30000 hợp lệ trong
// lúc dựng fixture.
var legacyRevAPeriodSet = [8]int64{10, 50, 100, 500, 1000, 5000, 30000, 50000}

// ADR-061 mục 4.14 — Revision cũ đã Check PASSED với 30000 ms: Restore dùng
// artifact đã PASSED và KHÔNG bị chặn bởi tập chu kỳ mới; còn Check LẠI chính
// Revision đó thì bị từ chối bằng `ST-SCHED-001` (C1 áp cho cấu hình mới).
func TestRestoreLegacy30000RevisionIsNotBlockedButRecheckIsRejected(t *testing.T) {
	current := domain.AllowedPeriodMs
	domain.AllowedPeriodMs = legacyRevAPeriodSet
	restored := false
	restore := func() {
		if !restored {
			domain.AllowedPeriodMs = current
			restored = true
		}
	}
	t.Cleanup(restore)
	fixture := newOperationFixtureWithPeriod(t, 30000)
	passed, err := fixture.store.GetPassedCheckForRevision(context.Background(), fixture.revision)
	if err != nil || passed.Artifact == nil {
		t.Fatalf("fixture không có Check PASSED 30000 ms: %+v err=%v", passed, err)
	}
	restore() // Nâng cấp: tập chu kỳ 2.2 có hiệu lực.

	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	accepted, err := service.Restore(context.Background(), Actor{ID: testActorID, Role: "admin"},
		OperationCommand{SchemaVersion: "1.0", RevisionID: fixture.revision,
			Reason: "khôi phục Revision 30000 ms sau nâng cấp", Cutover: "PROGRAM_ONLY",
			IdempotencyKey: "43000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatalf("Restore Revision cũ bị chặn: %v", err)
	}
	for step := 0; step < 2; step++ {
		if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
			t.Fatalf("Restore bước %d processed=%v err=%v", step, processed, err)
		}
	}
	operation, _ := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "SUCCEEDED" || operation.ActualActiveRevisionID != fixture.revision {
		t.Fatalf("Restore Revision 30000 ms không hoàn tất: %+v", operation)
	}

	checks, err := NewCheckService(CheckServiceOptions{Store: fixture.store,
		Runner: &fakeCheckRunner{result: programmingcompiler.Result{OK: true}}, Packager: &fakePackager{},
		Artifacts: fixture.artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return fixture.now }})
	if err != nil {
		t.Fatal(err)
	}
	recheck, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"},
		RequestCheckCommand{RevisionID: fixture.revision, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
			IdempotencyKey: "43000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if processed, err := checks.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("Check lại processed=%v err=%v", processed, err)
	}
	view, err := checks.GetCheck(context.Background(), recheck.CheckID)
	if err != nil {
		t.Fatal(err)
	}
	if view.State != "FAILED" || detailCodes(view.Diagnostics)["ST-SCHED-001"] != 1 {
		t.Fatalf("Check lại Revision 30000 ms phải FAILED với ST-SCHED-001: %+v", view)
	}
}

// ADR-061 mục 4.14 — Program đang chạy 30000 ms (Active #52 trên bo) hiển thị
// được ở Monitor như một chu kỳ bình thường, không bị coi là dữ liệu lỗi.
func TestListProgramsShowsRunningLegacy30000Program(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store, programsIntentSeed{programID: "prog-legacy", desiredEnabled: true})
	service := newProgramsService(t, store, &fakeMonitorProvider{snapshot: liveProgramsSnapshot(
		ProgramMetricsView{InstanceID: "prog-legacy", State: "RUNNING", Enabled: true, PeriodMS: 30000,
			LastExecNS: 2_000_000, MaxExecNS: 3_000_000, LastRunMonoNS: 8_500_000_000})})
	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatal(err)
	}
	item := itemByID(t, page, "prog-legacy")
	if item.PeriodMS == nil || *item.PeriodMS != 30000 || item.RuntimeState != "RUNNING" || healthOf(item) != "HEALTHY" {
		t.Fatalf("Program 30000 ms hiển thị sai: period=%v state=%s health=%s",
			item.PeriodMS, item.RuntimeState, healthOf(item))
	}
}

func uint64Ptr(value uint64) *uint64 { return &value }

// C4 (ADR-061 mục 4.9) — `/programming/runtime` chuyển NGUYÊN các khoá metric
// từ Core; khoá vắng (Core đời cũ) phải ra `null`, không phải `0`.
func TestRuntimeForwardsTaskCycleMetricsVerbatim(t *testing.T) {
	task := &TaskMetricsView{TaskID: "main", PeriodMS: 10, State: "RUNNING", RunCount: 100,
		BudgetUS: uint64Ptr(1999), BaseStepUS: uint64Ptr(10000), JitterMaxUS: uint64Ptr(42),
		JitterViolationCount: uint64Ptr(0), MissedBaseStepCount: uint64Ptr(0)}
	monitor := &fakeMonitorProvider{snapshot: MonitorTruthSnapshot{Task: task}}
	service := newRuntimeServiceWithMonitor(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"}, monitor)
	view, err := service.GetRuntime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(view.Task)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]float64{"budgetUs": 1999, "baseStepUs": 10000, "jitterMaxUs": 42,
		"jitterViolationCount": 0, "missedBaseStepCount": 0} {
		if decoded[key] != want {
			t.Fatalf("%s=%v; want %v (%s)", key, decoded[key], want, raw)
		}
	}
	if decoded["health"] != "HEALTHY" {
		t.Fatalf("Task sạch không HEALTHY: %s", raw)
	}
	if task.Health != "" {
		t.Fatal("health bị ghi vào snapshot dùng chung thay vì bản sao")
	}

	legacy := newRuntimeServiceWithMonitor(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"},
		&fakeMonitorProvider{snapshot: MonitorTruthSnapshot{Task: &TaskMetricsView{TaskID: "main",
			PeriodMS: 1000, BudgetMS: 199, State: "RUNNING"}}})
	legacyView, err := legacy.GetRuntime(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(legacyView.Task)
	decoded = map[string]any{}
	_ = json.Unmarshal(raw, &decoded)
	for _, key := range []string{"budgetUs", "baseStepUs", "jitterMaxUs", "jitterViolationCount", "missedBaseStepCount"} {
		value, present := decoded[key]
		if !present || value != nil {
			t.Fatalf("Core đời cũ: %s phải là null tường minh: %s", key, raw)
		}
	}
}

// ADR-061 mục 4.9 — bộ đếm vi phạm TĂNG ⇒ DEGRADED trong 60 s; không tăng nữa
// thì hết DEGRADED (bộ đếm tích luỹ không được ghim Task vĩnh viễn). Core khởi
// động lại (bộ đếm giảm) không bị coi là vi phạm.
func TestTaskHealthDegradesOnCounterIncreaseWithinWindow(t *testing.T) {
	clock := time.Date(2026, 9, 26, 8, 0, 0, 0, time.UTC)
	monitor := &fakeMonitorProvider{}
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"}, Monitor: monitor,
		ControllerID: "controller-local", Now: func() time.Time { return clock }})
	if err != nil {
		t.Fatal(err)
	}
	read := func(jitter, missed uint64, jitterMax uint64) *TaskMetricsView {
		t.Helper()
		monitor.set(MonitorTruthSnapshot{Task: &TaskMetricsView{TaskID: "main", PeriodMS: 10, State: "RUNNING",
			BaseStepUS: uint64Ptr(10000), JitterMaxUS: uint64Ptr(jitterMax),
			JitterViolationCount: uint64Ptr(jitter), MissedBaseStepCount: uint64Ptr(missed)}})
		view, err := service.GetRuntime(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		return view.Task
	}
	if task := read(0, 0, 30); task.Health != "HEALTHY" || len(task.HealthReasons) != 0 {
		t.Fatalf("lần đầu sạch: %+v", task)
	}
	clock = clock.Add(time.Second)
	if task := read(3, 0, 30); task.Health != "DEGRADED" || task.HealthReasons[0] != "JITTER_VIOLATION" {
		t.Fatalf("jitter violation tăng không DEGRADED: %+v", task)
	}
	clock = clock.Add(30 * time.Second)
	if task := read(3, 1, 30); task.Health != "DEGRADED" ||
		fmt.Sprint(task.HealthReasons) != "[JITTER_VIOLATION MISSED_BASE_STEP]" {
		t.Fatalf("hai vi phạm trong cửa sổ: %+v", task)
	}
	clock = clock.Add(61 * time.Second)
	if task := read(3, 1, 30); task.Health != "HEALTHY" {
		t.Fatalf("hết cửa sổ 60 s mà vẫn DEGRADED vì bộ đếm tích luỹ: %+v", task)
	}
	clock = clock.Add(time.Second)
	if task := read(0, 0, 30); task.Health != "HEALTHY" {
		t.Fatalf("Core khởi động lại (bộ đếm về 0) bị coi là vi phạm: %+v", task)
	}
	clock = clock.Add(time.Second)
	if task := read(0, 0, 150); task.Health != "DEGRADED" ||
		fmt.Sprint(task.HealthReasons) != "[JITTER_MAX_EXCEEDED]" {
		t.Fatalf("jitterMaxUs > 100 µs không DEGRADED: %+v", task)
	}
}

// Lần đọc đầu thấy bộ đếm > 0: không biết vi phạm xảy ra khi nào ⇒ DEGRADED một
// cửa sổ (thận trọng), và FAULT của Task luôn thắng.
func TestTaskHealthFirstObservationAndFault(t *testing.T) {
	now := time.Date(2026, 9, 26, 8, 0, 0, 0, time.UTC)
	tracker := newTaskHealthTracker()
	task := &TaskMetricsView{TaskID: "main", State: "RUNNING", MissedBaseStepCount: uint64Ptr(4)}
	tracker.evaluate(task, now)
	if task.Health != "DEGRADED" || fmt.Sprint(task.HealthReasons) != "[MISSED_BASE_STEP]" {
		t.Fatalf("lần đầu bộ đếm > 0: %+v", task)
	}
	fault := &TaskMetricsView{TaskID: "main", State: "FAULT", MissedBaseStepCount: uint64Ptr(4),
		ConsecutiveOverruns: 3}
	tracker.evaluate(fault, now.Add(time.Second))
	if fault.Health != "FAULT" || fault.HealthReasons[0] != "OVERRUN" {
		t.Fatalf("Task FAULT: %+v", fault)
	}
	stopped := &TaskMetricsView{TaskID: "main", State: "STOPPED", MissedBaseStepCount: uint64Ptr(4)}
	tracker.evaluate(stopped, now.Add(2*time.Minute))
	if stopped.Health != "UNKNOWN" {
		t.Fatalf("Task STOPPED không vi phạm phải UNKNOWN: %+v", stopped)
	}
}

// ADR-061 mục 4.6 — chu kỳ lấy mẫu hiệu lực = max(yêu cầu, base step Core).
func TestEffectiveTraceSamplePeriod(t *testing.T) {
	cases := []struct {
		requested int
		task      *TaskMetricsView
		want      int
	}{
		{10, nil, 10},
		{100, nil, 100},
		{10, &TaskMetricsView{BaseStepUS: uint64Ptr(10000)}, 10},
		// Core đời cũ công bố base step 1000 ms: mẫu 10 ms không tồn tại.
		{10, &TaskMetricsView{BaseStepUS: uint64Ptr(1_000_000)}, 1000},
		{5000, &TaskMetricsView{BaseStepUS: uint64Ptr(1_000_000)}, 5000},
		// Base step lẻ µs làm tròn LÊN ms: không hứa nhanh hơn thực tế.
		{10, &TaskMetricsView{BaseStepUS: uint64Ptr(10500)}, 11},
	}
	for _, testCase := range cases {
		if got := effectiveTraceSamplePeriodMS(testCase.requested, testCase.task); got != testCase.want {
			t.Errorf("requested=%d task=%+v: got %d want %d", testCase.requested, testCase.task, got, testCase.want)
		}
	}
	for _, request := range []TraceRequest{
		{SchemaVersion: "1.0", VariableIDs: []string{objectUUID(1)}, DurationMS: 1000, SamplePeriodMS: 9},
		{SchemaVersion: "1.0", VariableIDs: []string{objectUUID(1)}, DurationMS: 1000, SamplePeriodMS: 50001},
	} {
		if err := validateTraceRequest(request); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("sample %d ms lọt qua validator", request.SamplePeriodMS)
		}
	}
	for _, period := range []int{10, 100, 50000} {
		request := TraceRequest{SchemaVersion: "1.0", VariableIDs: []string{objectUUID(1)}, DurationMS: 1000,
			SamplePeriodMS: period}
		if err := validateTraceRequest(request); err != nil {
			t.Fatalf("sample %d ms hợp lệ bị từ chối: %v", period, err)
		}
	}
}

// X11 — capabilities đọc tập chu kỳ từ hằng sinh mã, và `limits.tasks` là số
// Task RUNTIME (1), không phải số lớp chu kỳ (8).
func TestCapabilitiesPublishGeneratedCycleSet(t *testing.T) {
	service := newRuntimeService(t, &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"})
	view, err := service.GetCapabilities(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(view.TaskPeriodsMs) != "[10 50 100 500 1000 5000 10000 50000]" || view.Limits.Tasks != 1 {
		t.Fatalf("capabilities=%v tasks=%d", view.TaskPeriodsMs, view.Limits.Tasks)
	}
	view.TaskPeriodsMs[0] = 7
	if again, _ := service.GetCapabilities(context.Background()); again.TaskPeriodsMs[0] != 10 {
		t.Fatal("capabilities trả mảng dùng chung, caller sửa được hằng sinh mã")
	}
}
