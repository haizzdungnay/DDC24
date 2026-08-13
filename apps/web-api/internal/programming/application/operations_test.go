package application

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/coreipc"
	programmingstore "mkddc-web/internal/programming/store"
)

type fakeOperationRuntime struct {
	mu              sync.Mutex
	calls           []coreipc.Action
	reconciles      int
	desiredRevision string
	activeRevision  string
	failActivate    bool
	reconcileStaged bool
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
	projects, store := openProjectService(t)
	revision := createCheckRevisionFixture(t, projects)
	artifactBytes := []byte("artifact-coordinator-test")
	digest := sha256.Sum256(artifactBytes)
	runner := &fakeCheckRunner{result: programmingcompiler.Result{OK: true,
		Artifact: artifactBytes, ArtifactSHA256: digest, Manifest: []byte(`{"manifestVersion":1}`),
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1,
		ProfileID: "revA-1t-1-5-30", LibraryVersion: "rev-a.1", IntegrityMode: "HASH_ONLY",
		TargetABI: 3841}}
	root := t.TempDir()
	artifacts, err := programmingartifact.NewStore(filepath.Join(root, "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner,
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

func (f operationFixture) commissionCommand(t *testing.T, runtime *fakeOperationRuntime) OperationCommand {
	t.Helper()
	impact, err := f.projects.GetRevisionChanges(context.Background(), "none", f.revision)
	if err != nil {
		t.Fatal(err)
	}
	return OperationCommand{SchemaVersion: "1.0", RevisionID: f.revision, CheckID: f.checkID,
		ImpactRef: impact.Impact.ImpactRef, Acknowledgements: []string{"cutover"}, Cutover: "PROGRAM_ONLY",
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
