package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestManualTimeCommandUsesConfiguredCivilTimezone(t *testing.T) {
	instant, err := time.Parse(time.RFC3339, "2026-07-20T02:34:00Z")
	if err != nil {
		t.Fatal(err)
	}
	got, err := manualTimeCommandValue(instant, "Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	if got != "2026-07-20 10:34:00" {
		t.Fatalf("got=%q", got)
	}
}

func TestPersistTimezoneNameReplacesStaleDistroValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timezone")
	if err := os.WriteFile(path, []byte("Asia/Shanghai\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := persistTimezoneName(path, "Asia/Ho_Chi_Minh"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != "Asia/Ho_Chi_Minh\n" {
		t.Fatalf("timezone file=%q", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o644 {
		t.Fatalf("timezone mode=%v", info.Mode().Perm())
	}
}
