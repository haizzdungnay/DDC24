package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHistorianQueryStoreRAMIsHalfOpenBoundedAndGenerationAware(t *testing.T) {
	store := openHistorianStoreTest(t)
	ram, err := NewHistorianRAMCache(16 * historianRawSampleBytes)
	if err != nil {
		t.Fatal(err)
	}
	for _, sample := range []HistorianRawSample{
		{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: 1000, Value: 1, Source: "io"},
		{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: 2000, Value: 2, Source: "io"},
		{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: 3000, Value: 3, Source: "io"},
		{PointID: "UI-01", Generation: 2, IntervalMS: 1000, ObservedUTCMS: 3000, Value: 30, Source: "io"},
	} {
		if err := ram.Append(sample); err != nil {
			t.Fatal(err)
		}
	}
	backend := openHistorianQueryStoreBackendTest(t, store, ram, t.TempDir())
	identities, err := backend.Identities(context.Background(), []string{"UI-01"}, 1000, 3000, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(identities) != 1 || identities[0] != (HistorianQueryIdentity{PointID: "UI-01", Generation: 1}) {
		t.Fatalf("identities=%+v", identities)
	}
	read, err := backend.ReadTier(context.Background(), HistorianTierRAM, identities, 1000, 3000)
	if err != nil {
		t.Fatal(err)
	}
	if !read.Available || len(read.Rows) != 2 || read.Rows[0].BucketUTCMS != 1000 || read.Rows[1].BucketUTCMS != 2000 {
		t.Fatalf("read=%+v", read)
	}
	if read.CoverageFromUTCMS != 0 || read.CoverageToUTCMS != 4000 {
		t.Fatalf("coverage=[%d,%d)", read.CoverageFromUTCMS, read.CoverageToUTCMS)
	}
	if read.Rows[0].Count != 1 || read.Rows[0].Tier != HistorianTierRAM {
		t.Fatalf("raw normalization=%+v", read.Rows[0])
	}
	missing, err := backend.ReadTier(context.Background(), HistorianTierRAM, []HistorianQueryIdentity{{PointID: "UI-01", Generation: 1}, {PointID: "UI-01", Generation: 3}}, 1000, 3000)
	if err != nil {
		t.Fatal(err)
	}
	if missing.CoverageFromUTCMS != 0 || missing.CoverageToUTCMS != 0 {
		t.Fatalf("RAM claimed common coverage for a missing identity: %+v", missing)
	}
}

func TestHistorianQueryStoreHotReadsHalfOpenGenerationAndClampedGaps(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianQueryStorePolicy(t, store)
	hot := []HotSample{
		{PointID: "UI-01", Generation: 1, BucketUTCMS: 15000, LastSampleUTCMS: 16000, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io", PolicyRevision: 1},
		{PointID: "UI-01", Generation: 1, BucketUTCMS: 30000, LastSampleUTCMS: 31000, Value: 2, Min: 2, Max: 2, Sum: 2, Count: 1, Source: "io", PolicyRevision: 1},
		{PointID: "UI-01", Generation: 2, BucketUTCMS: 15000, LastSampleUTCMS: 16000, Value: 20, Min: 20, Max: 20, Sum: 20, Count: 1, Source: "io", PolicyRevision: 1},
	}
	if err := store.InsertHotBatch(context.Background(), hot); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertGap(context.Background(), HistoryGap{PointID: "UI-01", Generation: 1, FromUTCMS: 10000, ToUTCMS: 20000, Reason: "storage", Detail: "offline", CreatedAtUTCMS: time.Now().UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	backend := openHistorianQueryStoreBackendTest(t, store, nil, t.TempDir())
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	read, err := backend.ReadTier(context.Background(), HistorianTierHot, []HistorianQueryIdentity{identity}, 15000, 30000)
	if err != nil {
		t.Fatal(err)
	}
	if len(read.Rows) != 1 || read.Rows[0].Generation != 1 || read.Rows[0].BucketUTCMS != 15000 || read.Rows[0].Tier != HistorianTierHot {
		t.Fatalf("rows=%+v", read.Rows)
	}
	if len(read.Gaps) != 1 || read.Gaps[0].FromUTCMS != 15000 || read.Gaps[0].ToUTCMS != 20000 || read.Gaps[0].Reason != "sqlite" {
		t.Fatalf("gaps=%+v", read.Gaps)
	}
	identities, err := backend.Identities(context.Background(), []string{"UI-01"}, 15000, 30000, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(identities) != 3 || identities[0].Generation != 1 || identities[1].Generation != 2 || identities[2].Generation != 3 {
		t.Fatalf("identities=%+v", identities)
	}
}

func TestHistorianQueryStoreEnforcesTierReadLimitWithoutUnboundedGrowth(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianQueryStorePolicy(t, store)
	if err := store.InsertHotBatch(context.Background(), []HotSample{
		{PointID: "UI-01", Generation: 1, BucketUTCMS: 15000, LastSampleUTCMS: 16000, Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, Source: "io", PolicyRevision: 1},
		{PointID: "UI-01", Generation: 1, BucketUTCMS: 30000, LastSampleUTCMS: 31000, Value: 2, Min: 2, Max: 2, Sum: 2, Count: 1, Source: "io", PolicyRevision: 1},
	}); err != nil {
		t.Fatal(err)
	}
	backend := openHistorianQueryStoreBackendTest(t, store, nil, t.TempDir())
	backend.maxRows = 1
	read, err := backend.ReadTier(context.Background(), HistorianTierHot, []HistorianQueryIdentity{{PointID: "UI-01", Generation: 1}}, 15000, 45000)
	if !errors.Is(err, ErrHistorianQueryReadLimit) {
		t.Fatalf("err=%v", err)
	}
	if !read.Available || len(read.Rows)+len(read.Gaps) > 1 {
		t.Fatalf("read exceeded bound: %+v", read)
	}
}

func TestHistorianQueryStoreArchiveRetainsGoodBlocksAndReportsCorruption(t *testing.T) {
	store := openHistorianStoreTest(t)
	archiveDir := t.TempDir()
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	firstPath, err := store.CommitArchiveBlock(context.Background(), archiveDir, historianQueryStoreCoveredBlock("UI-01", 1, start, 1), start)
	if err != nil {
		t.Fatal(err)
	}
	secondPath, err := store.CommitArchiveBlock(context.Background(), archiveDir, historianQueryStoreCoveredBlock("UI-01", 1, start+archiveDayMS, 2), start)
	if err != nil {
		t.Fatal(err)
	}
	if firstPath == secondPath {
		t.Fatal("archive blocks unexpectedly share a path")
	}
	data, err := os.ReadFile(secondPath)
	if err != nil {
		t.Fatal(err)
	}
	data[archiveHeaderSize] ^= 0xff
	if err := os.WriteFile(secondPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	backend := openHistorianQueryStoreBackendTest(t, store, nil, archiveDir)
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	read, readErr := backend.ReadTier(context.Background(), HistorianTierArchive, []HistorianQueryIdentity{identity}, start, start+2*archiveDayMS)
	var archiveErr *HistorianArchiveReadError
	if !errors.As(readErr, &archiveErr) || len(archiveErr.Issues) != 1 {
		t.Fatalf("err=%v issues=%+v", readErr, archiveErr)
	}
	if !read.Available || len(read.Rows) != 1 || read.Rows[0].Value != 1 || read.Rows[0].Tier != HistorianTierArchive || len(read.Gaps) != 1 || read.Gaps[0].Reason != "runtime" {
		t.Fatalf("usable archive data lost: %+v", read)
	}
	if read.CoverageFromUTCMS != start || read.CoverageToUTCMS != start+2*archiveDayMS {
		t.Fatalf("coverage=[%d,%d)", read.CoverageFromUTCMS, read.CoverageToUTCMS)
	}
	frontiers, err := backend.Frontiers(context.Background(), []HistorianQueryIdentity{identity})
	if err != nil || len(frontiers) != 1 || !frontiers[0].HasArchive || frontiers[0].ArchiveCoveredUntilUTCMS != start+2*archiveDayMS {
		t.Fatalf("frontiers=%+v err=%v", frontiers, err)
	}
}

func TestHistorianQueryStoreArchiveDoesNotCrossContiguousWatermark(t *testing.T) {
	store := openHistorianStoreTest(t)
	archiveDir := t.TempDir()
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, historianQueryStoreCoveredBlock("UI-01", 1, start+archiveDayMS, 2), start); err != nil {
		t.Fatal(err)
	}
	backend := openHistorianQueryStoreBackendTest(t, store, nil, archiveDir)
	read, err := backend.ReadTier(context.Background(), HistorianTierArchive, []HistorianQueryIdentity{identity}, start+archiveDayMS, start+2*archiveDayMS)
	if err != nil {
		t.Fatal(err)
	}
	if len(read.Rows) != 0 || len(read.Gaps) != 0 || read.CoverageToUTCMS != 0 {
		t.Fatalf("query crossed watermark: %+v", read)
	}
	if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, historianQueryStoreCoveredBlock("UI-01", 1, start, 1), start); err != nil {
		t.Fatal(err)
	}
	read, err = backend.ReadTier(context.Background(), HistorianTierArchive, []HistorianQueryIdentity{identity}, start+archiveDayMS, start+2*archiveDayMS)
	if err != nil || len(read.Rows) != 1 || read.Rows[0].Value != 2 {
		t.Fatalf("contiguous block unavailable: read=%+v err=%v", read, err)
	}
}

func TestHistorianQueryStoreRejectsArchivePathEscapeAsPartialFailure(t *testing.T) {
	store := openHistorianStoreTest(t)
	archiveDir := t.TempDir()
	start := time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC).UnixMilli()
	if _, err := store.CommitArchiveBlock(context.Background(), archiveDir, historianQueryStoreCoveredBlock("UI-01", 1, start, 1), start); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`UPDATE archive_blocks SET file_name='../escape.mkhab'`); err == nil {
		// UNIQUE and CHECK constraints intentionally do not validate paths; the query reader must.
	} else {
		t.Fatal(err)
	}
	backend := openHistorianQueryStoreBackendTest(t, store, nil, archiveDir)
	read, err := backend.ReadTier(context.Background(), HistorianTierArchive, []HistorianQueryIdentity{{PointID: "UI-01", Generation: 1}}, start, start+archiveDayMS)
	if err == nil || read.Available {
		t.Fatalf("unsafe archive metadata accepted: available=%v err=%v", read.Available, err)
	}
}

func openHistorianQueryStoreBackendTest(t *testing.T, store *HistorianStore, ram *HistorianRAMCache, archiveDir string) *HistorianQueryStoreBackend {
	t.Helper()
	backend, err := NewHistorianQueryStoreBackend(store, ram, archiveDir)
	if err != nil {
		t.Fatal(err)
	}
	return backend
}

func mirrorHistorianQueryStorePolicy(t *testing.T, store *HistorianStore) {
	t.Helper()
	config := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"1970-01-01T00:00:01Z"},{"pointId":"UI-01","generation":2,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"1970-01-01T00:00:01Z"},{"pointId":"UI-01","generation":3,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"1970-01-01T00:00:01Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 0, 1); err != nil {
		t.Fatal(err)
	}
}

func historianQueryStoreCoveredBlock(pointID string, generation uint64, start int64, value float64) ArchiveBlock {
	return ArchiveBlock{
		PointID: pointID, Generation: generation, StartUTCMS: start, StableCutoffUTCMS: start + archiveDayMS,
		Rows: []ArchiveRow{{BucketUTCMS: start, Value: value, Min: value, Max: value, Sum: value, Count: 1, Source: "io"}},
		Gaps: []ArchiveGap{{FromUTCMS: start + archiveBucketMS, ToUTCMS: start + archiveDayMS, Reason: "snapshot", Detail: "verified empty"}},
	}
}

func TestHistorianQueryStoreConstructorRequiresDurableStore(t *testing.T) {
	if _, err := NewHistorianQueryStoreBackend(nil, nil, filepath.Join(t.TempDir(), "archive")); err == nil {
		t.Fatal("expected missing store error")
	}
}
