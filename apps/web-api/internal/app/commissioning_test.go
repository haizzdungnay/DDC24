package app

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
)

/* ISS-PIO-26 — lệnh test commissioning phải có TTL và tự nhả.
 *
 * Trước bản vá này handler `handleCommissionTest` KHÔNG có test nào cả, nên
 * việc nó ghi ra cơ cấu chấp hành bằng một lệnh không thời hạn không làm gì đỏ.
 * Bộ test dưới đây khoá đúng bốn điều đề bài đòi: thời hạn có mặt, thời hạn tự
 * nhả do Core cưỡng chế (không phải hẹn giờ trong web-api), ngang bằng đường ép
 * tay về audit + đăng ký override, và fail-closed khi Core không cưỡng chế được.
 */

// commissionRecorderCore ghi lại đúng những gì handler gửi xuống Core.
type commissionRecorderCore struct {
	mu        sync.Mutex
	calls     []commissionCall
	remaining uint32 // 0 = Core không báo thời hạn còn lại
	failValue bool
}

type commissionCall struct {
	id    string
	value any
	ttlS  uint32
	user  string
}

func (c *commissionRecorderCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true}, nil
}

func (c *commissionRecorderCore) CommissionTestTTL(_ context.Context, id string, value any, ttlS uint32, user string) (CommissioningTestResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, commissionCall{id: id, value: value, ttlS: ttlS, user: user})
	requested := ttlS
	res := CommissioningTestResult{Result: "passed", PointID: id, AppliedValue: value, Message: "accepted", TTLS: &requested}
	if c.failValue {
		res.Result = "failed"
		res.Message = "point fault or bad quality"
	}
	if c.remaining > 0 {
		remaining := c.remaining
		res.ExpiresInS = &remaining
	}
	return res, nil
}

func (c *commissionRecorderCore) last() (commissionCall, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.calls) == 0 {
		return commissionCall{}, false
	}
	return c.calls[len(c.calls)-1], true
}

// noTTLCore là một core client kiểu cũ: ghi được, nhưng không cưỡng chế thời hạn.
type noTTLCore struct{}

func (noTTLCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true}, nil
}

func (noTTLCore) ForcePoint(_ context.Context, id string, value any, _ bool) (PointDTO, error) {
	return PointDTO{ID: id, Value: value, Quality: "good", Source: "core"}, nil
}

func decodeCommissionResult(t *testing.T, body []byte) CommissioningTestResult {
	t.Helper()
	var res CommissioningTestResult
	if err := json.Unmarshal(body, &res); err != nil {
		t.Fatalf("decode kết quả: %v (body=%s)", err, body)
	}
	return res
}

// Thân yêu cầu không có `ttlS` KHÔNG được biến thành lệnh giữ vô hạn.
func TestCommissionTestAppliesDefaultTTLWhenBodyOmitsIt(t *testing.T) {
	core := &commissionRecorderCore{remaining: 297}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/commissioning/points/DO-01/test", `{"value":true}`, token)
	assertStatus(t, resp, http.StatusOK)

	call, ok := core.last()
	if !ok {
		t.Fatal("Core không nhận lệnh nào")
	}
	/* So với SỐ TUYỆT ĐỐI 300, không so với `defaultCommissionTestTTLS`.
	 *
	 * Bản đầu của test này viết `call.ttlS != defaultCommissionTestTTLS` và vì
	 * thế không kiểm gì cả: đặt hằng số về 0 (đúng hành vi hỏng đang sửa) thì
	 * cả hai vế cùng thành 0 và test vẫn xanh. Một phép so tự tham chiếu như vậy
	 * nguy hiểm hơn cả việc không có test, vì nó trông như đang canh. */
	if call.ttlS != 300 {
		t.Fatalf("ttlS gửi xuống Core = %d; muốn mặc định 300 — thiếu TTL nghĩa là output kẹt ép tay vĩnh viễn", call.ttlS)
	}
	res := decodeCommissionResult(t, resp.Body.Bytes())
	if res.TTLS == nil || *res.TTLS != 300 {
		t.Fatalf("ttlS trong phản hồi = %v; muốn 300", res.TTLS)
	}
	if res.ExpiresInS == nil || *res.ExpiresInS != 297 {
		t.Fatalf("expiresInS = %v; muốn 297 lấy nguyên từ Core", res.ExpiresInS)
	}
}

