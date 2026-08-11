package app

import (
	"encoding/json"
	"net/http"
	"testing"

	programmingdomain "mkddc-web/internal/programming/domain"
)

func TestProgrammingRoutesAre404WhenFeatureFlagOff(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleViewer, fakeCore{})
	response := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/programming/capabilities", "", token)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d; want 404", response.Code)
	}
}

func TestProgrammingRoutesAreMountedReadOnlyWhenFeatureFlagOn(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleViewer, fakeCore{})
	app.cfg.ProgrammingRevA = true
	response := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/programming/capabilities", "", token)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503 contract-only", response.Code)
	}
	var envelope struct {
		Error struct {
			Code programmingdomain.ErrorCode `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != programmingdomain.ErrUnavailable {
		t.Fatalf("code = %s", envelope.Error.Code)
	}
}

func TestProgrammingMutationRequiresAdminWhenFeatureFlagOn(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleViewer, fakeCore{})
	app.cfg.ProgrammingRevA = true
	response := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/programming/projects", `{}`, token)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d; want 403", response.Code)
	}
}
