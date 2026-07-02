package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeAlarmCore struct {
	alarms    []AlarmDTO
	readErr   error
	ackErr    error
	acked     []string
	readCount int
}

func (f *fakeAlarmCore) ReadStatus(context.Context) (CoreStatus, error) {
	last := uint32(7)
	return CoreStatus{
		CoreAvailable: true,
		IobusPresent:  true,
		Versions:      VersionStatus{MCUFW: "1.0", Iobus: "1.2.0", Core: "1.1.0"},
		IOP:           IOPStatus{Status: "normal", CRCErrors: 1, Timeouts: 2, SeqErrors: 3, LastIORespMS: &last},
		Scan:          ScanStatus{Count: 99, Overrun: 4},
	}, nil
}

func (f *fakeAlarmCore) ReadAlarms(context.Context) ([]AlarmDTO, error) {
	f.readCount++
	if f.readErr != nil {
		return nil, f.readErr
	}
	return f.alarms, nil
}

func (f *fakeAlarmCore) AckAlarm(_ context.Context, id string) error {
	if f.ackErr != nil {
		return f.ackErr
	}
	f.acked = append(f.acked, id)
	return nil
}

func TestHandleAlarmsCoreReadErrorDegradesEmpty(t *testing.T) {
	core := &fakeAlarmCore{readErr: errors.New("core offline")}
	app, token := newTestAppWithRole(t, RoleViewer, core)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, resp, http.StatusOK)
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 0 {
		t.Fatalf("alarms len = %d; want 0", len(alarms))
	}
}

func TestHandleAckAlarmSuccessRefetchesAlarms(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "acked",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Detail: "type=1 source=UI-01",
	}}}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/ack", "", token)
	assertStatus(t, resp, http.StatusOK)
	if len(core.acked) != 1 || core.acked[0] != "ALM-1" {
		t.Fatalf("acked = %#v; want ALM-1", core.acked)
	}
	if core.readCount != 1 {
		t.Fatalf("readCount = %d; want 1", core.readCount)
	}
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].ID != "ALM-1" || alarms[0].Value != "31.8" {
		t.Fatalf("alarms = %#v; want refetched ALM-1 with value", alarms)
	}
}

func TestHandleAckAlarmUnknownReturnsNotFound(t *testing.T) {
	core := &fakeAlarmCore{ackErr: errors.New("unknown alarm")}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-missing/ack", "", token)
	assertStatus(t, resp, http.StatusNotFound)
}

func TestHandleAckAlarmRequiresOperator(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleViewer, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/ack", "", token)
	assertStatus(t, resp, http.StatusForbidden)
	if len(core.acked) != 0 {
		t.Fatalf("acked = %#v; want none", core.acked)
	}
}

func TestHandleAckAlarmEmptyIDReturnsBadRequest(t *testing.T) {
	core := &fakeAlarmCore{}
	app, _ := newTestAppWithRole(t, RoleOperator, core)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/alarms//ack", nil)
	req = req.WithContext(context.WithValue(req.Context(), principalContextKey, &Principal{Username: "op", Role: RoleOperator}))
	w := httptest.NewRecorder()

	app.handleAckAlarm(w, req)
	assertStatus(t, w, http.StatusBadRequest)
}

func newTestAppWithRole(t *testing.T, role Role, core CoreStatusClient) (*App, string) {
	t.Helper()
	users := writeTestUsers(t, "admin123", role)
	app, err := NewApp(testConfig(t, users), nil, core, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	return app, token
}
