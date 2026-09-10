package application

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"mkddc-web/internal/programming/coreipc"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const intentProjectID = "77777777-7777-4777-8777-777777777771"

// fakeIntentRuntime ghi lại mọi lệnh đi xuống Core. Nó KHÔNG mô phỏng Core:
// hành vi thật của Core do test C++ canh. Ở đây chỉ cần biết lệnh nào được gửi,
// gửi mấy lần, và service phản ứng thế nào với từng kết quả.
type fakeIntentRuntime struct {
	calls    []coreipc.Request
	result   coreipc.Result
	callErr  error
	disabled bool
}

func (f *fakeIntentRuntime) Call(_ context.Context, request coreipc.Request) (coreipc.Response, error) {
	if f.disabled {
		return coreipc.Response{}, errors.New("core không sẵn sàng")
	}
	f.calls = append(f.calls, request)
	if f.callErr != nil {
		return coreipc.Response{}, f.callErr
	}
	result := f.result
	if result == "" {
		result = coreipc.ResultOK
	}
	return coreipc.Response{Result: result}, nil
}

func openIntentService(t *testing.T) (*RuntimeIntentService, *fakeIntentRuntime, string) {
	t.Helper()
	fixedNow := time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)
	// Store.now và service.now phải khớp: lệch nhau thì TTL biên nhận
	// idempotency tính theo đồng hồ thật và test hỏng muộn.
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming-v1.sqlite"),
		Now:  func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	projects, err := NewProjectService(store, []byte("cursor-secret-t59-405-intent"))
	if err != nil {
		t.Fatal(err)
	}
	projects.newID = func() string { return intentProjectID }
	projects.now = func() time.Time { return fixedNow }
	if _, err := projects.CreateProject(context.Background(), Actor{ID: testActorID, Role: "admin"},
		CreateProjectCommand{SchemaVersion: "1.0", Name: "AHU tầng 2", Description: "fixture intent",
			IdempotencyKey: "10000000-0000-4000-8000-000000000401",
			CorrelationID:  testCorrelationID}); err != nil {
		t.Fatal(err)
	}

	runtime := &fakeIntentRuntime{}
	counter := 0
	service, err := NewRuntimeIntentService(RuntimeIntentServiceOptions{
		Store: store, Runtime: runtime, ControllerID: "controller-local",
		Now: func() time.Time { return fixedNow },
		NewID: func() string {
			counter++
			return fmt.Sprintf("cccccccc-cccc-4ccc-8ccc-%012d", counter)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return service, runtime, intentProjectID
}

func intentCommand(programID string, enabled bool, key string) SetProgramIntentCommand {
	return SetProgramIntentCommand{SchemaVersion: "1.0", ProjectID: intentProjectID,
		ProgramID: programID, DesiredEnabled: enabled, IdempotencyKey: key,
		CorrelationID: testCorrelationID}
}

// Đường đầy đủ: Core chỉ trả OK sau khi lệnh đồng bộ đã đạt
// trạng thái đích, nên read-back phải phản ánh RUNNING/DISABLED.
func TestSetProgramEnabledWritesIntentAndPushesToCore(t *testing.T) {
	service, runtime, projectID := openIntentService(t)
	result, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_ahu", true, "20000000-0000-4000-8000-000000000401"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Replay {
		t.Fatal("lần đầu không được là replay")
	}
	if len(runtime.calls) != 1 || runtime.calls[0].Action != coreipc.ActionSetProgramEnabled {
		t.Fatalf("lệnh xuống Core sai: %+v", runtime.calls)
	}
	if runtime.calls[0].ActorID != testActorID {
		t.Fatalf("actorId IPC=%q, phải giữ actor đã ghi intent %q", runtime.calls[0].ActorID, testActorID)
	}
	if err := coreipc.ValidateRequest(runtime.calls[0]); err != nil {
		t.Fatalf("lệnh SET_PROGRAM_ENABLED không qua được validator IPC thật: %v", err)
	}
	intents, err := service.ListProgramIntents(context.Background(), projectID)
	if err != nil {
		t.Fatal(err)
	}
	if len(intents) != 1 || !intents[0].DesiredEnabled || intents[0].Generation != 1 {
		t.Fatalf("intent=%+v", intents)
	}
	if intents[0].RuntimeState != "RUNNING" {
		t.Fatalf("runtimeState=%q, phải là RUNNING", intents[0].RuntimeState)
	}
	if intents[0].UpdatedBy != testActorID {
		t.Fatalf("updatedBy=%q", intents[0].UpdatedBy)
	}
}

// Core boot fail-closed ở Disabled, nên Web API restart phải tách observation
// RUNNING cũ khỏi boot mới rồi replay đúng intent bền vững. Replay reconciliation
// không được tăng generation/audit như một thao tác operator mới.
func TestRuntimeIntentReconcilesPersistedEnableAfterRestart(t *testing.T) {
	service, runtime, projectID := openIntentService(t)
	programID := "P_restart"
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand(programID, true, "20000000-0000-4000-8000-000000000499")); err != nil {
		t.Fatal(err)
	}
	if len(runtime.calls) != 1 {
		t.Fatalf("lệnh ban đầu=%d", len(runtime.calls))
	}
	if err := service.store.MarkAllProgramRuntimeStatesUnknown(context.Background(), service.now()); err != nil {
		t.Fatal(err)
	}

	restartedRuntime := &fakeIntentRuntime{}
	counter := 100
	restarted, err := NewRuntimeIntentService(RuntimeIntentServiceOptions{
		Store: service.store, Runtime: restartedRuntime, ControllerID: service.controllerID,
		Now: service.now, NewID: func() string {
			counter++
			return fmt.Sprintf("dddddddd-dddd-4ddd-8ddd-%012d", counter)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := restarted.ReconcileOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if replayed != 1 || len(restartedRuntime.calls) != 1 ||
		restartedRuntime.calls[0].Action != coreipc.ActionSetProgramEnabled {
		t.Fatalf("reconcile=%d calls=%+v", replayed, restartedRuntime.calls)
	}
	intents, err := restarted.ListProgramIntents(context.Background(), projectID)
	if err != nil {
		t.Fatal(err)
	}
	if len(intents) != 1 || !intents[0].DesiredEnabled || intents[0].Generation != 1 ||
		intents[0].RuntimeState != "RUNNING" {
		t.Fatalf("intent sau restart=%+v", intents)
	}
}

// Gửi lại cùng idempotency key KHÔNG được đẩy lệnh xuống Core lần hai: một lần
// gửi lại vì mạng không được thành một lệnh vận hành thứ hai.
func TestSetProgramEnabledReplayDoesNotResendToCore(t *testing.T) {
	service, runtime, _ := openIntentService(t)
	command := intentCommand("P_ahu", true, "20000000-0000-4000-8000-000000000402")
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"}, command); err != nil {
		t.Fatal(err)
	}
	replay, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"}, command)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replay {
		t.Fatal("lần hai phải là replay")
	}
	if len(runtime.calls) != 1 {
		t.Fatalf("Core nhận %d lệnh, phải là 1", len(runtime.calls))
	}
}

// Bật rồi tắt là HAI action riêng ở lớp biên nhận. Cùng idempotency key cho hai
// chiều phải cho hai kết quả khác nhau, không phải một replay.
func TestEnableAndDisableAreDistinctIdempotencyActions(t *testing.T) {
	service, _, projectID := openIntentService(t)
	key := "20000000-0000-4000-8000-000000000403"
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_ahu", true, key)); err != nil {
		t.Fatal(err)
	}
	disabled, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_ahu", false, key))
	if err != nil {
		t.Fatal(err)
	}
	if disabled.Replay {
		t.Fatal("tắt bị nhầm thành replay của lệnh bật")
	}
	intents, err := service.ListProgramIntents(context.Background(), projectID)
	if err != nil {
		t.Fatal(err)
	}
	if intents[0].DesiredEnabled {
		t.Fatal("intent vẫn là Enabled sau khi tắt")
	}
	if intents[0].RuntimeState != "DISABLED" {
		t.Fatalf("runtimeState=%q, phải là DISABLED", intents[0].RuntimeState)
	}
	// Generation chỉ tăng: intent cũ tới muộn không được ghi đè intent mới.
	if intents[0].Generation != 2 {
		t.Fatalf("generation=%d", intents[0].Generation)
	}
}

