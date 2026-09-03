package application

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	programmingstore "mkddc-web/internal/programming/store"
)

/* `ISS-PIO-31` — năm thao tác cấu hình KHÔNG được đổi nghĩa một binding.
 *
 * "Không đổi nghĩa" ở đây KHÔNG có nghĩa là "vẫn chạy": nếu điểm còn đó và slot
 * đổi, binding phải theo DANH TÍNH (điểm cũ, slot mới); nếu điểm biến mất, Check
 * phải CHẶN. Cả hai đều là "không đổi nghĩa"; im lặng dùng slot cũ mới là đổi
 * nghĩa, vì slot đó nay là thanh ghi của một điểm khác. */

// modbusRevision dựng một Revision tối thiểu: một Program ST, một biến, một
// binding MB_RTU mang `extIndex` đã lưu.
func modbusRevision(deviceID, pointID string, storedExt int) programmingstore.RevisionSnapshot {
	program, _ := json.Marshal(map[string]any{
		"programId": "prog-0001",
		"language":  "ST",
		"document":  "PROGRAM p\nEND_PROGRAM\n",
		"programConfig": map[string]any{
			"programId": "prog-0001",
		},
		"locals": []map[string]any{
			{"variableId": "var-1", "programId": "prog-0001", "name": "PumpCmd", "type": "BOOL", "class": "OUTPUT"},
		},
	})
	binding, _ := json.Marshal(map[string]any{
		"bindingId":  "bind-1",
		"variableId": "var-1",
		"point": map[string]any{
			"category": "MB_RTU",
			"pointId":  pointID,
			"deviceId": deviceID,
			"extIndex": storedExt,
		},
		"dataType": "BOOL",
		"writable": true,
	})
	return programmingstore.RevisionSnapshot{Objects: []programmingstore.RevisionObject{
		{ObjectID: "prog-0001", Kind: "PROGRAM", PayloadJSON: program},
		{ObjectID: "bind-1", Kind: "BINDING", PayloadJSON: binding},
	}}
}

func snapshotOf(slots ...ModbusSlot) *ModbusSlotSnapshot {
	return &ModbusSlotSnapshot{ConfigRevision: "cfg-1", Slots: slots}
}

func TestCheckResolvesModbusSlotFromDurableIdentity(t *testing.T) {
	// Điểm vẫn còn nhưng đã dịch từ 14 xuống 6 (ví dụ: tắt một thiết bị đứng
	// trước). Binding chưa từng được đóng dấu slot ⇒ phân giải lần đầu.
	revision := modbusRevision("bus-1-slave-2", "PUMP_CMD", 0)
	slots := snapshotOf(ModbusSlot{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 6})

	entries, diagnostics := ioMapFromRevision(revision, "prog-0001", slots)
	if len(diagnostics) > 0 {
		t.Fatalf("không được chặn khi phân giải được: %+v", diagnostics)
	}
	if len(entries) != 1 || entries[0].ExtIndex != 6 {
		t.Fatalf("phải dùng slot phân giải lại (6), nhận %+v", entries)
	}
}

func TestCheckBlocksWhenStoredSlotDisagreesWithCurrentLayout(t *testing.T) {
	// Đây là kịch bản của issue: binding mang 14, điểm nay ở 6, và slot 14 đã
	// thuộc về một điểm khác. Tự remap sang 6 là đổi ý nghĩa một binding đã
	// duyệt; giữ 14 là ghi vào thanh ghi của điểm khác. Cả hai đều sai ⇒ CHẶN.
	revision := modbusRevision("bus-1-slave-2", "PUMP_CMD", 14)
	slots := snapshotOf(
		ModbusSlot{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 6},
		ModbusSlot{DeviceID: "bus-1-slave-9", PointID: "PRESSURE", ExtIndex: 14},
	)

	entries, diagnostics := ioMapFromRevision(revision, "prog-0001", slots)
	if len(diagnostics) != 1 {
		t.Fatalf("phải chặn khi slot đã lưu lệch với bố cục hiện tại, nhận %+v / %+v", entries, diagnostics)
	}
	if diagnostics[0].Code != "PRG-ERR-MAP-003" {
		t.Fatalf("mã public phải là PRG-ERR-MAP-003, nhận %s", diagnostics[0].Code)
	}
	if diagnostics[0].Args["expected"] != 14 || diagnostics[0].Args["actual"] != 0 {
		t.Fatalf("diagnostic phải nêu cả số đã lưu lẫn kết quả phân giải, nhận %+v", diagnostics[0].Args)
	}
}

