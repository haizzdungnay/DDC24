//go:build linux

package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

func sendSignalReload(pidfilePath, procName string) (bool, []string) {
	data, err := os.ReadFile(pidfilePath)
	if err == nil {
		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err == nil && pid > 0 {
			return signalPID(pid)
		}
	}

	pids := findPidByName(procName)
	switch len(pids) {
	case 0:
		return false, []string{fmt.Sprintf("reload: process %s not found (no pidfile, no match)", procName)}
	case 1:
		applied, warnings := signalPID(pids[0])
		if !applied {
			return applied, warnings
		}
		return true, []string{"reload via /proc fallback (no pidfile)"}
	default:
		return false, []string{fmt.Sprintf("reload: multiple %s pids %v; refuse to signal", procName, pids)}
	}
}

func signalPID(pid int) (bool, []string) {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false, []string{fmt.Sprintf("reload find pid %d: %v", pid, err)}
	}
	if err := process.Signal(syscall.SIGHUP); err != nil {
		return false, []string{fmt.Sprintf("reload signal pid %d: %v", pid, err)}
	}
	return true, nil
}

func findPidByName(procName string) []int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	var pids []int
	for _, entry := range entries {
		if !entry.IsDir() || !allDigits(entry.Name()) {
			continue
		}
		comm, err := os.ReadFile("/proc/" + entry.Name() + "/comm")
		if err != nil || strings.TrimSpace(string(comm)) != procName {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err == nil && pid > 0 {
			pids = append(pids, pid)
		}
	}
	return pids
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func applySystem(target string) (bool, []string) {
	return false, []string{fmt.Sprintf("reload %s pending B7 (systemd/polkit)", target)}
}
