package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var errModbusApply = errors.New("không thể áp dụng cấu hình Modbus RTU; cấu hình cũ đã được phục hồi")

type modbusMutationResponse struct {
	Device *ModbusRTUDevice `json:"device,omitempty"`
	Point  *ModbusRTUPoint  `json:"point,omitempty"`
	Apply  ConfigPutResult  `json:"apply"`
}

func (a *App) handleListModbusDevices(w http.ResponseWriter, _ *http.Request) {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg.Devices)
}

func (a *App) handleCreateModbusDevice(w http.ResponseWriter, r *http.Request) {
	var device ModbusRTUDevice
	if err := decodeConfigBody(w, r, &device); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if strings.TrimSpace(device.DeviceID) == "" {
		device.DeviceID = "mbdev-" + requestID()[:8]
	}
	a.mutateModbusConfig(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		for _, current := range cfg.Devices {
			if strings.EqualFold(current.DeviceID, device.DeviceID) {
				return modbusMutationResponse{}, []configValidationError{{Path: "device_id", Message: "đã tồn tại"}}
			}
		}
		device = normalizeModbusDevice(device)
		cfg.Devices = append(cfg.Devices, device)
		return modbusMutationResponse{Device: &device}, nil
	})
}

func (a *App) handleUpdateModbusDevice(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var candidate ModbusRTUDevice
	if err := decodeConfigBody(w, r, &candidate); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	a.mutateModbusConfig(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		for i := range cfg.Devices {
			if cfg.Devices[i].DeviceID != id {
				continue
			}
			if candidate.DeviceID != "" && candidate.DeviceID != id {
				return modbusMutationResponse{}, []configValidationError{{Path: "device_id", Message: "không được đổi"}}
			}
			candidate.DeviceID = id
			candidate = normalizeModbusDevice(candidate)
			cfg.Devices[i] = candidate
			return modbusMutationResponse{Device: &candidate}, nil
		}
		return modbusMutationResponse{}, []configValidationError{{Path: "device_id", Message: "không tồn tại"}}
	})
}

func (a *App) handleDeleteModbusDevice(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	a.mutateModbusConfig(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		for _, point := range cfg.Points {
			if point.DeviceID == id {
				return modbusMutationResponse{}, []configValidationError{{Path: "device_id", Message: "hãy xoá các Point của thiết bị trước"}}
			}
		}
		for i := range cfg.Devices {
			if cfg.Devices[i].DeviceID == id {
				cfg.Devices = append(cfg.Devices[:i], cfg.Devices[i+1:]...)
				return modbusMutationResponse{}, nil
			}
		}
		return modbusMutationResponse{}, []configValidationError{{Path: "device_id", Message: "không tồn tại"}}
	})
}

func (a *App) handleListModbusPoints(w http.ResponseWriter, _ *http.Request) {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg.Points)
}

func (a *App) handleModbusDiagnostics(w http.ResponseWriter, r *http.Request) {
	reader, ok := a.core.(interface {
		ReadFieldbusTelemetry(context.Context) (FieldbusTelemetry, error)
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "không có nguồn telemetry fieldbus")
		return
	}
	telemetry, err := reader.ReadFieldbusTelemetry(r.Context())
	if err != nil || !telemetry.Published {
		writeError(w, http.StatusServiceUnavailable, "iobus chưa publish telemetry Modbus RTU")
		return
	}
	cfg, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	bySlave := map[int]string{}
	for _, device := range cfg.Devices {
		bySlave[device.SlaveID] = device.DeviceID
	}
	out := make([]ModbusRTUDiagnostics, 0, len(telemetry.Slaves))
	for _, item := range telemetry.Slaves {
		out = append(out, ModbusRTUDiagnostics{DeviceID: bySlave[int(item.Addr)], SlaveID: int(item.Addr), Online: item.Online,
			TotalPolls: item.TotalPolls, TotalErrors: item.TotalErrors, TimeoutErrors: item.TimeoutErrors,
			CRCErrors: item.CRCErrors, RetryAttempts: item.RetryAttempts, ConsecutiveErrors: item.ConsecutiveErrors, LastSeenMS: item.LastSeenMS})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *App) handleCreateModbusPoint(w http.ResponseWriter, r *http.Request) {
	var point ModbusRTUPoint
	if err := decodeConfigBody(w, r, &point); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if strings.TrimSpace(point.PointID) == "" {
		point.PointID = "MB-" + strings.ToUpper(requestID()[:8])
	}
	a.mutateModbusConfig(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		for _, current := range cfg.Points {
			if strings.EqualFold(current.PointID, point.PointID) {
				return modbusMutationResponse{}, []configValidationError{{Path: "point_id", Message: "đã tồn tại"}}
			}
		}
		point = normalizeModbusPoint(point)
		cfg.Points = append(cfg.Points, point)
		return modbusMutationResponse{Point: &point}, nil
	})
}

