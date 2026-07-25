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
	slave := resp.Southbound[0]
	if slave.Address != 10 || slave.Profile != "Meter" || slave.BaudRate != 19200 || slave.PollState != "online" || slave.LastPollMS != 7 {
		t.Fatalf("slave = %+v", slave)
	}
}

func TestNetworkPagePutWritesServiceConfigWithoutRewritingEthernetOrWifiMode(t *testing.T) {
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
	if network.Hostname != "DDC-Office" ||
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
