//go:build linux

package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type recordedTimeCommand struct {
	name string
	args []string
}

func TestLinuxTimeStatusReportsObservedSyncAndRTC(t *testing.T) {
	rtc := filepath.Join(t.TempDir(), "test-rtc0")
	if err := os.WriteFile(rtc, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	service := systemTimeService{
		rtcPath: rtc,
		now:     func() time.Time { return time.Date(2026, 7, 18, 3, 0, 0, 0, time.UTC) },
		run: func(_ context.Context, name string, args ...string) (string, error) {
			switch filepath.Base(name) {
			case "timedatectl":
				return "Timezone=Asia/Ho_Chi_Minh\n", nil
			case "chronyc":
				return "Reference ID    : 01020304 (ntp.example.com)\nSystem time     : 0.001800000 seconds fast of NTP time\nLeap status     : Normal\n", nil
			case "hwclock":
				return "2026-07-18 03:00:00.000000+00:00\n", nil
			}
			return "", nil
		},
	}
	status, err := service.Status(context.Background(), ConfigTime{Timezone: "UTC", NTPEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if status.Source == nil || *status.Source != "ntp.example.com" || status.OffsetMS == nil || *status.OffsetMS != 1.8 || !status.RTCPresent || status.RTCUTC == nil || *status.RTCUTC != "2026-07-18T03:00:00Z" {
		t.Fatalf("status=%+v", status)
	}
}

func TestLinuxTimeApplyUsesFixedArgvAndAtomicDropIn(t *testing.T) {
	var encoded string
	service := systemTimeService{
		rtcPath: filepath.Join(t.TempDir(), "missing-rtc"),
		apply: func(_ context.Context, value string) error {
			encoded = value
			return nil
		},
	}
	_, err := service.Apply(context.Background(), ConfigTime{Timezone: "UTC", NTPEnabled: true, NTPServers: []string{"pool.ntp.org", "10.0.0.1"}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var got ConfigTime
	if err := json.Unmarshal(data, &got); err != nil || got.Timezone != "UTC" || len(got.NTPServers) != 2 {
		t.Fatalf("payload=%+v err=%v", got, err)
	}
}
