//go:build linux

package app

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	timedatectlPath = "/usr/bin/timedatectl"
	systemctlPath   = "/usr/bin/systemctl"
	hwclockPath     = "/usr/sbin/hwclock"
	chronycPath     = "/usr/bin/chronyc"
)

type systemTimeService struct {
	run     func(context.Context, string, ...string) (string, error)
	apply   func(context.Context, string) error
	now     func() time.Time
	rtcPath string
}

func NewSystemTimeService() TimeService { return systemTimeService{} }

func (s systemTimeService) command(ctx context.Context, name string, args ...string) (string, error) {
	if s.run != nil {
		return s.run(ctx, name, args...)
	}
	return runTimeCommand(ctx, name, args...)
}

func (s systemTimeService) currentTime() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s systemTimeService) rtc() string {
	if s.rtcPath != "" {
		return s.rtcPath
	}
	return "/dev/rtc0"
}

func (s systemTimeService) Status(ctx context.Context, cfg ConfigTime) (TimeStatus, error) {
	output, err := s.command(ctx, timedatectlPath, "show", "--property=Timezone")
	if err != nil {
		return TimeStatus{}, err
	}
	values := parseTimeProperties(output)
	now := s.currentTime()
	zone := values["Timezone"]
	if zone == "" {
		zone = cfg.Timezone
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		location = time.UTC
	}
	tracking, trackingErr := s.command(ctx, chronycPath, "tracking")
	synchronized, sourceValue, offsetValue, refTime := parseChronyTracking(tracking)
	mode := "manual"
	if trackingErr == nil {
		mode = "ntp"
	}
	health := "healthy"
	warnings := []string{}
	if mode == "ntp" && !synchronized {
		health = "degraded"
		warnings = append(warnings, "NTP has not synchronized")
	}
	// `T57-3.15`: đồng hồ lệch quá một giây làm mốc thời gian trong historian và
	// nhật ký cảnh báo không còn so được với thiết bị khác. "Đã đồng bộ" mà lệch
	// 30 giây là một trạng thái phải nói ra, không phải một trạng thái khoẻ.
	if synchronized && math.Abs(offsetValue) > 1000 {
		health = "degraded"
		warnings = append(warnings, fmt.Sprintf("clock offset %.0f ms exceeds 1000 ms", offsetValue))
	}
	var source *string
	var offsetMS *float64
	if sourceValue != "" {
		source = &sourceValue
	}
	if synchronized {
		offsetMS = &offsetValue
	}
	rtcPresent := false
	var rtcUTC *string
	if _, err := os.Stat(s.rtc()); err == nil {
		rtcPresent = true
		if instant, ok := readRTCFromSysfs(s.rtc()); ok {
			value := instant.UTC().Format(time.RFC3339)
			rtcUTC = &value
		} else if rtcOutput, err := s.command(ctx, hwclockPath, "--show", "--utc"); err == nil {
			if instant, ok := parseRTCUTC(rtcOutput); ok {
				value := instant.UTC().Format(time.RFC3339)
				rtcUTC = &value
			}
		}
	}
	// `T57-3.15`: "lần đồng bộ cuối" từng là một trường luôn `null` trong hợp
	// đồng — giao diện hiện `n/a` vĩnh viễn và không ai biết đó là thiếu dữ liệu
	// hay là chưa bao giờ đồng bộ. Nay lấy từ `Ref time` của chrony.
	var lastSyncUTC *string
	if refTime != "" {
		lastSyncUTC = &refTime
	}
	return TimeStatus{
		NowUTC: now.UTC().Format(time.RFC3339), NowLocal: now.In(location).Format(time.RFC3339),
		Timezone: zone, Mode: mode, Synchronized: synchronized, Source: source, OffsetMS: offsetMS,
		LastSyncUTC: lastSyncUTC,
		RTCPresent:  rtcPresent, RTCUTC: rtcUTC, Health: health, Warnings: warnings,
	}, nil
}

