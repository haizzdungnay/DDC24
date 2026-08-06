package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Bộ test TB-MBRTU cho contract v2 (MBR-B213).
//
// Trọng tâm: những hành vi mà bản trước KHÔNG có và vì thế không thể sai một
// cách nhìn thấy được — vòng đời candidate, optimistic concurrency, import
// all-or-nothing, rate limit commissioning, và việc API không còn bịa số.

const (
	testBusRS4851 = `{"bus_id":"rs485-1","display_name":"RS485-1","port":"/dev/rs485-1","baud":19200,"parity":"N","stop_bits":1,"data_bits":8,"offline_probe_ms":5000,"enabled":true}`
	testDeviceA   = `{"device_id":"mtr-1","display_name":"Meter 1","enabled":true,"bus_id":"rs485-1","rs485_port":"/dev/rs485-1","baud":19200,"parity":"N","stop_bits":1,"slave_id":3,"poll_ms":1000,"timeout_ms":300,"retry":1,"offline_after_errors":2}`
	testPointA    = `{"point_id":"MB-KWH","device_id":"mtr-1","tag_name":"meter kwh","display_name":"Meter kWh","register_type":"holding_register","address":0,"data_type":"uint32","byte_order":"big","word_order":"high_low","scale":1,"offset":0,"unit":"kWh","read_write":"read","enabled":true}`
)

func candidateBody(baseRevision uint64, points string) string {
	return `{"base_revision":` + strconv.FormatUint(baseRevision, 10) +
		`,"buses":[` + testBusRS4851 + `],"devices":[` + testDeviceA + `],"points":[` + points + `]}`
}

func decodeJSON(t *testing.T, raw []byte, out any) {
	t.Helper()
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("không parse được response: %v — %s", err, raw)
	}
}

// TB-MBRTU-01: lưu bản nháp KHÔNG được chạm tới cấu hình đang chạy.
//
// Đây là toàn bộ lý do candidate tồn tại. Bản trước mỗi CRUD ghi thẳng vào
// fieldbus.conf rồi restart iobus (D-09): sửa 20 Point là 20 lần gián đoạn I/O
// hiện trường, và một lần gõ nhầm ở Point thứ 3 đã kịp xuống thiết bị.
func TestModbusCandidateSaveDoesNotTouchRunningConfig(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	reloads := 0
	app.reloadDispatcher = func(string) (bool, []string) { reloads++; return true, nil }

	w := modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	if w.Code != http.StatusOK {
		t.Fatalf("save candidate status=%d body=%s", w.Code, w.Body.String())
	}
	if reloads != 0 {
		t.Fatalf("lưu bản nháp đã kích hoạt %d lần reload — phải là 0", reloads)
	}

	active, err := app.activeModbusConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(active.Points) != 0 || active.Revision != 0 {
		t.Fatalf("cấu hình đang chạy bị thay đổi khi mới lưu nháp: %+v", active)
	}

	w = modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/config/state", "")
	var state modbusConfigStateResponse
	decodeJSON(t, w.Body.Bytes(), &state)
	if state.State != "DIRTY" || len(state.Diff) == 0 {
		t.Fatalf("state = %+v", state)
	}
}

// TB-MBRTU-02: apply mới là lúc cấu hình đang chạy đổi.
func TestModbusApplyPromotesCandidateAndBumpsRevisionOnce(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }

	modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	w := modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/config/apply", `{"operation_id":"op-1"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("apply status=%d body=%s", w.Code, w.Body.String())
	}
	var applied map[string]any
	decodeJSON(t, w.Body.Bytes(), &applied)
	if applied["revision"] != float64(1) {
		t.Fatalf("revision sau apply = %v", applied["revision"])
	}

	active, _ := app.activeModbusConfig()
	if len(active.Points) != 1 || active.Revision != 1 || active.Checksum == "" {
		t.Fatalf("cấu hình đang chạy = %+v", active)
	}
	// Bản nháp phải biến mất: giữ lại làm người dùng thấy "còn thay đổi chưa
	// áp dụng" cho thứ vừa áp dụng xong.
	w = modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/config/state", "")
	var state modbusConfigStateResponse
	decodeJSON(t, w.Body.Bytes(), &state)
	if state.State != "CLEAN" || len(state.Diff) != 0 {
		t.Fatalf("state sau apply = %+v", state)
	}
}