func TestCheckBlocksWhenPointLeftTheRunningConfig(t *testing.T) {
	// Tắt điểm hoặc tắt thiết bị ⇒ điểm biến mất khỏi bố cục. Slot cũ thường
	// VẪN hợp lệ về dải và nay thuộc về điểm khác — ca nguy hiểm nhất.
	revision := modbusRevision("bus-1-slave-2", "PUMP_CMD", 14)
	slots := snapshotOf(ModbusSlot{DeviceID: "bus-1-slave-9", PointID: "PRESSURE", ExtIndex: 14})

	_, diagnostics := ioMapFromRevision(revision, "prog-0001", slots)
	if len(diagnostics) != 1 {
		t.Fatalf("phải chặn khi điểm không còn trong cấu hình đang chạy, nhận %+v", diagnostics)
	}
	if diagnostics[0].DetailCode != "PIO-SLOT-002" {
		t.Fatalf("detail code phải phân biệt ca 'điểm biến mất', nhận %s", diagnostics[0].DetailCode)
	}
}

func TestCheckBlocksModbusBindingWithoutSlotResolver(t *testing.T) {
	// Không có nguồn phân giải ⇒ không xác minh được ⇒ chặn. Thiếu bằng chứng
	// không phải bằng chứng khớp.
	revision := modbusRevision("bus-1-slave-2", "PUMP_CMD", 14)

	_, diagnostics := ioMapFromRevision(revision, "prog-0001", nil)
	if len(diagnostics) == 0 {
		t.Fatal("thiếu resolver thì binding MB_RTU phải bị chặn, không được tin con số đã lưu")
	}
}

func TestNonModbusBindingDoesNotNeedSlotResolver(t *testing.T) {
	// Điểm LOCAL/VP không có slot `ext`; bắt chúng phụ thuộc resolver là dựng
	// một phụ thuộc giả.
	program, _ := json.Marshal(map[string]any{
		"programId": "prog-0001", "language": "ST", "document": "PROGRAM p\nEND_PROGRAM\n",
		"programConfig": map[string]any{"programId": "prog-0001"},
		"locals": []map[string]any{
			{"variableId": "var-1", "programId": "prog-0001", "name": "SupplyTemp", "type": "REAL", "class": "INPUT"},
		},
	})
	binding, _ := json.Marshal(map[string]any{
		"bindingId": "bind-1", "variableId": "var-1",
		"point":    map[string]any{"category": "LOCAL", "pointId": "UI-01"},
		"dataType": "REAL", "writable": false,
	})
	revision := programmingstore.RevisionSnapshot{Objects: []programmingstore.RevisionObject{
		{ObjectID: "prog-0001", Kind: "PROGRAM", PayloadJSON: program},
		{ObjectID: "bind-1", Kind: "BINDING", PayloadJSON: binding},
	}}

	entries, diagnostics := ioMapFromRevision(revision, "prog-0001", nil)
	if len(diagnostics) > 0 {
		t.Fatalf("điểm LOCAL không được phụ thuộc resolver Modbus: %+v", diagnostics)
	}
	if len(entries) != 1 || entries[0].ExtIndex != 0 {
		t.Fatalf("điểm LOCAL phải giữ extIndex = 0, nhận %+v", entries)
	}
}

/* Năm thao tác của điều kiện đóng, chạy trên CÙNG một binding đã lưu slot 3.
 *
 * Bảng này là điều kiện đóng viết thành mã: mỗi hàng là một thao tác cấu hình
 * bình thường, và cột cuối là điều BUỘC phải xảy ra. */
