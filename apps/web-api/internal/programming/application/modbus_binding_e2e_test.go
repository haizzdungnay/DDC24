package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
)

/* `ISS-PIO-02`/`F-PIO-019` — điểm Modbus map được vào biến chương trình.
 *
 * Điều kiện đóng của issue đòi một đường ĐI HẾT: tạo điểm → map → Check → chạy
 * runtime. Từng mảnh đã có test riêng (`point_eligibility_test.go` cho
 * eligibility, `programming_extindex_test.go` cho Catalog, `5a…5g` cho danh
 * tính), nhưng **không mảnh nào chứng minh chúng nối được với nhau** — và đó
 * đúng là chỗ `F-PIO-019` sống: mỗi tầng nói "tôi hỗ trợ MB_RTU" trong khi cả
 * chuỗi thì không đi được.
 *
 * Test này đi trọn chuỗi trên MỘT bản đồ slot, và kết thúc bằng `io_map` mà
 * compiler THẬT SỰ nhận — tức thứ runtime sẽ chạy. */

const (
	e2eDeviceID = "bus-1-slave-4"
	e2ePointID  = "PUMP_CMD"
)

// e2eSlots là authority phía server: cùng hình dạng mà adapter production dựng
// từ `fieldbus.conf` qua `BuildExtLayout`.
type e2eSlots struct {
	snapshot ModbusSlotSnapshot
	err      error
}

func (s e2eSlots) ResolveModbusSlots(context.Context) (ModbusSlotSnapshot, error) {
	return s.snapshot, s.err
}

func modbusE2ESnapshot() ModbusSlotSnapshot {
	address := 4
	return ModbusSlotSnapshot{ConfigRevision: "7", Slots: []ModbusSlot{{
		DeviceID: e2eDeviceID, PointID: e2ePointID, ExtIndex: 3,
		RegisterType: "coil", Address: address, AddressKnown: true,
		DataType: "bool", ReadWrite: "read_write",
	}}}
}

