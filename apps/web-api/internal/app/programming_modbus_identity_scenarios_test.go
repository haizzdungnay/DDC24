package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	programmingapplication "mkddc-web/internal/programming/application"
)

/* `ISS-PIO-36` nhóm `5a…5g` — BẰNG CHỨNG ĐÓNG của `ISS-PIO-31` (#375).
 *
 * VÌ SAO BỘ TEST NÀY ĐỨNG Ở `internal/app` CHỨ KHÔNG Ở `application`
 * ---------------------------------------------------------------
 * Các test đơn vị ở `application` dựng `ModbusSlotSnapshot` bằng tay. Chúng
 * chứng minh LUẬT đúng, nhưng không chứng minh rằng thứ ĐỌC TỪ CẤU HÌNH THẬT
 * cho ra đúng bố cục ấy. Cả issue này sinh ra vì một khoảng cách kiểu đó: luật
 * thì đúng, còn dữ liệu đi vào luật thì đến từ chỗ khác.
 *
 * Ở đây mỗi kịch bản ghi một `fieldbus.conf` THẬT, đi qua ĐÚNG adapter mà
 * production dùng (`programmingModbusSlots`), rồi hỏi ĐÚNG authority mà Check
 * và Commission hỏi (`ModbusSlotSnapshot.VerifyBinding`). Không mock, không
 * dựng snapshot bằng tay.
 *
 * QUY ƯỚC "KHÔNG ĐỔI NGHĨA"
 * -------------------------
 * "Không đổi nghĩa" KHÔNG phải "vẫn chạy". Với một binding đã đóng dấu slot:
 *   - điểm còn đó và slot không đổi  ⇒ qua;
 *   - điểm còn đó nhưng slot đã dịch ⇒ CHẶN (không tự chuyển slot);
 *   - điểm biến mất                  ⇒ CHẶN.
 * Cả ba đều là "không đổi nghĩa". Im lặng dùng slot cũ mới là đổi nghĩa, vì
 * slot đó nay là thanh ghi của điểm khác.
 */

type scenarioPoint struct {
	pointID      string
	enabled      bool
	registerType string
	address      int
	dataType     string
	readWrite    string
}

type scenarioDevice struct {
	deviceID string
	enabled  bool
}

// writeFieldbusConfig ghi cấu hình thật rồi trả snapshot đi qua adapter
// production. Thứ tự `devices`/`points` giữ NGUYÊN như người gọi truyền vào —
// kịch bản `5d` dựa vào đúng điều đó.
func resolveScenario(t *testing.T, devices []scenarioDevice, points []scenarioPoint) programmingapplication.ModbusSlotSnapshot {
	t.Helper()
	dir := t.TempDir()

	deviceRows := make([]map[string]any, 0, len(devices))
	for _, device := range devices {
		deviceRows = append(deviceRows, map[string]any{"device_id": device.deviceID, "enabled": device.enabled})
	}
	pointRows := make([]map[string]any, 0, len(points))
	for _, point := range points {
		registerType := point.registerType
		if registerType == "" {
			registerType = "holding_register"
		}
		dataType := point.dataType
		if dataType == "" {
			dataType = "uint16"
		}
		readWrite := point.readWrite
		if readWrite == "" {
			readWrite = "read_write"
		}
		pointRows = append(pointRows, map[string]any{
			"point_id": point.pointID, "device_id": devices[0].deviceID, "enabled": point.enabled,
			"register_type": registerType, "address": point.address,
			"data_type": dataType, "read_write": readWrite,
		})
	}

	data, err := json.Marshal(map[string]any{
		"rs485": map[string]any{}, "poll_default_ms": 1000, "slaves": []any{},
		"devices": deviceRows, "points": pointRows,
	})
	if err != nil {
		t.Fatalf("marshal cấu hình: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fieldbus.conf"), data, 0o600); err != nil {
		t.Fatalf("ghi fieldbus.conf: %v", err)
	}

	app := &App{cfg: Config{ConfigDir: dir}}
	snapshot, err := app.programmingModbusSlots().ResolveModbusSlots(context.Background())
	if err != nil {
		t.Fatalf("phân giải slot qua adapter production: %v", err)
	}
	return snapshot
}

func addressOf(value int) *int { return &value }