// TTL do client chỉ định đi NGUYÊN VẸN xuống Core, kèm danh tính người gọi.
func TestCommissionTestForwardsRequestedTTLAndUser(t *testing.T) {
	core := &commissionRecorderCore{remaining: 60}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/commissioning/points/AO-02/test", `{"value":42,"ttlS":60}`, token)
	assertStatus(t, resp, http.StatusOK)

	call, _ := core.last()
	if call.ttlS != 60 {
		t.Fatalf("ttlS = %d; muốn 60", call.ttlS)
	}
	if call.user != "admin" {
		t.Fatalf("user gửi xuống Core = %q; muốn %q — audit của Core phải biết ai ép", call.user, "admin")
	}
}

/* `ttlS: 0` là "giữ vô hạn" theo hợp đồng Core. Endpoint này không có lựa chọn
 * đó, nên phải TỪ CHỐI chứ không âm thầm đổi thành mặc định: đổi ngầm là trả
 * lời một câu khác câu người gọi hỏi. */
func TestCommissionTestRejectsUnboundedAndOutOfRangeTTL(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"ttl 0 là vô hạn", `{"value":true,"ttlS":0}`},
		{"ttl âm", `{"value":true,"ttlS":-1}`},
		{"ttl quá trần Core", `{"value":true,"ttlS":86401}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			core := &commissionRecorderCore{remaining: 10}
			app, token := newTestAppWithRole(t, RoleOperator, core)
			resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/commissioning/points/DO-01/test", tc.body, token)
			assertStatus(t, resp, http.StatusBadRequest)
			if _, ok := core.last(); ok {
				t.Fatal("lệnh bị từ chối mà vẫn đi xuống Core")
			}
		})
	}
}

// Core không cưỡng chế được TTL ⇒ fail closed. Thà không chạy thử được còn hơn
// ép một cơ cấu chấp hành bằng lệnh không ai nhả.
func TestCommissionTestRefusesCoreWithoutTTLEnforcement(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleOperator, noTTLCore{})
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/commissioning/points/DO-01/test", `{"value":true}`, token)
	assertStatus(t, resp, http.StatusConflict)
}

/* Ngang bằng đường ép tay: sau một lệnh test, `OverrideRegistry` phải biết điểm
 * đang bị ép. Thiếu bước này thì trang Giám sát/Tổng quan không thấy điểm nào bị
 * ép sau buổi chạy thử — đúng lớp lỗi PA3-F05, chỉ khác đường vào. */
func TestCommissionTestRegistersOverrideForCountdown(t *testing.T) {
	core := &commissionRecorderCore{remaining: 280}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/commissioning/points/DO-01/test", `{"value":true,"ttlS":300}`, token)
	assertStatus(t, resp, http.StatusOK)

	snapshot := app.overrides.Snapshot()
	state, ok := snapshot[canonicalPointID("DO-01")]
	if !ok {
		t.Fatalf("DO-01 không có trong sổ override sau lệnh test; snapshot=%#v", snapshot)
	}
	if state.RemainingS != 280 {
		t.Fatalf("remainingS = %d; muốn 280 lấy nguyên từ Core", state.RemainingS)
	}
	if state.User != "admin" {
		t.Fatalf("chủ lệnh = %q; muốn admin", state.User)
	}
}

// Core không báo thời hạn còn lại thì KHÔNG được bịa: không có đồng hồ đếm
// ngược nào cho một lệnh không rõ Core có cưỡng chế hay không.
func TestCommissionTestDoesNotInventRemainingWhenCoreSilent(t *testing.T) {
	core := &commissionRecorderCore{remaining: 0}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/commissioning/points/DO-01/test", `{"value":true}`, token)
	assertStatus(t, resp, http.StatusOK)

	res := decodeCommissionResult(t, resp.Body.Bytes())
	if res.ExpiresInS != nil {
		t.Fatalf("expiresInS = %v; Core im lặng thì trường này phải vắng", *res.ExpiresInS)
	}
	if _, ok := app.overrides.Snapshot()[canonicalPointID("DO-01")]; ok {
		t.Fatal("Core không báo thời hạn mà sổ override vẫn dựng một đồng hồ đếm ngược")
	}
}

// Trường lạ vẫn bị chặn sau khi mở thêm `ttlS` — hợp đồng không nới ra ngoài
// đúng một trường được thêm.
func TestCommissionTestStillRejectsUnknownField(t *testing.T) {
	core := &commissionRecorderCore{remaining: 10}
	app, token := newTestAppWithRole(t, RoleOperator, core)
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/commissioning/points/DO-01/test", `{"value":true,"hold":true}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
}

