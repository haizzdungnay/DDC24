package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestRBACSmokeUsersProvisionRunFullSmokeAndCleanupPreservesExactStore(t *testing.T) {
	usersPath, original := writeRBACSmokeBaseUsers(t)
	dir := filepath.Dir(usersPath)
	credentialsPath := filepath.Join(dir, "rbac-smoke-credentials.json")
	statePath := filepath.Join(dir, "rbac-smoke-state.json")

	result, err := provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, bcrypt.MinCost, writeConfigFileAtomicStrict)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	if result.Action != "provisioned" || result.UserCount != 6 {
		t.Fatalf("unexpected provision result: %+v", result)
	}
	for _, path := range []string{credentialsPath, statePath} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode = %o", filepath.Base(path), info.Mode().Perm())
		}
	}
	credentials, err := loadRBACTargetSmokeCredentials(credentialsPath, nil)
	if err != nil {
		t.Fatal(err)
	}

	app, err := NewApp(testConfig(t, usersPath), log.New(&bytes.Buffer{}, "", 0), fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Router())
	var smokeOutput bytes.Buffer
	err = runRBACTargetSmokeCommand([]string{
		"--base-url", server.URL,
		"--allow-http",
		"--credentials", credentialsPath,
		"--full",
		"--confirm", rbacSmokeMutationConfirmation,
	}, nil, &smokeOutput)
	server.Close()
	app.Close()
	if err != nil {
		t.Fatalf("target smoke: %v", err)
	}
	for _, role := range []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin} {
		credential := credentials.forRole(role)
		if bytes.Contains(smokeOutput.Bytes(), []byte(credential.Username)) || bytes.Contains(smokeOutput.Bytes(), []byte(credential.Password)) {
			t.Fatalf("smoke output leaked %s credential", role)
		}
	}

	presencePath := filepath.Join(dir, "mkddc-web.running")
	if err := os.WriteFile(presencePath, []byte("test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	beforeBlockedCleanup, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cleanupRBACSmokeUsers(usersPath, credentialsPath, statePath); err == nil || !strings.Contains(err.Error(), "stop mkddc-web") {
		t.Fatalf("expected running-service cleanup rejection, got %v", err)
	}
	afterBlockedCleanup, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(beforeBlockedCleanup, afterBlockedCleanup) {
		t.Fatal("running-service rejection changed users file")
	}
	if err := os.Remove(presencePath); err != nil {
		t.Fatal(err)
	}

	cleanup, err := cleanupRBACSmokeUsers(usersPath, credentialsPath, statePath)
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if cleanup.Action != "cleaned" || cleanup.UserCount != 2 {
		t.Fatalf("unexpected cleanup result: %+v", cleanup)
	}
	restored, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, original) {
		t.Fatal("cleanup did not exactly restore the pre-provision users file")
	}
	for _, path := range []string{credentialsPath, statePath} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("private artifact remains at %s: %v", path, err)
		}
	}
}

func TestRBACSmokeUsersProvisionRestoresOriginalOnPublishFailure(t *testing.T) {
	usersPath, original := writeRBACSmokeBaseUsers(t)
	dir := filepath.Dir(usersPath)
	credentialsPath := filepath.Join(dir, "credentials.json")
	statePath := filepath.Join(dir, "state.json")
	injected := errors.New("injected publish failure")
	publish := func(path string, data []byte, perm os.FileMode) error {
		if err := writeConfigFileAtomicStrict(path, data, perm); err != nil {
			return err
		}
		return injected
	}

	if _, err := provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, bcrypt.MinCost, publish); !errors.Is(err, injected) {
		t.Fatalf("expected injected failure, got %v", err)
	}
	restored, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, original) {
		t.Fatal("provision failure did not restore exact original users file")
	}
	for _, path := range []string{credentialsPath, statePath} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("failed provision left artifact %s: %v", path, err)
		}
	}
}

func TestRBACSmokeUsersCleanupRefusesChangedOwnedAccountWithoutPartialDelete(t *testing.T) {
	usersPath, _ := writeRBACSmokeBaseUsers(t)
	dir := filepath.Dir(usersPath)
	credentialsPath := filepath.Join(dir, "credentials.json")
	statePath := filepath.Join(dir, "state.json")
	if _, err := provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, bcrypt.MinCost, writeConfigFileAtomicStrict); err != nil {
		t.Fatal(err)
	}
	state, err := loadRBACSmokeProvisionState(statePath)
	if err != nil {
		t.Fatal(err)
	}
	_, users, err := readCanonicalRBACUsers(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	tampered := users[state.Accounts[0].Username]
	tampered.Role = RoleEngineer
	users[tampered.Username] = tampered
	tamperedData, err := marshalCanonicalUsers(users)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeConfigFileAtomicStrict(usersPath, tamperedData, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := cleanupRBACSmokeUsers(usersPath, credentialsPath, statePath); err == nil || !strings.Contains(err.Error(), "cleanup refused") {
		t.Fatalf("expected ownership rejection, got %v", err)
	}
	after, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, tamperedData) {
		t.Fatal("failed cleanup partially modified users file")
	}
	for _, account := range state.Accounts {
		if _, exists := users[account.Username]; !exists {
			t.Fatalf("owned account %s missing after refused cleanup", account.Role)
		}
	}
}

