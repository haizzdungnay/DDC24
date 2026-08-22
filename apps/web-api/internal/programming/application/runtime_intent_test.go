package application

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
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
