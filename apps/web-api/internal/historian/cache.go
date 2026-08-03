package historian

import (
	"context"
	"fmt"
	"sort"
	"sync"
)

const (
	RAMRetentionMS = int64(10 * 60 * 1000)
	RAMMaxBytes    = uint64(64 << 20)
	RawRAMBudget   = uint64(16 << 20)
	RawSampleBytes = uint64(128)
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

func (c *HistorianRAMCache) Identities(ctx context.Context, selected []string, fromUTCMS, toUTCMS int64, maxIdentities int) ([]HistorianQueryIdentity, error) {
	if c == nil {
		return nil, nil
	}
	selectedPoint := func(pointID string) bool {
		if len(selected) == 0 {
			return true
		}
		for _, candidate := range selected {
			if candidate == pointID {
				return true
			}
		}
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	identities := map[HistorianQueryIdentity]struct{}{}
	for _, rows := range c.rows {
		for _, row := range rows {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if row.ObservedUTCMS >= fromUTCMS && row.ObservedUTCMS < toUTCMS && selectedPoint(row.PointID) {
				identities[HistorianQueryIdentity{PointID: row.PointID, Generation: row.Generation}] = struct{}{}
				if maxIdentities > 0 && len(identities) > maxIdentities {
					return nil, fmt.Errorf("historian RAM identity limit exceeded")
				}
			}
		}
	}
	out := make([]HistorianQueryIdentity, 0, len(identities))
	for identity := range identities {
		out = append(out, identity)
	}
	return out, nil
}

func (c *HistorianRAMCache) RawHalfOpen(ctx context.Context, pointID string, generation uint64, fromUTCMS, toUTCMS int64, maxRows int) ([]HistorianRawSample, bool, error) {
	if c == nil {
		return nil, false, nil
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	rows := c.rows[historianIdentityKey(pointID, generation)]
	result := make([]HistorianRawSample, 0, len(rows))
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return result, false, err
		}
		if row.ObservedUTCMS >= fromUTCMS && row.ObservedUTCMS < toUTCMS {
			result = append(result, row)
			if maxRows > 0 && len(result) > maxRows {
				return result[:maxRows], true, nil
			}
		}
	}
	return result, false, nil
}

func (c *HistorianRAMCache) Coverage(identities []HistorianQueryIdentity) (int64, int64) {
	if c == nil || len(identities) == 0 {
		return 0, 0
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	var coverageFrom, coverageTo int64
	for index, identity := range identities {
		rows := c.rows[historianIdentityKey(identity.PointID, identity.Generation)]
		if len(rows) == 0 {
			return 0, 0
		}
		latest := rows[0]
		for _, row := range rows[1:] {
			if row.ObservedUTCMS > latest.ObservedUTCMS || (row.ObservedUTCMS == latest.ObservedUTCMS && row.IntervalMS < latest.IntervalMS) {
				latest = row
			}
		}
		from := latest.ObservedUTCMS - RAMRetentionMS
		to := latest.ObservedUTCMS + latest.IntervalMS
		if index == 0 || from > coverageFrom {
			coverageFrom = from
		}
		if index == 0 || to < coverageTo {
			coverageTo = to
		}
	}
	if coverageFrom < 0 {
		coverageFrom = 0
	}
	if coverageTo < coverageFrom {
		return 0, 0
	}
	return coverageFrom, coverageTo
}

type HistorianRAMCache struct {
	mu       sync.RWMutex
	maxBytes uint64
	rows     map[string][]HistorianRawSample
	bytes    uint64
}

func NewHistorianRAMCache(maxBytes uint64) (*HistorianRAMCache, error) {
	if maxBytes < RawSampleBytes || maxBytes > RAMMaxBytes {
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
	cutoff := sample.ObservedUTCMS - RAMRetentionMS
	first := 0
	for first < len(rows) && rows[first].ObservedUTCMS < cutoff {
		first++
	}
	nextRows := rows
	nextBytes := c.bytes
	if first > 0 {
		nextBytes -= uint64(first) * RawSampleBytes
		nextRows = append([]HistorianRawSample(nil), rows[first:]...)
	}
	for i := range nextRows {
		if nextRows[i].ObservedUTCMS == sample.ObservedUTCMS && nextRows[i].IntervalMS == sample.IntervalMS {
			c.rows[key] = nextRows
			c.bytes = nextBytes
			return nil
		}
	}
	if nextBytes+RawSampleBytes > c.maxBytes {
		return fmt.Errorf("historian RAM capacity exceeded")
	}
	c.rows[key] = append(nextRows, sample)
	c.bytes = nextBytes + RawSampleBytes
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

func FoldHot(rows []HistorianRawSample, policyRevision uint64) (HotSample, error) {
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
