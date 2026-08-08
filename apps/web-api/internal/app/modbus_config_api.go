package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	webModbus "mkddc-web/internal/modbusrtu"
)

// ---------------------------------------------------------------------------
// Hạ tầng dùng chung cho nhóm endpoint Modbus RTU v2 (MBR-B203..B210).
// ---------------------------------------------------------------------------

func (a *App) modbusCandidateStore() *webModbus.CandidateStore {
	a.modbusOnce.Do(func() {
		a.modbusCandidates = &webModbus.CandidateStore{
			Path:      a.configPath("fieldbus.candidate.json"),
			WriteFile: writeConfigFileAtomic,
		}
	})
	return a.modbusCandidates
}

func (a *App) modbusJournal() webModbus.Journal {
	return webModbus.Journal{Path: a.configPath("fieldbus.journal"), WriteFile: writeConfigFileAtomic}
}

func (a *App) modbusControl() webModbus.ControlClient {
	return webModbus.ControlClient{SocketPath: a.cfg.IobusControlSock, Timeout: 5 * time.Second}
}

func (a *App) modbusValidateOptions() webModbus.ValidateOptions {
	opts := webModbus.DefaultValidateOptions()
	if manifest, err := webModbus.LoadCapabilityManifest(a.cfg.PortCapabilityPath); err == nil {
		opts.Capabilities = manifest
	}
	ioCfg, _ := readConfig(a, configGroupIO, ConfigIO{})
	vpCfg, _ := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	entries, _ := pointNamespaceEntries(ioCfg, vpCfg)
	owners := map[string]string{}
	for _, entry := range entries {
		if _, key, err := normalizePointTag(entry.Tag); err == nil {
			owners[key] = entry.PointID
		}
	}
	opts.ExternalTagOwners = owners
	return opts
}

// activeModbusConfig đọc cấu hình ĐANG CHẠY (đã apply).
func (a *App) activeModbusConfig() (ConfigFieldbus, error) {
	return readConfig(a, configGroupFieldbus, ConfigFieldbus{})
}

// candidateOrActive trả bản nháp nếu có, ngược lại trả bản sao của cấu hình
// đang chạy làm điểm xuất phát.
func (a *App) candidateOrActive() (webModbus.Candidate, ConfigFieldbus, error) {
	active, err := a.activeModbusConfig()
	if err != nil {
		return webModbus.Candidate{}, ConfigFieldbus{}, err
	}
	if len(active.Buses) == 0 {
		buses, _ := webModbus.MigrateBuses(active)
		active.Buses = buses
	}
	candidate, exists, err := a.modbusCandidateStore().Load()
	if err != nil {
		// Bản nháp hỏng không được chặn đường cấu hình: bỏ và bắt đầu lại từ
		// cấu hình đang chạy, kèm cảnh báo ở response.
		_ = a.modbusCandidateStore().Discard()
		exists = false
	}
	if !exists {
		return webModbus.Candidate{
			Config:       active,
			BaseRevision: active.Revision,
			State:        webModbus.ConfigStateClean,
		}, active, nil
	}
	return candidate, active, nil
}

type modbusConfigStateResponse struct {
	State          string                 `json:"state"`
	ActiveRevision uint64                 `json:"active_revision"`
	ActiveChecksum string                 `json:"active_checksum"`
	BaseRevision   uint64                 `json:"base_revision"`
	Checksum       string                 `json:"checksum"`
	UpdatedAt      string                 `json:"updated_at,omitempty"`
	UpdatedBy      string                 `json:"updated_by,omitempty"`
	LastError      string                 `json:"last_error,omitempty"`
	Diff           []webModbus.DiffEntry  `json:"diff"`
	RunningOnIobus *modbusRunningSnapshot `json:"running_on_iobus,omitempty"`
}

// modbusRunningSnapshot là những gì iobus THẬT SỰ đang chạy.
//
// Trước bản này FE hiển thị "Đồng bộ thành công" bằng một chuỗi viết cứng — nó
// đúng kể cả khi iobus đang chạy cấu hình của tuần trước. Con số duy nhất trả
// lời được câu hỏi đó là `config_revision` do chính iobus báo.
type modbusRunningSnapshot struct {
	Generation     uint64 `json:"generation"`
	ConfigRevision uint64 `json:"config_revision"`
	ExtCount       int    `json:"ext_count"`
	InSync         bool   `json:"in_sync"`
	Reachable      bool   `json:"reachable"`
}

