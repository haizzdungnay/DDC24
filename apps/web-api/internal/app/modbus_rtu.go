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
