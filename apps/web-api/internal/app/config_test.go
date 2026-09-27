package app

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigUsesCanonicalAlarmSettingsPath(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256")
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
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256")
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
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.NetcfgSock != "/run/mkddc-netcfg/netcfg.sock" {
		t.Fatalf("NetcfgSock = %q", cfg.NetcfgSock)
	}
}

func TestLoadConfigKeepsProgrammingRevAOffByDefault(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256")
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
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256")
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
	t.Setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256")
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

// F-FR-04: JWT_SECRET ngắn hơn 32 byte phải làm web từ chối khởi động — đúng secret
// 2 ký tự mà install.sh cũ sinh trên bo Foxlinx 2026-09-27.
func TestLoadConfigRejectsShortJWTSecret(t *testing.T) {
	for _, secret := range []string{"a3", "0123456789abcdef0123456789abcde"} {
		t.Setenv("JWT_SECRET", secret)
		if _, err := LoadConfig(); err == nil {
			t.Fatalf("JWT_SECRET dài %d byte phải bị từ chối", len(secret))
		}
	}
	t.Setenv("JWT_SECRET", "0123456789abcdef0123456789abcdef")
	if _, err := LoadConfig(); err != nil {
		t.Fatalf("JWT_SECRET đúng 32 byte phải được chấp nhận: %v", err)
	}
}
