package modbusrtu

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Fixture hợp đồng op `status` do iobus sinh ĐÚNG từng byte
// (`ControlStatusT63003.StatusReplyMatchesSharedFixture` trong
// apps/iobus/adapters/modbus_rtu/tests/test_control_status.cpp). Hai phía đọc
// cùng một file: đổi định dạng ở một phía mà quên phía kia ⇒ một test đỏ.
func t63003StatusFixture(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "apps", "iobus", "adapters", "modbus_rtu",
		"tests", "testdata", "control_status_t63_003.json"))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// serveStatusOnce dựng một kênh điều khiển giả trả đúng một dòng `reply` cho
// request `status` — đi qua ĐÚNG đường ControlClient.Status() của production.
func serveStatusOnce(t *testing.T, reply []byte) ControlClient {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ctl.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		line, _ := bufio.NewReader(conn).ReadString('\n')
		if !strings.Contains(line, `"op":"status"`) {
			return
		}
		_, _ = conn.Write(append([]byte(strings.TrimRight(string(reply), "\n")), '\n'))
	}()
	return ControlClient{SocketPath: path, Timeout: 2 * time.Second}
}

// AC T63-003: latency đọc/ghi RIÊNG kèm sample_count/window_size, counter IOP
// 64 bit và epoch — đọc qua client thật từ fixture do iobus sinh.
func TestControlStatusFixtureT63003(t *testing.T) {
	status, err := serveStatusOnce(t, t63003StatusFixture(t)).Status()
	if err != nil {
		t.Fatal(err)
	}
	// Trường cũ giữ nguyên nghĩa.
	if status.Result != "ok" || status.Generation != 3 || status.ConfigRevision != 42 ||
		status.ProducerBootID != 123456789 || status.CountersSinceMS != 1000 ||
		status.ExtCount != 12 || status.Sequence != 77 || len(status.Buses) != 2 {
		t.Fatalf("trường cũ lệch: %+v", status)
	}
	legacy := status.Buses[0]
	if legacy.ID != 1 || legacy.State != "RUNNING" || legacy.LatencyP50US != 1800 || legacy.LatencyP95US != 2500 {
		t.Fatalf("latency trộn (nghĩa cũ) lệch: %+v", legacy)
	}

	buses := BusTelemetryByID(status)
	bus1, ok := buses[1]
	if !ok {
		t.Fatal("bus 1 phải có telemetry T63-003")
	}
	wantEpoch := CounterEpoch{ProducerBootID: 123456789, Epoch: 1, SinceMonotonicMS: 5000}
	if bus1.SinceEpoch != wantEpoch {
		t.Fatalf("since_epoch = %+v, muốn %+v", bus1.SinceEpoch, wantEpoch)
	}
	if bus1.ReadLatency.P50US == nil || *bus1.ReadLatency.P50US != 1500 || *bus1.ReadLatency.P95US != 1800 ||
		*bus1.ReadLatency.MaxUS != 1800 || bus1.ReadLatency.SampleCount != 3 ||
		bus1.ReadLatency.WindowSize != 128 || bus1.ReadLatency.Total != 3 {
		t.Fatalf("read_latency lệch: %+v", bus1.ReadLatency)
	}
	if bus1.WriteLatency.P95US == nil || *bus1.WriteLatency.P95US != 2500 || bus1.WriteLatency.SampleCount != 1 ||
		bus1.WriteLatency.Total != 1 {
		t.Fatalf("write_latency lệch: %+v", bus1.WriteLatency)
	}
	if bus1.TotalTransactions != 4 || bus1.TotalErrors != 1 {
		t.Fatalf("tổng giao dịch/lỗi lệch: %+v", bus1)
	}

	bus2 := buses[2]
	if bus2.ReadLatency.P50US != nil || bus2.WriteLatency.MaxUS != nil {
		t.Fatalf("bus chưa có mẫu phải trả null, không phải 0 µs: %+v", bus2)
	}
	if bus2.ReadLatency.WindowSize != 128 || bus2.ReadLatency.SampleCount != 0 {
		t.Fatalf("nhãn cửa sổ của bus rỗng lệch: %+v", bus2.ReadLatency)
	}

	iop, ok := IOPCountersFrom(status)
	if !ok {
		t.Fatal("thiếu khối iop")
	}
	if iop.RX != 5000000000 || iop.TX != 5000000001 || iop.Timeouts != 3 || iop.Retries != 4 {
		t.Fatalf("counter IOP 64 bit lệch: %+v", iop)
	}
	if iop.SinceEpoch != (CounterEpoch{ProducerBootID: 123456789, Epoch: 0, SinceMonotonicMS: 1000}) {
		t.Fatalf("epoch IOP lệch: %+v", iop.SinceEpoch)
	}
}

