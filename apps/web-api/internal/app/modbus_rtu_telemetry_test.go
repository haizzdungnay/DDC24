package app

import (
	"bufio"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// T63-003 (PERF-SYS-04/PERF-API-04) — `GET /api/v1/modbus/buses` thêm
// `telemetry`: latency đọc/ghi RIÊNG kèm `sample_count`/`window_size` và
// `since_epoch`. Trường cũ giữ nguyên; iobus không trả lời ⇒ `telemetry: null`.

// Fixture do iobus sinh đúng từng byte (test_control_status.cpp) — cùng file mà
// internal/modbusrtu giải mã.
func t63003ControlStatus(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "iobus", "adapters", "modbus_rtu",
		"tests", "testdata", "control_status_t63_003.json"))
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimRight(string(raw), "\n")
}

func getModbusBusesRaw(t *testing.T, app *App, token string) []map[string]json.RawMessage {
	t.Helper()
	w := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/buses", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var buses []map[string]json.RawMessage
	decodeJSON(t, w.Body.Bytes(), &buses)
	if len(buses) == 0 {
		t.Fatal("phải trả về danh sách bus theo cấu hình")
	}
	return buses
}

func TestModbusBusesCarryLabeledTelemetryFromIobusStatus(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	var request string
	app.cfg.IobusControlSock = startFakeIobusControl(t, t63003ControlStatus(t), &request)

	w := modbusServeAuth(t, app, token, http.MethodGet, "/api/v1/modbus/buses", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	if !strings.Contains(request, `"op":"status"`) {
		t.Fatalf("handler phải hỏi op status, gửi %q", request)
	}
	var buses []modbusBusInfo
	decodeJSON(t, w.Body.Bytes(), &buses)
	byID := map[string]modbusBusInfo{}
	for _, bus := range buses {
		byID[bus.BusID] = bus
	}
	bus1, ok := byID["rs485-1"]
	if !ok || bus1.Telemetry == nil {
		t.Fatalf("rs485-1 phải có telemetry: %+v", buses)
	}
	read := bus1.Telemetry.ReadLatency
	if read.P50US == nil || *read.P50US != 1500 || *read.P95US != 1800 || read.SampleCount != 3 ||
		read.WindowSize != 128 || read.Total != 3 {
		t.Fatalf("read_latency lệch: %+v", read)
	}
	write := bus1.Telemetry.WriteLatency
	if write.P95US == nil || *write.P95US != 2500 || write.SampleCount != 1 {
		t.Fatalf("write_latency lệch: %+v", write)
	}
	if bus1.Telemetry.SinceEpoch.ProducerBootID != 123456789 || bus1.Telemetry.SinceEpoch.Epoch != 1 {
		t.Fatalf("since_epoch lệch: %+v", bus1.Telemetry.SinceEpoch)
	}
	if bus1.Telemetry.TotalTransactions != 4 || bus1.Telemetry.TotalErrors != 1 {
		t.Fatalf("tổng giao dịch/lỗi lệch: %+v", bus1.Telemetry)
	}
	// Trường cũ không đổi nghĩa: telemetry SHM chưa publish trong test ⇒ vẫn null.
	if bus1.PollLatencyP50 != nil || bus1.OpenState != "UNKNOWN" {
		t.Fatalf("trường cũ bị đổi nghĩa: %+v", bus1)
	}
	bus2, ok := byID["rs485-2"]
	if !ok || bus2.Telemetry == nil {
		t.Fatalf("rs485-2 phải có telemetry: %+v", buses)
	}
	if bus2.Telemetry.ReadLatency.P50US != nil || bus2.Telemetry.ReadLatency.WindowSize != 128 {
		t.Fatalf("bus chưa có mẫu: p50 phải null, window_size vẫn có: %+v", bus2.Telemetry.ReadLatency)
	}

	raw := getModbusBusesRaw(t, app, token)
	for _, key := range []string{"poll_latency_p50_ms", "poll_latency_p95_ms", "total_errors",
		"port_reopens", "bus_utilization_percent", "telemetry"} {
		if _, ok := raw[0][key]; !ok {
			t.Errorf("thiếu khoá %q trong /modbus/buses", key)
		}
	}
}

// Không liên lạc được iobus (hoặc iobus trước T63-003) ⇒ `telemetry: null`, không
// phải bộ số 0 trông như đo thật.
func TestModbusBusesTelemetryIsNullWhenIobusUnavailableOrOld(t *testing.T) {
	for name, sock := range map[string]func(t *testing.T) string{
		"no_socket": func(t *testing.T) string { return filepath.Join(t.TempDir(), "khong-ton-tai.sock") },
		"pre_t63_003_iobus": func(t *testing.T) string {
			return startFakeIobusControl(t, `{"result":"ok","generation":1,"config_revision":1,`+
				`"producer_boot_id":9,"counters_since_ms":1,"ext_count":0,"sequence":0,"buses":[`+
				`{"id":1,"name":"RS485-1","device":"/dev/ttyS1","state":"RUNNING","latency_p50_us":800,`+
				`"latency_p95_us":1200,"utilization_pct_x100":0,"timeout_errors":0,"crc_errors":0,`+
				`"port_reopens":0}]}`, nil)
		},
	} {
		t.Run(name, func(t *testing.T) {
			app, token := newTestAppWithAdmin(t)
			app.cfg.IobusControlSock = sock(t)
			for _, bus := range getModbusBusesRaw(t, app, token) {
				if string(bus["telemetry"]) != "null" {
					t.Fatalf("telemetry phải null, được %s", bus["telemetry"])
				}
			}
		})
	}
}

// iobus nhận kết nối nhưng không trả lời (đang bận áp cấu hình): GET không được
// treo theo timeout 5 s của đường apply_config.
func TestModbusBusesDoesNotWaitForSlowIobus(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	path := filepath.Join(t.TempDir(), "slow.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Skipf("không tạo được unix socket: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = bufio.NewReader(c).ReadString('\n')
				<-release
			}(conn)
		}
	}()
	app.cfg.IobusControlSock = path

	started := time.Now()
	buses := getModbusBusesRaw(t, app, token)
	elapsed := time.Since(started)
	if elapsed > 2*time.Second {
		t.Fatalf("GET /modbus/buses chờ iobus %v — phải hết hạn ngắn", elapsed)
	}
	for _, bus := range buses {
		if string(bus["telemetry"]) != "null" {
			t.Fatalf("hết hạn thì telemetry phải null, được %s", bus["telemetry"])
		}
	}
}
