package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

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
	return a.validateModbusCandidate(cfg)
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

// applyModbusConfig ghi cấu hình rồi báo iobus nạp lại.
//
// MBR-B212 / D-09: đường nạp lại KHÔNG còn mặc định là restart mkddc-iobus.
// Restart cắt luôn IOP 100 Hz — mọi I/O vật lý của tủ ngừng vài giây chỉ vì ai
// đó sửa tên một Point. Đường chính nay là kênh điều khiển UDS, áp cấu hình
// tại ranh giới giữa hai transaction Modbus. `Reload` chỉ còn là dự phòng cho
// iobus bản cũ chưa có kênh điều khiển, và khi dùng thì warnings nói rõ.
func (a *App) applyModbusConfig(r *http.Request, cfg ConfigFieldbus) (ConfigPutResult, error) {
	previous, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	user := principalName(r)
	result, err := (webModbus.Persister{
		ConfigDir:  a.cfg.ConfigDir,
		ConfigPath: a.configPath(configGroupFieldbus.file),
		WriteFile:  writeConfigFileAtomic,
		Reload:     func() (bool, []string) { return a.dispatchReload(reloadRestartIobus) },
		Control:    a.modbusControl(),
		Journal:    a.modbusJournal(),
		Actor:      user,
	}).Apply(cfg, previous)
	if err != nil {
		return ConfigPutResult{}, err
	}
	reloadMode := result.ReloadMode
	if reloadMode == "" {
		reloadMode = reloadRestartIobus
	}
	a.audit.Change(user, "config.modbus-rtu", configGroupFieldbus.file, "success", r.RemoteAddr)
	return ConfigPutResult{Result: "success", Applied: true, Reload: reloadMode,
		Warnings: result.Warnings, Revision: result.Config.Revision,
		Checksum: result.Config.Checksum}, nil
}

func buildModbusProfile(device ModbusRTUDevice, points []ModbusRTUPoint) ([]byte, error) {
	return webModbus.BuildProfile(device, points)
}

// ---------------------------------------------------------------------------
// Overview / Bus / Event — MBR-B305.
//
// Bản trước điền p50/p95/utilization và cả danh sách sự kiện bằng HẰNG SỐ VIẾT
// CỨNG trong handler. Trang Overview vì thế hiển thị "24 ms / 61 ms / 28 %" và
// hai dòng sự kiện có sẵn kể cả khi không có một thiết bị nào được đấu. Đó đúng
// là lỗi D-07 ("không suy diễn, không bịa") chỉ bị đẩy xuống một tầng: người
// vận hành không có cách nào phân biệt số thật với số trang trí.
//
// Nay mọi con số đến từ `kx_bus_metrics_t` do BusWorker đo, và thiếu dữ liệu
// được trả về là `null` để FE hiện "—".
// ---------------------------------------------------------------------------

type modbusOverview struct {
	TotalDevices int    `json:"total_devices"`
	Online       int    `json:"online"`
	Offline      int    `json:"offline"`
	FaultConfig  int    `json:"fault_config"`
	Initializing int    `json:"initializing"`
	Revision     int    `json:"revision"`
	Checksum     string `json:"checksum"`
	// TelemetryAvailable=false nghĩa là iobus chưa publish lần nào. Mọi con số
	// runtime ở trên phải được FE hiểu là KHÔNG BIẾT, không phải 0.
	TelemetryAvailable bool `json:"telemetry_available"`
}

type modbusBusInfo struct {
	BusID         string `json:"bus_id"`
	DisplayName   string `json:"display_name"`
	Port          string `json:"port"`
	PortAlias     string `json:"port_alias"`
	OpenState     string `json:"open_state"`
	Baud          int    `json:"baud"`
	Parity        string `json:"parity"`
	DataBits      int    `json:"data_bits"`
	StopBits      int    `json:"stop_bits"`
	TotalDevices  int    `json:"total_devices"`
	OnlineDevices int    `json:"online_devices"`
	// Con trỏ: nil = iobus chưa đo được. FE hiện "—" thay vì 0.
	PollLatencyP50 *int     `json:"poll_latency_p50_ms"`
	PollLatencyP95 *int     `json:"poll_latency_p95_ms"`
	TimeoutErrors  uint64   `json:"timeout_errors"`
	CrcErrors      uint64   `json:"crc_errors"`
	PortReopens    uint64   `json:"port_reopens"`
	Utilization    *float64 `json:"bus_utilization_percent"`
	EstimatedLoad  float64  `json:"estimated_load_percent"`
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
		out = append(out, modbusDiagnosticsFrom(dev, bySlave[int(dev.Addr)]))
	}
	return out, nil
}

