package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func (a *App) LoadSchedules(ctx context.Context) ([]ScheduleRow, error) {
	return loadSchedulesFile(ctx, a.schedulePath())
}

func (a *App) SaveSchedules(ctx context.Context, rows []ScheduleRow) error {
	return saveSchedulesFile(ctx, a.schedulePath(), rows)
}

func (a *App) schedulePath() string {
	if a != nil && a.cfg.ScheduleConfPath != "" {
		return a.cfg.ScheduleConfPath
	}
	return a.configPath("schedule.conf")
}

func loadSchedulesFile(ctx context.Context, path string) ([]ScheduleRow, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	var rows []ScheduleRow
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []ScheduleRow{}, nil
		}
		return nil, fmt.Errorf("read schedules %s: %w", path, err)
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, fmt.Errorf("parse schedules %s: %w", path, err)
	}
	if rows == nil {
		rows = []ScheduleRow{}
	}
	normalizeSchedules(rows)
	return rows, nil
}

func saveSchedulesFile(ctx context.Context, path string, rows []ScheduleRow) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	data, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		return fmt.Errorf("encode schedules: %w", err)
	}
	data = append(data, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("prepare schedule dir: %w", err)
	}
	_ = os.Chmod(dir, 0o700)
	if err := writeConfigFileAtomic(path, data, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}
