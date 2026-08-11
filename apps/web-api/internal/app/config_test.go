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