func modbusDiagnosticsFrom(dev SlaveTelemetry, deviceID string) ModbusRTUDiagnostics {
	return ModbusRTUDiagnostics{
		DeviceID:          deviceID,
		SlaveID:           int(dev.Addr),
		BusID:             dev.BusID,
		Online:            dev.Online,
		TotalPolls:        dev.TotalPolls,
		TotalErrors:       dev.TotalErrors,
		TimeoutErrors:     dev.TimeoutErrors,
		CRCErrors:         dev.CRCErrors,
		RetryAttempts:     dev.RetryAttempts,
		WriteFailed:       dev.WriteFailed,
		WriteDropped:      dev.WriteDropped,
		ConsecutiveErrors: dev.ConsecutiveErrors,
		LastException:     dev.LastException,
		LastSeenMS:        dev.LastSeenMS,
	}
}

// publishedFieldbusTelemetry trả telemetry kèm cờ khả dụng.
//
// `Published=false` nghĩa là iobus CHƯA publish lần nào; caller phải coi đó là
// "không biết" chứ không được quy về 0 hay offline (finding F-03/F-04).
func (a *App) publishedFieldbusTelemetry(ctx context.Context) (FieldbusTelemetry, bool) {
	telemetry := a.readFieldbusTelemetry(ctx)
	if telemetry == nil || !telemetry.Published {
		return FieldbusTelemetry{}, false
	}
	return *telemetry, true
}