func (a *App) handleModbusConfigState(w http.ResponseWriter, _ *http.Request) {
	candidate, active, err := a.candidateOrActive()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	diff := webModbus.Diff(active, candidate.Config)
	state := candidate.State
	if state == "" || state == webModbus.ConfigStateClean {
		state = webModbus.ConfigStateClean
		if len(diff) > 0 {
			state = webModbus.ConfigStateDirty
		}
	}
	response := modbusConfigStateResponse{
		State:          state,
		ActiveRevision: active.Revision,
		ActiveChecksum: active.Checksum,
		BaseRevision:   candidate.BaseRevision,
		Checksum:       candidate.Checksum,
		UpdatedBy:      candidate.UpdatedBy,
		LastError:      candidate.LastError,
		Diff:           diff,
	}
	if !candidate.UpdatedAt.IsZero() {
		response.UpdatedAt = candidate.UpdatedAt.UTC().Format(time.RFC3339)
	}
	if status, err := a.modbusControl().Status(); err == nil {
		response.RunningOnIobus = &modbusRunningSnapshot{
			Generation:     status.Generation,
			ConfigRevision: status.ConfigRevision,
			ExtCount:       status.ExtCount,
			InSync:         status.ConfigRevision == active.Revision,
			Reachable:      true,
		}
	} else {
		// KHÔNG bịa "đồng bộ": không liên lạc được iobus nghĩa là KHÔNG BIẾT.
		response.RunningOnIobus = &modbusRunningSnapshot{Reachable: false}
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) handleGetModbusCandidate(w http.ResponseWriter, _ *http.Request) {
	candidate, _, err := a.candidateOrActive()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, candidate)
}

type modbusCandidateRequest struct {
	BaseRevision uint64             `json:"base_revision"`
	Buses        []webModbus.Bus    `json:"buses"`
	Devices      []webModbus.Device `json:"devices"`
	Points       []webModbus.Point  `json:"points"`
	OperationID  string             `json:"operation_id"`
}

// handlePutModbusCandidate lưu bản nháp. KHÔNG chạm tới thiết bị.
func (a *App) handlePutModbusCandidate(w http.ResponseWriter, r *http.Request) {
	var req modbusCandidateRequest
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	active, err := a.activeModbusConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// MBR-B205: optimistic concurrency. Hai kỹ thuật viên cùng mở trang, người
	// thứ hai lưu đè im lặng lên thay đổi của người thứ nhất là kịch bản mất
	// việc thật — và không ai phát hiện cho tới khi thiết bị chạy sai.
	if err := a.checkBaseRevision(r, req.BaseRevision, active.Revision); err != nil {
		writeError(w, http.StatusPreconditionFailed, err.Error())
		return
	}

	next := active
	next.Buses = req.Buses
	next.Devices = req.Devices
	next.Points = req.Points
	if len(next.Buses) == 0 {
		next.Buses, _ = webModbus.MigrateBuses(next)
	}

	if errs := a.validateModbusCandidate(next); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}

	candidate := webModbus.Candidate{
		Config:       next,
		BaseRevision: active.Revision,
		State:        webModbus.ConfigStateDirty,
		OperationID:  req.OperationID,
		UpdatedBy:    principalName(r),
	}
	if err := a.modbusCandidateStore().Save(candidate); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.audit.Change(principalName(r), "modbus.candidate.save", "fieldbus.candidate.json", "success", r.RemoteAddr)
	writeJSON(w, http.StatusOK, map[string]any{
		"result": "saved",
		"state":  webModbus.ConfigStateDirty,
		"diff":   webModbus.Diff(active, next),
	})
}

func (a *App) handleDeleteModbusCandidate(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()
	if err := a.modbusCandidateStore().Discard(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.audit.Change(principalName(r), "modbus.candidate.discard", "fieldbus.candidate.json", "success", r.RemoteAddr)
	writeJSON(w, http.StatusOK, map[string]any{"result": "discarded", "state": webModbus.ConfigStateClean})
}

func (a *App) handleModbusConfigDiff(w http.ResponseWriter, _ *http.Request) {
	candidate, active, err := a.candidateOrActive()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"diff":            webModbus.Diff(active, candidate.Config),
		"active_revision": active.Revision,
		"base_revision":   candidate.BaseRevision,
	})
}

