package app

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type OSReader interface {
	ReadMetrics(ctx context.Context) (OSMetrics, error)
}

type OSMetrics struct {
	CPUPercent  *float64
	CPUClockMhz *float64
	RAMPercent  *float64
	RAMUsedMB   *float64
	RAMTotalMB  *float64
	TempC       *float64
	UptimeS     *uint64
}

type LinuxOSReader struct {
	ProcRoot string
	SysRoot  string
}

type SystemStatus struct {
	Overall          string                   `json:"overall,omitempty"`
	Services         map[string]ServiceHealth `json:"services,omitempty"`
	CPUPercent       *float64                 `json:"cpu_percent,omitempty"`
	CPUClockMhz      *float64                 `json:"cpu_clock_mhz,omitempty"`
	RAMPercent       *float64                 `json:"ram_percent,omitempty"`
	RAMUsedMB        *float64                 `json:"ram_used_mb,omitempty"`
	RAMTotalMB       *float64                 `json:"ram_total_mb,omitempty"`
	TempC            *float64                 `json:"tempC,omitempty"`
	TempCSnake       *float64                 `json:"temp_c,omitempty"`
	UptimeS          *uint64                  `json:"uptime_s,omitempty"`
	UptimeSCamel     *uint64                  `json:"uptimeS,omitempty"`
	CPUPercentCamel  *float64                 `json:"cpuPercent,omitempty"`
	CPUClockMhzCamel *float64                 `json:"cpuClockMhz,omitempty"`
	RAMPercentCamel  *float64                 `json:"ramPercent,omitempty"`
	DeviceIP         string                   `json:"device_ip,omitempty"`
	DeviceMAC        string                   `json:"device_mac,omitempty"`
	DeviceName       string                   `json:"device_name,omitempty"`
	Description      string                   `json:"description,omitempty"`
	Location         string                   `json:"location,omitempty"`
	SystemTime       string                   `json:"system_time,omitempty"`
	Versions         VersionStatus            `json:"versions"`
	IOP              IOPStatus                `json:"iop"`
	Scan             ScanStatus               `json:"scan"`
}

type ServiceHealth struct {
	Status     string  `json:"status"`
	UptimeS    *uint64 `json:"uptime_s,omitempty"`
	LastScanMS *uint64 `json:"last_scan_ms,omitempty"`
}

