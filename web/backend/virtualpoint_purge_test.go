package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestVirtualPointDeletePurgesDomainDataAndPreservesAudit(t *testing.T) {
	app, token, audit := newVirtualPointPurgeTestApp(t)
	router := app.Router()

	create := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"VP1","signalType":"float","enabled":true,"writable":true,"logEnabled":true,"logIntervalMs":1000,"value":21.5}`, token)
	createResponse := httptest.NewRecorder()
	router.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", createResponse.Code, createResponse.Body.String())
	}

	historianConfig, err := app.historian.Get()
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.historian.Update(HistorianConfigUpdate{
		BaseRevision:          historianConfig.Revision,
		BaseNamespaceRevision: historianConfig.NamespaceRevision,
		Points: []HistorianPolicyPatch{
			{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", RetentionDays: 180, retentionDaysSet: true},
			{PointID: "VP1", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", RetentionDays: 180, retentionDaysSet: true},
		},
	})
	if err != nil {
		t.Fatalf("seed historian policy: %v", err)
	}

	now := time.Date(2026, 7, 27, 4, 0, 0, 0, time.UTC).UnixMilli()
	seedVirtualPointHistorianRows(t, app, now)
	seedVirtualPointDependencies(t, app)
	app.virtualPointRing.Add([]Sample{{TS: now, PointID: "VP1", Value: 1.0}, {TS: now, PointID: "VP2", Value: 2.0}}, now)
	app.virtualPointRuntime.Update(RuntimePoint{ID: "VP1", Generation: 1, Value: 1.0})
	app.virtualPointRuntime.Update(RuntimePoint{ID: "VP2", Generation: 1, Value: 2.0})
	app.historianTrendCache.AppendHot([]HotSample{
		{PointID: "VP1", Generation: 1, BucketUTCMS: now, LastSampleUTCMS: now, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1},
		{PointID: "VP2", Generation: 1, BucketUTCMS: now, LastSampleUTCMS: now, Value: 2, Min: 2, Max: 2, Sum: 2, Count: 1},
	})

	request := newAuthRequest(http.MethodDelete, "/api/v1/virtual-points/VP1", "", token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", response.Code, response.Body.String())
	}

	assertVirtualPointPurgeState(t, app, now)
	if !strings.Contains(audit.String(), "action=virtual-points.delete") || !strings.Contains(audit.String(), "result=applied") {
		t.Fatalf("deletion audit missing: %s", audit.String())
	}

	recreate := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"vp1","signalType":"float","enabled":true,"writable":true,"value":7}`, token)
	recreateResponse := httptest.NewRecorder()
	router.ServeHTTP(recreateResponse, recreate)
	var recreated VirtualPoint
	if err := json.Unmarshal(recreateResponse.Body.Bytes(), &recreated); err != nil || recreateResponse.Code != http.StatusCreated {
		t.Fatalf("recreate status=%d point=%+v err=%v body=%s", recreateResponse.Code, recreated, err, recreateResponse.Body.String())
	}
	if recreated.ID != "VP1" || recreated.Tag != "VP1" || recreated.Generation != 1 {
		t.Fatalf("recreated point=%+v, want a fresh VP1 generation 1", recreated)
	}
}

