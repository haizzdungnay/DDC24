package modbusrtu

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var ErrApply = errors.New("không thể áp dụng cấu hình Modbus RTU; cấu hình cũ đã được phục hồi")

type FileWriter func(string, []byte, os.FileMode) error
type ReloadFunc func() (bool, []string)

type Persister struct {
	ConfigDir  string
	ConfigPath string
	WriteFile  FileWriter
	Reload     ReloadFunc
}

type ApplyResult struct {
	Config   Config
	Warnings []string
}

func (p Persister) Apply(cfg, previous Config) (ApplyResult, error) {
	if p.WriteFile == nil || p.Reload == nil {
		return ApplyResult{}, errors.New("modbus persister dependencies are required")
	}
	for i := range cfg.Devices {
		cfg.Devices[i] = NormalizeDevice(cfg.Devices[i])
	}
	for i := range cfg.Points {
		cfg.Points[i] = NormalizePoint(cfg.Points[i])
	}
	cfg.Revision++
	cfg.Checksum = ""
	cfg.Slaves = nil
	for _, device := range cfg.Devices {
		if !device.Enabled {
			continue
		}
		if cfg.RS485 == nil {
			cfg.RS485 = map[string]any{"device": device.RS485Port, "baud": device.Baud, "parity": device.Parity, "stop": device.StopBit}
		}
		if cfg.OfflineProbeMs > 0 {
			cfg.RS485["offline_probe_ms"] = cfg.OfflineProbeMs
		}
		slaveMap := map[string]any{
			"addr": device.SlaveID, "profile": filepath.Join(p.ConfigDir, "profiles", device.DeviceID+".json"),
			"name": device.DeviceID, "poll_ms": device.PollMS, "timeout_ms": device.TimeoutMS, "retry": device.Retry,
		}
		if device.OfflineAfterErrors > 0 {
			slaveMap["offline_after_errors"] = device.OfflineAfterErrors
		}
		cfg.Slaves = append(cfg.Slaves, slaveMap)
	}
	checksumBytes, _ := json.Marshal(cfg)
	sum := sha256.Sum256(checksumBytes)
	cfg.Checksum = hex.EncodeToString(sum[:])
	configData, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return ApplyResult{}, err
	}
	configData = append(configData, '\n')

	type snapshot struct {
		path   string
		data   []byte
		exists bool
	}
	var snapshots []snapshot
	restore := func() {
		for i := len(snapshots) - 1; i >= 0; i-- {
			if snapshots[i].exists {
				_ = p.WriteFile(snapshots[i].path, snapshots[i].data, 0o644)
			} else {
				_ = os.Remove(snapshots[i].path)
			}
		}
	}
	write := func(path string, data []byte) error {
		old, readErr := os.ReadFile(path)
		snapshots = append(snapshots, snapshot{path: path, data: old, exists: readErr == nil})
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		return p.WriteFile(path, data, 0o644)
	}
	remove := func(path string) error {
		old, readErr := os.ReadFile(path)
		if readErr != nil && !os.IsNotExist(readErr) {
			return readErr
		}
		snapshots = append(snapshots, snapshot{path: path, data: old, exists: readErr == nil})
		if os.IsNotExist(readErr) {
			return nil
		}
		return os.Remove(path)
	}
	for _, device := range cfg.Devices {
		profile, err := BuildProfile(device, cfg.Points)
		if err != nil {
			restore()
			return ApplyResult{}, err
		}
		if err := write(filepath.Join(p.ConfigDir, "profiles", device.DeviceID+".json"), profile); err != nil {
			restore()
			return ApplyResult{}, err
		}
	}
	currentDevices := make(map[string]struct{}, len(cfg.Devices))
	for _, device := range cfg.Devices {
		currentDevices[device.DeviceID] = struct{}{}
	}
	for _, oldDevice := range previous.Devices {
		if _, keep := currentDevices[oldDevice.DeviceID]; keep {
			continue
		}
		if err := remove(filepath.Join(p.ConfigDir, "profiles", oldDevice.DeviceID+".json")); err != nil {
			restore()
			return ApplyResult{}, err
		}
	}
	if err := write(p.ConfigPath, configData); err != nil {
		restore()
		return ApplyResult{}, err
	}
	applied, warnings := p.Reload()
	if !applied {
		restore()
		_, _ = p.Reload()
		return ApplyResult{}, fmt.Errorf("%w: %s", ErrApply, strings.Join(warnings, "; "))
	}
	return ApplyResult{Config: cfg, Warnings: warnings}, nil
}

func BuildProfile(device Device, points []Point) ([]byte, error) {
	rows := make([]map[string]any, 0)
	for _, point := range points {
		if !point.Enabled || point.DeviceID != device.DeviceID {
			continue
		}
		fc := map[string]int{"coil": 1, "discrete_input": 2, "holding_register": 3, "input_register": 4}[point.RegisterType]
		count := 1
		if point.DataType == "int32" || point.DataType == "uint32" || point.DataType == "float32" {
			count = 2
		}
		order := "AB"
		if count == 2 {
			switch {
			case point.ByteOrder == "little" && point.WordOrder == "high_low":
				order = "BADC"
			case point.ByteOrder == "big" && point.WordOrder == "low_high":
				order = "CDAB"
			case point.ByteOrder == "little" && point.WordOrder == "low_high":
				order = "DCBA"
			default:
				order = "ABCD"
			}
		} else if point.ByteOrder == "little" {
			order = "BA"
		}
		rows = append(rows, map[string]any{"name": point.PointID, "fc": fc, "addr": point.Address, "count": count, "type": point.DataType, "byte_order": order, "scale": point.Scale, "offset": point.Offset, "writable": point.ReadWrite == "read_write"})
	}
	sort.SliceStable(rows, func(i, j int) bool { return fmt.Sprint(rows[i]["name"]) < fmt.Sprint(rows[j]["name"]) })
	profile := map[string]any{"profile_id": device.DeviceID, "vendor": "user", "description": device.DisplayName, "default_baud": device.Baud, "points": rows}
	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}
