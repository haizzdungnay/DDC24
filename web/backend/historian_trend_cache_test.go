package main

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestHistorianTrendCacheWarmsOnlyLast24HoursAndDoesNotReadThrough(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	now := int64(1_800_000_000_000)
	inside := historianTrendCacheTestRow(now-15_000, 1)
	outside := historianTrendCacheTestRow(now-historianTrendCacheRetentionMS-15_000, 2)
	if err := store.InsertHotBatch(context.Background(), []HotSample{outside, inside}); err != nil {
		t.Fatal(err)
	}
	cache := NewHistorianTrendCache()
	if err := cache.Warm(context.Background(), store, now); err != nil {
		t.Fatal(err)
	}
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	read := cache.Read([]HistorianQueryIdentity{identity}, now-historianTrendCacheRetentionMS, now)
	if !read.Available || len(read.Rows) != 1 || read.Rows[0].Value != 1 || read.Rows[0].Tier != HistorianTierCache {
		t.Fatalf("unexpected warmed cache: %#v", read)
	}

	databaseOnly := historianTrendCacheTestRow(now-30_000, 3)
	if err := store.InsertHotBatch(context.Background(), []HotSample{databaseOnly}); err != nil {
		t.Fatal(err)
	}
	read = cache.Read([]HistorianQueryIdentity{identity}, now-historianTrendCacheRetentionMS, now)
	if len(read.Rows) != 1 {
		t.Fatalf("cache performed an implicit database read-through: %#v", read.Rows)
	}
}

func TestHistorianCachingSinkPublishesOnlyDurableRows(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	cache := NewHistorianTrendCache()
	if err := cache.Warm(context.Background(), store, 1_800_000_000_000); err != nil {
		t.Fatal(err)
	}
	sink := historianCachingSink{store: store, cache: cache}
	row := historianTrendCacheTestRow(1_799_999_985_000, 7)
	if err := sink.InsertHotBatch(context.Background(), []HotSample{row}); err != nil {
		t.Fatal(err)
	}
	read := cache.Read([]HistorianQueryIdentity{{PointID: "UI-01", Generation: 1}}, row.BucketUTCMS, row.BucketUTCMS+15_000)
	if len(read.Rows) != 1 || read.Rows[0].Value != 7 {
		t.Fatalf("committed row missing from cache: %#v", read.Rows)
	}
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM hot_samples WHERE point_id='UI-01' AND generation=1 AND bucket_utc_ms=?`, row.BucketUTCMS).Scan(&count); err != nil || count != 1 {
		t.Fatalf("cache row was not durable first: count=%d err=%v", count, err)
	}
}

func TestHistorianTrendCacheRuntimeSnapshotIncludesPointsWithoutDatabasePolicy(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store) // The mirrored database policy contains UI-01 only.
	cache := NewHistorianTrendCache()
	now := time.Date(2026, 7, 22, 6, 12, 15, 0, time.UTC)
	if err := cache.Warm(context.Background(), store, now.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	snapshot := RuntimePointSnapshot{
		SnapshotObservedAtUTC: now.Format(time.RFC3339Nano),
		CapturedMonotonicNs:   15_000_000_000,
		Points: []RuntimePoint{
			{ID: "UI-01", Kind: "UI", Value: 40.1, Quality: "GOOD", Source: "io", Role: "engineering_value", Generation: 1},
			{ID: "UI-02", Kind: "UI", Value: 12.2, Quality: "GOOD", Source: "io", Role: "engineering_value", Generation: 1},
			{ID: "UI-06", Kind: "UI", Value: 5.4, Quality: "GOOD", Source: "io", Role: "engineering_value", Generation: 1},
		},
	}
	if err := cache.AppendSnapshot(snapshot); err != nil {
		t.Fatal(err)
	}

	backend := openHistorianQueryStoreBackendTest(t, store, nil, t.TempDir())
	backend.trendCache = cache
	engine := NewHistorianQueryEngine(backend)
	result, err := engine.Query(context.Background(), HistorianQueryRequest{
		PointIDs: []string{"UI-01", "UI-02", "UI-06"}, FromUTCMS: now.UnixMilli(), ToUTCMS: now.Add(15 * time.Second).UnixMilli(),
		Resolution: "auto", MaxPoints: 10, Source: "cache",
	})
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, len(result.Series))
	for _, series := range result.Series {
		if len(series.Samples) != 1 || series.Samples[0].Tier != HistorianTierCache {
			t.Fatalf("point %s cache samples=%+v", series.PointID, series.Samples)
		}
		got = append(got, series.PointID)
	}
	if want := []string{"UI-01", "UI-02", "UI-06"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("cache series=%v want=%v", got, want)
	}
	databaseResult, err := engine.Query(context.Background(), HistorianQueryRequest{
		PointIDs: []string{"UI-01", "UI-02", "UI-06"}, FromUTCMS: now.UnixMilli(), ToUTCMS: now.Add(15 * time.Second).UnixMilli(),
		Resolution: "auto", MaxPoints: 10, Source: "database",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(databaseResult.Series) != 1 || databaseResult.Series[0].PointID != "UI-01" || len(databaseResult.Series[0].Samples) != 0 {
		t.Fatalf("database source leaked runtime-only cache identities: %+v", databaseResult.Series)
	}
}

func TestHistorianRAMBudgetsRemainBoundedAt64MiB(t *testing.T) {
	if historianRawRAMBudget+historianTrendCacheMaxBytes != historianRAMMaxBytes {
		t.Fatalf("historian RAM budget raw=%d cache=%d max=%d", historianRawRAMBudget, historianTrendCacheMaxBytes, historianRAMMaxBytes)
	}
}

func historianTrendCacheTestRow(bucketUTCMS int64, value float64) HotSample {
	return HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: bucketUTCMS, LastSampleUTCMS: bucketUTCMS + 1_000, Value: value, Min: value, Max: value, Sum: value, Count: 1, Source: "runtime", PolicyRevision: 1}
}
