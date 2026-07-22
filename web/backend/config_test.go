package main

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
	if cfg.NetcfgSock != "/run/mkddc/netcfg.sock" {
		t.Fatalf("NetcfgSock = %q", cfg.NetcfgSock)
	}
}