// bindingOn dựng mô tả binding ĐÃ ĐÓNG DẤU, đúng hình dạng manifest as-built.
func bindingOn(deviceID, pointID string, extIndex int, address *int) programmingapplication.ModbusSlot {
	slot := programmingapplication.ModbusSlot{
		DeviceID: deviceID, PointID: pointID, ExtIndex: extIndex,
		RegisterType: "holding_register", DataType: "uint16", ReadWrite: "read_write",
	}
	if address != nil {
		slot.Address = *address
		slot.AddressKnown = true
	}
	return slot
}

const scenarioDevice1 = "bus-1-slave-2"

// 5a — ĐỔI TÊN một điểm khác trên cùng thiết bị.
//
// `BuildProfile` sắp theo `PointID`, nên đổi tên một điểm thành tên đứng TRƯỚC
// sẽ đẩy điểm đang bind xuống một slot. Binding phải bị CHẶN, không được im
// lặng đi theo slot mới.
func TestScenario5aRenameNeighbourShiftsSlotAndBlocks(t *testing.T) {
	before := resolveScenario(t,
		[]scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "PUMP_CMD", enabled: true, address: 10},
			{pointID: "ZZZ_FLOW", enabled: true, address: 11}})
	pump, ok := before.Lookup(scenarioDevice1, "PUMP_CMD")
	if !ok || pump.ExtIndex != 1 {
		t.Fatalf("trước khi đổi tên, PUMP_CMD phải ở slot 1, nhận %+v", pump)
	}
	commissioned := bindingOn(scenarioDevice1, "PUMP_CMD", pump.ExtIndex, addressOf(10))

	// `ZZZ_FLOW` được đổi tên thành `AAA_FLOW` ⇒ đứng trước `PUMP_CMD`.
	after := resolveScenario(t,
		[]scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "PUMP_CMD", enabled: true, address: 10},
			{pointID: "AAA_FLOW", enabled: true, address: 11}})
	if moved, _ := after.Lookup(scenarioDevice1, "PUMP_CMD"); moved.ExtIndex != 2 {
		t.Fatalf("sau khi đổi tên hàng xóm, PUMP_CMD phải dịch sang slot 2, nhận %d", moved.ExtIndex)
	}
	if reason := after.VerifyBinding(commissioned); reason == "" {
		t.Fatal("slot đã dịch mà vẫn cho qua — đó là tự chuyển slot trong im lặng")
	}
}

// 5b — THÊM một điểm sắp TRƯỚC điểm đang bind.
func TestScenario5bAddPointBeforeBoundPointBlocks(t *testing.T) {
	before := resolveScenario(t,
		[]scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "PUMP_CMD", enabled: true, address: 10}})
	pump, _ := before.Lookup(scenarioDevice1, "PUMP_CMD")
	commissioned := bindingOn(scenarioDevice1, "PUMP_CMD", pump.ExtIndex, addressOf(10))

	after := resolveScenario(t,
		[]scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "PUMP_CMD", enabled: true, address: 10},
			{pointID: "AAA_NEW", enabled: true, address: 5}})
	if reason := after.VerifyBinding(commissioned); reason == "" {
		t.Fatal("thêm một điểm đứng trước làm dịch slot mà vẫn cho qua")
	}
}

// 5c — TẮT một điểm ở giữa dải: mọi điểm sau nó dịch lên.
func TestScenario5cDisableMidRangePointBlocks(t *testing.T) {
	before := resolveScenario(t,
		[]scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "AAA_FLOW", enabled: true, address: 5},
			{pointID: "BBB_TEMP", enabled: true, address: 6},
			{pointID: "PUMP_CMD", enabled: true, address: 10}})
	pump, _ := before.Lookup(scenarioDevice1, "PUMP_CMD")
	if pump.ExtIndex != 3 {
		t.Fatalf("PUMP_CMD phải ở slot 3, nhận %d", pump.ExtIndex)
	}
	commissioned := bindingOn(scenarioDevice1, "PUMP_CMD", pump.ExtIndex, addressOf(10))

	after := resolveScenario(t,
		[]scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "AAA_FLOW", enabled: true, address: 5},
			{pointID: "BBB_TEMP", enabled: false, address: 6},
			{pointID: "PUMP_CMD", enabled: true, address: 10}})
	if moved, _ := after.Lookup(scenarioDevice1, "PUMP_CMD"); moved.ExtIndex != 2 {
		t.Fatalf("tắt một điểm ở giữa phải kéo PUMP_CMD lên slot 2, nhận %d", moved.ExtIndex)
	}
	if reason := after.VerifyBinding(commissioned); reason == "" {
		t.Fatal("điểm giữa dải bị tắt làm dịch slot mà vẫn cho qua")
	}
}