type modbusApplyRequest struct {
	BaseRevision uint64 `json:"base_revision"`
	OperationID  string `json:"operation_id"`
}

// handleApplyModbusConfig chạy transaction apply (MBR-B204).
func (a *App) handleApplyModbusConfig(w http.ResponseWriter, r *http.Request) {
	var req modbusApplyRequest
	if r.ContentLength > 0 {
		if err := decodeConfigBody(w, r, &req); err != nil {
			writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
			return
		}
	}
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	store := a.modbusCandidateStore()
	// Idempotency: cùng operation_id đã apply xong thì trả lại kết quả cũ thay
	// vì apply lần nữa và đẩy revision lên thêm một bậc.
	if revision, seen := store.LookupOperation(req.OperationID); seen {
		writeJSON(w, http.StatusOK, map[string]any{
			"result": "success", "revision": revision, "idempotent": true,
		})
		return
	}

	candidate, exists, err := store.Load()
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if !exists {
		writeError(w, http.StatusConflict, webModbus.ErrNoCandidate.Error())
		return
	}
	active, err := a.activeModbusConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if req.BaseRevision != 0 && req.BaseRevision != active.Revision {
		writeError(w, http.StatusPreconditionFailed,
			fmt.Sprintf("base_revision %d không khớp revision đang chạy %d",
				req.BaseRevision, active.Revision))
		return
	}
	if candidate.BaseRevision != active.Revision {
		writeError(w, http.StatusPreconditionFailed,
			fmt.Sprintf("bản nháp dựa trên revision %d nhưng hệ thống đang ở %d; hãy tải lại và soạn lại",
				candidate.BaseRevision, active.Revision))
		return
	}
	if errs := a.validateModbusCandidate(candidate.Config); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}

	candidate.State = webModbus.ConfigStateApplying
	_ = store.Save(candidate)

	persister := webModbus.Persister{
		ConfigDir:   a.cfg.ConfigDir,
		ConfigPath:  a.configPath(configGroupFieldbus.file),
		WriteFile:   writeConfigFileAtomic,
		Reload:      func() (bool, []string) { return a.dispatchReload(reloadRestartIobus) },
		Control:     a.modbusControl(),
		Journal:     a.modbusJournal(),
		Actor:       principalName(r),
		OperationID: req.OperationID,
	}
	result, err := persister.Apply(candidate.Config, active)
	if err != nil {
		candidate.State = webModbus.ConfigStateFailed
		candidate.LastError = err.Error()
		_ = store.Save(candidate)
		a.audit.Change(principalName(r), "modbus.config.apply", configGroupFieldbus.file, "failed", r.RemoteAddr)
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	store.RememberOperation(req.OperationID, result.Config.Revision)
	_ = store.Discard()
	a.audit.Change(principalName(r), "modbus.config.apply", configGroupFieldbus.file, "success", r.RemoteAddr)
	writeJSON(w, http.StatusOK, map[string]any{
		"result":      "success",
		"revision":    result.Config.Revision,
		"checksum":    result.Config.Checksum,
		"generation":  result.Generation,
		"reload_mode": result.ReloadMode,
		"warnings":    result.Warnings,
		"state":       webModbus.ConfigStateClean,
	})
}

func (a *App) validateModbusCandidate(cfg ConfigFieldbus) []configValidationError {
	domainErrs := webModbus.ValidateWith(cfg, a.modbusValidateOptions())
	errs := make([]configValidationError, 0, len(domainErrs))
	for _, err := range domainErrs {
		errs = append(errs, configValidationError{Path: err.Path, Message: err.Message, Reason: err.Code})
	}
	return errs
}

