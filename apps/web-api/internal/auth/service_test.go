package auth

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func newTestService(t *testing.T) *AuthService {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	path := filepath.Join(t.TempDir(), "users.conf")
	data, err := json.Marshal(usersFile{
		SchemaVersion: "1.0",
		Users:         []User{{Username: "admin", Role: RoleAdmin, Password: string(hash)}},
	})
	if err != nil {
		t.Fatalf("marshal users: %v", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write users: %v", err)
	}
	service, err := NewAuthService(Config{
		JWTSecret: "test-secret-that-is-long-enough",
		UsersConf: path,
		WriteFile: os.WriteFile,
		WriteError: func(w http.ResponseWriter, status int, message string) {
			http.Error(w, message, status)
		},
	}, nil)
	if err != nil {
		t.Fatalf("NewAuthService: %v", err)
	}
	return service
}

// F-06: xác nhận bounded context auth tự dọn token thu hồi đã hết hạn.
func TestRevokePrunesExpiredEntries(t *testing.T) {
	auth := newTestService(t)
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
	if size != 1 || !freshKept {
		t.Fatalf("revoked size/fresh = %d/%v, want 1/true", size, freshKept)
	}
	if _, err := auth.Validate(token); err == nil {
		t.Fatal("token đã revoke vẫn được chấp nhận")
	}
}

func TestRoleAllows(t *testing.T) {
	if !RoleAllows(RoleAdmin, RoleOperator) || RoleAllows(RoleViewer, RoleOperator) {
		t.Fatal("thứ tự RBAC không đúng")
	}
}
