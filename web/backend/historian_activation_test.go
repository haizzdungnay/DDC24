package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestHistorianActivationCommitPublishesPolicyAndSQLiteMarker(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-20T10:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 3, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	plan := HistorianActivationPlan{PolicyRevision: 1, Config: config, StableUTCMS: 1, LegacyQuiesced: true, MigrationVerified: true, PruneEnabled: true}
	if err := coordinator.Prepare(context.Background(), plan); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(policyPath + ".prepared"); err != nil {
		t.Fatalf("prepared policy missing: %v", err)
	}
	if err := coordinator.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(policyPath)
	if err != nil || string(got) != string(config) {
		t.Fatalf("active policy mismatch err=%v got=%s", err, got)
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); err != nil || state != "active" {
		t.Fatalf("activation state=%q err=%v", state, err)
	}
	if _, err := os.Stat(policyPath + ".prepared.meta"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("prepared metadata was not cleaned: %v", err)
	}
}

func TestHistorianActivationReconcileAfterFilesystemCommitFault(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	coordinator.activationFault = func(stage string) error {
		if stage == activationFaultAfterFilesystemCommit {
			return errors.New("simulated power cut")
		}
		return nil
	}
	if err := coordinator.Prepare(context.Background(), HistorianActivationPlan{PolicyRevision: 1, Config: config, StableUTCMS: 1, MigrationVerified: true, LegacyQuiesced: true, PruneEnabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Commit(context.Background()); err == nil {
		t.Fatal("expected simulated commit fault")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); err != nil || state != "prepared" {
		t.Fatalf("state=%q err=%v", state, err)
	}
	coordinator.activationFault = nil
	if err := coordinator.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); err != nil || state != "active" {
		t.Fatalf("reconciled state=%q err=%v", state, err)
	}
	if _, err := os.Stat(policyPath + ".prepared.meta"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("metadata remains after reconcile: %v", err)
	}
}

func TestHistorianActivationAfterPrepareFaultRemainsPendingUntilForwardCommit(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	coordinator.activationFault = func(stage string) error {
		if stage == activationFaultAfterPrepare {
			return errors.New("simulated power cut after prepare")
		}
		return nil
	}
	plan := HistorianActivationPlan{PolicyRevision: 1, Config: config, StableUTCMS: 1, MigrationVerified: true, LegacyQuiesced: true}
	if err := coordinator.Prepare(context.Background(), plan); err == nil {
		t.Fatal("expected after-prepare fault")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); err != nil || state != "prepared" {
		t.Fatalf("state=%q err=%v", state, err)
	}
	restarted := NewHistorianActivationCoordinator(policyPath, store)
	if err := restarted.Reconcile(context.Background()); !errors.Is(err, ErrHistorianActivationPending) {
		t.Fatalf("reconcile err=%v, want pending", err)
	}
	if err := restarted.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); err != nil || state != "active" {
		t.Fatalf("forward state=%q err=%v", state, err)
	}
}

func TestHistorianActivationAfterSQLiteActiveFaultReconcilesForwardOnly(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	coordinator.activationFault = func(stage string) error {
		if stage == activationFaultAfterSQLiteActive {
			return errors.New("simulated power cut after sqlite active")
		}
		return nil
	}
	plan := HistorianActivationPlan{PolicyRevision: 1, Config: config, StableUTCMS: 1, MigrationVerified: true, LegacyQuiesced: true}
	if err := coordinator.Prepare(context.Background(), plan); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Commit(context.Background()); err == nil {
		t.Fatal("expected after-sqlite-active fault")
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); err != nil || state != "active" {
		t.Fatalf("state=%q err=%v", state, err)
	}
	restarted := NewHistorianActivationCoordinator(policyPath, store)
	if err := restarted.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(policyPath + ".prepared.meta"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("prepared metadata remains after forward reconcile: %v", err)
	}
	authority, err := restarted.Authority(context.Background())
	if err != nil || authority.State != "active" || !authority.WriterV2 || authority.LegacyWriterAllowed {
		t.Fatalf("authority=%+v err=%v", authority, err)
	}
}

func TestHistorianActivationReconcileRefusesUncommittedPreparedPolicy(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	if err := coordinator.Prepare(context.Background(), HistorianActivationPlan{PolicyRevision: 1, Config: config, StableUTCMS: 1, MigrationVerified: true, LegacyQuiesced: true, PruneEnabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Reconcile(context.Background()); !errors.Is(err, ErrHistorianActivationPending) {
		t.Fatalf("err=%v", err)
	}
	var state string
	if err := store.db.QueryRow(`SELECT state FROM historian_activation WHERE singleton=1`).Scan(&state); err != nil || state != "prepared" {
		t.Fatalf("state=%q err=%v", state, err)
	}
}

func TestHistorianActivationStableUTCHorizonIsMonotonic(t *testing.T) {
	store := openHistorianStoreTest(t)
	config := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	coordinator := NewHistorianActivationCoordinator(filepath.Join(t.TempDir(), "historian.conf"), store)
	if err := coordinator.Prepare(context.Background(), HistorianActivationPlan{PolicyRevision: 1, Config: config, StableUTCMS: 1, MigrationVerified: true, LegacyQuiesced: true}); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.AdvanceStableUTC(context.Background(), 2); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.AdvanceStableUTC(context.Background(), 1); err == nil {
		t.Fatal("expected backward UTC horizon rejection")
	}
	authority, err := coordinator.Authority(context.Background())
	if err != nil || authority.StableUTCMS != 2 {
		t.Fatalf("authority=%+v err=%v", authority, err)
	}
}

func TestHistorianAuthorityAcceptsOnlyLatestVerifiedPostCutoverPolicy(t *testing.T) {
	store := openHistorianStoreTest(t)
	activationConfig := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), activationConfig, 1, 1); err != nil {
		t.Fatal(err)
	}
	seedHistorianCutoverEvidenceTest(t, store, 1)
	dir := t.TempDir()
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	if err := coordinator.Prepare(context.Background(), HistorianActivationPlan{PolicyRevision: 1, Config: activationConfig, StableUTCMS: 1, MigrationVerified: true, LegacyQuiesced: true}); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}

	currentConfig := []byte(`{"_schema_version":1,"revision":2,"points":[]}`)
	if err := os.WriteFile(policyPath, currentConfig, 0o600); err != nil {
		t.Fatal(err)
	}
	if authority, err := coordinator.Authority(context.Background()); err != nil || authority.State != "degraded" || authority.QueryV2 || authority.WriterV2 {
		t.Fatalf("unmirrored authority=%+v err=%v", authority, err)
	}

	if err := store.MirrorPolicy(context.Background(), currentConfig, 1, 2); err != nil {
		t.Fatal(err)
	}
	if authority, err := coordinator.Authority(context.Background()); err != nil || authority.State != "active" || !authority.QueryV2 || !authority.WriterV2 || authority.LegacyWriterAllowed {
		t.Fatalf("verified current authority=%+v err=%v", authority, err)
	}

	newerConfig := []byte(`{"_schema_version":1,"revision":3,"points":[]}`)
	if err := store.MirrorPolicy(context.Background(), newerConfig, 1, 3); err != nil {
		t.Fatal(err)
	}
	if authority, err := coordinator.Authority(context.Background()); err != nil || authority.State != "degraded" || authority.QueryV2 || authority.WriterV2 {
		t.Fatalf("rolled-back authority=%+v err=%v", authority, err)
	}
}
