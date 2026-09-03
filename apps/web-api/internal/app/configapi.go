package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"mkddc-web/internal/capabilities"
	"mkddc-web/internal/configschema"
)

// OWNED BY AGENT A (config) - keep config API logic in this file.

type configAPIGroup struct {
	key    string
	file   string
	reload string
}

type configValidationError struct {
	Path            string `json:"path"`
	Message         string `json:"message"`
	Reason          string `json:"reason,omitempty"`
	PointID         string `json:"pointId,omitempty"`
	ConflictPointID string `json:"conflictPointId,omitempty"`
	ConflictPath    string `json:"conflictPath,omitempty"`
	Tag             string `json:"tag,omitempty"`
	Name            string `json:"name,omitempty"`
}

var (
	configGroupDevice        = configAPIGroup{key: "device", file: "device.conf", reload: reloadSIGHUPIobus}
	configGroupNetwork       = configAPIGroup{key: "network", file: "network.conf", reload: reloadSystem}
	configGroupIO            = configAPIGroup{key: "io", file: "io_config.conf", reload: reloadSIGHUPIobus}
	configGroupSafeState     = configAPIGroup{key: "safe-state", file: "io_safe_state.conf", reload: reloadSIGHUPCore}
	configGroupVirtualPoints = configAPIGroup{key: "virtual-points", file: "virtual_points.conf", reload: reloadNone}
	configGroupBacnet        = configAPIGroup{key: "bacnet", file: "bacnet.conf", reload: reloadRestartIobus}
	configGroupFieldbus      = configAPIGroup{key: "fieldbus", file: "fieldbus.conf", reload: reloadRestartIobus}
	configGroupTime          = configAPIGroup{key: "time", file: "time.conf", reload: reloadSystem}
)

func (a *App) handleGetSystemConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := a.readSystemConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (a *App) handlePutSystemConfig(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusMethodNotAllowed, "bulk config update unsupported; use /system/config/<group>")
}

func (a *App) handleGetConfigDevice(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupDevice, ConfigDevice{})
}

func (a *App) handlePutConfigDevice(w http.ResponseWriter, r *http.Request) {
	handlePutConfig(a, w, r, configGroupDevice, validateConfigDevice)
}

func (a *App) handleGetConfigNetwork(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupNetwork, ConfigNetwork{})
}