// 5d — ĐẢO THỨ TỰ thiết bị trong cấu hình.
//
// Allocator duyệt thiết bị theo thứ tự cấu hình phát ra, nên đảo thứ tự đẩy mọi
// điểm của thiết bị đứng sau sang dải khác — không một điểm nào bị sửa.
func TestScenario5dReorderDevicesBlocks(t *testing.T) {
	devicesInOrder := []scenarioDevice{{scenarioDevice1, true}, {"bus-1-slave-9", true}}
	before := resolveScenario(t, devicesInOrder,
		[]scenarioPoint{{pointID: "PUMP_CMD", enabled: true, address: 10}})
	pump, _ := before.Lookup(scenarioDevice1, "PUMP_CMD")
	commissioned := bindingOn(scenarioDevice1, "PUMP_CMD", pump.ExtIndex, addressOf(10))

	// Thiết bị kia lên trước và mang theo một điểm ⇒ dải của thiết bị này dịch.
	reordered := []scenarioDevice{{"bus-1-slave-9", true}, {scenarioDevice1, true}}
	dir := t.TempDir()
	data, _ := json.Marshal(map[string]any{
		"rs485": map[string]any{}, "poll_default_ms": 1000, "slaves": []any{},
		"devices": []map[string]any{
			{"device_id": reordered[0].deviceID, "enabled": true},
			{"device_id": reordered[1].deviceID, "enabled": true},
		},
		"points": []map[string]any{
			{"point_id": "PRESSURE", "device_id": "bus-1-slave-9", "enabled": true,
				"register_type": "holding_register", "address": 1, "data_type": "uint16", "read_write": "read"},
			{"point_id": "PUMP_CMD", "device_id": scenarioDevice1, "enabled": true,
				"register_type": "holding_register", "address": 10, "data_type": "uint16", "read_write": "read_write"},
		},
	})
	if err := os.WriteFile(filepath.Join(dir, "fieldbus.conf"), data, 0o600); err != nil {
		t.Fatalf("ghi fieldbus.conf: %v", err)
	}
	app := &App{cfg: Config{ConfigDir: dir}}
	after, err := app.programmingModbusSlots().ResolveModbusSlots(context.Background())
	if err != nil {
		t.Fatalf("phân giải slot: %v", err)
	}

	if moved, _ := after.Lookup(scenarioDevice1, "PUMP_CMD"); moved.ExtIndex == pump.ExtIndex {
		t.Fatalf("đảo thứ tự thiết bị phải làm dịch slot, vẫn thấy %d", moved.ExtIndex)
	}
	if reason := after.VerifyBinding(commissioned); reason == "" {
		t.Fatal("đảo thứ tự thiết bị làm dịch slot mà vẫn cho qua")
	}
}

// 5e — ĐỔI register/datatype/access của chính điểm đang bind.
//
// Bốn ca này GIỮ NGUYÊN số slot. Phép kiểm chỉ nhìn slot sẽ nói "khớp" cho cả
// bốn, trong khi binding đọc/ghi một thứ khác hẳn.
func TestScenario5eTargetChangeKeepsSlotButBlocks(t *testing.T) {
	base := scenarioPoint{pointID: "PUMP_CMD", enabled: true, address: 10}
	before := resolveScenario(t, []scenarioDevice{{scenarioDevice1, true}}, []scenarioPoint{base})
	pump, _ := before.Lookup(scenarioDevice1, "PUMP_CMD")
	commissioned := bindingOn(scenarioDevice1, "PUMP_CMD", pump.ExtIndex, addressOf(10))

	cases := []struct {
		name    string
		mutated scenarioPoint
	}{
		{"đổi địa chỉ thanh ghi", scenarioPoint{pointID: "PUMP_CMD", enabled: true, address: 17}},
		{"đổi kiểu thanh ghi", scenarioPoint{pointID: "PUMP_CMD", enabled: true, address: 10,
			registerType: "input_register"}},
		{"đổi datatype", scenarioPoint{pointID: "PUMP_CMD", enabled: true, address: 10, dataType: "int32"}},
		{"hạ quyền ghi", scenarioPoint{pointID: "PUMP_CMD", enabled: true, address: 10, readWrite: "read"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			after := resolveScenario(t, []scenarioDevice{{scenarioDevice1, true}},
				[]scenarioPoint{testCase.mutated})
			moved, found := after.Lookup(scenarioDevice1, "PUMP_CMD")
			if !found || moved.ExtIndex != commissioned.ExtIndex {
				t.Fatalf("kịch bản này phải GIỮ NGUYÊN slot để có nghĩa, nhận %+v", moved)
			}
			if reason := after.VerifyBinding(commissioned); reason == "" {
				t.Fatal("slot giữ nguyên nhưng đích đã đổi mà vẫn cho qua")
			}
		})
	}
}

