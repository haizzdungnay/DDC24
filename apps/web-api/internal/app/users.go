package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// ⚠ OWNED BY AGENT A (config) — điền logic ở đây. CẤM agent khác sửa file này.

func (a *App) handleListUsers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.auth.ListUsers())
}

func (a *App) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	var req CreateUserRequest
	if !decodeUserRequest(w, r, &req) {
		return
	}
	err := a.auth.AddUser(req.Username, req.Role, req.Password)
	a.auditUserChange(principal, "user.create", req.Username, auditResult(err), r.RemoteAddr)
	if err != nil {
		writeUserError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, UserDTO{Username: strings.TrimSpace(req.Username), Role: req.Role})
}

func (a *App) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	username := strings.TrimSpace(r.PathValue("username"))
	var req struct {
		Role Role `json:"role"`
	}
	if !decodeUserRequest(w, r, &req) {
		return
	}
	err := a.auth.SetRole(username, req.Role)
	a.auditUserChange(principal, "user.set_role", username, auditResult(err), r.RemoteAddr)
	if err != nil {
		writeUserError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, UserDTO{Username: username, Role: req.Role})
}

func (a *App) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	username := strings.TrimSpace(r.PathValue("username"))
	err := a.auth.DeleteUser(username, principal.Username)
	a.auditUserChange(principal, "user.delete", username, auditResult(err), r.RemoteAddr)
	if err != nil {
		writeUserError(w, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

func (a *App) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	username := strings.TrimSpace(r.PathValue("username"))
	var req ResetPasswordRequest
	if !decodeUserRequest(w, r, &req) {
		return
	}
	err := a.auth.SetPassword(username, req.NewPassword)
	a.auditUserChange(principal, "user.reset_password", username, auditResult(err), r.RemoteAddr)
	if err != nil {
		writeUserError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "ok"})
}

func (a *App) handleGetMe(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	// `T57-3.17` / ADR-047: `/me` là một trong hai endpoint mà phiên "phải đổi
	// mật khẩu" còn gọi được, nên nó phải nói ra chính tình trạng đó — nếu
	// không, giao diện chỉ thấy một chuỗi 403 mà không biết vì sao.
	// T63-108: ETag theo nội dung + 304 — xem http_revalidate.go. Băm chính
	// thân nên hai người dùng khác nhau không bao giờ trùng ETag.
	writeJSONRevalidated(w, r, UserDTO{
		Username:           principal.Username,
		Role:               principal.Role,
		MustChangePassword: a.auth.MustChangePassword(principal.Username),
	})
}

func (a *App) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req ChangePasswordRequest
	if !decodeUserRequest(w, r, &req) {
		return
	}
	err := a.auth.ChangePassword(principal.Username, req.OldPassword, req.NewPassword)
	a.auditUserChange(principal, "user.change_password", principal.Username, auditResult(err), r.RemoteAddr)
	if err != nil {
		if errors.Is(err, ErrInvalidOldPassword) || errors.Is(err, ErrUserNotFound) {
			writeError(w, http.StatusUnauthorized, "invalid old password")
			return
		}
		writeUserError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "ok"})
}

func decodeUserRequest(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	return true
}

func writeUserError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidUserInput), errors.Is(err, ErrInvalidPassword):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrUserExists):
		writeError(w, http.StatusConflict, "user exists")
	case errors.Is(err, ErrUserNotFound):
		writeError(w, http.StatusNotFound, "user not found")
	case errors.Is(err, ErrLastAdmin), errors.Is(err, ErrSelfDelete):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

func auditResult(err error) string {
	if err != nil {
		return "rejected"
	}
	return "accepted"
}

func (a *App) auditUserChange(principal *Principal, action, target, result, remote string) {
	username := "-"
	if principal != nil {
		username = principal.Username
	}
	a.audit.Change(username, action, target, result, remote)
}
