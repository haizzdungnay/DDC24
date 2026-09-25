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
	Bus    *webModbus.Bus   `json:"bus,omitempty"`
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
	// Danh sách rỗng phải là `[]`, không phải `null` — cùng lý do như Diff().
	if cfg.Devices == nil {
		cfg.Devices = []ModbusRTUDevice{}
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
	if cfg.Points == nil {
		cfg.Points = []ModbusRTUPoint{}
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
	byBusSlave := newModbusDeviceIndex(cfg.Devices)
	out := make([]ModbusRTUDiagnostics, 0, len(telemetry.Slaves))
	for _, item := range telemetry.Slaves {
		/* `MBA-BE-01` (audit Modbus 2026-09-25): đi qua `modbusDiagnosticsFrom`,
		 * KHÔNG tự dựng struct tại chỗ. Bản dựng tại chỗ trước đây bỏ sót
		 * `WriteFailed`, `WriteDropped`, `LastException`, nên API luôn trả 0 cho
		 * đúng ba bộ đếm trả lời câu hỏi "lệnh ghi của tôi có tới thiết bị
		 * không". Đo trên bo Forlinx: SHM ghi write_failed=41, write_dropped=12
		 * cho CK508-04 trong khi `/modbus/diagnostics` báo 0/0. */
		out = append(out, modbusDiagnosticsFrom(item, byBusSlave.lookup(int(item.BusID), int(item.Addr))))
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

// extCatalogReader là bố cục slot `ext` như runtime đang thấy. Tách thành
// interface để test double dựng được bố cục mà không cần `plc_shm` thật.
type extCatalogReader interface {
	ReadExtCatalog() ([]ExtSlotRef, error)
}

// resolveExtSlot đổi `point_id` (danh tính bền của cấu hình) sang slot `ext`
// mà `iobus` ĐANG cấp cho nó.
//
// Thất bại ở đây phải là lỗi, không phải phỏng đoán: ghi vào một slot đoán mò
// trên dây RS-485 đang chạy là ghi vào thiết bị của người khác.
func (a *App) resolveExtSlot(pointID string) (ExtSlotRef, error) {
	reader, ok := a.core.(extCatalogReader)
	if !ok {
		return ExtSlotRef{}, fmt.Errorf("lỗi ghi thử: core client không đọc được bố cục slot EXT")
	}
	slots, err := reader.ReadExtCatalog()
	if err != nil {
		return ExtSlotRef{}, fmt.Errorf("lỗi ghi thử: không đọc được bố cục slot EXT từ core: %v", err)
	}
	for _, slot := range slots {
		if strings.EqualFold(slot.PointID, pointID) {
			return slot, nil
		}
	}
	/* Điểm có trong cấu hình nhưng không có trong runtime = cấu hình đã lưu mà
	 * `iobus` chưa nạp (hoặc thiết bị/điểm đang tắt). Đây là thông tin người
	 * vận hành cần, không phải "core không khả dụng". */
	return ExtSlotRef{}, fmt.Errorf(
		"lỗi ghi thử: `%s` chưa có slot EXT nào trong runtime — iobus chưa nạp cấu hình, hoặc điểm/thiết bị đang tắt",
		pointID)
}

// modbusCommandTarget quy đổi `point_id` Modbus RTU sang tên điểm mà Core hiểu
// (`EXT<n>`), dùng cho đường ghi CHUNG `PUT /api/v1/points/{id}`.
//
// `MBA-BE-02` (audit Modbus 2026-09-25). Trước bản này chỉ `write-test` biết
// quy đổi; đường ghi chung gửi nguyên `CK50804-DO1` xuống Core, `parse_point_name`
// trả false và người vận hành nhận `409 point force rejected` — log bo Forlinx
// 2026-09-25 09:45:32 ghi đúng ca đó. Tệ hơn, một `point_id` Modbus tình cờ có
// dạng `DO3` sẽ parse THÀNH CÔNG và ghi xuống ngõ ra cục bộ DO3 — sai thiết bị
// mà không có lỗi nào.
//
// `handled=false` nghĩa là `id` không phải Point Modbus đã khai; nơi gọi đi tiếp
// đường cũ. `handled=true` kèm `err` là lỗi đã có mã HTTP để trả thẳng.
func (a *App) modbusCommandTarget(id string) (target string, handled bool, status int, err error) {
	cfg, readErr := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if readErr != nil {
		return "", false, 0, nil
	}
	var found *ModbusRTUPoint
	for i := range cfg.Points {
		if strings.EqualFold(cfg.Points[i].PointID, id) {
			found = &cfg.Points[i]
			break
		}
	}
	if found == nil {
		return "", false, 0, nil
	}
	if found.ReadWrite != "read_write" {
		return "", true, http.StatusConflict,
			fmt.Errorf("`%s` là Point Modbus RTU chỉ-đọc; chỉ Point read_write mới ghi được", found.PointID)
	}
	slot, err := a.resolveExtSlot(found.PointID)
	if err != nil {
		return "", true, http.StatusServiceUnavailable, err
	}
	if !slot.Writable {
		return "", true, http.StatusConflict,
			fmt.Errorf("slot EXT%d của `%s` đang là read-only trong runtime — iobus chưa nạp cấu hình mới",
				slot.ExtIndex, found.PointID)
	}
	return fmt.Sprintf("EXT%d", slot.ExtIndex), true, 0, nil
}

func (a *App) handleModbusWriteTest(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || principal.Role != RoleAdmin {
		writeError(w, http.StatusForbidden, "chỉ vai trò Admin được thực hiện ghi thử Modbus RTU")
		return
	}
	// `OD-MBRTU-007` yêu cầu 2 lệnh ghi thử/phút/người dùng, và `commissionLimiter`
	// được viết ra đúng cho việc này — nhưng toàn repo chỉ có một call site cho
	// nhánh read. Không có bộ giới hạn, một tab kẹt hoặc một script chạy vòng lặp
	// phát lệnh ghi không giới hạn xuống thiết bị hiện trường đang chạy, chiếm
	// băng thông RS-485 và đẩy mọi slave khác trên cùng dây vào timeout (REV-BE-06).
	if !a.commissionLimit.allow("write:"+principal.Username, 2, time.Minute) {
		writeError(w, http.StatusTooManyRequests,
			"vượt giới hạn ghi thử: tối đa 2 lệnh/phút cho mỗi người dùng (OD-MBRTU-007)")
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

	/* `point_id` KHÔNG phải tên mà Core hiểu. Core định danh điểm mở rộng bằng
	 * `EXT<n>` với `n` là SLOT 1-based (`web_ipc.cpp` `parse_point_name`:
	 * `out->idx = num - 1`), còn `point_id` là danh tính bền do người dùng
	 * đặt. Gửi thẳng `point_id` xuống thì `parse_point_name` trả false và lệnh
	 * bị từ chối; tệ hơn, một `point_id` tình cờ có dạng `AO12` sẽ parse THÀNH
	 * CÔNG và ghi xuống ngõ ra analog cục bộ — sai thiết bị, không một lỗi nào.
	 * Nên phép quy đổi phải làm ở đây, và làm bằng bố cục ĐANG chạy. */
	slot, err := a.resolveExtSlot(foundPoint.PointID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !slot.Writable {
		/* Cấu hình nói `read_write`, runtime nói không. Hai nguồn lệch nhau
		 * nghĩa là `iobus` chưa nạp bản cấu hình vừa lưu — nói đúng điều đó
		 * thay vì đẩy một lệnh ghi mà `PointWriter::can_write` sẽ nuốt. */
		writeError(w, http.StatusConflict,
			fmt.Sprintf("lỗi ghi thử: slot EXT%d của `%s` đang là read-only trong runtime — iobus chưa nạp cấu hình mới",
				slot.ExtIndex, foundPoint.PointID))
		return
	}

	pointDTO, err := a.commandCorePoint(r.Context(), fmt.Sprintf("EXT%d", slot.ExtIndex),
		forcePointBody{value: req.Value, release: false}, principal)
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
	_ = a.mutateModbusConfigLocked(w, r, mutation)
}

/* mutateModbusConfigLocked là phần thân của `mutateModbusConfig`, dành cho nơi
 * gọi ĐÃ giữ `pointConfigMu`.
 *
 * `ISS-PIO-20`: `PUT /points/{id}/config` giữ khoá đó suốt lượt xử lý (nó đọc
 * và ghi io_config + virtual_points trong cùng một lần), nên gọi thẳng
 * `mutateModbusConfig` từ trong đó sẽ tự khoá chính mình. Tách thân hàm ra vẫn
 * giữ đúng một đường ghi cấu hình Modbus — validate, apply, revision — thay vì
 * đẻ ra một đường ghi thứ hai bỏ qua các bước đó.
 */
// Trả `true` khi cấu hình đã được ghi và phản hồi là 200; `false` khi đã ghi
// phản hồi lỗi. Nơi gọi cần biết kết quả THẬT để ghi vết audit đúng — suy ra từ
// mã trạng thái đã viết là không làm được, và đoán bừa sẽ khiến nhật ký nói
// ngược với thực tế, đúng thứ mà truy vết sự cố dựa vào.
func (a *App) mutateModbusConfigLocked(w http.ResponseWriter, r *http.Request,
	mutation func(*ConfigFieldbus) (modbusMutationResponse, []configValidationError)) bool {
	cfg, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	response, errs := mutation(&cfg)
	if len(errs) == 0 {
		errs = validateModbusRTUConfig(a, cfg)
	}
	if len(errs) > 0 {
		writeValidationErrors(w, errs)
		return false
	}
	result, err := a.applyModbusConfig(r, cfg)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return false
	}
	response.Apply = result
	writeJSON(w, http.StatusOK, response)
	return true
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
	BusID       string `json:"bus_id"`
	DisplayName string `json:"display_name"`
	Port        string `json:"port"`
	PortAlias   string `json:"port_alias"`
	OpenState   string `json:"open_state"`
	Baud        int    `json:"baud"`
	Parity      string `json:"parity"`
	DataBits    int    `json:"data_bits"`
	StopBits    int    `json:"stop_bits"`
	// Cấu hình đang lưu — trang Cổng RS-485 nạp form từ đây thay vì đoán mặc định.
	OfflineProbeMs int  `json:"offline_probe_ms"`
	Enabled        bool `json:"enabled"`
	TotalDevices   int  `json:"total_devices"`
	OnlineDevices  int  `json:"online_devices"`
	// Con trỏ: nil = iobus chưa đo được. FE hiện "—" thay vì 0.
	PollLatencyP50 *int `json:"poll_latency_p50_ms"`
	PollLatencyP95 *int `json:"poll_latency_p95_ms"`
	// Timeout/CRC gộp từ số đo THEO SLAVE. `TotalErrors` là tổng của cả dây do
	// BusWorker đếm, gồm cả lỗi chưa quy được về slave nào — hai con số này
	// không được cộng vào nhau (REV-BE-10).
	TimeoutErrors uint64   `json:"timeout_errors"`
	CrcErrors     uint64   `json:"crc_errors"`
	TotalErrors   uint64   `json:"total_errors"`
	PortReopens   uint64   `json:"port_reopens"`
	Utilization   *float64 `json:"bus_utilization_percent"`
	EstimatedLoad float64  `json:"estimated_load_percent"`
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
	byBusSlave := newModbusDeviceIndex(cfg.Devices)
	out := make([]ModbusRTUDiagnostics, 0, len(telemetry.Slaves))
	for _, dev := range telemetry.Slaves {
		out = append(out, modbusDiagnosticsFrom(dev, byBusSlave.lookup(int(dev.BusID), int(dev.Addr))))
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
	bySlave := newModbusTelemetryIndex(telemetry.Slaves)

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
		metric, seen := bySlave.lookupDevice(device)
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
	bySlave := newModbusTelemetryIndex(telemetry.Slaves)
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
			OfflineProbeMs: bus.OfflineProbeMs, Enabled: bool(bus.Enabled),
			OpenState:     "UNKNOWN",
			EstimatedLoad: loadByBus[bus.BusID],
		}
		// Một vòng duy nhất qua thiết bị của dây này: đếm thiết bị và cộng lỗi
		// theo cùng một phép tra `(bus, slave)`, nên hai con số không thể lệch
		// nhau vì hai vòng lặp dùng khoá khác nhau.
		for _, device := range cfg.Devices {
			if modbusDeviceBus(device) != bus.BusID {
				continue
			}
			metric, seen := bySlave.lookupDevice(device)
			if device.Enabled {
				info.TotalDevices++
				if seen && metric.Online {
					info.OnlineDevices++
				}
			}
			if seen {
				info.TimeoutErrors += metric.TimeoutErrors
				info.CrcErrors += metric.CRCErrors
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
			// `TotalErrors` của dây gồm MỌI nguyên nhân (timeout, CRC, exception,
			// lỗi mức cổng chưa quy được về slave nào). Gán nó vào `timeout_errors`
			// rồi cộng thêm timeout của từng slave lên trên là đếm trùng: một dây
			// có nhiều nhất 100 lỗi báo ra 170. Timeout và CRC chỉ lấy từ số đo
			// theo slave; tổng của dây đi riêng ở `total_errors` (REV-BE-10).
			info.TotalErrors = measured.TotalErrors
			info.PortReopens = measured.PortReopens
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
	bySlave := newModbusTelemetryIndex(telemetry.Slaves)
	now := time.Now()
	for _, device := range cfg.Devices {
		metric, seen := bySlave.lookupDevice(device)
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

// handleUpdateModbusBus — cấu hình MỘT cổng RS-485 và áp ngay cho riêng cổng đó.
//
// Trước bản này KHÔNG có đường nào sửa được Bus từ giao diện: chỉ có
// `GET /modbus/buses`. Mô hình dữ liệu khai Bus là chủ sở hữu tham số serial,
// validator cưỡng chế điều đó, còn giao diện thì vẫn mời người dùng nhập
// baud/parity/stop ở từng Thiết bị — nhập xong mới bị từ chối, và không có chỗ
// nào sửa cho đúng. Endpoint này đóng khoảng trống đó.
//
// Ba trường CỐ TÌNH không nhận từ client:
//
//   - `bus_id`  — định danh cổng, bất biến; lấy từ đường dẫn.
//   - `port`    — ánh xạ bus_id ↔ device node là sự thật phần cứng. Cho sửa tự
//     do nghĩa là cho phép trỏ hai bus vào cùng một node.
//   - `data_bits` — iobus viết cứng 8 trong `modbus_new_rtu()`.
//
// `direction` cũng không nhận: phần cứng MK-DDC-24 chỉ có TX/RX, không có DE/RE
// (`G-D` CLOSED). Một nút bấm đổi được nó chỉ tạo cơ hội tự bắn vào chân mình.
func (a *App) handleUpdateModbusBus(w http.ResponseWriter, r *http.Request) {
	busID := strings.ToLower(strings.TrimSpace(r.PathValue("bus_id")))
	port := webModbus.PortForBusID(busID)
	if port == "" {
		writeValidationErrors(w, []configValidationError{{
			Path: "bus_id", Message: "chỉ nhận rs485-1 hoặc rs485-2",
			Reason: webModbus.CodeNotFound}})
		return
	}

	// Con trỏ để phân biệt "không gửi trường này" với "gửi giá trị 0". Gộp hai
	// thứ đó lại sẽ biến một PATCH thiếu trường thành lệnh đặt baud = 0.
	var req struct {
		DisplayName    *string `json:"display_name"`
		Baud           *int    `json:"baud"`
		Parity         *string `json:"parity"`
		StopBits       *int    `json:"stop_bits"`
		OfflineProbeMS *int    `json:"offline_probe_ms"`
		Enabled        *bool   `json:"enabled"`
	}
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}

	a.mutateModbusConfig(w, r, func(cfg *ConfigFieldbus) (modbusMutationResponse, []configValidationError) {
		if len(cfg.Buses) == 0 {
			buses, _ := webModbus.MigrateBuses(*cfg)
			cfg.Buses = buses
		}
		index := -1
		for i := range cfg.Buses {
			if strings.EqualFold(cfg.Buses[i].BusID, busID) {
				index = i
				break
			}
		}
		if index < 0 {
			// Cổng có trong phần cứng nhưng chưa có trong cấu hình: tạo mới thay
			// vì báo lỗi. Bắt người dùng "thêm cổng" cho một cổng hàn sẵn trên bo
			// là bắt họ khai báo một sự thật vật lý.
			cfg.Buses = append(cfg.Buses, webModbus.NormalizeBus(webModbus.Bus{
				BusID: busID, Port: port, Enabled: true,
			}))
			index = len(cfg.Buses) - 1
		}
		bus := cfg.Buses[index]
		bus.BusID = busID
		bus.Port = port
		bus.DataBits = 8
		if req.DisplayName != nil {
			bus.DisplayName = *req.DisplayName
		}
		if req.Baud != nil {
			bus.Baud = *req.Baud
		}
		if req.Parity != nil {
			bus.Parity = *req.Parity
		}
		if req.StopBits != nil {
			bus.StopBit = *req.StopBits
		}
		if req.OfflineProbeMS != nil {
			bus.OfflineProbeMs = *req.OfflineProbeMS
		}
		if req.Enabled != nil {
			bus.Enabled = webModbus.FlexBool(*req.Enabled)
		}
		cfg.Buses[index] = webModbus.NormalizeBus(bus)
		// Đổi tham số của dây thì mọi thiết bị trên dây đó phải đi theo ngay —
		// nếu không, bảng Thiết bị hiện baud cũ trong khi cổng đã chạy baud mới.
		webModbus.ApplyBusInheritance(cfg)
		result := cfg.Buses[index]
		return modbusMutationResponse{Bus: &result}, nil
	})
}