// checkBaseRevision áp dụng cả `base_revision` trong body lẫn header `If-Match`.
func (a *App) checkBaseRevision(r *http.Request, bodyRevision, active uint64) error {
	revision := bodyRevision
	if header := strings.Trim(r.Header.Get("If-Match"), `"`); header != "" {
		parsed, err := strconv.ParseUint(header, 10, 64)
		if err != nil {
			return fmt.Errorf("If-Match phải là revision dạng số")
		}
		revision = parsed
	}
	if revision == 0 {
		return nil // client không yêu cầu kiểm — giữ tương thích với UI cũ
	}
	if revision != active {
		return fmt.Errorf("base_revision %d không khớp revision đang chạy %d; hãy tải lại cấu hình",
			revision, active)
	}
	return nil
}

func principalName(r *http.Request) string {
	if principal := principalFromContext(r.Context()); principal != nil {
		return principal.Username
	}
	return "-"
}

// ---------------------------------------------------------------------------
// MBR-B210 — endpoint đọc: buses, overview, mapping, ports, events
// ---------------------------------------------------------------------------

func (a *App) handleModbusPorts(w http.ResponseWriter, _ *http.Request) {
	manifest, err := webModbus.LoadCapabilityManifest(a.cfg.PortCapabilityPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, manifest.Ports)
}

type modbusMappingRow struct {
	PointID      string `json:"point_id"`
	TagName      string `json:"tag_name"`
	DeviceID     string `json:"device_id"`
	BusID        string `json:"bus_id"`
	SlaveID      int    `json:"slave_id"`
	RegisterType string `json:"register_type"`
	Address      int    `json:"address"`
	Registers    int    `json:"registers"`
	DataType     string `json:"data_type"`
	ReadWrite    string `json:"read_write"`
	Enabled      bool   `json:"enabled"`
}

func (a *App) handleModbusMapping(w http.ResponseWriter, _ *http.Request) {
	candidate, _, err := a.candidateOrActive()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	cfg := candidate.Config
	devices := map[string]webModbus.Device{}
	for _, device := range cfg.Devices {
		devices[strings.ToLower(device.DeviceID)] = device
	}
	rows := make([]modbusMappingRow, 0, len(cfg.Points))
	for _, point := range cfg.Points {
		registers := 1
		switch point.DataType {
		case "int32", "uint32", "float32":
			registers = 2
		}
		device := devices[strings.ToLower(point.DeviceID)]
		rows = append(rows, modbusMappingRow{
			PointID: point.PointID, TagName: point.TagName, DeviceID: point.DeviceID,
			BusID: modbusDeviceBus(device), SlaveID: device.SlaveID,
			RegisterType: point.RegisterType, Address: point.Address, Registers: registers,
			DataType: point.DataType, ReadWrite: point.ReadWrite, Enabled: bool(point.Enabled),
		})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].DeviceID != rows[j].DeviceID {
			return rows[i].DeviceID < rows[j].DeviceID
		}
		if rows[i].RegisterType != rows[j].RegisterType {
			return rows[i].RegisterType < rows[j].RegisterType
		}
		return rows[i].Address < rows[j].Address
	})

	errs := a.validateModbusCandidate(cfg)
	writeJSON(w, http.StatusOK, map[string]any{
		"rows":   rows,
		"errors": errs,
		"load":   webModbus.EstimateBusLoad(cfg, a.modbusValidateOptions()),
	})
}

// modbusDeviceBus giải `bus_id` của một Device.
//
// Trước đây hàm này có bảng ánh xạ cổng RIÊNG và mặc định về "rs485-1" cho mọi
// cổng lạ, trong khi `webModbus.BusIDForPort` là nơi phát biểu cùng chính sách
// đó. Hai nửa của một phép giải bus nói khác nhau thì sớm muộn cũng lệch; nay
// chỉ còn một nguồn (REV-BE-09).
func modbusDeviceBus(device webModbus.Device) string {
	if device.BusID != "" {
		return device.BusID
	}
	return webModbus.BusIDForPort(device.RS485Port)
}

// ---------------------------------------------------------------------------
// MBR-B208 — commissioning proxy có rate limit và audit đầy đủ
// ---------------------------------------------------------------------------