func TestVirtualPointCreatePurgesSlotDeletedByOlderBackend(t *testing.T) {
	app, token, _ := newVirtualPointPurgeTestApp(t)
	if err := app.writePointNamespaceAuthority(pointNamespaceAuthority{Revision: 7, Generations: map[string]uint64{"VP1": 4}}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 27, 5, 0, 0, 0, time.UTC).UnixMilli()
	if _, err := app.historianV2.db.Exec(`INSERT INTO hot_samples(point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision) VALUES('VP1',4,?,?,?,?,?,?,1,0,'legacy',0)`, now, now, 9.0, 9.0, 9.0, 9.0); err != nil {
		t.Fatal(err)
	}
	if err := app.trends.InsertBatch(context.Background(), []Sample{{TS: now, PointID: "AV1", Value: 9}}); err != nil {
		t.Fatal(err)
	}

	request := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"vp1","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	response := httptest.NewRecorder()
	app.Router().ServeHTTP(response, request)
	var point VirtualPoint
	if err := json.Unmarshal(response.Body.Bytes(), &point); err != nil || response.Code != http.StatusCreated {
		t.Fatalf("create status=%d point=%+v err=%v body=%s", response.Code, point, err, response.Body.String())
	}
	if point.ID != "VP1" || point.Generation != 1 || point.Tag != "VP1" {
		t.Fatalf("point=%+v, want fresh VP1 generation 1", point)
	}
	var v2Rows, legacyRows int
	_ = app.historianV2.db.QueryRow(`SELECT count(*) FROM hot_samples WHERE point_id='VP1'`).Scan(&v2Rows)
	_ = app.trends.db.QueryRow(`SELECT count(*) FROM samples WHERE point_id='AV1'`).Scan(&legacyRows)
	if v2Rows != 0 || legacyRows != 0 {
		t.Fatalf("stale rows remain: v2=%d legacy=%d", v2Rows, legacyRows)
	}
}

func TestVirtualPointDeleteFailsClosedForUnsafeArchiveMetadata(t *testing.T) {
	app, token, audit := newVirtualPointPurgeTestApp(t)
	create := newAuthRequest(http.MethodPost, "/api/v1/virtual-points", `{"tag":"VP1","signalType":"float","enabled":true,"writable":true,"value":1}`, token)
	createResponse := httptest.NewRecorder()
	app.Router().ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", createResponse.Code, createResponse.Body.String())
	}
	now := time.Date(2026, 7, 27, 6, 0, 0, 0, time.UTC).UnixMilli()
	if _, err := app.historianV2.db.Exec(`INSERT INTO archive_blocks(block_id,point_id,generation,from_utc_ms,to_utc_ms,codec,file_name,byte_size,sample_count,gap_count,payload_sha256,state,created_at_utc_ms) VALUES('unsafe','VP1',1,?,?,'mkhab-v1','../escape.mkhab',0,0,0,?,'building',?)`, now, now+15_000, make([]byte, 32), now); err != nil {
		t.Fatal(err)
	}

	request := newAuthRequest(http.MethodDelete, "/api/v1/virtual-points/VP1", "", token)
	response := httptest.NewRecorder()
	app.Router().ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "unsafe historian archive") {
		t.Fatalf("delete status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(audit.String(), "action=virtual-points.delete") || !strings.Contains(audit.String(), "result=failed") {
		t.Fatalf("failed deletion audit missing: %s", audit.String())
	}
	var rows int
	if err := app.historianV2.db.QueryRow(`SELECT count(*) FROM archive_blocks WHERE point_id='VP1'`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("unsafe metadata changed rows=%d err=%v", rows, err)
	}
}