func (a *App) handlePutConfigNetwork(w http.ResponseWriter, r *http.Request) {
	var cfg ConfigNetwork
	if err := decodeConfigBody(w, r, &cfg); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	current, err := readConfig(a, configGroupNetwork, ConfigNetwork{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cfg.Eth != nil && !reflect.DeepEqual(cfg.Eth, current.Eth) {
		writeValidationErrors(w, []configValidationError{{
			Path:    "eth",
			Message: "is read-only; use /network/transaction for Ethernet changes",
		}})
		return
	}
	// Preserve the legacy shadow exactly; only mkddc-netcfg may mutate Ethernet.
	cfg.Eth = current.Eth
	if errs := validateNetworkServiceConfig(cfg); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	result, err := a.writeConfigGroup(r, configGroupNetwork, cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleGetConfigIO(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupIO, ConfigIO{})
}

func (a *App) handlePutConfigIO(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	beforeIO, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	beforeVP, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var cfg ConfigIO
	if err := decodeConfigBody(w, r, &cfg); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	boardCap := a.boardCapability(r.Context())
	errs := append(validateConfigIOWithBoard(cfg, boardCap), validateConfigPointMetadata(cfg)...)
	errs = append(errs, validateIOAgainstBoard(cfg, boardCap)...)
	errs = append(errs, validateFixedPhysicalPointTags(cfg)...)
	if len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	cfg, _ = normalizePointTags(cfg, ConfigVirtualPoints{})
	vpCfg := beforeVP
	if errs := validatePointNamespaceTransition(beforeIO, beforeVP, cfg, vpCfg); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	safeCfg, err := readConfig(a, configGroupSafeState, ConfigSafeState{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	result, applyErrs, err := a.applyIOBundle(r, cfg, safeCfg, beforeIO.Revision)
	if len(applyErrs) > 0 {
		writePointTagErrors(w, applyErrs)
		return
	}
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleGetConfigSafeState(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupSafeState, ConfigSafeState{})
}

func (a *App) handlePutConfigSafeState(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()
	var safeCfg ConfigSafeState
	if err := decodeConfigBody(w, r, &safeCfg); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	ioCfg, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	result, errs, err := a.applyIOBundle(r, ioCfg, safeCfg, ioCfg.Revision)
	if len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleGetConfigVirtualPoints(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupVirtualPoints, defaultVirtualPointsConfig())
}

func (a *App) handlePutConfigVirtualPoints(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	beforeVP, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	beforeIO, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var cfg ConfigVirtualPoints
	if err := decodeConfigBody(w, r, &cfg); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if errs := append(validateConfigVirtualPoints(cfg), validateVirtualPointMetadata(cfg)...); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	cfg = normalizeVirtualPointsConfig(cfg)
	ioCfg := beforeIO
	if errs := validatePointNamespaceTransition(beforeIO, beforeVP, ioCfg, cfg); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	if err := a.writeVirtualPointsConfig(r, cfg, "config"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "success", Applied: true, Reload: reloadNone, Warnings: []string{}})
}

func (a *App) handleGetConfigBacnet(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupBacnet, ConfigBacnet{})
}

func (a *App) handlePutConfigBacnet(w http.ResponseWriter, r *http.Request) {
	handlePutConfig(a, w, r, configGroupBacnet, validateConfigBacnet)
}

func (a *App) handleGetConfigFieldbus(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupFieldbus, ConfigFieldbus{})
}

// handlePutConfigFieldbus ghi toàn bộ nhóm `fieldbus`.
//
// Mọi lần ghi đều đi qua `webModbus.Persister`. Bản trước chỉ dùng Persister khi
// body CÓ device hoặc point, còn body rỗng thì rơi xuống `writeConfigGroup` —
// một đường tắt marshal thẳng struct zero-value đè lên `fieldbus.conf`: không
// giữ `pointConfigMu`, không journal, không rollback, `revision` về 0 và toàn bộ
// `buses[]`/`devices[]`/`points[]` biến mất, rồi iobus được restart lên đúng cấu
// hình rỗng đó. Đó là mất dữ liệu không hoàn tác được qua một endpoint hợp lệ,
// đi vòng qua chính cơ chế sinh ra để chặn nó (REV-BE-01).
//
// Ngoài ra, thiếu khoá `devices`/`points` trong body KHÔNG còn được hiểu là
// "xoá hết". PUT là ghi đè toàn phần, nên xoá vẫn làm được — nhưng phải nói ra
// bằng `"devices": []`, chứ một client cũ gửi `{}` thì không có ý định đó.
func (a *App) handlePutConfigFieldbus(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: "invalid json"}})
		return
	}
	var present map[string]json.RawMessage
	if err := json.Unmarshal(body, &present); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: "invalid json"}})
		return
	}
	var cfg ConfigFieldbus
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&cfg); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: "invalid json"}})
		return
	}

	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()
	current, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})

	errs := validateConfigFieldbus(cfg)
	for _, field := range []struct {
		key     string
		dropped bool
	}{
		{"buses", len(cfg.Buses) == 0 && len(current.Buses) > 0},
		{"devices", len(cfg.Devices) == 0 && len(current.Devices) > 0},
		{"points", len(cfg.Points) == 0 && len(current.Points) > 0},
	} {
		if _, ok := present[field.key]; !ok && field.dropped {
			errs = append(errs, configValidationError{Path: field.key, Reason: "missing_field",
				Message: "vắng trong body sẽ xoá cấu hình đang lưu; gửi mảng rỗng nếu thật sự muốn xoá"})
		}
	}
	errs = append(errs, validateModbusRTUConfig(a, cfg)...)
	if len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}

	cfg.Revision = current.Revision
	result, err := a.applyModbusConfig(r, cfg)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func handlePutConfigValue(a *App, w http.ResponseWriter, r *http.Request, group configAPIGroup, cfg any) {
	result, err := a.writeConfigGroup(r, group, cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleGetConfigTime(w http.ResponseWriter, r *http.Request) {
	cfg, err := a.readTimeConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (a *App) handlePutConfigTime(w http.ResponseWriter, r *http.Request) {
	a.handlePutTimeConfig(w, r)
}

func (a *App) readSystemConfig() (SystemConfig, error) {
	var cfg SystemConfig
	var err error
	if cfg.Device, err = readConfig(a, configGroupDevice, ConfigDevice{}); err != nil {
		return SystemConfig{}, err
	}
	if cfg.Network, err = readConfig(a, configGroupNetwork, ConfigNetwork{}); err != nil {
		return SystemConfig{}, err
	}
	if cfg.IO, err = readConfig(a, configGroupIO, ConfigIO{}); err != nil {
		return SystemConfig{}, err
	}
	if cfg.SafeState, err = readConfig(a, configGroupSafeState, ConfigSafeState{}); err != nil {
		return SystemConfig{}, err
	}
	if cfg.VirtualPoints, err = readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig()); err != nil {
		return SystemConfig{}, err
	}
	if cfg.Bacnet, err = readConfig(a, configGroupBacnet, ConfigBacnet{}); err != nil {
		return SystemConfig{}, err
	}
	if cfg.Fieldbus, err = readConfig(a, configGroupFieldbus, ConfigFieldbus{}); err != nil {
		return SystemConfig{}, err
	}
	if cfg.Time, err = a.readTimeConfig(); err != nil {
		return SystemConfig{}, err
	}
	return cfg, nil
}

func handleGetConfig[T any](a *App, w http.ResponseWriter, group configAPIGroup, zero T) {
	cfg, err := readConfig(a, group, zero)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (a *App) writeConfigGroup(r *http.Request, group configAPIGroup, cfg any) (ConfigPutResult, error) {
	/* `T57-3.14`: chụp bản ĐANG lưu trước khi ghi đè, để vết audit nói được
	 *sửa cái gì* chứ không chỉ *đã sửa*. Đọc hỏng thì bỏ phần tóm tắt —
	 không được để một tiện ích nhật ký chặn đường ghi cấu hình. */
	previous := a.readConfigGroupRaw(group)

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return ConfigPutResult{}, fmt.Errorf("encode config: %w", err)
	}
	data = append(data, '\n')
	path := a.configPath(group.file)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return ConfigPutResult{}, fmt.Errorf("prepare config dir: %w", err)
	}
	if err := writeConfigFileAtomic(path, data, 0o644); err != nil {
		return ConfigPutResult{}, err
	}
	applied, warnings := a.dispatchReload(group.reload)
	result := "success"
	if !applied {
		result = "failed"
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.ChangeWithDetail(user, "config."+group.key, group.file, result, r.RemoteAddr, summarizeConfigDiff(previous, cfg))
	return ConfigPutResult{Result: result, Applied: applied, Reload: group.reload, Warnings: warnings}, nil
}

// readConfigGroupRaw đọc tệp cấu hình hiện hành ở dạng chung, chỉ để so khác biệt.
func (a *App) readConfigGroupRaw(group configAPIGroup) map[string]any {
	data, err := os.ReadFile(a.configPath(group.file))
	if err != nil {
		return nil
	}
	var generic map[string]any
	if err := json.Unmarshal(data, &generic); err != nil {
		return nil
	}
	return generic
}

func handlePutConfig[T any](a *App, w http.ResponseWriter, r *http.Request, group configAPIGroup, validate func(T) []configValidationError) {
	var cfg T
	if err := decodeConfigBody(w, r, &cfg); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if errs := validate(cfg); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	result, err := a.writeConfigGroup(r, group, cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func readConfig[T any](a *App, group configAPIGroup, zero T) (T, error) {
	cfg := zero
	if err := readConfigJSON(a.configPath(group.file), &cfg); err != nil {
		if errors.Is(err, ErrConfigMissing) {
			return zero, nil
		}
		return zero, err
	}
	return cfg, nil
}

func (a *App) configPath(file string) string {
	dir := a.cfg.ConfigDir
	if dir == "" {
		dir = resolveConfigDir()
	}
	return filepath.Join(dir, file)
}

func decodeConfigBody[T any](w http.ResponseWriter, r *http.Request, dst *T) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("invalid json")
	}
	return nil
}

func writeValidationErrors(w http.ResponseWriter, details []configValidationError) {
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error":      "validation failed",
		"code":       http.StatusBadRequest,
		"request_id": requestID(),
		"details":    details,
	})
}

