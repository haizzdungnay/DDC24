package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestModbusWriteTestEndpoint_RBACAndValidation(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)

	// Seed fieldbus.conf with 1 read-only point and 1 read_write point
	fieldbusJSON := `{
		"devices": [
			{"device_id": "MTR1", "enabled": true, "rs485_port": "/dev/rs485-1", "baud": 19200, "parity": "N", "stop_bits": 1, "slave_id": 1, "poll_ms": 1000, "timeout_ms": 300}
		],
		"points": [
			{"point_id": "MB_VOLT", "device_id": "MTR1", "tag_name": "mb_volt", "display_name": "Voltage", "register_type": "holding_register", "address": 100, "data_type": "float32", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read", "enabled": true},
			{"point_id": "MB_SP", "device_id": "MTR1", "tag_name": "mb_sp", "display_name": "Setpoint", "register_type": "holding_register", "address": 102, "data_type": "float32", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read_write", "enabled": true}
		]
	}`
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "fieldbus.conf"), []byte(fieldbusJSON), 0o644); err != nil {
		t.Fatalf("failed to seed fieldbus.conf: %v", err)
	}

	t.Run("Operator is forbidden (403)", func(t *testing.T) {
		appOp, operatorToken := newTestAppWithRole(t, RoleOperator, fakeCore{})
		if err := os.WriteFile(filepath.Join(appOp.cfg.ConfigDir, "fieldbus.conf"), []byte(fieldbusJSON), 0o644); err != nil {
			t.Fatalf("failed to seed fieldbus.conf for operator: %v", err)
		}

		body, _ := json.Marshal(map[string]any{
			"point_id": "MB_SP",
			"value":    22.5,
		})
		rec := modbusServeAuth(t, appOp, operatorToken, http.MethodPost, "/api/v1/modbus/write-test", string(body))

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for Operator role, got %d", rec.Code)
		}
	})

	t.Run("Admin with non-existent point receives validation error", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"point_id": "NON_EXISTENT",
			"value":    50.0,
		})
		rec := modbusServeAuth(t, app, adminToken, http.MethodPost, "/api/v1/modbus/write-test", string(body))

		if rec.Code != http.StatusBadRequest && rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("expected validation error for non-existent point, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("Admin with read-only point receives validation error", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"point_id": "MB_VOLT",
			"value":    220.0,
		})
		rec := modbusServeAuth(t, app, adminToken, http.MethodPost, "/api/v1/modbus/write-test", string(body))

		if rec.Code != http.StatusBadRequest && rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("expected validation error for read-only point, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

// extWriteCore là core giả tối thiểu cho đường ghi thử: nó chỉ cần trả bố cục
// slot `ext` và GHI LẠI đúng tên điểm mà handler gửi xuống.
//
// Tên đó là cả bài kiểm: Core định danh điểm mở rộng bằng `EXT<n>` (slot
// 1-based), không bằng `point_id`. Một fake chấp nhận mọi tên sẽ xanh kể cả khi
// handler gửi `point_id` thô — đúng lớp lỗi mà bộ test cũ bỏ lọt.
type extWriteCore struct {
	slots []ExtSlotRef
	err   error

	gotPointID string
	gotValue   any
	gotUser    string
	gotRelease bool
	calls      int
}

func (c *extWriteCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true, IobusPresent: true}, nil
}

func (c *extWriteCore) ReadExtCatalog() ([]ExtSlotRef, error) {
	if c.err != nil {
		return nil, c.err
	}
	return c.slots, nil
}

func (c *extWriteCore) ForcePointTTL(_ context.Context, id string, value any, release bool,
	_ uint32, user string) (PointDTO, error) {
	c.calls++
	c.gotPointID, c.gotValue, c.gotRelease, c.gotUser = id, value, release, user
	return PointDTO{ID: id, Value: value, Quality: "good", Source: "core"}, nil
}

const extWriteFieldbusJSON = `{
	"devices": [
		{"device_id": "CK508-04", "enabled": true, "rs485_port": "/dev/rs485-1", "baud": 9600, "parity": "N", "stop_bits": 1, "slave_id": 4, "poll_ms": 1000, "timeout_ms": 300}
	],
	"points": [
		{"point_id": "CK508-DO1", "device_id": "CK508-04", "tag_name": "do1", "display_name": "Relay 1", "register_type": "coil", "address": 0, "data_type": "bool", "byte_order": "big", "word_order": "high_low", "scale": 1, "read_write": "read_write", "enabled": true}
	]
}`

