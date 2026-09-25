package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	webModbus "mkddc-web/internal/modbusrtu"
)

// Bộ test cho các finding BE của audit Modbus 2026-09-25
// (`docs/07_records/reviews/MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md`).
// Mỗi test đi qua ĐÚNG endpoint mà người vận hành gọi trên bo Forlinx.

// `MBA-BE-01`: `/modbus/diagnostics` phải chở đủ bộ đếm của iobus.
//
// Trên bo, SHM ghi write_failed=41 / write_dropped=12 cho CK508-04 trong khi API
// trả 0/0: handler tự dựng struct và bỏ sót ba trường. Test đặt số khác 0 cho
// đúng ba trường đó — một handler bỏ sót sẽ trả 0 và lộ ngay.
func TestModbusDiagnosticsChoDuBoDemGhiVaException(t *testing.T) {
	app, token := twoBusFixture(t)
	core := app.core.(*telemetryCore)
	core.telemetry.Slaves[0].WriteFailed = 41
	core.telemetry.Slaves[0].WriteDropped = 12
	core.telemetry.Slaves[0].LastException = 2

	var rows []webModbus.Diagnostics
	getJSON(t, app, token, "/api/v1/modbus/diagnostics", &rows)
	var got *webModbus.Diagnostics
	for i := range rows {
		if rows[i].DeviceID == "MTR-TANG-1" {
			got = &rows[i]
		}
	}
	if got == nil {
		t.Fatalf("không thấy hàng chẩn đoán MTR-TANG-1: %+v", rows)
	}
	if got.WriteFailed != 41 || got.WriteDropped != 12 || got.LastException != 2 {
		t.Fatalf("write_failed/write_dropped/last_exception = %d/%d/%d (chờ 41/12/2) — API đang nuốt bộ đếm ghi",
			got.WriteFailed, got.WriteDropped, got.LastException)
	}
}

// `MBA-BE-02`: đường ghi CHUNG `PUT /api/v1/points/{id}` với `point_id` Modbus
// phải tới Core dưới tên `EXT<slot>` — không phải `point_id` thô mà Core từ chối
// (log bo 2026-09-25 09:45:32: `PUT /api/v1/points/CK50804-DO1` → 409).
func TestGhiDiemModbusQuaDuongChungDoiSangEXT(t *testing.T) {
	core := &extWriteCore{slots: []ExtSlotRef{
		{ExtIndex: 1, PointID: "KHAC-01", Writable: true},
		{ExtIndex: 4, PointID: "CK508-DO1", Writable: true, Online: true},
	}}
	app, token := newExtWriteApp(t, core)

	rec := modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/points/CK508-DO1", `{"value":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /points/CK508-DO1 = %d (chờ 200); body = %s", rec.Code, rec.Body.String())
	}
	if core.gotPointID != "EXT4" {
		t.Fatalf("tên điểm gửi xuống core = %q (chờ \"EXT4\" theo slot runtime)", core.gotPointID)
	}
	var point PointDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &point); err != nil {
		t.Fatalf("giải mã phản hồi: %v", err)
	}
	if point.ID != "CK508-DO1" || point.Kind != "modbus_rtu" {
		t.Fatalf("phản hồi mang id=%q kind=%q (chờ CK508-DO1/modbus_rtu — đúng danh tính trong danh sách điểm)",
			point.ID, point.Kind)
	}
}

// Point Modbus chỉ-đọc: từ chối ở Web, KHÔNG gửi gì xuống Core.
func TestGhiDiemModbusChiDocQuaDuongChungBiTuChoi(t *testing.T) {
	core := &extWriteCore{slots: []ExtSlotRef{{ExtIndex: 1, PointID: "CK508-DI1", Writable: false}}}
	app, token := newExtWriteApp(t, core)
	readOnly := `{
		"devices": [
			{"device_id": "CK508-04", "enabled": true, "rs485_port": "/dev/rs485-1", "baud": 9600, "parity": "N", "stop_bits": 1, "slave_id": 4, "poll_ms": 1000, "timeout_ms": 300}
		],
		"points": [
			{"point_id": "CK508-DI1", "device_id": "CK508-04", "tag_name": "di1", "display_name": "DI 1", "register_type": "discrete_input", "address": 64, "data_type": "bool", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read", "enabled": true}
		]
	}`
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "fieldbus.conf"), []byte(readOnly), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/points/CK508-DI1", `{"value":1}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("ghi Point chỉ-đọc = %d (chờ 409); body = %s", rec.Code, rec.Body.String())
	}
	if core.calls != 0 {
		t.Fatalf("đã gửi %d lệnh xuống core cho Point chỉ-đọc — phải là 0", core.calls)
	}
}

// Validator phải chặn `point_id` Modbus trùng dạng tên điểm hệ thống: `DO3` đi
// qua đường ghi chung sẽ được Core hiểu thành ngõ ra cục bộ DO3.
func TestPointIDModbusTrungDangTenHeThongBiChan(t *testing.T) {
	for _, id := range []string{"DO3", "do3", "AO1", "EXT5", "MB2", "UI4", "BV1", "MSV2"} {
		if !webModbus.ReservedCorePointName(id) {
			t.Errorf("%q phải bị coi là tên điểm hệ thống", id)
		}
	}
	for _, id := range []string{"CK50804-DO1", "DO", "DOOR1X", "MB_SP", "EXT", "AHU1", "VFD2"} {
		if webModbus.ReservedCorePointName(id) {
			t.Errorf("%q KHÔNG phải tên điểm hệ thống nhưng bị chặn", id)
		}
	}

	cfg := webModbus.Config{
		Devices: []webModbus.Device{{DeviceID: "CK508-04", Enabled: true, RS485Port: "/dev/rs485-1",
			Baud: 9600, Parity: "N", StopBit: 1, SlaveID: 4, PollMS: 1000, TimeoutMS: 300, Retry: 2, OfflineAfterErrors: 2}},
		Points: []webModbus.Point{{PointID: "DO3", DeviceID: "CK508-04", TagName: "relay_3", DisplayName: "Relay 3",
			RegisterType: "coil", Address: 2, DataType: "bool", ByteOrder: "big", WordOrder: "high_low", Scale: 1,
			ReadWrite: "read_write", Enabled: true}},
	}
	errs := webModbus.ValidateWith(cfg, webModbus.DefaultValidateOptions())
	found := false
	for _, e := range errs {
		if e.Path == "points[0].point_id" {
			found = true
		}
	}
	if !found {
		t.Fatalf("validator KHÔNG chặn point_id Modbus \"DO3\": %+v", errs)
	}
}
