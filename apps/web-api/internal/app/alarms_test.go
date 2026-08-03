package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeAlarmCore struct {
	alarms          []AlarmDTO
	readErr         error
	ackErr          error
	suppressErr     error
	returnErr       error
	acked           []string
	suppressed      []string
	returned        []string
	ackActions      []AlarmActionRequest
	suppressActions []AlarmActionRequest
	readCount       int
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

func (f *fakeAlarmCore) AckAlarm(_ context.Context, id string, action AlarmActionRequest) error {
	if f.ackErr != nil {
		return f.ackErr
	}
	f.acked = append(f.acked, id)
	f.ackActions = append(f.ackActions, action)
	return nil
}

func (f *fakeAlarmCore) SuppressAlarm(_ context.Context, id string, action AlarmActionRequest) error {
	if f.suppressErr != nil {
		return f.suppressErr
	}
	f.suppressed = append(f.suppressed, id)
	f.suppressActions = append(f.suppressActions, action)
	return nil
}

func (f *fakeAlarmCore) ReturnAlarm(_ context.Context, id string) error {
	if f.returnErr != nil {
		return f.returnErr
	}
	f.returned = append(f.returned, id)
	for i := range f.alarms {
		if f.alarms[i].ID == id && f.alarms[i].Status == "acked" {
			f.alarms[i].Status = "active"
		}
	}
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

func TestHandleAlarmsPreservesTriggerFields(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "active",
		Message: "Supply air", Source: "UI-01", Value: "31.8",
		Detail:       "trip=HH threshold=30 current=31.8 (High-high); occurrence=2",
		TriggerLevel: "HH", Threshold: "30",
	}}}
	app, token := newTestAppWithRole(t, RoleViewer, core)

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, resp, http.StatusOK)
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].TriggerLevel != "HH" || alarms[0].Threshold != "30" {
		t.Fatalf("alarms = %#v; want HH threshold", alarms)
	}
}

func TestHandleAlarmsIncludesVirtualPointHighLow(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	writeVirtualPointsSeed(t, app, `{"items":[{"id":"VP1","label":"Room Setpoint","signalType":"float","enabled":true,"writable":true,"value":32.5}]}`)
	rows := []AlarmSetting{{
		ID:        "ALM-VP-1",
		Label:     "Virtual setpoint high",
		Enabled:   true,
		AlarmType: alarmTypeHighLowInput,
		Sources:   []AlarmSource{{Kind: "VP", Channel: 1, PointID: "VP1"}},
		Priority:  "high",
		ClearMode: "auto",
		DelayS:    0,
		Params:    &AlarmParams{HH: floatPtr(32), H: floatPtr(30), L: floatPtr(10), LL: floatPtr(5)},
	}}
	if err := saveAlarmSettingsFile(context.Background(), app.alarmSettingsPath(), rows); err != nil {
		t.Fatalf("seed alarm settings: %v", err)
	}

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, resp, http.StatusOK)
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].ID != "ALM-VP-1" || alarms[0].Source != "VP1" || alarms[0].TriggerLevel != "HH" {
		t.Fatalf("alarms = %#v; want virtual HH alarm", alarms)
	}
}

func TestHandleAlarmsSkipsDisabledVirtualPoint(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	writeVirtualPointsSeed(t, app, `{"items":[{"id":"VP1","label":"Room Setpoint","signalType":"float","enabled":false,"writable":true,"value":32.5}]}`)
	rows := []AlarmSetting{{
		ID:        "ALM-VP-1",
		Label:     "Virtual setpoint high",
		Enabled:   true,
		AlarmType: alarmTypeHighLowInput,
		Sources:   []AlarmSource{{Kind: "VP", Channel: 1, PointID: "VP1"}},
		Priority:  "high",
		ClearMode: "auto",
		DelayS:    0,
		Params:    &AlarmParams{HH: floatPtr(32), H: floatPtr(30), L: floatPtr(10), LL: floatPtr(5)},
	}}
	if err := saveAlarmSettingsFile(context.Background(), app.alarmSettingsPath(), rows); err != nil {
		t.Fatalf("seed alarm settings: %v", err)
	}

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, resp, http.StatusOK)
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 0 {
		t.Fatalf("alarms = %#v; want none", alarms)
	}
}

