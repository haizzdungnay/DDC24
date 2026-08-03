package system

import (
	"net"
	"os"
	"strconv"
	"strings"
	"syscall"
)

func ProcessAlive(pidPath string) bool {
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	return err == nil && pid > 1 && syscall.Kill(pid, 0) == nil
}

func PrimaryInterface() (string, string) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return "", ""
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch typed := addr.(type) {
			case *net.IPNet:
				ip = typed.IP
			case *net.IPAddr:
				ip = typed.IP
			}
			if v4 := ip.To4(); v4 != nil {
				return v4.String(), strings.ToUpper(iface.HardwareAddr.String())
			}
		}
	}
	return "", ""
}
