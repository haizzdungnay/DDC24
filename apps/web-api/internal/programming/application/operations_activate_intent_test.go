package application

// ADR-062 (F13, EV-PROG-FBD-ST-MB-20260925): Commission/Restore mang intent
// Enable ĐÃ LƯU của từng Program vào chính lệnh ACTIVATE, để Core dựng Program
// ở RUNNING ngay tại safe boundary kích hoạt gói thay vì Disabled rồi chờ một
// vòng IPC. Các test dưới đây khoá phía web:
//
//   - Chỉ gửi payload 5 phần tử khi Core công bố `ACTIVATE_PROGRAM_INTENTS`.
//     Core cũ đòi đúng 4 phần tử, nên gửi bừa là làm hỏng mọi Commission.
//   - Chỉ gửi intent của Program THUỘC Revision, gồm cả intent `false`.
//   - Mọi lỗi của bước "cho nhanh hơn" đều quay về payload 4 phần tử, không
//     bao giờ làm hỏng Commission hay chặn Restore.
//   - Chuỗi byte Go sinh ra khớp golden mà Core C++ đọc lại.
//
// Bản giả Core (`fakeOperationRuntime`) chạy `coreipc.ValidateRequest` cho mọi
// request, như Core thật làm ở biên.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/fxamacker/cbor/v2"

	"mkddc-web/internal/programming/coreipc"
	programmingstore "mkddc-web/internal/programming/store"
)

// fixtureProgramID là Program duy nhất của Revision fixture
// (`createCheckRevisionFixtureWithPeriod`), cũng là tên instance trong gói.
const fixtureProgramID = "55555555-5555-4555-8555-555555555555"

// foreignProgramID có intent trong cùng Project nhưng KHÔNG thuộc Revision.
const foreignProgramID = "77777777-7777-4777-8777-777777777777"

func storeIntent(t *testing.T, fixture operationFixture, programID string, enabled bool, seq byte) {
	t.Helper()
	header, err := fixture.store.GetRevisionHeader(context.Background(), fixture.revision)
	if err != nil {
		t.Fatal(err)
	}
	identity := programmingstore.ProgramIntentIdentity{
		ProjectID: header.ProjectID, ActorID: testActorID, Role: "operator",
		AuditID:       fmt.Sprintf("70000000-0000-4000-8000-0000000000%02x", seq),
		CorrelationID: testCorrelationID, At: fixture.now,
		IdempotencyKeySHA256: sha256.Sum256([]byte{'k', seq}),
		RequestSHA256:        sha256.Sum256([]byte{'r', seq}),
	}
	if _, err := fixture.store.SetProgramEnableIntent(context.Background(), identity, programID, enabled); err != nil {
		t.Fatal(err)
	}
}

// decodeActivate tách payload ACTIVATE: số phần tử, và danh sách intent nếu có.
func decodeActivate(t *testing.T, payload []byte) (int, []activateProgramIntent, []byte) {
	t.Helper()
	var fields []cbor.RawMessage
	if err := coreipc.DecodePayload(payload, &fields); err != nil {
		t.Fatalf("payload ACTIVATE không phải CBOR canonical: %v", err)
	}
	if len(fields) != 4 && len(fields) != 5 {
		t.Fatalf("payload ACTIVATE có %d phần tử", len(fields))
	}
	if len(fields) == 4 {
		return 4, nil, nil
	}
	var intents []activateProgramIntent
	if err := cbor.Unmarshal(fields[4], &intents); err != nil {
		t.Fatalf("programIntents không đọc được: %v", err)
	}
	return 5, intents, fields[4]
}

func runCommission(t *testing.T, fixture operationFixture, runtime *fakeOperationRuntime) (*OperationService, string) {
	t.Helper()
	service := fixture.service(t, runtime)
	accepted, err := service.Commission(context.Background(), Actor{ID: testActorID, Role: "admin"},
		fixture.commissionCommand(t, runtime))
	if err != nil {
		t.Fatal(err)
	}
	processOperation(t, service)
	return service, accepted.OperationID
}

func assertNoInvalidRequests(t *testing.T, runtime *fakeOperationRuntime) {
	t.Helper()
	if len(runtime.invalidRequests) != 0 {
		t.Fatalf("web gửi request mà Core sẽ từ chối ở biên: %v", runtime.invalidRequests)
	}
}

