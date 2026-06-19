package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type NetworkPageData struct {
	Northbound NetworkPageConfig `json:"northbound"`
	Southbound []NetworkSlave    `json:"southbound"`
}

type NetworkPageConfig struct {
	DeviceName       string `json:"deviceName"`
	IP               string `json:"ip"`
	DHCP             bool   `json:"dhcp"`
	WifiEnabled      bool   `json:"wifiEnabled"`
	Subnet           string `json:"subnet"`
	Gateway          string `json:"gateway"`
	BacnetDeviceID   string `json:"bacnetDeviceId"`
	BacnetDeviceName string `json:"bacnetDeviceName"`
	BacnetPort       int    `json:"bacnetPort"`
	BMSLink          string `json:"bmsLink"`
}

type NetworkSlave struct {
	Address    int     `json:"address"`
	Name       string  `json:"name"`
	Profile    string  `json:"profile"`
	BaudRate   int     `json:"baudRate"`
	PollState  string  `json:"pollState"`
	ErrorRate  float64 `json:"errorRate"`
	LastPollMS int     `json:"lastPollMs"`
}

func (a *App) handleGetNetworkPage(w http.ResponseWriter, r *http.Request) {
	data, err := a.readNetworkPage(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func (a *App) handlePutNetworkPage(w http.ResponseWriter, r *http.Request) {
	var payload NetworkPageData
	if err := decodeConfigBody(w, r, &payload); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	currentNetwork, err := readConfig(a, configGroupNetwork, ConfigNetwork{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	currentDevice, err := readConfig(a, configGroupDevice, ConfigDevice{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	currentBacnet, err := readConfig(a, configGroupBacnet, ConfigBacnet{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	networkCfg, deviceCfg, bacnetCfg, errs := networkPageConfigToFiles(payload.Northbound, currentNetwork, currentDevice, currentBacnet)
	if len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	if err := a.writeNetworkPageFiles(networkCfg, deviceCfg, bacnetCfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, systemWarnings := a.dispatchReload(reloadSystem)
	_, bacnetWarnings := a.dispatchReload(reloadRestartIobus)
	warnings := append(systemWarnings, bacnetWarnings...)
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "network.config", "network/device/bacnet", "success", r.RemoteAddr)
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "success", Applied: len(warnings) == 0, Reload: reloadSystem, Warnings: warnings})
}

func (a *App) readNetworkPage(r *http.Request) (NetworkPageData, error) {
	device, err := readConfig(a, configGroupDevice, ConfigDevice{})
	if err != nil {
		return NetworkPageData{}, err
	}
	network, err := readConfig(a, configGroupNetwork, ConfigNetwork{})
	if err != nil {
		return NetworkPageData{}, err
	}
	bacnet, err := readConfig(a, configGroupBacnet, ConfigBacnet{})
	if err != nil {
		return NetworkPageData{}, err
	}
	fieldbus, err := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if err != nil {
		return NetworkPageData{}, err
	}
	core, err := a.core.ReadStatus(r.Context())
	if err != nil {
		a.logger.Printf("WARN network_page core_status err=%v", err)
	}
	north := networkPageConfigFromFiles(device, network, bacnet)
	return NetworkPageData{Northbound: north, Southbound: networkSlavesFromConfig(fieldbus, core)}, nil
}

func networkPageConfigFromFiles(device ConfigDevice, network ConfigNetwork, bacnet ConfigBacnet) NetworkPageConfig {
	eth := network.Eth
	wifi := network.Wifi
	bip := bacnet.BIP
	ip := stringValue(eth, "ip")
	if ip == "" {
		ip = primaryIPv4()
	}
	deviceName := device.DeviceName
	if deviceName == "" {
		deviceName = network.Hostname
	}
	port := intValue(bip, "udp_port")
	return NetworkPageConfig{
		DeviceName:       deviceName,
		IP:               ip,
		DHCP:             strings.EqualFold(stringValue(eth, "mode"), "dhcp"),
		WifiEnabled:      boolValue(wifi, "enabled"),
		Subnet:           stringValue(eth, "netmask"),
		Gateway:          stringValue(eth, "gateway"),
		BacnetDeviceID:   intString(device.DeviceID),
		BacnetDeviceName: device.DeviceName,
		BacnetPort:       port,
		BMSLink:          bmsLinkStatus(ip, boolValue(bip, "enabled"), port),
	}
}

func networkSlavesFromConfig(fieldbus ConfigFieldbus, core CoreStatus) []NetworkSlave {
	baud := intValue(fieldbus.RS485, "baud")
	state := "degraded"
	if core.IOP.Status == "normal" {
		state = "online"
	}
	lastPoll := 0
	if core.IOP.LastIORespMS != nil {
		lastPoll = int(*core.IOP.LastIORespMS)
	}
	items := make([]NetworkSlave, 0, len(fieldbus.Slaves))
	for _, slave := range fieldbus.Slaves {
		addr := intValue(slave, "addr")
		if addr == 0 {
			continue
		}
		items = append(items, NetworkSlave{
			Address:    addr,
			Name:       stringValue(slave, "name"),
			Profile:    displayModbusProfile(stringValue(slave, "profile")),
			BaudRate:   baud,
			PollState:  state,
			ErrorRate:  0,
			LastPollMS: lastPoll,
		})
	}
	return items
}

func networkPageConfigToFiles(cfg NetworkPageConfig, baseNetwork ConfigNetwork, baseDevice ConfigDevice, baseBacnet ConfigBacnet) (ConfigNetwork, ConfigDevice, ConfigBacnet, []configValidationError) {
	var errs []configValidationError
	deviceID, err := strconv.Atoi(strings.TrimSpace(cfg.BacnetDeviceID))
	if err != nil {
		addConfigErr(&errs, "bacnetDeviceId", "must be integer")
	}
	eth := cloneMap(baseNetwork.Eth)
	eth["mode"] = modeFromDHCP(cfg.DHCP)
	setOptionalString(eth, "ip", cfg.IP)
	setOptionalString(eth, "netmask", cfg.Subnet)
	setOptionalString(eth, "gateway", cfg.Gateway)
	wifi := cloneMap(baseNetwork.Wifi)
	wifi["enabled"] = cfg.WifiEnabled
	wifi["mode"] = modeFromDHCP(cfg.DHCP)
	bip := cloneMap(baseBacnet.BIP)
	bip["enabled"] = true
	bip["udp_port"] = cfg.BacnetPort
	networkCfg := ConfigNetwork{
		Hostname: firstNonEmpty(cfg.DeviceName, baseNetwork.Hostname),
		Eth:      eth,
		Wifi:     wifi,
	}
	deviceCfg := ConfigDevice{DeviceID: deviceID, DeviceName: firstNonEmpty(cfg.BacnetDeviceName, cfg.DeviceName), Description: baseDevice.Description, Location: baseDevice.Location}
	bacnetCfg := ConfigBacnet{BIP: bip}
	errs = append(errs, validateConfigNetwork(networkCfg)...)
	errs = append(errs, validateConfigDevice(deviceCfg)...)
	errs = append(errs, validateConfigBacnet(bacnetCfg)...)
	return networkCfg, deviceCfg, bacnetCfg, errs
}

func (a *App) writeNetworkPageFiles(network ConfigNetwork, device ConfigDevice, bacnet ConfigBacnet) error {
	items := []struct {
		group configAPIGroup
		value any
	}{
		{configGroupNetwork, network},
		{configGroupDevice, device},
		{configGroupBacnet, bacnet},
	}
	for _, item := range items {
		data, err := json.MarshalIndent(item.value, "", "  ")
		if err != nil {
			return err
		}
		path := a.configPath(item.group.file)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("prepare config dir: %w", err)
		}
		if err := writeConfigFileAtomic(path, append(data, '\n'), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func bmsLinkStatus(ip string, enabled bool, port int) string {
	if enabled && ip != "" && port > 0 {
		return "online"
	}
	return "offline"
}

func modeFromDHCP(enabled bool) string {
	if enabled {
		return "dhcp"
	}
	return "static"
}

func intString(value int) string {
	if value == 0 {
		return ""
	}
	return strconv.Itoa(value)
}

func stringValue(item map[string]any, key string) string {
	value, _, ok := stringField(item, key)
	if !ok {
		return ""
	}
	return value
}

func boolValue(item map[string]any, key string) bool {
	value, _, ok := boolField(item, key)
	return ok && value
}

func intValue(item map[string]any, key string) int {
	value, _, ok := intField(item, key)
	if !ok {
		return 0
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func cloneMap(src map[string]any) map[string]any {
	dst := make(map[string]any, len(src)+4)
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func setOptionalString(item map[string]any, key string, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		delete(item, key)
		return
	}
	item[key] = value
}

func displayModbusProfile(profile string) string {
	raw := strings.ToLower(profile)
	switch {
	case strings.Contains(raw, "hmi"):
		return "Remote HMI"
	case strings.Contains(raw, "meter"):
		return "Meter"
	case strings.Contains(raw, "vfd"):
		return "VFD"
	case strings.Contains(raw, "io") || strings.Contains(raw, "i/o"):
		return "EXT I/O"
	case profile != "":
		return profile
	default:
		return "EXT I/O"
	}
}