func TestFiveConfigOperationsNeverSilentlyRepointBinding(t *testing.T) {
	const device, point = "bus-1-slave-2", "PUMP_CMD"
	cases := []struct {
		name       string
		slots      *ModbusSlotSnapshot
		wantBlock  bool
		wantExt    int
		wantReason string
	}{
		{
			name:      "reboot — cấu hình không đổi, slot giữ nguyên",
			slots:     snapshotOf(ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 3}),
			wantBlock: false, wantExt: 3,
		},
		{
			name: "đổi tên một điểm đứng trước — điểm này dịch chỗ",
			slots: snapshotOf(
				ModbusSlot{DeviceID: device, PointID: "AAA_FLOW", ExtIndex: 1},
				ModbusSlot{DeviceID: device, PointID: "BBB_TEMP", ExtIndex: 2},
				ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 4},
			),
			wantBlock: true, wantReason: "nay ở slot 4",
		},
		{
			name: "thêm một điểm đứng trước — điểm này dịch chỗ",
			slots: snapshotOf(
				ModbusSlot{DeviceID: device, PointID: "AAA_NEW", ExtIndex: 1},
				ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 4},
			),
			wantBlock: true, wantReason: "nay ở slot 4",
		},
		{
			name:      "tắt chính điểm này — biến mất khỏi bố cục",
			slots:     snapshotOf(ModbusSlot{DeviceID: device, PointID: "OTHER", ExtIndex: 3}),
			wantBlock: true, wantReason: "không còn trong cấu hình đang chạy",
		},
		{
			name:      "tắt thiết bị — mọi điểm của nó biến mất",
			slots:     snapshotOf(ModbusSlot{DeviceID: "bus-1-slave-9", PointID: "PRESSURE", ExtIndex: 3}),
			wantBlock: true, wantReason: "không còn trong cấu hình đang chạy",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			revision := modbusRevision(device, point, 3)
			entries, diagnostics := ioMapFromRevision(revision, "prog-0001", testCase.slots)
			if testCase.wantBlock {
				if len(diagnostics) == 0 {
					t.Fatalf("phải chặn, nhưng đi tiếp với %+v", entries)
				}
				return
			}
			if len(diagnostics) > 0 {
				t.Fatalf("không được chặn: %+v", diagnostics)
			}
			if len(entries) != 1 || entries[0].ExtIndex != testCase.wantExt {
				t.Fatalf("slot phải là %d, nhận %+v", testCase.wantExt, entries)
			}
		})
	}
}

// Lý do phải NÓI RA slot đó bây giờ là của ai. "extIndex không khớp" không giúp
// người vận hành đánh giá được mức nguy hiểm; "slot 14 nay thuộc về
// bus-1-slave-9#PRESSURE" thì có.
func TestSlotMismatchReasonNamesTheNewOccupant(t *testing.T) {
	slots := ModbusSlotSnapshot{Slots: []ModbusSlot{
		{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 6},
		{DeviceID: "bus-1-slave-9", PointID: "PRESSURE", ExtIndex: 14},
	}}
	_, reason := resolveModbusExtIndex(&slots, "bus-1-slave-2", "PUMP_CMD", 14)
	if !strings.Contains(reason, "bus-1-slave-9#PRESSURE") {
		t.Fatalf("lý do phải nêu chủ mới của slot, nhận %q", reason)
	}
	if !strings.Contains(reason, "KHÔNG tự chuyển slot") {
		t.Fatalf("lý do phải nói rõ hệ thống không tự remap, nhận %q", reason)
	}
}

/* `AC-PIO-ID-02` nửa thứ hai — đối chiếu LẠI trước activation.
 *
 * Check xanh không chứng minh được gì về cấu hình lúc bấm Commission. Bộ test
 * này khoá đúng khoảng trống đó. */

func checkWithManifestBindings(bindings ...map[string]any) programmingstore.Check {
	document := map[string]any{
		"schemaVersion": "1.0",
		"diagnostics":   []any{},
		"manifest":      map[string]any{"bindings": bindings},
	}
	raw, _ := json.Marshal(document)
	return programmingstore.Check{ResultJSON: raw}
}

func modbusManifestBinding(deviceID, pointID string, extIndex int) map[string]any {
	return map[string]any{"category": "MB_RTU", "deviceId": deviceID, "pointId": pointID, "extIndex": extIndex}
}