func newExtWriteApp(t *testing.T, core CoreStatusClient) (*App, string) {
	t.Helper()
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	app, err := NewApp(cfg, nil, core, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "fieldbus.conf"),
		[]byte(extWriteFieldbusJSON), 0o644); err != nil {
		t.Fatalf("seed fieldbus.conf: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	return app, token
}

// ISS-MBW-01: Admin ghi thử một điểm read_write phải ĐẾN được Core, và phải
// đến dưới tên `EXT<slot>`.
//
// Bộ test cũ chỉ kiểm ba ca bị từ chối (403 / point không tồn tại / point
// read-only), nên endpoint trả 503 cho MỌI lệnh hợp lệ mà vẫn xanh suốt.
func TestModbusWriteTestGuiDungTenEXTXuongCore(t *testing.T) {
	core := &extWriteCore{slots: []ExtSlotRef{
		{ExtIndex: 1, PointID: "CK508-DO1", Writable: true, Online: true},
	}}
	app, token := newExtWriteApp(t, core)

	body, _ := json.Marshal(map[string]any{"point_id": "CK508-DO1", "value": 1})
	rec := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/write-test", string(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("ghi thử hợp lệ = %d (chờ 200); body = %s", rec.Code, rec.Body.String())
	}
	if core.calls != 1 {
		t.Fatalf("số lệnh gửi xuống core = %d (chờ 1)", core.calls)
	}
	if core.gotPointID != "EXT1" {
		t.Fatalf("tên điểm gửi xuống core = %q (chờ \"EXT1\" — Core không hiểu point_id thô)", core.gotPointID)
	}
	if core.gotRelease {
		t.Fatalf("ghi thử phải là lệnh write, không phải release")
	}
	if core.gotUser != "admin" {
		t.Fatalf("user trong lệnh = %q (chờ \"admin\" để audit truy được người bấm)", core.gotUser)
	}
	var resp ModbusWriteTestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("giải mã phản hồi: %v", err)
	}
	if resp.Status != "success" || resp.PointID != "CK508-DO1" {
		t.Fatalf("phản hồi = %+v (chờ status=success, point_id=CK508-DO1)", resp)
	}
}

// Slot phải lấy theo bố cục ĐANG chạy, không theo thứ tự trong file cấu hình.
func TestModbusWriteTestLaySlotTheoBoCucRuntime(t *testing.T) {
	core := &extWriteCore{slots: []ExtSlotRef{
		{ExtIndex: 1, PointID: "KHAC-01", Writable: true},
		{ExtIndex: 2, PointID: "KHAC-02", Writable: true},
		{ExtIndex: 7, PointID: "CK508-DO1", Writable: true},
	}}
	app, token := newExtWriteApp(t, core)

	body, _ := json.Marshal(map[string]any{"point_id": "CK508-DO1", "value": 0})
	rec := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/write-test", string(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("ghi thử = %d (chờ 200); body = %s", rec.Code, rec.Body.String())
	}
	if core.gotPointID != "EXT7" {
		t.Fatalf("tên điểm = %q (chờ \"EXT7\" theo slot runtime)", core.gotPointID)
	}
}

// Điểm chưa có trong runtime: KHÔNG được đoán slot rồi ghi bừa xuống dây.
func TestModbusWriteTestTuChoiKhiRuntimeChuaCoDiem(t *testing.T) {
	core := &extWriteCore{slots: []ExtSlotRef{{ExtIndex: 1, PointID: "KHAC-01", Writable: true}}}
	app, token := newExtWriteApp(t, core)

	body, _ := json.Marshal(map[string]any{"point_id": "CK508-DO1", "value": 1})
	rec := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/write-test", string(body))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("mã lỗi = %d (chờ 503)", rec.Code)
	}
	if core.calls != 0 {
		t.Fatalf("đã gửi %d lệnh xuống core dù không tra được slot — phải là 0", core.calls)
	}
}

// Runtime nói read-only trong khi cấu hình nói read_write ⇒ iobus chưa nạp cấu
// hình mới. Nói ra, đừng gửi một lệnh mà `PointWriter::can_write` sẽ nuốt.
func TestModbusWriteTestTuChoiKhiRuntimeReadOnly(t *testing.T) {
	core := &extWriteCore{slots: []ExtSlotRef{{ExtIndex: 3, PointID: "CK508-DO1", Writable: false}}}
	app, token := newExtWriteApp(t, core)

	body, _ := json.Marshal(map[string]any{"point_id": "CK508-DO1", "value": 1})
	rec := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/write-test", string(body))

	if rec.Code != http.StatusConflict {
		t.Fatalf("mã lỗi = %d (chờ 409); body = %s", rec.Code, rec.Body.String())
	}
	if core.calls != 0 {
		t.Fatalf("đã gửi %d lệnh xuống core dù slot read-only — phải là 0", core.calls)
	}
}
