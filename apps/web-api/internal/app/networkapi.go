package app

import (
	"context"
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

	// BMSLink là "online" | "offline" | "unknown".
	//
	// F-04: trước 2026-07-31 giá trị này được suy ra từ chỗ bip.enabled=true và
	// ip/port trong FILE config khác rỗng, nên báo online cả khi bip_init() đã
	// thất bại và BMS hoàn toàn không nói chuyện được. Nay nó đến từ cờ bind
	// THẬT do iobus publish; iobus cũ không publish thì là "unknown", không đoán.
	BMSLink string `json:"bmsLink"`
	// ActiveBacnetPort là cổng UDP đang bind THẬT, có thể khác BacnetPort trong
	// file khi cấu hình đã sửa nhưng chưa reload. nil = không biết.
	ActiveBacnetPort *int `json:"activeBacnetPort"`

	// F-10: hai trường trước đây bị gán cứng "N/A" ở frontend.
	// Firmware là phiên bản web/API đang CHẠY; Serial là serial phần cứng đọc từ
	// device-tree, rỗng nghĩa là thiết bị chưa được provision serial — và giao
	// diện phải nói đúng như vậy chứ không bịa ra một mã.
	Firmware string `json:"firmware"`
	Serial   string `json:"serial"`
}

type NetworkSlave struct {
	Address   int    `json:"address"`
	Name      string `json:"name"`
	Profile   string `json:"profile"`
	BaudRate  int    `json:"baudRate"`
	PollState string `json:"pollState"` // "online" | "offline" | "unknown"

	// F-03: ba trường dưới đây từng bị gán cứng (ErrorRate=0) hoặc dùng CHUNG một
	// giá trị toàn cục cho mọi slave, khiến một thiết bị hỏng giữa nhiều thiết bị
	// là không thể nhìn thấy. Nay là số đo per-slave do iobus đếm.
	// nil = chưa có số đo (iobus chưa publish hoặc chưa poll lần nào) — KHÔNG
	// được hiển thị thành 0.
	ErrorRate   *float64 `json:"errorRate"`
	LastPollMS  *int     `json:"lastPollMs"`
	TotalPolls  *uint32  `json:"totalPolls"`
	TotalErrors *uint32  `json:"totalErrors"`
}

// FieldbusTelemetryReader tách riêng khỏi CoreStatusClient để các fake sẵn có
// không phải hiện thực thêm; chỉ test mạng mới cần cung cấp.
type FieldbusTelemetryReader interface {
	ReadFieldbusTelemetry(ctx context.Context) (FieldbusTelemetry, error)
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
	if _, err := a.core.ReadStatus(r.Context()); err != nil {
		a.logger.Printf("WARN network_page core_status err=%v", err)
	}
	telemetry := a.readFieldbusTelemetry(r.Context())
	north := networkPageConfigFromFiles(device, network, bacnet, telemetry, a.cfg.WebVersion)
	return NetworkPageData{
		Northbound: north,
		Southbound: networkSlavesFromConfig(fieldbus, telemetry),
	}, nil
}

// readFieldbusTelemetry trả nil khi không có số đo thật — đó là tín hiệu "không
// biết" mà mọi hàm phía sau phải tôn trọng thay vì thay bằng giá trị mặc định.
func (a *App) readFieldbusTelemetry(ctx context.Context) *FieldbusTelemetry {
	reader, ok := a.core.(FieldbusTelemetryReader)
	if !ok {
		return nil
	}
	telemetry, err := reader.ReadFieldbusTelemetry(ctx)
	if err != nil {
		a.logger.Printf("WARN network_page fieldbus_telemetry err=%v", err)
		return nil
	}
	return &telemetry
}

func networkPageConfigFromFiles(device ConfigDevice, network ConfigNetwork, bacnet ConfigBacnet,
	telemetry *FieldbusTelemetry, webVersion string) NetworkPageConfig {
	eth := network.Eth
	wifi := network.Wifi
	bip := bacnet.BIP
	ip := stringValue(eth, "ip")
	deviceName := device.DeviceName
	if deviceName == "" {
		deviceName = network.Hostname
	}
	cfg := NetworkPageConfig{
		DeviceName:       deviceName,
		IP:               ip,
		DHCP:             strings.EqualFold(stringValue(eth, "mode"), "dhcp"),
		WifiEnabled:      boolValue(wifi, "enabled"),
		Subnet:           stringValue(eth, "netmask"),
		Gateway:          stringValue(eth, "gateway"),
		BacnetDeviceID:   intString(device.DeviceID),
		BacnetDeviceName: device.DeviceName,
		BacnetPort:       intValue(bip, "udp_port"),
		BMSLink:          bmsLinkStatus(telemetry),
		Firmware:         webVersion,
		Serial:           deviceSerial(),
	}
	if telemetry != nil && telemetry.BacnetBound {
		port := int(telemetry.BacnetPort)
		cfg.ActiveBacnetPort = &port
	}
	return cfg
}

