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
	RoleEngineer Role = "engineer"
	RoleAdmin    Role = "admin"
)

/*
Permission — QUYỀN theo NĂNG LỰC, không theo thứ bậc (`WEB-RBAC-001`, port từ
PR #67 sang layout `apps/`).

VÌ SAO KHÔNG CHỈ THÊM MỘT BẬC VAI

Trước lát này, uỷ quyền chỉ có `Require(min Role)` với thứ hạng tuyến tính. Khai
báo đó nói "ai đủ lớn", trong khi thứ một route thật sự cần là "việc gì". Hai
câu đó trùng nhau cho tới đúng lúc chúng tách ra: sửa người dùng và sửa cấu hình
mạng cùng đòi `admin` chỉ vì cả hai đều "cao nhất", nên không thể mở cấu hình
mạng cho kỹ sư vận hành mà không mở luôn cả quyền tạo tài khoản.

Vai `engineer` sinh ra đúng ở khe đó: cấu hình được thiết bị và đưa chương trình
vào vận hành, nhưng KHÔNG quản lý được tài khoản hay cơ sở dữ liệu.

Thứ hạng tuyến tính vẫn giữ (`roleRank`) cho `Require(min Role)` cũ — 109 route
đang dùng nó, và đổi một lần tất cả là cách chắc chắn nhất để sót một route.
*/
type Permission string

const (
	/* Đọc read-model. Mọi vai đăng nhập đều có. */
	PermissionRead Permission = "read"
	/* Tự đổi mật khẩu của CHÍNH mình — khác hẳn `users.manage`. */
	PermissionSelfManage Permission = "self.manage"
	/* Thao tác vận hành trên thiết bị đang chạy: ack cảnh báo, ghi điểm, bật/tắt
	   lịch. Không đổi cấu hình. */
	PermissionOperate Permission = "operate"
	/* Sửa Draft chương trình. Draft chưa có hiệu lực trên thiết bị. */
	PermissionProgramEdit Permission = "program.edit"
	/* Đưa chương trình vào vận hành / khôi phục / reset RETAIN — đây là lúc
	   chương trình BẮT ĐẦU điều khiển thiết bị thật. */
	PermissionProgramActivate Permission = "program.activate"
	/* Cấu hình thiết bị: mạng, điểm, Modbus, BACnet, safe-state, lịch, cảnh báo. */
	PermissionSettingsManage Permission = "settings.manage"
	/* Cơ sở dữ liệu/sao lưu. Riêng admin: nó chạm tới toàn bộ dữ liệu lịch sử. */
	PermissionDatabaseManage Permission = "database.manage"
	/* Tạo/xoá/đổi vai tài khoản. Riêng admin: đây là quyền tự nhân bản quyền. */
	PermissionUsersManage Permission = "users.manage"
	/* Thao tác mức hệ thống có ảnh hưởng ra ngoài phiên: nâng cấp, khởi động lại. */
	PermissionSystemRelease Permission = "system.release"
	/* Điều khiển phiên mô phỏng R3 (`ADR-053`). Tách khỏi `program.edit` vì mô
	   phỏng KHÔNG phải một phép sửa Draft: nó sinh ra một tiến trình worker có
	   hạn ngạch bộ nhớ/CPU trên chính tủ điều khiển. Ranh giới admin-only là do
	   `ADR-053` đặt, không phải do lát RBAC này chọn. */
	PermissionSimulationRun Permission = "simulation.run"
)

/*
Ma trận vai → quyền.

	                    viewer  operator  engineer  admin
	read                  ✓        ✓         ✓        ✓
	self.manage           ✓        ✓         ✓        ✓
	operate                        ✓         ✓        ✓
	program.edit                             ✓        ✓
	program.activate                         ✓        ✓
	settings.manage                          ✓        ✓
	system.release                           ✓        ✓
	database.manage                                   ✓
	users.manage                                      ✓
	simulation.run                                    ✓

Viết bằng `switch` tường minh chứ không bằng phép so thứ hạng: ma trận này KHÔNG
buộc phải tuyến tính mãi mãi, và một ngày nào đó thêm một vai chỉ-đọc-nhật-ký
thì phép so thứ hạng sẽ phải bị gỡ bỏ ở khắp nơi.

MỘT CHỖ CỐ Ý KHÁC BẢN GỐC (PR #67): ở đó `operator` có `program.edit`. Bản này
KHÔNG cho. Lý do là một phép đo chứ không phải khẩu vị: `TestLibraryRoutesRBAC`
đang khẳng định operator nhận 403 khi ghi Control Library, tức hôm nay operator
KHÔNG có quyền đó. Thêm một vai mới không được là dịp nới quyền cho vai đang có
— đó là một quyết định sản phẩm riêng, phải đi kèm lý do riêng. Bất biến của lát
này: **không vai nào đang tồn tại được thêm một quyền nào.**

Quyền lạ (không nằm trong bảng) luôn bị TỪ CHỐI, kể cả với admin: một route khai
sai tên quyền phải hỏng ở lúc gọi, không được im lặng mở cho vai cao nhất.
*/
func RoleHasPermission(role Role, permission Permission) bool {
	if !knownPermission(permission) {
		return false
	}
	switch role {
	case RoleViewer:
		return permission == PermissionRead || permission == PermissionSelfManage
	case RoleOperator:
		switch permission {
		case PermissionRead, PermissionSelfManage, PermissionOperate:
			return true
		}
		return false
	case RoleEngineer:
		switch permission {
		case PermissionRead, PermissionSelfManage, PermissionOperate, PermissionProgramEdit,
			PermissionProgramActivate, PermissionSettingsManage, PermissionSystemRelease:
			return true
		}
		return false
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
		PermissionUsersManage, PermissionSystemRelease, PermissionSimulationRun:
		return true
	default:
		return false
	}
}

