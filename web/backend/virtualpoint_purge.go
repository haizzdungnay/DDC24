package main

import (
	"context"
	"fmt"
)

func (a *App) purgeVirtualPointData(ctx context.Context, pointID string) error {
	pointID = canonicalHistoryPointID(pointID)
	if pointID == "" {
		return fmt.Errorf("point id is required")
	}

	// Fence in-memory producers before durable rows are removed.
	a.historianShadow.RemovePoint(pointID)
	a.virtualPointRuntime.Remove(pointID)
	a.virtualPointRing.Remove(pointID)
	a.historianTrendCache.RemovePoint(pointID)

	if err := a.purgeVirtualPointSchedules(ctx, pointID); err != nil {
		return err
	}
	if err := a.purgeVirtualPointAlarmSources(ctx, pointID); err != nil {
		return err
	}
	if a.historian != nil {
		if err := a.historian.RemovePoint(ctx, pointID); err != nil {
			return fmt.Errorf("purge historian policy: %w", err)
		}
	}
	if a.historianV2 != nil {
		if err := a.historianV2.PurgePoint(ctx, pointID, a.cfg.HistorianV2ArchiveDir); err != nil {
			return fmt.Errorf("purge historian v2 point data: %w", err)
		}
	}
	if a.trends != nil {
		if err := a.trends.PurgePoint(ctx, pointID); err != nil {
			return fmt.Errorf("purge legacy trend point data: %w", err)
		}
	}
	return nil
}

func (a *App) purgeVirtualPointSchedules(ctx context.Context, pointID string) error {
	rows, err := a.LoadSchedules(ctx)
	if err != nil {
		return err
	}
	kept := make([]ScheduleRow, 0, len(rows))
	changed := false
	for _, row := range rows {
		if scheduleTargetsVirtualPoint(row.Target, pointID) {
			changed = true
			continue
		}
		kept = append(kept, row)
	}
	if changed {
		return a.SaveSchedules(ctx, kept)
	}
	return nil
}

func scheduleTargetsVirtualPoint(target *ScheduleTarget, pointID string) bool {
	if target == nil || normalizeVirtualPointKind(target.Kind) != "VP" {
		return false
	}
	if target.PointID != "" && canonicalHistoryPointID(target.PointID) == pointID {
		return true
	}
	return target.Channel != nil && formatVirtualPointID(*target.Channel) == pointID
}

func (a *App) purgeVirtualPointAlarmSources(ctx context.Context, pointID string) error {
	rows, err := a.LoadAlarmSettings(ctx)
	if err != nil {
		return err
	}
	kept := make([]AlarmSetting, 0, len(rows))
	changed := false
	for _, row := range rows {
		sources := make([]AlarmSource, 0, len(row.Sources))
		for _, source := range row.Sources {
			if normalizeVirtualPointKind(source.Kind) == "VP" && canonicalHistoryPointID(source.PointID) == pointID {
				changed = true
				continue
			}
			sources = append(sources, source)
		}
		if len(sources) == 0 {
			if len(row.Sources) > 0 {
				changed = true
				continue
			}
		}
		row.Sources = sources
		kept = append(kept, row)
	}
	if changed {
		return a.SaveAlarmSettings(ctx, kept)
	}
	return nil
}
