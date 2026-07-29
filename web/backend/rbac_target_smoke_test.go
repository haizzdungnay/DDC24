package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRBACTargetSmokeFullAgainstRealRouter(t *testing.T) {
	usersConf := writeRBACE2EUsers(t)
	app, err := NewApp(testConfig(t, usersConf), log.New(&bytes.Buffer{}, "", 0), fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Close() })
	server := httptest.NewServer(app.Router())
	t.Cleanup(server.Close)

	credentials := rbacSmokeCredentials{
		Viewer:   rbacSmokeCredential{Username: "viewer", Password: rbacE2EPassword},
		Operator: rbacSmokeCredential{Username: "operator", Password: rbacE2EPassword},
		Engineer: rbacSmokeCredential{Username: "engineer", Password: rbacE2EPassword},
		Admin:    rbacSmokeCredential{Username: "admin", Password: rbacE2EPassword},
	}
	input, err := json.Marshal(credentials)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	err = runRBACTargetSmokeCommand([]string{
		"--base-url", server.URL,
		"--allow-http",
		"--credentials", "-",
		"--full",
		"--confirm", rbacSmokeMutationConfirmation,
	}, bytes.NewReader(input), &output)
	if err != nil {
		t.Fatal(err)
	}
	var result rbacSmokeResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Passed || result.Mode != "full" || result.CheckCount < 30 || result.CheckCount != len(result.Checks) {
		t.Fatalf("unexpected result: %+v", result)
	}
	for _, secret := range []string{rbacE2EPassword, `"username"`, "rbac-smoke-", "eyJ"} {
		if strings.Contains(output.String(), secret) {
			t.Fatalf("smoke evidence leaked credential material %q", secret)
		}
	}
	users := app.auth.ListUsers()
	if len(users) != 4 {
		t.Fatalf("temporary user was not removed: %+v", users)
	}
}

func TestRBACTargetSmokeReadOnlyLeavesUsersUnchanged(t *testing.T) {
	usersConf := writeRBACE2EUsers(t)
	app, err := NewApp(testConfig(t, usersConf), nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Close() })
	server := httptest.NewServer(app.Router())
	t.Cleanup(server.Close)

	input := `{"viewer":{"username":"viewer","password":"RbacTest123!"},"operator":{"username":"operator","password":"RbacTest123!"},"engineer":{"username":"engineer","password":"RbacTest123!"},"admin":{"username":"admin","password":"RbacTest123!"}}`
	var output bytes.Buffer
	if err := runRBACTargetSmokeCommand([]string{"--base-url", server.URL, "--allow-http", "--credentials", "-"}, strings.NewReader(input), &output); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), rbacE2EPassword) || len(app.auth.ListUsers()) != 4 {
		t.Fatal("read-only smoke leaked a secret or changed users")
	}
}

func TestRBACTargetSmokeCleansTemporaryUserAfterMidLifecycleFailure(t *testing.T) {
	usersConf := writeRBACE2EUsers(t)
	app, err := NewApp(testConfig(t, usersConf), log.New(&bytes.Buffer{}, "", 0), fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Close() })
	loginCount := 0
	router := app.Router()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/login" {
			loginCount++
			if loginCount == 5 {
				writeError(w, http.StatusInternalServerError, "injected smoke failure")
				return
			}
		}
		router.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)

	input := `{"viewer":{"username":"viewer","password":"RbacTest123!"},"operator":{"username":"operator","password":"RbacTest123!"},"engineer":{"username":"engineer","password":"RbacTest123!"},"admin":{"username":"admin","password":"RbacTest123!"}}`
	err = runRBACTargetSmokeCommand([]string{
		"--base-url", server.URL,
		"--allow-http",
		"--credentials", "-",
		"--full",
		"--confirm", rbacSmokeMutationConfirmation,
	}, strings.NewReader(input), &bytes.Buffer{})
	if err == nil {
		t.Fatal("injected lifecycle failure was accepted")
	}
	if users := app.auth.ListUsers(); len(users) != 4 {
		t.Fatalf("temporary user was not cleaned after failure: %+v", users)
	}
}

func TestRBACTargetSmokeRequiresHTTPAndMutationOptIn(t *testing.T) {
	input := `{"viewer":{"username":"viewer","password":"secret"},"operator":{"username":"operator","password":"secret"},"engineer":{"username":"engineer","password":"secret"},"admin":{"username":"admin","password":"secret"}}`
	for _, args := range [][]string{
		{"--base-url", "http://127.0.0.1:8081", "--credentials", "-"},
		{"--base-url", "http://127.0.0.1:8081", "--allow-http", "--credentials", "-", "--full"},
		{"--base-url", "http://controller.example", "--allow-http", "--credentials", "-"},
	} {
		if err := runRBACTargetSmokeCommand(args, strings.NewReader(input), &bytes.Buffer{}); err == nil {
			t.Fatalf("unsafe invocation accepted: %v", args)
		}
	}
}

func TestRBACTargetSmokeRejectsMalformedCredentialInputWithoutEcho(t *testing.T) {
	secret := "do-not-echo-this-password"
	err := runRBACTargetSmokeCommand(
		[]string{"--base-url", "https://controller.example", "--credentials", "-"},
		strings.NewReader(`{"viewer":{"username":"viewer","password":"`+secret+`"},"unexpected":true}`),
		&bytes.Buffer{},
	)
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Fatalf("malformed secret input was accepted or echoed: %v", err)
	}
}

func TestLoadRBACTargetSmokeCredentialsRequiresRegularPrivateFile(t *testing.T) {
	input := []byte(`{"viewer":{"username":"viewer","password":"secret"},"operator":{"username":"operator","password":"secret"},"engineer":{"username":"engineer","password":"secret"},"admin":{"username":"admin","password":"secret"}}`)
	dir := t.TempDir()
	path := filepath.Join(dir, "credentials.json")
	if err := os.WriteFile(path, input, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadRBACTargetSmokeCredentials(path, nil); err != nil {
		t.Fatalf("load private credential file: %v", err)
	}

	symlink := filepath.Join(dir, "credentials-link.json")
	if err := os.Symlink(path, symlink); err == nil {
		if _, err := loadRBACTargetSmokeCredentials(symlink, nil); err == nil {
			t.Fatal("credential symlink was accepted")
		}
	}

	if runtime.GOOS != "windows" {
		if err := os.Chmod(path, 0o640); err != nil {
			t.Fatal(err)
		}
		if _, err := loadRBACTargetSmokeCredentials(path, nil); err == nil {
			t.Fatal("group-readable credential file was accepted")
		}
	}
}