func TestActivateCarriesStoredIntentsWhenCoreAdvertisesFeature(t *testing.T) {
	fixture := newOperationFixture(t)
	storeIntent(t, fixture, fixtureProgramID, true, 1)
	storeIntent(t, fixture, foreignProgramID, true, 2)
	runtime := &fakeOperationRuntime{advertiseActivateIntents: true}
	service, operationID := runCommission(t, fixture, runtime)
	assertNoInvalidRequests(t, runtime)

	if len(runtime.activatePayloads) != 1 {
		t.Fatalf("ACTIVATE gửi %d lần", len(runtime.activatePayloads))
	}
	count, intents, _ := decodeActivate(t, runtime.activatePayloads[0])
	if count != 5 {
		t.Fatalf("Core công bố tính năng mà web vẫn gửi %d phần tử", count)
	}
	if len(intents) != 1 || intents[0].InstanceID != fixtureProgramID || !intents[0].Enabled {
		t.Fatalf("programIntents=%+v; chỉ được mang intent của Program thuộc Revision", intents)
	}
	// CAPABILITIES phải đứng NGAY trước ACTIVATE: hỏi sớm hơn thì câu trả lời có
	// thể là của một Core khác (vừa nâng/hạ) so với Core nhận ACTIVATE.
	for index, action := range runtime.calls {
		if action == coreipc.ActionActivate {
			if index == 0 || runtime.calls[index-1] != coreipc.ActionCapabilities {
				t.Fatalf("CAPABILITIES không đứng ngay trước ACTIVATE: %v", runtime.calls)
			}
		}
	}
	processOperation(t, service)
	operation, err := fixture.store.GetOperation(context.Background(), operationID)
	if err != nil || operation.State != "SUCCEEDED" {
		t.Fatalf("Commission có intent phải SUCCEEDED như cũ: %+v err=%v", operation, err)
	}
}

func TestActivateCarriesStoredDisableIntent(t *testing.T) {
	fixture := newOperationFixture(t)
	storeIntent(t, fixture, fixtureProgramID, false, 1)
	runtime := &fakeOperationRuntime{advertiseActivateIntents: true}
	_, _ = runCommission(t, fixture, runtime)
	assertNoInvalidRequests(t, runtime)
	_, intents, _ := decodeActivate(t, runtime.activatePayloads[0])
	if len(intents) != 1 || intents[0].InstanceID != fixtureProgramID || intents[0].Enabled {
		t.Fatalf("intent Disable phải đi cùng ACTIVATE để Program không chạy thêm scan nào: %+v", intents)
	}
}

func TestActivateWithoutStoredIntentSendsEmptyListNotNull(t *testing.T) {
	fixture := newOperationFixture(t)
	runtime := &fakeOperationRuntime{advertiseActivateIntents: true}
	_, _ = runCommission(t, fixture, runtime)
	assertNoInvalidRequests(t, runtime)
	count, intents, raw := decodeActivate(t, runtime.activatePayloads[0])
	if count != 5 || len(intents) != 0 {
		t.Fatalf("count=%d intents=%+v", count, intents)
	}
	// 0x80 = mảng rỗng. `nil` sẽ mã hoá thành 0xf6 (null) và Core từ chối null.
	if hex.EncodeToString(raw) != "80" {
		t.Fatalf("programIntents rỗng phải là mảng rỗng 0x80, nhận %x", raw)
	}
}

func TestActivateStaysLegacyWhenCoreDoesNotAdvertiseFeature(t *testing.T) {
	fixture := newOperationFixture(t)
	storeIntent(t, fixture, fixtureProgramID, true, 1)
	runtime := &fakeOperationRuntime{} // Core cũ: CAPABILITIES không có `features`
	service, operationID := runCommission(t, fixture, runtime)
	assertNoInvalidRequests(t, runtime)
	if count, _, _ := decodeActivate(t, runtime.activatePayloads[0]); count != 4 {
		t.Fatalf("Core cũ chỉ nhận 4 phần tử, web gửi %d", count)
	}
	processOperation(t, service)
	operation, _ := fixture.store.GetOperation(context.Background(), operationID)
	if operation.State != "SUCCEEDED" {
		t.Fatalf("web mới + Core cũ phải chạy như hiện nay: %+v", operation)
	}
}

func TestActivateFallsBackToLegacyWhenCapabilitiesFails(t *testing.T) {
	fixture := newOperationFixture(t)
	storeIntent(t, fixture, fixtureProgramID, true, 1)
	runtime := &fakeOperationRuntime{advertiseActivateIntents: true, failCapabilities: true}
	_, operationID := runCommission(t, fixture, runtime)
	assertNoInvalidRequests(t, runtime)
	if count, _, _ := decodeActivate(t, runtime.activatePayloads[0]); count != 4 {
		t.Fatalf("CAPABILITIES lỗi phải quay về payload 4 phần tử, nhận %d", count)
	}
	operation, _ := fixture.store.GetOperation(context.Background(), operationID)
	if operation.State != "VERIFYING" {
		t.Fatalf("lỗi của bước dò tính năng không được làm hỏng Commission: %+v", operation)
	}
}

