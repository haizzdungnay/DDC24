package main

import (
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestLegacyUsersMigrateSessionVersionOnFirstWrite(t *testing.T) {
	path := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, path), nil)
	if err != nil {
		t.Fatal(err)
	}
	auth.mu.Lock()
	version := auth.users["admin"].SessionVersion
	auth.mu.Unlock()
	if version != 1 {
		t.Fatalf("legacy session version = %d; want 1", version)
	}
	if err := auth.AddUser("engineer", RoleEngineer, "engineer123"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var persisted usersFile
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.SchemaVersion != usersSchemaVersion {
		t.Fatalf("schema = %q; want %q", persisted.SchemaVersion, usersSchemaVersion)
	}
	for _, user := range persisted.Users {
		if user.SessionVersion != 1 {
			t.Fatalf("persisted user %+v has invalid session version", user)
		}
	}
}

func TestRolePasswordAndDeletionInvalidateAccountTokens(t *testing.T) {
	auth := newAuthServiceWithOperator(t)

	roleToken := authenticateToken(t, auth, "operator", "operator123")
	if err := auth.SetRole("operator", RoleEngineer); err != nil {
		t.Fatal(err)
	}
	assertTokenRejected(t, auth, roleToken)
	newRoleToken := authenticateToken(t, auth, "operator", "operator123")
	principal, err := auth.Validate(newRoleToken)
	if err != nil || principal.Role != RoleEngineer {
		t.Fatalf("principal=%+v err=%v", principal, err)
	}

	if err := auth.SetPassword("operator", "operator456"); err != nil {
		t.Fatal(err)
	}
	assertTokenRejected(t, auth, newRoleToken)
	passwordToken := authenticateToken(t, auth, "operator", "operator456")

	if err := auth.ChangePassword("operator", "operator456", "operator789"); err != nil {
		t.Fatal(err)
	}
	assertTokenRejected(t, auth, passwordToken)
	deleteToken := authenticateToken(t, auth, "operator", "operator789")
	if err := auth.DeleteUser("operator", "admin"); err != nil {
		t.Fatal(err)
	}
	assertTokenRejected(t, auth, deleteToken)
}

func TestStaleTokenRemainsInvalidAfterRestart(t *testing.T) {
	auth := newAuthServiceWithOperator(t)
	token := authenticateToken(t, auth, "operator", "operator123")
	if err := auth.SetPassword("operator", "operator456"); err != nil {
		t.Fatal(err)
	}

	restarted, err := NewAuthService(testConfig(t, auth.usersConf), nil)
	if err != nil {
		t.Fatal(err)
	}
	assertTokenRejected(t, restarted, token)
}

func TestPersistFailureDoesNotPublishSessionCandidate(t *testing.T) {
	auth := newAuthServiceWithOperator(t)
	token := authenticateToken(t, auth, "operator", "operator123")
	auth.writeUsersFile = func(string, []byte, os.FileMode) error {
		return errors.New("injected persistence failure")
	}
	if err := auth.SetPassword("operator", "operator456"); err == nil {
		t.Fatal("SetPassword succeeded despite persistence failure")
	}
	if _, err := auth.Validate(token); err != nil {
		t.Fatalf("old token was invalidated by uncommitted candidate: %v", err)
	}
	if _, _, err := auth.Authenticate("operator", "operator123", "test"); err != nil {
		t.Fatalf("old password was not retained: %v", err)
	}
}

func TestLastAdminDemotionAndConcurrentMutations(t *testing.T) {
	path := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, path), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.SetRole("admin", RoleEngineer); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("last admin demotion err = %v; want ErrLastAdmin", err)
	}
	if err := auth.AddUser("admin2", RoleAdmin, "admin456"); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, username := range []string{"admin", "admin2"} {
		wg.Add(1)
		go func(username string) {
			defer wg.Done()
			<-start
			results <- auth.SetRole(username, RoleViewer)
		}(username)
	}
	close(start)
	wg.Wait()
	close(results)

	accepted, rejected := 0, 0
	for err := range results {
		switch {
		case err == nil:
			accepted++
		case errors.Is(err, ErrLastAdmin):
			rejected++
		default:
			t.Fatalf("unexpected concurrent demotion error: %v", err)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("accepted/rejected = %d/%d; want 1/1", accepted, rejected)
	}
	auth.mu.Lock()
	admins := countAdmins(auth.users)
	auth.mu.Unlock()
	if admins != 1 {
		t.Fatalf("admin count = %d; want 1", admins)
	}
}

func TestConcurrentDemoteAndDeletePreservesLastAdmin(t *testing.T) {
	path := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, path), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.AddUser("admin2", RoleAdmin, "admin456"); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		results <- auth.SetRole("admin", RoleViewer)
	}()
	go func() {
		defer wg.Done()
		<-start
		results <- auth.DeleteUser("admin2", "external-admin")
	}()
	close(start)
	wg.Wait()
	close(results)

	accepted, rejected := 0, 0
	for err := range results {
		switch {
		case err == nil:
			accepted++
		case errors.Is(err, ErrLastAdmin):
			rejected++
		default:
			t.Fatalf("unexpected concurrent mutation error: %v", err)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("accepted/rejected = %d/%d; want 1/1", accepted, rejected)
	}
	auth.mu.Lock()
	admins := countAdmins(auth.users)
	auth.mu.Unlock()
	if admins != 1 {
		t.Fatalf("admin count = %d; want 1", admins)
	}
}

func TestJWTWithoutSessionVersionIsRejected(t *testing.T) {
	path := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, path), nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	claims := jwtClaims{
		Role: string(RoleAdmin),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: "admin", IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(auth.secret)
	if err != nil {
		t.Fatal(err)
	}
	assertTokenRejected(t, auth, token)
}

func newAuthServiceWithOperator(t *testing.T) *AuthService {
	t.Helper()
	path := writeTestUsers(t, "admin123", RoleAdmin)
	auth, err := NewAuthService(testConfig(t, path), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.AddUser("operator", RoleOperator, "operator123"); err != nil {
		t.Fatal(err)
	}
	return auth
}

func authenticateToken(t *testing.T, auth *AuthService, username, password string) string {
	t.Helper()
	token, _, err := auth.Authenticate(username, password, "test")
	if err != nil {
		t.Fatalf("Authenticate(%q): %v", username, err)
	}
	return token
}

func assertTokenRejected(t *testing.T, auth *AuthService, token string) {
	t.Helper()
	if _, err := auth.Validate(token); err == nil {
		t.Fatal("stale token was accepted")
	}
}
