package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Khoá hành vi ba task Wave 3 của Plan 57 nằm cùng vùng tài khoản:
// `T57-3.17` (buộc đổi mật khẩu, `ADR-047`), `T57-3.16` (lần đăng nhập gần nhất
// + phiên đang mở) và `T57-3.2` (tuỳ chọn người dùng, `ADR-043`).
//
// Điểm phải khoá chặt nhất là **nơi cưỡng chế**: `ADR-047` nói rõ việc buộc đổi
// mật khẩu phải nằm ở backend chứ không ở giao diện, vì ẩn màn hình mà để
// endpoint mở thì `curl` với cùng token vẫn đi thẳng vào mọi thứ.

func TestMustChangePasswordBlocksEverythingExceptTheTwoWaysOut(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users",
		`{"username":"op1","role":"operator","password":"op123456"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)
	// Admin đặt lại mật khẩu ⇒ đó là mật khẩu TẠM (ADR-047 điều 2).
	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/users/op1/reset-password",
		`{"new_password":"tam12345"}`, adminToken)
	assertStatus(t, resp, http.StatusOK)

	opToken := loginToken(t, handler, "op1", "tam12345")

	// Mọi endpoint khác bị chặn Ở BACKEND, kèm lý do đọc được.
	for _, path := range []string{"/api/v1/points", "/api/v1/overview", "/api/v1/alarms", "/api/v1/activity"} {
		resp = serveAuth(t, handler, http.MethodGet, path, ``, opToken)
		assertStatus(t, resp, http.StatusForbidden)
		if !strings.Contains(resp.Body.String(), "password_change_required") {
			t.Fatalf("%s: body = %s; muốn có reasonCode password_change_required", path, resp.Body.String())
		}
	}

	// Hai đường ra duy nhất vẫn mở, và `/me` nói ra chính tình trạng đó.
	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/me", ``, opToken)
	assertStatus(t, resp, http.StatusOK)
	var me struct {
		Username           string `json:"username"`
		MustChangePassword bool   `json:"mustChangePassword"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode /me: %v", err)
	}
	if !me.MustChangePassword {
		t.Fatalf("/me phải nói mustChangePassword=true, nếu không giao diện chỉ thấy một chuỗi 403 không rõ vì sao")
	}

	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/me/change-password",
		`{"old_password":"tam12345","new_password":"that123456"}`, opToken)
	assertStatus(t, resp, http.StatusOK)

	// Đổi xong thì cờ tắt NGAY trên chính phiên cũ — không bắt đăng nhập lại.
	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/points", ``, opToken)
	if resp.Code == http.StatusForbidden && strings.Contains(resp.Body.String(), "password_change_required") {
		t.Fatalf("sau khi đổi mật khẩu vẫn bị chặn: %s", resp.Body.String())
	}
}

