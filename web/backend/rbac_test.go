package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRolePermissionMatrix(t *testing.T) {
	all := []Permission{
		PermissionRead,
		PermissionSelfManage,
		PermissionOperate,
		PermissionProgramEdit,
		PermissionProgramActivate,
		PermissionSettingsManage,
		PermissionDatabaseManage,
		PermissionUsersManage,
		PermissionSystemRelease,
	}
	want := map[Role]map[Permission]bool{
		RoleViewer: {
			PermissionRead: true, PermissionSelfManage: true,
		},
		RoleOperator: {
			PermissionRead: true, PermissionSelfManage: true, PermissionOperate: true,
			PermissionProgramEdit: true,
		},
		RoleEngineer: {
			PermissionRead: true, PermissionSelfManage: true, PermissionOperate: true,
			PermissionProgramEdit: true, PermissionProgramActivate: true,
			PermissionSettingsManage: true, PermissionSystemRelease: true,
		},
		RoleAdmin: {
			PermissionRead: true, PermissionSelfManage: true, PermissionOperate: true,
			PermissionProgramEdit: true, PermissionProgramActivate: true,
			PermissionSettingsManage: true, PermissionDatabaseManage: true,
			PermissionUsersManage: true, PermissionSystemRelease: true,
		},
	}

	for role, permissions := range want {
		for _, permission := range all {
			if got := RoleHasPermission(role, permission); got != permissions[permission] {
				t.Errorf("RoleHasPermission(%q, %q) = %v; want %v", role, permission, got, permissions[permission])
			}
		}
	}
	if RoleHasPermission(Role("unknown"), PermissionRead) {
		t.Fatal("unknown role received read permission")
	}
	if RoleHasPermission(RoleAdmin, Permission("unknown")) {
		t.Fatal("unknown permission was accepted")
	}
}

func TestRequirePermissionDenyByDefaultAndAudit(t *testing.T) {
	var audit bytes.Buffer
	users := writeTestUsers(t, "viewer123", RoleViewer)
	auth, err := NewAuthService(testConfig(t, users), NewAuditLogger(log.New(&audit, "", 0)))
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := auth.Authenticate("admin", "viewer123", "test")
	if err != nil {
		t.Fatal(err)
	}
	called := false
	next := func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}

	tests := []struct {
		name       string
		permission Permission
		token      string
		wantStatus int
		wantCalled bool
	}{
		{name: "missing token", permission: PermissionRead, wantStatus: http.StatusUnauthorized},
		{name: "allowed", permission: PermissionRead, token: token, wantStatus: http.StatusNoContent, wantCalled: true},
		{name: "missing capability", permission: PermissionUsersManage, token: token, wantStatus: http.StatusForbidden},
		{name: "unknown permission", permission: Permission("unknown"), token: token, wantStatus: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called = false
			req := httptest.NewRequest(http.MethodGet, "/api/v1/protected", nil)
			if tt.token != "" {
				req.Header.Set("Authorization", "Bearer "+tt.token)
			}
			w := httptest.NewRecorder()
			auth.RequirePermission(tt.permission, next).ServeHTTP(w, req)
			if w.Code != tt.wantStatus || called != tt.wantCalled {
				t.Fatalf("status/called = %d/%v; want %d/%v", w.Code, called, tt.wantStatus, tt.wantCalled)
			}
		})
	}
	logged := audit.String()
	if !strings.Contains(logged, "permission=users.manage") || !strings.Contains(logged, "result=denied") {
		t.Fatalf("authorization denial was not audited: %s", logged)
	}
	if strings.Contains(logged, token) {
		t.Fatal("audit leaked bearer token")
	}
}