type stubSlotProvider struct {
	snapshot ModbusSlotSnapshot
	err      error
}

func (s stubSlotProvider) ResolveModbusSlots(context.Context) (ModbusSlotSnapshot, error) {
	return s.snapshot, s.err
}

func TestCommissionVerifyPassesWhenLayoutUnchanged(t *testing.T) {
	service := &OperationService{modbusSlots: stubSlotProvider{snapshot: ModbusSlotSnapshot{
		Slots: []ModbusSlot{{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 3}},
	}}}
	check := checkWithManifestBindings(modbusManifestBinding("bus-1-slave-2", "PUMP_CMD", 3))

	if err := service.verifyModbusSlots(context.Background(), check); err != nil {
		t.Fatalf("bố cục không đổi thì không được chặn: %v", err)
	}
}

func TestCommissionBlocksWhenLayoutShiftedAfterCheck(t *testing.T) {
	// Đúng kịch bản của issue, nhưng xảy ra SAU khi Check đã xanh: kỹ sư tắt
	// một thiết bị đứng trước, điểm dịch từ 3 xuống 1.
	service := &OperationService{modbusSlots: stubSlotProvider{snapshot: ModbusSlotSnapshot{
		Slots: []ModbusSlot{{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 1}},
	}}}
	check := checkWithManifestBindings(modbusManifestBinding("bus-1-slave-2", "PUMP_CMD", 3))

	if err := service.verifyModbusSlots(context.Background(), check); err == nil {
		t.Fatal("slot đã dịch sau Check thì Commission phải bị chặn")
	}
}

func TestCommissionBlocksWhenPointDisappearedAfterCheck(t *testing.T) {
	service := &OperationService{modbusSlots: stubSlotProvider{snapshot: ModbusSlotSnapshot{
		Slots: []ModbusSlot{{DeviceID: "bus-1-slave-9", PointID: "PRESSURE", ExtIndex: 3}},
	}}}
	check := checkWithManifestBindings(modbusManifestBinding("bus-1-slave-2", "PUMP_CMD", 3))

	if err := service.verifyModbusSlots(context.Background(), check); err == nil {
		t.Fatal("điểm biến mất sau Check thì Commission phải bị chặn")
	}
}

func TestCommissionBlocksModbusPackageWithoutResolver(t *testing.T) {
	service := &OperationService{}
	check := checkWithManifestBindings(modbusManifestBinding("bus-1-slave-2", "PUMP_CMD", 3))

	if err := service.verifyModbusSlots(context.Background(), check); err == nil {
		t.Fatal("không có nguồn đối chiếu thì package có binding MB_RTU phải bị chặn")
	}
}

func TestCommissionIgnoresPackagesWithoutModbusBindings(t *testing.T) {
	// Package chỉ có điểm LOCAL/VP không cần resolver — bắt nó phụ thuộc là
	// dựng một phụ thuộc giả và chặn nhầm.
	service := &OperationService{}
	check := checkWithManifestBindings(map[string]any{
		"category": "LOCAL", "pointId": "UI-01", "extIndex": 0,
	})

	if err := service.verifyModbusSlots(context.Background(), check); err != nil {
		t.Fatalf("package không có binding Modbus không được chặn: %v", err)
	}
}

func TestCommissionBlocksWhenManifestIsUnreadable(t *testing.T) {
	// Manifest hỏng KHÔNG được coi là "không có binding Modbus": đó là một
	// package không tự mô tả được, và cho nó đi tiếp là bỏ đúng phép kiểm này.
	service := &OperationService{}
	check := programmingstore.Check{ResultJSON: []byte("{ this is not json")}

	if err := service.verifyModbusSlots(context.Background(), check); err == nil {
		t.Fatal("manifest không đọc được thì phải chặn, không được bỏ qua")
	}
}

/* `AC-PIO-ID-02` — nửa còn lại: xác minh TRỌN chuỗi, không chỉ số slot.
 *
 * Bốn thao tác dưới đây đều GIỮ NGUYÊN `extIndex`. Một phép kiểm chỉ nhìn số
 * slot sẽ nói "khớp" cho cả bốn, trong khi binding đã Commission thì đọc/ghi
 * một thứ khác hẳn. */
