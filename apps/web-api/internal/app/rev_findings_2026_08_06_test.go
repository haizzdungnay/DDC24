package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	webModbus "mkddc-web/internal/modbusrtu"
)

// Bộ test cho 14 finding của rà soát BE/FE ngày 2026-08-06
// (`docs/07_records/reviews/CODE_REVIEW_BE_FE_2026-08-06.md`).
//
// Điểm chung của cả 15 finding hôm đó: chúng nằm NGOÀI vùng phủ của một bộ test
// đang xanh hoàn toàn. Vì vậy mỗi test dưới đây đi qua đúng đường mà finding mô
// tả — endpoint thật, cấu hình thật — chứ không dựng lại logic trong chính test
// rồi khẳng định logic dựng lại đó đúng.

// telemetryCore là core giả có telemetry fieldbus, dùng cho nhóm finding về
// đường giải bus. `ReadPoints` trả lỗi khi `pointsErr` được đặt.
type telemetryCore struct {
	telemetry FieldbusTelemetry
	points    []PointDTO
	pointsErr error
}

func (c *telemetryCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true}, nil
}

func (c *telemetryCore) ReadPoints(context.Context) ([]PointDTO, error) {
	if c.pointsErr != nil {
		return nil, c.pointsErr
	}
	return c.points, nil
}

func (c *telemetryCore) ReadFieldbusTelemetry(context.Context) (FieldbusTelemetry, error) {
	return c.telemetry, nil
}

// twoBusFixture dựng cấu hình hai dây RS-485, mỗi dây một thiết bị ở
// `slave_id = 1` — cấu hình HỢP LỆ vì slave chỉ cần unique trong từng dây.
// Telemetry cho hai kết quả trái ngược nhau để mọi phép tra sai đều lộ ra.
func twoBusFixture(t *testing.T) (*App, string) {
	t.Helper()
	app, token := newTestAppWithAdmin(t)
	fieldbus := `{
	  "buses": [
	    {"bus_id":"rs485-1","port":"/dev/rs485-1","baud":9600,"parity":"N","data_bits":8,"stop_bits":1,"enabled":true},
	    {"bus_id":"rs485-2","port":"/dev/rs485-2","baud":9600,"parity":"N","data_bits":8,"stop_bits":1,"enabled":true}
	  ],
	  "devices": [
	    {"device_id":"MTR-TANG-1","display_name":"motor tang 1","bus_id":"rs485-1","rs485_port":"/dev/rs485-1","slave_id":1,"baud":9600,"parity":"N","stop_bit":1,"poll_ms":1000,"enabled":true},
	    {"device_id":"VFD-TANG-2","display_name":"vfd tang 2","bus_id":"rs485-2","rs485_port":"/dev/rs485-2","slave_id":1,"baud":9600,"parity":"N","stop_bit":1,"poll_ms":1000,"enabled":true}
	  ],
	  "points": []
	}`
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, "fieldbus.conf"), []byte(fieldbus), 0o644); err != nil {
		t.Fatal(err)
	}
	app.core = &telemetryCore{telemetry: FieldbusTelemetry{
		Published: true,
		Buses: []BusTelemetry{
			{ID: 1, State: "RUNNING", TotalErrors: 100},
			{ID: 2, State: "RUNNING", TotalErrors: 0},
		},
		Slaves: []SlaveTelemetry{
			// Dây 1: sống, 40 timeout + 5 CRC.
			{Addr: 1, BusID: 1, Online: true, TotalPolls: 500, TotalErrors: 45, TimeoutErrors: 40, CRCErrors: 5},
			// Dây 2: CHẾT — nếu tra theo mỗi slave thì hai bản ghi này đè nhau.
			{Addr: 1, BusID: 2, Online: false, TotalPolls: 500, TotalErrors: 30, TimeoutErrors: 30, CRCErrors: 0},
		},
	}}
	return app, token
}

func getJSON(t *testing.T, app *App, token, path string, out any) {
	t.Helper()
	req := newAuthRequest(http.MethodGet, path, "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s = %d body=%s", path, w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
		t.Fatalf("decode %s: %v body=%s", path, err, w.Body.String())
	}
}

