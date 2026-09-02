package application

import (
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

	entries, diagnostic := ioMapFromRevision(revision, "prog-0001", slots)
	if diagnostic != nil {
		t.Fatalf("không được chặn khi phân giải được: %+v", diagnostic)
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

	entries, diagnostic := ioMapFromRevision(revision, "prog-0001", slots)
	if diagnostic == nil {
		t.Fatalf("phải chặn khi slot đã lưu lệch với bố cục hiện tại, nhận %+v", entries)
	}
	if diagnostic.Code != "PRG-ERR-MAP-003" {
		t.Fatalf("mã public phải là PRG-ERR-MAP-003, nhận %s", diagnostic.Code)
	}
	if diagnostic.Args["expected"] != 14 || diagnostic.Args["actual"] != 0 {
		t.Fatalf("diagnostic phải nêu cả số đã lưu lẫn kết quả phân giải, nhận %+v", diagnostic.Args)
	}
}

func TestCheckBlocksWhenPointLeftTheRunningConfig(t *testing.T) {
	// Tắt điểm hoặc tắt thiết bị ⇒ điểm biến mất khỏi bố cục. Slot cũ thường
	// VẪN hợp lệ về dải và nay thuộc về điểm khác — ca nguy hiểm nhất.
	revision := modbusRevision("bus-1-slave-2", "PUMP_CMD", 14)
	slots := snapshotOf(ModbusSlot{DeviceID: "bus-1-slave-9", PointID: "PRESSURE", ExtIndex: 14})

	_, diagnostic := ioMapFromRevision(revision, "prog-0001", slots)
	if diagnostic == nil {
		t.Fatal("phải chặn khi điểm không còn trong cấu hình đang chạy")
	}
	if diagnostic.DetailCode != "PIO-SLOT-002" {
		t.Fatalf("detail code phải phân biệt ca 'điểm biến mất', nhận %s", diagnostic.DetailCode)
	}
}

func TestCheckBlocksModbusBindingWithoutSlotResolver(t *testing.T) {
	// Không có nguồn phân giải ⇒ không xác minh được ⇒ chặn. Thiếu bằng chứng
	// không phải bằng chứng khớp.
	revision := modbusRevision("bus-1-slave-2", "PUMP_CMD", 14)

	_, diagnostic := ioMapFromRevision(revision, "prog-0001", nil)
	if diagnostic == nil {
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

	entries, diagnostic := ioMapFromRevision(revision, "prog-0001", nil)
	if diagnostic != nil {
		t.Fatalf("điểm LOCAL không được phụ thuộc resolver Modbus: %+v", diagnostic)
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
			entries, diagnostic := ioMapFromRevision(revision, "prog-0001", testCase.slots)
			if testCase.wantBlock {
				if diagnostic == nil {
					t.Fatalf("phải chặn, nhưng đi tiếp với %+v", entries)
				}
				return
			}
			if diagnostic != nil {
				t.Fatalf("không được chặn: %+v", diagnostic)
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