// Hình dạng JSON của API: snake_case như `/api/v1/modbus/buses`, latency rỗng
// là `null`.
func TestBusTelemetryViewJSONShape(t *testing.T) {
	status, err := serveStatusOnce(t, t63003StatusFixture(t)).Status()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(BusTelemetryByID(status)[2])
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"read_latency":{"p50_us":null,"p95_us":null,"max_us":null,"sample_count":0,"window_size":128,"total":0}`,
		`"since_epoch":{"producer_boot_id":"123456789","epoch":1,"since_monotonic_ms":5000}`,
	} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("thiếu %s trong %s", want, raw)
		}
	}
}

// iobus trước T63-003: KHÔNG có trường mới ⇒ caller nhận "không biết" (map
// rỗng / ok=false), không nhận một bộ số 0 trông như đo thật. Trường cũ vẫn
// giải mã như trước.
func TestStatusFromPreT63003IobusIsUnknownNotZero(t *testing.T) {
	legacy := `{"result":"ok","generation":2,"config_revision":7,"producer_boot_id":9,` +
		`"counters_since_ms":10,"ext_count":3,"sequence":4,"buses":[{"id":1,"name":"RS485-1",` +
		`"device":"/dev/ttyS1","state":"RUNNING","latency_p50_us":800,"latency_p95_us":1200,` +
		`"utilization_pct_x100":150,"timeout_errors":0,"crc_errors":0,"port_reopens":1}]}`
	status, err := serveStatusOnce(t, []byte(legacy)).Status()
	if err != nil {
		t.Fatal(err)
	}
	if status.Buses[0].LatencyP95US != 1200 || status.Buses[0].PortReopens != 1 || status.ConfigRevision != 7 {
		t.Fatalf("trường cũ phải giải mã như trước: %+v", status)
	}
	if got := BusTelemetryByID(status); len(got) != 0 {
		t.Fatalf("iobus cũ không được sinh telemetry giả: %+v", got)
	}
	if _, ok := IOPCountersFrom(status); ok {
		t.Fatal("iobus cũ không gửi khối iop — ok phải là false")
	}
}

// Schema IPC (contracts/config/modbus_control_v1.schema.json) đặt
// `additionalProperties:false` cho StatusResponse/BusStatus: mọi khoá iobus
// thật sự gửi (fixture) phải có trong schema, kể cả object lồng. Thêm trường ở
// iobus mà quên schema ⇒ đỏ ở đây (trước T63-003 fixture bị schema từ chối vì
// `bus_counters_epoch`, `bus_counters_since_ms`, `iop`).
func TestControlSchemaDeclaresEveryStatusFieldT63003(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "contracts", "config", "modbus_control_v1.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Defs map[string]struct {
			Properties           map[string]json.RawMessage `json:"properties"`
			Required             []string                   `json:"required"`
			AdditionalProperties *bool                      `json:"additionalProperties"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatal(err)
	}
	var fixture map[string]json.RawMessage
	if err := json.Unmarshal(t63003StatusFixture(t), &fixture); err != nil {
		t.Fatal(err)
	}
	checkKeys := func(def string, obj map[string]json.RawMessage) {
		t.Helper()
		d, ok := schema.Defs[def]
		if !ok {
			t.Fatalf("schema thiếu $defs.%s", def)
		}
		if d.AdditionalProperties == nil || *d.AdditionalProperties {
			t.Errorf("$defs.%s phải additionalProperties:false để khoá hợp đồng", def)
		}
		for key := range obj {
			if _, declared := d.Properties[key]; !declared {
				t.Errorf("iobus gửi %s.%s nhưng schema không khai báo", def, key)
			}
		}
		for _, key := range d.Required {
			if _, present := obj[key]; !present {
				t.Errorf("schema bắt buộc %s.%s nhưng iobus không gửi", def, key)
			}
		}
	}
	checkKeys("StatusResponse", fixture)
	var iop map[string]json.RawMessage
	if err := json.Unmarshal(fixture["iop"], &iop); err != nil {
		t.Fatal(err)
	}
	checkKeys("IopCounters", iop)
	var buses []map[string]json.RawMessage
	if err := json.Unmarshal(fixture["buses"], &buses); err != nil {
		t.Fatal(err)
	}
	for _, bus := range buses {
		checkKeys("BusStatus", bus)
		for _, key := range []string{"latency_read", "latency_write"} {
			var window map[string]json.RawMessage
			if err := json.Unmarshal(bus[key], &window); err != nil {
				t.Fatal(err)
			}
			checkKeys("LatencyWindow", window)
		}
	}
}

// AC T63-003: epoch phân biệt reset với giảm.
func TestCounterDeltaDistinguishesResetFromDecrease(t *testing.T) {
	boot := CounterEpoch{ProducerBootID: 77, Epoch: 1, SinceMonotonicMS: 2000}

	if delta, reset, err := CounterDelta(boot, 100, boot, 160); err != nil || reset || delta != 60 {
		t.Fatalf("cùng epoch tăng: delta=%d reset=%v err=%v", delta, reset, err)
	}
	// apply_config: counter về 0, producer_boot_id GIỮ NGUYÊN, epoch bus tăng.
	applied := CounterEpoch{ProducerBootID: 77, Epoch: 2, SinceMonotonicMS: 9000}
	if delta, reset, err := CounterDelta(boot, 500, applied, 12); err != nil || !reset || delta != 12 {
		t.Fatalf("apply_config phải là reset: delta=%d reset=%v err=%v", delta, reset, err)
	}
	// iobus restart: boot id đổi.
	restarted := CounterEpoch{ProducerBootID: 78, Epoch: 1, SinceMonotonicMS: 50}
	if _, reset, err := CounterDelta(boot, 500, restarted, 3); err != nil || !reset {
		t.Fatalf("restart phải là reset: reset=%v err=%v", reset, err)
	}
	// Cùng epoch mà giảm: không có reset hợp lệ nào giải thích được.
	if _, _, err := CounterDelta(boot, 500, boot, 499); !errors.Is(err, ErrCounterDecreased) {
		t.Fatalf("giảm trong cùng epoch phải báo lỗi, được %v", err)
	}
}
