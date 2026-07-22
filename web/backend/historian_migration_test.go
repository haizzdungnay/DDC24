package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestHistorianNativeBackupIncludesCommittedRows(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "legacy.sqlite")
	db, err := sql.Open("sqlite", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; CREATE TABLE samples(ts INTEGER, point_id TEXT, value REAL, quality INTEGER); INSERT INTO samples VALUES(1,'UI-01',2.5,0)`); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(dir, "backup.sqlite")
	if err := NativeSQLiteBackup(context.Background(), db, destination, 4); err != nil {
		t.Fatal(err)
	}
	backup, err := sql.Open("sqlite", destination)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var count int
	if err := backup.QueryRow(`SELECT count(*) FROM samples`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	if _, err := db.Exec(`INSERT INTO samples VALUES(2,'UI-02',3.5,0)`); err != nil {
		t.Fatalf("source not writable after backup: %v", err)
	}
	if err := backup.QueryRow(`SELECT count(*) FROM samples`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("backup changed after source write: count=%d err=%v", count, err)
	}
}

func TestHistorianNativeBackupRejectsExistingDestination(t *testing.T) {
	dir := t.TempDir()
	destination := filepath.Join(dir, "backup.sqlite")
	if err := os.WriteFile(destination, []byte("evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "source.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := NativeSQLiteBackup(context.Background(), db, destination, 1); err == nil {
		t.Fatal("expected existing destination rejection")
	}
	if got, err := os.ReadFile(destination); err != nil || string(got) != "evidence" {
		t.Fatalf("destination=%q err=%v", got, err)
	}
}

func TestHistorianNativeBackupCancellationKeepsPartialEvidenceAndPoolUsable(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "source.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE samples(ts INTEGER); INSERT INTO samples VALUES(1)`); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	destination := filepath.Join(dir, "backup.sqlite")
	if err := NativeSQLiteBackup(ctx, db, destination, 1); err == nil {
		t.Fatal("expected cancellation")
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("completed destination exists after cancellation: %v", err)
	}
	partials, err := filepath.Glob(destination + ".partial-*")
	if err != nil || len(partials) != 1 {
		t.Fatalf("partials=%v err=%v", partials, err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("source pool unusable: %v", err)
	}
}

func TestHistorianNativeBackupReturnsVerifiedEvidence(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "source.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE samples(ts INTEGER PRIMARY KEY, point_id TEXT) STRICT; INSERT INTO samples VALUES(1,'UI-01')`); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(dir, "backup.sqlite")
	evidence, err := CreateNativeSQLiteBackup(context.Background(), db, destination, 1)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	if evidence.Path != destination || evidence.SHA256 != hex.EncodeToString(digest[:]) || evidence.SchemaSHA256 == "" || evidence.QuickCheck != "ok" || evidence.ByteSize != int64(len(data)) {
		t.Fatalf("evidence=%+v", evidence)
	}
}

func TestHistorianMigrationManifestIsFrozen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")
	manifest := MigrationManifest{MigrationID: "m1", SourceIdentity: "legacy-trend.sqlite", SourceSHA256: strings.Repeat("a", 64), NamespaceRevision: 3, PolicyRevision: 2, SchemaID: "hist-v1", Mappings: []MigrationMapping{{LegacyStorageID: "AI1", CanonicalPointID: "UI-01", Generation: 1}}}
	if err := WriteMigrationManifest(path, manifest); err != nil {
		t.Fatal(err)
	}
	loaded, err := ReadMigrationManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.NamespaceRevision != 3 || loaded.Mappings[0].CanonicalPointID != "UI-01" {
		t.Fatalf("loaded=%+v", loaded)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 1
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadMigrationManifest(path); err == nil {
		t.Fatal("expected manifest checksum failure")
	}
}

func TestHistorianMigrationManifestRejectsOverwriteAndChangedResume(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")
	digest := strings.Repeat("a", 64)
	manifest := MigrationManifest{MigrationID: "m1", SourceIdentity: "legacy-trend.sqlite", SourceSHA256: digest, NamespaceRevision: 3, PolicyRevision: 2, SchemaID: "hist-v1", Mappings: []MigrationMapping{{LegacyStorageID: "AI1", CanonicalPointID: "UI-01", Generation: 1}}}
	if err := WriteMigrationManifest(path, manifest); err != nil {
		t.Fatal(err)
	}
	changed := manifest
	changed.SourceSHA256 = strings.Repeat("b", 64)
	if err := WriteMigrationManifest(path, changed); err == nil {
		t.Fatal("expected immutable manifest conflict")
	}
	if _, err := ReadMigrationManifestForResume(path, changed.SourceSHA256, changed.SchemaID); err == nil {
		t.Fatal("expected changed source checksum rejection")
	}
	if loaded, err := ReadMigrationManifestForResume(path, manifest.SourceSHA256, manifest.SchemaID); err != nil || loaded.MigrationID != "m1" {
		t.Fatalf("loaded=%+v err=%v", loaded, err)
	}
}

func TestHistorianMigrationManifestRejectsInvalidFrozenMapping(t *testing.T) {
	base := MigrationManifest{MigrationID: "m1", SourceIdentity: "legacy", SourceSHA256: strings.Repeat("a", 64), SchemaID: "hist-v1", TimestampRuleVersion: 1, AliasRuleVersion: 1}
	for name, mapping := range map[string]MigrationMapping{
		"empty legacy":    {CanonicalPointID: "UI-01", Generation: 1},
		"empty canonical": {LegacyStorageID: "AI1", Generation: 1},
		"zero generation": {LegacyStorageID: "AI1", CanonicalPointID: "UI-01"},
	} {
		t.Run(name, func(t *testing.T) {
			manifest := base
			manifest.Mappings = []MigrationMapping{mapping}
			if err := WriteMigrationManifest(filepath.Join(t.TempDir(), "manifest.json"), manifest); err == nil {
				t.Fatal("expected invalid mapping rejection")
			}
		})
	}
}