func (a *App) handleUpdateModbusPoint(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var candidate ModbusRTUPoint
	if err := decodeConfigBody(w, r, &candidate); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	a.mutateModbusConfig(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		for i := range cfg.Points {
			if cfg.Points[i].PointID != id {
				continue
			}
			if candidate.PointID != "" && candidate.PointID != id {
				return modbusMutationResponse{}, []configValidationError{{Path: "point_id", Message: "không được đổi khi đổi tên/tag"}}
			}
			candidate.PointID = id
			candidate = normalizeModbusPoint(candidate)
			cfg.Points[i] = candidate
			return modbusMutationResponse{Point: &candidate}, nil
		}
		return modbusMutationResponse{}, []configValidationError{{Path: "point_id", Message: "không tồn tại"}}
	})
}

func (a *App) handleDeleteModbusPoint(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	a.mutateModbusConfig(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		for i := range cfg.Points {
			if cfg.Points[i].PointID == id {
				cfg.Points = append(cfg.Points[:i], cfg.Points[i+1:]...)
				return modbusMutationResponse{}, nil
			}
		}
		return modbusMutationResponse{}, []configValidationError{{Path: "point_id", Message: "không tồn tại"}}
	})
}

func (a *App) mutateModbusConfig(w http.ResponseWriter, r *http.Request,
	mutation func(*ConfigFieldbus) (modbusMutationResponse, []configValidationError)) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	response, errs := mutation(&cfg)
	if len(errs) == 0 {
		errs = validateModbusRTUConfig(a, cfg)
	}
	if len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	result, err := a.applyModbusConfig(r, cfg)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	response.Apply = result
	writeJSON(w, http.StatusOK, response)
}

func normalizeModbusDevice(device ModbusRTUDevice) ModbusRTUDevice {
	device.DeviceID = strings.TrimSpace(device.DeviceID)
	device.DisplayName = strings.TrimSpace(device.DisplayName)
	device.RS485Port = strings.TrimSpace(device.RS485Port)
	device.Parity = strings.ToUpper(strings.TrimSpace(device.Parity))
	if device.Baud == 0 {
		device.Baud = 19200
	}
	if device.StopBit == 0 {
		device.StopBit = 1
	}
	if device.PollMS == 0 {
		device.PollMS = 1000
	}
	if device.TimeoutMS == 0 {
		device.TimeoutMS = 300
	}
	if device.Retry == 0 {
		device.Retry = 2
	}
	return device
}

func normalizeModbusPoint(point ModbusRTUPoint) ModbusRTUPoint {
	point.PointID = strings.TrimSpace(point.PointID)
	point.DeviceID = strings.TrimSpace(point.DeviceID)
	point.TagName = strings.TrimSpace(point.TagName)
	point.DisplayName = strings.TrimSpace(point.DisplayName)
	point.RegisterType = strings.ToLower(strings.TrimSpace(point.RegisterType))
	point.DataType = strings.ToLower(strings.TrimSpace(point.DataType))
	point.ByteOrder = strings.ToLower(strings.TrimSpace(point.ByteOrder))
	point.WordOrder = strings.ToLower(strings.TrimSpace(point.WordOrder))
	point.ReadWrite = strings.ToLower(strings.TrimSpace(point.ReadWrite))
	if point.ByteOrder == "" {
		point.ByteOrder = "big"
	}
	if point.WordOrder == "" {
		point.WordOrder = "high_low"
	}
	if point.ReadWrite == "" {
		point.ReadWrite = "read"
	}
	return point
}