func TestCommissionBlocksWhenSlotKeepsNumberButChangesTarget(t *testing.T) {
	const device, point = "bus-1-slave-2", "PUMP_CMD"
	commissioned := ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 3,
		RegisterType: "holding_register", Address: 40001, DataType: "uint16", ReadWrite: "read_write"}

	cases := []struct {
		name    string
		current ModbusSlot
		block   bool
	}{
		{
			name:    "không đổi gì",
			current: commissioned,
		},
		{
			name: "đổi địa chỉ thanh ghi",
			current: ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 3,
				RegisterType: "holding_register", Address: 40007, DataType: "uint16", ReadWrite: "read_write"},
			block: true,
		},
		{
			name: "đổi kiểu thanh ghi holding → input",
			current: ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 3,
				RegisterType: "input_register", Address: 40001, DataType: "uint16", ReadWrite: "read_write"},
			block: true,
		},
		{
			name: "đổi datatype uint16 → int32",
			current: ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 3,
				RegisterType: "holding_register", Address: 40001, DataType: "int32", ReadWrite: "read_write"},
			block: true,
		},
		{
			name: "hạ quyền read_write → read",
			current: ModbusSlot{DeviceID: device, PointID: point, ExtIndex: 3,
				RegisterType: "holding_register", Address: 40001, DataType: "uint16", ReadWrite: "read"},
			block: true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			service := &OperationService{modbusSlots: stubSlotProvider{
				snapshot: ModbusSlotSnapshot{Slots: []ModbusSlot{testCase.current}}}}
			check := checkWithManifestBindings(map[string]any{
				"category": "MB_RTU", "deviceId": device, "pointId": point, "extIndex": 3,
				"registerType": commissioned.RegisterType, "address": commissioned.Address,
				"modbusDataType": commissioned.DataType, "readWrite": commissioned.ReadWrite,
			})

			err := service.verifyModbusSlots(context.Background(), check)
			if testCase.block && err == nil {
				t.Fatal("đổi thứ slot trỏ tới mà không đổi số slot thì vẫn phải chặn")
			}
			if !testCase.block && err != nil {
				t.Fatalf("không đổi gì thì không được chặn: %v", err)
			}
		})
	}
}

/* `AC-PIO-ID-03` — package sinh TRƯỚC bản vá này không mang bốn trường mới.
 *
 * Coi "thiếu dữ liệu" là "lệch" sẽ chặn mọi package cũ dù chúng có thể vẫn
 * đúng; coi là "khớp" thì mất phép kiểm. Chọn cách thứ nhất một cách CÓ CHỦ Ý ở
 * tầng gọi, còn `SameTarget` chỉ so những trường thực sự có mặt — quyết định
 * "package cũ xử lý thế nào" nằm ở một chỗ đọc được, không rải rác trong phép
 * so sánh. */
func TestLegacyManifestWithoutTargetFieldsStillMatchesOnSlot(t *testing.T) {
	service := &OperationService{modbusSlots: stubSlotProvider{snapshot: ModbusSlotSnapshot{
		Slots: []ModbusSlot{{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 3,
			RegisterType: "holding_register", Address: 40001, DataType: "uint16", ReadWrite: "read_write"}},
	}}}
	check := checkWithManifestBindings(modbusManifestBinding("bus-1-slave-2", "PUMP_CMD", 3))

	if err := service.verifyModbusSlots(context.Background(), check); err != nil {
		t.Fatalf("manifest cũ (chưa có bốn trường) vẫn phải so được theo slot: %v", err)
	}
}

/* `AC-PIO-ID-03` — đường migration đọc được: MỘT lần Check nói ra TOÀN BỘ
 * binding phải rebind.
 *
 * Sau một lần tắt thiết bị, mọi binding của thiết bị đó đều lệch. Dừng ở
 * binding hỏng đầu tiên bắt người vận hành sửa một dòng rồi chạy lại Check —
 * với 8 điểm là 8 vòng, và mỗi vòng chỉ hiện đúng một dòng. */