func readRTCFromSysfs(rtcPath string) (time.Time, bool) {
	name := filepath.Base(rtcPath)
	dateData, dateErr := os.ReadFile(filepath.Join("/sys/class/rtc", name, "date"))
	timeData, timeErr := os.ReadFile(filepath.Join("/sys/class/rtc", name, "time"))
	if dateErr != nil || timeErr != nil {
		return time.Time{}, false
	}
	instant, err := time.Parse("2006-01-02 15:04:05", strings.TrimSpace(string(dateData))+" "+strings.TrimSpace(string(timeData)))
	return instant, err == nil
}

func (s systemTimeService) Apply(ctx context.Context, cfg ConfigTime) ([]string, error) {
	data, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	encoded := base64.RawURLEncoding.EncodeToString(data)
	apply := s.apply
	if apply == nil {
		apply = callTimeHelper
	}
	if err := apply(ctx, encoded); err != nil {
		return nil, err
	}
	if cfg.NTPEnabled {
		return []string{"Chrony restarted; synchronization may still be converging"}, nil
	}
	return nil, nil
}

func callTimeHelper(ctx context.Context, encoded string) error {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "unix", timeHelperSocketPath())
	if err != nil {
		return fmt.Errorf("connect time helper: %w", err)
	}
	defer conn.Close()
	deadline := time.Now().Add(20 * time.Second)
	_ = conn.SetDeadline(deadline)
	if _, err := fmt.Fprintln(conn, encoded); err != nil {
		return err
	}
	response, err := bufio.NewReader(io.LimitReader(conn, 16)).ReadString('\n')
	if err != nil {
		return err
	}
	if strings.TrimSpace(response) != "ok" {
		return fmt.Errorf("time helper rejected request")
	}
	return nil
}

func runTimeCommand(ctx context.Context, name string, args ...string) (string, error) {
	commandCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandCtx, name, args...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s failed: %w", filepath.Base(name), err)
	}
	return string(output), nil
}

func runTimeCommandOnly(ctx context.Context, name string, args ...string) error {
	_, err := runTimeCommand(ctx, name, args...)
	return err
}

func parseTimeProperties(output string) map[string]string {
	values := map[string]string{}
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), "=")
		if ok {
			values[key] = value
		}
	}
	return values
}

func parseRTCUTC(output string) (time.Time, bool) {
	value := strings.TrimSpace(output)
	for _, layout := range []string{"2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05-07:00"} {
		if instant, err := time.Parse(layout, value); err == nil {
			return instant, true
		}
	}
	return time.Time{}, false
}

// parseChronyTracking đọc `chronyc tracking`.
//
// Trả thêm `refTime` (`T57-3.15`): mốc tham chiếu gần nhất mà chrony ghi nhận,
// tức thời điểm đồng hồ thật sự được chỉnh theo nguồn — thứ mà người vận hành
// hỏi khi nghi ngờ mốc thời gian trong nhật ký.
func parseChronyTracking(output string) (bool, string, float64, string) {
	var source string
	var offsetMS float64
	var refTime string
	leapNormal := false
	for _, line := range strings.Split(output, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "Reference ID":
			if start := strings.Index(value, "("); start >= 0 && strings.HasSuffix(value, ")") {
				source = value[start+1 : len(value)-1]
			} else {
				source = strings.Fields(value)[0]
			}
		case "System time":
			fields := strings.Fields(value)
			if len(fields) >= 2 {
				if seconds, err := strconv.ParseFloat(fields[0], 64); err == nil {
					offsetMS = seconds * 1000
				}
			}
		case "Ref time (UTC)":
			// Dạng `Wed Aug 19 06:12:13 2026`. Không parse được thì để trống —
			// một mốc thời gian đoán sai còn tệ hơn không có mốc nào.
			if instant, err := time.Parse("Mon Jan _2 15:04:05 2006", value); err == nil {
				refTime = instant.UTC().Format(time.RFC3339)
			}
		case "Leap status":
			leapNormal = value == "Normal"
		}
	}
	return leapNormal && source != "", source, offsetMS, refTime
}