func TestProtectedRouteInventoryUsesPermissions(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	routes := app.protectedRoutes()
	if len(routes) != 61 {
		t.Fatalf("protected route count = %d; want 61", len(routes))
	}
	seen := make(map[string]Permission, len(routes))
	for _, route := range routes {
		if route.handler == nil {
			t.Fatalf("route %q has no handler", route.pattern)
		}
		if route.permission == "" || !knownPermission(route.permission) {
			t.Fatalf("route %q has invalid permission %q", route.pattern, route.permission)
		}
		if _, duplicate := seen[route.pattern]; duplicate {
			t.Fatalf("duplicate protected route %q", route.pattern)
		}
		seen[route.pattern] = route.permission
	}

	want := map[string]Permission{
		"POST /api/v1/auth/logout":                     PermissionRead,
		"GET /api/v1/system/status":                    PermissionRead,
		"GET /api/v1/network":                          PermissionRead,
		"PUT /api/v1/network":                          PermissionSettingsManage,
		"GET /api/v1/network/transaction":              PermissionSettingsManage,
		"POST /api/v1/network/transaction/{action}":    PermissionSettingsManage,
		"GET /api/v1/points":                           PermissionRead,
		"GET /api/v1/points/{id}":                      PermissionRead,
		"PUT /api/v1/points/{id}":                      PermissionOperate,
		"PUT /api/v1/points/{id}/config":               PermissionSettingsManage,
		"GET /api/v1/virtual-points":                   PermissionRead,
		"POST /api/v1/virtual-points":                  PermissionSettingsManage,
		"PUT /api/v1/virtual-points/{id}":              PermissionSettingsManage,
		"DELETE /api/v1/virtual-points/{id}":           PermissionSettingsManage,
		"GET /api/v1/ws/monitor":                       PermissionRead,
		"GET /api/v1/alarms":                           PermissionRead,
		"GET /api/v1/alarm-history":                    PermissionRead,
		"POST /api/v1/alarms/{id}/ack":                 PermissionOperate,
		"POST /api/v1/alarms/{id}/suppress":            PermissionOperate,
		"POST /api/v1/alarms/{id}/return":              PermissionOperate,
		"POST /api/v1/commissioning/points/{id}/test":  PermissionOperate,
		"GET /api/v1/bacnet/objects":                   PermissionRead,
		"POST /api/v1/graph/validate":                  PermissionProgramEdit,
		"POST /api/v1/graph/deploy":                    PermissionProgramActivate,
		"POST /api/v1/ota/upload":                      PermissionSystemRelease,
		"POST /api/v1/ota/apply":                       PermissionSystemRelease,
		"GET /api/v1/ota/status":                       PermissionSystemRelease,
		"GET /api/v1/logs/download":                    PermissionSystemRelease,
		"GET /api/v1/system/config":                    PermissionSettingsManage,
		"GET /api/v1/system/config/device":             PermissionSettingsManage,
		"PUT /api/v1/system/config/device":             PermissionSettingsManage,
		"GET /api/v1/system/config/network":            PermissionSettingsManage,
		"PUT /api/v1/system/config/network":            PermissionSettingsManage,
		"GET /api/v1/system/config/io":                 PermissionSettingsManage,
		"PUT /api/v1/system/config/io":                 PermissionSettingsManage,
		"GET /api/v1/system/config/safe-state":         PermissionSettingsManage,
		"PUT /api/v1/system/config/safe-state":         PermissionSettingsManage,
		"GET /api/v1/system/config/virtual-points":     PermissionSettingsManage,
		"PUT /api/v1/system/config/virtual-points":     PermissionSettingsManage,
		"GET /api/v1/system/config/bacnet":             PermissionSettingsManage,
		"PUT /api/v1/system/config/bacnet":             PermissionSettingsManage,
		"GET /api/v1/system/config/fieldbus":           PermissionSettingsManage,
		"PUT /api/v1/system/config/fieldbus":           PermissionSettingsManage,
		"GET /api/v1/system/config/time":               PermissionSettingsManage,
		"PUT /api/v1/system/config/time":               PermissionSettingsManage,
		"GET /api/v1/system/time/status":               PermissionRead,
		"GET /api/v1/users":                            PermissionUsersManage,
		"POST /api/v1/users":                           PermissionUsersManage,
		"PUT /api/v1/users/{username}":                 PermissionUsersManage,
		"DELETE /api/v1/users/{username}":              PermissionUsersManage,
		"POST /api/v1/users/{username}/reset-password": PermissionUsersManage,
		"GET /api/v1/me":                               PermissionRead,
		"POST /api/v1/me/change-password":              PermissionSelfManage,
		"GET /api/v1/history":                          PermissionRead,
		"GET /api/v1/history/export.csv":               PermissionRead,
		"GET /api/v1/trends/config":                    PermissionRead,
		"PUT /api/v1/trends/config":                    PermissionDatabaseManage,
		"GET /api/v1/schedules":                        PermissionRead,
		"PUT /api/v1/schedules":                        PermissionSettingsManage,
		"GET /api/v1/alarm-settings":                   PermissionRead,
		"PUT /api/v1/alarm-settings":                   PermissionSettingsManage,
	}
	if len(seen) != len(want) {
		t.Fatalf("route inventory size = %d; want %d", len(seen), len(want))
	}
	for pattern, permission := range want {
		if got := seen[pattern]; got != permission {
			t.Errorf("route %q permission = %q; want %q", pattern, got, permission)
		}
	}
}