func TestHandleAlarmsMergesAckedHistoryWhenCoreReadDegrades(t *testing.T) {
	core := &fakeAlarmCore{readErr: errCoreUnavailable}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	if err := app.alarmHistory.Append(context.Background(), AlarmHistoryEvent{
		Time: "2026-07-02T08:15:30Z", Event: "started", AlarmID: "ALM-1", Severity: "high", Status: "active",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Detail: "type=1 source=UI-01", Active: true,
	}); err != nil {
		t.Fatalf("Append started: %v", err)
	}
	if err := app.alarmHistory.Append(context.Background(), AlarmHistoryEvent{
		Time: "2026-07-02T08:16:30Z", Event: "acked", AlarmID: "ALM-1", Severity: "high", Status: "acked",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Detail: "type=1 source=UI-01", Active: true,
	}); err != nil {
		t.Fatalf("Append acked: %v", err)
	}

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, resp, http.StatusOK)
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].ID != "ALM-1" || alarms[0].Status != "acked" || !alarms[0].Active {
		t.Fatalf("alarms = %#v; want active acked ALM-1 from history", alarms)
	}
	if alarms[0].Returnable == nil || *alarms[0].Returnable {
		t.Fatalf("returnable = %#v; want false for history-only alarm", alarms[0].Returnable)
	}
}

func TestHandleAlarmsHealthyEmptyCoreDoesNotResurrectHistory(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	if err := app.alarmHistory.Append(context.Background(), AlarmHistoryEvent{
		Time: "2026-07-02T08:16:30Z", Event: "acked", AlarmID: "ALM-old", Severity: "high", Status: "acked",
		Message: "Old alarm", Source: "UI-01", Active: true,
	}); err != nil {
		t.Fatalf("Append acked: %v", err)
	}

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, resp, http.StatusOK)
	if strings.TrimSpace(resp.Body.String()) != "[]" {
		t.Fatalf("alarms = %s; want healthy core empty list", resp.Body.String())
	}
}

func TestHandleAlarmsTrustsLiveRowsOverHistory(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "unack",
		Message: "Manual latch", Source: "UI-01", Active: false, Returnable: boolPtr(true),
	}}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	if err := app.alarmHistory.Append(context.Background(), AlarmHistoryEvent{
		Time: "2026-07-02T08:16:30Z", Event: "acked", AlarmID: "ALM-1", Severity: "high", Status: "acked",
		Message: "Manual latch", Source: "UI-01", Active: true,
	}); err != nil {
		t.Fatalf("Append acked: %v", err)
	}

	resp := serveAuth(t, app.Router(), http.MethodGet, "/api/v1/alarms", "", token)
	assertStatus(t, resp, http.StatusOK)
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].Status != "unack" || alarms[0].Active {
		t.Fatalf("alarms = %#v; want live unack active=false", alarms)
	}
}

func TestHandleAlarmsReadErrorDoesNotRecordEnded(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "active",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Active: true,
	}}}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	handler := app.Router()

	assertStatus(t, serveAuth(t, handler, http.MethodGet, "/api/v1/alarms", "", token), http.StatusOK)
	core.readErr = errCoreUnavailable
	assertStatus(t, serveAuth(t, handler, http.MethodGet, "/api/v1/alarms", "", token), http.StatusOK)

	assertAlarmHistory(t, handler, token, []alarmHistoryExpectation{
		{Event: "started", AlarmID: "ALM-1", Status: "active", Message: "Supply air"},
	})
}

func TestHandleAckAlarmSuccessRefetchesAlarms(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "acked",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Detail: "type=1 source=UI-01",
		TriggerLevel: "H", Threshold: "28",
	}}}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/ack", "", token)
	assertStatus(t, resp, http.StatusOK)
	if len(core.acked) != 1 || core.acked[0] != "ALM-1" {
		t.Fatalf("acked = %#v; want ALM-1", core.acked)
	}
	if len(core.ackActions) != 1 || core.ackActions[0].Permanent == nil || !*core.ackActions[0].Permanent {
		t.Fatalf("ackActions = %#v; want legacy permanent ack", core.ackActions)
	}
	if core.readCount != 1 {
		t.Fatalf("readCount = %d; want 1", core.readCount)
	}
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].ID != "ALM-1" || alarms[0].Value != "31.8" || alarms[0].TriggerLevel != "H" {
		t.Fatalf("alarms = %#v; want refetched ALM-1 with value/trigger", alarms)
	}
}

