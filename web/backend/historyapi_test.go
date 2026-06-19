package main

import (
	"context"
	"encoding/json"
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
	now := time.Now().UTC().Unix()
	if err := app.trends.InsertBatch(context.Background(), []Sample{
		{TS: now - 4000, PointID: "AI-01", Value: 1, Quality: 0},
		{TS: now - 60, PointID: "AI-01", Value: 21.5, Quality: 0},
		{TS: now - 60, PointID: "AI-02", Value: 22.5, Quality: 1},
	}); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}

	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=AI-01,AI-02&range=30m", "", token)
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
	if rows[0]["time"] == "" || rows[0]["AI-01"] != 21.5 || rows[0]["AI-02"] != 22.5 {
		t.Fatalf("row = %+v", rows[0])
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

func TestTrendConfigPutUpdatesSamplerAndReturnsReloadNone(t *testing.T) {
	app, token := newHistoryTestApp(t)
	body := `{"pointIds":["AI-02","AI-01"],"intervalS":10,"retentionRecords":1000}`
	req := newAuthRequest(http.MethodPut, "/api/v1/trends/config", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp ConfigPutResult
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Reload != reloadNone || !resp.Applied || resp.Result != "applied" {
		t.Fatalf("resp = %+v", resp)
	}
	cfg, err := app.trends.GetConfig(context.Background())
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if !cfg.Enabled || cfg.IntervalS != 10 || cfg.RetentionRecords != 1000 || strings.Join(cfg.PointIDs, ",") != "AI-01,AI-02" {
		t.Fatalf("cfg = %+v", cfg)
	}
}

func newHistoryTestApp(t *testing.T) (*App, string) {
	t.Helper()
	users := writeTestUsers(t, "admin123", RoleAdmin)
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