// Core từ chối: intent VẪN bền vững, nhưng trạng thái phải nói ra sự thật.
func TestCoreRejectionKeepsIntentAndReportsFault(t *testing.T) {
	service, runtime, projectID := openIntentService(t)
	runtime.result = coreipc.ResultRejected
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_ahu", true, "20000000-0000-4000-8000-000000000404")); err != nil {
		t.Fatal(err)
	}
	intents, err := service.ListProgramIntents(context.Background(), projectID)
	if err != nil {
		t.Fatal(err)
	}
	if !intents[0].DesiredEnabled {
		t.Fatal("Core từ chối không được xoá intent — intent là ý định, không phải kết quả")
	}
	if intents[0].RuntimeState != "FAULTED" {
		t.Fatalf("runtimeState=%q", intents[0].RuntimeState)
	}
}

// Core không sẵn sàng: intent bền vững, trạng thái là UNKNOWN. Đoán rằng lệnh
// đã tới nơi là đúng thứ làm người vận hành tin nhầm.
func TestCoreUnavailableLeavesIntentDurableAndStateUnknown(t *testing.T) {
	service, runtime, projectID := openIntentService(t)
	runtime.disabled = true
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_ahu", true, "20000000-0000-4000-8000-000000000405")); err != nil {
		t.Fatal(err)
	}
	intents, err := service.ListProgramIntents(context.Background(), projectID)
	if err != nil {
		t.Fatal(err)
	}
	if !intents[0].DesiredEnabled || intents[0].RuntimeState != "UNKNOWN" {
		t.Fatalf("intent=%+v", intents[0])
	}
}