func TestHandleAckAlarmAcceptsDurationBody(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/ack", `{"durationS":60,"permanent":false}`, token)
	assertStatus(t, resp, http.StatusOK)
	if len(core.ackActions) != 1 || core.ackActions[0].DurationS == nil || *core.ackActions[0].DurationS != 60 {
		t.Fatalf("ackActions = %#v; want durationS=60", core.ackActions)
	}
	if core.ackActions[0].Permanent == nil || *core.ackActions[0].Permanent {
		t.Fatalf("ackActions = %#v; want permanent=false", core.ackActions)
	}
}

func TestHandleAckAlarmRejectsBadDuration(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/ack", `{"durationS":0}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
	if len(core.acked) != 0 {
		t.Fatalf("acked = %#v; want none", core.acked)
	}
}

func TestHandleAckAlarmRejectsExtraJSON(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/ack", `{"durationS":60}{}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
	if len(core.acked) != 0 {
		t.Fatalf("acked = %#v; want none", core.acked)
	}
}

func TestHandleAckAlarmRejectsUnknownField(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/ack", `{"durationS":60,"unexpected":true}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
	if len(core.acked) != 0 {
		t.Fatalf("acked = %#v; want none", core.acked)
	}
}

func TestHandleSuppressAlarmSuccessRefetchesAlarms(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "active",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Detail: "type=1 source=UI-01",
	}}}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/suppress", `{"durationS":120}`, token)
	assertStatus(t, resp, http.StatusOK)
	if len(core.suppressed) != 1 || core.suppressed[0] != "ALM-1" {
		t.Fatalf("suppressed = %#v; want ALM-1", core.suppressed)
	}
	if len(core.suppressActions) != 1 || core.suppressActions[0].DurationS == nil || *core.suppressActions[0].DurationS != 120 {
		t.Fatalf("suppressActions = %#v; want durationS=120", core.suppressActions)
	}
	if core.suppressActions[0].Permanent == nil || *core.suppressActions[0].Permanent {
		t.Fatalf("suppressActions = %#v; want permanent=false", core.suppressActions)
	}
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].ID != "ALM-1" {
		t.Fatalf("alarms = %#v; want refetched ALM-1", alarms)
	}
}

func TestHandleSuppressAlarmRequiresBody(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/suppress", "", token)
	assertStatus(t, resp, http.StatusBadRequest)
	if len(core.suppressed) != 0 {
		t.Fatalf("suppressed = %#v; want none", core.suppressed)
	}
}

func TestHandleSuppressAlarmRejectsEmptyObject(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/suppress", `{}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
	if len(core.suppressed) != 0 {
		t.Fatalf("suppressed = %#v; want none", core.suppressed)
	}
}

func TestHandleSuppressAlarmRejectsUnknownField(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/suppress", `{"durationS":120,"unexpected":true}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
	if len(core.suppressed) != 0 {
		t.Fatalf("suppressed = %#v; want none", core.suppressed)
	}
}

func TestHandleSuppressAlarmRejectsConflictingDuration(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/suppress", `{"durationS":120,"permanent":true}`, token)
	assertStatus(t, resp, http.StatusBadRequest)
	if len(core.suppressed) != 0 {
		t.Fatalf("suppressed = %#v; want none", core.suppressed)
	}
}

func TestHandleReturnAlarmSuccessRefetchesAlarms(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "acked",
		Message: "Supply air", Source: "UI-01", Value: "31.8", Detail: "type=1 source=UI-01",
		TriggerLevel: "H", Threshold: "28", Active: true,
	}}}
	app, token := newTestAppWithRole(t, RoleOperator, core)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarms/ALM-1/return", "", token)
	assertStatus(t, resp, http.StatusOK)
	if len(core.returned) != 1 || core.returned[0] != "ALM-1" {
		t.Fatalf("returned = %#v; want ALM-1", core.returned)
	}
	var alarms []AlarmDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &alarms); err != nil {
		t.Fatalf("decode alarms: %v", err)
	}
	if len(alarms) != 1 || alarms[0].ID != "ALM-1" || alarms[0].Status != "active" {
		t.Fatalf("alarms = %#v; want returned active ALM-1", alarms)
	}
	assertAlarmHistory(t, app.Router(), token, []alarmHistoryExpectation{
		{Event: "started", AlarmID: "ALM-1", Status: "active", Message: "Supply air"},
		{Event: "returned", AlarmID: "ALM-1", Status: "active", User: "admin"},
	})
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