/* Canh riêng cho hằng số mặc định: nó phải nằm trong khoảng có nghĩa.
 *
 * 0 nghĩa là giữ vô hạn — chính lỗi ISS-PIO-26 đang sửa. Quá dài (nhiều giờ)
 * thì "tự nhả" chỉ còn là chữ trong tài liệu: một buổi chạy thử bỏ dở lúc chiều
 * vẫn để van mở tới đêm. Trần Core là 86400 giây. */
func TestDefaultCommissionTestTTLIsBoundedAndNonZero(t *testing.T) {
	if defaultCommissionTestTTLS == 0 {
		t.Fatal("mặc định 0 nghĩa là giữ vô hạn — đúng lỗi ISS-PIO-26 đang sửa")
	}
	if defaultCommissionTestTTLS > 3600 {
		t.Fatalf("mặc định %d giây quá dài cho một lệnh chạy thử", defaultCommissionTestTTLS)
	}
	if defaultCommissionTestTTLS > maxOverrideTTLS {
		t.Fatalf("mặc định %d vượt trần Core %d", defaultCommissionTestTTLS, maxOverrideTTLS)
	}
}

/* Hai test dưới đây chạm vào CHÍNH `CoreClient.CommissionTestTTL`, không qua
 * core giả của handler.
 *
 * Cần thiết vì bộ test handler thay `CoreClient` bằng `commissionRecorderCore`,
 * nên mọi luật nằm trong core client thật — gửi `ttlS` xuống web_ipc, và không
 * bịa `expiresInS` khi Core im lặng — không có gì canh. Đã kiểm bằng cách tiêm
 * lỗi: sửa core client thành `expiresInS = ttlS` khi Core không báo thì bộ test
 * handler vẫn xanh; hai test này mới bắt được.
 */

// `ttlS` phải nằm trong chính lệnh web_ipc gửi xuống Core, kèm op/source mà
// `web_ipc.cpp` đòi để chấp nhận TTL (`is_write` + source `manual`).
func TestCoreClientCommissionTestSendsTTLDownToWebIPC(t *testing.T) {
	atomic.StoreUint64(&webCommandID, 700)
	path, cmdCh := fakeCoreSocket(t, `{"id":701,"result":"accepted","applied_value":1,"active_source":"manual","remaining_ttl_s":118}`)

	res, err := (&CoreClient{SockPath: path}).CommissionTestTTL(context.Background(), "DO-01", true, 120, "opu")
	if err != nil {
		t.Fatalf("CommissionTestTTL: %v", err)
	}
	cmd := readFakeCommand(t, cmdCh)
	if cmd["op"] != "write" || cmd["source"] != "manual" {
		t.Fatalf("lệnh = %#v; Core chỉ nhận ttlS cho op write nguồn manual", cmd)
	}
	if cmd["ttlS"] != float64(120) {
		t.Fatalf("ttlS trong lệnh web_ipc = %#v; muốn 120 — đánh rơi ở đây là output ép vĩnh viễn", cmd["ttlS"])
	}
	if cmd["user"] != "opu" {
		t.Fatalf("user = %#v; muốn opu", cmd["user"])
	}
	if res.TTLS == nil || *res.TTLS != 120 {
		t.Fatalf("ttlS phản hồi = %v; muốn 120", res.TTLS)
	}
	if res.ExpiresInS == nil || *res.ExpiresInS != 118 {
		t.Fatalf("expiresInS = %v; muốn 118 lấy nguyên từ remaining_ttl_s của Core", res.ExpiresInS)
	}
}

// Core nhận lệnh nhưng KHÔNG báo `remaining_ttl_s` ⇒ `expiresInS` phải vắng.
// Điền đại bằng `ttlS` sẽ vẽ ra một đồng hồ đếm ngược rất thuyết phục cho một
// thời hạn không ai cưỡng chế.
func TestCoreClientCommissionTestDoesNotFabricateRemaining(t *testing.T) {
	atomic.StoreUint64(&webCommandID, 800)
	path, _ := fakeCoreSocket(t, `{"id":801,"result":"accepted","applied_value":1,"active_source":"manual"}`)

	res, err := (&CoreClient{SockPath: path}).CommissionTestTTL(context.Background(), "DO-01", true, 120, "opu")
	if err != nil {
		t.Fatalf("CommissionTestTTL: %v", err)
	}
	if res.ExpiresInS != nil {
		t.Fatalf("expiresInS = %d; Core không báo remaining_ttl_s thì trường này phải vắng", *res.ExpiresInS)
	}
	if res.TTLS == nil || *res.TTLS != 120 {
		t.Fatalf("ttlS = %v; thời hạn ĐÃ YÊU CẦU vẫn phải có mặt", res.TTLS)
	}
}
