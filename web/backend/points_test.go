package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type pointsCore struct {
	points []PointDTO
	forced []any
}

func (c *pointsCore) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{}, nil
}

func (c *pointsCore) ReadPoints(context.Context) ([]PointDTO, error) {
	return c.points, nil
}

func (c *pointsCore) ForcePoint(_ context.Context, id string, value any, release bool) (PointDTO, error) {
	c.forced = append(c.forced, value)
	return PointDTO{ID: id, Value: value, Quality: "good", Source: "core", Forced: !release}, nil
}

func TestHandlePointCanonicalizesVirtualID(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	app.core = &pointsCore{points: []PointDTO{{ID: "AV1", Value: 12.5, Quality: "good", Source: "core"}}}
	req := newAuthRequest(http.MethodGet, "/api/v1/points/AV-01", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestForcePointRejectsNonScalarValues(t *testing.T) {
	tests := []string{
		`{"value":null}`,
		`{"value":"1"}`,
		`{"value":{"x":1}}`,
		`{"value":[1]}`,
	}
	for _, body := range tests {
		app, token := newTestAppWithAdmin(t)
		core := &pointsCore{}
		app.core = core
		req := newAuthRequest(http.MethodPut, "/api/v1/points/BV9", body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %s status = %d, want 400; response=%s", body, w.Code, w.Body.String())
		}
		if len(core.forced) != 0 {
			t.Fatalf("body %s reached core with %+v", body, core.forced)
		}
	}
}

func TestForcePointAcceptsNumberAndBooleanValues(t *testing.T) {
	tests := []string{
		`{"value":1}`,
		`{"value":false}`,
	}
	for _, body := range tests {
		app, token := newTestAppWithAdmin(t)
		core := &pointsCore{}
		app.core = core
		req := newAuthRequest(http.MethodPut, "/api/v1/points/BV9", body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("body %s status = %d body=%s", body, w.Code, w.Body.String())
		}
		if len(core.forced) != 1 {
			t.Fatalf("body %s did not reach core", body)
		}
	}
}
