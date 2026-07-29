//go:build !linux

package main

import (
	"net"
	"testing"
)

func TestHMIPeerCredentialsFailClosedOffLinux(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	uid, ok := hmiPeerUID(server)
	if ok || uid != 0 {
		t.Fatalf("peer uid = %d/%v; want 0/false off Linux", uid, ok)
	}
}