func TestCheckReportsEveryBrokenModbusBindingAtOnce(t *testing.T) {
	program, _ := json.Marshal(map[string]any{
		"programId": "prog-0001", "language": "ST", "document": "PROGRAM p\nEND_PROGRAM\n",
		"programConfig": map[string]any{"programId": "prog-0001"},
		"locals": []map[string]any{
			{"variableId": "var-1", "programId": "prog-0001", "name": "PumpCmd", "type": "BOOL", "class": "OUTPUT"},
			{"variableId": "var-2", "programId": "prog-0001", "name": "FanCmd", "type": "BOOL", "class": "OUTPUT"},
			{"variableId": "var-3", "programId": "prog-0001", "name": "ValveCmd", "type": "BOOL", "class": "OUTPUT"},
		},
	})
	objects := []programmingstore.RevisionObject{{ObjectID: "prog-0001", Kind: "PROGRAM", PayloadJSON: program}}
	for index, name := range []string{"PUMP_CMD", "FAN_CMD", "VALVE_CMD"} {
		binding, _ := json.Marshal(map[string]any{
			"bindingId":  "bind-" + name,
			"variableId": []string{"var-1", "var-2", "var-3"}[index],
			"point": map[string]any{
				"category": "MB_RTU", "pointId": name, "deviceId": "bus-1-slave-2", "extIndex": index + 1,
			},
			"dataType": "BOOL", "writable": true,
		})
		objects = append(objects, programmingstore.RevisionObject{
			ObjectID: "bind-" + name, Kind: "BINDING", PayloadJSON: binding})
	}

	// Thiết bị đã tắt ⇒ cả ba điểm biến mất khỏi bố cục.
	empty := &ModbusSlotSnapshot{Slots: []ModbusSlot{}}
	_, diagnostics := ioMapFromRevision(programmingstore.RevisionSnapshot{Objects: objects}, "prog-0001", empty)

	if len(diagnostics) != 3 {
		t.Fatalf("một lần Check phải nói ra cả ba binding hỏng, nhận %d: %+v", len(diagnostics), diagnostics)
	}
	seen := map[string]bool{}
	for _, diagnostic := range diagnostics {
		pointID, _ := diagnostic.Args["pointId"].(string)
		seen[pointID] = true
	}
	for _, name := range []string{"PUMP_CMD", "FAN_CMD", "VALVE_CMD"} {
		if !seen[name] {
			t.Fatalf("thiếu binding %s trong danh sách trả về: %+v", name, diagnostics)
		}
	}
}

/* `AC-PIO-ID-02` — thanh ghi 0 là ĐỊA CHỈ HỢP LỆ, không phải "thiếu dữ liệu".
 *
 * Triệu chứng: một binding đã Commission trên thanh ghi 0 vẫn qua được phép
 * đối chiếu target sau khi người vận hành dời điểm đó sang thanh ghi khác.
 *
 * Nguyên nhân gốc: `validate.go` cho `address ∈ 0..65535`, nên 0 là địa chỉ
 * dùng được thật. Nhưng producer khai `json:"address,omitempty"` — số 0 KHÔNG
 * được ghi vào manifest — còn `SameTarget` lại đọc `other.Address != 0` như
 * dấu hiệu "manifest cũ không mang trường này" và BỎ QUA phép so địa chỉ. Ba
 * trường kia là chuỗi nên `""` không phải giá trị hợp lệ; `Address` là trường
 * duy nhất mà zero value đụng miền giá trị thật.
 *
 * Hệ quả đúng bằng thứ `AC-PIO-ID-02` sinh ra để chặn: slot giữ nguyên số,
 * `SameTarget` nói "khớp", Commission cho qua, chương trình đọc/ghi một thanh
 * ghi khác thanh ghi đã được duyệt — im lặng.
 */
