package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type trendCore struct{}

func (trendCore) ReadStatus(context.Context) (CoreStatus, error) { return CoreStatus{}, nil }

func (trendCore) ReadPoints(context.Context) ([]PointDTO, error) {
	return []PointDTO{
		{ID: "AI-01", Kind: "AI", Value: 21.5, Quality: "good", UpdatedAt: time.Now().UTC().Format(time.RFC3339)},
		{ID: "AI-02", Kind: "AI", Value: json.Number("22.5"), Quality: "uncertain", UpdatedAt: time.Now().UTC().Format(time.RFC3339)},
		{ID: "DI-01", Kind: "DI", Value: true, Quality: "good", UpdatedAt: time.Now().UTC().Format(time.RFC3339)},
	}, nil
}

func TestHistoryReturnsWideSamplesAndFiltersRange(t *testing.T) {
	app, token := newHistoryTestApp(t)
	now := time.Now().UTC().UnixMilli()
	if err := app.trends.InsertBatch(context.Background(), []Sample{
		{TS: now - 4_000_000, PointID: "AI1", Value: 1, Quality: 0},
		{TS: now - 60_000, PointID: "AI1", Value: 21.5, Quality: 0},
		{TS: now - 60_000, PointID: "UI-02", Value: 22.5, Quality: 1},
	}); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}

	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=UI-01,UI-02&range=30m", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var rows []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows len = %d body=%s", len(rows), w.Body.String())
	}
	if rows[0]["time"] == "" || rows[0]["UI-01"] != 21.5 || rows[0]["UI-02"] != 22.5 {
		t.Fatalf("row = %+v", rows[0])
	}
}

func TestHistoryHidesUncreatedVirtualSamples(t *testing.T) {
	app, token := newHistoryTestApp(t)
	now := time.Now().UTC().UnixMilli()
	if err := app.trends.InsertBatch(context.Background(), []Sample{
		{TS: now - 60_000, PointID: "AV1", Value: 21.5, Quality: 0},
		{TS: now - 60_000, PointID: "BV1", Value: 1, Quality: 0},
	}); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}

	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=VP-01,BV-01&range=30m", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestHistoryReturnsCreatedLoggedVirtualSamples(t *testing.T) {
	app, token := newHistoryTestApp(t)
	writeVirtualPointsSeed(t, app, `{"items":[{"id":"VP1","label":"Room Setpoint","signalType":"float","enabled":true,"writable":true,"logEnabled":true,"logIntervalMs":1000,"value":22.5}]}`)
	now := time.Now().UTC().UnixMilli()
	if err := app.trends.InsertBatch(context.Background(), []Sample{{TS: now - 60_000, PointID: "AV1", Value: 21.5, Quality: 0}}); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}

	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=VP-01&range=30m", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, "VP1") || !strings.Contains(body, "21.5") {
		t.Fatalf("body = %s", body)
	}
}

func TestHistoryReturnsVirtualPointRingSamples(t *testing.T) {
	app, token := newHistoryTestApp(t)
	writeVirtualPointsSeed(t, app, `{"items":[{"id":"VP1","label":"Diagnostic","signalType":"float","enabled":true,"writable":true,"logEnabled":true,"logIntervalMs":10,"value":22.5}]}`)
	now := time.Now().UTC().UnixMilli()
	app.virtualPointRing.Add([]Sample{{TS: now - 1000, PointID: "AV1", Value: 21.5, Quality: 0}}, now)

	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=VP-01&range=30m", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, "VP1") || !strings.Contains(body, "21.5") {
		t.Fatalf("body = %s", body)
	}
}

func TestHistoryReadsLegacySecondTimestamps(t *testing.T) {
	app, token := newHistoryTestApp(t)
	now := time.Now().UTC().Unix()
	if err := app.trends.InsertBatch(context.Background(), []Sample{{TS: now - 60, PointID: "AI1", Value: 19.5, Quality: 0}}); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}

	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=UI-01&range=30m", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, "19.5") {
		t.Fatalf("body = %s", body)
	}
}

func TestHistoryRejectsBadRange(t *testing.T) {
	app, token := newHistoryTestApp(t)
	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=AI-01&range=2h", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestParseHistoryRange(t *testing.T) {
	cases := []struct {
		raw     string
		wantSec int64
		wantErr bool
	}{
		{"5m", 300, false},
		{"15m", 900, false},
		{"30m", 1800, false},
		{"1h", 3600, false},
		{"6h", 21600, false},
		{"24h", 86400, false},
		{"2h", 0, true},
		{"", 0, true},
		{"invalid", 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := parseHistoryRange(tc.raw)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error for %q, got nil", tc.raw)
			}
			if !tc.wantErr && (err != nil || got != tc.wantSec) {
				t.Fatalf("parseHistoryRange(%q) = (%d, %v), want (%d, nil)", tc.raw, got, err, tc.wantSec)
			}
		})
	}
}