// commissionLimiter giới hạn tần suất lệnh chạm thiết bị hiện trường.
//
// OD-MBRTU-007: write test 2 lần/phút/người dùng, read test 5 lần/phút. Vì sao
// cần: mỗi lệnh commissioning chiếm dây và có thể ghi vào thiết bị đang chạy.
// Một tab trình duyệt kẹt nút, hoặc một script gõ nhầm vòng lặp, sẽ chiếm trọn
// bus và đẩy mọi thiết bị vào timeout.
type commissionLimiter struct {
	mu      sync.Mutex
	buckets map[string][]time.Time
}

func (l *commissionLimiter) allow(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.buckets == nil {
		l.buckets = map[string][]time.Time{}
	}
	now := time.Now()
	kept := l.buckets[key][:0]
	for _, at := range l.buckets[key] {
		if now.Sub(at) < window {
			kept = append(kept, at)
		}
	}
	if len(kept) >= limit {
		l.buckets[key] = kept
		return false
	}
	l.buckets[key] = append(kept, now)
	return true
}

type modbusProbeRequest struct {
	BusID     string `json:"bus_id"`
	SlaveID   int    `json:"slave_id"`
	FC        int    `json:"fc"`
	Address   int    `json:"address"`
	Count     int    `json:"count"`
	TimeoutMS int    `json:"timeout_ms"`
}

func (a *App) handleModbusReadTest(w http.ResponseWriter, r *http.Request) {
	a.modbusProbe(w, r, false)
}

func (a *App) handleModbusTestConnection(w http.ResponseWriter, r *http.Request) {
	a.modbusProbe(w, r, true)
}

func (a *App) modbusProbe(w http.ResponseWriter, r *http.Request, connectionOnly bool) {
	user := principalName(r)
	if !a.commissionLimit.allow("read:"+user, 5, time.Minute) {
		writeError(w, http.StatusTooManyRequests,
			"vượt giới hạn 5 lệnh đọc thử mỗi phút; lệnh commissioning chiếm băng thông bus")
		return
	}

	var req modbusProbeRequest
	if r.ContentLength > 0 {
		if err := decodeConfigBody(w, r, &req); err != nil {
			writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
			return
		}
	}
	if id := strings.TrimSpace(r.PathValue("id")); id != "" {
		cfg, err := a.activeModbusConfig()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for _, device := range cfg.Devices {
			if !strings.EqualFold(device.DeviceID, id) {
				continue
			}
			req.SlaveID = device.SlaveID
			req.BusID = modbusDeviceBus(device)
			if req.TimeoutMS == 0 {
				req.TimeoutMS = device.TimeoutMS
			}
			found = true
			break
		}
		if !found {
			writeValidationErrors(w, []configValidationError{
				{Path: "device_id", Message: "không tồn tại", Reason: webModbus.CodeNotFound}})
			return
		}
	}
	if req.SlaveID < 1 || req.SlaveID > 247 {
		writeValidationErrors(w, []configValidationError{
			{Path: "slave_id", Message: "phải trong 1..247", Reason: webModbus.CodeOutOfRange}})
		return
	}
	if req.Count <= 0 {
		req.Count = 1
	}
	if req.FC == 0 {
		req.FC = 3
	}
	if req.TimeoutMS <= 0 {
		req.TimeoutMS = 500
	}

	busNumber := busNumericID(req.BusID)
	control := a.modbusControl()
	var (
		reply webModbus.ProbeReply
		err   error
	)
	if connectionOnly {
		reply, err = control.TestConnection(busNumber, req.SlaveID, req.TimeoutMS)
	} else {
		reply, err = control.ReadTest(busNumber, req.SlaveID, req.FC, req.Address, req.Count, req.TimeoutMS)
	}
	action := "modbus.read-test"
	if connectionOnly {
		action = "modbus.test-connection"
	}
	target := fmt.Sprintf("bus=%s slave=%d fc=%d addr=%d", req.BusID, req.SlaveID, req.FC, req.Address)
	if err != nil {
		a.audit.Change(user, action, target, "unavailable", r.RemoteAddr)
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	outcome := "success"
	if reply.Result != "ok" {
		outcome = "failed"
	}
	a.audit.Change(user, action, target, outcome, r.RemoteAddr)
	writeJSON(w, http.StatusOK, reply)
}

func busNumericID(busID string) int {
	bus := webModbus.Bus{BusID: busID}
	return bus.NumericID()
}

// ---------------------------------------------------------------------------
// MBR-B209 — import / export
// ---------------------------------------------------------------------------

func (a *App) handleModbusExport(w http.ResponseWriter, r *http.Request) {
	cfg, err := a.activeModbusConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		format = "json"
	}
	switch format {
	case "csv":
		var buf bytes.Buffer
		if err := webModbus.ExportPointsCSV(&buf, cfg.Points); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="modbus-points.csv"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(buf.Bytes())
	case "json":
		data, err := webModbus.ExportConfigJSON(cfg)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="modbus-config.json"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	default:
		writeValidationErrors(w, []configValidationError{
			{Path: "format", Message: "chỉ hỗ trợ csv hoặc json", Reason: webModbus.CodeUnsupported}})
	}
}

