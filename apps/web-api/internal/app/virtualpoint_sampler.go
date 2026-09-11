package app

import (
	"context"
	"log"
	"sync"
	"time"
)

const virtualPointSamplerReloadEvery = time.Second

type virtualPointRingSample struct {
	TS      int64
	Value   float64
	Quality int
}

type VirtualPointRing struct {
	mu       sync.Mutex
	maxAgeMs int64
	byPoint  map[string][]virtualPointRingSample
}

func NewVirtualPointRing(maxAge time.Duration) *VirtualPointRing {
	return &VirtualPointRing{maxAgeMs: maxAge.Milliseconds(), byPoint: map[string][]virtualPointRingSample{}}
}

func (r *VirtualPointRing) Add(samples []Sample, nowMs int64) {
	if r == nil || len(samples) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := nowMs - r.maxAgeMs
	for _, sample := range samples {
		value, ok := numericPointValue(sample.Value)
		if !ok {
			continue
		}
		id := canonicalHistoryPointID(sample.PointID)
		items := append(r.byPoint[id], virtualPointRingSample{TS: sample.TS, Value: value, Quality: sample.Quality})
		keep := 0
		for _, item := range items {
			if item.TS >= cutoff {
				items[keep] = item
				keep++
			}
		}
		r.byPoint[id] = items[:keep]
	}
}

func (r *VirtualPointRing) Query(pointIDs []string, fromTs int64, toTs int64) []Sample {
	if r == nil || len(pointIDs) == 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Sample{}
	for _, id := range normalizePointIDs(pointIDs) {
		for _, item := range r.byPoint[canonicalHistoryPointID(id)] {
			if item.TS < fromTs || item.TS > toTs {
				continue
			}
			out = append(out, Sample{TS: item.TS, PointID: id, Value: item.Value, Quality: item.Quality})
		}
	}
	return out
}

func (a *App) StartVirtualPointSampler(ctx context.Context) {
	if a == nil || a.trends == nil {
		return
	}
	a.legacyMu.Lock()
	a.startVirtualPointSamplerLocked(ctx)
	a.legacyMu.Unlock()
}

func (a *App) runVirtualPointSampler(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	var items []VirtualPoint
	var loadedAt time.Time
	lastSample := map[string]int64{}
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if now.Sub(loadedAt) >= virtualPointSamplerReloadEvery {
				items = a.loadVirtualPointsForSampling(a.logger)
				loadedAt = now
			}
			a.sampleVirtualPoints(ctx, items, now, lastSample)
		}
	}
}

func (a *App) loadVirtualPointsForSampling(logger *log.Logger) []VirtualPoint {
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		if logger != nil {
			logger.Printf("WARN virtual_points.sample config err=%v", err)
		}
		return nil
	}
	cfg = normalizeVirtualPointsConfig(cfg)
	return cfg.Items
}

func (a *App) sampleVirtualPoints(ctx context.Context, items []VirtualPoint, now time.Time, lastSample map[string]int64) {
	nowMs := now.UTC().UnixMilli()
	samples := make([]Sample, 0, len(items))
	ringSamples := make([]Sample, 0)
	for _, item := range items {
		item = normalizeVirtualPoint(item)
		if !item.Enabled || !item.LogEnabled || item.LogIntervalMs == nil {
			continue
		}
		if !virtualPointLoggableSignalType(item.SignalType) {
			continue
		}
		interval := int64(*item.LogIntervalMs)
		if interval <= 0 || nowMs-lastSample[item.ID] < interval {
			continue
		}
		value, ok := normalizeVirtualPointValue(item.SignalType, item.Value)
		if !ok {
			continue
		}
		if _, ok := numericPointValue(value); !ok {
			continue
		}
		lastSample[item.ID] = nowMs
		sample := Sample{TS: nowMs, PointID: item.ID, Value: value, Quality: 0}
		if *item.LogIntervalMs == 10 {
			ringSamples = append(ringSamples, sample)
		} else {
			samples = append(samples, sample)
		}
	}
	if len(ringSamples) > 0 {
		a.virtualPointRing.Add(ringSamples, nowMs)
	}
	if len(samples) == 0 {
		return
	}
	if err := a.trends.InsertBatch(ctx, samples); err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN virtual_points.sample insert err=%v", err)
		}
		return
	}
	pruneVirtualPointRetention(ctx, a.trends, a.logger, items, nowMs)
}

// virtualPointPruner là bề mặt tối thiểu mà việc thi hành hạn lưu cần, tách ra
// để đường lỗi của `PruneBefore` kiểm chứng được mà không phải mở một database
// thật trong test.
type virtualPointPruner interface {
	PruneBefore(ctx context.Context, pointID string, beforeTs int64) error
}

/* `PruneBefore` hỏng lâu dài nghĩa là hạn lưu của Virtual Point không được thi
 * hành: bảng trend phình quá hạn đã cấu hình và triệu chứng đầu tiên là hết đĩa
 * chứ không phải một dòng log. Lỗi vì vậy phải được ghi theo đúng quy ước ngay
 * phía trên, và một item hỏng KHÔNG được cắt hạn lưu của các item còn lại. */
func pruneVirtualPointRetention(ctx context.Context, pruner virtualPointPruner, logger *log.Logger, items []VirtualPoint, nowMs int64) {
	if pruner == nil {
		return
	}
	for _, item := range items {
		if item.RetentionS <= 0 {
			continue
		}
		if err := pruner.PruneBefore(ctx, item.ID, nowMs-int64(item.RetentionS)*1000); err != nil {
			if logger != nil {
				logger.Printf("WARN virtual_points.prune err=%v", err)
			}
		}
	}
}