/* Mọi quyền đã khai — dùng cho test ma trận và cho endpoint tự mô tả năng lực. */
func AllPermissions() []Permission {
	return []Permission{
		PermissionRead, PermissionSelfManage, PermissionOperate, PermissionProgramEdit,
		PermissionProgramActivate, PermissionSettingsManage, PermissionDatabaseManage,
		PermissionUsersManage, PermissionSystemRelease, PermissionSimulationRun,
	}
}

/*
Các vai có một quyền, theo thứ tự ổn định.

Tồn tại để một bề mặt công bố năng lực (ví dụ `SimulationCapability.mutationRoles`
mà FE đọc để bật/tắt thanh điều khiển) DẪN XUẤT từ ma trận thay vì chép tay danh
sách vai. Chép tay là cách một ngày nào đó FE hiện nút cho một vai mà server từ
chối — người dùng bấm được, rồi nhận 403.
*/
func RolesWithPermission(permission Permission) []Role {
	granted := make([]Role, 0, len(AllRoles()))
	for _, role := range AllRoles() {
		if RoleHasPermission(role, permission) {
			granted = append(granted, role)
		}
	}
	return granted
}

/* Mọi vai đã khai, theo thứ tự quyền tăng dần. */
func AllRoles() []Role {
	return []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin}
}

/* Quyền của một vai, theo thứ tự ổn định — để giao diện liệt kê được. */
func PermissionsForRole(role Role) []Permission {
	granted := make([]Permission, 0, len(AllPermissions()))
	for _, permission := range AllPermissions() {
		if RoleHasPermission(role, permission) {
			granted = append(granted, permission)
		}
	}
	return granted
}

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

	/*
	   `WEB-RBAC-002` — VAI PHẢI KHỚP SỔ NGƯỜI DÙNG HIỆN TẠI.

	   TRIỆU CHỨNG (lỗ hổng có thật trước lát này): hạ một tài khoản từ `admin`
	   xuống `viewer` KHÔNG chạm được tới token đã cấp. Token tự mang vai trong
	   claim và `Validate` tin claim đó, nên người vừa bị hạ quyền vẫn thao tác
	   như admin cho tới khi token hết hạn — tối đa một giờ. Xoá tài khoản cũng
	   vậy: token của người đã bị xoá vẫn đi qua.

	   Sổ người dùng là nguồn sự thật, claim chỉ là bản chụp lúc đăng nhập. Lệch
	   nhau ⇒ TỪ CHỐI, không phải "lấy cái thấp hơn": một token nói sai về chính
	   chủ của nó là token phải bị vứt, và người dùng đăng nhập lại là xong.
	*/
	a.mu.Lock()
	current, known := a.users[claims.Subject]
	a.mu.Unlock()
	if !known {
		return nil, errors.New("account no longer exists")
	}
	if current.Role != role {
		return nil, errors.New("role changed; token no longer valid")
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

/* Principal có quyền này không. `nil` KHÔNG bao giờ có quyền — một principal
 * chưa phân giải được là chưa xác thực, không phải "vai mặc định". */
func (p *Principal) HasPermission(permission Permission) bool {
	return p != nil && RoleHasPermission(p.Role, permission)
}

/*
`RequirePermission` — uỷ quyền theo NĂNG LỰC.

Khác `Require(min Role)` ở chỗ route khai *việc nó làm* thay vì *vai nào đủ
lớn*. Nhờ vậy mở một route cho `engineer` là sửa đúng một dòng ở chính route đó,
không phải hạ ngưỡng vai và kéo theo mọi route khác cùng ngưỡng.

Luật `password_change_required` giữ nguyên: nó là cổng ĐỘC LẬP với quyền — một
người có đủ quyền nhưng đang nợ đổi mật khẩu thì vẫn bị chặn.
*/
func (a *AuthService) RequirePermission(permission Permission, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := BearerToken(r)
		principal, err := a.Validate(token)
		if err != nil {
			a.writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !principal.HasPermission(permission) {
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

/*
Thứ hạng tuyến tính, GIỮ LẠI cho `Require(min Role)` cũ.

`engineer` chèn vào GIỮA `operator` và `admin`, nên mọi route đang đòi `admin`
vẫn đòi đúng `admin` — thêm một vai KHÔNG được nới lỏng bất cứ route nào đang
có. Việc mở route cho `engineer` là quyết định TỪNG ROUTE, đi qua
`RequirePermission`, không phải hệ quả phụ của việc chèn một bậc.
*/
func roleRank(role Role) int {
	switch role {
	case RoleAdmin:
		return 4
	case RoleEngineer:
		return 3
	case RoleOperator:
		return 2
	case RoleViewer:
		return 1
	default:
		return 0
	}
}
