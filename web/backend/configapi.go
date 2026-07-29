package main

import (
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
	errs := append(validateConfigIO(cfg), validateConfigPointMetadata(cfg)...)
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
	result, err := a.writeConfigGroup(r, configGroupIO, cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleGetConfigSafeState(w http.ResponseWriter, r *http.Request) {
	handleGetConfig(a, w, configGroupSafeState, ConfigSafeState{})
}

func (a *App) handlePutConfigSafeState(w http.ResponseWriter, r *http.Request) {
	handlePutConfig(a, w, r, configGroupSafeState, validateConfigSafeState)
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

func (a *App) handlePutConfigFieldbus(w http.ResponseWriter, r *http.Request) {
	handlePutConfig(a, w, r, configGroupFieldbus, validateConfigFieldbus)
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
	a.audit.Change(user, "config."+group.key, group.file, result, r.RemoteAddr)
	return ConfigPutResult{Result: result, Applied: applied, Reload: group.reload, Warnings: warnings}, nil
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

func validateConfigIO(cfg ConfigIO) []configValidationError {
	var errs []configValidationError
	for i, item := range cfg.UI {
		base := fmt.Sprintf("ui[%d]", i)
		validateChannel(&errs, item, base+".ch", 1, 16)
		validateStringEnum(&errs, item, base+".type", "type", true, "none", "0-10V", "2-10V", "4-20mA", "PT100", "PT1000", "NTC10k", "NTC20k", "dry", "potentiometer", "light", "pulse")
		validateOptionalString(&errs, item, base+".unit", "unit")
		validateOptionalString(&errs, item, base+".name", "name")
		validateOptionalString(&errs, item, base+".note", "note")
		if _, ok, good := boolField(item, "enabled"); ok && !good {
			addConfigErr(&errs, base+".enabled", "must be boolean")
		}
		if _, ok, good := boolField(item, "invert"); ok && !good {
			addConfigErr(&errs, base+".invert", "must be boolean")
		}
		if rm, ok, good := intField(item, "range_mult"); ok && (!good || rm < 0 || rm > 5) {
			addConfigErr(&errs, base+".range_mult", "must be integer in range 0..5")
		}
		if samples, ok, good := intField(item, "filter_samples"); ok && (!good || samples < 0 || samples > 100) {
			addConfigErr(&errs, base+".filter_samples", "must be integer in range 0..100")
		}
		if mathFunc, ok, good := intField(item, "math_func"); ok && (!good || mathFunc < 0 || mathFunc > 3) {
			addConfigErr(&errs, base+".math_func", "must be integer in range 0..3")
		}
		if cal, ok, good := numberField(item, "sensor_cal"); ok && (!good || cal < -12.7 || cal > 12.8) {
			addConfigErr(&errs, base+".sensor_cal", "must be number in range -12.7..12.8")
		}
		lo, hasLo, okLo := numberField(item, "scale_lo")
		hi, hasHi, okHi := numberField(item, "scale_hi")
		if hasLo && !okLo {
			addConfigErr(&errs, base+".scale_lo", "must be number")
		}
		if hasHi && !okHi {
			addConfigErr(&errs, base+".scale_hi", "must be number")
		}
		if hasLo && hasHi && okLo && okHi && hi <= lo {
			addConfigErr(&errs, base+".scale_hi", "must be greater than scale_lo")
		}
	}
	for i, item := range cfg.AO {
		base := fmt.Sprintf("ao[%d]", i)
		validateChannel(&errs, item, base+".ch", 1, 4)
		validateStringEnum(&errs, item, base+".mode", "mode", true, "0-10V", "4-20mA")
		if name, ok, good := stringField(item, "name"); ok && !good {
			addConfigErr(&errs, base+".name", "must be string")
		} else if ok {
			if _, _, err := normalizePointName(name); err != nil {
				addConfigErr(&errs, base+".name", err.Error())
			}
		}
		validateStringEnum(&errs, item, base+".units", "units", false,
			"percent", "volt", "milliampere", "degC", "Pa", "RPM", "ppm", "no_units")
		minPV, hasMin, okMin := numberField(item, "min_pv")
		maxPV, hasMax, okMax := numberField(item, "max_pv")
		if hasMin && !okMin {
			addConfigErr(&errs, base+".min_pv", "must be number")
		}
		if hasMax && !okMax {
			addConfigErr(&errs, base+".max_pv", "must be number")
		}
		if hasMin && hasMax && okMin && okMax && maxPV <= minPV {
			addConfigErr(&errs, base+".max_pv", "must be greater than min_pv")
		}
	}
	for i, item := range cfg.DO {
		base := fmt.Sprintf("do[%d]", i)
		validateChannel(&errs, item, base+".ch", 1, 4)
		if _, ok, good := stringField(item, "name"); ok && !good {
			addConfigErr(&errs, base+".name", "must be string")
		}
	}
	return errs
}

func validateConfigSafeState(cfg ConfigSafeState) []configValidationError {
	var errs []configValidationError
	for i, item := range cfg.AO {
		base := fmt.Sprintf("ao[%d]", i)
		validateChannel(&errs, item, base+".ch", 1, 4)
		safe, ok, good := numberField(item, "safe")
		if !ok {
			addConfigErr(&errs, base+".safe", "is required")
		} else if !good || safe < 0 || safe > 20 {
			addConfigErr(&errs, base+".safe", "must be number in range 0..20")
		}
	}
	for i, item := range cfg.DO {
		base := fmt.Sprintf("do[%d]", i)
		validateChannel(&errs, item, base+".ch", 1, 4)
		validateStringEnum(&errs, item, base+".safe", "safe", true, "open", "closed")
	}
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

func validateChannel(errs *[]configValidationError, item map[string]any, path string, min int, max int) {
	ch, ok, good := intField(item, "ch")
	if !ok {
		addConfigErr(errs, path, "is required")
		return
	}
	if !good || ch < min || ch > max {
		addConfigErr(errs, path, fmt.Sprintf("must be integer in range %d..%d", min, max))
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