func TestHistoryAccepts5mAnd15mRanges(t *testing.T) {
	app, token := newHistoryTestApp(t)
	now := time.Now().UTC().UnixMilli()
	if err := app.trends.InsertBatch(context.Background(), []Sample{
		{TS: now - 60_000, PointID: "AI1", Value: 21.5, Quality: 0},
	}); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}

	for _, r := range []string{"5m", "15m"} {
		req := newAuthRequest(http.MethodGet, "/api/v1/history?point=UI-01&range="+r, "", token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("range=%s status = %d body=%s", r, w.Code, w.Body.String())
		}
	}
}

func TestTrendConfigValidation(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{name: "low interval", body: `{"enabled":true,"pointIds":["AI-01"],"intervalS":9,"retentionRecords":1000}`},
		{name: "high interval", body: `{"enabled":true,"pointIds":["AI-01"],"intervalS":301,"retentionRecords":1000}`},
		{name: "low retention", body: `{"enabled":true,"pointIds":["AI-01"],"intervalS":30,"retentionRecords":500}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, token := newHistoryTestApp(t)
			req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", tc.body, token)
			w := httptest.NewRecorder()
			app.Router().ServeHTTP(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
			}
		})
	}
}

func TestTrendConfigRejectsUncreatedVirtualPoint(t *testing.T) {
	app, token := newHistoryTestApp(t)
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", `{"enabled":true,"pointIds":["VP-01"],"intervalS":10,"retentionRecords":1000}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestHistorianConfigAcceptsCreatedVirtualPointWithoutDiagnosticLogging(t *testing.T) {
	app, token := newHistoryTestApp(t)
	writeVirtualPointsSeed(t, app, `{"items":[{"id":"VP1","generation":1,"tag":"room setpoint","signalType":"float","enabled":true,"writable":true,"logEnabled":false,"value":22.5}]}`)
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", `{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"VP1","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","startAtUtc":null}]}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var cfg HistorianConfig
	if err := json.Unmarshal(w.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if !hasHistorianPolicy(cfg.Points, "VP1", true) {
		t.Fatalf("cfg = %+v", cfg)
	}
}

func TestHistorianConfigAcceptsExplicitRetentionAndReturnsMaximum(t *testing.T) {
	app, token := newHistoryTestApp(t)
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", `{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"1s","retentionDays":21}]}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var cfg HistorianConfig
	if err := json.Unmarshal(w.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	var ui HistorianPolicy
	for _, point := range cfg.Points {
		if point.PointID == "UI-01" {
			ui = point
		}
	}
	if ui.RetentionDays != 21 || ui.MaxRetentionDays != 30 || cfg.RetentionMaxDaysByInterval["15s"] != 180 {
		t.Fatalf("config=%+v", cfg)
	}
}

func TestHistorianConfigRejectsRetentionAboveIntervalMaximumAtomically(t *testing.T) {
	app, token := newHistoryTestApp(t)
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", `{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"1s","retentionDays":31}]}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || app.historian.revision() != 0 || !strings.Contains(w.Body.String(), "historian_retention_invalid") {
		t.Fatalf("status=%d revision=%d body=%s", w.Code, app.historian.revision(), w.Body.String())
	}
}

func TestHistorianConfigDisablePreservesSelectedRetention(t *testing.T) {
	app, token := newHistoryTestApp(t)
	for revision, body := range []string{
		`{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"1s","retentionDays":21}]}`,
		`{"baseRevision":1,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":false}]}`,
	} {
		req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("revision=%d status=%d body=%s", revision, w.Code, w.Body.String())
		}
	}
	got, err := app.historian.Get()
	if err != nil {
		t.Fatal(err)
	}
	for _, point := range got.Points {
		if point.PointID == "UI-01" && (point.DBLoggingEnabled || point.RetentionDays != 21) {
			t.Fatalf("disabled point=%+v", point)
		}
	}
}

func TestHistorianConfigRejectsStaleRevision(t *testing.T) {
	app, token := newHistoryTestApp(t)
	body := `{"baseRevision":1,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","startAtUtc":null}]}`
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestHistorianConfigRejectsMissingRequiredFields(t *testing.T) {
	cases := []string{
		`{"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s"}]}`,
		`{"baseRevision":0}`,
		`{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"generation":1,"dbLoggingEnabled":true,"dbInterval":"15s"}]}`,
		`{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","dbLoggingEnabled":true,"dbInterval":"15s"}]}`,
		`{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbInterval":"15s"}]}`,
	}
	for _, body := range cases {
		app, token := newHistoryTestApp(t)
		req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body=%s status=%d response=%s", body, w.Code, w.Body.String())
		}
		if app.historian.revision() != 0 {
			t.Fatalf("body=%s changed revision", body)
		}
	}
}

func TestHistorianConfigRejectsStaleNamespaceRevision(t *testing.T) {
	app, token := newHistoryTestApp(t)
	if err := app.writePointNamespaceAuthority(pointNamespaceAuthority{Revision: 3, Generations: map[string]uint64{}}); err != nil {
		t.Fatal(err)
	}
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", `{"baseRevision":0,"baseNamespaceRevision":2,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s"}]}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d response=%s", w.Code, w.Body.String())
	}

	getReq := newAuthRequest(http.MethodGet, "/api/v1/trends/config", "", token)
	getResponse := httptest.NewRecorder()
	app.Router().ServeHTTP(getResponse, getReq)
	var cfg HistorianConfig
	if err := json.Unmarshal(getResponse.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.NamespaceRevision != 3 {
		t.Fatalf("namespace revision = %d, want 3", cfg.NamespaceRevision)
	}
}