// handleModbusImport nạp file vào CANDIDATE, không apply thẳng.
//
// All-or-nothing (Đ-06): một dòng sai là cả file bị từ chối. Import một phần
// tạo ra trạng thái người dùng không mô tả được — họ tưởng đã nạp 200 điểm,
// thực tế 173 điểm vào và 27 điểm im lặng biến mất.
func (a *App) handleModbusImport(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	active, err := a.activeModbusConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	next := active
	if len(next.Buses) == 0 {
		next.Buses, _ = webModbus.MigrateBuses(next)
	}

	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		if bytes.HasPrefix(bytes.TrimSpace(body), []byte("{")) {
			format = "json"
		} else {
			format = "csv"
		}
	}
	switch format {
	case "csv":
		points, importErrs := webModbus.ImportPointsCSV(bytes.NewReader(body))
		if len(importErrs) > 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"result": "rejected", "errors": importErrs})
			return
		}
		next.Points = points
	case "json":
		export, importErrs := webModbus.ImportConfigJSON(body)
		if len(importErrs) > 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"result": "rejected", "errors": importErrs})
			return
		}
		if len(export.Buses) > 0 {
			next.Buses = export.Buses
		}
		next.Devices = export.Devices
		next.Points = export.Points
	default:
		writeValidationErrors(w, []configValidationError{
			{Path: "format", Message: "chỉ hỗ trợ csv hoặc json", Reason: webModbus.CodeUnsupported}})
		return
	}

	if errs := a.validateModbusCandidate(next); len(errs) > 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"result": "rejected", "errors": errs})
		return
	}
	candidate := webModbus.Candidate{
		Config: next, BaseRevision: active.Revision,
		State: webModbus.ConfigStateDirty, UpdatedBy: principalName(r),
	}
	if err := a.modbusCandidateStore().Save(candidate); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.audit.Change(principalName(r), "modbus.config.import", format, "success", r.RemoteAddr)
	writeJSON(w, http.StatusOK, map[string]any{
		"result":       "staged",
		"state":        webModbus.ConfigStateDirty,
		"point_count":  len(next.Points),
		"device_count": len(next.Devices),
		"diff":         webModbus.Diff(active, next),
	})
}

// ---------------------------------------------------------------------------
// MBR-B210 — bật/tắt thiết bị (đi qua candidate, không ghi thẳng)
// ---------------------------------------------------------------------------

func (a *App) handleModbusDeviceEnabled(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	candidate, active, err := a.candidateOrActive()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	found := false
	for i := range candidate.Config.Devices {
		if strings.EqualFold(candidate.Config.Devices[i].DeviceID, id) {
			candidate.Config.Devices[i].Enabled = webModbus.FlexBool(req.Enabled)
			found = true
			break
		}
	}
	if !found {
		writeValidationErrors(w, []configValidationError{
			{Path: "device_id", Message: "không tồn tại", Reason: webModbus.CodeNotFound}})
		return
	}
	candidate.BaseRevision = active.Revision
	candidate.State = webModbus.ConfigStateDirty
	candidate.UpdatedBy = principalName(r)
	if err := a.modbusCandidateStore().Save(candidate); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"result": "staged", "state": webModbus.ConfigStateDirty,
		"diff": webModbus.Diff(active, candidate.Config),
	})
}

// jsonNumber giữ số nguyên lớn không bị đổi thành ký hiệu khoa học khi encode.
func jsonNumber(v uint64) json.Number { return json.Number(strconv.FormatUint(v, 10)) }

var _ = context.Background
