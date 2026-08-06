package modbusrtu

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestApply_OfflineParams_WiredToJSON(t *testing.T) {
	var writtenPath string
	var writtenData []byte

	persister := Persister{
		ConfigDir:  "/tmp/modbus_test",
		ConfigPath: "/tmp/modbus_test/fieldbus.conf",
		WriteFile: func(path string, data []byte, mode os.FileMode) error {
			if path == "/tmp/modbus_test/fieldbus.conf" {
				writtenPath = path
				writtenData = data
			}
			return nil
		},
		Reload: func() (bool, []string) {
			return true, nil
		},
	}

	cfg := Config{
		OfflineProbeMs: 5000,
		Devices: []Device{
			{
				DeviceID:           "MTR-01",
				DisplayName:        "Electric Meter 01",
				Enabled:            true,
				RS485Port:          "/dev/rs485-1",
				Baud:               19200,
				Parity:             "N",
				StopBit:            1,
				SlaveID:            1,
				PollMS:             1000,
				TimeoutMS:          300,
				Retry:              1,
				OfflineAfterErrors: 3,
			},
		},
		Points: []Point{
			{
				PointID:      "m1_v",
				DeviceID:     "MTR-01",
				TagName:      "MB_M1_V",
				DisplayName:  "Voltage",
				RegisterType: "holding_register",
				Address:      100,
				DataType:     "float32",
				ByteOrder:    "big",
				WordOrder:    "high_low",
				Scale:        1.0,
				Offset:       0,
				ReadWrite:    "read",
				Enabled:      true,
			},
		},
	}

	res, err := persister.Apply(cfg, Config{})
	if err != nil {
		t.Fatalf("Persister.Apply failed: %v", err)
	}

	if res.Config.OfflineProbeMs != 5000 {
		t.Errorf("expected OfflineProbeMs=5000, got %d", res.Config.OfflineProbeMs)
	}

	if len(writtenData) == 0 {
		t.Fatalf("no data written to %s", writtenPath)
	}

	var parsed struct {
		RS485  map[string]any   `json:"rs485"`
		Slaves []map[string]any `json:"slaves"`
	}
	if err := json.Unmarshal(writtenData, &parsed); err != nil {
		t.Fatalf("failed to unmarshal written fieldbus.conf: %v", err)
	}

	if probe, ok := parsed.RS485["offline_probe_ms"].(float64); !ok || int(probe) != 5000 {
		t.Errorf("expected rs485.offline_probe_ms = 5000, got %v", parsed.RS485["offline_probe_ms"])
	}

	if len(parsed.Slaves) != 1 {
		t.Fatalf("expected 1 slave, got %d", len(parsed.Slaves))
	}

	if afterErr, ok := parsed.Slaves[0]["offline_after_errors"].(float64); !ok || int(afterErr) != 3 {
		t.Errorf("expected slaves[0].offline_after_errors = 3, got %v", parsed.Slaves[0]["offline_after_errors"])
	}
}

func TestValidateConfig_256Points(t *testing.T) {
	cfg := Config{
		Devices: []Device{
			{
				DeviceID:  "DEV1",
				Enabled:   true,
				RS485Port: "/dev/rs485-1",
				Baud:      9600,
				Parity:    "N",
				StopBit:   1,
				SlaveID:   1,
				PollMS:    1000,
				TimeoutMS: 300,
			},
		},
	}

	// Create 256 valid points
	for i := 0; i < 256; i++ {
		cfg.Points = append(cfg.Points, Point{
			PointID:      fmt.Sprintf("pt_%d", i),
			DeviceID:     "DEV1",
			TagName:      fmt.Sprintf("MB_TAG_%d", i),
			DisplayName:  fmt.Sprintf("Point %d", i),
			RegisterType: "holding_register",
			Address:      i,
			DataType:     "uint16",
			ByteOrder:    "big",
			WordOrder:    "high_low",
			Scale:        1.0,
			ReadWrite:    "read",
			Enabled:      true,
		})
	}

	errs := Validate(cfg, nil)
	for _, e := range errs {
		if e.Path == "points" {
			t.Errorf("unexpected validation error for 256 points: %s: %s", e.Path, e.Message)
		}
	}

	// Add 257th point
	cfg.Points = append(cfg.Points, Point{
		PointID:      "pt_256",
		DeviceID:     "DEV1",
		TagName:      "MB_TAG_256",
		DisplayName:  "Point 256",
		RegisterType: "holding_register",
		Address:      256,
		DataType:     "uint16",
		ByteOrder:    "big",
		WordOrder:    "high_low",
		Scale:        1.0,
		ReadWrite:    "read",
		Enabled:      true,
	})

	errs = Validate(cfg, nil)
	foundLimitError := false
	for _, e := range errs {
		if e.Path == "points" && e.Code == CodeCapacityExceeded {
			foundLimitError = true
			break
		}
	}
	if !foundLimitError {
		t.Errorf("expected CAPACITY_EXCEEDED for 257 points, but got: %v", errs)
	}
}
