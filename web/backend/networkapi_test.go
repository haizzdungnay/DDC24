package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNetworkPageReadsConfigFiles(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	writeNetworkPageFixture(t, app.cfg.ConfigDir)

	req := newAuthRequest(http.MethodGet, "/api/v1/network", "", token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var resp NetworkPageData
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Northbound.IP != "10.1.2.3" || resp.Northbound.BacnetPort != 47809 || resp.Northbound.BacnetDeviceID != "1234" {
		t.Fatalf("northbound = %+v", resp.Northbound)
	}
	if len(resp.Southbound) != 1 {
		t.Fatalf("southbound len = %d; want 1", len(resp.Southbound))
	}
	// fakeCore không hiện thực FieldbusTelemetryReader ⇒ KHÔNG có số đo thật.
	// Trạng thái phải là "unknown" với mọi số liệu để trống, không được rơi về 0.
	slave := resp.Southbound[0]
	if slave.Address != 10 || slave.Profile != "Meter" || slave.BaudRate != 19200 {
		t.Fatalf("slave = %+v", slave)
	}
	if slave.PollState != "unknown" {
		t.Fatalf("pollState = %q; want unknown khi chưa có telemetry", slave.PollState)
	}
	if slave.ErrorRate != nil || slave.LastPollMS != nil || slave.TotalPolls != nil {
		t.Fatalf("slave = %+v; thiếu số đo phải là nil, không phải 0", slave)
	}
}

// F-04: bmsLink từng báo "online" chỉ vì bip.enabled=true và ip/port trong file
// khác rỗng. Test này chốt rằng file cấu hình KHÔNG còn quyết định trạng thái.
func TestNetworkPageBMSLinkNeverDerivedFromConfigFile(t *testing.T) {
	bacnetEnabled := ConfigBacnet{BIP: map[string]any{"enabled": true, "udp_port": 47808}}
	network := ConfigNetwork{Eth: map[string]any{"mode": "static", "ip": "10.1.2.3"}}

	tests := []struct {
		name       string
		telemetry  *FieldbusTelemetry
		wantLink   string
		wantActive *int
	}{
		{"khong co telemetry", nil, "unknown", nil},
		{"iobus bao chua bind", &FieldbusTelemetry{BacnetBound: false}, "offline", nil},
		{"iobus bao da bind", &FieldbusTelemetry{BacnetBound: true, BacnetPort: 47808}, "online", intPtr(47808)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := networkPageConfigFromFiles(ConfigDevice{DeviceName: "DDC-Lab"}, network, bacnetEnabled, test.telemetry, "0.0.0-test")
			if got.BMSLink != test.wantLink {
				t.Fatalf("bmsLink = %q; want %q (file config có đủ ip+port+enabled)", got.BMSLink, test.wantLink)
			}
			if (got.ActiveBacnetPort == nil) != (test.wantActive == nil) {
				t.Fatalf("activeBacnetPort = %v; want %v", got.ActiveBacnetPort, test.wantActive)
			}
			if got.ActiveBacnetPort != nil && *got.ActiveBacnetPort != *test.wantActive {
				t.Fatalf("activeBacnetPort = %d; want %d", *got.ActiveBacnetPort, *test.wantActive)
			}
		})
	}
}

// F-03: số đo phải ghép theo ĐỊA CHỈ Modbus. Ghép theo chỉ số sẽ gán nhầm sức
// khoẻ của thiết bị này sang thiết bị khác khi thứ tự trong file khác thứ tự
// slave trong iobus.
func TestNetworkSlavesUseRealPerSlaveMetricsMatchedByAddress(t *testing.T) {
	fieldbus := ConfigFieldbus{
		RS485: map[string]any{"baud": 19200},
		Slaves: []map[string]any{
			{"addr": 10, "name": "Meter-A", "profile": "meter"},
			{"addr": 20, "name": "VFD-B", "profile": "vfd"},
			{"addr": 30, "name": "Chua-poll", "profile": "io"},
		},
	}
	telemetry := &FieldbusTelemetry{
		Published: true,
		Slaves: []SlaveTelemetry{
			// Thứ tự CỐ TÌNH đảo so với file config.
			{Addr: 20, Online: false, TotalPolls: 200, TotalErrors: 50, LastSeenMS: 999},
			{Addr: 10, Online: true, TotalPolls: 400, TotalErrors: 4, LastSeenMS: 12345},
		},
	}

	items := networkSlavesFromConfig(fieldbus, telemetry)
	if len(items) != 3 {
		t.Fatalf("len = %d; want 3", len(items))
	}

	meter := items[0]
	if meter.Address != 10 || meter.PollState != "online" {
		t.Fatalf("meter = %+v", meter)
	}
	if meter.ErrorRate == nil || *meter.ErrorRate != 1 {
		t.Fatalf("meter error rate = %v; want 1%% (4/400)", meter.ErrorRate)
	}
	if meter.LastPollMS == nil || *meter.LastPollMS != 12345 {
		t.Fatalf("meter lastPoll = %v; want 12345", meter.LastPollMS)
	}

	vfd := items[1]
	if vfd.Address != 20 || vfd.PollState != "offline" {
		t.Fatalf("vfd = %+v; slave offline phải hiện offline", vfd)
	}
	if vfd.ErrorRate == nil || *vfd.ErrorRate != 25 {
		t.Fatalf("vfd error rate = %v; want 25%% (50/200)", vfd.ErrorRate)
	}

	// Slave có trong config nhưng iobus chưa hề poll: không được bịa là online/0%.
	silent := items[2]
	if silent.PollState != "unknown" || silent.ErrorRate != nil || silent.LastPollMS != nil {
		t.Fatalf("silent = %+v; want unknown và số đo rỗng", silent)
	}
}