// Trần 16 Enabled ép TRƯỚC khi ghi: intent là thứ bền vững, nên một intent vượt
// trần sẽ sống lại ở mỗi lần khởi động và bị Core từ chối mãi mãi.
func TestEnableIsCappedAtProfileLimit(t *testing.T) {
	service, _, projectID := openIntentService(t)
	for index := 0; index < domain.MaxProgramsEnabled; index++ {
		if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
			intentCommand(fmt.Sprintf("P_%02d", index), true,
				fmt.Sprintf("20000000-0000-4000-8000-0000000005%02d", index))); err != nil {
			t.Fatalf("Program %d: %v", index, err)
		}
	}
	_, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_over", true, "20000000-0000-4000-8000-000000000599"))
	limit, ok := asProgramLimitError(err)
	if !ok {
		t.Fatalf("một-trên-trần không bị chặn: %v", err)
	}
	if limit.Limit != domain.MaxProgramsEnabled {
		t.Fatalf("trần báo về sai: %+v", limit)
	}
	// Bật LẠI một Program đã Enabled không tính là thêm suất mới.
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_00", true, "20000000-0000-4000-8000-000000000600")); err != nil {
		t.Fatalf("bật lại Program đã Enabled bị chặn: %v", err)
	}
	intents, err := service.ListProgramIntents(context.Background(), projectID)
	if err != nil {
		t.Fatal(err)
	}
	if len(intents) != domain.MaxProgramsEnabled {
		t.Fatalf("số intent=%d", len(intents))
	}
}

// Actor rỗng nghĩa là middleware auth chưa chạy. Phải là 400 chứ không phải một
// lỗi không sentinel bị lớp HTTP dịch thành 503 "hãy thử lại".
func TestEmptyActorIsRejectedAsBadRequest(t *testing.T) {
	service, runtime, _ := openIntentService(t)
	_, err := service.SetProgramEnabled(context.Background(), Actor{},
		intentCommand("P_ahu", true, "20000000-0000-4000-8000-000000000406"))
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("err=%v", err)
	}
	if len(runtime.calls) != 0 {
		t.Fatal("actor rỗng vẫn gửi lệnh xuống Core")
	}
}

