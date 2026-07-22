package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestHistorianStoreSettingsAndSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v2.sqlite")
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	for pragma, want := range map[string]string{
		"journal_mode":   "wal",
		"synchronous":    "2",
		"foreign_keys":   "1",
		"busy_timeout":   "5000",
		"trusted_schema": "0",
		"quick_check":    "ok",
	} {
		var got string
		if err := store.db.QueryRowContext(ctx, "PRAGMA "+pragma).Scan(&got); err != nil {
			t.Fatalf("PRAGMA %s: %v", pragma, err)
		}
		if got != want {
			t.Fatalf("PRAGMA %s = %q, want %q", pragma, got, want)
		}
	}

	var version int
	if err := store.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil || version != historianSchemaVersion {
		t.Fatalf("user_version=%d err=%v", version, err)
	}
	wantTables := map[string]bool{
		"historian_meta": false, "policy_revisions": false, "point_policies": false,
		"hot_samples": false, "history_gaps": false, "archive_blocks": false,
		"archive_watermarks": false, "migration_runs": false, "migration_rejections": false,
		"historian_activation": false, "retention_prune_queue": false, "historian_cutover_evidence": false, "historian_legacy_quiesce": false,
	}
	rows, err := store.db.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type='table'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		if _, ok := wantTables[name]; ok {
			wantTables[name] = true
		}
	}
	for name, found := range wantTables {
		if !found {
			t.Errorf("missing table %s", name)
		}
	}
}

func TestHistorianStorePolicyMirrorIsImmutable(t *testing.T) {
	store, err := OpenHistorianStore(filepath.Join(t.TempDir(), "historian-v2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	config := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-17T10:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 3, 1); err != nil {
		t.Fatal(err)
	}
	if err := store.MirrorPolicy(context.Background(), config, 3, 1); err != nil {
		t.Fatalf("idempotent mirror: %v", err)
	}
	conflict := bytes.Replace(config, []byte(`"15s"`), []byte(`"30s"`), 1)
	if err := store.MirrorPolicy(context.Background(), conflict, 3, 1); err == nil {
		t.Fatal("expected same-revision checksum conflict")
	}
	var revisions, policies int
	_ = store.db.QueryRow(`SELECT count(*) FROM policy_revisions`).Scan(&revisions)
	_ = store.db.QueryRow(`SELECT count(*) FROM point_policies`).Scan(&policies)
	if revisions != 1 || policies != 1 {
		t.Fatalf("revisions=%d policies=%d", revisions, policies)
	}
}

func TestHistorianStorePolicyMirrorAcceptsOneSecondThirtyDayRetentionAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v2.sqlite")
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	config := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"1s","retentionDays":30,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-20T10:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var retention int
	if err := reopened.db.QueryRow(`SELECT retention_days FROM point_policies WHERE revision=1 AND point_id='UI-01'`).Scan(&retention); err != nil || retention != 30 {
		t.Fatalf("retention=%d err=%v", retention, err)
	}
}

func TestHistorianStoreMigratesV1RetentionConstraintWithoutDataLoss(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v1.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range historianSchemaV1 {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`PRAGMA user_version=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO policy_revisions(revision,namespace_revision,schema_id,config_sha256,config_bytes,observed_at_utc_ms,mirror_status) VALUES(1,0,'hist-v1',zeroblob(32),x'7b7d',1,'verified')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO point_policies(revision,point_id,generation,enabled,interval_ms,start_utc_ms,retention_days,hot_cache_hours) VALUES(1,'UI-01',1,1,15000,1,180,48)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var version, retention int
	if err := store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT retention_days FROM point_policies WHERE revision=1 AND point_id='UI-01'`).Scan(&retention); err != nil {
		t.Fatal(err)
	}
	if version != historianSchemaVersion || retention != 180 {
		t.Fatalf("version=%d retention=%d", version, retention)
	}
}

func TestHistorianStoreMigratesV2ActivationAndPruneQueue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v2.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range historianSchemaV1[:len(historianSchemaV1)-3] {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`PRAGMA user_version=2`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, table := range []string{"historian_activation", "retention_prune_queue"} {
		var count int
		if err := store.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("table=%s count=%d err=%v", table, count, err)
		}
	}
	var version int
	if err := store.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != historianSchemaVersion {
		t.Fatalf("version=%d err=%v", version, err)
	}
}