func TestAlarmHistoryRecordsStartAckEnd(t *testing.T) {
	core := &fakeAlarmCore{alarms: []AlarmDTO{{
		ID: "ALM-1", Time: "2026-07-02T08:15:30Z", Severity: "high", Status: "active",
		Message: "Supply air", Source: "UI-01", Value: "31.8",
		Detail:       "trip=HH threshold=30 current=31.8 (High-high); occurrence=2",
		TriggerLevel: "HH", Threshold: "30",
	}}}
	app, token := newTestAppWithRole(t, RoleOperator, core)
	handler := app.Router()

	assertStatus(t, serveAuth(t, handler, http.MethodGet, "/api/v1/alarms", "", token), http.StatusOK)
	assertStatus(t, serveAuth(t, handler, http.MethodPost, "/api/v1/alarms/ALM-1/ack", "", token), http.StatusOK)
	core.alarms = []AlarmDTO{}
	assertStatus(t, serveAuth(t, handler, http.MethodGet, "/api/v1/alarms", "", token), http.StatusOK)

	assertAlarmHistory(t, handler, token, []alarmHistoryExpectation{
		{Event: "started", AlarmID: "ALM-1", Status: "active", Message: "Supply air", Source: "UI-01", Value: "31.8", TriggerLevel: "HH", Threshold: "30"},
		{Event: "acked", AlarmID: "ALM-1", Status: "acked", User: "admin"},
		{Event: "ended", AlarmID: "ALM-1", Status: "normal"},
	})
}

func TestAlarmHistoryRecordsRestartAfterClearedSameID(t *testing.T) {
	tracker := NewAlarmHistoryTracker()
	t1 := time.Date(2026, 7, 6, 7, 0, 0, 0, time.UTC)
	active := AlarmDTO{ID: "ALM-1", Time: t1.Format(time.RFC3339Nano), Severity: "medium", Status: "active", Message: "Supply air", Source: "UI-01"}
	cleared := active
	cleared.Status = "cleared"

	got := append([]AlarmHistoryEvent{}, tracker.Reconcile([]AlarmDTO{active}, t1)...)
	got = append(got, tracker.Reconcile([]AlarmDTO{cleared}, t1.Add(time.Minute))...)
	got = append(got, tracker.Reconcile([]AlarmDTO{active}, t1.Add(2*time.Minute))...)
	got = append(got, tracker.Reconcile([]AlarmDTO{cleared}, t1.Add(3*time.Minute))...)

	want := []string{"started", "ended", "started", "ended"}
	if len(got) != len(want) {
		t.Fatalf("events = %#v; want %v", got, want)
	}
	for i, event := range got {
		if event.Event != want[i] {
			t.Fatalf("events[%d] = %q; want %q in %#v", i, event.Event, want[i], got)
		}
	}
	if got[2].Time != t1.Add(2*time.Minute).Format(time.RFC3339Nano) {
		t.Fatalf("restart time = %q; want observed transition time", got[2].Time)
	}
}

func TestAlarmHistoryDoesNotRecordEndForFirstSeenClearedAlarm(t *testing.T) {
	tracker := NewAlarmHistoryTracker()
	t1 := time.Date(2026, 7, 7, 8, 0, 0, 0, time.UTC)
	active := AlarmDTO{ID: "ALM-1", Time: t1.Format(time.RFC3339Nano), Severity: "medium", Status: "active", Message: "Supply air", Source: "UI-01"}
	cleared := active
	cleared.Status = "cleared"

	got := tracker.Reconcile([]AlarmDTO{cleared}, t1)
	if len(got) != 0 {
		t.Fatalf("events = %#v; want no orphan end for first-seen cleared alarm", got)
	}
	got = append(got, tracker.Reconcile([]AlarmDTO{active}, t1.Add(time.Minute))...)
	got = append(got, tracker.Reconcile([]AlarmDTO{cleared}, t1.Add(2*time.Minute))...)
	want := []string{"started", "ended"}
	if len(got) != len(want) {
		t.Fatalf("events = %#v; want %v", got, want)
	}
	for i, event := range got {
		if event.Event != want[i] {
			t.Fatalf("events[%d] = %q; want %q in %#v", i, event.Event, want[i], got)
		}
	}
}