// REV-BE-03 / REV-BE-04: mọi endpoint dùng telemetry phải tra theo (bus, slave).
//
// Tra theo mỗi `slave_id` làm hai thiết bị đè lên nhau: KPI đếm thiết bị chết
// thành đang chạy, bảng chẩn đoán dán nhãn nhầm thiết bị, và người vận hành đi
// theo những con số đó sẽ tới nhầm tủ.
func TestTelemetryTraCuuTheoBusVaSlaveTrenMoiEndpoint(t *testing.T) {
	app, token := twoBusFixture(t)

	t.Run("diagnostics gán đúng device_id cho từng dây", func(t *testing.T) {
		var rows []map[string]any
		getJSON(t, app, token, "/api/v1/modbus/diagnostics", &rows)
		if len(rows) != 2 {
			t.Fatalf("chờ 2 hàng chẩn đoán, có %d: %+v", len(rows), rows)
		}
		byDevice := map[string]map[string]any{}
		for _, row := range rows {
			byDevice[row["device_id"].(string)] = row
		}
		if row, ok := byDevice["MTR-TANG-1"]; !ok || row["online"] != true {
			t.Errorf("MTR-TANG-1 (dây 1, đang sống) = %+v", row)
		}
		if row, ok := byDevice["VFD-TANG-2"]; !ok || row["online"] != false {
			t.Errorf("VFD-TANG-2 (dây 2, đã chết) = %+v", row)
		}
	})

	t.Run("overview đếm đúng một sống một chết", func(t *testing.T) {
		var res map[string]any
		getJSON(t, app, token, "/api/v1/modbus/overview", &res)
		if res["online"] != float64(1) || res["offline"] != float64(1) {
			t.Fatalf("overview đếm sai: online=%v offline=%v (chờ 1/1) — %+v",
				res["online"], res["offline"], res)
		}
	})

	t.Run("buses báo đúng số thiết bị online của từng dây", func(t *testing.T) {
		var buses []map[string]any
		getJSON(t, app, token, "/api/v1/modbus/buses", &buses)
		got := map[string]float64{}
		for _, bus := range buses {
			got[bus["bus_id"].(string)] = bus["online_devices"].(float64)
		}
		if got["rs485-1"] != 1 {
			t.Errorf("rs485-1 online_devices = %v, chờ 1", got["rs485-1"])
		}
		if got["rs485-2"] != 0 {
			t.Errorf("rs485-2 online_devices = %v, chờ 0", got["rs485-2"])
		}
	})

	t.Run("recordModbusEvents gắn đúng device_id với trạng thái", func(t *testing.T) {
		app.recordModbusEvents(context.Background())
		var events []map[string]any
		getJSON(t, app, token, "/api/v1/modbus/events", &events)
		state := map[string]string{}
		for _, e := range events {
			msg, _ := e["message"].(string)
			id, _ := e["device_id"].(string)
			state[id] = msg
		}
		if len(state) == 0 {
			t.Skip("endpoint sự kiện chưa phát bản ghi nào trong lần quan sát đầu")
		}
		if s := state["VFD-TANG-2"]; s != "" && strings.Contains(s, "ONLINE") && !strings.Contains(s, "OFFLINE") {
			t.Errorf("VFD-TANG-2 đã chết nhưng sự kiện nói %q", s)
		}
	})
}

// REV-BE-10: `/modbus/buses` đếm trùng timeout và xoá trắng CRC.
//
// Bản cũ gán `TotalErrors` của cả dây (mọi nguyên nhân) vào `timeout_errors`,
// đặt `crc_errors = 0`, rồi CỘNG THÊM số đo của từng slave lên trên — một dây có
// nhiều nhất 100 lỗi báo ra 140, và tổng CRC đã đo được thì biến mất.
func TestBusesKhongDemTrungTimeoutVaKhongXoaTrangCRC(t *testing.T) {
	app, token := twoBusFixture(t)
	var buses []map[string]any
	getJSON(t, app, token, "/api/v1/modbus/buses", &buses)

	for _, bus := range buses {
		id := bus["bus_id"].(string)
		timeout := bus["timeout_errors"].(float64)
		crc := bus["crc_errors"].(float64)
		total := bus["total_errors"].(float64)
		switch id {
		case "rs485-1":
			if timeout != 40 {
				t.Errorf("rs485-1 timeout_errors = %v, chờ 40 (chỉ từ số đo theo slave)", timeout)
			}
			if crc != 5 {
				t.Errorf("rs485-1 crc_errors = %v, chờ 5 — CRC đã đo không được xoá trắng", crc)
			}
			if total != 100 {
				t.Errorf("rs485-1 total_errors = %v, chờ 100 (tổng của dây, đi riêng)", total)
			}
			if timeout+crc > total {
				t.Errorf("rs485-1: timeout+crc = %v vượt tổng lỗi %v của dây", timeout+crc, total)
			}
		case "rs485-2":
			if timeout != 30 {
				t.Errorf("rs485-2 timeout_errors = %v, chờ 30", timeout)
			}
		}
	}
}

