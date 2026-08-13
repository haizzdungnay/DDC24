package programminghttp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	programmingapplication "mkddc-web/internal/programming/application"
	"mkddc-web/internal/programming/coreipc"
	webrouter "mkddc-web/internal/router"
)

type stubStatusReader struct{ fail bool }

func (s stubStatusReader) Call(_ context.Context, request coreipc.Request) (coreipc.Response, error) {
	if s.fail {
		return coreipc.Response{}, errors.New("core unavailable trong test")
	}
	payload, err := coreipc.EncodePayload(struct {
		_                 struct{} `cbor:",toarray"`
		ProducerMode      string
		ActiveRevisionID  *string
		LKGRevisionID     *string
		ActiveOverrideIDs []string
	}{ProducerMode: "PROGRAM_ONLY", ActiveOverrideIDs: []string{}})
	if err != nil {
		return coreipc.Response{}, err
	}
	return coreipc.ResponseFor(request, coreipc.ResultOK, "", "core.programming.ipc", payload), nil
}

func newRuntimeServicesForTest(t *testing.T, fail bool) Services {
	t.Helper()
	service, err := programmingapplication.NewRuntimeService(programmingapplication.RuntimeServiceOptions{
		Runtime: stubStatusReader{fail: fail}, ControllerID: "controller-local",
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	return Services{Runtime: service}
}

func TestHandleRuntimeRequestCapabilitiesReturns200(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true, newRuntimeServicesForTest(t, false))
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/programming/capabilities", nil)
	req.Header.Set("X-Correlation-ID", "runtime-test-0001")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200, body=%s", recorder.Code, recorder.Body.String())
	}
	var capabilities programmingapplication.CapabilitiesView
	if err := json.Unmarshal(recorder.Body.Bytes(), &capabilities); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if capabilities.TargetState != "READY" || capabilities.Profile != "MK-DDC-24-REV-A" {
		t.Fatalf("capabilities = %+v", capabilities)
	}
}

func TestHandleRuntimeRequestRuntimeUnavailableStillReturns200(t *testing.T) {
	routes := []webrouter.Route{}
	RegisterProgrammingRoutes(&routes, true, newRuntimeServicesForTest(t, true))
	mux, err := webrouter.New(allowAllAuthorizer{}, routes, nil)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/programming/runtime", nil)
	req.Header.Set("X-Correlation-ID", "runtime-test-0002")
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, req)
	// GET /runtime luôn 200 với authority thật — mất kết nối Core KHÔNG phải
	// lỗi HTTP, nó là một trạng thái hợp lệ mà FE phải hiển thị (UNREACHABLE).
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200, body=%s", recorder.Code, recorder.Body.String())
	}
	var view programmingapplication.RuntimeView
	if err := json.Unmarshal(recorder.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if view.ProducerState != "UNAVAILABLE" || view.TaskState != "UNKNOWN" {
		t.Fatalf("runtime view = %+v", view)
	}
}