// TB-MBRTU-03: idempotency theo operation_id.
//
// Client mất kết nối sau khi server đã apply xong sẽ thử lại. Không có bước
// này, lần thử thứ hai apply LẠI cùng nội dung và đẩy revision thêm một bậc —
// mọi client khác lãnh REVISION_CONFLICT oan.
func TestModbusApplyIsIdempotentForSameOperationID(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }

	modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	first := modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/config/apply", `{"operation_id":"op-retry"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("apply lần 1 status=%d body=%s", first.Code, first.Body.String())
	}
	second := modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/config/apply", `{"operation_id":"op-retry"}`)
	if second.Code != http.StatusOK {
		t.Fatalf("apply lần 2 status=%d body=%s", second.Code, second.Body.String())
	}
	var replay map[string]any
	decodeJSON(t, second.Body.Bytes(), &replay)
	if replay["idempotent"] != true || replay["revision"] != float64(1) {
		t.Fatalf("lần thử lại phải trả kết quả cũ: %+v", replay)
	}
	active, _ := app.activeModbusConfig()
	if active.Revision != 1 {
		t.Fatalf("revision bị đẩy lên %d bởi lần thử lại", active.Revision)
	}
}

// TB-MBRTU-04: optimistic concurrency (MBR-B205).
//
// Hai kỹ thuật viên cùng mở trang; người thứ hai lưu đè im lặng lên thay đổi
// của người thứ nhất là kịch bản mất việc thật, và không ai phát hiện cho tới
// khi thiết bị chạy sai.
func TestModbusCandidateRejectsStaleBaseRevision(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }

	modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/config/apply", `{"operation_id":"op-a"}`)

	// Client thứ hai vẫn tin hệ thống đang ở revision 0.
	w := modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	if w.Code != http.StatusOK {
		t.Fatalf("base_revision=0 nghĩa là không kiểm — phải cho qua: %d", w.Code)
	}
	w = modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(99, testPointA))
	if w.Code != http.StatusPreconditionFailed {
		t.Fatalf("base_revision lệch phải trả 412, nhận %d body=%s", w.Code, w.Body.String())
	}
}

func TestModbusCandidateHonoursIfMatchHeader(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	request := newAuthRequest(http.MethodPut, "/api/v1/modbus/config/candidate",
		candidateBody(0, testPointA), token)
	request.Header.Set("If-Match", `"42"`)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, request)
	if w.Code != http.StatusPreconditionFailed {
		t.Fatalf("If-Match lệch phải trả 412, nhận %d body=%s", w.Code, w.Body.String())
	}
}

// TB-MBRTU-05: cổng ngoài capability manifest bị chặn ở tầng API, kèm mã ổn định.
func TestModbusCandidateRejectsUnavailablePortWithStableCode(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	body := strings.Replace(candidateBody(0, testPointA), "/dev/rs485-1", "/dev/ttyS3", -1)
	w := modbusServeAuth(t, app, token, http.MethodPut, "/api/v1/modbus/config/candidate", body)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "PORT_NOT_AVAILABLE") {
		t.Fatalf("thiếu mã lỗi ổn định: %s", w.Body.String())
	}
}

