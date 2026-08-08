package network

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNetcfgClientUsesBoundedVersionedUnixProtocol(t *testing.T) {
	path := filepath.Join(t.TempDir(), "netcfg.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	received := make(chan map[string]any, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		var req map[string]any
		if json.NewDecoder(conn).Decode(&req) != nil {
			return
		}
		received <- req
		_ = json.NewEncoder(conn).Encode(map[string]any{
			"version": 1, "requestId": req["requestId"], "result": "accepted",
			"reasonCode": "OK", "state": "staged", "transactionId": "tx-1",
			"capabilities": []string{"dns", "management-hostname"},
			"active": map[string]any{
				"interface": "end1", "link": "down", "adminUp": true, "carrier": false,
				"reasonCode": "NO_CARRIER", "mode": "unknown", "ipv4": "",
				"prefixLength": 0, "gateway": "", "dnsServers": []string{"192.168.10.2"},
			},
			"configured": map[string]any{"interface": "end1", "mode": "dhcp"},
			"management": map[string]any{"hostname": "mkddc-24", "mdnsName": "mkddc-24.local", "stable": true},
		})
	}()

	client := NewNetcfgClient(path)
	resp, err := client.Request(context.Background(), "req-1", "stage", "", &NetcfgCandidate{
		Interface: "eth0", Mode: "static", IPv4: "192.168.10.20",
		Netmask: "255.255.255.0", Gateway: "192.168.10.1",
		DNS: &NetcfgDNS{Mode: "manual", Servers: []string{"192.168.10.2"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.TransactionID != "tx-1" || resp.State != "staged" || resp.Active == nil ||
		resp.Active.Link != "down" || !resp.Active.AdminUp || resp.Active.Carrier ||
		resp.Active.ReasonCode != "NO_CARRIER" || resp.Configured == nil ||
		resp.Configured.Interface != "end1" || resp.Configured.Mode != "dhcp" ||
		!HasCapability(resp.Capabilities, "dns") || resp.Management == nil ||
		resp.Management.MDNSName != "mkddc-24.local" || !resp.Management.Stable {
		t.Fatalf("response = %+v", resp)
	}
	select {
	case req := <-received:
		if req["action"] != "stage" || req["version"] != float64(1) {
			t.Fatalf("request = %#v", req)
		}
		candidate, ok := req["candidate"].(map[string]any)
		if !ok {
			t.Fatalf("candidate = %#v", req["candidate"])
		}
		dns, ok := candidate["dns"].(map[string]any)
		if !ok || dns["mode"] != "manual" {
			t.Fatalf("dns = %#v", candidate["dns"])
		}
	case <-time.After(time.Second):
		t.Fatal("netcfg request not received")
	}
}

func TestNetcfgClientFailsClosedWhenSocketMissing(t *testing.T) {
	client := NewNetcfgClient(filepath.Join(t.TempDir(), "missing.sock"))
	if _, err := client.Request(context.Background(), "req-1", "status", "", nil); err == nil {
		t.Fatal("expected unavailable error")
	}
}

func TestNetcfgClientRejectsInvalidResponseSemantics(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"unknown result", func(response map[string]any) { response["result"] = "maybe" }},
		{"unknown state", func(response map[string]any) { response["state"] = "pending" }},
		{"missing reason code", func(response map[string]any) { delete(response, "reasonCode") }},
		{"missing capabilities", func(response map[string]any) { response["capabilities"] = []string{"dns"} }},
		{"duplicate capability", func(response map[string]any) { response["capabilities"] = []string{"dns", "dns"} }},
		{"missing management", func(response map[string]any) { delete(response, "management") }},
		{"missing management stable", func(response map[string]any) {
			response["management"] = map[string]any{"hostname": "mkddc-24", "mdnsName": "mkddc-24.local"}
		}},
		{"unknown field", func(response map[string]any) { response["candidateSecret"] = true }},
		{"invalid management", func(response map[string]any) {
			response["management"] = map[string]any{"hostname": "mkddc-24", "mdnsName": "", "stable": true}
		}},
		{"invalid active dns", func(response map[string]any) {
			response["active"] = map[string]any{
				"interface": "eth0", "link": "up", "adminUp": true, "carrier": true, "reasonCode": "OK",
				"mode": "dhcp", "ipv4": "192.168.1.20",
				"prefixLength": 24, "gateway": "192.168.1.1", "dnsServers": []string{"192.168.001.1"},
			}
		}},
		{"invalid active reason code", func(response map[string]any) {
			response["active"] = map[string]any{
				"interface": "eth0", "link": "up", "adminUp": true, "carrier": true,
				"reasonCode": "BOGUS", "mode": "dhcp", "ipv4": "", "prefixLength": 0,
				"gateway": "", "dnsServers": []string{},
			}
		}},
		{"missing active dns servers", func(response map[string]any) {
			response["active"] = map[string]any{
				"interface": "eth0", "link": "up", "adminUp": true, "carrier": true,
				"reasonCode": "OK", "mode": "dhcp", "ipv4": "", "prefixLength": 0, "gateway": "",
			}
		}},
		{"static candidate missing netmask", func(response map[string]any) {
			response["configured"] = map[string]any{"interface": "eth0", "mode": "static", "ipv4": "192.168.1.20"}
		}},
		{"dhcp candidate includes ipv4", func(response map[string]any) {
			response["configured"] = map[string]any{"interface": "eth0", "mode": "dhcp", "ipv4": "192.168.1.20"}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := map[string]any{
				"version": 1, "result": "accepted", "reasonCode": "OK", "state": "idle",
				"capabilities": []string{"dns", "management-hostname"},
				"management":   map[string]any{"hostname": "mkddc-24", "mdnsName": "mkddc-24.local", "stable": true},
			}
			test.mutate(response)
			_, err := requestNetcfgTestResponse(t, response)
			if !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("error = %v; want ErrInvalidResponse", err)
			}
		})
	}
}

func requestNetcfgTestResponse(t *testing.T, response map[string]any) (NetcfgResponse, error) {
	t.Helper()
	file, err := os.CreateTemp("", "nc-*.sock")
	if err != nil {
		t.Fatal(err)
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		var request map[string]any
		if json.NewDecoder(conn).Decode(&request) != nil {
			return
		}
		response["requestId"] = request["requestId"]
		_ = json.NewEncoder(conn).Encode(response)
	}()
	return NewNetcfgClient(path).Request(context.Background(), "strict-response", "status", "", nil)
}

// Payload NGUYÊN VĂN mà mkddc-netcfg trên bo Foxlinx SOM-DDC-24 (OK1126B,
// buildroot + systemd-networkd, không có NetworkManager) trả về sau khi sửa
// backend cấu hình, ngày 2026-08-08.
//
// Vì sao cần test này: `validNetcfgResponse` từ chối CẢ response khi bất kỳ
// mảnh nào sai hợp đồng, và khi đó `/api/v1/network/transaction` trả 502 —
// nghĩa là toàn bộ trang /settings/network chết, chứ không suy giảm cục bộ.
// Hai điểm ở payload này từng là nguồn nghi ngờ: hostname có CHỮ HOA
// (`OK1126B-buildroot`) và `configured` đọc ra từ file .network của
// systemd-networkd chứ không phải từ profile NetworkManager.
func TestNetcfgClientAcceptsFoxlinxNetworkdAuthorityResponse(t *testing.T) {
	const board = `{"active":{"adminUp":true,"carrier":true,"dnsServers":["114.114.114.114"],` +
		`"gateway":"","interface":"eth0","ipv4":"192.168.1.110","link":"up","mode":"static",` +
		`"prefixLength":24,"reasonCode":"OK"},"capabilities":["dns","management-hostname"],` +
		`"configured":{"dns":{"mode":"manual","servers":["114.114.114.114"]},"interface":"eth0",` +
		`"ipv4":"192.168.1.110","mode":"static","netmask":"255.255.255.0"},` +
		`"management":{"hostname":"OK1126B-buildroot","mdnsName":"ok1126b-buildroot.local","stable":true},` +
		`"reasonCode":"OK","requestId":"strict-response","result":"accepted","state":"idle","version":1}`

	var response map[string]any
	if err := json.Unmarshal([]byte(board), &response); err != nil {
		t.Fatal(err)
	}
	got, err := requestNetcfgTestResponse(t, response)
	if err != nil {
		t.Fatalf("adapter từ chối response thật của bo: %v", err)
	}
	if got.Management == nil || !got.Management.Stable {
		t.Fatalf("management.stable phải giữ nguyên true, nhận %+v", got.Management)
	}
	if got.Configured == nil || got.Configured.IPv4 != "192.168.1.110" {
		t.Fatalf("configured phải đi qua nguyên vẹn, nhận %+v", got.Configured)
	}
}
