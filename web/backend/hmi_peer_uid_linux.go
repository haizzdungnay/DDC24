//go:build linux

package main

import (
	"net"
	"syscall"

	"golang.org/x/sys/unix"
)

func hmiPeerUIDPlatform(conn net.Conn) (uint32, bool) {
	sc, ok := conn.(syscall.Conn)
	if !ok {
		return 0, false
	}
	raw, err := sc.SyscallConn()
	if err != nil {
		return 0, false
	}
	var uid uint32
	var controlErr error
	if err := raw.Control(func(fd uintptr) {
		cred, err := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
		if err != nil {
			controlErr = err
			return
		}
		uid = cred.Uid
	}); err != nil || controlErr != nil {
		return 0, false
	}
	return uid, true
}
