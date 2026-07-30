package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func writeTestUsers(t *testing.T, password string, role Role) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	path := filepath.Join(t.TempDir(), "users.conf")
	body := map[string]any{
		"_schema_version": "1.0",
		"users": []map[string]string{{
			"username":  "admin",
			"role":      string(role),
			"pw_bcrypt": string(hash),
		}},
	}
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal users: %v", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write users: %v", err)
	}
	return path
}

func testConfig(t *testing.T, usersConf string) Config {
	t.Helper()
	return Config{
		Addr:         ":0",
		Port:         "0",
		JWTSecret:    "test-secret-that-is-long-enough",
		UsersConf:    usersConf,
		ConfigDir:    t.TempDir(),
		CorePidPath:  filepath.Join(t.TempDir(), "core.pid"),
		IobusPidPath: filepath.Join(t.TempDir(), "iobus.pid"),
		CoreSock:     "/tmp/missing.sock",

		WebVersion: webVersion,
	}
}

func TestAuthLoginJWTAndRBAC(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, users), nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}
	token, role, err := auth.Authenticate("admin", "admin123", "127.0.0.1")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if role != RoleAdmin || token == "" {
		t.Fatalf("role/token = %q/%q", role, token)
	}
	principal, err := auth.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if principal.Username != "admin" || principal.Role != RoleAdmin {
		t.Fatalf("principal = %+v", principal)
	}
	if !RoleAllows(RoleAdmin, RoleOperator) || RoleAllows(RoleViewer, RoleOperator) {
		t.Fatalf("RBAC order broken")
	}
	auth.Revoke(token)
	if _, err := auth.Validate(token); err == nil {
		t.Fatalf("revoked token accepted")
	}
}

// F-06: entry trong map revoked chỉ được xoá trong Validate() khi ĐÚNG token đó
// được trình lại sau khi đã hết hạn — điều gần như không bao giờ xảy ra vì client
// đã bỏ token. Không có prune định kỳ, nên một health-check login+logout mỗi 30
// giây chạy hàng tháng tích ~86k entry × ~200-300 byte JWT = hàng chục MB rò rỉ
// không thu hồi trên board RAM hạn chế.
func TestAuthRevokePrunesExpiredEntries(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, users), nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}

	// Mô phỏng lịch sử logout đã tích lại: token đã hết hạn từ lâu, client không
	// bao giờ trình lại nên Validate() không có cơ hội xoá.
	auth.mu.Lock()
	for i := 0; i < 500; i++ {
		auth.revoked["token-het-han-"+strconv.Itoa(i)] = time.Now().Add(-time.Hour)
	}
	auth.mu.Unlock()

	token, _, err := auth.Authenticate("admin", "admin123", "127.0.0.1")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	auth.Revoke(token)

	auth.mu.Lock()
	size := len(auth.revoked)
	_, freshKept := auth.revoked[token]
	auth.mu.Unlock()

	if size != 1 {
		t.Fatalf("len(revoked) = %d; want 1 (500 entry hết hạn phải bị prune)", size)
	}
	if !freshKept {
		t.Fatal("token vừa revoke bị prune mất — nó chưa hết hạn")
	}
	// Không được đánh đổi tính đúng đắn: token vừa revoke vẫn phải bị từ chối.
	if _, err := auth.Validate(token); err == nil {
		t.Fatal("token đã revoke vẫn được chấp nhận")
	}
}

func TestAuthRejectsBadPassword(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, users), nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}
	if _, _, err := auth.Authenticate("admin", "wrong", "127.0.0.1"); err == nil {
		t.Fatalf("bad password accepted")
	}
}

func TestLoginHandler(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	body := bytes.NewBufferString(`{"username":"admin","password":"admin123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["token"] == "" || resp["role"] != string(RoleAdmin) {
		t.Fatalf("response = %+v", resp)
	}
}

func TestStaticFallbackServesSPAAndLeavesAPINotFound(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	staticDir := t.TempDir()
	cfg.StaticDir = staticDir
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>mkddc app</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(staticDir, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staticDir, "assets", "app.js"), []byte("console.log('ok')"), 0o600); err != nil {
		t.Fatal(err)
	}
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	handler := app.Router()

	for _, route := range []string{"/", "/login", "/alarms"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, route, nil))
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "mkddc app") {
			t.Fatalf("%s status/body = %d/%q, want SPA index", route, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/assets/app.js", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "console.log") {
		t.Fatalf("asset status/body = %d/%q", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/missing", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("api missing status = %d, want 404", w.Code)
	}
}