func TestCommissionBlocksWhenAddressZeroPointMovedToAnotherRegister(t *testing.T) {
	service := &OperationService{modbusSlots: stubSlotProvider{snapshot: ModbusSlotSnapshot{
		Slots: []ModbusSlot{{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 3,
			RegisterType: "holding_register", Address: 300, AddressKnown: true,
			DataType: "uint16", ReadWrite: "read_write"}},
	}}}

	binding := modbusManifestBinding("bus-1-slave-2", "PUMP_CMD", 3)
	binding["registerType"] = "holding_register"
	binding["address"] = 0 // đã duyệt trên thanh ghi 0, nay cấu hình chạy ở 300
	binding["modbusDataType"] = "uint16"
	binding["readWrite"] = "read_write"

	if err := service.verifyModbusSlots(context.Background(), checkWithManifestBindings(binding)); err == nil {
		t.Fatal("điểm đã duyệt ở thanh ghi 0 nay nằm ở thanh ghi 300 — phải CHẶN, không được coi là khớp")
	}
}

/* Nửa còn lại của cùng một bất biến: thanh ghi 0 KHÔNG đổi thì không được chặn.
 * Thiếu ca này, một bản vá "coi 0 là luôn lệch" sẽ qua được test trên trong khi
 * chặn nhầm mọi binding hợp lệ ở thanh ghi 0. */
func TestCommissionPassesWhenAddressZeroPointUnchanged(t *testing.T) {
	service := &OperationService{modbusSlots: stubSlotProvider{snapshot: ModbusSlotSnapshot{
		Slots: []ModbusSlot{{DeviceID: "bus-1-slave-2", PointID: "PUMP_CMD", ExtIndex: 3,
			RegisterType: "holding_register", Address: 0, AddressKnown: true,
			DataType: "uint16", ReadWrite: "read_write"}},
	}}}

	binding := modbusManifestBinding("bus-1-slave-2", "PUMP_CMD", 3)
	binding["registerType"] = "holding_register"
	binding["address"] = 0
	binding["modbusDataType"] = "uint16"
	binding["readWrite"] = "read_write"

	if err := service.verifyModbusSlots(context.Background(), checkWithManifestBindings(binding)); err != nil {
		t.Fatalf("thanh ghi 0 không đổi thì không được chặn: %v", err)
	}
}

/* `AC-PIO-ID-02` — manifest phải QUA NỔI chính validator của nó.
 *
 * Triệu chứng: mọi Check có binding MB_RTU phân giải được slot đều hỏng ở bước
 * dựng manifest với `bindings[N]. trường lạ: address,modbusDataType,readWrite,
 * registerType`, tức Commission không bao giờ tới được phép đối chiếu target.
 *
 * Nguyên nhân gốc: `packageManifestBinding` được bổ sung bốn trường target,
 * nhưng `validateManifestBindings` vẫn gọi `exactFields` với allowlist CŨ mười
 * trường. `exactFields` từ chối trường lạ, nên producer và validator của cùng
 * một hồ sơ bất đồng ngay trong một hàm gọi nhau.
 *
 * Test đi qua ĐÚNG đường thật (`buildPackageCheckManifest` → marshal →
 * `validatePackageCheckManifest`) chứ không gọi `exactFields` trực tiếp: đó là
 * chỗ bất đồng thật sự phát tác. */
func TestPackageManifestAcceptsModbusTargetFields(t *testing.T) {
	input := validManifestInput(t)
	address := 300
	input.Bindings = []packageManifestBinding{{
		BindingID:  "11111111-1111-4111-8111-111111111111",
		ProgramID:  manifestProgramID,
		VariableID: "33333333-3333-4333-8333-333333333333",
		Variable:   "PumpCmd", Direction: "OUTPUT", Category: "MB_RTU",
		PointID: "PUMP_CMD", DeviceID: "bus-1-slave-2", ExtIndex: 3,
		RegisterType: "holding_register", Address: &address,
		ModbusType: "uint16", ReadWrite: "read_write", Writable: true,
	}}

	raw, err := buildPackageCheckManifest(input)
	if err != nil {
		t.Fatalf("manifest mang bốn trường target MB_RTU phải dựng được, nhận lỗi: %v", err)
	}
	if !bytes.Contains(raw, []byte(`"registerType":"holding_register"`)) {
		t.Fatalf("manifest mất trường registerType: %s", raw)
	}
}