func networkSlavesFromConfig(fieldbus ConfigFieldbus, telemetry *FieldbusTelemetry) []NetworkSlave {
	baud := intValue(fieldbus.RS485, "baud")
	// Chỉ tra cứu theo địa chỉ Modbus: thứ tự trong file config và thứ tự slave
	// trong iobus không bắt buộc trùng nhau, ghép theo chỉ số sẽ gán nhầm số đo
	// của thiết bị này sang thiết bị khác.
	measured := map[uint8]SlaveTelemetry{}
	if telemetry != nil && telemetry.Published {
		for _, slave := range telemetry.Slaves {
			measured[slave.Addr] = slave
		}
	}
	items := make([]NetworkSlave, 0, len(fieldbus.Slaves))
	for _, slave := range fieldbus.Slaves {
		addr := intValue(slave, "addr")
		if addr == 0 {
			continue
		}
		item := NetworkSlave{
			Address:   addr,
			Name:      stringValue(slave, "name"),
			Profile:   displayModbusProfile(stringValue(slave, "profile")),
			BaudRate:  baud,
			PollState: "unknown",
		}
		if metrics, ok := measured[uint8(addr)]; ok {
			item.PollState = "offline"
			if metrics.Online {
				item.PollState = "online"
			}
			polls, errors := metrics.TotalPolls, metrics.TotalErrors
			item.TotalPolls, item.TotalErrors = &polls, &errors
			if polls > 0 {
				rate := float64(errors) / float64(polls) * 100
				item.ErrorRate = &rate
			}
			if metrics.LastSeenMS > 0 {
				lastSeen := int(metrics.LastSeenMS)
				item.LastPollMS = &lastSeen
			}
		}
		items = append(items, item)
	}
	return items
}

func networkPageConfigToFiles(cfg NetworkPageConfig, baseNetwork ConfigNetwork, baseDevice ConfigDevice, baseBacnet ConfigBacnet) (ConfigNetwork, ConfigDevice, ConfigBacnet, []configValidationError) {
	var errs []configValidationError
	deviceID, err := strconv.Atoi(strings.TrimSpace(cfg.BacnetDeviceID))
	if err != nil {
		addConfigErr(&errs, "bacnetDeviceId", "must be integer")
	}
	wifi := cloneMap(baseNetwork.Wifi)
	wifi["enabled"] = cfg.WifiEnabled
	bip := cloneMap(baseBacnet.BIP)
	bip["enabled"] = true
	bip["udp_port"] = cfg.BacnetPort
	networkCfg := ConfigNetwork{
		Hostname: baseNetwork.Hostname,
		// Ethernet is owned by mkddc-netcfg/NetworkManager and is never rewritten
		// by the compatibility BACnet/WiFi save path.
		Eth:  baseNetwork.Eth,
		Wifi: wifi,
	}
	deviceCfg := ConfigDevice{DeviceID: deviceID, DeviceName: firstNonEmpty(cfg.BacnetDeviceName, cfg.DeviceName), Description: baseDevice.Description, Location: baseDevice.Location}
	bacnetCfg := ConfigBacnet{BIP: bip}
	errs = append(errs, validateNetworkServiceConfig(networkCfg)...)
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

// bmsLinkStatus KHÔNG được suy ra từ file cấu hình.
//
// F-04 / ADR-017 §2.9 ("không báo success từ desired file") và tiêu chí nghiệm
// thu UC-HMI-016 ("không có `online` suy diễn từ field không rỗng"): trạng thái
// này chỉ đến từ cờ bind THẬT do iobus publish sau bip_init()/rebind().
// telemetry == nil nghĩa là iobus chưa nâng cấp hoặc io_shm không đọc được →
// "unknown", tuyệt đối không quy về online/offline.
func bmsLinkStatus(telemetry *FieldbusTelemetry) string {
	if telemetry == nil {
		return "unknown"
	}
	if telemetry.BacnetBound {
		return "online"
	}
	return "offline"
}

// deviceSerial đọc serial phần cứng thật từ device-tree.
//
// F-10: giao diện từng gán cứng "N/A". Trả về chuỗi rỗng khi thiết bị chưa được
// nạp serial (nhiều board Orange Pi không có node này) — frontend phải nói rõ là
// "chưa cấu hình". Không dùng /etc/machine-id thay thế: đó là định danh cài đặt
// hệ điều hành, đổi khi cài lại, không phải serial thiết bị.
func deviceSerial() string {
	for _, path := range []string{
		"/proc/device-tree/serial-number",
		"/sys/firmware/devicetree/base/serial-number",
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if serial := strings.Trim(strings.TrimSpace(string(raw)), "\x00"); serial != "" {
			return serial
		}
	}
	return ""
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