type HealthCheck struct {
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type HealthEndpointResponse struct {
	Status  string                 `json:"status"`
	Checks  map[string]HealthCheck `json:"checks"`
	Version string                 `json:"version"`
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	core, err := a.core.ReadStatus(r.Context())
	checks := map[string]HealthCheck{"web": {Status: "ok"}}
	coreProcessOK := core.CoreAvailable
	iobusProcessOK := core.IobusPresent
	if client, production := a.core.(*CoreClient); production {
		coreProcessOK = processAlive(a.cfg.CorePidPath) && client.coreSocketReady(r.Context())
		iobusProcessOK = processAlive(a.cfg.IobusPidPath)
	}
	checks["core"] = HealthCheck{Status: "fault", Detail: "process hoặc core socket không sẵn sàng"}
	if coreProcessOK {
		checks["core"] = HealthCheck{Status: "ok"}
	}
	checks["iobus"] = HealthCheck{Status: "fault", Detail: "process iobus không sẵn sàng"}
	if iobusProcessOK {
		checks["iobus"] = HealthCheck{Status: "ok"}
	}
	checks["io_shm"] = HealthCheck{Status: "fault"}
	if core.IobusPresent {
		checks["io_shm"] = HealthCheck{Status: "ok"}
	}
	checks["plc_shm"] = HealthCheck{Status: "fault"}
	if core.CoreAvailable {
		checks["plc_shm"] = HealthCheck{Status: "ok"}
	}
	checks["mcu_connection"] = HealthCheck{Status: "fault", Detail: "IOP không ở NORMAL"}
	if core.IOP.Status == "normal" {
		checks["mcu_connection"] = HealthCheck{Status: "ok"}
	} else if core.IOP.Status == "safe" {
		checks["mcu_connection"] = HealthCheck{Status: "degraded", Detail: "MCU đang ở safe-state"}
	}
	status := "ok"
	for _, check := range checks {
		if check.Status != "ok" {
			status = "degraded"
			break
		}
	}
	if err != nil && a.logger != nil {
		a.logger.Printf("WARN health degraded err=%v", err)
	}
	writeJSON(w, http.StatusOK, HealthEndpointResponse{Status: status, Checks: checks, Version: a.cfg.WebVersion})
}

func processAlive(pidPath string) bool {
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	return err == nil && pid > 1 && syscall.Kill(pid, 0) == nil
}

func (a *App) handleSystemStatus(w http.ResponseWriter, r *http.Request) {
	metrics, err := a.os.ReadMetrics(r.Context())
	if err != nil {
		a.logger.Printf("WARN os_metrics err=%v", err)
	}
	core, err := a.core.ReadStatus(r.Context())
	if err != nil {
		a.logger.Printf("WARN core_status degraded err=%v", err)
	}

	// WEB-UX-001: Dashboard trước đây gán cứng MAC, giờ hệ thống, vị trí lắp đặt
	// và mô tả. Trên một thiết bị điều khiển, hiển thị định danh SAI tệ hơn hẳn
	// không hiển thị: người vận hành đối chiếu MAC/vị trí để chắc chắn mình đang
	// thao tác đúng tủ. Backend vì vậy phải cấp dữ liệu thật; khi không đọc được
	// thì để trống (`omitempty`) để UI hiện `—` chứ không có gì để đoán.
	device, err := readConfig(a, configGroupDevice, ConfigDevice{})
	if err != nil {
		a.logger.Printf("WARN device_config err=%v", err)
	}

	ip, mac := primaryInterface()
	versions := core.Versions
	versions.Web = a.cfg.WebVersion
	status := SystemStatus{
		Overall:          overallStatus(core),
		Services:         servicesStatus(core, metrics.UptimeS),
		CPUPercent:       metrics.CPUPercent,
		CPUClockMhz:      metrics.CPUClockMhz,
		RAMPercent:       metrics.RAMPercent,
		RAMUsedMB:        metrics.RAMUsedMB,
		RAMTotalMB:       metrics.RAMTotalMB,
		TempC:            metrics.TempC,
		TempCSnake:       metrics.TempC,
		UptimeS:          metrics.UptimeS,
		UptimeSCamel:     metrics.UptimeS,
		CPUPercentCamel:  metrics.CPUPercent,
		CPUClockMhzCamel: metrics.CPUClockMhz,
		RAMPercentCamel:  metrics.RAMPercent,
		DeviceIP:         ip,
		DeviceMAC:        mac,
		DeviceName:       strings.TrimSpace(device.DeviceName),
		Description:      strings.TrimSpace(device.Description),
		Location:         strings.TrimSpace(device.Location),
		SystemTime:       time.Now().Format(time.RFC3339),
		Versions:         versions,
		IOP:              core.IOP,
		Scan:             core.Scan,
	}
	writeJSON(w, http.StatusOK, status)
}

// primaryInterface trả về IPv4 và MAC của CÙNG một interface.
//
// Lấy hai giá trị trong một lần duyệt là có chủ đích: nếu tách thành hai hàm
// duyệt độc lập thì trên board có nhiều interface (eth0 + wlan0 + docker0), IP
// và MAC có thể rơi vào hai card khác nhau và Dashboard sẽ hiện một cặp định
// danh không tồn tại — đúng loại "dữ liệu trông hợp lý nhưng sai" mà WEB-UX-001
// phải loại bỏ.
func primaryInterface() (string, string) {
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

func overallStatus(core CoreStatus) string {
	if !core.CoreAvailable || core.IOP.Status != "normal" {
		return "degraded"
	}
	return "ok"
}

func servicesStatus(core CoreStatus, uptime *uint64) map[string]ServiceHealth {
	coreState := "degraded"
	if core.CoreAvailable {
		coreState = "ok"
	}
	iobusState := "degraded"
	if core.IOP.Status == "normal" {
		iobusState = "ok"
	}
	return map[string]ServiceHealth{
		"web":   {Status: "ok", UptimeS: uptime},
		"core":  {Status: coreState},
		"iobus": {Status: iobusState},
		"IOP":   {Status: iobusState},
	}
}

func (r LinuxOSReader) ReadMetrics(ctx context.Context) (OSMetrics, error) {
	procRoot := r.ProcRoot
	if procRoot == "" {
		procRoot = "/proc"
	}
	sysRoot := r.SysRoot
	if sysRoot == "" {
		sysRoot = "/sys"
	}
	var metrics OSMetrics
	var errs []string
	if cpu, err := readCPUPercent(ctx, filepath.Join(procRoot, "stat")); err == nil {
		metrics.CPUPercent = &cpu
	} else {
		errs = append(errs, err.Error())
	}
	if clock, err := readCPUClockMhz(sysRoot); err == nil {
		metrics.CPUClockMhz = &clock
	}
	if ram, err := readRAMPercent(filepath.Join(procRoot, "meminfo")); err == nil {
		metrics.RAMPercent = &ram
		used, total, rErr := readRAMUsedTotalMB(filepath.Join(procRoot, "meminfo"))
		if rErr == nil {
			metrics.RAMUsedMB = &used
			metrics.RAMTotalMB = &total
		} else {
			errs = append(errs, rErr.Error())
		}
	} else {
		errs = append(errs, err.Error())
	}
	if temp, err := readTempC(sysRoot); err == nil {
		metrics.TempC = &temp
	}
	if up, err := readUptimeS(filepath.Join(procRoot, "uptime")); err == nil {
		metrics.UptimeS = &up
	} else {
		errs = append(errs, err.Error())
	}
	if len(errs) > 0 && metrics.CPUPercent == nil && metrics.RAMPercent == nil && metrics.UptimeS == nil {
		return metrics, errors.New(strings.Join(errs, "; "))
	}
	return metrics, nil
}

type cpuSample struct {
	idle  uint64
	total uint64
}

func readCPUPercent(ctx context.Context, statPath string) (float64, error) {
	first, err := readCPUSample(statPath)
	if err != nil {
		return 0, err
	}
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-timer.C:
	}
	second, err := readCPUSample(statPath)
	if err != nil {
		return 0, err
	}
	return cpuPercentBetween(first, second), nil
}

func cpuPercentBetween(first, second cpuSample) float64 {
	if second.total <= first.total || second.idle < first.idle {
		return 0
	}
	deltaTotal := second.total - first.total
	deltaIdle := second.idle - first.idle
	if deltaTotal == 0 {
		return 0
	}
	value := (1 - float64(deltaIdle)/float64(deltaTotal)) * 100
	return round2(clamp(value, 0, 100))
}

func readCPUSample(statPath string) (cpuSample, error) {
	data, err := os.ReadFile(statPath)
	if err != nil {
		return cpuSample{}, err
	}
	line := strings.SplitN(string(data), "\n", 2)[0]
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuSample{}, fmt.Errorf("invalid %s", statPath)
	}
	var values []uint64
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuSample{}, err
		}
		values = append(values, value)
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return cpuSample{idle: idle, total: total}, nil
}

