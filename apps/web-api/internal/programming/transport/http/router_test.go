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
	if len(routes) != 25 {
		t.Fatalf("contract route count = %d; want 25", len(routes))
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
