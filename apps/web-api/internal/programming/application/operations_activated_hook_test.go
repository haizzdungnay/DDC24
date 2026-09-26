package application

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// F13 (EV-PROG-FBD-ST-MB-20260925, Foxlinx 2026-09-26): Restore sang revision
// có Program chưa chạy trong gói cũ để Core ở safe-state `no_ctrl` 1,38 s, vì
// Program được dựng ở Disabled và intent Enable chỉ được replay ở tick
// reconcile 2 s kế tiếp. Hook phải bắn đúng lúc Active đổi — không sớm hơn
// (VERIFYING chưa phải thành công) và không cho operation hỏng.

func processOperation(t *testing.T, service *OperationService) {
	t.Helper()
	if processed, err := service.ProcessNext(context.Background()); err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
}

func TestActivatedHookFiresOnlyWhenCommissionSucceeds(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	var fired atomic.Int32
	service.SetActivatedHook(func() { fired.Add(1) })
	if _, err := service.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"},
		fixture.commissionCommand(t, runtime)); err != nil {
		t.Fatal(err)
	}
	processOperation(t, service)
	if fired.Load() != 0 {
		t.Fatalf("hook bắn khi mới VERIFYING (chưa có read-back): %d", fired.Load())
	}
	processOperation(t, service)
	if fired.Load() != 1 {
		t.Fatalf("Commission SUCCEEDED phải đánh thức reconcile đúng một lần, nhận %d", fired.Load())
	}
}

func TestActivatedHookFiresWhenRestoreSucceeds(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{}
	service := fixture.service(t, runtime)
	var fired atomic.Int32
	service.SetActivatedHook(func() { fired.Add(1) })
	if _, err := service.Restore(context.Background(), Actor{ID: testActorID, Role: "admin"},
		OperationCommand{SchemaVersion: "1.0", RevisionID: fixture.revision,
			Reason: "F13: Restore phải đánh thức reconcile", Cutover: "PROGRAM_ONLY",
			IdempotencyKey: "40000000-0000-4000-8000-000000000913", CorrelationID: testCorrelationID}); err != nil {
		t.Fatal(err)
	}
	processOperation(t, service)
	processOperation(t, service)
	if fired.Load() != 1 {
		t.Fatalf("Restore SUCCEEDED phải đánh thức reconcile đúng một lần, nhận %d", fired.Load())
	}
}

func TestActivatedHookDoesNotFireWhenActivateOutcomeIsUnknown(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{failActivate: true}
	service := fixture.service(t, runtime)
	var fired atomic.Int32
	service.SetActivatedHook(func() { fired.Add(1) })
	if _, err := service.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"},
		fixture.commissionCommand(t, runtime)); err != nil {
		t.Fatal(err)
	}
	processOperation(t, service)
	if fired.Load() != 0 {
		t.Fatalf("ACTIVATE chưa rõ kết quả (UNKNOWN) không được coi là Active đã đổi: %d", fired.Load())
	}
}

func TestIntentNudgeRunsReconcileWithoutWaitingForTick(t *testing.T) {
	service, _, _ := openIntentService(t)
	service.logf = func(string, ...any) {}
	rounds := make(chan struct{}, 8)
	service.reconcileOnce = func(context.Context) (int, error) {
		rounds <- struct{}{}
		return 0, nil
	}
	if err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	select {
	case <-rounds: // vòng đầu chạy ngay lúc Start
	case <-time.After(time.Second):
		t.Fatal("vòng reconcile đầu không chạy")
	}
	started := time.Now()
	service.Nudge()
	select {
	case <-rounds:
		if waited := time.Since(started); waited >= intentReconcileInterval/2 {
			t.Fatalf("Nudge phải chạy reconcile ngay, đã chờ %v (tick %v)", waited, intentReconcileInterval)
		}
	case <-time.After(intentReconcileInterval / 2):
		t.Fatalf("Nudge không đánh thức vòng reconcile trước tick %v", intentReconcileInterval)
	}
	// Nhiều Nudge dồn lại không được chặn caller (hook gọi từ worker operation).
	for i := 0; i < 16; i++ {
		service.Nudge()
	}
}