// checkModbusBinding chạy trọn chuỗi và trả về `io_map` mà compiler nhận được.
func checkModbusBinding(t *testing.T, slots ModbusSlotProvider, point map[string]any) (string, []programmingcompiler.IoMapEntry) {
	t.Helper()
	projects, store := openProjectService(t)
	actor := Actor{ID: testActorID, Role: "admin"}
	created, err := projects.CreateProject(context.Background(), actor, CreateProjectCommand{
		SchemaVersion: "1.0", Name: "Modbus binding E2E",
		IdempotencyKey: "30000000-0000-4000-8000-000000000401", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Resource["projectId"].(string)
	draftID := created.Resource["draftRevisionId"].(string)
	programID := "77777777-7777-4777-8777-777777777777"
	varID := "88888888-8888-4888-8888-888888888888"
	bindID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	taskID := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	source := "PROGRAM P\nVAR_OUTPUT PumpCmd : BOOL; END_VAR\nPumpCmd := TRUE;\nEND_PROGRAM\n"

	program, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": "P", "kind": "PROGRAM", "language": "ST", "document": source}})
	variable, _ := json.Marshal(map[string]any{"op": "upsertVariable", "variable": map[string]any{
		"variableId": varID, "programId": programID, "name": "PumpCmd", "type": "BOOL",
		"class": "OUTPUT", "initialValue": nil, "retain": false}})
	// Binding mang ĐÚNG danh tính bền `(deviceId, pointId)` — không `extIndex`,
	// vì cửa ghi từ chối nó (`AC-PIO-ID-01`, `ISS-PIO-01`).
	binding, _ := json.Marshal(map[string]any{"op": "upsertBinding", "binding": map[string]any{
		"bindingId": bindID, "variableId": varID, "point": point,
		"direction": "WRITE", "dataType": "BOOL", "writable": true, "qualityPolicy": "REQUIRE_GOOD"}})
	task, _ := json.Marshal(map[string]any{"op": "setTask", "task": map[string]any{
		"taskId": taskID, "periodMs": 1000, "programOrder": []string{programID}}})

	saved, err := projects.SaveDraft(context.Background(), actor, SaveDraftCommand{
		ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
		Operations:     []json.RawMessage{program, variable, binding, task},
		IfMatch:        created.ETag,
		IdempotencyKey: "30000000-0000-4000-8000-000000000402", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	sealed, err := projects.SealRevision(context.Background(), actor, SealRevisionCommand{
		ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID, Label: "Modbus E2E",
		IfMatch: saved.ETag, IdempotencyKey: "30000000-0000-4000-8000-000000000403", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatalf("SealRevision: %v", err)
	}

	artifactBytes := []byte("modbus-e2e-artifact")
	digest := sha256.Sum256(artifactBytes)
	runner := &fakeCheckRunner{result: programmingcompiler.Result{OK: true,
		Artifact: artifactBytes, ArtifactSHA256: digest, Manifest: json.RawMessage(`{"manifestVersion":1}`),
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1,
		ProfileID: "revA-1t-1-5-30", LibraryVersion: domain.SystemLibraryVersion,
		IntegrityMode: "HASH_ONLY", TargetABI: 3841}}
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	checks, err := NewCheckService(CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		ModbusSlots: slots,
		Now:         func() time.Time { return time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := checks.RequestCheck(context.Background(), actor, RequestCheckCommand{
		RevisionID: sealed.Resource["revisionId"].(string), SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000404", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatalf("RequestCheck: %v", err)
	}
	if _, err := checks.ProcessNext(context.Background()); err != nil {
		t.Fatalf("ProcessNext: %v", err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil {
		t.Fatalf("GetCheck: %v", err)
	}
	return view.State, runner.input.IoMap
}

func modbusPointIdentity() map[string]any {
	return map[string]any{"category": "MB_RTU", "deviceId": e2eDeviceID, "pointId": e2ePointID}
}

// Đường đi hết: điểm Modbus có trong cấu hình đang chạy ⇒ Check PASS, và
// `io_map` giao cho compiler mang `extIndex` phân giải lại **từ authority**,
// không phải từ con số ai đó lưu trong binding.
func TestModbusBindingPassesCheckAndReachesIoMap(t *testing.T) {
	state, ioMap := checkModbusBinding(t, e2eSlots{snapshot: modbusE2ESnapshot()}, modbusPointIdentity())
	if state != "PASSED" {
		t.Fatalf("Check state = %q; điểm Modbus phải map được (F-PIO-019)", state)
	}
	if len(ioMap) != 1 {
		t.Fatalf("io_map có %d mục (chờ 1): %+v", len(ioMap), ioMap)
	}
	entry := ioMap[0]
	if entry.Category != "MB_RTU" || entry.PointID != e2ePointID || entry.Variable != "PumpCmd" {
		t.Fatalf("io_map không mang đúng điểm Modbus: %+v", entry)
	}
	if entry.Direction != "output" || !entry.Writable {
		t.Fatalf("chiều/quyền ghi sai: %+v", entry)
	}
	// `extIndex` là handle runtime, phân giải lại mỗi lần — nhưng nó PHẢI có
	// mặt trong io_map, vì đó là thứ Core dùng để trỏ vào `plc_shm.ext[]`.
	if entry.ExtIndex != 3 {
		t.Fatalf("extIndex trong io_map = %d (chờ 3 — 1-based, từ authority): %+v", entry.ExtIndex, entry)
	}
}

// Không có authority ⇒ CHẶN. Thiếu nguồn xác minh thì con số lưu trong binding
// không có gì bảo chứng — và chạy tiếp là đúng lỗ hổng `ISS-PIO-31` mô tả.
func TestModbusBindingBlockedWithoutSlotAuthority(t *testing.T) {
	state, _ := checkModbusBinding(t, nil, modbusPointIdentity())
	if state == "PASSED" {
		t.Fatal("Check PASS dù không có authority phân giải slot — binding Modbus không được bảo chứng bằng gì cả")
	}
}

// Điểm không còn trong cấu hình đang chạy ⇒ CHẶN, chứ không im lặng dùng slot cũ.
func TestModbusBindingBlockedWhenPointVanishedFromRunningConfig(t *testing.T) {
	empty := ModbusSlotSnapshot{ConfigRevision: "8"}
	state, _ := checkModbusBinding(t, e2eSlots{snapshot: empty}, modbusPointIdentity())
	if state == "PASSED" {
		t.Fatal("Check PASS dù điểm đã biến mất khỏi cấu hình đang chạy")
	}
}
