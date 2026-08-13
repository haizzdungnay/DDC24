package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	projectAfterSeal := serveAuth(t, handler, http.MethodGet, projectPath, "", token)
	var projectAfterSealResponse struct {
		DraftRevisionID string `json:"draftRevisionId"`
		BaseRevisionID  string `json:"baseRevisionId"`
	}
	if err := json.Unmarshal(projectAfterSeal.Body.Bytes(), &projectAfterSealResponse); err != nil ||
		projectAfterSeal.Code != http.StatusOK || projectAfterSealResponse.DraftRevisionID != createResponse.Resource.DraftRevisionID ||
		projectAfterSealResponse.BaseRevisionID != sealResponse.Resource.RevisionID {
		t.Fatalf("get project sau seal status=%d response=%+v err=%v", projectAfterSeal.Code, projectAfterSealResponse, err)
	}
	revision := serveAuth(t, handler, http.MethodGet, "/api/v1/programming/revisions/"+sealResponse.Resource.RevisionID, "", token)
	if revision.Code != http.StatusOK {
		t.Fatalf("get revision status=%d body=%s", revision.Code, revision.Body.String())
	}
	exportBody := `{"schemaVersion":"1.0","revisionIds":["` + sealResponse.Resource.RevisionID + `"]}`
	exported := serveProgramming(t, handler, http.MethodPost, "/api/v1/programming/bundles/export", exportBody, token,
		"10000000-0000-4000-8000-000000000006", "", "programming-http-0008")
	if exported.Code != http.StatusOK {
		t.Fatalf("export status=%d body=%s", exported.Code, exported.Body.String())
	}
	var exportResponse struct {
		BundleSHA256 string `json:"bundleSha256"`
		BundleBase64 string `json:"bundleBase64"`
		AuditID      string `json:"auditId"`
	}
	if err := json.Unmarshal(exported.Body.Bytes(), &exportResponse); err != nil || len(exportResponse.BundleSHA256) != 64 ||
		exportResponse.BundleBase64 == "" || exportResponse.AuditID == "" {
		t.Fatalf("export response=%+v err=%v", exportResponse, err)
	}
	importBodyBytes, _ := json.Marshal(map[string]any{"schemaVersion": "1.0", "name": "AHU nhập HTTP",
		"description": "source-only", "bundleBase64": exportResponse.BundleBase64, "expectedSha256": exportResponse.BundleSHA256})
	imported := serveProgramming(t, handler, http.MethodPost, "/api/v1/programming/bundles/import", string(importBodyBytes), token,
		"10000000-0000-4000-8000-000000000007", "", "programming-http-0009")
	if imported.Code != http.StatusCreated {
		t.Fatalf("import status=%d body=%s", imported.Code, imported.Body.String())
	}
	var importResponse struct {
		Resource struct {
			ProjectID         string `json:"projectId"`
			State             string `json:"state"`
			CheckCreated      bool   `json:"checkCreated"`
			ArtifactImported  bool   `json:"artifactImported"`
			CommissionStarted bool   `json:"commissionStarted"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(imported.Body.Bytes(), &importResponse); err != nil || importResponse.Resource.ProjectID == "" ||
		importResponse.Resource.State != "DRAFT" || importResponse.Resource.CheckCreated ||
		importResponse.Resource.ArtifactImported || importResponse.Resource.CommissionStarted {
		t.Fatalf("import response=%+v err=%v", importResponse, err)
	}
	checkBody := `{"schemaVersion":"1.0","targetProfile":"MK-DDC-24-REV-A"}`
	checkAccepted := serveProgramming(t, handler, http.MethodPost, "/api/v1/programming/revisions/"+sealResponse.Resource.RevisionID+"/checks", checkBody, token,
		"10000000-0000-4000-8000-000000000005", "", "programming-http-0007")
	if checkAccepted.Code != http.StatusAccepted {
		t.Fatalf("check accepted status=%d body=%s", checkAccepted.Code, checkAccepted.Body.String())
	}
	var checkResponse struct {
		CheckID string `json:"checkId"`
	}
	if err := json.Unmarshal(checkAccepted.Body.Bytes(), &checkResponse); err != nil || checkResponse.CheckID == "" {
		t.Fatalf("check accepted=%+v err=%v", checkResponse, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		result := serveAuth(t, handler, http.MethodGet, "/api/v1/programming/checks/"+checkResponse.CheckID, "", token)
		if result.Code != http.StatusOK {
			t.Fatalf("get check status=%d body=%s", result.Code, result.Body.String())
		}
		var state struct {
			State       string `json:"state"`
			Diagnostics []any  `json:"diagnostics"`
		}
		if err := json.Unmarshal(result.Body.Bytes(), &state); err != nil {
			t.Fatal(err)
		}
		if state.State == "FAILED" {
			if len(state.Diagnostics) == 0 {
				t.Fatal("Check FAILED thiếu diagnostic")
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Check chưa terminal: %s", result.Body.String())
		}
		time.Sleep(10 * time.Millisecond)
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

func TestProgrammingCORSPreflightAllowsConcurrencyHeadersAndPatch(t *testing.T) {
	app, _ := newTestAppWithRole(t, RoleViewer, fakeCore{})
	app.cfg.CORSOrigin = "https://engineering.example"
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/programming/projects/id/draft", nil)
	request.Header.Set("Origin", app.cfg.CORSOrigin)
	request.Header.Set("Access-Control-Request-Method", http.MethodPatch)
	response := httptest.NewRecorder()
	app.Router().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || !strings.Contains(response.Header().Get("Access-Control-Allow-Methods"), "PATCH") ||
		!strings.Contains(response.Header().Get("Access-Control-Allow-Headers"), "X-Idempotency-Key") ||
		!strings.Contains(response.Header().Get("Access-Control-Allow-Headers"), "If-Match") {
		t.Fatalf("CORS preflight status=%d headers=%v", response.Code, response.Header())
	}
}
