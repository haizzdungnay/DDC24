package app

import (
	"bufio"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// T63-003 (PERF-API-04) — `GET /api/v1/system/status` thêm `iop.counters`:
// counter IOP 64 bit kèm `since_epoch`, lấy từ op `status` của kênh điều khiển
// iobus. Ba trường cũ `iop.crc_errors/timeouts/seq_errors` (uint32 từ SHM) giữ
// nguyên; iobus không trả lời hoặc bản cũ ⇒ `iop.counters: null`.

func systemStatusIOP(t *testing.T, controlSock string) (map[string]json.RawMessage, time.Duration) {
	t.Helper()
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	cfg.IobusControlSock = controlSock
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	startOSMetricsCollector(t, app)
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	started := time.Now()
	app.Router().ServeHTTP(w, req)
	elapsed := time.Since(started)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	var iop map[string]json.RawMessage
	if err := json.Unmarshal(body["iop"], &iop); err != nil {
		t.Fatalf("iop: %v", err)
	}
	return iop, elapsed
}

// Trường cũ của `iop` phải còn nguyên chỗ, nguyên giá trị (fakeCore: 1/2/3).
func assertLegacyIOPFields(t *testing.T, iop map[string]json.RawMessage) {
	t.Helper()
	for key, want := range map[string]string{
		"status": `"normal"`, "crc_errors": "1", "timeouts": "2", "seq_errors": "3", "last_io_resp_ms": "7",
	} {
		if got := string(iop[key]); got != want {
			t.Errorf("iop.%s = %s; muốn %s (trường cũ phải giữ nguyên)", key, got, want)
		}
	}
}

func TestSystemStatusCarriesIOPCountersWithEpoch(t *testing.T) {
	var request string
	sock := startFakeIobusControl(t, t63003ControlStatus(t), &request)
	iop, _ := systemStatusIOP(t, sock)
	assertLegacyIOPFields(t, iop)
	if string(iop["counters"]) == "null" || len(iop["counters"]) == 0 {
		t.Fatalf("iop.counters phải có khi iobus trả lời: %v", iop)
	}
	var counters struct {
		RX         uint64 `json:"rx"`
		TX         uint64 `json:"tx"`
		CRCErrors  uint64 `json:"crc_errors"`
		Timeouts   uint64 `json:"timeouts"`
		SinceEpoch struct {
			ProducerBootID   string `json:"producer_boot_id"`
			Epoch            uint64 `json:"epoch"`
			SinceMonotonicMS uint64 `json:"since_monotonic_ms"`
		} `json:"since_epoch"`
	}
	if err := json.Unmarshal(iop["counters"], &counters); err != nil {
		t.Fatal(err)
	}
	// Vượt 2^32: đúng giá trị 64 bit, không bị cắt như `iop.crc_errors` từ SHM.
	if counters.RX != 5000000000 || counters.TX != 5000000001 || counters.CRCErrors != 2 || counters.Timeouts != 3 {
		t.Fatalf("counter IOP lệch: %+v", counters)
	}
	if counters.SinceEpoch.ProducerBootID != "123456789" || counters.SinceEpoch.Epoch != 0 ||
		counters.SinceEpoch.SinceMonotonicMS != 1000 {
		t.Fatalf("since_epoch lệch: %+v", counters.SinceEpoch)
	}
}

func TestSystemStatusIOPCountersNullWhenIobusUnavailableOrOld(t *testing.T) {
	for name, sock := range map[string]func(t *testing.T) string{
		"no_socket": func(t *testing.T) string { return filepath.Join(t.TempDir(), "khong-ton-tai.sock") },
		"pre_t63_003_iobus": func(t *testing.T) string {
			return startFakeIobusControl(t, `{"result":"ok","generation":1,"config_revision":1,`+
				`"producer_boot_id":9,"counters_since_ms":1,"ext_count":0,"sequence":0,"buses":[]}`, nil)
		},
		"iobus_error": func(t *testing.T) string {
			return startFakeIobusControl(t, `{"result":"error","code":"unknown_op","reason":"x"}`, nil)
		},
	} {
		t.Run(name, func(t *testing.T) {
			iop, _ := systemStatusIOP(t, sock(t))
			assertLegacyIOPFields(t, iop)
			if got := string(iop["counters"]); got != "null" {
				t.Fatalf("iop.counters phải null, được %s", got)
			}
		})
	}
}

// iobus nhận kết nối nhưng không trả lời: phần hỏi iobus không được giữ
// `/system/status` quá `iopCountersTimeout` (300 ms).
func TestSystemStatusDoesNotWaitForSlowIobus(t *testing.T) {
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

	// Trần viết SỐ CỨNG theo yêu cầu (300 ms + dư cho phần còn lại của handler),
	// không suy từ hằng số trong mã: nới hằng số thì test phải đỏ.
	const ceiling = 300 * time.Millisecond
	iop, elapsed := systemStatusIOP(t, path)
	if elapsed > ceiling+300*time.Millisecond {
		t.Fatalf("/system/status chờ iobus %v — trần là %v", elapsed, ceiling)
	}
	if elapsed < ceiling-50*time.Millisecond {
		t.Fatalf("hết hạn quá sớm (%v): phép thử không chạm tới trần", elapsed)
	}
	if got := string(iop["counters"]); got != "null" {
		t.Fatalf("hết hạn thì iop.counters phải null, được %s", got)
	}
	assertLegacyIOPFields(t, iop)
}
