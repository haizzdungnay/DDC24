package main

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

const virtualPointSchedulerInterval = 5 * time.Second

func (a *App) StartVirtualPointScheduler(ctx context.Context) {
	if a == nil {
		return
	}
	go a.runVirtualPointScheduler(ctx)
}

func (a *App) runVirtualPointScheduler(ctx context.Context) {
	ticker := time.NewTicker(virtualPointSchedulerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if err := a.applyVirtualPointSchedules(ctx, now); err != nil && a.logger != nil {
				a.logger.Printf("WARN virtual_points.schedule err=%v", err)
			}
		}
	}
}

func (a *App) applyVirtualPointSchedules(ctx context.Context, now time.Time) error {
	rows, err := a.LoadSchedules(ctx)
	if err != nil {
		return err
	}
	if virtualScheduleHolidayActive(rows, now) {
		return nil
	}
	type winner struct {
		row   ScheduleRow
		age   int
		order int
	}
	winners := map[string]winner{}
	for order, row := range rows {
		if !row.Enabled || row.Target == nil || normalizeVirtualPointKind(row.Target.Kind) != "VP" || row.Value == nil {
			continue
		}
		if row.ScheduleType != "controller_operation_mode" && row.ScheduleType != "control_loop_setpoint" && row.ScheduleType != "analog_output_value" {
			continue
		}
		age, ok := virtualScheduleActive(row, now)
		if !ok {
			continue
		}
		id := canonicalVirtualPointID(row.Target.PointID)
		current, exists := winners[id]
		if !exists || age < current.age || (age == current.age && order > current.order) {
			winners[id] = winner{row: row, age: age, order: order}
		}
	}
	for id, win := range winners {
		if err := a.writeScheduledVirtualPointValue(id, *win.row.Value); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) writeScheduledVirtualPointValue(id string, value float64) error {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return err
	}
	target := canonicalVirtualPointID(id)
	index := virtualPointIndex(cfg.Items, target)
	if index < 0 {
		return fmt.Errorf("virtual point %s not found", target)
	}
	item := normalizeVirtualPoint(cfg.Items[index])
	if !item.Enabled || !item.Writable {
		return nil
	}
	if item.SignalType != virtualPointSignalInteger && item.SignalType != virtualPointSignalFloat {
		return nil
	}
	nextValue, ok := normalizeVirtualPointValue(item.SignalType, value)
	if !ok || fmt.Sprint(item.Value) == fmt.Sprint(nextValue) {
		return nil
	}
	// ponytail: virtual schedules own the value directly; add priority/release
	// ownership when Virtual Points gain a BE priority resolver.
	item.Value = nextValue
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	cfg.Items[index] = item
	if err := a.writeVirtualPointsConfig(&http.Request{RemoteAddr: "virtual-scheduler"}, cfg, "schedule"); err != nil {
		return err
	}
	a.virtualPointRuntime.Update(RuntimePoint{ID: item.ID, Kind: "VP", Value: item.Value, Quality: "GOOD", Source: "schedule", Role: "runtime_value", Unit: item.Unit, SignalType: item.SignalType, Generation: item.Generation})
	return nil
}

func virtualScheduleHolidayActive(rows []ScheduleRow, now time.Time) bool {
	monthDay := int(now.Month())*100 + now.Day()
	for _, row := range rows {
		if !row.Enabled || row.ScheduleType != "holiday_period" {
			continue
		}
		start, okStart := virtualScheduleMonthDay(row.StartDate)
		end, okEnd := virtualScheduleMonthDay(row.EndDate)
		if !okStart || !okEnd {
			continue
		}
		if start <= end && monthDay >= start && monthDay <= end {
			return true
		}
		if start > end && (monthDay >= start || monthDay <= end) {
			return true
		}
	}
	return false
}

func virtualScheduleActive(row ScheduleRow, now time.Time) (int, bool) {
	start, okStart := virtualScheduleMinute(row.StartTime)
	end, okEnd := virtualScheduleMinute(row.EndTime)
	if !okStart || !okEnd || start == end {
		return 0, false
	}
	minute := now.Hour()*60 + now.Minute()
	today := virtualScheduleWeekday(now.Weekday())
	yesterday := virtualScheduleWeekday(now.AddDate(0, 0, -1).Weekday())
	if start < end {
		return minute - start, minute >= start && minute < end && hasScheduleWeekday(row.Weekdays, today)
	}
	if minute >= start && hasScheduleWeekday(row.Weekdays, today) {
		return minute - start, true
	}
	if minute < end && hasScheduleWeekday(row.Weekdays, yesterday) {
		return minute + 24*60 - start, true
	}
	return 0, false
}

func virtualScheduleMinute(value string) (int, bool) {
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return 0, false
	}
	return parsed.Hour()*60 + parsed.Minute(), true
}

func virtualScheduleMonthDay(value string) (int, bool) {
	parsed, err := time.Parse("01-02", value)
	if err != nil {
		return 0, false
	}
	return int(parsed.Month())*100 + parsed.Day(), true
}

func virtualScheduleWeekday(day time.Weekday) string {
	switch day {
	case time.Monday:
		return "monday"
	case time.Tuesday:
		return "tuesday"
	case time.Wednesday:
		return "wednesday"
	case time.Thursday:
		return "thursday"
	case time.Friday:
		return "friday"
	case time.Saturday:
		return "saturday"
	default:
		return "sunday"
	}
}

func hasScheduleWeekday(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
