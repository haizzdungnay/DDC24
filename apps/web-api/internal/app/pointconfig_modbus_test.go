package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

/* ISS-PIO-20 — `PUT /points/{id}/config` nhận điểm Modbus (F-PIO-023).
 *
 * Trước bản vá `canonicalPointConfigID` chỉ chuẩn hoá `UI/AO/DO/VP`, nên điểm
 * Modbus không sửa được tag/tên/đơn vị/trend/thẻ thiết bị qua API Point chung —
 * mọi công cụ viết cho API đó lặng lẽ không áp dụng được cho một phần ba số
 * điểm trong tủ.
 */

/* seedModbusPoint dựng một điểm Modbus QUA CHÍNH API `/modbus/*`.
 *
 * Không ghi thẳng `fieldbus.conf`: đường ghi thật mang theo revision/checksum
 * mà `Persister` đối chiếu, nên một tệp gieo tay sẽ bị từ chối ở bước apply và
 * bài kiểm sẽ đo một trạng thái không bao giờ tồn tại trên thiết bị thật. */
func seedModbusPoint(t *testing.T, app *App, token string) {
	t.Helper()
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	device := `{"device_id":"vfd-1","display_name":"Bien tan 1","enabled":false,"rs485_port":"/dev/rs485-1","baud":19200,"parity":"E","stop_bits":1,"slave_id":7,"poll_ms":1000,"timeout_ms":300,"retry":2}`
	if w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/devices", device); w.Code != http.StatusOK {
		t.Fatalf("tạo thiết bị: status=%d body=%s", w.Code, w.Body.String())
	}
	point := `{"point_id":"vfd-fault","device_id":"vfd-1","tag_name":"VFD_FAULT","display_name":"VFD fault word","register_type":"input_register","address":100,"data_type":"uint16","byte_order":"big","word_order":"high_low","scale":1,"offset":0,"unit":"","read_write":"read","default_value":0,"safe_value":0,"enabled":true}`
	if w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/points", point); w.Code != http.StatusOK {
		t.Fatalf("tạo điểm: status=%d body=%s", w.Code, w.Body.String())
	}
}

func readFieldbusConfig(t *testing.T, app *App) ConfigFieldbus {
	t.Helper()
	cfg, err := readConfig(app, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		t.Fatalf("đọc fieldbus: %v", err)
	}
	return cfg
}

// Sửa được cả năm trường trình bày qua API Point chung — điều kiện đóng của issue.
func TestPointConfigAcceptsModbusPoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/vfd-fault/config",
		`{"tag":"VFD_FAULT_WORD","name":"Từ báo lỗi biến tần","unit":"bit","trendEnabled":true,"equipment":"AHU-1"}`, token)
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d; muốn 200; body=%s", resp.Code, resp.Body.String())
	}

	cfg := readFieldbusConfig(t, app)
	point := cfg.Points[0]
	if point.TagName != "VFD_FAULT_WORD" || point.DisplayName != "Từ báo lỗi biến tần" || point.Unit != "bit" {
		t.Fatalf("metadata chưa ghi: %+v", point)
	}
	if !point.TrendEnabled {
		t.Fatal("trendEnabled không được ghi — điểm Modbus vẫn không bật trend được")
	}
	if point.Equipment != "AHU-1" {
		t.Fatalf("equipment = %q; muốn AHU-1", point.Equipment)
	}
}

/* Chỉ chạm năm trường TRÌNH BÀY.
 *
 * `register_type`, `address`, `data_type`, `scale`… là hợp đồng đọc thanh ghi.
 * Sửa chúng qua một API đặt tên là "config metadata" là mở cửa hậu vào đúng
 * phần nguy hiểm nhất của cấu hình. */
