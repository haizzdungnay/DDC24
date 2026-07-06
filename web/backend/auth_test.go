package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func writeTestUsers(t *testing.T, password string, role Role) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
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