func writePointTagErrors(w http.ResponseWriter, details []configValidationError) {
	status := http.StatusBadRequest
	message := "point metadata invalid"
	for _, detail := range details {
		if detail.Reason == "point_tag_conflict" || detail.Reason == "point_name_conflict" || detail.Reason == "point_namespace_conflicted" {
			status = http.StatusConflict
			message = "point namespace conflict"
			break
		}
	}
	writeJSON(w, status, map[string]any{
		"error":      message,
		"code":       status,
		"request_id": requestID(),
		"details":    details,
	})
}

func validateConfigDevice(cfg ConfigDevice) []configValidationError {
	var errs []configValidationError
	if cfg.DeviceID < 1 || cfg.DeviceID > 4194302 {
		addConfigErr(&errs, "device_id", "must be integer in range 1..4194302")
	}
	if strings.TrimSpace(cfg.DeviceName) == "" {
		addConfigErr(&errs, "device_name", "is required")
	} else if len(cfg.DeviceName) > 64 {
		addConfigErr(&errs, "device_name", "must be at most 64 bytes")
	}
	return errs
}

func validateConfigNetwork(cfg ConfigNetwork) []configValidationError {
	var errs []configValidationError
	validateIPInterface(&errs, "eth", cfg.Eth)
	validateIPInterface(&errs, "wifi", cfg.Wifi)
	if cfg.Hostname != "" && !validHostname(cfg.Hostname) {
		addConfigErr(&errs, "hostname", "must be a valid hostname")
	}
	if enabled, ok, good := boolField(cfg.Wifi, "enabled"); ok && !good {
		addConfigErr(&errs, "wifi.enabled", "must be boolean")
	} else if ok && enabled {
		if ssid, ok, good := stringField(cfg.Wifi, "ssid"); !ok || !good || strings.TrimSpace(ssid) == "" {
			addConfigErr(&errs, "wifi.ssid", "is required when wifi.enabled=true")
		}
	}
	return errs
}

