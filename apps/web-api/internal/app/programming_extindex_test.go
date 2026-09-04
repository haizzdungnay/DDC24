package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/* Cấu hình tối thiểu nhưng THẬT: hai thiết bị trên cùng một bus, mỗi thiết bị
 * hai điểm. Thứ tự thiết bị cố ý KHÔNG theo số slave (04 rồi 06) để bản đồ slot
 * phải bám thứ tự cấu hình chứ không phải thứ tự địa chỉ. */
const extIndexFieldbusJSON = `{
	"buses": [
		{"bus_id": "rs485-1", "display_name": "RS485-1", "port": "/dev/rs485-1", "baud": 9600, "parity": "N", "stop_bits": 1, "data_bits": 8, "enabled": true}
	],
	"devices": [
		{"device_id": "CK508-04", "display_name": "CK-508", "enabled": true, "bus_id": "rs485-1", "rs485_port": "/dev/rs485-1", "baud": 9600, "parity": "N", "stop_bits": 1, "slave_id": 4, "poll_ms": 1000, "timeout_ms": 300},
		{"device_id": "CK509-06", "display_name": "CK-509", "enabled": true, "bus_id": "rs485-1", "rs485_port": "/dev/rs485-1", "baud": 9600, "parity": "N", "stop_bits": 1, "slave_id": 6, "poll_ms": 1000, "timeout_ms": 300}
	],
	"points": [
		{"point_id": "CK50804-DO1", "device_id": "CK508-04", "tag_name": "a1", "display_name": "A1", "register_type": "coil", "address": 0, "data_type": "bool", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read_write", "enabled": true},
		{"point_id": "CK50804-DO2", "device_id": "CK508-04", "tag_name": "a2", "display_name": "A2", "register_type": "coil", "address": 1, "data_type": "bool", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read_write", "enabled": true},
		{"point_id": "CK50906-DO1", "device_id": "CK509-06", "tag_name": "b1", "display_name": "B1", "register_type": "coil", "address": 0, "data_type": "bool", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read_write", "enabled": true},
		{"point_id": "CK50906-DO2", "device_id": "CK509-06", "tag_name": "b2", "display_name": "B2", "register_type": "coil", "address": 1, "data_type": "bool", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read_write", "enabled": true}
	]
}`

// extIndexCore trả đúng bốn điểm Modbus theo thứ tự slot, giống `ReadPoints`
// dựng từ `plc_shm.ext[]`.
type extIndexCore struct{}

func (extIndexCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true, IobusPresent: true}, nil
}

func (extIndexCore) ReadPoints(context.Context) ([]PointDTO, error) {
	mk := func(id string, slave byte) PointDTO {
		return PointDTO{ID: id, Name: id, Kind: "modbus_rtu", Value: float64(0), Quality: "GOOD",
			Source: "modbus_rtu", Writable: true, Online: true, BusID: 1, SlaveAddr: slave}
	}
	return []PointDTO{
		mk("CK50804-DO1", 4), mk("CK50804-DO2", 4),
		mk("CK50906-DO1", 6), mk("CK50906-DO2", 6),
	}, nil
}

func newExtIndexApp(t *testing.T) *App {
	t.Helper()
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	app, err := NewApp(cfg, nil, extIndexCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "fieldbus.conf"),
		[]byte(extIndexFieldbusJSON), 0o644); err != nil {
		t.Fatalf("seed fieldbus.conf: %v", err)
	}
	return app
}

/* `ISS-PIO-31`: Catalog PHẢI phát `extIndex` cho điểm MB_RTU.
 *
 * Không có nó thì `EvaluatePointMapEligibility` trả `UNSUPPORTED_BY_CORE` cho
 * MỌI điểm Modbus, và người dùng không có đường nào dựng binding Modbus qua
 * chính sản phẩm — dù Core đã resolve `MB_RTU` và `BuildExtLayout` đã tính sẵn
 * con số. Đây là ca đóng của điều kiện ghi trong `point_eligibility.go`. */
func TestPointCatalogPhatExtIndexChoDiemModbus(t *testing.T) {
	app := newExtIndexApp(t)
	entries, err := app.programmingPointCatalog().ListPointCatalog(context.Background())
	if err != nil {
		t.Fatalf("ListPointCatalog: %v", err)
	}
	got := map[string]int{}
	for _, e := range entries {
		if e.Category == "MB_RTU" {
			got[e.PointID] = e.ExtIndex
		}
	}
	want := map[string]int{
		"CK50804-DO1": 1, "CK50804-DO2": 2,
		"CK50906-DO1": 3, "CK50906-DO2": 4,
	}
	for id, expected := range want {
		if got[id] != expected {
			t.Fatalf("extIndex của %s = %d (chờ %d); toàn bộ = %v — extIndex 0 làm điểm bị chặn "+
				"UNSUPPORTED_BY_CORE và không bind được (ISS-PIO-31)", id, got[id], expected, got)
		}
	}
}

