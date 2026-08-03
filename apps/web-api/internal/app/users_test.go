package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUsersCRUDAndPasswordFlow(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users", `{"username":"op1","role":"operator","password":"op123456"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/users", ``, adminToken)
	assertStatus(t, resp, http.StatusOK)
	var users []map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &users); err != nil {
		t.Fatalf("decode users: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("users len = %d; want 2", len(users))
	}
	for _, user := range users {
		if _, ok := user["pw_bcrypt"]; ok {
			t.Fatalf("list leaked pw_bcrypt: %+v", user)
		}
		if _, ok := user["password"]; ok {
			t.Fatalf("list leaked password: %+v", user)
		}
	}

	resp = serveAuth(t, handler, http.MethodPut, "/api/v1/users/op1", `{"role":"viewer"}`, adminToken)
	assertStatus(t, resp, http.StatusOK)

	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/users/op1/reset-password", `{"new_password":"op654321"}`, adminToken)
	assertStatus(t, resp, http.StatusOK)

	opToken := loginToken(t, handler, "op1", "op654321")
	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/me/change-password", `{"old_password":"wrong","new_password":"opabcdef"}`, opToken)
	assertStatus(t, resp, http.StatusUnauthorized)

	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/me/change-password", `{"old_password":"op654321","new_password":"opabcdef"}`, opToken)
	assertStatus(t, resp, http.StatusOK)
	_ = loginToken(t, handler, "op1", "opabcdef")

	resp = serveAuth(t, handler, http.MethodDelete, "/api/v1/users/op1", ``, adminToken)
	assertStatus(t, resp, http.StatusNoContent)
}

func TestUsersDeleteLastAdminReturnsConflict(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	resp := serveAuth(t, app.Router(), http.MethodDelete, "/api/v1/users/admin", ``, adminToken)
	assertStatus(t, resp, http.StatusConflict)

	if err := app.auth.DeleteUser("admin", "other-admin"); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("DeleteUser last admin err = %v; want ErrLastAdmin", err)
	}
}

// F-01: hạ quyền admin CUỐI CÙNG làm hệ thống còn 0 admin → mọi endpoint
// RoleAdmin (kể cả chính endpoint này) trả 403 cho tất cả mọi người, chỉ phục hồi
// được bằng cách sửa tay users.json trên thiết bị. DeleteUser đã chặn từ trước;
// SetRole thì chưa.
func TestUsersDemoteLastAdminReturnsConflictAndKeepsAdminAccess(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	resp := serveAuth(t, handler, http.MethodPut, "/api/v1/users/admin", `{"role":"viewer"}`, adminToken)
	assertStatus(t, resp, http.StatusConflict)

	if err := app.auth.SetRole("admin", RoleViewer); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("SetRole last admin -> viewer err = %v; want ErrLastAdmin", err)
	}

	// Quyền admin phải còn nguyên: đây là điều kiện để phục hồi được.
	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/users", ``, adminToken)
	assertStatus(t, resp, http.StatusOK)
}

// Guard chỉ được chặn khi thật sự MẤT admin cuối cùng — không được vạ lây.
func TestUsersDemoteAdminAllowedWhenAnotherAdminRemains(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()

	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users",
		`{"username":"admin2","role":"admin","password":"admin2pass"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)

	// Còn admin2 → hạ quyền admin là hợp lệ
	resp = serveAuth(t, handler, http.MethodPut, "/api/v1/users/admin", `{"role":"viewer"}`, adminToken)
	assertStatus(t, resp, http.StatusOK)

	// Nhưng giờ admin2 là admin cuối cùng → không hạ được nữa
	admin2Token := loginToken(t, handler, "admin2", "admin2pass")
	resp = serveAuth(t, handler, http.MethodPut, "/api/v1/users/admin2", `{"role":"operator"}`, admin2Token)
	assertStatus(t, resp, http.StatusConflict)
}

// Đặt lại role admin→admin (không đổi) không được rơi vào guard.
func TestUsersSetSameAdminRoleIsAllowed(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	if err := app.auth.SetRole("admin", RoleAdmin); err != nil {
		t.Fatalf("SetRole admin -> admin err = %v; want nil", err)
	}
}

func TestUsersChangePasswordOldWrongReturnsUnauthorized(t *testing.T) {
	app, adminToken := newTestAppWithAdmin(t)
	handler := app.Router()
	resp := serveAuth(t, handler, http.MethodPost, "/api/v1/users", `{"username":"op2","role":"operator","password":"op123456"}`, adminToken)
	assertStatus(t, resp, http.StatusCreated)
	opToken := loginToken(t, handler, "op2", "op123456")

	resp = serveAuth(t, handler, http.MethodPost, "/api/v1/me/change-password", `{"old_password":"bad","new_password":"opabcdef"}`, opToken)
	assertStatus(t, resp, http.StatusUnauthorized)
}

func serveAuth(t *testing.T, handler http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := newAuthRequest(method, path, body, token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func loginToken(t *testing.T, handler http.Handler, username, password string) string {
	t.Helper()
	body := `{"username":"` + username + `","password":"` + password + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	assertStatus(t, w, http.StatusOK)
	var resp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode login: %v", err)
	}
	if resp.Token == "" {
		t.Fatalf("empty token")
	}
	return resp.Token
}

func assertStatus(t *testing.T, resp *httptest.ResponseRecorder, want int) {
	t.Helper()
	if resp.Code != want {
		t.Fatalf("status = %d; want %d; body=%s", resp.Code, want, resp.Body.String())
	}
}