func (a *App) handleGetModbusOverview(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	telemetry, available := a.publishedFieldbusTelemetry(r.Context())
	bySlave := map[int]SlaveTelemetry{}
	for _, item := range telemetry.Slaves {
		bySlave[int(item.Addr)] = item
	}

	res := modbusOverview{
		TotalDevices:       len(cfg.Devices),
		Revision:           int(cfg.Revision),
		Checksum:           cfg.Checksum,
		TelemetryAvailable: available,
	}
	for _, device := range cfg.Devices {
		if !device.Enabled {
			continue
		}
		metric, seen := bySlave[device.SlaveID]
		switch {
		case !available || !seen:
			// Chưa có telemetry ⇒ "đang khởi tạo", KHÔNG phải offline. Gọi một
			// thiết bị là offline khi chưa từng hỏi nó là bịa trạng thái.
			res.Initializing++
		case metric.Online:
			res.Online++
		case metric.TotalPolls == 0:
			res.Initializing++
		default:
			res.Offline++
		}
	}
	// Lỗi cấu hình đếm từ validator, không suy từ telemetry.
	for _, verr := range a.validateModbusCandidate(cfg) {
		if verr.Reason == webModbus.CodePortNotAvailable ||
			verr.Reason == webModbus.CodeBusOverloaded ||
			verr.Reason == webModbus.CodeAddressOverlap {
			res.FaultConfig++
		}
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleGetModbusBuses(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	buses, _ := webModbus.MigrateBuses(cfg)
	telemetry, available := a.publishedFieldbusTelemetry(r.Context())

	measuredByID := map[int]BusTelemetry{}
	for _, bus := range telemetry.Buses {
		measuredByID[int(bus.ID)] = bus
	}
	slaveByAddr := map[int]SlaveTelemetry{}
	for _, item := range telemetry.Slaves {
		slaveByAddr[int(item.Addr)] = item
	}
	manifest, _ := webModbus.LoadCapabilityManifest(a.cfg.PortCapabilityPath)
	aliasByPort := map[string]string{}
	for _, port := range manifest.Ports {
		aliasByPort[port.Port] = port.Alias
	}
	loadByBus := map[string]float64{}
	for _, load := range webModbus.EstimateBusLoad(cfg, a.modbusValidateOptions()) {
		loadByBus[load.BusID] = load.EstimatedPct
	}

	out := make([]modbusBusInfo, 0, len(buses))
	for _, bus := range buses {
		info := modbusBusInfo{
			BusID: bus.BusID, DisplayName: bus.DisplayName, Port: bus.Port,
			PortAlias: aliasByPort[bus.Port], Baud: bus.Baud, Parity: bus.Parity,
			DataBits: bus.DataBits, StopBits: bus.StopBit,
			OpenState:     "UNKNOWN",
			EstimatedLoad: loadByBus[bus.BusID],
		}
		for _, device := range cfg.Devices {
			if modbusDeviceBus(device) != bus.BusID || !device.Enabled {
				continue
			}
			info.TotalDevices++
			if metric, seen := slaveByAddr[device.SlaveID]; seen && metric.Online {
				info.OnlineDevices++
			}
		}
		if measured, seen := measuredByID[bus.NumericID()]; seen && available {
			info.OpenState = measured.State
			p50 := int(measured.LatencyP50US / 1000)
			p95 := int(measured.LatencyP95US / 1000)
			info.PollLatencyP50 = &p50
			info.PollLatencyP95 = &p95
			util := float64(measured.UtilizationPctX100) / 100.0
			info.Utilization = &util
			info.TimeoutErrors = measured.TotalErrors
			info.CrcErrors = 0
			info.PortReopens = measured.PortReopens
		}
		// Lỗi timeout/CRC gộp theo slave để khớp bảng chẩn đoán.
		for _, device := range cfg.Devices {
			if modbusDeviceBus(device) != bus.BusID {
				continue
			}
			if metric, seen := slaveByAddr[device.SlaveID]; seen {
				info.TimeoutErrors += metric.TimeoutErrors
				info.CrcErrors += metric.CRCErrors
			}
		}
		out = append(out, info)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetModbusEvents trả các CHUYỂN TRẠNG THÁI đã quan sát được.
//
// Không còn danh sách viết cứng: mỗi mục ở đây tương ứng một lần BE đọc
// telemetry và thấy trạng thái liên lạc của một thiết bị đổi. Chưa quan sát
// được lần đổi nào ⇒ danh sách RỖNG, và FE hiện "chưa có sự kiện".
func (a *App) handleGetModbusEvents(w http.ResponseWriter, r *http.Request) {
	a.recordModbusEvents(r.Context())
	writeJSON(w, http.StatusOK, a.modbusEvents.snapshot())
}

// modbusEventLog là vòng đệm sự kiện quan sát được.
type modbusEventLog struct {
	mu     sync.Mutex
	items  []modbusEventItem
	states map[string]string
}

const modbusEventCapacity = 50

func (l *modbusEventLog) observe(deviceID, busID, state string, at time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.states == nil {
		l.states = map[string]string{}
	}
	previous, seen := l.states[deviceID]
	l.states[deviceID] = state
	if !seen || previous == state {
		return
	}
	level := "info"
	if state != "ONLINE" {
		level = "warning"
	}
	l.items = append(l.items, modbusEventItem{
		Timestamp: at.UTC().Format(time.RFC3339),
		BusID:     busID,
		DeviceID:  deviceID,
		Message:   previous + " -> " + state,
		Level:     level,
	})
	if len(l.items) > modbusEventCapacity {
		l.items = l.items[len(l.items)-modbusEventCapacity:]
	}
}

func (l *modbusEventLog) snapshot() []modbusEventItem {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]modbusEventItem, 0, len(l.items))
	for i := len(l.items) - 1; i >= 0; i-- {
		out = append(out, l.items[i])
	}
	return out
}

func (a *App) recordModbusEvents(ctx context.Context) {
	telemetry, available := a.publishedFieldbusTelemetry(ctx)
	if !available {
		return
	}
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		return
	}
	byAddr := map[int]SlaveTelemetry{}
	for _, item := range telemetry.Slaves {
		byAddr[int(item.Addr)] = item
	}
	now := time.Now()
	for _, device := range cfg.Devices {
		metric, seen := byAddr[device.SlaveID]
		state := "INITIALIZING"
		switch {
		case !seen:
			state = "INITIALIZING"
		case metric.Online:
			state = "ONLINE"
		case metric.TotalPolls == 0:
			state = "INITIALIZING"
		default:
			state = "OFFLINE"
		}
		a.modbusEvents.observe(device.DeviceID, modbusDeviceBus(device), state, now)
	}
}
