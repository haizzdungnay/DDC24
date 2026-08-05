package app

import (
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
			{"device_id": "MTR1", "enabled": true, "rs485_port": "/dev/rs485-1", "baud": 19200, "parity": "N", "stop_bit": 1, "slave_id": 1, "poll_ms": 1000, "timeout_ms": 300}
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