// Trạng thái runtime là enum ĐÓNG ở lớp store: một chuỗi lạ phải bị chặn ở Go
// chứ không hiện ra dưới dạng "constraint failed" của SQLite.
func TestRecordRuntimeStateRejectsUnknownState(t *testing.T) {
	service, _, projectID := openIntentService(t)
	if _, err := service.SetProgramEnabled(context.Background(), Actor{ID: testActorID, Role: "admin"},
		intentCommand("P_ahu", true, "20000000-0000-4000-8000-000000000407")); err != nil {
		t.Fatal(err)
	}
	if err := service.store.RecordProgramRuntimeState(context.Background(), projectID, "P_ahu",
		"BANANA", time.Now()); err == nil {
		t.Fatal("trạng thái lạ không bị chặn")
	}
	// Program chưa có intent: không tự tạo dòng, vì đó là dấu hiệu Core và
	// Project đang nói về hai gói khác nhau.
	if err := service.store.RecordProgramRuntimeState(context.Background(), projectID, "P_ghost",
		"RUNNING", time.Now()); !errors.Is(err, programmingstore.ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
}

// `ISSUE-591` — vòng reconcile nền từng gọi `_, _ = s.ReconcileOnce(ctx)`: cả số
// bản ghi lẫn lỗi đều bị vứt. Nhóm test dưới đây canh hợp đồng thay thế: lỗi
// được ghi lại, được log theo bậc lùi, và biến mất khi vòng lành lại.

// Một sự cố đứng yên (Core chết, store lỗi) lặp lại mỗi 2 giây. Log mỗi tick sẽ
// chôn mất mọi thứ khác trong log; im hẳn sau dòng đầu thì sự cố kéo dài không
// còn ai nhắc. Luật là bậc lùi luỹ thừa 2 — test này đếm dòng log thật qua 16
// tick liên tiếp cùng một lỗi.
func TestReconcileWorkerBacksOffLogsForRepeatingError(t *testing.T) {
	service, _, _ := openIntentService(t)
	stuck := errors.New("store không đọc được")
	service.reconcileOnce = func(context.Context) (int, error) { return 0, stuck }

	var lines []string
	service.logf = func(format string, args ...any) {
		lines = append(lines, fmt.Sprintf(format, args...))
	}

	const ticks = 16
	for i := 0; i < ticks; i++ {
		if _, err := service.reconcileTick(context.Background()); !errors.Is(err, stuck) {
			t.Fatalf("tick %d trả err=%v, phải là lỗi đã tiêm", i, err)
		}
	}

	// 16 tick cùng một lỗi ⇒ log ở tick thứ 1, 2, 4, 8, 16 = 5 dòng, KHÔNG phải 16.
	if len(lines) != 5 {
		t.Fatalf("số dòng log=%d (%v), phải là 5 — log không được tăng tuyến tính theo tick", len(lines), lines)
	}
	for _, line := range lines {
		if !strings.HasPrefix(line, "WARN programming_runtime_intent_worker err=") {
			t.Fatalf("dòng log sai định dạng worker (quy ước checks.go:520): %q", line)
		}
	}
	if !strings.Contains(lines[len(lines)-1], "streak=16") {
		t.Fatalf("dòng cuối=%q, phải nói rõ đã hỏng liên tiếp 16 lần", lines[len(lines)-1])
	}
	if service.ConsecutiveReconcileFailures() != ticks {
		t.Fatalf("chuỗi lỗi=%d, phải là %d", service.ConsecutiveReconcileFailures(), ticks)
	}
	if got := service.LastReconcileError(); !errors.Is(got, stuck) {
		t.Fatalf("LastReconcileError=%v, phải giữ lỗi vừa xảy ra", got)
	}
}

// Lỗi ĐỔI DẠNG là tin mới: nó phải được nói ra ngay ở tick kế tiếp, không bị
// nuốt vì lỗi cũ đang trong quãng im lặng của bậc lùi.
func TestReconcileWorkerLogsImmediatelyWhenErrorChanges(t *testing.T) {
	service, _, _ := openIntentService(t)
	current := errors.New("core không sẵn sàng")
	service.reconcileOnce = func(context.Context) (int, error) { return 0, current }

	lines := 0
	service.logf = func(string, ...any) { lines++ }

	// 3 tick cùng lỗi ⇒ log ở tick 1 và 2, im ở tick 3.
	for i := 0; i < 3; i++ {
		service.reconcileTick(context.Background())
	}
	if lines != 2 {
		t.Fatalf("sau 3 tick cùng lỗi, số dòng log=%d, phải là 2", lines)
	}

	current = errors.New("store trả lỗi khác hẳn")
	service.reconcileTick(context.Background())
	if lines != 3 {
		t.Fatalf("lỗi đổi dạng phải log ngay: số dòng log=%d, phải là 3", lines)
	}
	if service.ConsecutiveReconcileFailures() != 1 {
		t.Fatalf("lỗi đổi dạng phải đếm lại chuỗi từ 1, đang là %d",
			service.ConsecutiveReconcileFailures())
	}
}

// Vòng lành lại phải xoá sạch trạng thái lỗi: giữ lại "lỗi gần nhất" sau khi hệ
// thống đã hồi phục là cách nhanh nhất để người vận hành đi chữa một sự cố đã hết.
func TestSuccessfulReconcileClearsFailureState(t *testing.T) {
	service, _, _ := openIntentService(t)
	failing := true
	service.reconcileOnce = func(context.Context) (int, error) {
		if failing {
			return 0, errors.New("core không sẵn sàng")
		}
		return 2, nil
	}
	var lines []string
	service.logf = func(format string, args ...any) {
		lines = append(lines, fmt.Sprintf(format, args...))
	}

	for i := 0; i < 3; i++ {
		service.reconcileTick(context.Background())
	}
	if service.ConsecutiveReconcileFailures() == 0 || service.LastReconcileError() == nil {
		t.Fatal("chuỗi lỗi phải được ghi lại trước khi kiểm nhánh hồi phục")
	}

	failing = false
	replayed, err := service.reconcileTick(context.Background())
	if err != nil || replayed != 2 {
		t.Fatalf("tick thành công trả (%d, %v)", replayed, err)
	}
	if service.ConsecutiveReconcileFailures() != 0 {
		t.Fatalf("chuỗi lỗi=%d sau khi lành, phải là 0", service.ConsecutiveReconcileFailures())
	}
	if got := service.LastReconcileError(); got != nil {
		t.Fatalf("LastReconcileError=%v sau khi lành, phải là nil", got)
	}
	last := lines[len(lines)-1]
	if !strings.HasPrefix(last, "INFO programming_runtime_intent_worker recovered_after=3") {
		t.Fatalf("dòng hồi phục=%q, phải nói rõ vừa lành sau 3 vòng lỗi", last)
	}
}

// `Close()` huỷ context rồi mới `wg.Wait()`, nên vòng đang chạy dở gần như luôn
// trả về một lỗi context. Ghi nó vào trạng thái sức khoẻ sẽ để lại "lỗi gần
// nhất" là một lỗi tắt máy trên MỌI lần shutdown sạch.
func TestReconcileTickIgnoresShutdownContextError(t *testing.T) {
	service, _, _ := openIntentService(t)
	service.reconcileOnce = func(ctx context.Context) (int, error) { return 0, ctx.Err() }
	lines := 0
	service.logf = func(string, ...any) { lines++ }

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	service.reconcileTick(ctx)

	if lines != 0 {
		t.Fatalf("tắt máy không được log như sự cố: số dòng log=%d", lines)
	}
	if service.LastReconcileError() != nil || service.ConsecutiveReconcileFailures() != 0 {
		t.Fatalf("tắt máy không được ghi vào trạng thái sức khoẻ: err=%v streak=%d",
			service.LastReconcileError(), service.ConsecutiveReconcileFailures())
	}
}

// Trạng thái sức khoẻ được goroutine nền ghi và caller ngoài đọc. Test này chạy
// dưới `-race` để chứng minh cặp đọc/ghi đó có khoá đúng.
func TestReconcileHealthIsSafeForConcurrentReads(t *testing.T) {
	service, _, _ := openIntentService(t)
	service.reconcileOnce = func(context.Context) (int, error) {
		return 0, errors.New("core không sẵn sàng")
	}
	service.logf = func(string, ...any) {}

	if err := service.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)

	var wg sync.WaitGroup
	for reader := 0; reader < 4; reader++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				_ = service.LastReconcileError()
				_ = service.ConsecutiveReconcileFailures()
			}
		}()
	}
	wg.Wait()
}
