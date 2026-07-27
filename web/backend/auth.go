package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type Role string

const (
	RoleViewer   Role = "viewer"
	RoleOperator Role = "operator"
	RoleEngineer Role = "engineer"
	RoleAdmin    Role = "admin"
)

type Permission string

const (
	PermissionRead            Permission = "read"
	PermissionSelfManage      Permission = "self.manage"
	PermissionOperate         Permission = "operate"
	PermissionProgramEdit     Permission = "program.edit"
	PermissionProgramActivate Permission = "program.activate"
	PermissionSettingsManage  Permission = "settings.manage"
	PermissionDatabaseManage  Permission = "database.manage"
	PermissionUsersManage     Permission = "users.manage"
	PermissionSystemRelease   Permission = "system.release"
	usersSchemaVersion                   = "2.0"
)

type contextKey string

const principalContextKey contextKey = "principal"

type User struct {
	Username       string `json:"username"`
	Role           Role   `json:"role"`
	Password       string `json:"pw_bcrypt"`
	SessionVersion uint64 `json:"session_version"`
}

type usersFile struct {
	SchemaVersion string `json:"_schema_version"`
	Users         []User `json:"users"`
}

type Principal struct {
	Username       string
	Role           Role
	SessionVersion uint64
	Token          string
}

type AuthService struct {
	secret         []byte
	usersConf      string
	users          map[string]User
	revoked        map[string]time.Time
	mu             sync.Mutex
	audit          *AuditLogger
	writeUsersFile func(string, []byte, os.FileMode) error
}

var (
	ErrUserExists         = errors.New("user exists")
	ErrUserNotFound       = errors.New("user not found")
	ErrInvalidUserInput   = errors.New("invalid user input")
	ErrInvalidPassword    = errors.New("invalid password")
	ErrInvalidOldPassword = errors.New("invalid old password")
	ErrLastAdmin          = errors.New("cannot demote or delete last admin")
	ErrSelfDelete         = errors.New("cannot delete acting user")
	ErrSessionVersion     = errors.New("session version exhausted")
)

type jwtClaims struct {
	Role           string `json:"role"`
	SessionVersion uint64 `json:"session_version"`
	jwt.RegisteredClaims
}

func NewAuthService(cfg Config, audit *AuditLogger) (*AuthService, error) {
	users, err := loadUsers(cfg.UsersConf)
	if err != nil {
		return nil, err
	}
	return &AuthService{
		secret:         []byte(cfg.JWTSecret),
		usersConf:      cfg.UsersConf,
		users:          users,
		revoked:        make(map[string]time.Time),
		audit:          audit,
		writeUsersFile: writeConfigFileAtomic,
	}, nil
}

func loadUsers(path string) (map[string]User, error) {
	data, err := osReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("load users %s: %w", path, err)
	}
	var file usersFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("parse users %s: %w", path, err)
	}
	users := make(map[string]User, len(file.Users))
	for _, user := range file.Users {
		if user.Username == "" || user.Password == "" || !validRole(user.Role) {
			return nil, fmt.Errorf("invalid user entry %q", user.Username)
		}
		if user.SessionVersion == 0 {
			user.SessionVersion = 1
		}
		if _, exists := users[user.Username]; exists {
			return nil, fmt.Errorf("duplicate user entry %q", user.Username)
		}
		users[user.Username] = user
	}
	return users, nil
}

func (a *AuthService) Authenticate(username, password, remote string) (string, Role, error) {
	a.mu.Lock()
	user, ok := a.users[username]
	a.mu.Unlock()
	if !ok || bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)) != nil {
		if a.audit != nil {
			a.audit.Login(username, "-", "failed", remote)
		}
		return "", "", errors.New("invalid credentials")
	}
	now := time.Now().UTC()
	jwtID, err := newJWTID()
	if err != nil {
		return "", "", fmt.Errorf("generate jwt id: %w", err)
	}
	claims := jwtClaims{
		Role:           string(user.Role),
		SessionVersion: user.SessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jwtID,
			Subject:   user.Username,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.secret)
	if err != nil {
		return "", "", fmt.Errorf("sign jwt: %w", err)
	}
	if a.audit != nil {
		a.audit.Login(username, string(user.Role), "accepted", remote)
	}
	return token, user.Role, nil
}

func newJWTID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(id[:]), nil
}