func validateNetworkServiceConfig(cfg ConfigNetwork) []configValidationError {
	// Ethernet in network.conf is a compatibility shadow, not an input to the
	// desired-service save path. The authoritative validator lives in netcfg.
	cfg.Eth = nil
	return validateConfigNetwork(cfg)
}

// validateIOAgainstBoard là phần kiểm CHỈ trả lời được khi biết bo có gì —
// tách khỏi `validateConfigIO` (thuần hình dạng dữ liệu) vì hai loại kiểm này
// có vòng đời khác nhau: hình dạng sai thì luôn sai, còn "kênh này chọn PT100"
// chỉ sai trên một bo cụ thể.
//
// Tiêu chí thứ ba của `ISS-PIO-12` có hai nửa và chúng KHÔNG cùng ngưỡng:
//
//   - Không MỜI chọn nhiệt trở khi chưa hỏi được RTD — `/system/capabilities`
//     lo, và nó giữ lại mode ngay cả ở ca "chưa biết".
//   - Không CHO GHI nhiệt trở — hàm này lo, và nó chỉ chặn khi có BẰNG CHỨNG
//     DƯƠNG là bo không có mạch (`Known && !RTD`). Chặn ở ca "chưa biết" sẽ
//     làm mọi bo đang không chạy iobus mất khả năng lưu lại chính cấu hình
//     nhiệt trở nó đang dùng thật — một cách hỏng tệ hơn cái nó định tránh.
func validateIOAgainstBoard(cfg ConfigIO, boardCap capabilities.BoardCap) []configValidationError {
	var errs []configValidationError
	for i, item := range cfg.UI {
		mode, ok, good := stringField(item, "type")
		if !ok || !good {
			continue
		}
		if reason := capabilities.RTDModeBlockedBy(boardCap, mode); reason != "" {
			addConfigErr(&errs, fmt.Sprintf("ui[%d].type", i), reason)
		}
	}
	return errs
}

