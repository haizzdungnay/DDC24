//go:build windows

package app

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type WindowsOSReader struct{}

type filetime struct {
	LowDateTime  uint32
	HighDateTime uint32
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

var (
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	procGetSystemTimes     = kernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatus = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetTickCount64     = kernel32.NewProc("GetTickCount64")
)

var windowsCPUMeter = struct {
	sync.Mutex
	sample    cpuSample
	sampledAt time.Time
	value     float64
	hasSample bool
	hasValue  bool
}{}

const windowsCPUSampleWindow = 900 * time.Millisecond

func (WindowsOSReader) ReadMetrics(ctx context.Context) (OSMetrics, error) {
	var metrics OSMetrics
	if cpu, err := windowsCPUPercent(ctx); err == nil {
		metrics.CPUPercent = &cpu
	}
	if ramPercent, ramUsedMB, ramTotalMB, err := windowsRAM(); err == nil {
		metrics.RAMPercent = &ramPercent
		metrics.RAMUsedMB = &ramUsedMB
		metrics.RAMTotalMB = &ramTotalMB
	}
	if temp, err := windowsTempC(ctx); err == nil {
		metrics.TempC = &temp
	}
	if up, err := windowsUptimeS(); err == nil {
		metrics.UptimeS = &up
	}
	if metrics.CPUPercent == nil && metrics.RAMPercent == nil && metrics.UptimeS == nil {
		return metrics, fmt.Errorf("windows os metrics unavailable")
	}
	return metrics, nil
}

func windowsCPUPercent(ctx context.Context) (float64, error) {
	current, err := windowsCPUSample()
	if err != nil {
		return 0, err
	}
	now := time.Now()

	windowsCPUMeter.Lock()
	if windowsCPUMeter.hasSample {
		elapsed := now.Sub(windowsCPUMeter.sampledAt)
		if elapsed >= windowsCPUSampleWindow {
			value := cpuPercentBetween(windowsCPUMeter.sample, current)
			windowsCPUMeter.sample = current
			windowsCPUMeter.sampledAt = now
			windowsCPUMeter.value = value
			windowsCPUMeter.hasValue = true
			windowsCPUMeter.Unlock()
			return value, nil
		}
		if windowsCPUMeter.hasValue {
			value := windowsCPUMeter.value
			windowsCPUMeter.Unlock()
			return value, nil
		}
	}
	windowsCPUMeter.sample = current
	windowsCPUMeter.sampledAt = now
	windowsCPUMeter.hasSample = true
	windowsCPUMeter.Unlock()

	timer := time.NewTimer(windowsCPUSampleWindow)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-timer.C:
	}

	second, err := windowsCPUSample()
	if err != nil {
		return 0, err
	}
	value := cpuPercentBetween(current, second)
	windowsCPUMeter.Lock()
	windowsCPUMeter.sample = second
	windowsCPUMeter.sampledAt = time.Now()
	windowsCPUMeter.value = value
	windowsCPUMeter.hasValue = true
	windowsCPUMeter.Unlock()
	return value, nil
}

func windowsCPUSample() (cpuSample, error) {
	var idle, kernel, user filetime
	r1, _, err := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	if r1 == 0 {
		return cpuSample{}, err
	}
	kernelTicks := filetimeUint64(kernel)
	userTicks := filetimeUint64(user)
	return cpuSample{idle: filetimeUint64(idle), total: kernelTicks + userTicks}, nil
}

func filetimeUint64(value filetime) uint64 {
	return uint64(value.HighDateTime)<<32 | uint64(value.LowDateTime)
}

func windowsRAM() (float64, float64, float64, error) {
	var mem memoryStatusEx
	mem.Length = uint32(unsafe.Sizeof(mem))
	r1, _, err := procGlobalMemoryStatus.Call(uintptr(unsafe.Pointer(&mem)))
	if r1 == 0 {
		return 0, 0, 0, err
	}
	if mem.TotalPhys == 0 || mem.AvailPhys > mem.TotalPhys {
		return 0, 0, 0, fmt.Errorf("invalid memory status")
	}
	totalMB := round2(float64(mem.TotalPhys) / 1024 / 1024)
	usedMB := round2(float64(mem.TotalPhys-mem.AvailPhys) / 1024 / 1024)
	percent := round2(float64(mem.TotalPhys-mem.AvailPhys) / float64(mem.TotalPhys) * 100)
	return percent, usedMB, totalMB, nil
}

func windowsTempC(ctx context.Context) (float64, error) {
	psCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	output, err := exec.CommandContext(
		psCtx,
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		windowsTempScript,
	).Output()
	if err != nil {
		return 0, err
	}
	for _, field := range strings.Fields(string(output)) {
		value, err := strconv.ParseFloat(field, 64)
		if err != nil || value <= 0 || value >= 125 {
			continue
		}
		return round2(value), nil
	}
	return 0, fmt.Errorf("CPU temperature not available on Windows")
}

const windowsTempScript = `$ErrorActionPreference = 'SilentlyContinue'
$candidates = @()
foreach ($ns in @('root\LibreHardwareMonitor', 'root\OpenHardwareMonitor')) {
  $sensors = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction SilentlyContinue |
    Where-Object { $_.SensorType -eq 'Temperature' -and $_.Value -ne $null -and ($_.Name -match 'CPU|Core|Package|Tctl|Tdie' -or $_.Identifier -match '/cpu|intelcpu|amdcpu') } |
    Sort-Object @{ Expression = { if ($_.Name -match 'Package|Tctl|Tdie') { 0 } elseif ($_.Name -match 'CPU') { 1 } else { 2 } } }, @{ Expression = 'Value'; Descending = $true }
  foreach ($sensor in $sensors) { $candidates += [double]$sensor.Value }
}
if ($candidates.Count -eq 0) {
  $zones = Get-CimInstance -Namespace root\wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue
  foreach ($zone in $zones) {
    if ($zone.CurrentTemperature -ne $null) {
      $candidates += ([double]$zone.CurrentTemperature / 10.0) - 273.15
    }
  }
}
$candidates = @($candidates | Where-Object { $_ -gt 0 -and $_ -lt 125 })
if ($candidates.Count -gt 0) {
  $max = ($candidates | Measure-Object -Maximum).Maximum
  [Console]::Out.WriteLine(([double]$max).ToString([Globalization.CultureInfo]::InvariantCulture))
}`

func windowsUptimeS() (uint64, error) {
	r1, _, _ := procGetTickCount64.Call()
	return uint64(r1) / 1000, nil
}
