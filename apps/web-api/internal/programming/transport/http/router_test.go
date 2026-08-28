package programminghttp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mkddc-web/internal/auth"
	"mkddc-web/internal/programming/domain"
	webrouter "mkddc-web/internal/router"
)

type allowAllAuthorizer struct{}

func (allowAllAuthorizer) Require(_ auth.Role, next http.HandlerFunc) http.Handler { return next }

func (allowAllAuthorizer) RequirePermission(_ auth.Permission, next http.HandlerFunc) http.Handler {
	return next
}

func TestRegisterProgrammingRoutesHonorsFeatureFlag(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, false)
	if len(routes) != 0 {
		t.Fatalf("disabled routes = %d; want 0", len(routes))
	}
	RegisterProgrammingRoutes(&routes, true)
	if len(routes) != len(routeDefinitions) {
		t.Fatalf("enabled routes = %d; want %d", len(routes), len(routeDefinitions))
	}
	// Con số này là contract, không phải chi tiết: 25 route Rev A + 3 route
	// Control Library của T59-202 + 2 route intent T59-405 + signal T59-504 +
	// recovery-reset T59-702 + deprecate Library revision F-P59-UI-001 + 7 route
	// Simulation R3 của T59-814 + Used-In của T61-105. Thêm route mà quên
	// OpenAPI/client sẽ đỏ ở `TestRegisteredRoutesMatchProgrammingOpenAPI`;
	// thêm route mà quên cả hai nơi thì đỏ ở đây.
	if len(routes) != 41 {
		t.Fatalf("contract route count = %d; want 41", len(routes))
	}
}

func TestContractSkeletonIsNoMutationAndUsesStableEnvelope(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/programming/operations/commission", strings.NewReader(`{"schemaVersion":"1.0","revisionId":"r1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-000000000001")
	req.Header.Set("X-Correlation-ID", "contract-test-0001")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", recorder.Code)
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if envelope.Error.Code != domain.ErrUnavailable || !envelope.Error.Retryable || !envelope.Error.KeepsRunningRevision {
		t.Fatalf("error = %+v", envelope.Error)
	}
	if envelope.Error.CorrelationID != "contract-test-0001" || recorder.Header().Get("X-Correlation-ID") != "contract-test-0001" {
		t.Fatalf("correlation mismatch: body=%q header=%q", envelope.Error.CorrelationID, recorder.Header().Get("X-Correlation-ID"))
	}
}

func TestContractSkeletonRejectsOversizeBeforeDecode(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte("x"), int(maxMutationBodyBytes)+1)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/programming/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-000000000001")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d; want 413", recorder.Code)
	}
}

func TestBundleImportRejectsHTTPBodyOneOverBeforeBase64Decode(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte("x"), int(maxBundleMutationBodyBytes)+1)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/programming/bundles/import", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-000000000001")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d; want 413", recorder.Code)
	}
}

func TestContractSkeletonRejectsMissingAndUnknownSchemaMajor(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"missing": `{ "name": "Project" }`,
		"unknown": `{ "schemaVersion": "2.0", "name": "Project" }`,
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/programming/projects", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-000000000001")
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, req)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d; want 400", recorder.Code)
			}
		})
	}
}

func TestContractSkeletonRejectsDuplicateJSONKey(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/programming/projects",
		strings.NewReader(`{"schemaVersion":"1.0","name":"A","name":"B"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-000000000001")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", recorder.Code)
	}
}

func TestContractSkeletonRejectsMissingConcurrencyHeaders(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/programming/projects/project-id/draft", strings.NewReader(`{"schemaVersion":"1.0"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Idempotency-Key", "00000000-0000-4000-8000-000000000001")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d; want 428", recorder.Code)
	}
}

func TestContractSkeletonDeleteTraceNeedsNoJSONBody(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/programming/runtime/traces/trace-id", nil)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503 contract-only", recorder.Code)
	}
}

func TestContractSkeletonRejectsInvalidCorrelationID(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true)
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/programming/capabilities", nil)
	req.Header.Set("X-Correlation-ID", "bad id")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", recorder.Code)
	}
}

func TestProgrammingErrorCanonicalizesHTTPMessageAndPublicArgs(t *testing.T) {
	recorder := httptest.NewRecorder()
	public := domain.PublicError{
		Code:       domain.ErrRequest,
		MessageKey: "attacker.message",
		Args: map[string]any{
			"actual": "2.0",
			"secret": "do-not-leak",
			"path":   "/etc/shadow",
		},
	}
	WriteProgrammingError(recorder, http.StatusInternalServerError, public, "catalog-test-0001")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("mismatched status = %d; want catalog default 400", recorder.Code)
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.MessageKey != "programming.error.request" {
		t.Fatalf("messageKey = %q", envelope.Error.MessageKey)
	}
	if len(envelope.Error.Args) != 1 || envelope.Error.Args["actual"] != "2.0" {
		t.Fatalf("public args leaked: %#v", envelope.Error.Args)
	}
}