func validStableModbusID(value string) bool {
	if len(value) < 1 || len(value) > 23 || !((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) {
		return false
	}
	for i := range value {
		ch := value[i]
		if !((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func validateModbusRTUConfig(a *App, cfg ConfigFieldbus) []configValidationError {
	var errs []configValidationError
	devices := make(map[string]ModbusRTUDevice, len(cfg.Devices))
	slaves := map[int]string{}
	var bus *ModbusRTUDevice
	for i, raw := range cfg.Devices {
		device := normalizeModbusDevice(raw)
		base := fmt.Sprintf("devices[%d]", i)
		if !validStableModbusID(device.DeviceID) {
			addConfigErr(&errs, base+".device_id", "phải dài 1..23 ký tự ASCII và bắt đầu bằng chữ")
		}
		if _, exists := devices[strings.ToLower(device.DeviceID)]; exists {
			addConfigErr(&errs, base+".device_id", "phải unique")
		}
		devices[strings.ToLower(device.DeviceID)] = device
		if _, _, err := normalizePointName(device.DisplayName); err != nil {
			addConfigErr(&errs, base+".display_name", err.Error())
		}
		if device.RS485Port == "" || len(device.RS485Port) > 128 {
			addConfigErr(&errs, base+".rs485_port", "bắt buộc và dài tối đa 128 byte")
		}
		if device.Baud < 1200 || device.Baud > 115200 {
			addConfigErr(&errs, base+".baud", "phải trong 1200..115200")
		}
		if device.Parity != "N" && device.Parity != "E" && device.Parity != "O" {
			addConfigErr(&errs, base+".parity", "phải là N, E hoặc O")
		}
		if device.StopBit != 1 && device.StopBit != 2 {
			addConfigErr(&errs, base+".stop_bit", "phải là 1 hoặc 2")
		}
		if device.SlaveID < 1 || device.SlaveID > 247 {
			addConfigErr(&errs, base+".slave_id", "phải trong 1..247")
		}
		if previous, exists := slaves[device.SlaveID]; exists {
			addConfigErr(&errs, base+".slave_id", "trùng với "+previous)
		} else {
			slaves[device.SlaveID] = device.DeviceID
		}
		if device.PollMS < 10 || device.PollMS > 60000 {
			addConfigErr(&errs, base+".poll_ms", "phải trong 10..60000 ms")
		}
		if device.TimeoutMS < 20 || device.TimeoutMS > 10000 {
			addConfigErr(&errs, base+".timeout_ms", "phải trong 20..10000 ms")
		}
		if device.Retry < 1 || device.Retry > 10 {
			addConfigErr(&errs, base+".retry", "phải trong 1..10")
		}
		if device.Enabled {
			if bus == nil {
				copy := device
				bus = &copy
			} else if bus.RS485Port != device.RS485Port || bus.Baud != device.Baud || bus.Parity != device.Parity || bus.StopBit != device.StopBit {
				addConfigErr(&errs, base, "mọi thiết bị enabled trên cùng master phải dùng chung RS485 port/baud/parity/stop bit")
			}
		}
	}

	tagOwners := map[string]string{}
	ioCfg, _ := readConfig(a, configGroupIO, ConfigIO{})
	vpCfg, _ := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	entries, _ := pointNamespaceEntries(ioCfg, vpCfg)
	for _, entry := range entries {
		_, key, err := normalizePointTag(entry.Tag)
		if err == nil {
			tagOwners[key] = entry.PointID
		}
	}
	pointIDs := map[string]string{}
	for i, raw := range cfg.Points {
		point := normalizeModbusPoint(raw)
		base := fmt.Sprintf("points[%d]", i)
		if !validStableModbusID(point.PointID) {
			addConfigErr(&errs, base+".point_id", "phải dài 1..23 ký tự ASCII, bắt đầu bằng chữ và không đổi khi rename")
		}
		idKey := strings.ToLower(point.PointID)
		if owner, exists := pointIDs[idKey]; exists {
			addConfigErr(&errs, base+".point_id", "trùng với "+owner)
		} else {
			pointIDs[idKey] = point.PointID
		}
		if _, exists := devices[strings.ToLower(point.DeviceID)]; !exists {
			addConfigErr(&errs, base+".device_id", "không tham chiếu thiết bị tồn tại")
		}
		if _, key, err := normalizePointTag(point.TagName); err != nil {
			addConfigErr(&errs, base+".tag_name", err.Error())
		} else if owner, exists := tagOwners[key]; exists {
			addConfigErr(&errs, base+".tag_name", "phải unique; đang thuộc "+owner)
		} else {
			tagOwners[key] = point.PointID
		}
		if _, _, err := normalizePointName(point.DisplayName); err != nil {
			addConfigErr(&errs, base+".display_name", err.Error())
		}
		switch point.RegisterType {
		case "coil", "discrete_input", "input_register", "holding_register":
		default:
			addConfigErr(&errs, base+".register_type", "không được hỗ trợ")
		}
		if point.Address < 0 || point.Address > 65535 {
			addConfigErr(&errs, base+".address", "phải trong 0..65535")
		}
		switch point.DataType {
		case "bool", "int16", "uint16", "int32", "uint32", "float32":
		default:
			addConfigErr(&errs, base+".data_type", "không được hỗ trợ")
		}
		if (point.RegisterType == "coil" || point.RegisterType == "discrete_input") && point.DataType != "bool" {
			addConfigErr(&errs, base+".data_type", "Coil/Discrete Input phải dùng bool")
		}
		if point.ByteOrder != "big" && point.ByteOrder != "little" {
			addConfigErr(&errs, base+".byte_order", "phải là big hoặc little")
		}
		if point.WordOrder != "high_low" && point.WordOrder != "low_high" {
			addConfigErr(&errs, base+".word_order", "phải là high_low hoặc low_high")
		}
		if point.Scale == 0 {
			addConfigErr(&errs, base+".scale", "không được bằng 0")
		}
		if point.ReadWrite != "read" && point.ReadWrite != "read_write" {
			addConfigErr(&errs, base+".read_write", "phải là read hoặc read_write")
		}
		if point.ReadWrite == "read_write" && point.RegisterType != "coil" && point.RegisterType != "holding_register" {
			addConfigErr(&errs, base+".read_write", "chỉ Coil/Holding Register được ghi")
		}
	}
	if len(cfg.Points) > 64 {
		addConfigErr(&errs, "points", "vượt KX_N_EXT=64")
	}
	return errs
}

func validateUnifiedPointTags(ioCfg ConfigIO, vpCfg ConfigVirtualPoints, fieldbus ConfigFieldbus) []configValidationError {
	entries, errs := pointNamespaceEntries(ioCfg, vpCfg)
	owners := map[string]pointNamespaceEntry{}
	for _, entry := range entries {
		_, key, err := normalizePointTag(entry.Tag)
		if err != nil {
			continue
		}
		owners[key] = entry
	}
	for i, point := range fieldbus.Points {
		_, key, err := normalizePointTag(point.TagName)
		if err != nil {
			continue
		}
		if owner, exists := owners[key]; exists {
			errs = append(errs, configValidationError{Path: fmt.Sprintf("points[%d].tag_name", i), Message: "phải unique", Reason: "point_tag_conflict", PointID: point.PointID, ConflictPointID: owner.PointID, ConflictPath: owner.TagPath, Tag: point.TagName})
		} else {
			owners[key] = pointNamespaceEntry{PointID: point.PointID, TagPath: fmt.Sprintf("points[%d].tag_name", i), Tag: point.TagName}
		}
	}
	return errs
}

func (a *App) applyModbusConfig(r *http.Request, cfg ConfigFieldbus) (ConfigPutResult, error) {
	previous, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	for i := range cfg.Devices {
		cfg.Devices[i] = normalizeModbusDevice(cfg.Devices[i])
	}
	for i := range cfg.Points {
		cfg.Points[i] = normalizeModbusPoint(cfg.Points[i])
	}
	cfg.Revision++
	cfg.Checksum = ""
	cfg.Slaves = nil
	if len(cfg.Devices) > 0 {
		for _, device := range cfg.Devices {
			if !device.Enabled {
				continue
			}
			if cfg.RS485 == nil {
				cfg.RS485 = map[string]any{"device": device.RS485Port, "baud": device.Baud, "parity": device.Parity, "stop": device.StopBit}
			}
			cfg.Slaves = append(cfg.Slaves, map[string]any{
				"addr": device.SlaveID, "profile": filepath.Join(a.cfg.ConfigDir, "profiles", device.DeviceID+".json"),
				"name": device.DeviceID, "poll_ms": device.PollMS, "timeout_ms": device.TimeoutMS, "retry": device.Retry,
			})
		}
	}
	checksumBytes, _ := json.Marshal(cfg)
	sum := sha256.Sum256(checksumBytes)
	cfg.Checksum = hex.EncodeToString(sum[:])
	configData, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return ConfigPutResult{}, err
	}
	configData = append(configData, '\n')

	type fileSnapshot struct {
		path   string
		data   []byte
		exists bool
	}
	snapshots := []fileSnapshot{}
	restore := func() {
		for i := len(snapshots) - 1; i >= 0; i-- {
			if snapshots[i].exists {
				_ = writeConfigFileAtomic(snapshots[i].path, snapshots[i].data, 0o644)
			} else {
				_ = os.Remove(snapshots[i].path)
			}
		}
	}
	write := func(path string, data []byte) error {
		old, readErr := os.ReadFile(path)
		snapshots = append(snapshots, fileSnapshot{path: path, data: old, exists: readErr == nil})
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		return writeConfigFileAtomic(path, data, 0o644)
	}
	remove := func(path string) error {
		old, readErr := os.ReadFile(path)
		if readErr != nil && !os.IsNotExist(readErr) {
			return readErr
		}
		snapshots = append(snapshots, fileSnapshot{path: path, data: old, exists: readErr == nil})
		if os.IsNotExist(readErr) {
			return nil
		}
		return os.Remove(path)
	}
	for _, device := range cfg.Devices {
		profile, profileErr := buildModbusProfile(device, cfg.Points)
		if profileErr != nil {
			restore()
			return ConfigPutResult{}, profileErr
		}
		if err := write(filepath.Join(a.cfg.ConfigDir, "profiles", device.DeviceID+".json"), profile); err != nil {
			restore()
			return ConfigPutResult{}, err
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
		if err := remove(filepath.Join(a.cfg.ConfigDir, "profiles", oldDevice.DeviceID+".json")); err != nil {
			restore()
			return ConfigPutResult{}, err
		}
	}
	if err := write(a.configPath(configGroupFieldbus.file), configData); err != nil {
		restore()
		return ConfigPutResult{}, err
	}
	applied, warnings := a.dispatchReload(reloadRestartIobus)
	if !applied {
		restore()
		_, _ = a.dispatchReload(reloadRestartIobus)
		return ConfigPutResult{}, fmt.Errorf("%w: %s", errModbusApply, strings.Join(warnings, "; "))
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "config.modbus-rtu", configGroupFieldbus.file, "success", r.RemoteAddr)
	return ConfigPutResult{Result: "success", Applied: true, Reload: reloadRestartIobus, Warnings: warnings, Revision: cfg.Revision, Checksum: cfg.Checksum}, nil
}

func buildModbusProfile(device ModbusRTUDevice, points []ModbusRTUPoint) ([]byte, error) {
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