func readCPUClockMhz(sysRoot string) (float64, error) {
	matches, err := filepath.Glob(filepath.Join(sysRoot, "devices", "system", "cpu", "cpu*", "cpufreq", "*_cur_freq"))
	if err != nil {
		return 0, err
	}
	for _, match := range matches {
		data, err := os.ReadFile(match)
		if err != nil {
			continue
		}
		raw := strings.TrimSpace(string(data))
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || value <= 0 {
			continue
		}
		switch {
		case value > 10_000_000:
			value /= 1_000_000
		case value > 10_000:
			value /= 1_000
		}
		if value > 0 && value < 10_000 {
			return round2(value), nil
		}
	}
	return 0, fmt.Errorf("CPU clock not available")
}

func readRAMPercent(meminfoPath string) (float64, error) {
	data, err := os.ReadFile(meminfoPath)
	if err != nil {
		return 0, err
	}
	values := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			values[key] = value
		}
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	if total == 0 || available > total {
		return 0, fmt.Errorf("invalid %s", meminfoPath)
	}
	return round2(float64(total-available) / float64(total) * 100), nil
}

func readRAMUsedTotalMB(meminfoPath string) (float64, float64, error) {
	data, err := os.ReadFile(meminfoPath)
	if err != nil {
		return 0, 0, err
	}
	values := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			values[key] = value
		}
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	if total == 0 {
		return 0, 0, fmt.Errorf("invalid %s", meminfoPath)
	}
	used := total
	if available <= total {
		used = total - available
	}
	return round2(float64(used) / 1024.0), round2(float64(total) / 1024.0), nil
}

func readTempC(sysRoot string) (float64, error) {
	matches, err := filepath.Glob(filepath.Join(sysRoot, "class", "thermal", "thermal_zone*", "temp"))
	if err != nil {
		return 0, err
	}
	ordered := preferredThermalZones(matches)
	for _, match := range ordered {
		data, err := os.ReadFile(match)
		if err != nil {
			continue
		}
		raw := strings.TrimSpace(string(data))
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			continue
		}
		if value > 1000 {
			value /= 1000
		}
		if value <= 0 || value >= 125 {
			continue
		}
		return round2(value), nil
	}
	return 0, fmt.Errorf("thermal temp not available")
}

func preferredThermalZones(matches []string) []string {
	preferred := make([]string, 0, len(matches))
	fallback := make([]string, 0, len(matches))
	for _, match := range matches {
		if isCPUThermalZone(match) {
			preferred = append(preferred, match)
			continue
		}
		fallback = append(fallback, match)
	}
	return append(preferred, fallback...)
}

func isCPUThermalZone(tempPath string) bool {
	data, err := os.ReadFile(filepath.Join(filepath.Dir(tempPath), "type"))
	if err != nil {
		return false
	}
	label := strings.ToLower(strings.TrimSpace(string(data)))
	for _, token := range []string{"cpu", "x86_pkg_temp", "package", "soc", "tctl", "tdie", "core"} {
		if strings.Contains(label, token) {
			return true
		}
	}
	return false
}

func readUptimeS(uptimePath string) (uint64, error) {
	data, err := os.ReadFile(uptimePath)
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0, fmt.Errorf("invalid %s", uptimePath)
	}
	seconds, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, err
	}
	return uint64(seconds), nil
}

func clamp(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}
