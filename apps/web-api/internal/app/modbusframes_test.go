package app

import (
	"bufio"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"testing"
)

// `T57-3.9` — `GET /api/v1/modbus/frames`.
//
// Endpoint này tồn tại để trả lời một câu hỏi hiện trường: "khung có ra dây
// không, slave có trả lời không, CRC có đúng không". Điều nguy hiểm nhất nó có
// thể làm KHÔNG phải trả sai một con số, mà là **trả mảng rỗng khi thật ra
// không biết** — người kỹ thuật đọc mảng rỗng thành "bus im lặng" rồi đi tháo
// dây, trong khi sự thật có thể chỉ là iobus bản cũ không hỗ trợ op này.

// startFakeIobusControl dựng một control socket iobus giả trả về đúng một câu
// trả lời cố định, và ghi lại yêu cầu cuối cùng nhận được.
func startFakeIobusControl(t *testing.T, reply string, seen *string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "iobus.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Skipf("không tạo được unix socket: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			line, _ := bufio.NewReader(conn).ReadString('\n')
			if seen != nil {
				*seen = line
			}
			_, _ = conn.Write([]byte(reply + "\n"))
			_ = conn.Close()
		}
	}()
	return path
}

func TestModbusFramesReturnsRingFromIobus(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	var request string
	app.cfg.IobusControlSock = startFakeIobusControl(t,
		`{"result":"ok","frames":[{"at":1755600000000,"bus":1,"slave":7,"fc":3,"addr":100,`+
			`"count":2,"ok":false,"reason":"crc","elapsedUs":2500,"attempt":2}]}`, &request)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/frames?bus=1&limit=50", ``, token)
	assertStatus(t, resp, http.StatusOK)

	var body ModbusFramesResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Frames) != 1 {
		t.Fatalf("frames=%d; want 1", len(body.Frames))
	}
	frame := body.Frames[0]
	// Phân loại lỗi phải đi qua nguyên vẹn: `crc` và `timeout` dẫn tới hai hành
	// động sửa chữa khác hẳn nhau.
	if frame.Reason != "crc" || frame.OK {
		t.Fatalf("frame=%+v; want lỗi CRC", frame)
	}
	if frame.Attempt != 2 {
		t.Fatalf("attempt=%d; want 2 — số lần phát là dữ liệu chẩn đoán, không phải nhiễu", frame.Attempt)
	}
	// Hai lời hứa phải nói ra để giao diện không mô tả sai bản chất dữ liệu.
	if !body.Volatile {
		t.Fatalf("volatile phải là true: vòng nhớ mất khi iobus restart")
	}
	if body.RawBytes {
		t.Fatalf("rawBytes phải là false: `ADR-046` bản sửa nói rõ Rev A không có byte thô")
	}
	if request == "" {
		t.Fatalf("không thấy yêu cầu nào gửi tới iobus")
	}
	var sent map[string]any
	if err := json.Unmarshal([]byte(request), &sent); err != nil {
		t.Fatalf("yêu cầu gửi đi không phải JSON hợp lệ: %v", err)
	}
	if sent["op"] != "frames" {
		t.Fatalf("op=%v; want frames", sent["op"])
	}
}

func TestModbusFramesUnsupportedIsNotAnEmptyList(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.cfg.IobusControlSock = startFakeIobusControl(t,
		`{"result":"error","code":"unsupported","reason":"op không được hỗ trợ"}`, nil)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/frames", ``, token)
	// 200 kèm mảng rỗng ở đây là một lời nói dối có hậu quả vật lý: nó bảo người
	// đọc rằng bus im lặng, trong khi thật ra ta không đọc được gì cả.
	assertStatus(t, resp, http.StatusServiceUnavailable)
	if body := resp.Body.String(); body == "" {
		t.Fatalf("503 phải nói lý do iobus trả về")
	}
}

func TestModbusFramesUnavailableSocketIs503(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.cfg.IobusControlSock = filepath.Join(t.TempDir(), "khong-ton-tai.sock")

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/frames", ``, token)
	assertStatus(t, resp, http.StatusServiceUnavailable)
}

func TestModbusFramesRejectsBadQuery(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.cfg.IobusControlSock = startFakeIobusControl(t, `{"result":"ok","frames":[]}`, nil)
	router := app.Router()

	for _, query := range []string{"?bus=abc", "?bus=-1", "?limit=0", "?limit=-5", "?limit=x"} {
		resp := serveAuth(t, router, http.MethodGet, "/api/v1/modbus/frames"+query, ``, token)
		assertStatus(t, resp, http.StatusBadRequest)
	}
}

func TestModbusFramesClampsLimitInsteadOfRefusing(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	var request string
	app.cfg.IobusControlSock = startFakeIobusControl(t, `{"result":"ok","frames":[]}`, &request)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/frames?limit=100000", ``, token)
	assertStatus(t, resp, http.StatusOK)

	var sent map[string]any
	if err := json.Unmarshal([]byte(request), &sent); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	// Xin quá sức chứa không phải là lỗi người dùng đáng chặn — kẹp về trần rồi
	// phục vụ, vì thứ họ cần là "khung gần nhất", không phải một con số chính xác.
	if limit, _ := sent["limit"].(float64); int(limit) != modbusFramesMaxLimit {
		t.Fatalf("limit gửi xuống iobus=%v; want kẹp về %d", sent["limit"], modbusFramesMaxLimit)
	}
}

func TestModbusFramesEmptyRingStaysEmptyArrayNotNull(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.cfg.IobusControlSock = startFakeIobusControl(t, `{"result":"ok"}`, nil)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/frames", ``, token)
	assertStatus(t, resp, http.StatusOK)
	// `null` và `[]` khác nhau ở phía giao diện: `null` dễ thành crash hoặc thành
	// trạng thái "đang tải" vĩnh viễn.
	if body := resp.Body.String(); !jsonHasEmptyFrames(body) {
		t.Fatalf("body=%s; want frames là mảng rỗng, không phải null", body)
	}
}

func jsonHasEmptyFrames(body string) bool {
	var parsed struct {
		Frames []FrameRecord `json:"frames"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		return false
	}
	return parsed.Frames != nil && len(parsed.Frames) == 0
}

// U-18 (REC-DDC-FIELD-USE-20260927) — khung GHI mang giá trị đã phát; khung đọc
// giữ nguyên hình dạng cũ (không có `values`).
func TestModbusFramesChuyenNguyenGiaTriGhi(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.cfg.IobusControlSock = startFakeIobusControl(t,
		`{"result":"ok","frames":[`+
			`{"at":1755600000002,"bus":1,"slave":4,"fc":15,"addr":0,"count":8,"ok":true,"reason":"ok","elapsedUs":30000,"attempt":1,"values":[1,0,1,1,0,0,1,0]},`+
			`{"at":1755600000001,"bus":1,"slave":4,"fc":1,"addr":0,"count":8,"ok":true,"reason":"ok","elapsedUs":29000,"attempt":1}]}`, nil)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/modbus/frames", ``, token)
	assertStatus(t, resp, http.StatusOK)
	var body ModbusFramesResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Frames) != 2 {
		t.Fatalf("frames=%+v", body.Frames)
	}
	want := []int{1, 0, 1, 1, 0, 0, 1, 0}
	got := body.Frames[0].Values
	if len(got) != len(want) {
		t.Fatalf("values=%v, muốn %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("values=%v, muốn %v", got, want)
		}
	}
	var raw struct {
		Frames []map[string]any `json:"frames"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if _, exists := raw.Frames[1]["values"]; exists {
		t.Fatalf("khung đọc không được mang values: %v", raw.Frames[1])
	}
}