// ioModeSets nối enum mode của `capabilities` vào schema, để enum của validator
// và enum mà `/system/capabilities` công bố là CÙNG MỘT BIẾN.
func ioModeSets() configschema.ModeSets {
	return configschema.ModeSets{UI: capabilities.UIModes, AO: capabilities.AOModes, DO: capabilities.DOModes}
}

// boundsFor dịch năng lực bo thành trần kênh cho schema (`ISS-PIO-27`: "validate
// theo capability").
//
// Chỉ SIẾT khi có BẰNG CHỨNG DƯƠNG là khối kênh không tồn tại (`presence: no`).
// `unknown` giữ nguyên sức chứa ABI — siết ở ca chưa biết sẽ làm mọi bo đang
// không chạy `iobus` mất khả năng lưu lại chính cấu hình nó đang chạy, một cách
// hỏng tệ hơn hẳn cái nó định tránh. Cùng ngưỡng với cổng nhiệt trở ở
// `validateIOAgainstBoard`.
func boundsFor(doc capabilities.Document, kind string, abiCapacity int) configschema.Bounds {
	for _, block := range doc.Blocks {
		if block.Kind != kind {
			continue
		}
		if block.Presence == capabilities.PresenceNo {
			return configschema.Bounds{MaxChannel: 0, AbsentReason: fmt.Sprintf("BOARD_CAP_MAP nói bo không có khối kênh %s nên không nhận cấu hình cho nó", kind)}
		}
		if block.Presence == capabilities.PresenceYes && block.Count > 0 {
			return configschema.Bounds{MaxChannel: block.Count}
		}
	}
	return configschema.Bounds{MaxChannel: abiCapacity}
}

func ioBounds(boardCap capabilities.BoardCap) map[string]configschema.Bounds {
	doc := capabilities.Build(boardCap)
	return map[string]configschema.Bounds{
		"ui": boundsFor(doc, "UI", capabilities.ABIUniversalInputs),
		"ao": boundsFor(doc, "AO", capabilities.ABIAnalogOutputs),
		"do": boundsFor(doc, "DO", capabilities.ABIDigitalOutputs),
	}
}

func schemaErrors(errs *[]configValidationError, found []configschema.Error) {
	for _, item := range found {
		addConfigErr(errs, item.Path, item.Message)
	}
}

// validateConfigIO kiểm hình dạng `io_config.conf` theo schema có kiểu
// (`internal/configschema`) thay cho chuỗi lệnh `if` viết tay trước đây.
//
// Thay đổi hành vi DUY NHẤT so với bản cũ — và là mục đích của `ISS-PIO-27`:
// khoá lạ nay bị TỪ CHỐI. Trước đây `scale_hi` gõ thành `scale_high` được nhận,
// ghi xuống đĩa, rồi chỉ lộ ra khi `iobus` khởi động lại và lặng lẽ dùng mặc
// định. Mọi phép kiểm kiểu/dải/enum cũ đều được schema giữ nguyên nguyên văn
// thông báo.
func validateConfigIO(cfg ConfigIO) []configValidationError {
	return validateConfigIOWithBoard(cfg, capabilities.BoardCap{})
}

func validateConfigIOWithBoard(cfg ConfigIO, boardCap capabilities.BoardCap) []configValidationError {
	var errs []configValidationError
	collections := configschema.IOCollections(ioModeSets())
	bounds := ioBounds(boardCap)
	schemaErrors(&errs, configschema.Validate(collections["ui"], cfg.UI, bounds["ui"]))
	schemaErrors(&errs, configschema.Validate(collections["ao"], cfg.AO, bounds["ao"]))
	schemaErrors(&errs, configschema.Validate(collections["do"], cfg.DO, bounds["do"]))
	// Tên điểm đi qua bộ chuẩn hoá riêng (`ADR-042`) chứ không phải một dải số,
	// nên nó không diễn đạt được bằng bảng Field.
	for i, item := range cfg.AO {
		if name, ok, good := stringField(item, "name"); ok && good {
			if _, _, err := normalizePointName(name); err != nil {
				addConfigErr(&errs, fmt.Sprintf("ao[%d].name", i), err.Error())
			}
		}
	}
	return errs
}

