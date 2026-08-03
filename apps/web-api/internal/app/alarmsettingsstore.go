package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const alarmSettingsDirPerm os.FileMode = 0o2770
const alarmSettingsFilePerm os.FileMode = 0o660

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
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []AlarmSetting{}, nil
		}
		return nil, fmt.Errorf("read alarm_settings %s: %w", path, err)
	}
	var rawRows []json.RawMessage
	if err := json.Unmarshal(data, &rawRows); err != nil {
		return nil, fmt.Errorf("parse alarm_settings %s: %w", path, err)
	}
	if rawRows == nil {
		return []AlarmSetting{}, nil
	}
	rows := make([]AlarmSetting, 0, len(rawRows))
	for i, raw := range rawRows {
		row, err := decodeAlarmSettingRow(raw)
		if err != nil {
			return nil, fmt.Errorf("parse alarm_settings %s row %d: %w", path, i, err)
		}
		rows = append(rows, row)
	}
	normalizeAlarmSettings(rows)
	if errs := validateAlarmSettings(rows); len(errs) > 0 {
		return nil, fmt.Errorf("validate alarm_settings %s: %s", path, configValidationSummary(errs))
	}
	return rows, nil
}

func saveAlarmSettingsFile(ctx context.Context, path string, rows []AlarmSetting) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if rows == nil {
		rows = []AlarmSetting{}
	}
	data, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		return fmt.Errorf("encode alarm_settings: %w", err)
	}
	data = append(data, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, alarmSettingsDirPerm); err != nil {
		return fmt.Errorf("prepare alarm_settings dir: %w", err)
	}
	_ = os.Chmod(dir, alarmSettingsDirPerm)
	if err := writeConfigFileAtomic(path, data, alarmSettingsFilePerm); err != nil {
		return err
	}
	_ = os.Chmod(path, alarmSettingsFilePerm)
	return nil
}

func decodeAlarmSettingRow(raw json.RawMessage) (AlarmSetting, error) {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return AlarmSetting{}, err
	}
	if _, hasPointID := probe["pointId"]; hasPointID {
		if _, hasID := probe["id"]; !hasID {
			if _, hasSources := probe["sources"]; !hasSources {
				var legacy legacyAlarmSetting
				if err := json.Unmarshal(raw, &legacy); err != nil {
					return AlarmSetting{}, err
				}
				return migrateLegacyAlarmSetting(legacy)
			}
		}
	}
	var row AlarmSetting
	if err := json.Unmarshal(raw, &row); err != nil {
		return AlarmSetting{}, err
	}
	if row.ClearMode == "" {
		row.ClearMode = "auto"
	}
	return row, nil
}

type legacyAlarmSetting struct {
	PointID  string   `json:"pointId"`
	Label    string   `json:"label"`
	Enabled  bool     `json:"enabled"`
	HH       *float64 `json:"hh"`
	H        *float64 `json:"h"`
	L        *float64 `json:"l"`
	LL       *float64 `json:"ll"`
	DelayS   float64  `json:"delayS"`
	Priority string   `json:"priority"`
}

func migrateLegacyAlarmSetting(row legacyAlarmSetting) (AlarmSetting, error) {
	if row.HH == nil || row.H == nil || row.L == nil || row.LL == nil {
		return AlarmSetting{}, fmt.Errorf("legacy hh/h/l/ll are required")
	}
	prefix, channel, ok := parsePointID(row.PointID)
	if !ok {
		return AlarmSetting{}, fmt.Errorf("legacy pointId %q is invalid", row.PointID)
	}
	legacyPointID := formatPointID(prefix, channel)
	sourceKind := ""
	switch prefix {
	case "AI", "UI":
		sourceKind = "UI"
	case "AO", "DO":
		sourceKind = prefix
	default:
		return AlarmSetting{}, fmt.Errorf("legacy pointId %q has unsupported prefix", row.PointID)
	}
	return AlarmSetting{
		ID:            "ALM-" + legacyPointID,
		Label:         row.Label,
		Enabled:       row.Enabled,
		AlarmType:     alarmTypeHighLowInput,
		Sources:       []AlarmSource{{Kind: sourceKind, Channel: channel, PointID: formatPointID(sourceKind, channel)}},
		Priority:      row.Priority,
		ClearMode:     "auto",
		DelayS:        row.DelayS,
		PublishBacnet: false,
		Params:        &AlarmParams{HH: row.HH, H: row.H, L: row.L, LL: row.LL},
	}, nil
}

func configValidationSummary(errs []configValidationError) string {
	parts := make([]string, 0, len(errs))
	for _, err := range errs {
		parts = append(parts, err.Path+" "+err.Message)
	}
	return strings.Join(parts, "; ")
}
