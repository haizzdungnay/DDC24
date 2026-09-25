package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/coreipc"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

type fakeOperationRuntime struct {
	mu                 sync.Mutex
	calls              []coreipc.Action
	reconciles         int
	desiredRevision    string
	activeRevision     string
	failActivate       bool
	reconcileStaged    bool
	retainResetResults []coreipc.Result
	retainResetErrOnce bool
}

func (f *fakeOperationRuntime) Call(_ context.Context, request coreipc.Request) (coreipc.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, request.Action)
	if request.Action == coreipc.ActionActivate && f.failActivate {
		// Mô phỏng Core đã nhận mutation nhưng response mất: trạng thái chỉ được
		// xác định lại bằng OPERATION_STATUS, tuyệt đối không gọi ACTIVATE lần hai.
		f.activeRevision = f.desiredRevision
		return coreipc.Response{}, errors.New("response bị mất sau ACTIVATE")
	}
	if request.Action == coreipc.ActionRetainReset && f.retainResetErrOnce {
		// Mô phỏng lỗi transport (khác Core BUSY): op phải UNKNOWN, RETAIN_RESET
		// idempotent nên lần retry sau được phép gọi lại (khác bất biến Activate).
		f.retainResetErrOnce = false
		return coreipc.Response{}, errors.New("retain reset response bị mất")
	}
	response := coreipc.ResponseFor(request, coreipc.ResultOK, "", "core.programming.ipc", coreipc.EmptyPayload())
	switch request.Action {
	case coreipc.ActionStatus:
		payload, _ := coreipc.EncodePayload(runtimeImpactPayload{ProducerMode: "GRAPH_ONLY",
			ActiveOverrideIDs: []string{}})
		response.Payload = payload
		if f.activeRevision != "" {
			value := f.activeRevision
			response.ActiveRevisionID = &value
		}
	case coreipc.ActionStage, coreipc.ActionRestore:
		response.Result = coreipc.ResultStaged
	case coreipc.ActionActivate:
		response.Result = coreipc.ResultAccepted
	case coreipc.ActionRetainReset:
		if len(f.retainResetResults) > 0 {
			response.Result = f.retainResetResults[0]
			f.retainResetResults = f.retainResetResults[1:]
		}
	}
	return response, nil
}

func (f *fakeOperationRuntime) Reconcile(_ context.Context, request coreipc.Request) (coreipc.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reconciles++
	if f.reconcileStaged {
		f.reconcileStaged = false
		response := coreipc.ResponseFor(request, coreipc.ResultStaged, "", "core.programming.ipc", coreipc.EmptyPayload())
		return response, nil
	}
	response := coreipc.ResponseFor(request, coreipc.ResultOK, "", "core.programming.ipc", coreipc.EmptyPayload())
	active := f.activeRevision
	if active == "" {
		active = f.desiredRevision
		f.activeRevision = active
	}
	response.ActiveRevisionID = &active
	return response, nil
}

type operationFixture struct {
	projects  *ProjectService
	store     *programmingstore.Store
	artifacts *programmingartifact.Store
	revision  string
	checkID   string
	staging   string
	now       time.Time
}

func newOperationFixture(t *testing.T) operationFixture {
	t.Helper()
	return newOperationFixtureWithPeriod(t, 1000)
}