/* Catalog quảng cáo `deviceId` dạng `bus-<n>-slave-<m>`, và đường Check tra
 * bằng CHÍNH `(deviceId, pointId)` đó. Nếu bản đồ slot phát `device_id` của
 * cấu hình (`CK508-04`) thì hai hệ danh tính lệch nhau: mọi binding dựng từ
 * Catalog sẽ bị Check báo "không còn trong cấu hình đang chạy" dù cấu hình
 * không đổi một chữ. `validModbusDeviceID` cũng chỉ chấp nhận dạng canonical. */
func TestModbusSlotPhatDanhTinhCanonicalKhopCatalog(t *testing.T) {
	app := newExtIndexApp(t)
	snapshot, err := app.programmingModbusSlots().ResolveModbusSlots(context.Background())
	if err != nil {
		t.Fatalf("ResolveModbusSlots: %v", err)
	}
	if len(snapshot.Slots) != 4 {
		t.Fatalf("số slot = %d (chờ 4)", len(snapshot.Slots))
	}
	for _, slot := range snapshot.Slots {
		if slot.DeviceID != "bus-1-slave-4" && slot.DeviceID != "bus-1-slave-6" {
			t.Fatalf("deviceId của slot = %q — phải là dạng canonical bus-<n>-slave-<m> "+
				"để khớp Point Catalog và validModbusDeviceID", slot.DeviceID)
		}
	}
	if _, ok := snapshot.Lookup("bus-1-slave-4", "CK50804-DO1"); !ok {
		t.Fatal("Lookup theo danh tính canonical không tìm thấy điểm — binding dựng từ Catalog sẽ bị Check chặn")
	}

	// Catalog và bản đồ slot phải nói CÙNG một danh tính, không chỉ cùng dạng.
	entries, err := app.programmingPointCatalog().ListPointCatalog(context.Background())
	if err != nil {
		t.Fatalf("ListPointCatalog: %v", err)
	}
	for _, e := range entries {
		if e.Category != "MB_RTU" {
			continue
		}
		if _, ok := snapshot.Lookup(e.DeviceID, e.PointID); !ok {
			raw, _ := json.Marshal(e)
			t.Fatalf("điểm Catalog %s không tra được trong bản đồ slot: %s", e.PointID, raw)
		}
	}
}

/* `ISS-PIO-34`: VP trên slot AV luôn là REAL, kể cả khi khai `integer`.
 *
 * `vpPoolFor` CỐ Ý đưa cả `integer` lẫn `float` vào pool AV (MSV để dành cho
 * `multistate`, #401), còn `st_io_map.cpp` chốt `AV ⇒ REAL`. Trả `DINT` là
 * catalog tự mâu thuẫn với allocator của chính mình, và điểm bị chặn ở cả hai
 * chiều. Đo trên bo Foxlinx: `AV-05` (`VP_AHU_STATE`, enum 0..8) không map được
 * vào biến ST nào dù đọc đúng, quality GOOD. */
func TestPointCatalogVPTrenSlotAVLuonLaREAL(t *testing.T) {
	cases := []struct {
		name       string
		signalType string
	}{
		{"VP integer (enum trạng thái)", virtualPointSignalInteger},
		{"VP float", virtualPointSignalFloat},
	}
	for _, tc := range cases {
		point := PointDTO{ID: "VP5", Kind: "virtual", BoundPointID: "AV-05",
			SignalType: tc.signalType, Value: float64(4)}
		if got := pointCatalogDataType(point); got != "REAL" {
			t.Fatalf("%s trên slot AV: dataType = %q, chờ REAL — Core chốt AV ⇒ REAL, "+
				"phát khác làm điểm bị chặn map ở cả hai chiều", tc.name, got)
		}
	}

	// Hai họ slot còn lại giữ nguyên hợp đồng của chúng.
	if got := pointCatalogDataType(PointDTO{ID: "VP1", Kind: "virtual", BoundPointID: "BV-01",
		SignalType: virtualPointSignalBoolean, Value: true}); got != "BOOL" {
		t.Fatalf("VP trên slot BV: dataType = %q, chờ BOOL", got)
	}
	if got := pointCatalogDataType(PointDTO{ID: "VP2", Kind: "virtual", BoundPointID: "MSV-01",
		SignalType: virtualPointSignalInteger, Value: float64(2)}); got != "UINT" {
		t.Fatalf("VP trên slot MSV: dataType = %q, chờ UINT", got)
	}
}
