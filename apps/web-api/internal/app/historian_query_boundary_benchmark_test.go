package app

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestHistorianQueryExact48HourHotArchiveBoundaryForEightSeries(t *testing.T) {
	store := openHistorianStoreTest(t)
	archiveDir := t.TempDir()
	pointIDs := historianEightSeriesPointIDs()
	asOfUTCMS := time.Date(2026, 7, 24, 0, 0, 0, 0, time.UTC).UnixMilli()
	hotBoundary := asOfUTCMS - 48*60*60*1000
	archiveOrigin := hotBoundary - 24*60*60*1000
	mirrorHistorianEightSeriesPolicy(t, store, archiveOrigin)

	var hot []HotSample
	for index, pointID := range pointIDs {
		oldBlock := historianArchiveCoverageBlock(pointID, 1, archiveOrigin, []ArchiveRow{{
			BucketUTCMS: hotBoundary - archiveBucketMS,
			Value:       float64(10 + index), Min: float64(10 + index), Max: float64(10 + index),
			Sum: float64(10 + index), Count: 1, Source: "archive",
		}})
		if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, oldBlock, archiveOrigin); err != nil {
			t.Fatalf("commit old archive block for %s: %v", pointID, err)
		}
		newBlock := historianArchiveCoverageBlock(pointID, 1, hotBoundary, []ArchiveRow{
			{BucketUTCMS: hotBoundary, Value: float64(100 + index), Min: float64(100 + index), Max: float64(100 + index), Sum: float64(100 + index), Count: 1, Source: "archive"},
			{BucketUTCMS: hotBoundary + archiveBucketMS, Value: float64(101 + index), Min: float64(101 + index), Max: float64(101 + index), Sum: float64(101 + index), Count: 1, Source: "archive"},
			// This row is exactly at the exclusive query end and must not leak.
			{BucketUTCMS: hotBoundary + 2*archiveBucketMS, Value: float64(102 + index), Min: float64(102 + index), Max: float64(102 + index), Sum: float64(102 + index), Count: 1, Source: "archive"},
		})
		if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, newBlock, archiveOrigin); err != nil {
			t.Fatalf("commit boundary archive block for %s: %v", pointID, err)
		}
		for offset, value := range []float64{float64(200 + index), float64(201 + index), float64(202 + index)} {
			bucket := hotBoundary + int64(offset)*archiveBucketMS
			hot = append(hot, HotSample{
				PointID: pointID, Generation: 1, BucketUTCMS: bucket, LastSampleUTCMS: bucket,
				Value: value, Min: value, Max: value, Sum: value, Count: 1,
				Source: "hot", PolicyRevision: 1,
			})
		}
	}
	if err := store.InsertHotBatch(context.Background(), hot); err != nil {
		t.Fatal(err)
	}
	ram, err := NewHistorianRAMCache(historianRAMMaxBytes)
	if err != nil {
		t.Fatal(err)
	}
	backend := openHistorianQueryStoreBackendTest(t, store, ram, archiveDir)
	engine := NewHistorianQueryEngine(backend)
	fromUTCMS := hotBoundary - archiveBucketMS
	toUTCMS := hotBoundary + 2*archiveBucketMS
	result, err := engine.Query(context.Background(), HistorianQueryRequest{
		PointIDs: pointIDs, FromUTCMS: fromUTCMS, ToUTCMS: toUTCMS, Resolution: "15s", MaxPoints: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Complete || len(result.Series) != len(pointIDs) {
		t.Fatalf("boundary result incomplete or missing series: complete=%v series=%d gaps=%+v", result.Complete, len(result.Series), result.Gaps)
	}
	if len(result.TiersUsed) != 2 || result.TiersUsed[0] != HistorianTierHot || result.TiersUsed[1] != HistorianTierArchive {
		t.Fatalf("tiersUsed=%v", result.TiersUsed)
	}
	for index, series := range result.Series {
		if series.PointID != pointIDs[index] || series.Generation != 1 || len(series.Samples) != 3 {
			t.Fatalf("series %s=%+v", pointIDs[index], series)
		}
		old := series.Samples[0]
		if old.TimeUTCMS != fromUTCMS || old.Value != float64(10+index) || old.Tier != HistorianTierArchive {
			t.Fatalf("archive boundary sample for %s=%+v", series.PointID, old)
		}
		boundary := series.Samples[1]
		if boundary.TimeUTCMS != hotBoundary || boundary.Value != float64(200+index) || boundary.Tier != HistorianTierHot || boundary.Count != 1 || boundary.Source != "hot" {
			t.Fatalf("hot overlap/dedupe sample for %s=%+v", series.PointID, boundary)
		}
		latest := series.Samples[2]
		if latest.TimeUTCMS != hotBoundary+archiveBucketMS || latest.Value != float64(201+index) || latest.Tier != HistorianTierHot || latest.Count != 1 || latest.Source != "hot" {
			t.Fatalf("hot overlap/dedupe sample at second bucket for %s=%+v", series.PointID, latest)
		}
	}
}

func BenchmarkHistorianQueryEightSeries24hAuto(b *testing.B) {
	ctx := context.Background()
	pointIDs := historianEightSeriesPointIDs()
	queryFrom := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC).UnixMilli()
	queryTo := queryFrom + 24*60*60*1000
	archiveStart := queryFrom - 12*60*60*1000

	b.StopTimer()
	store, err := OpenHistorianStore(filepath.Join(b.TempDir(), "historian-v2.sqlite"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = store.Close() })
	archiveDir := b.TempDir()
	mirrorHistorianEightSeriesPolicy(b, store, archiveStart)
	for index, pointID := range pointIDs {
		archiveRows := make([]ArchiveRow, archiveMaxRows)
		for slot := range archiveRows {
			bucket := archiveStart + int64(slot)*archiveBucketMS
			value := float64(index) + float64(slot%100)/100
			archiveRows[slot] = ArchiveRow{BucketUTCMS: bucket, Value: value, Min: value, Max: value, Sum: value, Count: 1, Source: "archive"}
		}
		if _, err := store.CommitArchiveBlock(ctx, archiveDir, ArchiveBlock{PointID: pointID, Generation: 1, StartUTCMS: archiveStart, StableCutoffUTCMS: archiveStart + archiveDayMS, Rows: archiveRows}, archiveStart); err != nil {
			b.Fatalf("commit archive block for %s: %v", pointID, err)
		}
	}
	hot := make([]HotSample, 0, len(pointIDs)*int((queryTo-queryFrom)/archiveBucketMS))
	for index, pointID := range pointIDs {
		for bucket := queryFrom; bucket < queryTo; bucket += archiveBucketMS {
			value := float64(100+index) + float64((bucket-queryFrom)/archiveBucketMS%100)/100
			hot = append(hot, HotSample{
				PointID: pointID, Generation: 1, BucketUTCMS: bucket, LastSampleUTCMS: bucket,
				Value: value, Min: value, Max: value, Sum: value, Count: 1,
				Source: "hot", PolicyRevision: 1,
			})
		}
	}
	for start := 0; start < len(hot); start += historianHotBatchLimit {
		end := min(start+historianHotBatchLimit, len(hot))
		if err := store.InsertHotBatch(ctx, hot[start:end]); err != nil {
			b.Fatal(err)
		}
	}
	ram, err := NewHistorianRAMCache(historianRAMMaxBytes)
	if err != nil {
		b.Fatal(err)
	}
	backend, err := NewHistorianQueryStoreBackend(store, ram, archiveDir)
	if err != nil {
		b.Fatal(err)
	}
	engine := NewHistorianQueryEngine(backend)
	request := HistorianQueryRequest{PointIDs: pointIDs, FromUTCMS: queryFrom, ToUTCMS: queryTo, Resolution: "auto", MaxPoints: historianQueryDefaultMaxPoints}
	warmup, err := engine.Query(ctx, request)
	if err != nil {
		b.Fatal(err)
	}
	if !warmup.Complete || warmup.Resolution != "30s" || len(warmup.Series) != len(pointIDs) || len(warmup.Series[0].Samples) != 2880 {
		b.Fatalf("unexpected 8-series/24h/auto workload shape: resolution=%s complete=%v series=%d firstSamples=%d", warmup.Resolution, warmup.Complete, len(warmup.Series), len(warmup.Series[0].Samples))
	}
	b.ReportAllocs()
	b.ResetTimer()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		result, err := engine.Query(ctx, request)
		if err != nil {
			b.Fatal(err)
		}
		if len(result.Series) != len(pointIDs) {
			b.Fatalf("query returned %d series, want %d", len(result.Series), len(pointIDs))
		}
	}
}