// REV-BE-01: `PUT /system/config/fieldbus` với body rỗng từng xoá sạch cấu hình
// Modbus qua một đường tắt không journal, không rollback, revision về 0.
func TestPutFieldbusBodyRongKhongXoaCauHinhDangLuu(t *testing.T) {
	app, token := twoBusFixture(t)
	path := filepath.Join(app.cfg.ConfigDir, "fieldbus.conf")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/fieldbus", `{}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatalf("body rỗng được chấp nhận (status 200) — đây chính là đường xoá sạch cấu hình")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("fieldbus.conf bị thay đổi bởi một PUT body rỗng\ntrước: %s\nsau:  %s", before, after)
	}

	var cfg ConfigFieldbus
	if err := json.Unmarshal(after, &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.Devices) != 2 || len(cfg.Buses) != 2 {
		t.Fatalf("cấu hình mất dữ liệu: %d bus, %d device (chờ 2/2)", len(cfg.Buses), len(cfg.Devices))
	}
}

// Xoá tường minh vẫn phải làm được — bản vá chặn NHẦM LẪN, không chặn ý định.
func TestPutFieldbusXoaTuongMinhVanChayVaDiQuaPersister(t *testing.T) {
	app, token := twoBusFixture(t)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }
	body := `{"buses":[],"devices":[],"points":[]}`
	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/fieldbus", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("xoá tường minh bị từ chối: %d body=%s", w.Code, w.Body.String())
	}
	var result ConfigPutResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	// Persister sinh revision/checksum; đường tắt cũ để cả hai rỗng.
	if result.Checksum == "" {
		t.Errorf("kết quả không có checksum ⇒ không đi qua Persister: %+v", result)
	}
}

// REV-BE-07: core chết không được trông giống "thiết bị không có point nào".
func TestPointsTraLoi503KhiKhongDocDuocCore(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.core = &telemetryCore{pointsErr: errors.New("không đọc được snapshot nhất quán")}

	req := newAuthRequest(http.MethodGet, "/api/v1/points", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d (chờ 503), body = %s — 200 kèm [] làm giao diện hiện bảng rỗng với huy hiệu khoẻ",
			w.Code, w.Body.String())
	}
}

// REV-BE-08: `overlayPointMetadata` không được xoá provenance do core cấp.
func TestOverlayPointMetadataGiuNguyenSourceCuaCore(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	in := []PointDTO{
		{ID: "AO-01", Kind: "AO", Source: "core_unavailable"},
		{ID: "AO-02", Kind: "AO", Source: "rejected:priority"},
		{ID: "AO-03", Kind: "AO"}, // chưa có source ⇒ được phép điền
	}
	out := app.overlayPointMetadata(in)
	if out[0].Source != "core_unavailable" {
		t.Errorf("AO-01 source = %q, chờ core_unavailable — hợp đồng ws.go dựa vào chuỗi này", out[0].Source)
	}
	if out[1].Source != "rejected:priority" {
		t.Errorf("AO-02 source = %q, chờ rejected:priority", out[1].Source)
	}
	if out[2].Source != "local_physical_io" {
		t.Errorf("AO-03 source = %q, chờ local_physical_io khi core không nói gì", out[2].Source)
	}
}

// REV-BE-09: cổng lạ không được im lặng rơi về dây 1.
func TestBusIDForPortFailClosedVoiCongLa(t *testing.T) {
	cases := map[string]string{
		"/dev/rs485-1": "rs485-1",
		"/dev/ttyS5":   "rs485-1",
		"/dev/rs485-2": "rs485-2",
		"/dev/ttyS1":   "rs485-2",
		"/dev/ttyUSB0": "",
		"/dev/ttyACM0": "",
		"":             "",
		"rs485-1":      "",
	}
	for port, want := range cases {
		if got := webModbus.BusIDForPort(port); got != want {
			t.Errorf("BusIDForPort(%q) = %q, chờ %q", port, got, want)
		}
	}
}

