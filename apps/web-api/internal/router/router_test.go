package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"mkddc-web/internal/auth"
)

type authorizerStub struct{ roles []auth.Role }

func (s *authorizerStub) Require(role auth.Role, next http.HandlerFunc) http.Handler {
	s.roles = append(s.roles, role)
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