// newOperationFixtureWithPeriod: như `newOperationFixture` nhưng Revision chạy
// chu kỳ cho trước. Check chạy qua ĐÚNG CheckService với tập chu kỳ đang có
// hiệu lực lúc gọi — test nâng cấp ADR-061 dựa vào đó để dựng một Check PASSED
// "trước khi nâng cấp".
func newOperationFixtureWithPeriod(t *testing.T, periodMs int) operationFixture {
	t.Helper()
	projects, store := openProjectService(t)
	revision := createCheckRevisionFixtureWithPeriod(t, projects, periodMs)
	artifactBytes := []byte("artifact-coordinator-test")
	digest := sha256.Sum256(artifactBytes)
	runner := &fakeCheckRunner{result: programmingcompiler.Result{OK: true,
		Artifact: artifactBytes, ArtifactSHA256: digest, Manifest: []byte(`{"manifestVersion":1}`),
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1,
		ProfileID: "revA-1t-1-5-30", LibraryVersion: domain.SystemLibraryVersion, IntegrityMode: "HASH_ONLY",
		TargetABI: 3841}}
	root := t.TempDir()
	artifacts, err := programmingartifact.NewStore(filepath.Join(root, "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"},
		RequestCheckCommand{RevisionID: revision, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
			IdempotencyKey: "40000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if processed, err := checks.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("hoàn tất Check: processed=%v err=%v", processed, err)
	}
	return operationFixture{projects: projects, store: store, artifacts: artifacts,
		revision: revision, checkID: accepted.CheckID, staging: filepath.Join(root, "staging"), now: now}
}

func TestOperationStagesSingleProgramUnderSealedProgramID(t *testing.T) {
	fixture := newOperationFixture(t)
	service := fixture.service(t, &fakeOperationRuntime{})
	instanceID, err := service.runtimeInstanceIDForRevision(context.Background(), fixture.revision)
	if err != nil {
		t.Fatal(err)
	}
	if instanceID != "55555555-5555-4555-8555-555555555555" {
		t.Fatalf("instanceID=%q; hard-code program-main sẽ làm intent không chạm Core", instanceID)
	}
}

func (f operationFixture) service(t *testing.T, runtime *fakeOperationRuntime) *OperationService {
	t.Helper()
	runtime.desiredRevision = f.revision
	service, err := NewOperationService(OperationServiceOptions{Store: f.store, Projects: f.projects,
		Artifacts: f.artifacts, Runtime: runtime, ControllerID: "controller-local",
		StagingRoot: f.staging, Lease: time.Minute, Now: func() time.Time { return f.now }})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func (f *fakeOperationRuntime) resetCalls() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = nil
}

// commitCommission đưa fixture.revision thành Active/COMMITTED thật qua đúng
// state machine Commission — tiền điều kiện của mọi test RESET_RETAIN, vì Core
// (`programming_runtime_coordinator.cpp: reset_retain`) chỉ chấp nhận khi có
// một Revision đang COMMITTED khớp `expected_active_revision_id`.
func (f operationFixture) commitCommission(t *testing.T, service *OperationService, runtime *fakeOperationRuntime) {
	t.Helper()
	command := f.commissionCommand(t, runtime)
	if _, err := service.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"}, command); err != nil {
		t.Fatal(err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("execute Commission processed=%v err=%v", processed, err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("reconcile Commission processed=%v err=%v", processed, err)
	}
}

// createUnrelatedRevisionFixture dựng một Revision THẬT khác (Project khác)
// trong cùng Store — cần cho TC-RETAIN-05: `requested_revision_id` có FOREIGN
// KEY tới bảng revisions nên không thể dùng một UUID bịa cho ExpectedActiveRevisionID.
// Kịch bản thật của "Active Revision đổi giữa chừng" luôn là một Revision có
// thật (Commission trước đó), chỉ khác Revision đang Active NGAY BÂY GIỜ.
//
// Dùng một ProjectService RIÊNG (không phải `fixture.projects`) vì
// `openProjectService` ghim `newID` thành một hàng đợi CỐ ĐỊNH 9 UUID đã bị
// `createCheckRevisionFixture` dùng hết cho project đầu tiên — tái dùng sẽ
// panic index-out-of-range. `now` vẫn ghim khớp mốc cố định của Store để
// không dính bẫy lệch đồng hồ TTL idempotency đã biết trong dự án.
func createUnrelatedRevisionFixture(t *testing.T, store *programmingstore.Store) string {
	t.Helper()
	service, err := NewProjectService(store, []byte("cursor-secret-retain-mismatch-fixture"))
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time { return time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC) }
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := service.CreateProject(context.Background(), actor, CreateProjectCommand{SchemaVersion: "1.0",
		Name: "Retain mismatch fixture", IdempotencyKey: "40000000-0000-4000-8000-0000000000a1",
		CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "55555555-5555-4555-8555-555555555556"
	taskID := "66666666-6666-4666-8666-666666666667"
	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{"programId": programID,
		"name": "P2", "kind": "PROGRAM", "language": "ST",
		"document": "PROGRAM P2\nVAR_OUTPUT X : BOOL; END_VAR\nX := TRUE;\nEND_PROGRAM\n"}})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{"taskId": taskID, "periodMs": 1000,
		"programOrder": []string{programID}}})
	saved, err := service.SaveDraft(context.Background(), actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: draftID, Operations: []json.RawMessage{program, task}, IfMatch: created.ETag,
		IdempotencyKey: "40000000-0000-4000-8000-0000000000a2", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(context.Background(), actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: draftID, Label: "Retain mismatch", IfMatch: saved.ETag,
		IdempotencyKey: "40000000-0000-4000-8000-0000000000a3", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return sealed.Resource["revisionId"].(string)
}

func (f operationFixture) commissionCommand(t *testing.T, runtime *fakeOperationRuntime) OperationCommand {
	t.Helper()
	impact, err := f.projects.GetRevisionChanges(context.Background(), "none", f.revision)
	if err != nil {
		t.Fatal(err)
	}
	// Ack đúng những nhóm ĐANG `PRESENT`, dựng từ chính impact vừa tính. Viết
	// cứng một danh sách sẽ làm mọi lần thêm nhóm impact mới phải sửa tay ở đây
	// — và lần quên sửa đầu tiên sẽ hiện ra dưới dạng "test hỏng" thay vì
	// "Commission thiếu ack".
	return OperationCommand{SchemaVersion: "1.0", RevisionID: f.revision, CheckID: f.checkID,
		ImpactRef: impact.Impact.ImpactRef, Acknowledgements: presentImpactKeys(impact.Impact),
		Cutover:        "PROGRAM_ONLY",
		IdempotencyKey: "40000000-0000-4000-8000-000000000002", CorrelationID: testCorrelationID}
}

func TestOperationCommissionPersistsStagesAndCommitsOnlyAfterReadback(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	command := fixture.commissionCommand(t, runtime)
	accepted, err := service.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatal(err)
	}
	operation, err := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if err != nil || operation.State != "PENDING" || len(operation.ContextJSON) == 0 {
		t.Fatalf("operation durable=%+v err=%v", operation, err)
	}
	entries, err := os.ReadDir(fixture.staging)
	if err != nil || len(entries) != 1 {
		t.Fatalf("staging entries=%d err=%v", len(entries), err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("execute processed=%v err=%v", processed, err)
	}
	operation, _ = fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "VERIFYING" {
		t.Fatalf("thành công giả trước read-back: %+v", operation)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("reconcile processed=%v err=%v", processed, err)
	}
	operation, _ = fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "SUCCEEDED" || operation.ActualActiveRevisionID != fixture.revision {
		t.Fatalf("terminal read-back=%+v", operation)
	}
	record, err := fixture.store.GetCommissionRecord(context.Background(), accepted.OperationID)
	if err != nil || record.PreviousRevisionID != "" || record.NewRevisionID != fixture.revision ||
		record.Result != "COMMITTED" || record.ArtifactSHA256 == ([32]byte{}) ||
		record.OverrideInventorySHA256 == ([32]byte{}) || len(record.RuntimeReadbackJSON) < 2 ||
		len(record.ImpactJSON) < 2 {
		t.Fatalf("CommissionRecord đầu tiên không đầy đủ: %+v err=%v", record, err)
	}

	replay, err := service.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil || !replay.Replay || replay.OperationID != accepted.OperationID {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
	after, _ := os.ReadDir(fixture.staging)
	if len(after) != 1 {
		t.Fatalf("replay tạo staging phụ: %d", len(after))
	}
}

func TestOperationTimeoutAfterActivateReconcilesWithoutMutationReplayAcrossRestart(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{failActivate: true}
	first := fixture.service(t, runtime)
	command := fixture.commissionCommand(t, runtime)
	accepted, err := first.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatal(err)
	}
	if processed, err := first.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("execute timeout processed=%v err=%v", processed, err)
	}
	operation, _ := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "UNKNOWN" {
		t.Fatalf("timeout không thành UNKNOWN: %+v", operation)
	}

	// Process BE mới chỉ nhận row bền vững và query OPERATION_STATUS.
	second := fixture.service(t, runtime)
	if processed, err := second.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("restart reconcile processed=%v err=%v", processed, err)
	}
	operation, _ = fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "SUCCEEDED" || runtime.reconciles != 1 {
		t.Fatalf("restart result=%+v reconciles=%d", operation, runtime.reconciles)
	}
	activateCalls := 0
	for _, action := range runtime.calls {
		if action == coreipc.ActionActivate {
			activateCalls++
		}
	}
	if activateCalls != 1 {
		t.Fatalf("ACTIVATE bị replay sau timeout: %d calls=%v", activateCalls, runtime.calls)
	}
}