// Telemetry tồn tại nhưng iobus chưa publish lần nào (fb_publish_seq == 0) vẫn
// phải là "unknown" — nếu không thì mọi slave sẽ hiện offline ngay lúc khởi động.
func TestNetworkSlavesIgnoreUnpublishedTelemetry(t *testing.T) {
	fieldbus := ConfigFieldbus{
		RS485:  map[string]any{"baud": 9600},
		Slaves: []map[string]any{{"addr": 10, "name": "Meter-A"}},
	}
	items := networkSlavesFromConfig(fieldbus, &FieldbusTelemetry{Published: false, Slaves: []SlaveTelemetry{
		{Addr: 10, Online: false, TotalPolls: 5, TotalErrors: 5},
	}})
	if len(items) != 1 || items[0].PollState != "unknown" || items[0].ErrorRate != nil {
		t.Fatalf("items = %+v; want unknown khi iobus chưa publish", items)
	}
}

func TestNetworkPageDoesNotSubstituteAnotherInterfaceAddress(t *testing.T) {
	result := networkPageConfigFromFiles(
		ConfigDevice{DeviceName: "DDC-Lab"},
		ConfigNetwork{Eth: map[string]any{"mode": "dhcp"}},
		ConfigBacnet{BIP: map[string]any{"enabled": true, "udp_port": 47808}},
		nil, "0.0.0-test",
	)
	if result.IP != "" || result.BMSLink != "unknown" {
		t.Fatalf("northbound = %+v; want configured Ethernet state without host-interface fallback", result)
	}
}

func TestNetworkPagePutPreservesHostnameEthernetAndWifiMode(t *testing.T) {
	app, token := newTestAppWithAdmin(t)
	writeNetworkPageFixture(t, app.cfg.ConfigDir)
	body := `{"northbound":{"deviceName":"DDC-Office","ip":"10.9.8.7","dhcp":false,"wifiEnabled":true,"subnet":"255.255.255.0","gateway":"10.9.8.1","bacnetDeviceId":"2222","bacnetDeviceName":"DDC-Office","bacnetPort":47810,"bmsLink":"online"},"southbound":[]}`

	req := newAuthRequest(http.MethodPut, "/api/v1/network", body, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	var network ConfigNetwork
	readJSONFile(t, filepath.Join(app.cfg.ConfigDir, "network.conf"), &network)
	if network.Hostname != "ddc-lab" ||
		stringValue(network.Eth, "ip") != "10.1.2.3" ||
		stringValue(network.Eth, "gateway") != "10.1.2.1" ||
		stringValue(network.Wifi, "mode") != "dhcp" ||
		stringValue(network.Wifi, "ssid") != "lab-wifi" ||
		!boolValue(network.Wifi, "enabled") {
		t.Fatalf("network.conf = %+v", network)
	}
	var device ConfigDevice
	readJSONFile(t, filepath.Join(app.cfg.ConfigDir, "device.conf"), &device)
	if device.DeviceID != 2222 || device.DeviceName != "DDC-Office" || device.Description != "existing description" {
		t.Fatalf("device.conf = %+v", device)
	}
	var bacnet ConfigBacnet
	readJSONFile(t, filepath.Join(app.cfg.ConfigDir, "bacnet.conf"), &bacnet)
	if intValue(bacnet.BIP, "udp_port") != 47810 || stringValue(bacnet.BIP, "note") != "keep" {
		t.Fatalf("bacnet.conf = %+v", bacnet)
	}
}

func writeNetworkPageFixture(t *testing.T, dir string) {
	t.Helper()
	files := map[string]string{
		"device.conf":   `{"device_id":1234,"device_name":"DDC-Lab","description":"existing description","location":"lab"}`,
		"network.conf":  `{"eth":{"mode":"static","ip":"10.1.2.3","netmask":"255.255.255.0","gateway":"10.1.2.1"},"wifi":{"enabled":false,"mode":"dhcp","ssid":"lab-wifi"},"hostname":"ddc-lab"}`,
		"bacnet.conf":   `{"bip":{"enabled":true,"udp_port":47809,"bbmd":null,"foreign_device":null,"note":"keep"}}`,
		"fieldbus.conf": `{"rs485":{"baud":19200,"parity":"N","stop":1},"poll_default_ms":1000,"slaves":[{"addr":10,"profile":"generic-power-meter","name":"Meter-A"}]}`,
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
}

func readJSONFile(t *testing.T, path string, dst any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(data, dst); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}
