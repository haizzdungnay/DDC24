package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// U-07 (REC-DDC-FIELD-USE-20260927) — `coil_write_batch_max` đi trọn đường
// API → fieldbus.conf → profile mà iobus đọc. Thiếu một mắt xích là trường
// được nhận, được lưu, rồi không có tác dụng — đúng lớp lỗi `MBA-FW-09`.
func TestModbusDeviceCoilWriteBatchMaxToiProfileIobus(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }

	device := `{"device_id":"CK508-04","display_name":"CK508 04","enabled":true,"rs485_port":"/dev/rs485-1","baud":9600,"parity":"N","stop_bits":1,"slave_id":4,"poll_ms":1000,"timeout_ms":300,"retry":1,"coil_write_batch_max":8}`
	if w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/devices", device); w.Code != http.StatusOK {
		t.Fatalf("create device status=%d body=%s", w.Code, w.Body.String())
	}
	point := `{"point_id":"RELAY1","device_id":"CK508-04","tag_name":"ck508 relay 1","display_name":"Relay 1","register_type":"coil","address":0,"data_type":"bool","byte_order":"big","word_order":"high_low","scale":1,"offset":0,"unit":"","read_write":"read_write","default_value":0,"safe_value":0,"enabled":true}`
	if w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/points", point); w.Code != http.StatusOK {
		t.Fatalf("create point status=%d body=%s", w.Code, w.Body.String())
	}
	profilePath := filepath.Join(app.cfg.ConfigDir, "profiles", "CK508-04.json")
	readProfile := func() map[string]any {
		t.Helper()
		raw, err := os.ReadFile(profilePath)
		if err != nil {
			t.Fatal(err)
		}
		var profile map[string]any
		if err := json.Unmarshal(raw, &profile); err != nil {
			t.Fatal(err)
		}
		return profile
	}
	if got := readProfile()["max_coils_per_write"]; got != float64(8) {
		t.Fatalf("profile max_coils_per_write=%v, muốn 8", got)
	}

	// GET trả đúng giá trị đã lưu — FE dựng form từ đây.
	w := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/devices", "")
	var devices []ModbusRTUDevice
	if err := json.Unmarshal(w.Body.Bytes(), &devices); err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].CoilWriteBatchMax != 8 {
		t.Fatalf("devices=%+v", devices)
	}

	// Ngoài dải ⇒ 400 chỉ đúng trường, cấu hình cũ giữ nguyên.
	bad := strings.Replace(device, `"coil_write_batch_max":8`, `"coil_write_batch_max":17`, 1)
	w = modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/modbus/devices/CK508-04", bad)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "coil_write_batch_max") {
		t.Fatalf("PUT 17 status=%d body=%s", w.Code, w.Body.String())
	}
	if got := readProfile()["max_coils_per_write"]; got != float64(8) {
		t.Fatalf("PUT bị từ chối mà profile đã đổi: %v", got)
	}

	// Tắt (0) ⇒ khoá biến mất khỏi profile: iobus quay về từng FC05.
	off := strings.Replace(device, `"coil_write_batch_max":8`, `"coil_write_batch_max":0`, 1)
	if w = modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/modbus/devices/CK508-04", off); w.Code != http.StatusOK {
		t.Fatalf("PUT 0 status=%d body=%s", w.Code, w.Body.String())
	}
	if _, exists := readProfile()["max_coils_per_write"]; exists {
		t.Fatalf("tắt gom mà profile vẫn mang max_coils_per_write")
	}
}