func TestOperationRestoreUsesVerifiedArtifactAndActivatesThroughSameBoundary(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	accepted, err := service.Restore(context.Background(), Actor{ID: testActorID, Role: "admin"},
		OperationCommand{SchemaVersion: "1.0", RevisionID: fixture.revision,
			Reason: "khôi phục LKG đã kiểm chứng", Cutover: "PROGRAM_ONLY",
			IdempotencyKey: "40000000-0000-4000-8000-000000000003",
			CorrelationID:  testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("execute Restore processed=%v err=%v", processed, err)
	}
	operation, _ := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "VERIFYING" {
		t.Fatalf("Restore chưa chờ read-back: %+v", operation)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("reconcile Restore processed=%v err=%v", processed, err)
	}
	operation, _ = fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "SUCCEEDED" || operation.ActualActiveRevisionID != fixture.revision {
		t.Fatalf("Restore terminal=%+v", operation)
	}
	want := []coreipc.Action{coreipc.ActionStatus, coreipc.ActionRestore, coreipc.ActionActivate}
	if len(runtime.calls) != len(want) {
		t.Fatalf("Restore calls=%v want=%v", runtime.calls, want)
	}
	for index := range want {
		if runtime.calls[index] != want[index] {
			t.Fatalf("Restore calls=%v want=%v", runtime.calls, want)
		}
	}
}

func TestOperationRestartAfterStageContinuesOnlyFromAuthoritativeStagedReadback(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{reconcileStaged: true}
	first := fixture.service(t, runtime)
	command := fixture.commissionCommand(t, runtime)
	accepted, err := first.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatal(err)
	}
	claimed, ok, err := fixture.store.ClaimOperation(context.Background(), programmingstore.ClaimOperationParams{
		Owner: "crashed-worker", At: fixture.now, Lease: time.Minute})
	if err != nil || !ok {
		t.Fatalf("claim=%+v ok=%v err=%v", claimed, ok, err)
	}
	// Crash đúng sau khi durable state đã thành STAGING nhưng trước/sau response
	// STAGE không rõ. Process mới chỉ OPERATION_STATUS; Core xác nhận STAGED thì
	// mới gửi bước kế ACTIVATE, không gửi lại STAGE.
	validating, err := fixture.store.UpdateOperation(context.Background(), programmingstore.UpdateOperationParams{
		OperationID: accepted.OperationID, LeaseOwner: claimed.LeaseOwner,
		LeaseGeneration: claimed.LeaseGeneration, State: "VALIDATING", Step: "PREFLIGHT",
		At: fixture.now})
	if err != nil {
		t.Fatal(err)
	}
	_, err = fixture.store.UpdateOperation(context.Background(), programmingstore.UpdateOperationParams{
		OperationID: accepted.OperationID, LeaseOwner: validating.LeaseOwner,
		LeaseGeneration: validating.LeaseGeneration, State: "STAGING", Step: "STAGE",
		At: fixture.now, ReleaseLease: true})
	if err != nil {
		t.Fatal(err)
	}
	second := fixture.service(t, runtime)
	if processed, err := second.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("resume staged processed=%v err=%v", processed, err)
	}
	operation, _ := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "VERIFYING" {
		t.Fatalf("resume stage state=%+v", operation)
	}
	stageCalls, activateCalls := 0, 0
	for _, action := range runtime.calls {
		switch action {
		case coreipc.ActionStage:
			stageCalls++
		case coreipc.ActionActivate:
			activateCalls++
		}
	}
	if stageCalls != 0 || activateCalls != 1 || runtime.reconciles != 1 {
		t.Fatalf("resume replay sai calls=%v reconciles=%d", runtime.calls, runtime.reconciles)
	}
	if processed, err := second.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("final reconcile processed=%v err=%v", processed, err)
	}
	operation, _ = fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if operation.State != "SUCCEEDED" {
		t.Fatalf("resume terminal=%+v", operation)
	}
}