func historianEightSeriesPointIDs() []string {
	return []string{"UI-01", "UI-02", "UI-03", "UI-04", "UI-05", "UI-06", "UI-07", "UI-08"}
}

func mirrorHistorianEightSeriesPolicy(tb testing.TB, store *HistorianStore, startUTCMS int64) {
	tb.Helper()
	startAtUTC := time.UnixMilli(startUTCMS).UTC().Format(time.RFC3339)
	points := make([]string, 0, 8)
	for _, pointID := range historianEightSeriesPointIDs() {
		points = append(points, fmt.Sprintf(`{"pointId":"%s","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"%s"}`, pointID, startAtUTC))
	}
	config := []byte(fmt.Sprintf(`{"_schema_version":1,"revision":1,"historian_budget_bytes":2147483648,"wal_reserve_bytes":134217728,"migration_reserve_bytes":268435456,"required_free_space_bytes":536870912,"points":[%s]}`, strings.Join(points, ",")))
	if err := store.MirrorPolicy(context.Background(), config, 1, uint64(startUTCMS)); err != nil {
		tb.Fatalf("mirror eight-series policy: %v", err)
	}
}

func historianArchiveCoverageBlock(pointID string, generation uint64, startUTCMS int64, rows []ArchiveRow) ArchiveBlock {
	ordered := append([]ArchiveRow(nil), rows...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].BucketUTCMS < ordered[j].BucketUTCMS })
	gaps := make([]ArchiveGap, 0, len(ordered)+1)
	cursor := startUTCMS
	for _, row := range ordered {
		if cursor < row.BucketUTCMS {
			gaps = append(gaps, ArchiveGap{FromUTCMS: cursor, ToUTCMS: row.BucketUTCMS, Reason: "snapshot", Detail: "verified empty"})
		}
		cursor = row.BucketUTCMS + archiveBucketMS
	}
	end := startUTCMS + archiveDayMS
	if cursor < end {
		gaps = append(gaps, ArchiveGap{FromUTCMS: cursor, ToUTCMS: end, Reason: "snapshot", Detail: "verified empty"})
	}
	return ArchiveBlock{PointID: pointID, Generation: generation, StartUTCMS: startUTCMS, StableCutoffUTCMS: end, Rows: ordered, Gaps: gaps}
}