func TestHistorianStorePolicyMirrorRollsBackPartialChildren(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":2,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-17T10:00:00Z"},{"pointId":"AO-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"invalid","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-17T10:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 3, 1); err == nil {
		t.Fatal("expected invalid child policy error")
	}
	var revisions, policies int
	if err := store.db.QueryRow(`SELECT count(*) FROM policy_revisions`).Scan(&revisions); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM point_policies`).Scan(&policies); err != nil {
		t.Fatal(err)
	}
	if revisions != 0 || policies != 0 {
		t.Fatalf("revisions=%d policies=%d, partial mirror persisted", revisions, policies)
	}
}

func TestHistorianStoreHotBatchIsAtomicAndImmutable(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	valid := HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: 1_752_746_400_000, LastSampleUTCMS: 1_752_746_401_000, Value: 10, Min: 9, Max: 11, Sum: 30, Count: 3, WorstQuality: 0, Source: "io", PolicyRevision: 1}
	if err := store.InsertHotBatch(context.Background(), []HotSample{valid}); err != nil {
		t.Fatal(err)
	}
	changed := valid
	changed.Value = 11
	if err := store.InsertHotBatch(context.Background(), []HotSample{changed}); err == nil {
		t.Fatal("expected conflicting duplicate error")
	}
	var value float64
	_ = store.db.QueryRow(`SELECT value FROM hot_samples WHERE point_id='UI-01'`).Scan(&value)
	if value != 10 {
		t.Fatalf("value=%v, durable row overwritten", value)
	}
	invalid := valid
	invalid.PointID = "AO-01"
	invalid.BucketUTCMS++
	if err := store.InsertHotBatch(context.Background(), []HotSample{{PointID: "DO-01"}, invalid}); err == nil {
		t.Fatal("expected invalid batch failure")
	}
	var count int
	_ = store.db.QueryRow(`SELECT count(*) FROM hot_samples`).Scan(&count)
	if count != 1 {
		t.Fatalf("count=%d, partial batch committed", count)
	}
}

func TestHistorianStoreHotSeparatesGenerationsAndExactRetry(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	base := HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: 1_752_746_400_000, LastSampleUTCMS: 1_752_746_401_000, Value: 10, Min: 9, Max: 11, Sum: 30, Count: 3, WorstQuality: 0, Source: "io", PolicyRevision: 1}
	if err := store.InsertHotBatch(context.Background(), []HotSample{base}); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertHotBatch(context.Background(), []HotSample{base}); err != nil {
		t.Fatalf("exact retry: %v", err)
	}
	nextGeneration := base
	nextGeneration.Generation = 2
	if err := store.InsertHotBatch(context.Background(), []HotSample{nextGeneration}); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM hot_samples`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("count=%d, want separate rows per generation", count)
	}
}

func TestHistorianStoreHotRejectsOversizedBatch(t *testing.T) {
	store := openHistorianStoreTest(t)
	samples := make([]HotSample, historianHotBatchLimit+1)
	if err := store.InsertHotBatch(context.Background(), samples); err == nil {
		t.Fatal("expected oversized batch error")
	}
}

