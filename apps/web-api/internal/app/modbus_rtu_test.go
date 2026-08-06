package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestModbusRTUCRUDPersistsProfileAndKeepsPointIDOnRename(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(target string) (bool, []string) {
		if target != reloadRestartIobus {
			t.Fatalf("reload target = %q", target)
		}
		return true, nil
	}

	deviceBody := `{"device_id":"ahu-1","display_name":"AHU 1","enabled":false,"rs485_port":"/dev/rs485-1","baud":19200,"parity":"E","stop_bits":1,"slave_id":7,"poll_ms":1000,"timeout_ms":300,"retry":2}`
	w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/devices", deviceBody)
	if w.Code != http.StatusOK {
		t.Fatalf("create device status=%d body=%s", w.Code, w.Body.String())
	}

	pointBody := `{"point_id":"MB-AHU-SAT","device_id":"ahu-1","tag_name":"ahu1 sat","display_name":"AHU 1 Supply Air","register_type":"input_register","address":100,"data_type":"float32","byte_order":"little","word_order":"low_high","scale":0.1,"offset":-10,"unit":"degC","read_write":"read","default_value":20,"safe_value":0,"enabled":true}`
	w = modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/points", pointBody)
	if w.Code != http.StatusOK {
		t.Fatalf("create point status=%d body=%s", w.Code, w.Body.String())
	}
	var created modbusMutationResponse
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Point == nil || created.Point.PointID != "MB-AHU-SAT" || created.Apply.Revision != 2 || created.Apply.Checksum == "" {
		t.Fatalf("created = %+v", created)
	}

	updateBody := strings.Replace(pointBody, `"tag_name":"ahu1 sat"`, `"tag_name":"ahu1 supply temp"`, 1)
	updateBody = strings.Replace(updateBody, `"display_name":"AHU 1 Supply Air"`, `"display_name":"Supply temperature"`, 1)
	w = modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/modbus/points/MB-AHU-SAT", updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("update point status=%d body=%s", w.Code, w.Body.String())
	}
	var updated modbusMutationResponse
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Point == nil || updated.Point.PointID != "MB-AHU-SAT" || updated.Point.TagName != "ahu1 supply temp" {
		t.Fatalf("updated = %+v", updated)
	}

	var saved ConfigFieldbus
	readJSONFile(t, filepath.Join(app.cfg.ConfigDir, "fieldbus.conf"), &saved)
	if len(saved.Points) != 1 || saved.Points[0].PointID != "MB-AHU-SAT" || saved.Revision != 3 || saved.Checksum == "" {
		t.Fatalf("fieldbus.conf = %+v", saved)
	}
	profileData, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, "profiles", "ahu-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	profile := string(profileData)
	if !strings.Contains(profile, `"name": "MB-AHU-SAT"`) || !strings.Contains(profile, `"byte_order": "DCBA"`) {
		t.Fatalf("profile không giữ ID/order đã chuẩn hoá: %s", profile)
	}
	if w = modbusServeAuth(t, app, token, http.MethodDelete, "/api/v1/modbus/points/MB-AHU-SAT", ""); w.Code != http.StatusOK {
		t.Fatalf("delete point status=%d body=%s", w.Code, w.Body.String())
	}
	if w = modbusServeAuth(t, app, token, http.MethodDelete, "/api/v1/modbus/devices/ahu-1", ""); w.Code != http.StatusOK {
		t.Fatalf("delete device status=%d body=%s", w.Code, w.Body.String())
	}
	saved = ConfigFieldbus{}
	readJSONFile(t, filepath.Join(app.cfg.ConfigDir, "fieldbus.conf"), &saved)
	if len(saved.Devices) != 0 || len(saved.Points) != 0 || saved.Revision != 5 {
		t.Fatalf("fieldbus.conf sau delete = %+v", saved)
	}
	if _, err := os.Stat(filepath.Join(app.cfg.ConfigDir, "profiles", "ahu-1.json")); !os.IsNotExist(err) {
		t.Fatalf("profile không được xoá cùng Device: %v", err)
	}
}

func TestModbusRTURejectsTagOwnedByVirtualPoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	writeVirtualPointsSeed(t, app, `{"items":[{"id":"VP1","tag":"occupied","label":"Occupied","signalType":"boolean","enabled":true,"writable":true,"value":false}]}`)
	device := `{"device_id":"rtu-1","display_name":"RTU 1","enabled":false,"rs485_port":"/dev/rs485-1","baud":9600,"parity":"N","stop_bits":1,"slave_id":1,"poll_ms":1000,"timeout_ms":300,"retry":2}`
	if w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/devices", device); w.Code != http.StatusOK {
		t.Fatalf("create device status=%d body=%s", w.Code, w.Body.String())
	}
	point := `{"point_id":"MB-OCC","device_id":"rtu-1","tag_name":"Occupied","display_name":"Remote occupied","register_type":"coil","address":1,"data_type":"bool","scale":1,"read_write":"read_write","enabled":true}`
	w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/points", point)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "VP1") {
		t.Fatalf("duplicate tag status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestModbusRTUApplyFailureRestoresConfigAndProfiles(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	oldConfig := []byte("{\"revision\":9,\"checksum\":\"old\",\"devices\":[],\"points\":[]}\n")
	configPath := filepath.Join(app.cfg.ConfigDir, "fieldbus.conf")
	if err := os.WriteFile(configPath, oldConfig, 0o644); err != nil {
		t.Fatal(err)
	}
	app.reloadDispatcher = func(string) (bool, []string) { return false, []string{"restart failed"} }
	request := httptest.NewRequest(http.MethodPost, "/api/v1/modbus/devices", nil)
	_, err := app.applyModbusConfig(request, ConfigFieldbus{Revision: 9, Devices: []ModbusRTUDevice{{DeviceID: "rtu-1", DisplayName: "RTU 1", RS485Port: "/dev/rs485-1", Baud: 9600, Parity: "N", StopBit: 1, SlaveID: 1, PollMS: 1000, TimeoutMS: 300, Retry: 2}}})
	if err == nil || !strings.Contains(err.Error(), "đã được phục hồi") {
		t.Fatalf("apply err = %v", err)
	}
	got, readErr := os.ReadFile(configPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(got) != string(oldConfig) {
		t.Fatalf("fieldbus.conf chưa rollback:\n%s", got)
	}
	if _, statErr := os.Stat(filepath.Join(app.cfg.ConfigDir, "profiles", "rtu-1.json")); !os.IsNotExist(statErr) {
		t.Fatalf("profile mới còn tồn tại sau rollback: %v", statErr)
	}
}

func modbusServeAuth(t *testing.T, app *App, token, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := newAuthRequest(method, path, body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	return w
}
