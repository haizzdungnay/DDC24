package main

import (
	"context"
	"encoding/json"
	"net"
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
		})
	}()

	client := NewNetcfgClient(path)
	resp, err := client.Request(context.Background(), "req-1", "stage", "", &NetcfgCandidate{
		Interface: "eth0", Mode: "static", IPv4: "192.168.10.20",
		Netmask: "255.255.255.0", Gateway: "192.168.10.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.TransactionID != "tx-1" || resp.State != "staged" {
		t.Fatalf("response = %+v", resp)
	}
	select {
	case req := <-received:
		if req["action"] != "stage" || req["version"] != float64(1) {
			t.Fatalf("request = %#v", req)
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
