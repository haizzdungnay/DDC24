package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func (a *App) LoadAlarmSettings(ctx context.Context) ([]AlarmSetting, error) {
	return loadAlarmSettingsFile(ctx, a.alarmSettingsPath())
}

func (a *App) SaveAlarmSettings(ctx context.Context, rows []AlarmSetting) error {
	return saveAlarmSettingsFile(ctx, a.alarmSettingsPath(), rows)
}

func (a *App) alarmSettingsPath() string {
	if a != nil && a.cfg.AlarmConfPath != "" {
		return a.cfg.AlarmConfPath
	}
	return a.configPath("alarm_settings.conf")
}

func loadAlarmSettingsFile(ctx context.Context, path string) ([]AlarmSetting, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	var rows []AlarmSetting
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []AlarmSetting{}, nil
		}
		return nil, fmt.Errorf("read alarm_settings %s: %w", path, err)
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, fmt.Errorf("parse alarm_settings %s: %w", path, err)
	}
	if rows == nil {
		rows = []AlarmSetting{}
	}
	return rows, nil
}

func saveAlarmSettingsFile(ctx context.Context, path string, rows []AlarmSetting) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	data, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		return fmt.Errorf("encode alarm_settings: %w", err)
	}
	data = append(data, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("prepare alarm_settings dir: %w", err)
	}
	_ = os.Chmod(dir, 0o700)
	if err := writeConfigFileAtomic(path, data, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}