func newVirtualPointPurgeTestApp(t *testing.T) (*App, string, *bytes.Buffer) {
	t.Helper()
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	cfg.TrendDBPath = filepath.Join(cfg.ConfigDir, "trend.sqlite")
	cfg.ScheduleConfPath = filepath.Join(cfg.ConfigDir, "schedule.conf")
	cfg.AlarmConfPath = filepath.Join(cfg.ConfigDir, "alarm_settings.conf")
	cfg.AlarmHistoryPath = filepath.Join(cfg.ConfigDir, "alarm_history.jsonl")
	cfg.deriveHistorianV2Paths()
	var audit bytes.Buffer
	app, err := NewApp(cfg, log.New(&audit, "", 0), fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	t.Cleanup(func() { _ = app.Close() })
	token, _, err := app.auth.Authenticate("admin", "admin123", "test")
	if err != nil {
		t.Fatal(err)
	}
	return app, token, &audit
}

func seedVirtualPointHistorianRows(t *testing.T, app *App, now int64) {
	t.Helper()
	ctx := context.Background()
	for _, row := range []HotSample{
		{PointID: "VP1", Generation: 1, BucketUTCMS: now, LastSampleUTCMS: now, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "vp", PolicyRevision: 1},
		{PointID: "VP2", Generation: 1, BucketUTCMS: now, LastSampleUTCMS: now, Value: 2, Min: 2, Max: 2, Sum: 2, Count: 1, Source: "vp", PolicyRevision: 1},
	} {
		if err := app.historianV2.InsertHotBatch(ctx, []HotSample{row}); err != nil {
			t.Fatal(err)
		}
	}
	revision := uint64(1)
	for _, gap := range []HistoryGap{
		{PointID: "VP1", Generation: 1, FromUTCMS: now, ToUTCMS: now + 15_000, Reason: "snapshot", PolicyRevision: &revision, CreatedAtUTCMS: now},
		{PointID: "VP2", Generation: 1, FromUTCMS: now, ToUTCMS: now + 15_000, Reason: "snapshot", PolicyRevision: &revision, CreatedAtUTCMS: now},
	} {
		if err := app.historianV2.InsertGap(ctx, gap); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(app.cfg.HistorianV2ArchiveDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"VP1", "VP2"} {
		name := strings.ToLower(id) + ".mkhab"
		if err := os.WriteFile(filepath.Join(app.cfg.HistorianV2ArchiveDir, name), []byte(id), 0o600); err != nil {
			t.Fatal(err)
		}
		blockID := "block-" + strings.ToLower(id)
		if _, err := app.historianV2.db.Exec(`INSERT INTO archive_blocks(block_id,point_id,generation,from_utc_ms,to_utc_ms,codec,file_name,byte_size,sample_count,gap_count,payload_sha256,state,created_at_utc_ms,committed_at_utc_ms) VALUES(?,?,1,?,?,'mkhab-v1',?,3,0,0,?,'committed',?,?)`, blockID, id, now, now+15_000, name, make([]byte, 32), now, now); err != nil {
			t.Fatal(err)
		}
		if _, err := app.historianV2.db.Exec(`INSERT INTO archive_watermarks(point_id,generation,origin_utc_ms,covered_until_utc_ms,block_id,updated_at_utc_ms) VALUES(?,1,?,?,?,?)`, id, now, now+15_000, blockID, now); err != nil {
			t.Fatal(err)
		}
		if _, err := app.historianV2.db.Exec(`INSERT INTO retention_prune_queue(block_id,point_id,generation,from_utc_ms,to_utc_ms,file_name,byte_size,payload_sha256,queued_at_utc_ms) VALUES(?,?,1,?,?,?,?,?,?)`, "queue-"+strings.ToLower(id), id, now, now+15_000, name, 3, make([]byte, 32), now); err != nil {
			t.Fatal(err)
		}
	}
	if err := app.trends.InsertBatch(ctx, []Sample{{TS: now, PointID: "VP1", Value: 1}, {TS: now + 1, PointID: "AV1", Value: 1}, {TS: now, PointID: "VP2", Value: 2}}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.trends.SaveConfig(ctx, TrendConfig{Enabled: true, PointIDs: []string{"VP1", "VP2"}, IntervalS: 30, RetentionRecords: 2880}); err != nil {
		t.Fatal(err)
	}
}

func seedVirtualPointDependencies(t *testing.T, app *App) {
	t.Helper()
	var schedules []ScheduleRow
	if err := json.Unmarshal([]byte(validSchedulesJSON(2)), &schedules); err != nil {
		t.Fatal(err)
	}
	channel := 1
	schedules[0].Target = &ScheduleTarget{Kind: "VP", Channel: &channel, PointID: "VP1"}
	uiChannel := 2
	schedules[1].Target = &ScheduleTarget{Kind: "UI", Channel: &uiChannel, PointID: "UI-02"}
	if err := app.SaveSchedules(context.Background(), schedules); err != nil {
		t.Fatal(err)
	}
	var alarms []AlarmSetting
	if err := json.Unmarshal([]byte(validAlarmSettingsJSON(2)), &alarms); err != nil {
		t.Fatal(err)
	}
	alarms[0].Sources = []AlarmSource{{Kind: "VP", Channel: 1, PointID: "VP1"}}
	alarms[1].Sources = append(alarms[1].Sources, AlarmSource{Kind: "VP", Channel: 1, PointID: "AV1"})
	if err := app.SaveAlarmSettings(context.Background(), alarms); err != nil {
		t.Fatal(err)
	}
}

func assertVirtualPointPurgeState(t *testing.T, app *App, now int64) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(app.cfg.ConfigDir, pointNamespaceFile))
	if err != nil {
		t.Fatal(err)
	}
	var namespace pointNamespaceAuthority
	if err := json.Unmarshal(data, &namespace); err != nil {
		t.Fatal(err)
	}
	if _, exists := namespace.Generations["VP1"]; exists {
		t.Fatalf("VP1 generation survived purge: %+v", namespace)
	}
	for _, table := range []string{"point_policies", "hot_samples", "history_gaps", "archive_blocks", "archive_watermarks", "retention_prune_queue"} {
		var deleted, other int
		if err := app.historianV2.db.QueryRow(`SELECT count(*) FROM ` + table + ` WHERE point_id IN ('VP1','AV1','VP-01','AV-01')`).Scan(&deleted); err != nil {
			t.Fatal(err)
		}
		if err := app.historianV2.db.QueryRow(`SELECT count(*) FROM ` + table + ` WHERE point_id NOT IN ('VP1','AV1','VP-01','AV-01')`).Scan(&other); err != nil {
			t.Fatal(err)
		}
		if deleted != 0 || other == 0 {
			t.Fatalf("table %s deleted=%d other=%d", table, deleted, other)
		}
	}
	var evidence int
	if err := app.historianV2.db.QueryRow(`SELECT count(*) FROM policy_revisions`).Scan(&evidence); err != nil || evidence == 0 {
		t.Fatalf("policy audit evidence count=%d err=%v", evidence, err)
	}
	if _, err := os.Stat(filepath.Join(app.cfg.HistorianV2ArchiveDir, "vp1.mkhab")); !os.IsNotExist(err) {
		t.Fatalf("VP1 archive remains: %v", err)
	}
	if _, err := os.Stat(filepath.Join(app.cfg.HistorianV2ArchiveDir, "vp2.mkhab")); err != nil {
		t.Fatalf("VP2 archive removed: %v", err)
	}
	var legacyDeleted, legacyOther int
	_ = app.trends.db.QueryRow(`SELECT count(*) FROM samples WHERE point_id IN ('VP1','AV1','VP-01','AV-01')`).Scan(&legacyDeleted)
	_ = app.trends.db.QueryRow(`SELECT count(*) FROM samples WHERE point_id='VP2'`).Scan(&legacyOther)
	if legacyDeleted != 0 || legacyOther != 1 {
		t.Fatalf("legacy samples deleted=%d other=%d", legacyDeleted, legacyOther)
	}
	trendConfig, err := app.trends.GetConfig(context.Background())
	if err != nil || len(trendConfig.PointIDs) != 1 || trendConfig.PointIDs[0] != "VP2" {
		t.Fatalf("trend config=%+v err=%v", trendConfig, err)
	}
	schedules, _ := app.LoadSchedules(context.Background())
	if len(schedules) != 1 || scheduleTargetsVirtualPoint(schedules[0].Target, "VP1") {
		t.Fatalf("schedules after purge=%+v", schedules)
	}
	alarms, _ := app.LoadAlarmSettings(context.Background())
	if len(alarms) != 1 || len(alarms[0].Sources) != 1 || alarms[0].Sources[0].PointID == "VP1" {
		t.Fatalf("alarms after purge=%+v", alarms)
	}
	if got := app.virtualPointRing.Query([]string{"VP1"}, now-1, now+1); len(got) != 0 {
		t.Fatalf("VP1 ring samples remain: %+v", got)
	}
	if got := app.virtualPointRing.Query([]string{"VP2"}, now-1, now+1); len(got) != 1 {
		t.Fatalf("VP2 ring samples=%+v", got)
	}
	for _, point := range app.virtualPointRuntime.Snapshot() {
		if point.ID == "VP1" {
			t.Fatalf("VP1 runtime remains: %+v", point)
		}
	}
	if got := app.historianTrendCache.Read([]HistorianQueryIdentity{{PointID: "VP1", Generation: 1}}, now, now+15_000); len(got.Rows) != 0 {
		t.Fatalf("VP1 historian cache remains: %+v", got.Rows)
	}
}
