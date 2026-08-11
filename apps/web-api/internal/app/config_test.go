package app

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigUsesCanonicalAlarmSettingsPath(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough")
	t.Setenv("CONFIG_DIR", filepath.Join(t.TempDir(), "runtime"))

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.AlarmConfPath != defaultAlarmSettingsConf {
		t.Fatalf("AlarmConfPath = %q; want %q", cfg.AlarmConfPath, defaultAlarmSettingsConf)
	}
}

func TestLoadConfigAllowsAlarmSettingsOverride(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough")
	want := filepath.Join(t.TempDir(), "alarm_settings.conf")
	t.Setenv("ALARM_SETTINGS_CONF", want)

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.AlarmConfPath != want {
		t.Fatalf("AlarmConfPath = %q; want %q", cfg.AlarmConfPath, want)
	}
}

func TestLoadConfigUsesDedicatedNetcfgSocket(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.NetcfgSock != "/run/mkddc-netcfg/netcfg.sock" {
		t.Fatalf("NetcfgSock = %q", cfg.NetcfgSock)
	}
}

func TestLoadConfigKeepsProgrammingRevAOffByDefault(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough")
	t.Setenv("PROGRAMMING_REV_A", "")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.ProgrammingRevA {
		t.Fatal("ProgrammingRevA = true; muốn mặc định false")
	}
}

func TestLoadConfigEnablesProgrammingRevAExplicitly(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough")
	t.Setenv("PROGRAMMING_REV_A", "true")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if !cfg.ProgrammingRevA {
		t.Fatal("ProgrammingRevA = false; muốn true khi flag được bật rõ ràng")
	}
}

func TestLoadConfigDerivesAndOverridesProgrammingStorePaths(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough")
	configDir := filepath.Join(t.TempDir(), "config")
	t.Setenv("CONFIG_DIR", configDir)
	t.Setenv("PROGRAMMING_DB", "")
	t.Setenv("PROGRAMMING_BACKUP_DIR", "")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProgrammingDBPath != filepath.Join(configDir, "programming", "programming-v1.sqlite") ||
		cfg.ProgrammingBackupDir != filepath.Join(configDir, "programming", "programming-backups") {
		t.Fatalf("Programming paths=%q/%q", cfg.ProgrammingDBPath, cfg.ProgrammingBackupDir)
	}
	if cfg.ProgrammingStateDir != "/data/mkddc/programming" ||
		cfg.ProgrammingArtifactDir != "/data/mkddc/programming/artifacts" ||
		cfg.ProgrammingScratchDir != "/data/mkddc/programming/scratch" ||
		cfg.ProgrammingCompilerPath != "/usr/sbin/mkddc-st-compile" {
		t.Fatalf("Programming worker paths=%q/%q/%q compiler=%q", cfg.ProgrammingStateDir, cfg.ProgrammingArtifactDir, cfg.ProgrammingScratchDir, cfg.ProgrammingCompilerPath)
	}
	dbPath := filepath.Join(t.TempDir(), "custom.sqlite")
	backupDir := filepath.Join(t.TempDir(), "custom-backups")
	t.Setenv("PROGRAMMING_DB", dbPath)
	t.Setenv("PROGRAMMING_BACKUP_DIR", backupDir)
	cfg, err = LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProgrammingDBPath != dbPath || cfg.ProgrammingBackupDir != backupDir {
		t.Fatalf("Programming override=%q/%q", cfg.ProgrammingDBPath, cfg.ProgrammingBackupDir)
	}
}