func (a *AuthService) ListUsers() []UserDTO {
	a.mu.Lock()
	defer a.mu.Unlock()

	users := make([]UserDTO, 0, len(a.users))
	for _, user := range a.users {
		users = append(users, UserDTO{Username: user.Username, Role: user.Role})
	}
	sort.Slice(users, func(i, j int) bool {
		return users[i].Username < users[j].Username
	})
	return users
}

func (a *AuthService) AddUser(username string, role Role, password string) error {
	username = strings.TrimSpace(username)
	if !validUsername(username) || !validRole(role) {
		return ErrInvalidUserInput
	}
	if !validNewPassword(password) {
		return ErrInvalidPassword
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if _, exists := a.users[username]; exists {
		return ErrUserExists
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	users := cloneUsers(a.users)
	users[username] = User{Username: username, Role: role, Password: string(hash), SessionVersion: 1}
	return a.persistUsers(users)
}

func (a *AuthService) SetRole(username string, role Role) error {
	username = strings.TrimSpace(username)
	if !validUsername(username) || !validRole(role) {
		return ErrInvalidUserInput
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	user, exists := a.users[username]
	if !exists {
		return ErrUserNotFound
	}
	if user.Role == role {
		return nil
	}
	if user.Role == RoleAdmin && role != RoleAdmin && countAdmins(a.users) <= 1 {
		return ErrLastAdmin
	}
	if err := incrementSessionVersion(&user); err != nil {
		return err
	}
	users := cloneUsers(a.users)
	user.Role = role
	users[username] = user
	return a.persistUsers(users)
}

func (a *AuthService) DeleteUser(username, actingUser string) error {
	username = strings.TrimSpace(username)
	actingUser = strings.TrimSpace(actingUser)
	if !validUsername(username) || actingUser == "" {
		return ErrInvalidUserInput
	}
	if username == actingUser {
		return ErrSelfDelete
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	user, exists := a.users[username]
	if !exists {
		return ErrUserNotFound
	}
	if user.Role == RoleAdmin && countAdmins(a.users) <= 1 {
		return ErrLastAdmin
	}
	users := cloneUsers(a.users)
	delete(users, username)
	return a.persistUsers(users)
}

func (a *AuthService) SetPassword(username, newpw string) error {
	username = strings.TrimSpace(username)
	if !validUsername(username) {
		return ErrInvalidUserInput
	}
	if !validNewPassword(newpw) {
		return ErrInvalidPassword
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	user, exists := a.users[username]
	if !exists {
		return ErrUserNotFound
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newpw), 12)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := incrementSessionVersion(&user); err != nil {
		return err
	}
	users := cloneUsers(a.users)
	user.Password = string(hash)
	users[username] = user
	return a.persistUsers(users)
}

func (a *AuthService) ChangePassword(username, oldpw, newpw string) error {
	username = strings.TrimSpace(username)
	if !validUsername(username) {
		return ErrInvalidUserInput
	}
	if !validNewPassword(newpw) {
		return ErrInvalidPassword
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	user, exists := a.users[username]
	if !exists {
		return ErrUserNotFound
	}
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(oldpw)) != nil {
		return ErrInvalidOldPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newpw), 12)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := incrementSessionVersion(&user); err != nil {
		return err
	}
	users := cloneUsers(a.users)
	user.Password = string(hash)
	users[username] = user
	return a.persistUsers(users)
}

func (a *AuthService) persistUsers(users map[string]User) error {
	names := make([]string, 0, len(users))
	for username := range users {
		names = append(names, username)
	}
	sort.Strings(names)

	file := usersFile{SchemaVersion: usersSchemaVersion, Users: make([]User, 0, len(names))}
	for _, username := range names {
		file.Users = append(file.Users, users[username])
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal users: %w", err)
	}
	data = append(data, '\n')
	if err := a.writeUsersFile(a.usersConf, data, 0o600); err != nil {
		return err
	}
	reloaded, err := loadUsers(a.usersConf)
	if err != nil {
		return err
	}
	a.users = reloaded
	return nil
}

func (a *AuthService) Validate(rawToken string) (*Principal, error) {
	if rawToken == "" {
		return nil, errors.New("missing token")
	}

	claims := &jwtClaims{}
	token, err := jwt.ParseWithClaims(rawToken, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
		}
		return a.secret, nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("invalid token")
	}
	role := Role(claims.Role)
	if !validRole(role) || claims.Subject == "" || claims.SessionVersion == 0 {
		return nil, errors.New("invalid claims")
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if exp, ok := a.revoked[rawToken]; ok {
		if time.Now().Before(exp) {
			return nil, errors.New("token revoked")
		}
		delete(a.revoked, rawToken)
	}
	user, ok := a.users[claims.Subject]
	if !ok || user.Role != role || user.SessionVersion != claims.SessionVersion {
		return nil, errors.New("stale token")
	}
	return &Principal{
		Username:       claims.Subject,
		Role:           role,
		SessionVersion: claims.SessionVersion,
		Token:          rawToken,
	}, nil
}

func (a *AuthService) Revoke(rawToken string) {
	if rawToken == "" {
		return
	}
	claims := &jwtClaims{}
	_, _, _ = jwt.NewParser().ParseUnverified(rawToken, claims)
	exp := time.Now().Add(time.Hour)
	if claims.ExpiresAt != nil {
		exp = claims.ExpiresAt.Time
	}
	a.mu.Lock()
	a.revoked[rawToken] = exp
	a.mu.Unlock()
}

func (a *AuthService) RequirePermission(permission Permission, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		principal, err := a.Validate(token)
		if err != nil {
			if a.audit != nil {
				a.audit.Authorization(nil, permission, r.Method, r.URL.Path, "unauthenticated", r.RemoteAddr)
			}
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !principal.HasPermission(permission) {
			if a.audit != nil {
				a.audit.Authorization(principal, permission, r.Method, r.URL.Path, "denied", r.RemoteAddr)
			}
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}
		ctx := context.WithValue(r.Context(), principalContextKey, principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
}

func principalFromContext(ctx context.Context) *Principal {
	principal, _ := ctx.Value(principalContextKey).(*Principal)
	return principal
}

func (p *Principal) HasPermission(permission Permission) bool {
	return p != nil && RoleHasPermission(p.Role, permission)
}

func RoleHasPermission(role Role, permission Permission) bool {
	if !knownPermission(permission) {
		return false
	}
	switch role {
	case RoleViewer:
		return permission == PermissionRead || permission == PermissionSelfManage
	case RoleOperator:
		return permission == PermissionRead || permission == PermissionSelfManage ||
			permission == PermissionOperate || permission == PermissionProgramEdit
	case RoleEngineer:
		return permission == PermissionRead || permission == PermissionSelfManage ||
			permission == PermissionOperate || permission == PermissionProgramEdit ||
			permission == PermissionProgramActivate || permission == PermissionSettingsManage ||
			permission == PermissionSystemRelease
	case RoleAdmin:
		return true
	default:
		return false
	}
}

func knownPermission(permission Permission) bool {
	switch permission {
	case PermissionRead, PermissionSelfManage, PermissionOperate, PermissionProgramEdit,
		PermissionProgramActivate, PermissionSettingsManage, PermissionDatabaseManage,
		PermissionUsersManage, PermissionSystemRelease:
		return true
	default:
		return false
	}
}

func validRole(role Role) bool {
	return role == RoleViewer || role == RoleOperator || role == RoleEngineer || role == RoleAdmin
}

func validUsername(username string) bool {
	if len(username) < 3 {
		return false
	}
	for _, r := range username {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '.' || r == '-' || r == '@' {
			continue
		}
		return false
	}
	return true
}

func validNewPassword(password string) bool {
	return len(password) >= 6
}

func cloneUsers(users map[string]User) map[string]User {
	cloned := make(map[string]User, len(users))
	for username, user := range users {
		cloned[username] = user
	}
	return cloned
}

func countAdmins(users map[string]User) int {
	count := 0
	for _, user := range users {
		if user.Role == RoleAdmin {
			count++
		}
	}
	return count
}

func incrementSessionVersion(user *User) error {
	if user == nil || user.SessionVersion == ^uint64(0) {
		return ErrSessionVersion
	}
	user.SessionVersion++
	return nil
}

func osReadFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	token, role, err := a.auth.Authenticate(req.Username, req.Password, r.RemoteAddr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"role":       role,
		"expires_in": 3600,
	})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal != nil {
		a.auth.Revoke(principal.Token)
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "ok"})
}