// TC-RETAIN (WP-12, DDD-RETAIN-RESET-PROG-001) — phần Go/Operation. C++ phía
// Core đã xác nhận TC_RETAIN_01/02 (autosave/warm-restart) và
// TC_RETAIN_03a/b/c (no-half-reset) ở `test_programming_runtime_coordinator.cpp`.
// Bốn test dưới đây phủ đúng phần BE: single-pass apply, TC-RETAIN-05 (Active
// Revision đổi giữa chừng bị reject, không half-reset), §7 "không giả định
// thành công khi timeout" (BUSY -> UNKNOWN -> retry idempotent), và §9
// "idempotency mandatory".

func TestOperationResetRetainAppliesInSinglePassWhenActiveRevisionMatches(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	fixture.commitCommission(t, service, runtime)
	runtime.resetCalls()

	accepted, err := service.ResetRetain(context.Background(), Actor{ID: testActorID, Role: "admin"},
		OperationCommand{SchemaVersion: "1.0", ExpectedActiveRevisionID: fixture.revision,
			Reason:         "kiểm tra reset RETAIN sau nghiệm thu I/O",
			IdempotencyKey: "40000000-0000-4000-8000-000000000010", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("execute ResetRetain processed=%v err=%v", processed, err)
	}
	operation, err := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	// RETAIN reset không đổi Active Revision — Core không trả ActiveRevisionID
	// trong response RETAIN_RESET (`program_ipc_server.cpp: make_response`
	// không set field này cho action này), nên `ActualActiveRevisionID` đúng
	// ra PHẢI rỗng. Bằng chứng "đã reset đúng Revision nào" nằm ở
	// `PreviousActiveRevisionID` (giá trị STATUS preflight xác nhận trước khi gọi).
	if err != nil || operation.State != "SUCCEEDED" || operation.Kind != "RESET_RETAIN" ||
		operation.PreviousActiveRevisionID != fixture.revision {
		t.Fatalf("ResetRetain terminal=%+v err=%v", operation, err)
	}
	want := []coreipc.Action{coreipc.ActionStatus, coreipc.ActionRetainReset}
	if len(runtime.calls) != len(want) {
		t.Fatalf("ResetRetain calls=%v want=%v", runtime.calls, want)
	}
	for index := range want {
		if runtime.calls[index] != want[index] {
			t.Fatalf("ResetRetain calls=%v want=%v", runtime.calls, want)
		}
	}
}

func TestOperationResetRetainRejectsActiveRevisionMismatchNoHalfReset(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	fixture.commitCommission(t, service, runtime)
	runtime.resetCalls()

	// Revision THẬT (khác Project) nhưng KHÔNG phải Active — mô phỏng đúng
	// TC-RETAIN-05 "Active Revision đổi giữa chừng", không phải một UUID bịa.
	staleExpected := createUnrelatedRevisionFixture(t, fixture.store)
	accepted, err := service.ResetRetain(context.Background(), Actor{ID: testActorID, Role: "admin"},
		OperationCommand{SchemaVersion: "1.0", ExpectedActiveRevisionID: staleExpected,
			Reason:         "kiểm tra reject khi Active Revision đổi giữa chừng",
			IdempotencyKey: "40000000-0000-4000-8000-000000000011", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("execute processed=%v err=%v", processed, err)
	}
	operation, err := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if err != nil || operation.State != "FAILED" || operation.ResultCode != "EXPECTED_ACTIVE_MISMATCH" {
		t.Fatalf("mismatch phải FAILED/EXPECTED_ACTIVE_MISMATCH: %+v err=%v", operation, err)
	}
	for _, action := range runtime.calls {
		if action == coreipc.ActionRetainReset {
			t.Fatalf("preflight reject nhưng vẫn gọi RETAIN_RESET — half-reset: calls=%v", runtime.calls)
		}
	}
}

func TestOperationResetRetainTimeoutBecomesUnknownThenRetriesIdempotentlyToSuccess(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	fixture.commitCommission(t, service, runtime)
	runtime.resetCalls()
	runtime.retainResetResults = []coreipc.Result{coreipc.ResultBusy}

	accepted, err := service.ResetRetain(context.Background(), Actor{ID: testActorID, Role: "admin"},
		OperationCommand{SchemaVersion: "1.0", ExpectedActiveRevisionID: fixture.revision,
			Reason:         "kiểm tra Core TIMED_OUT không phải false success",
			IdempotencyKey: "40000000-0000-4000-8000-000000000012", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("execute processed=%v err=%v", processed, err)
	}
	operation, err := fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if err != nil || operation.State != "UNKNOWN" {
		t.Fatalf("Core BUSY (TIMED_OUT) phải map UNKNOWN, không phải false success: %+v err=%v", operation, err)
	}
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("retry processed=%v err=%v", processed, err)
	}
	operation, err = fixture.store.GetOperation(context.Background(), accepted.OperationID)
	if err != nil || operation.State != "SUCCEEDED" {
		t.Fatalf("retry idempotent phải hội tụ SUCCEEDED: %+v err=%v", operation, err)
	}
	retainCalls := 0
	for _, action := range runtime.calls {
		if action == coreipc.ActionRetainReset {
			retainCalls++
		}
	}
	if retainCalls != 2 {
		t.Fatalf("phải gọi lại RETAIN_RESET đúng 1 lần sau BUSY (tổng 2 lần): calls=%v", runtime.calls)
	}
}

func TestOperationResetRetainIdempotencyReplaysSameKeyRejectsDifferentRequest(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	fixture.commitCommission(t, service, runtime)

	command := OperationCommand{SchemaVersion: "1.0", ExpectedActiveRevisionID: fixture.revision,
		Reason: "reset RETAIN theo yêu cầu Admin", IdempotencyKey: "40000000-0000-4000-8000-000000000013",
		CorrelationID: testCorrelationID}
	first, err := service.ResetRetain(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := service.ResetRetain(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil || !replay.Replay || replay.OperationID != first.OperationID {
		t.Fatalf("replay cùng idempotency key phải trả cùng operation: %+v err=%v", replay, err)
	}

	conflicting := command
	conflicting.Reason = "lý do khác — request semantics đổi"
	if _, err := service.ResetRetain(context.Background(), Actor{ID: testActorID, Role: "admin"}, conflicting); !errors.Is(err, programmingstore.ErrIdempotencyConflict) {
		t.Fatalf("idempotency key trùng nhưng request khác phải conflict: err=%v", err)
	}
}

// presentImpactKeys trả các khoá acknowledgement mà impact hiện đang yêu cầu.
func presentImpactKeys(impact RevisionImpact) []string {
	groups := map[string]RevisionImpactGroup{
		"retain": impact.Retain, "activeOverrides": impact.ActiveOverrides,
		"cutover": impact.Cutover, "outputMappingChanges": impact.OutputMappingChanges,
		"publishedSignals": impact.PublishedSignals, "controlLibrary": impact.ControlLibrary,
		"programSet": impact.ProgramSet, "enableIntent": impact.EnableIntent,
		"physicalMappingChanges": impact.PhysicalMappingChanges,
		"virtualPointChanges": impact.VirtualPointChanges,
		"modbusMappingChanges": impact.ModbusMappingChanges,
		"writableOutputsAffected": impact.WritableOutputsAffected,
	}
	keys := make([]string, 0, len(groups))
	for key, group := range groups {
		if group.Status == "PRESENT" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}