// TB-MBRTU-06: import CSV là ALL-OR-NOTHING.
//
// Import một phần tạo ra trạng thái người dùng không mô tả được: họ tưởng nạp
// đủ, thực tế vài dòng im lặng biến mất và không có cách nào biết dòng nào.
func TestModbusImportCSVIsAllOrNothing(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/config/apply", `{"operation_id":"seed"}`)

	badCSV := "point_id,device_id,tag_name,display_name,register_type,address,data_type\n" +
		"MB-A,mtr-1,tag a,A,holding_register,10,uint16\n" +
		"MB-B,mtr-1,tag b,B,holding_register,KHONG_PHAI_SO,uint16\n"
	w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/import?format=csv", badCSV)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CSV có dòng sai phải bị từ chối: %d %s", w.Code, w.Body.String())
	}
	// Bản nháp KHÔNG được chứa dòng hợp lệ của file hỏng.
	state := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/config/state", "")
	if strings.Contains(state.Body.String(), "MB-A") {
		t.Fatalf("import hỏng vẫn để lại dữ liệu: %s", state.Body.String())
	}

	goodCSV := "point_id,device_id,tag_name,display_name,register_type,address,data_type,scale,read_write,enabled\n" +
		"MB-A,mtr-1,tag a,A,holding_register,10,uint16,1,read,true\n" +
		"MB-B,mtr-1,tag b,B,holding_register,11,uint16,1,read,true\n"
	w = modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/import?format=csv", goodCSV)
	if w.Code != http.StatusOK {
		t.Fatalf("CSV hợp lệ phải được nhận: %d %s", w.Code, w.Body.String())
	}
	var result map[string]any
	decodeJSON(t, w.Body.Bytes(), &result)
	if result["result"] != "staged" || result["point_count"] != float64(2) {
		t.Fatalf("import result = %+v", result)
	}
}

// Export phải round-trip: file xuất ra nạp lại được nguyên vẹn.
func TestModbusExportImportRoundTripsJSON(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/config/apply", `{"operation_id":"seed"}`)

	exported := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/export?format=json", "")
	if exported.Code != http.StatusOK {
		t.Fatalf("export status=%d", exported.Code)
	}
	w := modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/import?format=json", exported.Body.String())
	if w.Code != http.StatusOK {
		t.Fatalf("import bản vừa export phải thành công: %d %s", w.Code, w.Body.String())
	}
	var result map[string]any
	decodeJSON(t, w.Body.Bytes(), &result)
	if result["point_count"] != float64(1) || result["device_count"] != float64(1) {
		t.Fatalf("round-trip mất dữ liệu: %+v", result)
	}
}

// TB-MBRTU-07: /modbus/events KHÔNG còn danh sách viết cứng.
//
// Bản trước trả về hai dòng sự kiện có sẵn ("MTR-01 OFFLINE -> ONLINE",
// "VFD-01 TIMEOUT") kể cả khi không có thiết bị nào được đấu. Người vận hành
// không có cách nào phân biệt sự kiện thật với dữ liệu trang trí.
func TestModbusEventsAreEmptyWhenNothingObserved(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	w := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/events", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	var events []modbusEventItem
	decodeJSON(t, w.Body.Bytes(), &events)
	if len(events) != 0 {
		t.Fatalf("chưa quan sát được chuyển trạng thái nào mà vẫn có %d sự kiện: %+v",
			len(events), events)
	}
	if strings.Contains(w.Body.String(), "MTR-01") || strings.Contains(w.Body.String(), "VFD-01") {
		t.Fatalf("còn dữ liệu mẫu viết cứng: %s", w.Body.String())
	}
}

// Vòng đệm sự kiện chỉ ghi khi trạng thái ĐỔI, và ghi đúng chiều.
func TestModbusEventLogRecordsOnlyTransitions(t *testing.T) {
	var log modbusEventLog
	now := time.Now()
	log.observe("mtr-1", "rs485-1", "INITIALIZING", now)
	log.observe("mtr-1", "rs485-1", "INITIALIZING", now)
	if len(log.snapshot()) != 0 {
		t.Fatal("lần quan sát đầu và trạng thái không đổi không được sinh sự kiện")
	}
	log.observe("mtr-1", "rs485-1", "ONLINE", now)
	log.observe("mtr-1", "rs485-1", "OFFLINE", now)
	events := log.snapshot()
	if len(events) != 2 {
		t.Fatalf("events = %+v", events)
	}
	// Mới nhất đứng đầu.
	if events[0].Message != "ONLINE -> OFFLINE" || events[0].Level != "warning" {
		t.Fatalf("sự kiện mới nhất = %+v", events[0])
	}
	if events[1].Message != "INITIALIZING -> ONLINE" || events[1].Level != "info" {
		t.Fatalf("sự kiện trước = %+v", events[1])
	}
}

