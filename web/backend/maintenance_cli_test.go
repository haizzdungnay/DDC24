package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseHistorianMaintenanceCLIRequiresExplicitArm(t *testing.T) {
	base := []string{"--manifest", "manifest.json", "--final-manifest", "final-manifest.json", "--backup", "final.sqlite", "--stable-utc", "2026-07-21T05:00:00Z", "--window-id", "maintenance-1"}
	if _, err := parseHistorianMaintenanceCLI(base); err == nil {
		t.Fatal("expected missing confirmation rejection")
	}
	args := append(base, "--confirm", "ACTIVATE-HISTORIAN-V2")
	parsed, err := parseHistorianMaintenanceCLI(args)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.ManifestPath != "manifest.json" || parsed.FinalManifestPath != "final-manifest.json" || parsed.BackupPath != "final.sqlite" || parsed.WindowID != "maintenance-1" {
		t.Fatalf("parsed=%+v", parsed)
	}
}

func TestHistorianMaintenanceCLIPreflightRequiresOfflineContainedPaths(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{ConfigDir: dir}
	opts := historianMaintenanceCLIOptions{
		WindowID: "maintenance-1", BackupPath: filepath.Join(dir, "historian-v2-migration", "final.sqlite"),
		FinalManifestPath: filepath.Join(dir, "historian-v2-migration", "final.json"),
	}
	manifest := MigrationManifest{MigrationID: "maintenance-1"}
	if err := validateHistorianMaintenancePreflight(cfg, opts, manifest); err != nil {
		t.Fatal(err)
	}
	release, err := createServicePresenceFile(filepath.Join(dir, "mkddc-web.running"))
	if err != nil {
		t.Fatal(err)
	}
	if err := validateHistorianMaintenancePreflight(cfg, opts, manifest); err == nil {
		t.Fatal("expected running service rejection")
	}
	release()
	if _, err := os.Stat(filepath.Join(dir, "mkddc-web.running")); !os.IsNotExist(err) {
		t.Fatalf("presence file remains: %v", err)
	}
	opts.BackupPath = filepath.Join(dir, "outside.sqlite")
	if err := validateHistorianMaintenancePreflight(cfg, opts, manifest); err == nil {
		t.Fatal("expected out-of-root backup rejection")
	}
	opts.BackupPath = filepath.Join(dir, "historian-v2-migration", "final.sqlite")
	manifest.MigrationID = "different"
	if err := validateHistorianMaintenancePreflight(cfg, opts, manifest); err == nil {
		t.Fatal("expected window mismatch rejection")
	}
}

func TestParseHistorianMaintenanceCLIRejectsUnsafeValues(t *testing.T) {
	base := []string{"--manifest", "manifest.json", "--final-manifest", "final-manifest.json", "--backup", "final.sqlite", "--stable-utc", "0", "--window-id", "maintenance-1", "--confirm", "ACTIVATE-HISTORIAN-V2"}
	if _, err := parseHistorianMaintenanceCLI(base); err == nil {
		t.Fatal("expected invalid stable UTC rejection")
	}
	base[9] = ""
	if _, err := parseHistorianMaintenanceCLI(base); err == nil {
		t.Fatal("expected empty window rejection")
	}
	base[9] = "maintenance-1"
	base[len(base)-1] = strings.Repeat("x", len("ACTIVATE-HISTORIAN-V2"))
	if _, err := parseHistorianMaintenanceCLI(base); err == nil {
		t.Fatal("expected confirmation rejection")
	}
}