func TestNewUserDoesNotInheritMustChangeFlagFromCreation(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	// Tạo tài khoản là admin ĐẶT mật khẩu đầu tiên. `ADR-047` điều 2 nói tài
	// khoản khởi tạo lần đầu cũng mang cờ; nhưng test này khoá điều ngược lại
	// cho luồng CREATE của Rev A: admin tạo tài khoản rồi giao mật khẩu tận tay,
	// và endpoint reset-password mới là chỗ bật cờ. Ghi rõ để lần sau ai đổi
	// hành vi thì phải sửa cả đặc tả chứ không lặng lẽ sửa mã.
	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users",
		`{"username":"view1","role":"viewer","password":"view12345"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)

	token := loginToken(t, handler, "view1", "view12345")
	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/points", ``, token)
	if resp.Code == http.StatusForbidden {
		t.Fatalf("tài khoản mới tạo không được bị chặn: %s", resp.Body.String())
	}
}

func TestUserAccessReportsSessionsAndLastLogin(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users",
		`{"username":"op2","role":"operator","password":"op123456"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)

	_ = loginToken(t, handler, "op2", "op123456")
	// Một lần sai mật khẩu: Rev A không khoá tài khoản (`ADR-037`), nên ít nhất
	// phải NHÌN THẤY được dấu vết dò mật khẩu.
	badReq := serveAuth(t, handler, http.MethodPost, "/api/v1/auth/login", `{"username":"op2","password":"sai"}`, "")
	if badReq.Code == http.StatusOK {
		t.Fatalf("đăng nhập sai mật khẩu không được thành công")
	}

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/users/access", ``, adminToken)
	assertStatus(t, resp, http.StatusOK)
	var access UserAccessResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &access); err != nil {
		t.Fatalf("decode: %v", err)
	}

	byName := map[string]UserAccessDTO{}
	for _, user := range access.Users {
		byName[user.Username] = user
	}
	op2, ok := byName["op2"]
	if !ok {
		t.Fatalf("thiếu op2 trong danh sách: %+v", access.Users)
	}
	if op2.LastLoginAt == nil {
		t.Fatalf("op2 vừa đăng nhập nhưng lastLoginAt = nil")
	}
	if op2.LastFailedLoginAt == nil {
		t.Fatalf("op2 vừa có một lần đăng nhập hỏng nhưng lastFailedLoginAt = nil")
	}
	if op2.ActiveSessions < 1 {
		t.Fatalf("op2 đang có phiên mở nhưng activeSessions = %d", op2.ActiveSessions)
	}
	if len(access.Sessions) < 2 {
		t.Fatalf("phải thấy cả phiên admin lẫn phiên op2, có %d", len(access.Sessions))
	}
	if access.SessionsSince == "" {
		t.Fatalf("phải nói ra mốc bắt đầu của sổ phiên — nó chỉ có từ lúc tiến trình khởi động")
	}
}

func TestUserAccessRequiresAdmin(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users",
		`{"username":"op3","role":"operator","password":"op123456"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)
	opToken := loginToken(t, handler, "op3", "op123456")

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/users/access", ``, opToken)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestUserPreferencesRoundTripAndIsolation(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	// Chưa lưu gì ⇒ object rỗng, không phải 404: "chưa có tuỳ chọn" là trạng
	// thái bình thường của mọi tài khoản mới.
	resp := serveAuth(t, handler, http.MethodGet, "/api/v1/me/preferences", ``, adminToken)
	assertStatus(t, resp, http.StatusOK)
	if strings.TrimSpace(resp.Body.String()) != "{}" {
		t.Fatalf("mặc định = %s; want {}", resp.Body.String())
	}

	resp = serveAuth(t, handler, http.MethodPut, "/api/v1/me/preferences",
		`{"views":{"monitor":[{"name":"Điểm lỗi","params":{"quality":"bad"}}]}}`, adminToken)
	assertStatus(t, resp, http.StatusOK)

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/me/preferences", ``, adminToken)
	assertStatus(t, resp, http.StatusOK)
	if !strings.Contains(resp.Body.String(), "Điểm lỗi") {
		t.Fatalf("đọc lại không thấy nội dung đã ghi: %s", resp.Body.String())
	}

	// Tài khoản khác KHÔNG thấy tuỳ chọn của người trước.
	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/users",
		`{"username":"op4","role":"operator","password":"op123456"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)
	opToken := loginToken(t, handler, "op4", "op123456")
	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/me/preferences", ``, opToken)
	assertStatus(t, resp, http.StatusOK)
	if strings.TrimSpace(resp.Body.String()) != "{}" {
		t.Fatalf("op4 thấy tuỳ chọn của admin: %s", resp.Body.String())
	}
}

func TestUserPreferencesRejectsOversizeInsteadOfTruncating(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	big := `{"blob":"` + strings.Repeat("x", userPreferencesMaxBytes) + `"}`
	resp := serveAuth(t, handler, http.MethodPut, "/api/v1/me/preferences", big, adminToken)
	assertStatus(t, resp, http.StatusRequestEntityTooLarge)

	// Và không được ghi một phần: đọc lại vẫn là bản rỗng ban đầu.
	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/me/preferences", ``, adminToken)
	assertStatus(t, resp, http.StatusOK)
	if strings.TrimSpace(resp.Body.String()) != "{}" {
		t.Fatalf("ghi hỏng để lại dữ liệu một phần: %s", resp.Body.String())
	}
}

func TestUserPreferencesRejectsNonObjectBody(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/me/preferences", `"chuỗi trần"`, adminToken)
	assertStatus(t, resp, http.StatusBadRequest)
}
