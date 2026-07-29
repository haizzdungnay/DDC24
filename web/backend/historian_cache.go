package main

import (
	"fmt"
	"sort"
	"sync"
)

const (
	historianRAMRetentionMS = int64(10 * 60 * 1000)
	historianRAMMaxBytes    = uint64(64 << 20)
	historianRawRAMBudget   = uint64(16 << 20)
	historianRawSampleBytes = uint64(128)
)

type HistorianRawSample struct {
	PointID        string
	Generation     uint64
	IntervalMS     int64
	ObservedUTCMS  int64
	Value          float64
	Quality        int
	Source         string
	PolicyRevision uint64
}

type HistorianRAMCache struct {
	mu       sync.RWMutex
	maxBytes uint64
	rows     map[string][]HistorianRawSample
	bytes    uint64
}

func NewHistorianRAMCache(maxBytes uint64) (*HistorianRAMCache, error) {
	if maxBytes < historianRawSampleBytes || maxBytes > historianRAMMaxBytes {
		return nil, fmt.Errorf("invalid historian RAM capacity")
	}
	return &HistorianRAMCache{maxBytes: maxBytes, rows: map[string][]HistorianRawSample{}}, nil
}

func (c *HistorianRAMCache) Append(sample HistorianRawSample) error {
	if c == nil || sample.PointID == "" || sample.Generation == 0 || (sample.IntervalMS != 1000 && sample.IntervalMS != 3000 && sample.IntervalMS != 5000) || sample.ObservedUTCMS < 0 || !finite(sample.Value) || sample.Quality < 0 || sample.Quality > 2 || sample.Source == "" {
		return fmt.Errorf("invalid historian RAM sample")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key := historianIdentityKey(sample.PointID, sample.Generation)
	rows := c.rows[key]
	cutoff := sample.ObservedUTCMS - historianRAMRetentionMS
	first := 0
	for first < len(rows) && rows[first].ObservedUTCMS < cutoff {
		first++
	}
	nextRows := rows
	nextBytes := c.bytes
	if first > 0 {
		nextBytes -= uint64(first) * historianRawSampleBytes
		nextRows = append([]HistorianRawSample(nil), rows[first:]...)
	}
	for i := range nextRows {
		if nextRows[i].ObservedUTCMS == sample.ObservedUTCMS && nextRows[i].IntervalMS == sample.IntervalMS {
			c.rows[key] = nextRows
			c.bytes = nextBytes
			return nil
		}
	}
	if nextBytes+historianRawSampleBytes > c.maxBytes {
		return fmt.Errorf("historian RAM capacity exceeded")
	}
	c.rows[key] = append(nextRows, sample)
	c.bytes = nextBytes + historianRawSampleBytes
	return nil
}

func (c *HistorianRAMCache) Raw(pointID string, generation uint64, fromUTCMS, toUTCMS int64, clockInvalid ...bool) []HistorianRawSample {
	if c == nil || (len(clockInvalid) > 0 && clockInvalid[0]) {
		return nil
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	var out []HistorianRawSample
	for _, row := range c.rows[historianIdentityKey(pointID, generation)] {
		if row.ObservedUTCMS >= fromUTCMS && row.ObservedUTCMS <= toUTCMS {
			out = append(out, row)
		}
	}
	return out
}

func (c *HistorianRAMCache) RemovePoint(pointID string) {
	if c == nil {
		return
	}
	pointID = canonicalHistoryPointID(pointID)
	c.mu.Lock()
	for key, rows := range c.rows {
		if len(rows) == 0 || canonicalHistoryPointID(rows[0].PointID) != pointID {
			continue
		}
		c.bytes -= uint64(len(rows)) * historianRawSampleBytes
		delete(c.rows, key)
	}
	c.mu.Unlock()
}

func foldHistorianHot(rows []HistorianRawSample, policyRevision uint64) (HotSample, error) {
	if len(rows) == 0 || policyRevision == 0 {
		return HotSample{}, fmt.Errorf("empty historian hot fold")
	}
	ordered := append([]HistorianRawSample(nil), rows...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].ObservedUTCMS < ordered[j].ObservedUTCMS })
	first := ordered[0]
	bucket := floorHistorianBoundary(first.ObservedUTCMS, 15000)
	hot := HotSample{PointID: first.PointID, Generation: first.Generation, BucketUTCMS: bucket, Min: first.Value, Max: first.Value, Source: first.Source, PolicyRevision: policyRevision}
	for _, row := range ordered {
		if row.PointID != hot.PointID || row.Generation != hot.Generation || floorHistorianBoundary(row.ObservedUTCMS, 15000) != bucket || !finite(row.Value) || row.Quality < 0 || row.Quality > 2 || row.Source == "" {
			return HotSample{}, fmt.Errorf("invalid historian hot fold row")
		}
		hot.Value = row.Value
		hot.LastSampleUTCMS = row.ObservedUTCMS
		if row.Value < hot.Min {
			hot.Min = row.Value
		}
		if row.Value > hot.Max {
			hot.Max = row.Value
		}
		hot.Sum += row.Value
		hot.Count++
		if row.Quality > hot.WorstQuality {
			hot.WorstQuality = row.Quality
		}
		if hot.Source != row.Source {
			hot.Source = "mixed"
		}
	}
	return hot, nil
}