func TestHistorianStoreLastHotBucketIsGenerationAware(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	rows := []HotSample{
		{PointID: "UI-01", Generation: 1, BucketUTCMS: 15000, LastSampleUTCMS: 15001, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, WorstQuality: 0, Source: "io", PolicyRevision: 1},
		{PointID: "UI-01", Generation: 2, BucketUTCMS: 30000, LastSampleUTCMS: 30001, Value: 2, Min: 2, Max: 2, Sum: 2, Count: 1, WorstQuality: 0, Source: "io", PolicyRevision: 1},
	}
	if err := store.InsertHotBatch(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.LastHotBucket(context.Background(), "UI-01", 1)
	if err != nil || !ok || got != 15000 {
		t.Fatalf("bucket=%d ok=%v err=%v", got, ok, err)
	}
}

func TestHistorianStoreGapDuplicateIsIdempotent(t *testing.T) {
	store := openHistorianStoreTest(t)
	gap := HistoryGap{PointID: "UI-01", Generation: 1, FromUTCMS: 1_752_746_400_000, ToUTCMS: 1_752_746_415_000, Reason: "storage", Detail: "offline", CreatedAtUTCMS: time.Now().UTC().UnixMilli()}
	if err := store.InsertGap(context.Background(), gap); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertGap(context.Background(), gap); err != nil {
		t.Fatal(err)
	}
	var count int
	_ = store.db.QueryRow(`SELECT count(*) FROM history_gaps`).Scan(&count)
	if count != 1 {
		t.Fatalf("count=%d", count)
	}
}

func TestHistorianStoreGapPreservesReasonAndDetailIdentity(t *testing.T) {
	store := openHistorianStoreTest(t)
	base := HistoryGap{PointID: "UI-01", Generation: 1, FromUTCMS: 1_752_746_400_000, ToUTCMS: 1_752_746_415_000, Reason: "storage", Detail: "offline", CreatedAtUTCMS: time.Now().UTC().UnixMilli()}
	for _, gap := range []HistoryGap{base, func() HistoryGap { g := base; g.Detail = "full"; return g }(), func() HistoryGap { g := base; g.Reason = "queue"; return g }()} {
		if err := store.InsertGap(context.Background(), gap); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM history_gaps`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("count=%d, want distinct reason/detail evidence", count)
	}
}

func openHistorianStoreTest(t *testing.T) *HistorianStore {
	t.Helper()
	store, err := OpenHistorianStore(filepath.Join(t.TempDir(), "historian-v2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func mirrorHistorianTestPolicy(t *testing.T, store *HistorianStore) {
	t.Helper()
	config := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-17T10:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
}

func seedHistorianCutoverEvidenceTest(t *testing.T, store *HistorianStore, revision uint64) {
	t.Helper()
	var policyDigest []byte
	if err := store.db.QueryRow(`SELECT config_sha256 FROM policy_revisions WHERE revision=?`, revision).Scan(&policyDigest); err != nil {
		t.Fatal(err)
	}
	manifest := MigrationManifest{
		MigrationID: "activation-fixture", SourceIdentity: "fixture.sqlite",
		SourceSHA256: fmt.Sprintf("%064x", 1), PolicyRevision: revision,
		SchemaID: "hist-v1", SourceRowCount: 1, TimestampRuleVersion: 1, AliasRuleVersion: 1,
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifestDigest := sha256.Sum256(manifestJSON)
	if _, err := store.db.Exec(`INSERT OR IGNORE INTO migration_runs(migration_id,source_identity,source_sha256,namespace_revision,manifest_json,manifest_sha256,phase,cursor_json,backup_path,created_at_utc_ms,updated_at_utc_ms) VALUES(?,?,zeroblob(32),0,?,?,'verified',NULL,'fixture.sqlite',1,1)`, manifest.MigrationID, manifest.SourceIdentity, manifestJSON, manifestDigest[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT OR IGNORE INTO historian_legacy_quiesce(singleton,epoch,token_sha256,state,trend_db_path,stopped_at_utc_ms,migration_id,updated_at_utc_ms) VALUES(1,1,zeroblob(32),'consumed','fixture.sqlite',1,?,1)`, manifest.MigrationID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`INSERT OR IGNORE INTO historian_cutover_evidence(singleton,migration_id,policy_revision,policy_sha256,manifest_sha256,backup_path,backup_source_identity,backup_sha256,backup_schema_sha256,backup_byte_size,backup_quick_check,source_row_count,accepted_row_count,rejected_row_count,source_keyspace_sha256,outcome_sha256,quiesce_epoch,quiesce_token_sha256,verified_at_utc_ms) VALUES(1,?,?,?,?,?,?,zeroblob(32),zeroblob(32),1,'ok',1,1,0,zeroblob(32),zeroblob(32),1,zeroblob(32),1)`, manifest.MigrationID, revision, policyDigest, manifestDigest[:], "fixture.sqlite", manifest.SourceIdentity); err != nil {
		t.Fatal(err)
	}
}

func TestHistorianStoreReopenAndReplacementConnection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v2.sqlite")
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	store.db.SetMaxIdleConns(0)
	if err := store.db.Ping(); err != nil {
		t.Fatal(err)
	}
	for pragma, want := range map[string]string{"journal_mode": "wal", "synchronous": "2", "foreign_keys": "1", "busy_timeout": "5000", "trusted_schema": "0"} {
		var got string
		if err := store.db.QueryRow("PRAGMA " + pragma).Scan(&got); err != nil || got != want {
			t.Fatalf("replacement PRAGMA %s=%q err=%v", pragma, got, err)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var version int
	if err := reopened.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != historianSchemaVersion {
		t.Fatalf("version=%d err=%v", version, err)
	}
	if info, err := os.Stat(path); err != nil {
		t.Fatal(err)
	} else if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("mode=%v", info.Mode().Perm())
	}
	if info, err := os.Stat(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	} else if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("directory mode=%v", info.Mode().Perm())
	}
}

func TestHistorianStoreEscapesSQLiteURIPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian #1.sqlite")
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("stat requested database path: %v", err)
	}
}

func TestHistorianStoreRejectsMalformedDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v2.sqlite")
	if err := os.WriteFile(path, []byte("not a sqlite database"), 0o600); err != nil {
		t.Fatal(err)
	}
	if store, err := OpenHistorianStore(path); err == nil {
		_ = store.Close()
		t.Fatal("expected malformed database error")
	}
}

func TestHistorianStoreRejectsUnsupportedSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v2.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("PRAGMA user_version=99"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if store, err := OpenHistorianStore(path); err == nil {
		_ = store.Close()
		t.Fatal("expected unsupported schema error")
	}
}

func TestHistorianStoreEnforcesForeignKeys(t *testing.T) {
	store, err := OpenHistorianStore(filepath.Join(t.TempDir(), "historian-v2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, err = store.db.Exec(`INSERT INTO point_policies(revision,point_id,generation,enabled,interval_ms,start_utc_ms,retention_days,hot_cache_hours) VALUES(1,'UI-01',1,1,15000,1,180,48)`)
	if err == nil {
		t.Fatal("expected foreign key violation")
	}
}