func TestProtectedRouteRoleMatrixRejectsDirectAPIBypass(t *testing.T) {
	type roleClient struct {
		app      *App
		handler  http.Handler
		password string
	}
	roles := []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin}
	clients := make(map[Role]roleClient, len(roles))
	for _, role := range roles {
		app, _ := newTestAppWithRole(t, role, fakeCore{})
		clients[role] = roleClient{app: app, handler: app.Router(), password: "admin123"}
	}

	routes := clients[RoleAdmin].app.protectedRoutes()
	for _, route := range routes {
		method, path, ok := strings.Cut(route.pattern, " ")
		if !ok {
			t.Fatalf("invalid route pattern %q", route.pattern)
		}
		path = strings.NewReplacer(
			"{username}", "rbac-missing",
			"{id}", "rbac-missing",
			"{action}", "status",
		).Replace(path)

		t.Run(route.pattern+" unauthenticated", func(t *testing.T) {
			resp := serveAuth(t, clients[RoleAdmin].handler, method, path, `{}`, "")
			assertStatus(t, resp, http.StatusUnauthorized)
		})

		for _, role := range roles {
			role := role
			t.Run(route.pattern+" "+string(role), func(t *testing.T) {
				current := clients[role]
				token, _, err := current.app.auth.Authenticate("admin", current.password, "matrix")
				if err != nil {
					t.Fatalf("authenticate %s: %v", role, err)
				}
				resp := serveAuth(t, current.handler, method, path, `{}`, token)
				if !RoleHasPermission(role, route.permission) {
					assertStatus(t, resp, http.StatusForbidden)
					return
				}
				if resp.Code == http.StatusUnauthorized || resp.Code == http.StatusForbidden {
					t.Fatalf("allowed role %s received authorization status %d for %s", role, resp.Code, route.pattern)
				}
			})
		}
	}
}

func TestRouterEnforcesEngineerOperatorAndAdminBoundaries(t *testing.T) {
	engineerApp, engineerToken := newTestAppWithRole(t, RoleEngineer, fakeCore{})
	engineer := engineerApp.Router()
	for _, tc := range []struct {
		method string
		path   string
		body   string
		want   int
	}{
		{http.MethodGet, "/api/v1/system/config", "", http.StatusOK},
		{http.MethodGet, "/api/v1/users", "", http.StatusForbidden},
		{http.MethodPut, "/api/v1/trends/config", `{}`, http.StatusForbidden},
	} {
		resp := serveAuth(t, engineer, tc.method, tc.path, tc.body, engineerToken)
		assertStatus(t, resp, tc.want)
	}

	operatorApp, operatorToken := newTestAppWithRole(t, RoleOperator, fakeCore{})
	for _, path := range []string{"/api/v1/schedules", "/api/v1/alarm-settings"} {
		resp := serveAuth(t, operatorApp.Router(), http.MethodPut, path, `[]`, operatorToken)
		assertStatus(t, resp, http.StatusForbidden)
	}

	adminApp, adminToken := newTestAppWithAdmin(t)
	resp := serveAuth(t, adminApp.Router(), http.MethodGet, "/api/v1/users", "", adminToken)
	assertStatus(t, resp, http.StatusOK)
}

