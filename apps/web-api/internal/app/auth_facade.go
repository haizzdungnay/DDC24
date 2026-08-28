package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	webAuth "mkddc-web/internal/auth"
)

type Role = webAuth.Role
type Principal = webAuth.Principal
type AuthService = webAuth.AuthService
type AuditLogger = webAuth.AuditLogger
type UserDTO = webAuth.UserDTO
type Permission = webAuth.Permission

const (
	RoleViewer   = webAuth.RoleViewer
	RoleOperator = webAuth.RoleOperator
	RoleEngineer = webAuth.RoleEngineer
	RoleAdmin    = webAuth.RoleAdmin
)

/* `WEB-RBAC-001` — quyền theo năng lực; xem ma trận ở `auth.RoleHasPermission`. */
const (
	PermissionRead            = webAuth.PermissionRead
	PermissionSelfManage      = webAuth.PermissionSelfManage
	PermissionOperate         = webAuth.PermissionOperate
	PermissionProgramEdit     = webAuth.PermissionProgramEdit
	PermissionProgramActivate = webAuth.PermissionProgramActivate
	PermissionSettingsManage  = webAuth.PermissionSettingsManage
	PermissionDatabaseManage  = webAuth.PermissionDatabaseManage
	PermissionUsersManage     = webAuth.PermissionUsersManage
	PermissionSystemRelease   = webAuth.PermissionSystemRelease
)

var (
	ErrUserExists         = webAuth.ErrUserExists
	ErrUserNotFound       = webAuth.ErrUserNotFound
	ErrInvalidUserInput   = webAuth.ErrInvalidUserInput
	ErrInvalidPassword    = webAuth.ErrInvalidPassword
	ErrInvalidOldPassword = webAuth.ErrInvalidOldPassword
	ErrLastAdmin          = webAuth.ErrLastAdmin
	ErrSelfDelete         = webAuth.ErrSelfDelete
)

func NewAuditLogger(logger *log.Logger) *AuditLogger {
	return webAuth.NewAuditLogger(logger)
}

func NewAuthService(cfg Config, audit *AuditLogger) (*AuthService, error) {
	return webAuth.NewAuthService(webAuth.Config{
		JWTSecret:  cfg.JWTSecret,
		UsersConf:  cfg.UsersConf,
		WriteFile:  writeConfigFileAtomic,
		WriteError: writeError,
	}, audit)
}

func principalFromContext(ctx context.Context) *Principal {
	return webAuth.PrincipalFromContext(ctx)
}

func contextWithPrincipal(ctx context.Context, principal *Principal) context.Context {
	return webAuth.ContextWithPrincipal(ctx, principal)
}

func bearerToken(r *http.Request) string {
	return webAuth.BearerToken(r)
}

func sanitizeAudit(value string, max int) string {
	return webAuth.SanitizeAudit(value, max)
}

func RoleAllows(actual, required Role) bool {
	return webAuth.RoleAllows(actual, required)
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
		"token": token, "role": role, "expires_in": 3600,
		// `T57-3.17` (`ADR-047`): nói ngay ở phản hồi đăng nhập, để giao diện
		// dẫn thẳng tới màn đổi mật khẩu thay vì phải va vào một 403 trước đã.
		"mustChangePassword": a.auth.MustChangePassword(req.Username),
	})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal != nil {
		a.auth.Revoke(principal.Token)
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "ok"})
}
