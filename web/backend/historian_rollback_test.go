package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifyHistorianRollbackCompatibilityReadOnlyLegacyFixture(t *testing.T) {
	app, _, cancel := historianMaintenanceAppTest(t)
	defer cancel()
	// The maintenance fixture is legacy before cutover; verify that state first.
	legacyPath := app.historianV2.path
	if err := app.historianV2.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := VerifyHistorianRollbackCompatibility(context.Background(), legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if result.SchemaVersion != historianSchemaVersion || !result.LegacyWriterAllowed || result.WriterV2 {
		t.Fatalf("legacy result=%+v", result)
	}
}

func TestHistorianRollbackVerifyCommandEmitsBoundedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian.sqlite")
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	if err := runHistorianRollbackVerifyCommand([]string{"--db", path}, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"schemaVersion":5`) || !strings.Contains(output.String(), `"legacyWriterAllowed":true`) {
		t.Fatalf("output=%s", output.String())
	}
	if err := runHistorianRollbackVerifyCommand(nil, &output); err == nil {
		t.Fatal("expected missing fixture rejection")
	}
}

func TestVerifyHistorianRollbackCompatibilityReadOnlyActiveFixture(t *testing.T) {
	app, policy, cancel := historianMaintenanceAppTest(t)
	defer cancel()
	_, err := app.RunHistorianMaintenanceCutover(context.Background(), HistorianMaintenanceRequest{
		Manifest: MigrationManifest{
			MigrationID: "rollback-active", NamespaceRevision: 1, PolicyRevision: 1,
			SchemaID: "hist-v1", TimestampRuleVersion: 1, AliasRuleVersion: 1,
			Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}},
		},
		PolicyConfig: policy, BackupPath: filepath.Join(t.TempDir(), "final.sqlite"), StableUTCMS: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	path := app.historianV2.path
	if err := app.historianV2.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	beforeSHA := sha256.Sum256(before)
	result, err := VerifyHistorianRollbackCompatibility(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if !result.WriterV2 || !result.QueryV2 || result.LegacyWriterAllowed || !result.EvidenceBound || result.State != "active" {
		t.Fatalf("active result=%+v", result)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	afterSHA := sha256.Sum256(after)
	if beforeSHA != afterSHA {
		t.Fatal("read-only rollback verifier mutated the fixture")
	}
}

func TestVerifyHistorianRollbackCompatibilityRejectsFutureSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian.sqlite")
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version=6`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyHistorianRollbackCompatibility(context.Background(), path); err == nil {
		t.Fatal("expected future schema rejection")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}