func TestContractFeatureRoutesEnforceCapabilitiesBeforeAvailability(t *testing.T) {
	tests := []struct {
		method     string
		path       string
		permission Permission
	}{
		{http.MethodGet, "/api/v1/bacnet/objects", PermissionRead},
		{http.MethodPost, "/api/v1/graph/validate", PermissionProgramEdit},
		{http.MethodPost, "/api/v1/graph/deploy", PermissionProgramActivate},
		{http.MethodPost, "/api/v1/ota/upload", PermissionSystemRelease},
		{http.MethodPost, "/api/v1/ota/apply", PermissionSystemRelease},
		{http.MethodGet, "/api/v1/ota/status", PermissionSystemRelease},
		{http.MethodGet, "/api/v1/logs/download", PermissionSystemRelease},
	}

	type client struct {
		handler http.Handler
		token   string
	}
	roles := []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin}
	clients := make(map[Role]client, len(roles))
	for _, role := range roles {
		app, token := newTestAppWithRole(t, role, fakeCore{})
		clients[role] = client{handler: app.Router(), token: token}
	}

	for _, tt := range tests {
		name := tt.method + " " + tt.path
		t.Run(name+" unauthenticated", func(t *testing.T) {
			resp := serveAuth(t, clients[RoleAdmin].handler, tt.method, tt.path, `sensitive-payload`, "")
			assertStatus(t, resp, http.StatusUnauthorized)
		})
		for _, role := range roles {
			role := role
			t.Run(name+" "+string(role), func(t *testing.T) {
				want := http.StatusForbidden
				if RoleHasPermission(role, tt.permission) {
					want = http.StatusNotImplemented
				}
				current := clients[role]
				resp := serveAuth(t, current.handler, tt.method, tt.path, `sensitive-payload`, current.token)
				assertStatus(t, resp, want)
			})
		}
	}
}

func TestUnavailableFeatureAttemptIsAuditedWithoutPayload(t *testing.T) {
	var logs bytes.Buffer
	users := writeTestUsers(t, "engineer123", RoleEngineer)
	app, err := NewApp(testConfig(t, users), log.New(&logs, "", 0), fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := app.auth.Authenticate("admin", "engineer123", "test")
	if err != nil {
		t.Fatal(err)
	}
	payload := "sensitive-firmware-payload"
	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/ota/upload", payload, token)
	assertStatus(t, resp, http.StatusNotImplemented)

	logged := logs.String()
	for _, fragment := range []string{"action=endpoint.unavailable", "target=ota.upload", "result=not_implemented"} {
		if !strings.Contains(logged, fragment) {
			t.Fatalf("audit missing %q: %s", fragment, logged)
		}
	}
	if strings.Contains(logged, payload) || strings.Contains(logged, token) {
		t.Fatalf("audit leaked payload or token: %s", logged)
	}
}

func TestBulkSystemConfigIsNotDeclaredOperation(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	for _, route := range app.protectedRoutes() {
		if route.pattern == "PUT /api/v1/system/config" {
			t.Fatal("unsupported bulk config PUT remains in the protected route inventory")
		}
	}
	resp := serveAuth(t, app.Router(), http.MethodPut, "/api/v1/system/config", `{}`, token)
	assertStatus(t, resp, http.StatusNotFound)
}