// REV-PLT-01: biên CORS fail-closed khi chưa cấu hình.
func TestIsAllowedOriginFailClosedKhiChuaCauHinh(t *testing.T) {
	cases := []struct {
		origin        string
		configured    string
		allowLoopback bool
		want          bool
	}{
		{"http://localhost:9999", "", false, false},
		{"http://127.0.0.1:3000", "", false, false},
		{"http://[::1]:5173", "", false, false},
		{"http://localhost:9999", "", true, true},
		{"https://ddc.example.local", "https://ddc.example.local", false, true},
		{"http://localhost:9999", "https://ddc.example.local", true, false},
		{"", "", true, false},
	}
	for _, tc := range cases {
		got := isAllowedOrigin(tc.origin, tc.configured, tc.allowLoopback)
		if got != tc.want {
			t.Errorf("isAllowedOrigin(%q, %q, %v) = %v, chờ %v",
				tc.origin, tc.configured, tc.allowLoopback, got, tc.want)
		}
	}
}

// REV-BE-06: ghi thử Modbus phải bị giới hạn 2 lệnh/phút/người dùng.
func TestModbusWriteTestBiGioiHanTanSuat(t *testing.T) {
	app, token := twoBusFixture(t)
	body := `{"point_id":"KHONG-TON-TAI","value":1}`

	statuses := make([]int, 0, 3)
	for i := 0; i < 3; i++ {
		req := newAuthRequest(http.MethodPost, "/api/v1/modbus/write-test", body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		statuses = append(statuses, w.Code)
	}
	if statuses[2] != http.StatusTooManyRequests {
		t.Fatalf("lệnh ghi thử thứ 3 trong một phút = %d (chờ 429); toàn bộ chuỗi = %v", statuses[2], statuses)
	}
}

// REV-BE-02: WebSocket giữ quyền ghi sau khi phiên bị thu hồi.
//
// `requireWSAuth` xác thực đúng một lần lúc bắt tay rồi nhét principal vào
// context; socket sau đó sống bao lâu tuỳ ý. Operator bấm Logout thì mọi request
// REST bị chặn, nhưng socket đang mở vẫn còn quyền `op:"force"` để ghi xuống
// AO/DO/VP — cơ chế thu hồi phiên bị vô hiệu đúng trên kênh DUY NHẤT thật sự
// ghi xuống thiết bị.
func TestWebSocketDongKhiPhienBiThuHoi(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.core = &telemetryCore{points: []PointDTO{{ID: "AO-01", Kind: "AO", Value: float64(10), Quality: "good"}}}

	server := httptest.NewServer(app.Router())
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/v1/ws/monitor"
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		Subprotocols: []string{wsSubprotocol, "mkddc.token." + token},
	})
	if err != nil {
		t.Fatalf("mở WebSocket: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	// Socket đang hợp lệ: lệnh force được chấp nhận (không phải lỗi 401).
	if err := wsjson.Write(ctx, conn, map[string]any{"op": "force", "id": "AO-01", "value": 42}); err != nil {
		t.Fatalf("gửi force lần đầu: %v", err)
	}
	var first json.RawMessage
	if err := wsjson.Read(ctx, conn, &first); err != nil {
		t.Fatalf("đọc phản hồi force lần đầu: %v", err)
	}
	if strings.Contains(string(first), "401") {
		t.Fatalf("token còn hạn mà đã bị từ chối: %s", first)
	}

	// Người dùng logout ⇒ phiên bị thu hồi.
	app.auth.Revoke(token)

	// Socket cũ KHÔNG được tiếp tục ghi xuống thiết bị.
	writeErr := wsjson.Write(ctx, conn, map[string]any{"op": "force", "id": "AO-01", "value": 99})
	if writeErr == nil {
		var second json.RawMessage
		readErr := wsjson.Read(ctx, conn, &second)
		if readErr == nil && !strings.Contains(string(second), "401") {
			t.Fatalf("socket vẫn nhận lệnh ghi sau khi phiên bị thu hồi: %s", second)
		}
	}
}
