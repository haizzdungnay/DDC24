package main

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"sync"
	"time"
)

type Sampler struct {
	mu     sync.RWMutex
	cfg    TrendConfig
	store  *TrendStore
	reader pointReader
	logger *log.Logger
	wake   chan struct{}
	pruneN int
}

func NewSampler(store *TrendStore, reader pointReader, cfg TrendConfig, logger *log.Logger) *Sampler {
	cfg.normalize()
	return &Sampler{store: store, reader: reader, cfg: cfg, logger: logger, wake: make(chan struct{}, 1), pruneN: cfg.RetentionRecords}
}

func (s *Sampler) Start(ctx context.Context) {
	if s == nil || s.store == nil || s.reader == nil {
		return
	}
	go s.run(ctx)
}

func (s *Sampler) UpdateConfig(cfg TrendConfig) {
	if s == nil {
		return
	}
	cfg.normalize()
	s.mu.Lock()
	s.cfg = cfg
	s.pruneN = cfg.RetentionRecords
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Sampler) snapshot() TrendConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg := s.cfg
	cfg.PointIDs = append([]string(nil), s.cfg.PointIDs...)
	return cfg
}

func (s *Sampler) run(ctx context.Context) {
	for {
		cfg := s.snapshot()
		if cfg.Enabled {
			s.sample(ctx, cfg)
		}
		interval := time.Duration(clampInterval(cfg.IntervalS)) * time.Second
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-s.wake:
			if !timer.Stop() {
				<-timer.C
			}
			continue
		case <-timer.C:
		}
	}
}

func (s *Sampler) sample(ctx context.Context, cfg TrendConfig) {
	points, err := s.reader.ReadPoints(ctx)
	if err != nil {
		if s.logger != nil {
			s.logger.Printf("WARN trend.sample read_points err=%v", err)
		}
		return
	}
	wanted := make(map[string]struct{}, len(cfg.PointIDs))
	for _, id := range cfg.PointIDs {
		wanted[id] = struct{}{}
	}
	autoAll := len(wanted) == 0
	ts := time.Now().UTC().UnixMilli()
	samples := make([]Sample, 0, len(points))
	for _, point := range points {
		if point.Kind == "virtual" {
			continue
		}
		if !autoAll {
			if _, ok := wanted[point.ID]; !ok {
				continue
			}
		}
		value, ok := numericPointValue(point.Value)
		if !ok {
			continue
		}
		samples = append(samples, Sample{TS: ts, PointID: point.ID, Value: value, Quality: trendQuality(point.Quality)})
	}
	if len(samples) == 0 {
		return
	}
	if err := s.store.InsertBatch(ctx, samples); err != nil {
		if s.logger != nil {
			s.logger.Printf("WARN trend.sample insert err=%v", err)
		}
		return
	}
	if err := s.store.Prune(ctx, cfg.RetentionRecords); err != nil && s.logger != nil {
		s.logger.Printf("WARN trend.sample prune err=%v", err)
	}
}

func numericPointValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case json.Number:
		v, err := typed.Float64()
		return v, err == nil
	case string:
		v, err := strconv.ParseFloat(typed, 64)
		return v, err == nil
	default:
		return 0, false
	}
}

func trendQuality(quality string) int {
	switch quality {
	case "bad":
		return 2
	case "uncertain", "stale":
		return 1
	default:
		return 0
	}
}

func clampInterval(intervalS int) int {
	if intervalS < 10 {
		return 10
	}
	if intervalS > 300 {
		return 300
	}
	return intervalS
}