func TestRestoreCarriesStoredIntents(t *testing.T) {
	fixture := newOperationFixture(t)
	storeIntent(t, fixture, fixtureProgramID, true, 1)
	runtime := &fakeOperationRuntime{advertiseActivateIntents: true}
	service := fixture.service(t, runtime)
	if _, err := service.Restore(context.Background(), Actor{ID: testActorID, Role: "admin"},
		OperationCommand{SchemaVersion: "1.0", RevisionID: fixture.revision,
			Reason: "ADR-062: Restore mang intent đã lưu", Cutover: "PROGRAM_ONLY",
			IdempotencyKey: "40000000-0000-4000-8000-000000000962", CorrelationID: testCorrelationID}); err != nil {
		t.Fatal(err)
	}
	processOperation(t, service)
	processOperation(t, service)
	assertNoInvalidRequests(t, runtime)
	_, intents, _ := decodeActivate(t, runtime.activatePayloads[0])
	if len(intents) != 1 || intents[0].InstanceID != fixtureProgramID || !intents[0].Enabled {
		t.Fatalf("Restore phải mang intent đã lưu: %+v", intents)
	}
}

func TestCapabilitiesHaveFeatureReadsOnlyTheFifthElement(t *testing.T) {
	encode := func(value any) []byte {
		payload, err := coreipc.EncodePayload(value)
		if err != nil {
			t.Fatal(err)
		}
		return payload
	}
	periods := []int{10, 1000}
	cases := []struct {
		name    string
		payload []byte
		want    bool
	}{
		{"core cũ 4 phần tử", encode([]any{"MK-DDC-24-REV-A", 65536, 32, periods}), false},
		{"core mới có tính năng", encode([]any{"MK-DDC-24-REV-A", 65536, 32, periods,
			[]string{coreFeatureActivateProgramIntents}}), true},
		{"tính năng khác", encode([]any{"MK-DDC-24-REV-A", 65536, 32, periods,
			[]string{"SOMETHING_ELSE"}}), false},
		{"phần tử thứ năm sai kiểu", encode([]any{"MK-DDC-24-REV-A", 65536, 32, periods, "x"}), false},
		{"payload rỗng", coreipc.EmptyPayload(), false},
		{"không phải CBOR canonical", []byte{0x9f, 0xff}, false},
	}
	for _, testCase := range cases {
		if got := capabilitiesHaveFeature(testCase.payload, coreFeatureActivateProgramIntents); got != testCase.want {
			t.Fatalf("%s: got %v want %v", testCase.name, got, testCase.want)
		}
	}
}

// Golden liên ngôn ngữ: Core C++ (`GoldenActivateFrameFromGoIsAppliedByCore`)
// đọc đúng file này và phải bật P_ahu, tắt P_boiler. Đổi encoder mà golden
// không đổi theo là hai phía đang nói hai ngôn ngữ khác nhau.
func TestGoldenActivateProgramIntentsFrameMatchesGoEncoder(t *testing.T) {
	deterministic := func(count int, start byte) []byte {
		output := make([]byte, count)
		for index := range output {
			output[index] = start + byte(index)
		}
		return output
	}
	payload, err := coreipc.EncodePayload(activateIntentPayload{ExpectedActive: nil,
		StagedToken: "10111213-1415-1617-1819-1a1b1c1d1e1f", Cutover: "PROGRAM_ONLY",
		PlanHash: strings.Repeat("a", 64),
		ProgramIntents: []activateProgramIntent{{InstanceID: "P_ahu", Enabled: true},
			{InstanceID: "P_boiler", Enabled: false}}})
	if err != nil {
		t.Fatal(err)
	}
	request := coreipc.NewRequest(coreipc.ActionActivate, deterministic(16, 0x00), deterministic(16, 0x10),
		"controller-1", "admin-1", "correlation-id-0001", 2_000_000, payload)
	frame, err := coreipc.EncodeRequestFrame(request)
	if err != nil {
		t.Fatal(err)
	}
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được đường dẫn test")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(source),
		"../../../../../contracts/ipc/programming_v1/golden/request_activate_program_intents.hex"))
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("thiếu golden %s; nội dung cần ghi: %s", path, hex.EncodeToString(frame))
	}
	if strings.TrimSpace(string(content)) != hex.EncodeToString(frame) {
		t.Fatalf("golden drift; nội dung đúng: %s", hex.EncodeToString(frame))
	}
	decoded, err := coreipc.DecodeRequestFrame(frame)
	if err != nil {
		t.Fatal(err)
	}
	if count, intents, _ := decodeActivate(t, decoded.Payload); count != 5 || len(intents) != 2 {
		t.Fatalf("golden decode count=%d intents=%+v", count, intents)
	}
}