func TestPointConfigDoesNotTouchModbusRegisterContract(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)
	before := readFieldbusConfig(t, app).Points[0]

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/vfd-fault/config",
		`{"name":"Đổi tên thôi","address":999,"register_type":"coil","data_type":"float32","device_id":"khac"}`, token)
	assertStatus(t, resp, http.StatusOK)

	after := readFieldbusConfig(t, app).Points[0]
	if after.Address != before.Address || after.RegisterType != before.RegisterType ||
		after.DataType != before.DataType || after.DeviceID != before.DeviceID {
		t.Fatalf("hợp đồng đọc thanh ghi bị đổi qua API metadata: trước=%+v sau=%+v", before, after)
	}
	if after.DisplayName != "Đổi tên thôi" {
		t.Fatalf("name không được ghi: %+v", after)
	}
}

/* Mã KHÔNG PHẢI điểm nào cả vẫn nhận đúng thông báo "cần point id chuẩn".
 *
 * Phép kiểm ngoài (`modbusPointExists`) và phép kiểm trong
 * (`findModbusConfigPoint`) đều chặn được mã lạ, nên chỉ đo mã trạng thái thì
 * hai thiết kế không phân biệt được. Cái khác nhau là THÔNG BÁO: nhận diện
 * bằng mẫu chuỗi sẽ đẩy `UI-99` xuống nhánh Modbus và trả lời "điểm Modbus
 * không tồn tại" cho một mã UI gõ sai — một chỉ dẫn sai lối. */
func TestPointConfigMalformedCanonicalIDKeepsItsOwnMessage(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/UI-99/config", `{"name":"x"}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400", resp.Code)
	}
	if !strings.Contains(resp.Body.String(), "canonical point id") {
		t.Fatalf("thông báo bị đổi sang nhánh Modbus cho một mã UI gõ sai: %s", resp.Body.String())
	}
}

// Mã không tồn tại vẫn là 400 như trước — không được biến thành "tạo mới".
func TestPointConfigRejectsUnknownID(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)

	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/khong-co-diem-nay/config", `{"name":"x"}`, token)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; muốn 400; body=%s", resp.Code, resp.Body.String())
	}
	if len(readFieldbusConfig(t, app).Points) != 1 {
		t.Fatal("một mã lạ đã tạo thêm điểm")
	}
}

// Điểm LOCAL giữ nguyên hành vi: tag của điểm vật lý vẫn cố định.
func TestPointConfigKeepsPhysicalTagFixed(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/UI-01/config", `{"tag":"DOI_TAG"}`, token)
	if resp.Code == http.StatusOK {
		t.Fatalf("tag điểm vật lý bị đổi qua API; body=%s", resp.Body.String())
	}
}

/* Bản vá rỗng bị từ chối ở CẢ HAI nhánh.
 *
 * Hai nhánh phải áp cùng các phép kiểm ở cửa; một nhánh nới lỏng hơn nhánh kia
 * là cách sinh ra hai bộ quy tắc cho một API. */
func TestPointConfigRejectsEmptyPatchOnBothBranches(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)
	for _, id := range []string{"UI-01", "vfd-fault"} {
		resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/"+id+"/config", `{}`, token)
		if resp.Code == http.StatusOK {
			t.Fatalf("%s: bản vá rỗng được nhận", id)
		}
	}
}

// Thẻ thiết bị quá dài bị chặn ở cả nhánh Modbus, cùng giới hạn `ADR-042`.
func TestPointConfigEnforcesEquipmentLimitOnModbus(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)
	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/vfd-fault/config",
		`{"equipment":"`+strings.Repeat("A", equipmentTagMaxBytes+1)+`"}`, token)
	if resp.Code == http.StatusOK {
		t.Fatalf("thẻ thiết bị quá %d byte vẫn được nhận", equipmentTagMaxBytes)
	}
}

/* Trend và thẻ thiết bị của điểm Modbus phải đi ra tới danh sách Point.
 *
 * Ghi được mà không đọc lại được thì tính năng chỉ tồn tại trên đĩa: trước bản
 * vá hai trường này chỉ được điền từ `io_config`, mà điểm Modbus không nằm
 * trong đó — nên mọi điểm Modbus luôn hiện "không ghi trend, chưa gán thiết bị". */
