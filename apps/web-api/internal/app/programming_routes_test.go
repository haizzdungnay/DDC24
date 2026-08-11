package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestProgrammingProjectDraftRevisionHTTPAndRestart(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	cfg.ProgrammingRevA = true
	app, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatal(err)
	}
	handler := app.Router()
	createBody := `{"schemaVersion":"1.0","name":"AHU tầng 1","description":"fixture"}`
	created := serveProgramming(t, handler, http.MethodPost, "/api/v1/programming/projects", createBody, token,
		"10000000-0000-4000-8000-000000000001", "", "programming-http-0001")
	if created.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	var createResponse struct {
		Resource struct {
			ProjectID       string `json:"projectId"`
			DraftRevisionID string `json:"draftRevisionId"`
		} `json:"resource"`
		ETag    string `json:"etag"`
		AuditID string `json:"auditId"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createResponse); err != nil || createResponse.Resource.ProjectID == "" || createResponse.AuditID == "" {
		t.Fatalf("create response=%+v err=%v", createResponse, err)
	}
	listed := serveAuth(t, handler, http.MethodGet, "/api/v1/programming/projects?limit=50", "", token)
	if listed.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listed.Code, listed.Body.String())
	}
	projectPath := "/api/v1/programming/projects/" + createResponse.Resource.ProjectID
	project := serveAuth(t, handler, http.MethodGet, projectPath, "", token)
	if project.Code != http.StatusOK || project.Header().Get("ETag") != createResponse.ETag {
		t.Fatalf("get project status=%d etag=%q body=%s", project.Code, project.Header().Get("ETag"), project.Body.String())
	}
	patchBody := `{"schemaVersion":"1.0","baseRevisionId":"` + createResponse.Resource.DraftRevisionID + `","operations":[{"op":"setFunctionalTags","tags":["ahu","tầng-1"]}]}`
	saved := serveProgramming(t, handler, http.MethodPatch, projectPath+"/draft", patchBody, token,
		"10000000-0000-4000-8000-000000000002", createResponse.ETag, "programming-http-0002")
	if saved.Code != http.StatusOK || saved.Header().Get("ETag") == createResponse.ETag {
		t.Fatalf("save status=%d etag=%q body=%s", saved.Code, saved.Header().Get("ETag"), saved.Body.String())
	}
	replay := serveProgramming(t, handler, http.MethodPatch, projectPath+"/draft", patchBody, token,
		"10000000-0000-4000-8000-000000000002", createResponse.ETag, "programming-http-0003")
	if replay.Code != http.StatusOK || replay.Header().Get("Idempotency-Replayed") != "true" || replay.Header().Get("ETag") != saved.Header().Get("ETag") {
		t.Fatalf("replay status=%d headers=%v body=%s", replay.Code, replay.Header(), replay.Body.String())
	}
	stale := serveProgramming(t, handler, http.MethodPatch, projectPath+"/draft", patchBody, token,
		"10000000-0000-4000-8000-000000000003", createResponse.ETag, "programming-http-0004")
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale status=%d body=%s", stale.Code, stale.Body.String())
	}
	sealBody := `{"schemaVersion":"1.0","baseRevisionId":"` + createResponse.Resource.DraftRevisionID + `","label":"Bản 1","comment":"HTTP"}`
	sealed := serveProgramming(t, handler, http.MethodPost, projectPath+"/draft/revisions", sealBody, token,
		"10000000-0000-4000-8000-000000000004", saved.Header().Get("ETag"), "programming-http-0005")
	if sealed.Code != http.StatusCreated {
		t.Fatalf("seal status=%d body=%s", sealed.Code, sealed.Body.String())
	}
	var sealResponse struct {
		Resource struct {
			RevisionID string `json:"revisionId"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(sealed.Body.Bytes(), &sealResponse); err != nil || sealResponse.Resource.RevisionID == "" {
		t.Fatalf("seal response=%+v err=%v", sealResponse, err)
	}
	revision := serveAuth(t, handler, http.MethodGet, "/api/v1/programming/revisions/"+sealResponse.Resource.RevisionID, "", token)
	if revision.Code != http.StatusOK {
		t.Fatalf("get revision status=%d body=%s", revision.Code, revision.Body.String())
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewApp(cfg, nil, fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	restartedToken, _, err := restarted.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatal(err)
	}
	restartedReplay := serveProgramming(t, restarted.Router(), http.MethodPost, projectPath+"/draft/revisions", sealBody, restartedToken,
		"10000000-0000-4000-8000-000000000004", saved.Header().Get("ETag"), "programming-http-0006")
	if restartedReplay.Code != http.StatusCreated || restartedReplay.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("restart replay status=%d headers=%v body=%s", restartedReplay.Code, restartedReplay.Header(), restartedReplay.Body.String())
	}
}

func serveProgramming(t *testing.T, handler http.Handler, method, path, body, token, key, ifMatch, correlation string) *httptest.ResponseRecorder {
	t.Helper()
	request := newAuthRequest(method, path, body, token)
	if key != "" {
		request.Header.Set("X-Idempotency-Key", key)
	}
	if ifMatch != "" {
		request.Header.Set("If-Match", ifMatch)
	}
	request.Header.Set("X-Correlation-ID", correlation)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
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
