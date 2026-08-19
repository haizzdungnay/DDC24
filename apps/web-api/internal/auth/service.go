package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
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
	// MustChangePassword — ADR-047 (`T57-3.17`). Bật khi admin đặt lại mật khẩu
	// cho người khác; tự tắt sau một lần đổi thành công. Cưỡng chế nằm ở
	// `Require`, KHÔNG ở giao diện: ẩn màn hình mà để endpoint mở thì `curl`
	// với cùng token vẫn đi thẳng.
	MustChangePassword bool `json:"must_change_password,omitempty"`
}

type UserDTO struct {
	Username           string `json:"username"`
	Role               Role   `json:"role"`
	MustChangePassword bool   `json:"mustChangePassword,omitempty"`
}

// SessionInfo — một phiên đang mở, dùng cho `T57-3.16`.
//
// Đăng nhập cấp JWT không trạng thái, nên danh sách này nằm trong BỘ NHỚ của
// tiến trình và mất khi `mkddc-web` khởi động lại. Giao diện phải nói ra giới
// hạn đó thay vì để người đọc tưởng đây là sổ phiên đầy đủ.
type SessionInfo struct {
	Username   string    `json:"username"`
	Role       Role      `json:"role"`
	IssuedAt   time.Time `json:"issuedAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	Remote     string    `json:"remote,omitempty"`
}

type sessionEntry struct {
	username   string
	role       Role
	issuedAt   time.Time
	expiresAt  time.Time
	lastSeenAt time.Time
	remote     string
}

type Config struct {
	JWTSecret  string
	UsersConf  string
	WriteFile  func(string, []byte, os.FileMode) error
	WriteError func(http.ResponseWriter, int, string)
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
	secret     []byte
	usersConf  string
	users      map[string]User
	revoked    map[string]time.Time
	sessions   map[string]sessionEntry
	mu         sync.Mutex
	audit      *AuditLogger
	writeFile  func(string, []byte, os.FileMode) error
	writeError func(http.ResponseWriter, int, string)
	now        func() time.Time
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
	if cfg.WriteFile == nil {
		return nil, errors.New("auth config writer is required")
	}
	if cfg.WriteError == nil {
		return nil, errors.New("auth error writer is required")
	}
	users, err := loadUsers(cfg.UsersConf)
	if err != nil {
		return nil, err
	}
	return &AuthService{
		secret:     []byte(cfg.JWTSecret),
		usersConf:  cfg.UsersConf,
		users:      users,
		revoked:    make(map[string]time.Time),
		sessions:   make(map[string]sessionEntry),
		audit:      audit,
		writeFile:  cfg.WriteFile,
		writeError: cfg.WriteError,
		now:        func() time.Time { return time.Now().UTC() },
	}, nil
}

func loadUsers(path string) (map[string]User, error) {
	data, err := os.ReadFile(path)
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
	// `T57-3.16`: ghi phiên vào sổ trong bộ nhớ ngay khi cấp token, để câu hỏi
	// "ai đang đăng nhập" trả lời được mà không cần đổi JWT thành có trạng thái.
	a.mu.Lock()
	a.sessions[token] = sessionEntry{
		username: user.Username, role: user.Role, issuedAt: now,
		expiresAt: now.Add(time.Hour), lastSeenAt: now, remote: remoteHost(remote),
	}
	a.pruneSessionsLocked(now)
	a.mu.Unlock()
	if a.audit != nil {
		a.audit.Login(username, string(user.Role), "accepted", remote)
	}
	return token, user.Role, nil
}

// MustChangePassword — ADR-047. Trả `false` cho tài khoản không tồn tại: câu hỏi
// "người này có phải đổi mật khẩu không" chỉ có nghĩa với tài khoản có thật.
func (a *AuthService) MustChangePassword(username string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.users[strings.TrimSpace(username)].MustChangePassword
}

// Sessions trả ảnh chụp các phiên còn hạn, mới nhất trước.
func (a *AuthService) Sessions() []SessionInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	a.pruneSessionsLocked(now)
	list := make([]SessionInfo, 0, len(a.sessions))
	for _, entry := range a.sessions {
		list = append(list, SessionInfo{
			Username: entry.username, Role: entry.role, IssuedAt: entry.issuedAt,
			LastSeenAt: entry.lastSeenAt, Remote: entry.remote,
		})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].LastSeenAt.Equal(list[j].LastSeenAt) {
			return list[i].Username < list[j].Username
		}
		return list[i].LastSeenAt.After(list[j].LastSeenAt)
	})
	return list
}

func (a *AuthService) pruneSessionsLocked(now time.Time) {
	for token, entry := range a.sessions {
		if !now.Before(entry.expiresAt) {
			delete(a.sessions, token)
		}
	}
}

// remoteHost bỏ cổng khỏi `host:port` và cắt độ dài. Cổng nguồn đổi mỗi kết nối
// nên giữ lại chỉ làm nhiễu, còn địa chỉ thì có ích khi soát phiên lạ.
func remoteHost(remote string) string {
	remote = strings.TrimSpace(remote)
	if remote == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	return SanitizeAudit(remote, 64)
}

func (a *AuthService) ListUsers() []UserDTO {
	a.mu.Lock()
	defer a.mu.Unlock()

	users := make([]UserDTO, 0, len(a.users))
	for _, user := range a.users {
		users = append(users, UserDTO{Username: user.Username, Role: user.Role, MustChangePassword: user.MustChangePassword})
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
	// ADR-047: mật khẩu do NGƯỜI KHÁC đặt luôn là mật khẩu tạm. Người sở hữu
	// tài khoản phải đổi trước khi làm được việc gì, nếu không thì mật khẩu
	// khởi tạo sẽ sống mãi trên thiết bị đã bàn giao.
	user.MustChangePassword = true
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
	user.MustChangePassword = false
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
	if err := a.writeFile(a.usersConf, data, 0o600); err != nil {
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
	a.touchSession(rawToken, claims, role)
	return &Principal{Username: claims.Subject, Role: role, Token: rawToken}, nil
}

// touchSession cập nhật "lần cuối còn thấy" và khôi phục phiên sau khi tiến
// trình khởi động lại: token vẫn hợp lệ về mặt chữ ký, nên phủ nhận sự tồn tại
// của phiên đó là nói sai — người dùng đang thao tác bình thường.
func (a *AuthService) touchSession(rawToken string, claims *jwtClaims, role Role) {
	now := a.now()
	expires := now.Add(time.Hour)
	if claims.ExpiresAt != nil {
		expires = claims.ExpiresAt.Time
	}
	issued := now
	if claims.IssuedAt != nil {
		issued = claims.IssuedAt.Time
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	entry, ok := a.sessions[rawToken]
	if !ok {
		entry = sessionEntry{username: claims.Subject, role: role, issuedAt: issued, expiresAt: expires}
	}
	entry.lastSeenAt = now
	a.sessions[rawToken] = entry
	a.pruneSessionsLocked(now)
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
	delete(a.sessions, rawToken)
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

// Đường duy nhất một phiên "phải đổi mật khẩu" còn đi được — ADR-047 điều 1.
//
// Danh sách ĐÓNG và nằm ở đúng một chỗ. Cưỡng chế rải rác trong từng handler là
// cách chắc chắn bỏ sót một endpoint, và endpoint bỏ sót đó chính là lỗ hổng.
var passwordChangeAllowed = map[string]bool{
	"/api/v1/me":                 true,
	"/api/v1/me/change-password": true,
	"/api/v1/auth/logout":        true,
	"/api/v1/health":             true,
}

func (a *AuthService) Require(min Role, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := BearerToken(r)
		principal, err := a.Validate(token)
		if err != nil {
			a.writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !RoleAllows(principal.Role, min) {
			a.writeError(w, http.StatusForbidden, "forbidden")
			return
		}
		if !passwordChangeAllowed[r.URL.Path] && a.MustChangePassword(principal.Username) {
			a.writeError(w, http.StatusForbidden, "password_change_required")
			return
		}
		ctx := context.WithValue(r.Context(), principalContextKey, principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func BearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
}

func PrincipalFromContext(ctx context.Context) *Principal {
	principal, _ := ctx.Value(principalContextKey).(*Principal)
	return principal
}

func ContextWithPrincipal(ctx context.Context, principal *Principal) context.Context {
	return context.WithValue(ctx, principalContextKey, principal)
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