func TestModbusMetadataReachesPointList(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)
	assertStatus(t, serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/vfd-fault/config",
		`{"trendEnabled":true,"equipment":"AHU-1"}`, token), http.StatusOK)

	points := app.overlayPointMetadata([]PointDTO{{ID: "vfd-fault", Kind: "modbus_rtu"}})
	if !points[0].LogEnabled {
		t.Fatal("logEnabled không đi ra tới danh sách Point")
	}
	if points[0].Equipment != "AHU-1" {
		t.Fatalf("equipment = %q; muốn AHU-1", points[0].Equipment)
	}
}

/* Thẻ thiết bị được gom khoảng trắng, để `AHU-1 ` và `AHU-1` cùng một nhóm.
 *
 * Kiểm ở CẢ HAI đường ghi. Đường `/points/{id}/config` đã chuẩn hoá ở cửa
 * (`decodePointConfigPatch`), nên nếu chỉ kiểm ở đó thì phép chuẩn hoá trong
 * `NormalizePoint` có thể bị gỡ mà không ai biết — và đường CRUD Modbus trực
 * tiếp sẽ lặng lẽ đẻ ra hai nhóm cùng tên trên Monitor. */
func TestModbusEquipmentIsNormalized(t *testing.T) {
	t.Run("qua PUT /points/{id}/config", func(t *testing.T) {
		app, token := newTestAppWithAdmin(t)
		seedModbusPoint(t, app, token)
		assertStatus(t, serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/vfd-fault/config",
			`{"equipment":"  AHU-1   tầng 3 "}`, token), http.StatusOK)
		if got := readFieldbusConfig(t, app).Points[0].Equipment; got != "AHU-1 tầng 3" {
			t.Fatalf("equipment = %q; muốn \"AHU-1 tầng 3\"", got)
		}
	})
	t.Run("qua CRUD Modbus trực tiếp", func(t *testing.T) {
		app, token := newTestAppWithAdmin(t)
		seedModbusPoint(t, app, token)
		body := `{"point_id":"vfd-fault","device_id":"vfd-1","tag_name":"VFD_FAULT","display_name":"VFD fault word","register_type":"input_register","address":100,"data_type":"uint16","byte_order":"big","word_order":"high_low","scale":1,"offset":0,"unit":"","read_write":"read","default_value":0,"safe_value":0,"enabled":true,"equipment":"  AHU-1   tầng 3 "}`
		if w := modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/modbus/points/vfd-fault", body); w.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		if got := readFieldbusConfig(t, app).Points[0].Equipment; got != "AHU-1 tầng 3" {
			t.Fatalf("equipment = %q; muốn \"AHU-1 tầng 3\"", got)
		}
	})
}

// Tra mã không phân biệt hoa thường — người dùng gõ tay mã điểm.
func TestFindModbusConfigPointIsCaseInsensitive(t *testing.T) {
	cfg := ConfigFieldbus{Points: []ModbusRTUPoint{{PointID: "vfd-fault"}}}
	if findModbusConfigPoint(cfg, "VFD-Fault") != 0 {
		t.Fatal("tra mã phân biệt hoa thường")
	}
	if findModbusConfigPoint(cfg, "khong-co") != -1 {
		t.Fatal("mã không tồn tại vẫn khớp")
	}
}

// Phản hồi trả về chính điểm vừa sửa, để giao diện không phải tải lại đoán mò.
func TestPointConfigModbusResponseCarriesPoint(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	seedModbusPoint(t, app, token)
	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/points/vfd-fault/config", `{"name":"Tên mới"}`, token)
	assertStatus(t, resp, http.StatusOK)
	var body struct {
		Point *ModbusRTUPoint `json:"point"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("giải mã: %v (raw=%s)", err, resp.Body.String())
	}
	if body.Point == nil || body.Point.DisplayName != "Tên mới" {
		t.Fatalf("phản hồi không mang điểm vừa sửa: %s", resp.Body.String())
	}
}
