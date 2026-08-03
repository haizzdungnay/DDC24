package app

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"sync"
	"time"
)

const (
	historianTrendCacheMaxBytes = uint64(48 << 20)
	historianTrendCacheRowBytes = uint64(192)
	historianTrendCacheGapBytes = uint64(256)
)

// HistorianTrendCache stores the durable 15-second presentation layer used by
// the Trends presets. Raw 1/3/5-second samples remain in the separate RAM tail.
type HistorianTrendCache struct {
	mu          sync.RWMutex
	rows        map[string][]HotSample
	gaps        map[string][]HistoryGap
	bytes       uint64
	newestUTCMS int64
	lastPruneMS int64
	initialized bool
}

func NewHistorianTrendCache() *HistorianTrendCache {
	return &HistorianTrendCache{rows: map[string][]HotSample{}, gaps: map[string][]HistoryGap{}}
}

func (c *HistorianTrendCache) Warm(ctx context.Context, store *HistorianStore, nowUTCMS int64) error {
	if c == nil || store == nil || store.db == nil || nowUTCMS <= 0 {
		return fmt.Errorf("invalid historian trend cache warmup")
	}
	cutoff := nowUTCMS - historianTrendCacheRetentionMS
	rows, err := store.db.QueryContext(ctx, `SELECT point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision
		FROM hot_samples WHERE bucket_utc_ms>=? AND bucket_utc_ms<? ORDER BY bucket_utc_ms,point_id,generation`, cutoff, nowUTCMS)
	if err != nil {
		return fmt.Errorf("warm historian trend cache rows: %w", err)
	}
	var hot []HotSample
	for rows.Next() {
		var row HotSample
		if err := rows.Scan(&row.PointID, &row.Generation, &row.BucketUTCMS, &row.LastSampleUTCMS, &row.Value, &row.Min, &row.Max, &row.Sum, &row.Count, &row.WorstQuality, &row.Source, &row.PolicyRevision); err != nil {
			rows.Close()
			return fmt.Errorf("scan historian trend cache row: %w", err)
		}
		hot = append(hot, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("read historian trend cache rows: %w", err)
	}
	rows.Close()

	gapRows, err := store.db.QueryContext(ctx, `SELECT point_id,generation,from_utc_ms,to_utc_ms,reason,detail,policy_revision,created_at_utc_ms
		FROM history_gaps WHERE from_utc_ms<? AND to_utc_ms>? ORDER BY from_utc_ms,point_id,generation`, nowUTCMS, cutoff)
	if err != nil {
		return fmt.Errorf("warm historian trend cache gaps: %w", err)
	}
	var gaps []HistoryGap
	for gapRows.Next() {
		var gap HistoryGap
		var revision sql.NullInt64
		if err := gapRows.Scan(&gap.PointID, &gap.Generation, &gap.FromUTCMS, &gap.ToUTCMS, &gap.Reason, &gap.Detail, &revision, &gap.CreatedAtUTCMS); err != nil {
			gapRows.Close()
			return fmt.Errorf("scan historian trend cache gap: %w", err)
		}
		if revision.Valid {
			value := uint64(revision.Int64)
			gap.PolicyRevision = &value
		}
		gaps = append(gaps, gap)
	}
	if err := gapRows.Err(); err != nil {
		gapRows.Close()
		return fmt.Errorf("read historian trend cache gaps: %w", err)
	}
	gapRows.Close()

	c.mu.Lock()
	c.rows, c.gaps, c.bytes = map[string][]HotSample{}, map[string][]HistoryGap{}, 0
	c.newestUTCMS, c.lastPruneMS, c.initialized = nowUTCMS, nowUTCMS, true
	for _, row := range hot {
		c.upsertHotLocked(row)
	}
	for _, gap := range gaps {
		c.upsertGapLocked(gap)
	}
	c.evictLocked()
	c.mu.Unlock()
	return nil
}

func (c *HistorianTrendCache) AppendHot(rows []HotSample) {
	if c == nil || len(rows) == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, row := range rows {
		if row.PointID == "" || row.Generation == 0 || row.Count <= 0 {
			continue
		}
		c.upsertHotLocked(row)
		if covered := row.BucketUTCMS + 15000; covered > c.newestUTCMS {
			c.newestUTCMS = covered
		}
	}
	c.initialized = true
	c.pruneLocked()
	c.evictLocked()
}

func (c *HistorianTrendCache) AppendGap(gap HistoryGap) {
	if c == nil || gap.PointID == "" || gap.Generation == 0 || gap.ToUTCMS <= gap.FromUTCMS {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.upsertGapLocked(gap)
	if gap.ToUTCMS > c.newestUTCMS {
		c.newestUTCMS = gap.ToUTCMS
	}
	c.initialized = true
	c.pruneLocked()
	c.evictLocked()
}

// AppendSnapshot records the all-point runtime presentation layer without
// requiring a database logging policy for the point.
func (c *HistorianTrendCache) AppendSnapshot(snapshot RuntimePointSnapshot) error {
	if c == nil {
		return nil
	}
	observed, err := time.Parse(time.RFC3339Nano, snapshot.SnapshotObservedAtUTC)
	if err != nil || observed.Location() != time.UTC || snapshot.CapturedMonotonicNs == 0 {
		return fmt.Errorf("invalid historian trend cache snapshot")
	}
	observedUTCMS := observed.UnixMilli()
	bucketUTCMS := floorHistorianBoundary(observedUTCMS, 15000)
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, point := range snapshot.Points {
		if point.ID == "" || point.Generation == 0 || canonicalHistoryPointID(point.ID) != point.ID {
			continue
		}
		prefix, _, ok := parsePointID(point.ID)
		if !ok || (prefix != "UI" && prefix != "AO" && prefix != "DO" && prefix != "VP") {
			continue
		}
		value, numeric := numericPointValue(point.Value)
		quality, qualityOK := historianQuality(point.Quality)
		if !numeric || !qualityOK || point.Source == "" || !historianRuntimePointRoleAllowed(prefix, point.Role) {
			continue
		}
		row := HotSample{
			PointID: point.ID, Generation: point.Generation, BucketUTCMS: bucketUTCMS, LastSampleUTCMS: observedUTCMS,
			Value: value, Min: value, Max: value, Sum: value, Count: 1, WorstQuality: quality, Source: point.Source,
		}
		c.upsertRuntimeLocked(row)
	}
	if covered := bucketUTCMS + 15000; covered > c.newestUTCMS {
		c.newestUTCMS = covered
	}
	c.initialized = true
	c.pruneLocked()
	c.evictLocked()
	return nil
}

func historianRuntimePointRoleAllowed(prefix, role string) bool {
	switch prefix {
	case "AO":
		return role == "resolved_setpoint"
	case "DO":
		return role == "hardware_feedback"
	case "VP":
		return role == "runtime_value"
	default:
		return true
	}
}

func (c *HistorianTrendCache) Read(identities []HistorianQueryIdentity, fromUTCMS, toUTCMS int64) HistorianTierRead {
	read := HistorianTierRead{Tier: HistorianTierCache}
	if c == nil {
		return read
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	read.Available = c.initialized
	read.CoverageFromUTCMS = max(int64(0), c.newestUTCMS-historianTrendCacheRetentionMS)
	read.CoverageToUTCMS = c.newestUTCMS
	for _, identity := range identities {
		key := historianIdentityKey(identity.PointID, identity.Generation)
		for _, row := range c.rows[key] {
			if row.BucketUTCMS >= fromUTCMS && row.BucketUTCMS < toUTCMS {
				read.Rows = append(read.Rows, HistorianAggregateRow{PointID: row.PointID, Generation: row.Generation, BucketUTCMS: row.BucketUTCMS, LastSampleUTCMS: row.LastSampleUTCMS, Value: row.Value, Min: row.Min, Max: row.Max, Sum: row.Sum, Count: row.Count, Quality: row.WorstQuality, Source: row.Source, Tier: HistorianTierCache})
			}
		}
		for _, gap := range c.gaps[key] {
			if gap.FromUTCMS < toUTCMS && gap.ToUTCMS > fromUTCMS {
				read.Gaps = append(read.Gaps, HistorianQueryGap{PointID: gap.PointID, Generation: gap.Generation, FromUTCMS: gap.FromUTCMS, ToUTCMS: gap.ToUTCMS, Reason: historianQueryGapReason(gap.Reason), Detail: gap.Detail})
			}
		}
	}
	return read
}

func (c *HistorianTrendCache) Identities(pointIDs []string, fromUTCMS, toUTCMS int64) []HistorianQueryIdentity {
	if c == nil {
		return nil
	}
	selected := make(map[string]struct{}, len(pointIDs))
	for _, pointID := range pointIDs {
		selected[pointID] = struct{}{}
	}
	identities := make(map[HistorianQueryIdentity]struct{})
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, rows := range c.rows {
		for _, row := range rows {
			if row.BucketUTCMS >= toUTCMS || row.BucketUTCMS+15000 <= fromUTCMS {
				continue
			}
			if len(selected) == 0 {
				identities[HistorianQueryIdentity{PointID: row.PointID, Generation: row.Generation}] = struct{}{}
			} else if _, ok := selected[row.PointID]; ok {
				identities[HistorianQueryIdentity{PointID: row.PointID, Generation: row.Generation}] = struct{}{}
			}
			break
		}
	}
	for _, gaps := range c.gaps {
		for _, gap := range gaps {
			if gap.FromUTCMS >= toUTCMS || gap.ToUTCMS <= fromUTCMS {
				continue
			}
			if len(selected) == 0 {
				identities[HistorianQueryIdentity{PointID: gap.PointID, Generation: gap.Generation}] = struct{}{}
			} else if _, ok := selected[gap.PointID]; ok {
				identities[HistorianQueryIdentity{PointID: gap.PointID, Generation: gap.Generation}] = struct{}{}
			}
			break
		}
	}
	result := make([]HistorianQueryIdentity, 0, len(identities))
	for identity := range identities {
		result = append(result, identity)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].PointID != result[j].PointID {
			return result[i].PointID < result[j].PointID
		}
		return result[i].Generation < result[j].Generation
	})
	return result
}

func (c *HistorianTrendCache) upsertHotLocked(row HotSample) {
	key := historianIdentityKey(row.PointID, row.Generation)
	rows := c.rows[key]
	index := sort.Search(len(rows), func(i int) bool { return rows[i].BucketUTCMS >= row.BucketUTCMS })
	if index < len(rows) && rows[index].BucketUTCMS == row.BucketUTCMS {
		rows[index] = row
		return
	}
	rows = append(rows, HotSample{})
	copy(rows[index+1:], rows[index:])
	rows[index] = row
	c.rows[key] = rows
	c.bytes += historianTrendCacheRowBytes
}

func (c *HistorianTrendCache) upsertRuntimeLocked(row HotSample) {
	key := historianIdentityKey(row.PointID, row.Generation)
	rows := c.rows[key]
	index := sort.Search(len(rows), func(i int) bool { return rows[i].BucketUTCMS >= row.BucketUTCMS })
	if index < len(rows) && rows[index].BucketUTCMS == row.BucketUTCMS {
		current := &rows[index]
		if row.LastSampleUTCMS >= current.LastSampleUTCMS {
			current.Value = row.Value
			current.LastSampleUTCMS = row.LastSampleUTCMS
		}
		if row.Min < current.Min {
			current.Min = row.Min
		}
		if row.Max > current.Max {
			current.Max = row.Max
		}
		current.Sum += row.Sum
		current.Count += row.Count
		if row.WorstQuality > current.WorstQuality {
			current.WorstQuality = row.WorstQuality
		}
		if current.Source != row.Source {
			current.Source = "mixed"
		}
		return
	}
	rows = append(rows, HotSample{})
	copy(rows[index+1:], rows[index:])
	rows[index] = row
	c.rows[key] = rows
	c.bytes += historianTrendCacheRowBytes
}

func (c *HistorianTrendCache) upsertGapLocked(gap HistoryGap) {
	key := historianIdentityKey(gap.PointID, gap.Generation)
	rows := c.gaps[key]
	index := sort.Search(len(rows), func(i int) bool {
		if rows[i].FromUTCMS != gap.FromUTCMS {
			return rows[i].FromUTCMS >= gap.FromUTCMS
		}
		return rows[i].ToUTCMS >= gap.ToUTCMS
	})
	if index < len(rows) && rows[index].FromUTCMS == gap.FromUTCMS && rows[index].ToUTCMS == gap.ToUTCMS && rows[index].Reason == gap.Reason && rows[index].Detail == gap.Detail {
		return
	}
	rows = append(rows, HistoryGap{})
	copy(rows[index+1:], rows[index:])
	rows[index] = gap
	c.gaps[key] = rows
	c.bytes += historianTrendCacheGapBytes
}

func (c *HistorianTrendCache) pruneLocked() {
	if c.newestUTCMS-c.lastPruneMS < 60_000 {
		return
	}
	cutoff := c.newestUTCMS - historianTrendCacheRetentionMS
	for key, rows := range c.rows {
		first := sort.Search(len(rows), func(i int) bool { return rows[i].BucketUTCMS >= cutoff })
		c.bytes -= uint64(first) * historianTrendCacheRowBytes
		if first == len(rows) {
			delete(c.rows, key)
		} else if first > 0 {
			c.rows[key] = append([]HotSample(nil), rows[first:]...)
		}
	}
	for key, gaps := range c.gaps {
		first := sort.Search(len(gaps), func(i int) bool { return gaps[i].ToUTCMS > cutoff })
		c.bytes -= uint64(first) * historianTrendCacheGapBytes
		if first == len(gaps) {
			delete(c.gaps, key)
		} else if first > 0 {
			c.gaps[key] = append([]HistoryGap(nil), gaps[first:]...)
		}
	}
	c.lastPruneMS = c.newestUTCMS
}

func (c *HistorianTrendCache) evictLocked() {
	for c.bytes > historianTrendCacheMaxBytes {
		var oldestKey string
		var oldestMS int64
		oldestGap := false
		found := false
		for key, rows := range c.rows {
			if len(rows) > 0 && (!found || rows[0].BucketUTCMS < oldestMS) {
				oldestKey, oldestMS, oldestGap, found = key, rows[0].BucketUTCMS, false, true
			}
		}
		for key, gaps := range c.gaps {
			if len(gaps) > 0 && (!found || gaps[0].ToUTCMS < oldestMS) {
				oldestKey, oldestMS, oldestGap, found = key, gaps[0].ToUTCMS, true, true
			}
		}
		if !found {
			c.bytes = 0
			return
		}
		if oldestGap {
			c.gaps[oldestKey] = c.gaps[oldestKey][1:]
			c.bytes -= historianTrendCacheGapBytes
		} else {
			c.rows[oldestKey] = c.rows[oldestKey][1:]
			c.bytes -= historianTrendCacheRowBytes
		}
	}
}

type historianCachingSink struct {
	store *HistorianStore
	cache *HistorianTrendCache
}

func (s historianCachingSink) InsertHotBatch(ctx context.Context, rows []HotSample) error {
	if err := s.store.InsertHotBatch(ctx, rows); err != nil {
		return err
	}
	s.cache.AppendHot(rows)
	return nil
}

func (s historianCachingSink) InsertGap(ctx context.Context, gap HistoryGap) error {
	if err := s.store.InsertGap(ctx, gap); err != nil {
		return err
	}
	s.cache.AppendGap(gap)
	return nil
}