func TestHandleAlarmHistoryFiltersAndAllLimit(t *testing.T) {
	core := &fakeAlarmCore{}
	app, token := newTestAppWithRole(t, RoleViewer, core)
	events := []AlarmHistoryEvent{
		{Time: "2026-07-01T01:00:00Z", Event: "started", AlarmID: "ALM-1", Severity: "critical", Status: "active", Message: "Supply air high", Source: "UI-01", Value: "31.8"},
		{Time: "2026-07-01T01:01:00Z", Event: "acked", AlarmID: "ALM-1", Severity: "critical", Status: "acked", Message: "Supply air high", Source: "UI-01", User: "admin"},
		{Time: "2026-07-02T02:00:00Z", Event: "ended", AlarmID: "ALM-2", Severity: "medium", Status: "normal", Message: "Pressure low", Source: "UI-02"},
		{Time: "2026-07-03T03:00:00Z", Event: "setting_changed", AlarmID: "ALM-3", User: "admin", Message: "Runtime alarm"},
	}
	for _, event := range events {
		if err := app.alarmHistory.Append(context.Background(), event); err != nil {
			t.Fatalf("Append history: %v", err)
		}
	}

	handler := app.Router()
	resp := serveAuth(t, handler, http.MethodGet, "/api/v1/alarm-history?limit=all&event=ack&severity=critical&status=acked&q=supply&from=2026-07-01&to=2026-07-01", "", token)
	assertStatus(t, resp, http.StatusOK)
	var got []AlarmHistoryEvent
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode alarm history: %v", err)
	}
	if len(got) != 1 || got[0].Event != "acked" || got[0].AlarmID != "ALM-1" {
		t.Fatalf("history = %#v; want ALM-1 acked only", got)
	}

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/alarm-history?limit=all&status=cleared", "", token)
	assertStatus(t, resp, http.StatusOK)
	got = nil
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode alarm history: %v", err)
	}
	if len(got) != 1 || got[0].Event != "ended" || got[0].AlarmID != "ALM-2" {
		t.Fatalf("history = %#v; want ALM-2 ended via cleared status alias", got)
	}

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/alarm-history?limit=all&name=Runtime", "", token)
	assertStatus(t, resp, http.StatusOK)
	got = nil
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode alarm history: %v", err)
	}
	if len(got) != 1 || got[0].Event != "setting_changed" || got[0].AlarmID != "ALM-3" {
		t.Fatalf("history = %#v; want ALM-3 setting_changed", got)
	}

	resp = serveAuth(t, handler, http.MethodGet, "/api/v1/alarm-history?limit=all&event=setting", "", token)
	assertStatus(t, resp, http.StatusOK)
	got = nil
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode alarm history: %v", err)
	}
	if len(got) != 1 || got[0].Event != "setting_changed" || got[0].AlarmID != "ALM-3" {
		t.Fatalf("history = %#v; want ALM-3 via setting alias", got)
	}
}

type alarmHistoryExpectation struct {
	Event        string
	AlarmID      string
	Status       string
	Message      string
	Source       string
	Value        string
	TriggerLevel string
	Threshold    string
	User         string
}

func assertAlarmHistory(t *testing.T, handler http.Handler, token string, want []alarmHistoryExpectation) {
	t.Helper()
	resp := serveAuth(t, handler, http.MethodGet, "/api/v1/alarm-history", "", token)
	assertStatus(t, resp, http.StatusOK)

	var got []map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode alarm history: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("history len = %d; want %d; body=%s", len(got), len(want), resp.Body.String())
	}
	for i, wantRecord := range want {
		assertHistoryField(t, got[i], "event", wantRecord.Event)
		assertHistoryField(t, got[i], "alarmId", wantRecord.AlarmID)
		assertHistoryField(t, got[i], "status", wantRecord.Status)
		assertHistoryField(t, got[i], "message", wantRecord.Message)
		assertHistoryField(t, got[i], "source", wantRecord.Source)
		assertHistoryField(t, got[i], "value", wantRecord.Value)
		assertHistoryField(t, got[i], "triggerLevel", wantRecord.TriggerLevel)
		assertHistoryField(t, got[i], "threshold", wantRecord.Threshold)
		assertHistoryField(t, got[i], "user", wantRecord.User)
		rawTime, ok := got[i]["time"].(string)
		if !ok || rawTime == "" {
			t.Fatalf("history[%d].time = %#v; want RFC3339 timestamp", i, got[i]["time"])
		}
		if _, err := time.Parse(time.RFC3339Nano, rawTime); err != nil {
			t.Fatalf("history[%d].time = %q; want RFC3339 timestamp: %v", i, rawTime, err)
		}
	}
}

func assertHistoryField(t *testing.T, got map[string]any, key, want string) {
	t.Helper()
	if want == "" {
		return
	}
	if got[key] != want {
		t.Fatalf("history field %s = %#v; want %q in %#v", key, got[key], want, got)
	}
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