// TB-MBRTU-08: /modbus/buses không bịa p50/p95/utilization khi chưa có telemetry.
func TestModbusBusesReportNullLatencyWithoutTelemetry(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	w := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/buses", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	var buses []modbusBusInfo
	decodeJSON(t, w.Body.Bytes(), &buses)
	if len(buses) == 0 {
		t.Fatal("phải trả về danh sách bus theo cấu hình")
	}
	for _, bus := range buses {
		if bus.PollLatencyP50 != nil || bus.PollLatencyP95 != nil || bus.Utilization != nil {
			t.Fatalf("bus %s bịa số đo khi chưa có telemetry: %+v", bus.BusID, bus)
		}
		if bus.OpenState != "UNKNOWN" {
			t.Fatalf("bus %s báo trạng thái cổng %q khi chưa liên lạc được iobus",
				bus.BusID, bus.OpenState)
		}
	}
}

// Overview phải phân biệt "chưa khởi tạo" với "offline": gọi một thiết bị là
// offline khi chưa từng hỏi nó là bịa trạng thái.
func TestModbusOverviewCountsNeverPolledDevicesAsInitializing(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	modbusServeAuth(t, app, token, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	modbusServeAuth(t, app, token, http.MethodPost,
		"/api/v1/modbus/config/apply", `{"operation_id":"seed"}`)

	w := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/overview", "")
	var overview modbusOverview
	decodeJSON(t, w.Body.Bytes(), &overview)
	if overview.TelemetryAvailable {
		t.Fatal("không có iobus mà vẫn báo telemetry khả dụng")
	}
	if overview.Initializing != 1 || overview.Offline != 0 {
		t.Fatalf("overview = %+v (thiết bị chưa từng poll phải là initializing)", overview)
	}
}

// TB-MBRTU-09: rate limit commissioning (OD-MBRTU-007).
func TestModbusReadTestIsRateLimitedPerUser(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	body := `{"bus_id":"rs485-1","slave_id":3,"fc":3,"address":0,"count":1}`
	limited := false
	for i := 0; i < 8; i++ {
		w := modbusServeAuth(t, app, token, http.MethodPost, "/api/v1/modbus/read-test", body)
		if w.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("không có giới hạn tần suất: một tab kẹt nút sẽ chiếm trọn bus")
	}
}

// Viewer đọc được, không mutate được (Đ-04 + PR-MBRTU-001).
func TestModbusCandidateMutationRequiresAdmin(t *testing.T) {
	users := writeTestUsers(t, "viewer123", RoleViewer)
	app, err := NewApp(testConfig(t, users), nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	viewerToken, _, err := app.auth.Authenticate("admin", "viewer123", "test")
	if err != nil {
		t.Fatal(err)
	}
	w := modbusServeAuth(t, app, viewerToken, http.MethodGet, "/api/v1/modbus/config/state", "")
	if w.Code != http.StatusOK {
		t.Fatalf("viewer phải xem được trạng thái cấu hình: %d", w.Code)
	}
	w = modbusServeAuth(t, app, viewerToken, http.MethodPut,
		"/api/v1/modbus/config/candidate", candidateBody(0, testPointA))
	if w.Code != http.StatusForbidden {
		t.Fatalf("viewer sửa được cấu hình: %d %s", w.Code, w.Body.String())
	}
}

// /modbus/ports trả đúng allowlist của board — FE dùng nó để dựng dropdown
// thay vì để người dùng gõ tay một đường dẫn không tồn tại (D-14).
func TestModbusPortsExposesCapabilityManifest(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	w := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/ports", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "/dev/rs485-1") ||
		!strings.Contains(w.Body.String(), "/dev/rs485-2") {
		t.Fatalf("manifest thiếu cổng: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "/dev/ttyS3") {
		t.Fatalf("manifest chứa cổng không tồn tại trên board: %s", w.Body.String())
	}
}
