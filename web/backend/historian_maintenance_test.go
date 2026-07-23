package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHistorianMaintenanceCutoverOrdersDurableSteps(t *testing.T) {
	app, policy, cancel := historianMaintenanceAppTest(t)
	defer cancel()
	anchor := time.Now().UTC().Add(2 * time.Second).UnixMilli()
	result, err := app.RunHistorianMaintenanceCutover(context.Background(), HistorianMaintenanceRequest{
		Manifest: MigrationManifest{
			MigrationID: "maintenance-1", NamespaceRevision: 1, PolicyRevision: 1,
			SchemaID: "hist-v1", TimestampRuleVersion: 1, AliasRuleVersion: 1,
			Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}},
		},
		PolicyConfig: policy, BackupPath: filepath.Join(t.TempDir(), "final.sqlite"), StableUTCMS: anchor,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Activated || result.Quiesce.Epoch == 0 || result.Backup.SHA256 == "" || result.MaintenanceGaps != 1 {
		t.Fatalf("result=%+v", result)
	}
	if !app.LegacyHistorianWritersQuiesced() || !app.historianAuthority.WriterV2 || !app.historianAuthority.QueryV2 || app.historianAuthority.LegacyWriterAllowed {
		t.Fatalf("authority=%+v quiesced=%v", app.historianAuthority, app.LegacyHistorianWritersQuiesced())
	}
	if err := app.trends.InsertBatch(context.Background(), []Sample{{TS: 2000, PointID: "UI-01", Value: 2}}); !errors.Is(err, ErrLegacyHistorianQuiesced) {
		t.Fatalf("legacy write err=%v", err)
	}
	var quiesceState, activationState string
	if err := app.historianV2.db.QueryRow(`SELECT state FROM historian_legacy_quiesce WHERE singleton=1`).Scan(&quiesceState); err != nil || quiesceState != "consumed" {
		t.Fatalf("quiesce state=%q err=%v", quiesceState, err)
	}
	if err := app.historianV2.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&activationState); err != nil || activationState != "active" {
		t.Fatalf("activation state=%q err=%v", activationState, err)
	}
	var gaps int
	if err := app.historianV2.db.QueryRow(`SELECT count(*) FROM history_gaps WHERE reason='restart' AND detail='maintenance-cutover:maintenance-1'`).Scan(&gaps); err != nil || gaps != 1 {
		t.Fatalf("gaps=%d err=%v", gaps, err)
	}
}

func TestHistorianMaintenanceBackupFailureResumesLegacyWithoutMarker(t *testing.T) {
	app, policy, cancel := historianMaintenanceAppTest(t)
	defer cancel()
	badBackup := filepath.Join(t.TempDir(), "final.sqlite")
	if err := os.WriteFile(badBackup, []byte("not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := app.RunHistorianMaintenanceCutover(context.Background(), HistorianMaintenanceRequest{
		Manifest:     MigrationManifest{MigrationID: "maintenance-fail", PolicyRevision: 1, SchemaID: "hist-v1", TimestampRuleVersion: 1, AliasRuleVersion: 1},
		PolicyConfig: policy, BackupPath: badBackup, StableUTCMS: time.Now().UTC().Add(time.Second).UnixMilli(),
	})
	if err == nil {
		t.Fatal("expected invalid final backup failure")
	}
	if app.LegacyHistorianWritersQuiesced() {
		t.Fatal("legacy writers remained quiesced before prepare")
	}
	if err := app.trends.InsertBatch(context.Background(), []Sample{{TS: 2000, PointID: "UI-01", Value: 2}}); err != nil {
		t.Fatalf("legacy write did not resume: %v", err)
	}
	var marker int
	if err := app.historianV2.db.QueryRow(`SELECT count(*) FROM historian_activation`).Scan(&marker); err != nil || marker != 0 {
		t.Fatalf("activation markers=%d err=%v", marker, err)
	}
	var state string
	if err := app.historianV2.db.QueryRow(`SELECT state FROM historian_legacy_quiesce WHERE singleton=1`).Scan(&state); err != nil || state != "abandoned" {
		t.Fatalf("quiesce state=%q err=%v", state, err)
	}
}

func TestLegacyResumeInvalidatesStaleCutoverEvidence(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	if err := store.InvalidateLegacyHistorianQuiesceForResume(context.Background(), 2); err != nil {
		t.Fatal(err)
	}
	var evidence int
	if err := store.db.QueryRow(`SELECT count(*) FROM historian_cutover_evidence`).Scan(&evidence); err != nil || evidence != 0 {
		t.Fatalf("evidence=%d err=%v", evidence, err)
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM historian_legacy_quiesce WHERE singleton=1`).Scan(&state); err != nil || state != "abandoned" {
		t.Fatalf("state=%q err=%v", state, err)
	}
}

func historianMaintenanceAppTest(t *testing.T) (*App, []byte, context.CancelFunc) {
	t.Helper()
	dir := t.TempDir()
	trend, err := OpenTrendStore(filepath.Join(dir, "trend.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = trend.Close() })
	if err := trend.InsertBatch(context.Background(), []Sample{{TS: 1000, PointID: "UI-01", Value: 1.5, Quality: 0}}); err != nil {
		t.Fatal(err)
	}
	historian, err := OpenHistorianStore(filepath.Join(dir, "historian-v2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = historian.Close() })
	policy := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"1s","retentionDays":30,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-01-01T00:00:00Z"}]}`)
	if err := historian.MirrorPolicy(context.Background(), policy, 1, 1); err != nil {
		t.Fatal(err)
	}
	app := &App{
		trends: trend, historianV2: historian,
		historianActivation: NewHistorianActivationCoordinator(filepath.Join(dir, "historian.conf"), historian),
		historianAuthority:  HistorianRuntimeAuthority{State: "legacy", LegacyWriterAllowed: true},
		legacyState:         "stopped",
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := app.StartLegacyHistorianWriters(ctx); err != nil {
		cancel()
		t.Fatal(err)
	}
	return app, policy, cancel
}
