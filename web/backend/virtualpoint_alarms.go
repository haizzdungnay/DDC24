package main

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

func (a *App) appendVirtualPointAlarms(ctx context.Context, alarms []AlarmDTO) []AlarmDTO {
	if a == nil {
		return alarms
	}
	rows, err := a.LoadAlarmSettings(ctx)
	if err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN virtual_alarm.settings err=%v", err)
		}
		return alarms
	}
	for _, row := range rows {
		alarm, ok := a.evaluateVirtualPointAlarm(row)
		if ok {
			alarms = append(alarms, alarm)
		}
	}
	return alarms
}

func (a *App) evaluateVirtualPointAlarm(row AlarmSetting) (AlarmDTO, bool) {
	if !row.Enabled || row.AlarmType != alarmTypeHighLowInput || row.Params == nil {
		return AlarmDTO{}, false
	}
	for _, source := range row.Sources {
		if normalizeVirtualPointKind(source.Kind) != "VP" {
			continue
		}
		item, ok := a.findVirtualPoint(source.PointID)
		if !ok || !item.Enabled || !virtualPointNumericSignalType(item.SignalType) {
			continue
		}
		value, ok := numericPointValue(item.Value)
		if !ok {
			continue
		}
		level, threshold, active := virtualAlarmHighLow(value, row.Params)
		if !active {
			continue
		}
		// ponytail: virtual alarms are evaluated in web without core priority,
		// ack, or delay state; add a backend alarm lifecycle when VP alarms need
		// operator acknowledgement independent of core alarms.
		return AlarmDTO{
			ID:           row.ID,
			Time:         time.Now().UTC().Format(time.RFC3339Nano),
			Severity:     virtualAlarmSeverity(row.Priority),
			Status:       "active",
			Message:      row.Label,
			Source:       item.ID,
			Value:        strconv.FormatFloat(value, 'f', -1, 64),
			Detail:       fmt.Sprintf("%s %.3g", level, threshold),
			TriggerLevel: level,
			Threshold:    strconv.FormatFloat(threshold, 'f', -1, 64),
			Active:       true,
		}, true
	}
	return AlarmDTO{}, false
}

func virtualAlarmHighLow(value float64, params *AlarmParams) (string, float64, bool) {
	if params == nil || params.HH == nil || params.H == nil || params.L == nil || params.LL == nil {
		return "", 0, false
	}
	if value >= *params.HH {
		return "HH", *params.HH, true
	}
	if value >= *params.H {
		return "H", *params.H, true
	}
	if value <= *params.LL {
		return "LL", *params.LL, true
	}
	if value <= *params.L {
		return "L", *params.L, true
	}
	return "", 0, false
}

func virtualAlarmSeverity(priority string) string {
	switch priority {
	case "critical", "high", "medium", "low":
		return priority
	default:
		return "medium"
	}
}
