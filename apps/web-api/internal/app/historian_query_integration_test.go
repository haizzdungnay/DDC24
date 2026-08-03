package app

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

func TestUnifiedHistoryRouteUsesV2AndPreservesLegacyAdapter(t *testing.T) {
	app, token := newHistoryTestApp(t)
	bucket := time.Date(2026, 7, 20, 8, 0, 0, 0, time.UTC)
	enableHistorianV2QueryTest(t, app, bucket)

	from := bucket.Format(time.RFC3339)
	to := bucket.Add(15 * time.Second).Format(time.RFC3339)
	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=UI-01&from="+from+"&to="+to+"&resolution=15s", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("unified status=%d body=%s", w.Code, w.Body.String())
	}
	var response HistoryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Complete || len(response.Series) != 1 || len(response.Series[0].Samples) != 1 || response.Series[0].Samples[0].Value != 12.5 {
		t.Fatalf("unified response=%+v", response)
	}

	legacyReq := newAuthRequest(http.MethodGet, "/api/v1/history?point=UI-01&range=30m", "", token)
	legacyW := httptest.NewRecorder()
	app.Router().ServeHTTP(legacyW, legacyReq)
	if legacyW.Code != http.StatusOK || !strings.HasPrefix(strings.TrimSpace(legacyW.Body.String()), "[") {
		t.Fatalf("legacy status=%d body=%s", legacyW.Code, legacyW.Body.String())
	}
}

func TestUnifiedHistoryCSVRouteUsesSameV2Query(t *testing.T) {
	app, token := newHistoryTestApp(t)
	bucket := time.Date(2026, 7, 20, 8, 0, 0, 0, time.UTC)
	enableHistorianV2QueryTest(t, app, bucket)
	path := "/api/v1/history/export.csv?point=UI-01&from=" + bucket.Format(time.RFC3339) + "&to=" + bucket.Add(15*time.Second).Format(time.RFC3339) + "&resolution=15s"
	req := newAuthRequest(http.MethodGet, path, "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("csv status=%d headers=%v body=%s", w.Code, w.Header(), w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, "# metadata") || !strings.Contains(body, "pointId,generation,time") || !strings.Contains(body, "UI-01,1,") {
		t.Fatalf("csv body=%s", body)
	}
}

func TestUnifiedHistoryExplicitRangeFailsClosedWithoutV2(t *testing.T) {
	app, token := newHistoryTestApp(t)
	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=UI-01&from=2026-07-20T08:00:00Z&to=2026-07-20T08:00:15Z", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestUnifiedHistoryExplicitRangeRequiresActiveQueryAuthority(t *testing.T) {
	app, token := newHistoryTestApp(t)
	bucket := time.Date(2026, 7, 20, 8, 0, 0, 0, time.UTC)
	enableHistorianV2QueryTest(t, app, bucket)
	app.historianAuthority = HistorianRuntimeAuthority{State: "legacy"}
	req := newAuthRequest(http.MethodGet, "/api/v1/history?point=UI-01&from=2026-07-20T08:00:00Z&to=2026-07-20T08:00:15Z", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func enableHistorianV2QueryTest(t *testing.T, app *App, bucket time.Time) {
	t.Helper()
	store, err := OpenHistorianStore(filepath.Join(t.TempDir(), "historian-v2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	policy := []byte(`{"_schema_version":1,"revision":1,"historian_budget_bytes":2147483648,"wal_reserve_bytes":134217728,"migration_reserve_bytes":268435456,"required_free_space_bytes":536870912,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-20T08:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), policy, 1, uint64(bucket.UnixMilli())); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	if err := store.InsertHotBatch(context.Background(), []HotSample{{PointID: "UI-01", Generation: 1, BucketUTCMS: bucket.UnixMilli(), LastSampleUTCMS: bucket.UnixMilli(), Value: 12.5, Min: 12.5, Max: 12.5, Sum: 12.5, Count: 1, WorstQuality: 0, Source: "io", PolicyRevision: 1}}); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	cache, err := NewHistorianRAMCache(historianRAMMaxBytes)
	if err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	app.historianV2 = store
	app.historianV2Ready = true
	app.historianAuthority = HistorianRuntimeAuthority{State: "active", WriterV2: true, QueryV2: true}
	app.cfg.HistorianV2ArchiveDir = t.TempDir()
	app.historianShadow = &HistorianShadowScheduler{cache: cache}
}