func validateConfigSafeState(cfg ConfigSafeState) []configValidationError {
	return validateConfigSafeStateWithBoard(cfg, capabilities.BoardCap{})
}

func validateConfigSafeStateWithBoard(cfg ConfigSafeState, boardCap capabilities.BoardCap) []configValidationError {
	var errs []configValidationError
	collections := configschema.SafeStateCollections(ioModeSets())
	bounds := ioBounds(boardCap)
	schemaErrors(&errs, configschema.Validate(collections["ao"], cfg.AO, bounds["ao"]))
	schemaErrors(&errs, configschema.Validate(collections["do"], cfg.DO, bounds["do"]))
	return errs
}

func validateConfigBacnet(cfg ConfigBacnet) []configValidationError {
	var errs []configValidationError
	if cfg.BIP == nil {
		return errs
	}
	if _, ok, good := boolField(cfg.BIP, "enabled"); ok && !good {
		addConfigErr(&errs, "bip.enabled", "must be boolean")
	}
	if port, ok, good := intField(cfg.BIP, "udp_port"); ok && (!good || port < 1 || port > 65535) {
		addConfigErr(&errs, "bip.udp_port", "must be integer in range 1..65535")
	}
	validateNullOrObject(&errs, cfg.BIP, "bip.bbmd", "bbmd")
	validateNullOrObject(&errs, cfg.BIP, "bip.foreign_device", "foreign_device")
	if _, ok := cfg.BIP["mstp"]; ok {
		addConfigErr(&errs, "bip.mstp", "is not supported; BACnet is BACnet/IP only")
	}
	if _, ok := cfg.BIP["rs485_mode"]; ok {
		addConfigErr(&errs, "bip.rs485_mode", "is not supported; use fieldbus.rs485")
	}
	return errs
}

func validateConfigFieldbus(cfg ConfigFieldbus) []configValidationError {
	var errs []configValidationError
	if cfg.RS485 != nil {
		if baud, ok, good := intField(cfg.RS485, "baud"); ok && (!good || baud < 1200 || baud > 115200) {
			addConfigErr(&errs, "rs485.baud", "must be integer in range 1200..115200")
		}
		validateStringEnum(&errs, cfg.RS485, "rs485.parity", "parity", false, "N", "E", "O")
		if stop, ok, good := intField(cfg.RS485, "stop"); ok && (!good || (stop != 1 && stop != 2)) {
			addConfigErr(&errs, "rs485.stop", "must be 1 or 2")
		}
	}
	if cfg.PollDefaultMs != 0 && (cfg.PollDefaultMs < 10 || cfg.PollDefaultMs > 60000) {
		addConfigErr(&errs, "poll_default_ms", "must be integer in range 10..60000")
	}
	for i, item := range cfg.Slaves {
		base := fmt.Sprintf("slaves[%d]", i)
		if addr, ok, good := intField(item, "addr"); !ok {
			addConfigErr(&errs, base+".addr", "is required")
		} else if !good || addr < 1 || addr > 247 {
			addConfigErr(&errs, base+".addr", "must be integer in range 1..247")
		}
		if poll, ok, good := intField(item, "poll_ms"); ok && (!good || poll < 10 || poll > 60000) {
			addConfigErr(&errs, base+".poll_ms", "must be integer in range 10..60000")
		}
		validateOptionalString(&errs, item, base+".profile", "profile")
		validateOptionalString(&errs, item, base+".name", "name")
	}
	return errs
}

func validateConfigTime(cfg ConfigTime) []configValidationError {
	var errs []configValidationError
	if cfg.Timezone != "" && len(cfg.Timezone) > 64 {
		addConfigErr(&errs, "timezone", "must be at most 64 bytes")
	}
	for i, server := range cfg.NTPServers {
		if strings.TrimSpace(server) == "" {
			addConfigErr(&errs, fmt.Sprintf("ntp_servers[%d]", i), "must not be empty")
		}
	}
	if cfg.SystemTime != "" {
		if _, err := time.Parse(time.RFC3339, cfg.SystemTime); err != nil {
			addConfigErr(&errs, "system_time", "must be RFC3339 date-time")
		}
	}
	return errs
}

