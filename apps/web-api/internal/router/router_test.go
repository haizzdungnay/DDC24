package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"mkddc-web/internal/auth"
)

type authorizerStub struct {
	roles       []auth.Role
	permissions []auth.Permission
}

func (s *authorizerStub) Require(role auth.Role, next http.HandlerFunc) http.Handler {
	s.roles = append(s.roles, role)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { next(w, r) })
}

func (s *authorizerStub) RequirePermission(permission auth.Permission, next http.HandlerFunc) http.Handler {
	s.permissions = append(s.permissions, permission)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { next(w, r) })
}

func TestNewRegistersPublicAndRBACRoutes(t *testing.T) {
	authorizer := &authorizerStub{}
	mux, err := New(authorizer, []Route{
		PublicFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }),
		Protected("GET /admin", auth.RoleAdmin, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) }),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]int{"/health": http.StatusNoContent, "/admin": http.StatusAccepted} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != want {
			t.Fatalf("%s status = %d", path, response.Code)
		}
	}
	if len(authorizer.roles) != 1 || authorizer.roles[0] != auth.RoleAdmin {
		t.Fatalf("roles = %v", authorizer.roles)
	}
}

func TestNewRejectsDuplicateRoute(t *testing.T) {
	route := PublicFunc("GET /health", func(http.ResponseWriter, *http.Request) {})
	if _, err := New(nil, []Route{route, route}, nil); err == nil {
		t.Fatal("duplicate route không bị chặn")
	}
}

/* `WEB-RBAC-001` — route khai QUYỀN đi qua đúng `RequirePermission`, và khai cả
 * hai thứ cùng lúc là lỗi cấu hình chứ không phải "chặt hơn". */
func TestNewRoutesPermissionAndRejectsAmbiguousDeclaration(t *testing.T) {
	authorizer := &authorizerStub{}
	mux, err := New(authorizer, []Route{
		ProtectedPermission("GET /settings", auth.PermissionSettingsManage,
			func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) }),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/settings", nil))
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d", response.Code)
	}
	if len(authorizer.permissions) != 1 || authorizer.permissions[0] != auth.PermissionSettingsManage {
		t.Fatalf("quyền đã đăng ký = %v", authorizer.permissions)
	}
	if len(authorizer.roles) != 0 {
		t.Fatalf("route khai quyền KHÔNG được đi qua ngưỡng vai: %v", authorizer.roles)
	}

	_, err = New(&authorizerStub{}, []Route{{
		Pattern: "GET /both", Role: auth.RoleAdmin, Permission: auth.PermissionUsersManage,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}),
	}}, nil)
	if err == nil {
		t.Fatal("khai cả Role lẫn Permission phải bị từ chối — người đọc không biết cái nào có hiệu lực")
	}
}
