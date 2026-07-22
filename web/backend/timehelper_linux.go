//go:build linux

package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const chronySourcesPath = "/etc/chrony/sources.d/mkddc.sources"
const defaultTimeHelperSocket = "/run/mkddc/time-helper.sock"

func timeHelperSocketPath() string {
	if value := os.Getenv("TIME_HELPER_SOCK"); value != "" {
		return value
	}
	return defaultTimeHelperSocket
}

func runTimeHelperServer() error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("root privileges required")
	}
	path := timeHelperSocketPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	_ = os.Remove(path)
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	defer listener.Close()
	group, err := user.LookupGroup("mkddc")
	if err != nil {
		return err
	}
	gid, err := strconv.Atoi(group.Gid)
	if err != nil {
		return err
	}
	if err := os.Chown(path, 0, gid); err != nil {
		return err
	}
	if err := os.Chmod(path, 0o660); err != nil {
		return err
	}
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		go handleTimeHelperConnection(conn)
	}
}

func handleTimeHelperConnection(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	request, err := bufio.NewReader(io.LimitReader(conn, 8193)).ReadString('\n')
	if err != nil || len(request) > 8192 {
		_, _ = conn.Write([]byte("error\n"))
		return
	}
	if err := runTimeHelper(strings.TrimSpace(request)); err != nil {
		_, _ = conn.Write([]byte("error\n"))
		return
	}
	_, _ = conn.Write([]byte("ok\n"))
}

func runTimeHelper(encoded string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("root privileges required")
	}
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(data) > 4096 {
		return fmt.Errorf("invalid request encoding")
	}
	var cfg ConfigTime
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return fmt.Errorf("invalid request")
	}
	if errs := validateTimeHelperConfig(cfg); len(errs) > 0 {
		return fmt.Errorf("invalid time configuration")
	}
	if err := helperCommand(timedatectlPath, "set-timezone", cfg.Timezone); err != nil {
		return err
	}
	if cfg.NTPEnabled {
		var content strings.Builder
		for _, server := range cfg.NTPServers {
			content.WriteString("server ")
			content.WriteString(server)
			content.WriteString(" iburst\n")
		}
		if err := os.MkdirAll(filepath.Dir(chronySourcesPath), 0o755); err != nil {
			return err
		}
		if err := writeConfigFileAtomic(chronySourcesPath, []byte(content.String()), 0o644); err != nil {
			return err
		}
		if err := helperCommand(systemctlPath, "restart", "chrony.service"); err != nil {
			return err
		}
		if waitForChronySync(30 * time.Second) {
			_ = helperCommand(hwclockPath, "--systohc", "--utc")
		}
		return nil
	}
	if err := helperCommand(systemctlPath, "stop", "chrony.service"); err != nil {
		return err
	}
	if cfg.SystemTime != "" {
		instant, _ := time.Parse(time.RFC3339, cfg.SystemTime)
		commandValue, err := manualTimeCommandValue(instant, cfg.Timezone)
		if err != nil {
			return err
		}
		if err := helperCommand(timedatectlPath, "set-time", commandValue); err != nil {
			return err
		}
		if _, err := os.Stat("/dev/rtc0"); err == nil {
			_ = helperCommand(hwclockPath, "--systohc", "--utc")
		}
	}
	return nil
}

func waitForChronySync(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		output, err := exec.Command(chronycPath, "tracking").CombinedOutput()
		if err == nil {
			synchronized, _, _ := parseChronyTracking(string(output))
			if synchronized {
				return true
			}
		}
		time.Sleep(time.Second)
	}
	return false
}

func validateTimeHelperConfig(cfg ConfigTime) []configValidationError {
	errList := validateConfigTime(cfg)
	if _, err := time.LoadLocation(cfg.Timezone); cfg.Timezone == "" || err != nil {
		addConfigErr(&errList, "timezone", "must be a valid IANA timezone")
	}
	if cfg.NTPEnabled && (len(cfg.NTPServers) < 1 || len(cfg.NTPServers) > 4 || cfg.SystemTime != "") {
		addConfigErr(&errList, "ntp", "invalid NTP configuration")
	}
	for i, server := range cfg.NTPServers {
		if !validNTPServer(server) {
			addConfigErr(&errList, fmt.Sprintf("ntp_servers[%d]", i), "invalid server")
		}
	}
	return errList
}

func helperCommand(name string, args ...string) error {
	output, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s failed: %w (%s)", filepath.Base(name), err, strings.TrimSpace(string(output)))
	}
	return nil
}
