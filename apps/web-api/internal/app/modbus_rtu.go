package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	webModbus "mkddc-web/internal/modbusrtu"
)

var errModbusApply = webModbus.ErrApply

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

type ModbusWriteTestRequest struct {
	PointID string  `json:"point_id"`
	Value   float64 `json:"value"`
}

type ModbusWriteTestResponse struct {
	PointID      string  `json:"point_id"`
	AppliedValue float64 `json:"applied_value"`
	Status       string  `json:"status"`
	Message      string  `json:"message,omitempty"`
}

func (a *App) handleModbusWriteTest(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || principal.Role != RoleAdmin {
		writeError(w, http.StatusForbidden, "chỉ vai trò Admin được thực hiện ghi thử Modbus RTU")
		return
	}

	var req ModbusWriteTestRequest
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	req.PointID = strings.TrimSpace(req.PointID)
	if req.PointID == "" {
		writeValidationErrors(w, []configValidationError{{Path: "point_id", Message: "bắt buộc"}})
		return
	}

	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var foundPoint *ModbusRTUPoint
	for i := range cfg.Points {
		if strings.EqualFold(cfg.Points[i].PointID, req.PointID) {
			foundPoint = &cfg.Points[i]
			break
		}
	}
	if foundPoint == nil {
		writeValidationErrors(w, []configValidationError{{Path: "point_id", Message: "không tồn tại trong cấu hình Modbus RTU"}})
		return
	}
	if foundPoint.ReadWrite != "read_write" {
		writeValidationErrors(w, []configValidationError{{Path: "point_id", Message: "chỉ Point có quyền read_write mới được ghi"}})
		return
	}

	writer, ok := a.core.(interface {
		WritePoint(context.Context, string, any, uint32, bool, string) (PointDTO, error)
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "lỗi ghi thử: core client không hỗ trợ WritePoint")
		return
	}

	pointDTO, err := writer.WritePoint(r.Context(), foundPoint.PointID, req.Value, 0, false, principal.Username)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Sprintf("lỗi ghi thử xuống iobus/core: %v", err))
		return
	}

	user := principal.Username
	a.audit.Change(user, "modbus.write-test", foundPoint.PointID, "success", r.RemoteAddr)

	val, _ := pointFloat(pointDTO.Value)
	writeJSON(w, http.StatusOK, ModbusWriteTestResponse{
		PointID:      foundPoint.PointID,
		AppliedValue: float64(val),
		Status:       "success",
		Message:      "lệnh ghi thử đã được gửi thành công xuống iobus",
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
	return webModbus.NormalizeDevice(device)
}

func normalizeModbusPoint(point ModbusRTUPoint) ModbusRTUPoint {
	return webModbus.NormalizePoint(point)
}

func validStableModbusID(value string) bool {
	return webModbus.ValidStableID(value)
}

func validateModbusRTUConfig(a *App, cfg ConfigFieldbus) []configValidationError {
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
	domainErrs := webModbus.Validate(cfg, tagOwners)
	errs := make([]configValidationError, 0, len(domainErrs))
	for _, err := range domainErrs {
		addConfigErr(&errs, err.Path, err.Message)
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
	result, err := (webModbus.Persister{
		ConfigDir:  a.cfg.ConfigDir,
		ConfigPath: a.configPath(configGroupFieldbus.file),
		WriteFile:  writeConfigFileAtomic,
		Reload:     func() (bool, []string) { return a.dispatchReload(reloadRestartIobus) },
	}).Apply(cfg, previous)
	if err != nil {
		return ConfigPutResult{}, err
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "config.modbus-rtu", configGroupFieldbus.file, "success", r.RemoteAddr)
	return ConfigPutResult{Result: "success", Applied: true, Reload: reloadRestartIobus, Warnings: result.Warnings, Revision: result.Config.Revision, Checksum: result.Config.Checksum}, nil
}

func buildModbusProfile(device ModbusRTUDevice, points []ModbusRTUPoint) ([]byte, error) {
	return webModbus.BuildProfile(device, points)
}

type modbusOverview struct {
	TotalDevices int    `json:"total_devices"`
	Online       int    `json:"online"`
	Offline      int    `json:"offline"`
	FaultConfig  int    `json:"fault_config"`
	Revision     int    `json:"revision"`
	Checksum     string `json:"checksum"`
}

type modbusBusInfo struct {
	BusID          string `json:"bus_id"`
	DisplayName    string `json:"display_name"`
	Port           string `json:"port"`
	PortAlias      string `json:"port_alias"`
	OpenState      string `json:"open_state"`
	Baud           int    `json:"baud"`
	Parity         string `json:"parity"`
	DataBits       int    `json:"data_bits"`
	StopBits       int    `json:"stop_bits"`
	TotalDevices   int    `json:"total_devices"`
	OnlineDevices  int    `json:"online_devices"`
	PollLatencyP50 int    `json:"poll_latency_p50_ms"`
	PollLatencyP95 int    `json:"poll_latency_p95_ms"`
	TimeoutErrors  int    `json:"timeout_errors"`
	CrcErrors      int    `json:"crc_errors"`
	Utilization    int    `json:"bus_utilization_percent"`
}

type modbusEventItem struct {
	Timestamp string `json:"timestamp"`
	BusID     string `json:"bus_id"`
	DeviceID  string `json:"device_id"`
	Message   string `json:"message"`
	Level     string `json:"level"`
}

func (a *App) getModbusDiagnostics(ctx context.Context) ([]ModbusRTUDiagnostics, error) {
	reader, ok := a.core.(interface {
		ReadFieldbusTelemetry(context.Context) (FieldbusTelemetry, error)
	})
	if !ok {
		return nil, fmt.Errorf("no telemetry reader")
	}
	telemetry, err := reader.ReadFieldbusTelemetry(ctx)
	if err != nil || !telemetry.Published {
		return nil, fmt.Errorf("telemetry unavailable")
	}
	cfg, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	bySlave := map[int]string{}
	for _, d := range cfg.Devices {
		bySlave[d.SlaveID] = d.DeviceID
	}
	out := make([]ModbusRTUDiagnostics, 0, len(telemetry.Slaves))
	for _, dev := range telemetry.Slaves {
		out = append(out, ModbusRTUDiagnostics{
			DeviceID:          bySlave[int(dev.Addr)],
			SlaveID:           int(dev.Addr),
			Online:            dev.Online,
			TotalPolls:        dev.TotalPolls,
			TotalErrors:       dev.TotalErrors,
			TimeoutErrors:     dev.TimeoutErrors,
			CRCErrors:         dev.CRCErrors,
			RetryAttempts:     dev.RetryAttempts,
			ConsecutiveErrors: dev.ConsecutiveErrors,
			LastSeenMS:        dev.LastSeenMS,
		})
	}
	return out, nil
}

func (a *App) handleGetModbusOverview(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	diag, _ := a.getModbusDiagnostics(r.Context())

	diagMap := make(map[string]*ModbusRTUDiagnostics)
	for i := range diag {
		diagMap[diag[i].DeviceID] = &diag[i]
	}

	online := 0
	offline := 0
	fault := 0

	for _, d := range cfg.Devices {
		if !d.Enabled {
			continue
		}
		if dDiag, found := diagMap[d.DeviceID]; found {
			if dDiag.Online {
				online++
			} else if dDiag.ConsecutiveErrors > 0 {
				offline++
			} else {
				fault++
			}
		} else {
			offline++
		}
	}

	res := modbusOverview{
		TotalDevices: len(cfg.Devices),
		Online:       online,
		Offline:      offline,
		FaultConfig:  fault,
		Revision:     int(cfg.Revision),
		Checksum:     cfg.Checksum,
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleGetModbusBuses(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	diag, _ := a.getModbusDiagnostics(r.Context())

	bus1Devices := 0
	bus1Online := 0
	bus1Timeout := 0
	bus1CRC := 0

	bus2Devices := 0
	bus2Online := 0
	bus2Timeout := 0
	bus2CRC := 0

	diagMap := make(map[string]*ModbusRTUDiagnostics)
	for i := range diag {
		diagMap[diag[i].DeviceID] = &diag[i]
	}

	for _, d := range cfg.Devices {
		port := d.RS485Port
		dDiag := diagMap[d.DeviceID]
		isOnline := dDiag != nil && dDiag.Online

		if port == "/dev/rs485-2" || port == "/dev/ttyS1" {
			bus2Devices++
			if isOnline {
				bus2Online++
			}
			if dDiag != nil {
				bus2Timeout += int(dDiag.TimeoutErrors)
				bus2CRC += int(dDiag.CRCErrors)
			}
		} else {
			bus1Devices++
			if isOnline {
				bus1Online++
			}
			if dDiag != nil {
				bus1Timeout += int(dDiag.TimeoutErrors)
				bus1CRC += int(dDiag.CRCErrors)
			}
		}
	}

	buses := []modbusBusInfo{
		{
			BusID:          "RS485-1",
			DisplayName:    "RS485-1 (Main Port)",
			Port:           "/dev/rs485-1",
			PortAlias:      "ttyS5",
			OpenState:      "OPEN",
			Baud:           19200,
			Parity:         "N",
			DataBits:       8,
			StopBits:       1,
			TotalDevices:   bus1Devices,
			OnlineDevices:  bus1Online,
			PollLatencyP50: 24,
			PollLatencyP95: 61,
			TimeoutErrors:  bus1Timeout,
			CrcErrors:      bus1CRC,
			Utilization:    28,
		},
		{
			BusID:          "RS485-2",
			DisplayName:    "RS485-2 (Expansion Port)",
			Port:           "/dev/rs485-2",
			PortAlias:      "ttyS1",
			OpenState:      "OPEN",
			Baud:           19200,
			Parity:         "N",
			DataBits:       8,
			StopBits:       1,
			TotalDevices:   bus2Devices,
			OnlineDevices:  bus2Online,
			PollLatencyP50: 18,
			PollLatencyP95: 45,
			TimeoutErrors:  bus2Timeout,
			CrcErrors:      bus2CRC,
			Utilization:    12,
		},
	}

	writeJSON(w, http.StatusOK, buses)
}

func (a *App) handleGetModbusEvents(w http.ResponseWriter, _ *http.Request) {
	events := []modbusEventItem{
		{
			Timestamp: "10:41:02",
			BusID:     "RS485-1",
			DeviceID:  "MTR-01",
			Message:   "OFFLINE -> ONLINE",
			Level:     "info",
		},
		{
			Timestamp: "10:38:55",
			BusID:     "RS485-2",
			DeviceID:  "VFD-01",
			Message:   "TIMEOUT (3 liên tiếp)",
			Level:     "warning",
		},
	}
	writeJSON(w, http.StatusOK, events)
}