func TestHistorianConfigPutReturnsRevisionWithoutChangingLegacySampler(t *testing.T) {
	app, token := newHistoryTestApp(t)
	before := app.sampler.snapshot()
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", `{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","startAtUtc":null}]}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var got HistorianConfig
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Revision != 1 || !hasHistorianPolicy(got.Points, "UI-01", true) {
		t.Fatalf("config = %+v", got)
	}
	after := app.sampler.snapshot()
	if before.Enabled != after.Enabled || before.IntervalS != after.IntervalS || before.RetentionRecords != after.RetentionRecords || strings.Join(before.PointIDs, ",") != strings.Join(after.PointIDs, ",") {
		t.Fatalf("legacy sampler changed: before=%+v after=%+v", before, after)
	}
}

func TestHistorianConfigRBAC(t *testing.T) {
	for _, tc := range []struct {
		role      Role
		putStatus int
	}{{RoleViewer, http.StatusForbidden}, {RoleOperator, http.StatusForbidden}, {RoleAdmin, http.StatusOK}} {
		t.Run(string(tc.role), func(t *testing.T) {
			app, token := newHistoryTestAppWithRole(t, tc.role)
			getReq := newAuthRequest(http.MethodGet, "/api/v1/trends/config", "", token)
			getResponse := httptest.NewRecorder()
			app.Router().ServeHTTP(getResponse, getReq)
			if getResponse.Code != http.StatusOK {
				t.Fatalf("GET status=%d body=%s", getResponse.Code, getResponse.Body.String())
			}
			putReq := newAuthRequest(http.MethodPut, "/api/v1/trends/config", `{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s"}]}`, token)
			putResponse := httptest.NewRecorder()
			app.Router().ServeHTTP(putResponse, putReq)
			if putResponse.Code != tc.putStatus {
				t.Fatalf("PUT status=%d body=%s", putResponse.Code, putResponse.Body.String())
			}
		})
	}
}

func TestHistorianConfigReturnsMachineReadableReasons(t *testing.T) {
	for _, tc := range []struct {
		body   string
		status int
		reason string
	}{
		{`{"baseRevision":0,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"auto"}]}`, http.StatusBadRequest, "historian_interval_invalid"},
		{`{"baseRevision":1,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s"}]}`, http.StatusConflict, "config_conflict"},
	} {
		app, token := newHistoryTestApp(t)
		req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", tc.body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
		var response struct {
			Details []configValidationError `json:"details"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || len(response.Details) != 1 || response.Details[0].Reason != tc.reason {
			t.Fatalf("response=%s err=%v want reason=%s", w.Body.String(), err, tc.reason)
		}
	}
}

func TestHistorianConfigDisablePreservesHistory(t *testing.T) {
	app, token := newHistoryTestApp(t)
	ts := time.Now().UTC().UnixMilli()
	if err := app.trends.InsertBatch(context.Background(), []Sample{{TS: ts, PointID: "UI-01", Value: 21.5, Quality: 0}}); err != nil {
		t.Fatal(err)
	}
	for revision, enabled := range []bool{true, false} {
		body := fmt.Sprintf(`{"baseRevision":%d,"baseNamespaceRevision":0,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":%t,"dbInterval":"15s"}]}`, revision, enabled)
		req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", body, token)
		w := httptest.NewRecorder()
		app.Router().ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("enabled=%v status=%d body=%s", enabled, w.Code, w.Body.String())
		}
	}
	samples, err := app.trends.Query(context.Background(), []string{"UI-01"}, ts, ts)
	if err != nil || len(samples) != 1 || samples[0].Value != 21.5 {
		t.Fatalf("samples=%+v err=%v", samples, err)
	}
}

func hasHistorianPolicy(points []HistorianPolicy, pointID string, enabled bool) bool {
	for _, point := range points {
		if point.PointID == pointID && point.DBLoggingEnabled == enabled {
			return true
		}
	}
	return false
}

func newHistoryTestApp(t *testing.T) (*App, string) {
	return newHistoryTestAppWithRole(t, RoleAdmin)
}

func newHistoryTestAppWithRole(t *testing.T, role Role) (*App, string) {
	t.Helper()
	users := writeTestUsers(t, "admin123", role)
	cfg := testConfig(t, users)
	cfg.TrendDBPath = filepath.Join(t.TempDir(), "trend.sqlite")
	app, err := NewApp(cfg, nil, trendCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	t.Cleanup(func() { _ = app.Close() })
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	return app, token
}
