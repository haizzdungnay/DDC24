//go:build !linux

package main

import "net"

func hmiPeerUIDPlatform(net.Conn) (uint32, bool) {
	return 0, false
}