func TestRBACSmokeUsersCleanupRestoresProvisionedStoreOnPublishFailure(t *testing.T) {
	usersPath, _ := writeRBACSmokeBaseUsers(t)
	dir := filepath.Dir(usersPath)
	credentialsPath := filepath.Join(dir, "credentials.json")
	statePath := filepath.Join(dir, "state.json")
	if _, err := provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, bcrypt.MinCost, writeConfigFileAtomicStrict); err != nil {
		t.Fatal(err)
	}
	provisioned, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	injected := errors.New("injected cleanup failure")
	publish := func(path string, data []byte, perm os.FileMode) error {
		if err := writeConfigFileAtomicStrict(path, data, perm); err != nil {
			return err
		}
		return injected
	}
	if _, err := cleanupRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, publish); !errors.Is(err, injected) {
		t.Fatalf("expected injected failure, got %v", err)
	}
	after, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, provisioned) {
		t.Fatal("cleanup failure did not restore exact provisioned store")
	}
	for _, path := range []string{credentialsPath, statePath} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("cleanup failure removed retry artifact %s: %v", path, err)
		}
	}
}

func TestRBACSmokeUsersRequiresMigratedCanonicalStoreAndStoppedService(t *testing.T) {
	dir := t.TempDir()
	usersPath := filepath.Join(dir, "users.conf")
	credentialsPath := filepath.Join(dir, "credentials.json")
	statePath := filepath.Join(dir, "state.json")
	if err := os.WriteFile(usersPath, legacyRBACUsersFixture(t), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, bcrypt.MinCost, writeConfigFileAtomicStrict); err == nil || !strings.Contains(err.Error(), "run rbac-users-migrate first") {
		t.Fatalf("expected schema migration rejection, got %v", err)
	}

	usersPath, _ = writeRBACSmokeBaseUsersInDir(t, dir)
	presencePath := filepath.Join(dir, "mkddc-web.running")
	if err := os.WriteFile(presencePath, []byte("test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, bcrypt.MinCost, writeConfigFileAtomicStrict); err == nil || !strings.Contains(err.Error(), "stop mkddc-web") {
		t.Fatalf("expected stopped-service rejection, got %v", err)
	}
	for _, path := range []string{credentialsPath, statePath} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("preflight rejection created %s: %v", path, err)
		}
	}
}

func TestRBACSmokeUsersCommandsRequireExactConfirmation(t *testing.T) {
	for name, run := range map[string]func() error{
		"provision": func() error {
			return runRBACSmokeUsersProvisionCommand([]string{"--users", "users", "--credentials", "credentials", "--state", "state", "--confirm", "wrong"}, &bytes.Buffer{})
		},
		"cleanup": func() error {
			return runRBACSmokeUsersCleanupCommand([]string{"--users", "users", "--credentials", "credentials", "--state", "state", "--confirm", "wrong"}, &bytes.Buffer{})
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := run(); err == nil || !strings.Contains(err.Error(), "--confirm") {
				t.Fatalf("expected exact confirmation rejection, got %v", err)
			}
		})
	}
}

func writeRBACSmokeBaseUsers(t *testing.T) (string, []byte) {
	t.Helper()
	return writeRBACSmokeBaseUsersInDir(t, t.TempDir())
}

func writeRBACSmokeBaseUsersInDir(t *testing.T, dir string) (string, []byte) {
	t.Helper()
	adminHash, err := bcrypt.GenerateFromPassword([]byte("OriginalAdminPassword!"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	viewerHash, err := bcrypt.GenerateFromPassword([]byte("OriginalViewerPassword!"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	users := map[string]User{
		"original_admin":  {Username: "original_admin", Role: RoleAdmin, Password: string(adminHash), SessionVersion: 7},
		"original_viewer": {Username: "original_viewer", Role: RoleViewer, Password: string(viewerHash), SessionVersion: 11},
	}
	data, err := marshalCanonicalUsers(users)
	if err != nil {
		t.Fatal(err)
	}
	usersPath := filepath.Join(dir, "users.conf")
	if err := os.WriteFile(usersPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	var decoded usersFile
	if err := json.Unmarshal(data, &decoded); err != nil || len(decoded.Users) != 2 {
		t.Fatalf("invalid smoke base fixture: %v", err)
	}
	return usersPath, data
}