func validateIPInterface(errs *[]configValidationError, path string, cfg map[string]any) {
	if cfg == nil {
		return
	}
	validateStringEnum(errs, cfg, path+".mode", "mode", false, "dhcp", "static")
	for _, key := range []string{"ip", "netmask", "gateway"} {
		value, ok, good := stringField(cfg, key)
		if !ok {
			continue
		}
		field := path + "." + key
		if !good || strings.TrimSpace(value) == "" || net.ParseIP(value) == nil {
			addConfigErr(errs, field, "must be a valid IP address")
		}
	}
	if raw, ok := cfg["dns"]; ok {
		items, good := raw.([]any)
		if !good {
			addConfigErr(errs, path+".dns", "must be array of IP addresses")
			return
		}
		for i, item := range items {
			server, good := item.(string)
			if !good || net.ParseIP(server) == nil {
				addConfigErr(errs, fmt.Sprintf("%s.dns[%d]", path, i), "must be a valid IP address")
			}
		}
	}
}

func validateStringEnum(errs *[]configValidationError, item map[string]any, path string, key string, required bool, allowed ...string) {
	value, ok, good := stringField(item, key)
	if !ok {
		if required {
			addConfigErr(errs, path, "is required")
		}
		return
	}
	if !good {
		addConfigErr(errs, path, "must be string")
		return
	}
	for _, candidate := range allowed {
		if value == candidate {
			return
		}
	}
	addConfigErr(errs, path, "must be one of "+strings.Join(allowed, ", "))
}

func validateOptionalString(errs *[]configValidationError, item map[string]any, path string, key string) {
	_, ok, good := stringField(item, key)
	if ok && !good {
		addConfigErr(errs, path, "must be string")
	}
}

func validateNullOrObject(errs *[]configValidationError, item map[string]any, path string, key string) {
	value, ok := item[key]
	if !ok || value == nil {
		return
	}
	if _, good := value.(map[string]any); !good {
		addConfigErr(errs, path, "must be object or null")
	}
}

func addConfigErr(errs *[]configValidationError, path string, message string) {
	*errs = append(*errs, configValidationError{Path: path, Message: message})
}

func stringField(item map[string]any, key string) (string, bool, bool) {
	if item == nil {
		return "", false, false
	}
	value, ok := item[key]
	if !ok {
		return "", false, false
	}
	text, good := value.(string)
	return text, true, good
}

func boolField(item map[string]any, key string) (bool, bool, bool) {
	if item == nil {
		return false, false, false
	}
	value, ok := item[key]
	if !ok {
		return false, false, false
	}
	flag, good := value.(bool)
	return flag, true, good
}

func numberField(item map[string]any, key string) (float64, bool, bool) {
	if item == nil {
		return 0, false, false
	}
	value, ok := item[key]
	if !ok {
		return 0, false, false
	}
	switch typed := value.(type) {
	case json.Number:
		n, err := typed.Float64()
		return n, true, err == nil
	case float64:
		return typed, true, true
	case float32:
		return float64(typed), true, true
	case int:
		return float64(typed), true, true
	case int64:
		return float64(typed), true, true
	case int32:
		return float64(typed), true, true
	default:
		return 0, true, false
	}
}

func intField(item map[string]any, key string) (int, bool, bool) {
	if item == nil {
		return 0, false, false
	}
	value, ok := item[key]
	if !ok {
		return 0, false, false
	}
	switch typed := value.(type) {
	case json.Number:
		i, err := typed.Int64()
		if err == nil {
			return int(i), true, true
		}
		return 0, true, false
	case float64:
		i := int(typed)
		return i, true, typed == float64(i)
	case int:
		return typed, true, true
	case int64:
		return int(typed), true, true
	case int32:
		return int(typed), true, true
	default:
		return 0, true, false
	}
}

func validHostname(hostname string) bool {
	if len(hostname) > 253 {
		return false
	}
	labels := strings.Split(hostname, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, r := range label {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
				continue
			}
			return false
		}
	}
	return true
}
