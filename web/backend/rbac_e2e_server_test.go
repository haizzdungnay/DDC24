package main

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

const rbacE2EPassword = "RbacTest123!"

// TestRBACE2EServer is a process harness for Playwright. Normal Go test runs skip it.
func TestRBACE2EServer(t *testing.T) {
	if os.Getenv("RBAC_E2E_SERVER") != "1" {
		t.Skip("set RBAC_E2E_SERVER=1 to run the isolated HTTP harness")
	}

	usersConf := writeRBACE2EUsers(t)
	cfg := testConfig(t, usersConf)
	cfg.CORSOrigin = getenv("RBAC_E2E_CORS_ORIGIN", "http://127.0.0.1:4174")
	app, err := NewApp(cfg, log.New(os.Stdout, "rbac-e2e ", log.LstdFlags|log.LUTC), fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	t.Cleanup(func() { _ = app.Close() })

	listener, err := net.Listen("tcp", getenv("RBAC_E2E_ADDR", "127.0.0.1:4175"))
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	appHandler := app.Router()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/__rbac_e2e/ready" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		appHandler.ServeHTTP(w, r)
	})
	t.Logf("isolated RBAC E2E backend listening on %s", listener.Addr())
	if err := http.Serve(listener, handler); err != nil && !errors.Is(err, net.ErrClosed) {
		t.Fatalf("serve: %v", err)
	}
}

func writeRBACE2EUsers(t *testing.T) string {
	t.Helper()
	users := make([]User, 0, 4)
	for _, role := range []Role{RoleAdmin, RoleEngineer, RoleOperator, RoleViewer} {
		hash, err := bcrypt.GenerateFromPassword([]byte(rbacE2EPassword), bcrypt.MinCost)
		if err != nil {
			t.Fatalf("hash %s fixture password: %v", role, err)
		}
		users = append(users, User{
			Username:       string(role),
			Role:           role,
			Password:       string(hash),
			SessionVersion: 1,
		})
	}
	data, err := json.MarshalIndent(usersFile{SchemaVersion: usersSchemaVersion, Users: users}, "", "  ")
	if err != nil {
		t.Fatalf("marshal users fixture: %v", err)
	}
	path := filepath.Join(t.TempDir(), "users.conf")
	if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
		t.Fatalf("write users fixture: %v", err)
	}
	return path
}