// 5f — BINDING LEGACY: manifest cũ không mang bốn trường đích.
//
// Chứng minh được identity (điểm còn đó, slot khớp) ⇒ đi tiếp; không chứng minh
// được ⇒ chặn và giữ LKG. Không tự remap ở cả hai nhánh.
func TestScenario5fLegacyBindingMigratesOnlyWhenIdentityHolds(t *testing.T) {
	snapshot := resolveScenario(t, []scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "PUMP_CMD", enabled: true, address: 10}})

	// Manifest legacy: có `deviceId/pointId/extIndex`, KHÔNG có trường đích.
	legacy := programmingapplication.ModbusSlot{
		DeviceID: scenarioDevice1, PointID: "PUMP_CMD", ExtIndex: 1,
	}
	if reason := snapshot.VerifyBinding(legacy); reason != "" {
		t.Fatalf("binding legacy còn chứng minh được identity thì phải đi tiếp: %s", reason)
	}

	// Cùng manifest legacy, nhưng điểm đã bị tắt ⇒ không chứng minh được.
	gone := resolveScenario(t, []scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "PUMP_CMD", enabled: false, address: 10}})
	if reason := gone.VerifyBinding(legacy); reason == "" {
		t.Fatal("điểm đã tắt mà binding legacy vẫn qua — LKG không còn được bảo vệ")
	}
}

// 5g — QUY ƯỚC 0-based ↔ 1-based, khoá ở ĐẦU BE.
//
// Allocator `iobus` đếm từ 0 (`ext_cursor_ = 0`), artifact/io_map kiểm `>= 1` và
// `st_process_image.cpp` trừ 1 khi đọc. Phát thẳng chỉ số thô sẽ lệch ĐÚNG MỘT
// THANH GHI — hợp lệ với mọi phép kiểm hiện có, và sai ở đúng chỗ không ai nhìn.
func TestScenario5gZeroBasedAllocatorMapsToOneBasedArtifact(t *testing.T) {
	snapshot := resolveScenario(t, []scenarioDevice{{scenarioDevice1, true}},
		[]scenarioPoint{{pointID: "AAA_FIRST", enabled: true, address: 0},
			{pointID: "BBB_SECOND", enabled: true, address: 1}})

	first, ok := snapshot.Lookup(scenarioDevice1, "AAA_FIRST")
	if !ok || first.ExtIndex != 1 {
		t.Fatalf("điểm đầu tiên (ext_idx = 0 ở allocator) phải là extIndex = 1, nhận %+v", first)
	}
	second, ok := snapshot.Lookup(scenarioDevice1, "BBB_SECOND")
	if !ok || second.ExtIndex != 2 {
		t.Fatalf("điểm thứ hai phải là extIndex = 2, nhận %+v", second)
	}
	// Không có slot 0: nó là chỉ số của allocator, không phải của artifact.
	if _, taken := snapshot.AtExtIndex(0); taken {
		t.Fatal("không được phát slot 0 — đó là chỉ số 0-based của allocator")
	}
	// `address = 0` là thanh ghi HỢP LỆ và phải đọc được, không bị nhầm thành
	// "thiếu dữ liệu" (bài học của #466).
	if !first.AddressKnown || first.Address != 0 {
		t.Fatalf("thanh ghi 0 phải đọc được như một giá trị thật, nhận %+v", first)
	}
}
