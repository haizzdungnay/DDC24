package main

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestHistorianActivationRequiresDurableCutoverEvidence(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), config, 1, 1); err != nil {
		t.Fatal(err)
	}
	coordinator := NewHistorianActivationCoordinator(filepath.Join(t.TempDir(), "historian.conf"), store)
	if err := coordinator.Prepare(context.Background(), HistorianActivationPlan{
		PolicyRevision: 1, Config: config, StableUTCMS: 1,
		LegacyQuiesced: true, MigrationVerified: true,
	}); err == nil {
		t.Fatal("expected activation to reject caller-supplied migration proof")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("activation marker state=%q err=%v", state, err)
	}
}

func TestHistorianActivationUsesVerifiedEvidenceInsteadOfBoolean(t *testing.T) {
	store := openHistorianStoreTest(t)
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "legacy.sqlite")
	legacy, err := sql.Open("sqlite", legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	legacy.SetMaxOpenConns(1)
	legacy.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = legacy.Close() })
	if _, err := legacy.Exec(`CREATE TABLE samples(ts INTEGER, point_id TEXT, value REAL, quality INTEGER); INSERT INTO samples VALUES(1000,'UI-01',2.5,0)`); err != nil {
		t.Fatal(err)
	}
	backupPath := filepath.Join(dir, "legacy-backup.sqlite")
	backup, err := CreateNativeSQLiteBackup(context.Background(), legacy, backupPath, 1)
	if err != nil {
		t.Fatal(err)
	}
	config := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-20T10:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 1, 1); err != nil {
		t.Fatal(err)
	}
	manifest := MigrationManifest{
		MigrationID: "evidence-m1", SourceIdentity: backup.SourceIdentity,
		SourceSHA256: backup.SHA256, NamespaceRevision: 1,
		PolicyRevision: 1, SchemaID: "hist-v1", SourceRowCount: 1,
		TimestampRuleVersion: 1, AliasRuleVersion: 1,
		Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}},
	}
	if err := store.ApplyLegacyMigrationChunk(context.Background(), manifest, []LegacySampleRow{{TS: 1000, PointID: "UI-01", Value: 2.5, Quality: 0}}, 1, true); err != nil {
		t.Fatal(err)
	}
	var token [32]byte
	token[0] = 1
	proof, err := store.RecordLegacyHistorianQuiesce(context.Background(), token, legacyPath, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordHistorianCutoverEvidenceWithQuiesce(context.Background(), manifest.MigrationID, backup, proof, 2); err != nil {
		t.Fatal(err)
	}
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	if err := coordinator.Prepare(context.Background(), HistorianActivationPlan{
		PolicyRevision: 1, Config: config, StableUTCMS: 1,
		LegacyQuiesced: true, MigrationVerified: false,
	}); err != nil {
		t.Fatalf("durable evidence should satisfy activation: %v", err)
	}
	var migrationVerified, pruneEnabled int
	if err := store.db.QueryRow(`SELECT migration_verified,prune_enabled FROM historian_activation WHERE singleton=1`).Scan(&migrationVerified, &pruneEnabled); err != nil {
		t.Fatal(err)
	}
	if migrationVerified != 1 || pruneEnabled != 0 {
		t.Fatalf("prepared marker migration_verified=%d prune_enabled=%d", migrationVerified, pruneEnabled)
	}
	if _, err := store.db.Exec(`UPDATE migration_runs SET phase='copying' WHERE migration_id=?`, manifest.MigrationID); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Commit(context.Background()); err == nil {
		t.Fatal("expected changed migration evidence to block commit")
	}
	authority, err := coordinator.Authority(context.Background())
	if err != nil || authority.WriterV2 || authority.QueryV2 {
		t.Fatalf("pending authority=%+v err=%v", authority, err)
	}
	if _, err := store.db.Exec(`UPDATE migration_runs SET phase='verified' WHERE migration_id=?`, manifest.MigrationID); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Commit(context.Background()); err != nil {
		t.Fatalf("commit after evidence restoration: %v", err)
	}
	if err := store.RecordHistorianCutoverEvidenceWithQuiesce(context.Background(), manifest.MigrationID, backup, proof, 2); err != nil {
		t.Fatalf("idempotent evidence record: %v", err)
	}
	authority, err = coordinator.Authority(context.Background())
	if err != nil || !authority.WriterV2 || !authority.QueryV2 {
		t.Fatalf("active authority=%+v err=%v", authority, err)
	}
	if err := os.WriteFile(policyPath, []byte(`{"revision":1,"corrupt":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	authority, err = coordinator.Authority(context.Background())
	if err != nil || authority.WriterV2 || authority.QueryV2 || authority.LegacyWriterAllowed {
		t.Fatalf("authority must fail closed on active config mismatch: %+v err=%v", authority, err)
	}
	if err := os.WriteFile(policyPath, config, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DELETE FROM historian_cutover_evidence WHERE singleton=1`); err != nil {
		t.Fatal(err)
	}
	authority, err = coordinator.Authority(context.Background())
	if err != nil || authority.WriterV2 || authority.QueryV2 || authority.PruneEnabled {
		t.Fatalf("authority must fail closed without evidence: %+v err=%v", authority, err)
	}
}
