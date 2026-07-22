//go:build windows

package main

import (
	"context"
	"errors"
	"time"
)

type systemTimeService struct{}

func NewSystemTimeService() TimeService { return systemTimeService{} }

func (systemTimeService) Status(_ context.Context, cfg ConfigTime) (TimeStatus, error) {
	now := time.Now()
	location, err := time.LoadLocation(cfg.Timezone)
	if err != nil {
		location = time.UTC
	}
	mode := "manual"
	if cfg.NTPEnabled {
		mode = "ntp"
	}
	return TimeStatus{
		NowUTC: now.UTC().Format(time.RFC3339), NowLocal: now.In(location).Format(time.RFC3339),
		Timezone: cfg.Timezone, Mode: mode, Synchronized: false, RTCPresent: false,
		Health: "degraded", Warnings: []string{"system time management is unavailable on Windows development hosts"},
	}, nil
}

func (systemTimeService) Apply(context.Context, ConfigTime) ([]string, error) {
	return nil, errors.New("system time management is unavailable on Windows development hosts")
}
