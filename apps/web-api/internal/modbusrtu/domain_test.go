package modbusrtu

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func validConfig() Config {
	return Config{Devices: []Device{{DeviceID: "rtu-1", DisplayName: "RTU 1", Enabled: true, RS485Port: "/dev/ttyS2", Baud: 9600, Parity: "N", StopBit: 1, SlaveID: 1, PollMS: 1000, TimeoutMS: 300, Retry: 2}}, Points: []Point{{PointID: "MB_TEMP", DeviceID: "rtu-1", TagName: "Room Temp", DisplayName: "Room temperature", RegisterType: "holding_register", Address: 1, DataType: "float32", ByteOrder: "big", WordOrder: "high_low", Scale: 1, ReadWrite: "read", Enabled: true}}}
}

func TestValidateAndProfile(t *testing.T) {
	cfg := validConfig()
	if errs := Validate(cfg, map[string]string{}); len(errs) != 0 {
		t.Fatalf("Validate = %+v", errs)
	}
	data, err := BuildProfile(cfg.Devices[0], cfg.Points)
	if err != nil || len(data) == 0 {
		t.Fatalf("BuildProfile = %d/%v", len(data), err)
	}
	cfg.Points[0].TagName = "existing"
	if errs := Validate(cfg, map[string]string{"existing": "UI-01"}); len(errs) == 0 {
		t.Fatal("xung đột tag không bị chặn")
	}
}

func TestPersisterRollsBackWhenReloadFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fieldbus.conf")
	if err := os.WriteFile(path, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	reloads := 0
	p := Persister{ConfigDir: dir, ConfigPath: path, WriteFile: os.WriteFile, Reload: func() (bool, []string) { reloads++; return false, []string{"restart failed"} }}
	_, err := p.Apply(validConfig(), Config{})
	if !errors.Is(err, ErrApply) {
		t.Fatalf("err = %v", err)
	}
	data, readErr := os.ReadFile(path)
	if readErr != nil || string(data) != "old\n" {
		t.Fatalf("rollback = %q/%v", data, readErr)
	}
	if reloads != 2 {
		t.Fatalf("reloads = %d", reloads)
	}
}
