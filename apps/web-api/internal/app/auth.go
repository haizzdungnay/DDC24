package app

import (
	"context"
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
	RoleAdmin    Role = "admin"
)

type contextKey string

const principalContextKey contextKey = "principal"

type User struct {
	Username string `json:"username"`
	Role     Role   `json:"role"`
	Password string `json:"pw_bcrypt"`
}

type usersFile struct {
	SchemaVersion string `json:"_schema_version"`
	Users         []User `json:"users"`
}

type Principal struct {
	Username string
	Role     Role
	Token    string
}

type AuthService struct {
	secret    []byte
	usersConf string
	users     map[string]User
	revoked   map[string]time.Time
	mu        sync.Mutex
	audit     *AuditLogger
}

var (
	ErrUserExists         = errors.New("user exists")
	ErrUserNotFound       = errors.New("user not found")
	ErrInvalidUserInput   = errors.New("invalid user input")
	ErrInvalidPassword    = errors.New("invalid password")
	ErrInvalidOldPassword = errors.New("invalid old password")
	// Dùng cho CẢ xoá và hạ quyền admin cuối cùng (F-01), nên câu chữ không nói
	// riêng "delete". Đây là thông điệp trả về cho client qua writeUserError.
	ErrLastAdmin  = errors.New("cannot remove last admin")
	ErrSelfDelete = errors.New("cannot delete acting user")
)

type jwtClaims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func NewAuthService(cfg Config, audit *AuditLogger) (*AuthService, error) {
	users, err := loadUsers(cfg.UsersConf)
	if err != nil {
		return nil, err
	}
	return &AuthService{
		secret:    []byte(cfg.JWTSecret),
		usersConf: cfg.UsersConf,
		users:     users,
		revoked:   make(map[string]time.Time),
		audit:     audit,
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
	claims := jwtClaims{
		Role: string(user.Role),
		RegisteredClaims: jwt.RegisteredClaims{
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
	users[username] = User{Username: username, Role: role, Password: string(hash)}
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
	// F-01: hạ quyền admin cuối cùng làm hệ thống còn 0 admin. Từ lúc đó MỌI
	// endpoint RoleAdmin trả 403 cho tất cả mọi người — kể cả chính
	// PUT /api/v1/users/{username} dùng để phục hồi — nên chỉ còn cách sửa tay
	// users.json trên filesystem thiết bị. DeleteUser đã chặn trường hợp tương
	// đương từ trước; SetRole thì chưa.
	if user.Role == RoleAdmin && role != RoleAdmin && countAdmins(a.users) <= 1 {
		return ErrLastAdmin
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

	file := usersFile{SchemaVersion: "1.0", Users: make([]User, 0, len(names))}
	for _, username := range names {
		file.Users = append(file.Users, users[username])
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal users: %w", err)
	}
	data = append(data, '\n')
	if err := writeConfigFileAtomic(a.usersConf, data, 0o600); err != nil {
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
	a.mu.Lock()
	if exp, ok := a.revoked[rawToken]; ok {
		if time.Now().Before(exp) {
			a.mu.Unlock()
			return nil, errors.New("token revoked")
		}
		delete(a.revoked, rawToken)
	}
	a.mu.Unlock()

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
	if !validRole(role) || claims.Subject == "" {
		return nil, errors.New("invalid claims")
	}
	return &Principal{Username: claims.Subject, Role: role, Token: rawToken}, nil
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
	a.pruneRevokedLocked(time.Now())
	a.mu.Unlock()
}

// pruneRevokedLocked xoá mọi entry đã quá hạn khỏi map revoked. Gọi với a.mu đã giữ.
//
// F-06: entry chỉ được xoá trong Validate() khi ĐÚNG token đó được trình lại sau
// khi đã hết hạn — điều gần như không bao giờ xảy ra vì client đã bỏ token. Không
// có prune định kỳ, nên một script health-check login+logout mỗi 30 giây trên
// thiết bị nhúng chạy hàng tháng tích ~86k entry, mỗi entry giữ nguyên chuỗi JWT
// (~200-300 byte) → hàng chục MB rò rỉ không thu hồi trên board RAM hạn chế.
//
// Quét toàn map thay vì dùng goroutine prune riêng: map bị chặn trên bởi số lần
// logout trong một TTL (1 giờ), nên nó luôn nhỏ và phép quét là O(kích thước thực
// tế) — không cần thêm một goroutine vòng đời phải quản lý. Sau khi F-04 được sửa
// (FE thực sự gọi logout) thì đường này mới bắt đầu có lưu lượng thật.
func (a *AuthService) pruneRevokedLocked(now time.Time) {
	for token, exp := range a.revoked {
		if !now.Before(exp) {
			delete(a.revoked, token)
		}
	}
}

func (a *AuthService) Require(min Role, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		principal, err := a.Validate(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !RoleAllows(principal.Role, min) {
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

func RoleAllows(actual, required Role) bool {
	return roleRank(actual) >= roleRank(required)
}

func validRole(role Role) bool {
	return role == RoleViewer || role == RoleOperator || role == RoleAdmin
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

func roleRank(role Role) int {
	switch role {
	case RoleAdmin:
		return 3
	case RoleOperator:
		return 2
	case RoleViewer:
		return 1
	default:
		return 0
	}
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
