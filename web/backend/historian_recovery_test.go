package main

import (
	"context"
	"database/sql"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestHistorianRecoveryPreflightCleanAndMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "historian-v2.sqlite")
	if result, err := HistorianRecoveryPreflight(path); err != nil || result.Action != historianRecoveryMissing {
		t.Fatalf("missing result=%+v err=%v", result, err)
	}
	store, err := OpenHistorianStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := HistorianRecoveryPreflight(path); err != nil || result.Action != historianRecoveryClean {
		t.Fatalf("clean result=%+v err=%v", result, err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatalf("preflight changed original: err=%v", err)
	}
}

func TestHistorianRecoveryPreflightPreservesDamagedFamily(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "historian-v2.sqlite")
	for suffix, data := range map[string][]byte{"": []byte("not sqlite"), "-wal": []byte("wal evidence"), "-shm": []byte("shm evidence")} {
		if err := os.WriteFile(path+suffix, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	result, err := HistorianRecoveryPreflight(path)
	if err == nil || result.Action != historianRecoveryDisabled || result.EvidenceDir == "" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	for _, name := range []string{"historian-v2.sqlite", "historian-v2.sqlite-wal", "historian-v2.sqlite-shm"} {
		if _, err := os.Stat(filepath.Join(result.EvidenceDir, name)); err != nil {
			t.Fatalf("missing evidence %s: %v", name, err)
		}
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "not sqlite" {
		t.Fatalf("original changed: %q err=%v", data, err)
	}
	second, secondErr := HistorianRecoveryPreflight(path)
	if secondErr == nil || second.EvidenceDir == result.EvidenceDir {
		t.Fatalf("second=%+v err=%v", second, secondErr)
	}
}

func TestHistorianReadinessFailureKeepsLegacyHistory(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	cfg.TrendDBPath = filepath.Join(t.TempDir(), "trend.sqlite")
	cfg.HistorianV2DBPath = filepath.Join(t.TempDir(), "historian-v2.sqlite")
	if err := os.WriteFile(cfg.HistorianV2DBPath, []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	var logs strings.Builder
	app, err := NewApp(cfg, log.New(io.MultiWriter(&logs), "", 0), trendCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if app.historianV2 != nil || app.historianV2Ready || app.trends == nil {
		t.Fatalf("v2=%v ready=%v legacy=%v", app.historianV2, app.historianV2Ready, app.trends)
	}
	ts := int64(1_752_746_400)
	if err := app.trends.InsertBatch(context.Background(), []Sample{{TS: ts, PointID: "UI-01", Value: 21.5}}); err != nil {
		t.Fatal(err)
	}
	rows, err := app.trends.Query(context.Background(), []string{"UI-01"}, ts, ts)
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows=%+v err=%v logs=%s", rows, err, logs.String())
	}
}

func TestHistorianReadinessUsesSeparatePaths(t *testing.T) {
	configDir := t.TempDir()
	cfg := Config{ConfigDir: configDir, TrendDBPath: filepath.Join(t.TempDir(), "trend.sqlite")}
	cfg.deriveHistorianV2Paths()
	if cfg.HistorianV2DBPath == cfg.TrendDBPath || filepath.Dir(cfg.HistorianV2DBPath) != configDir || filepath.Dir(cfg.HistorianV2ArchiveDir) != configDir || filepath.Dir(cfg.HistorianV2MigrationDir) != configDir {
		t.Fatalf("cfg=%+v", cfg)
	}
}

func TestHistorianReadinessOpensCleanStoreWithoutStartingWriter(t *testing.T) {
	users := writeTestUsers(t, "admin123", RoleAdmin)
	cfg := testConfig(t, users)
	cfg.HistorianV2DBPath = filepath.Join(t.TempDir(), "historian-v2.sqlite")
	app, err := NewApp(cfg, log.New(io.Discard, "", 0), fakeCore{}, fakeOS{})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if !app.historianV2Ready || app.historianV2 == nil {
		t.Fatalf("ready=%v store=%v", app.historianV2Ready, app.historianV2)
	}
	var revisions int
	if err := app.historianV2.db.QueryRow(`SELECT count(*) FROM policy_revisions WHERE revision=0`).Scan(&revisions); err != nil || revisions != 1 {
		t.Fatalf("revisions=%d err=%v", revisions, err)
	}
}

func TestHistorianRecoveryPreflightDoesNotCreateSQLiteOnCorruptInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian-v2.sqlite")
	if err := os.WriteFile(path, []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, _ = HistorianRecoveryPreflight(path)
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var check string
	if err := db.QueryRow(`PRAGMA quick_check`).Scan(&check); err == nil {
		t.Fatalf("corrupt DB became writable/valid: %q", check)
	}
}

func TestHistorianRecoveryPublishesVerifiedCandidateAfterEvidence(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "historian-v2.sqlite")
	if err := os.WriteFile(path, []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	candidate := path + ".recovery-candidate"
	db, err := sql.Open("sqlite", candidate)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE recovered(value TEXT); INSERT INTO recovered VALUES('ok')`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := HistorianRecoveryPreflight(path)
	if err != nil || result.Action != historianRecoveryClean || result.EvidenceDir == "" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	recovered, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	var value string
	if err := recovered.QueryRow(`SELECT value FROM recovered`).Scan(&value); err != nil || value != "ok" {
		t.Fatalf("value=%q err=%v", value, err)
	}
	broken, err := os.ReadFile(filepath.Join(result.EvidenceDir, filepath.Base(path)))
	if err != nil || string(broken) != "broken" {
		t.Fatalf("evidence=%q err=%v", broken, err)
	}
	second, err := HistorianRecoveryPreflight(path)
	if err != nil || second.Action != historianRecoveryClean || second.EvidenceDir != "" {
		t.Fatalf("second=%+v err=%v", second, err)
	}
}
