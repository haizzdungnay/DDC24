package app

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
)

func TestTrendStoreInsertQueryAndPrune(t *testing.T) {
	store := openTestTrendStore(t)
	defer store.Close()
	ctx := context.Background()

	base := int64(1_800_000_000)
	batch := []Sample{
		{TS: base, PointID: "AI-01", Value: 21.5, Quality: 0},
		{TS: base + 60, PointID: "AI-01", Value: 22.5, Quality: 0},
		{TS: base + 60, PointID: "AI-02", Value: 23.5, Quality: 1},
	}
	if err := store.InsertBatch(ctx, batch); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}
	got, err := store.Query(ctx, []string{"UI-01", "UI-02"}, base+1, base+120)
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("query len = %d; want 2 (%+v)", len(got), got)
	}
	if got[0].PointID != "AI-01" || got[0].Value != 22.5 || got[1].PointID != "AI-02" {
		t.Fatalf("query rows = %+v", got)
	}

	many := make([]Sample, 0, 3000)
	for i := 0; i < 1500; i++ {
		many = append(many,
			Sample{TS: base + int64(1000+i), PointID: "AI-01", Value: float64(i), Quality: 0},
			Sample{TS: base + int64(1000+i), PointID: "AI-02", Value: float64(i), Quality: 0},
		)
	}
	if err := store.InsertBatch(ctx, many); err != nil {
		t.Fatalf("InsertBatch many: %v", err)
	}
	if err := store.Prune(ctx, 1000); err != nil {
		t.Fatalf("Prune: %v", err)
	}
	for _, pointID := range []string{"AI-01", "AI-02"} {
		var count int
		if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM samples WHERE point_id = ?`, pointID).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", pointID, err)
		}
		if count > 1000 {
			t.Fatalf("count %s = %d; want <= 1000", pointID, count)
		}
	}
}

func TestTrendStoreConfigRoundTrip(t *testing.T) {
	store := openTestTrendStore(t)
	defer store.Close()
	ctx := context.Background()

	cfg, err := store.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig default: %v", err)
	}
	if !cfg.Enabled || cfg.IntervalS != 10 || cfg.RetentionRecords != 8640 || len(cfg.PointIDs) != 0 {
		t.Fatalf("default cfg = %+v", cfg)
	}

	want := TrendConfig{Enabled: true, PointIDs: []string{"AI-02", "AI-01", "AO1"}, IntervalS: 10, RetentionRecords: 1000}
	if _, err := store.SaveConfig(ctx, want); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	got, err := store.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if got.IntervalS != 10 || got.RetentionRecords != 1000 || len(got.PointIDs) != 3 || got.PointIDs[0] != "AO-01" || got.PointIDs[1] != "UI-01" || got.PointIDs[2] != "UI-02" {
		t.Fatalf("cfg = %+v", got)
	}
}

func TestTrendStoreQuiesceFencesAllLegacyWrites(t *testing.T) {
	store := openTestTrendStore(t)
	ctx := context.Background()
	if err := store.QuiesceWriters(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertBatch(ctx, []Sample{{TS: 1, PointID: "UI-01", Value: 1}}); !errors.Is(err, ErrLegacyHistorianQuiesced) {
		t.Fatalf("insert err=%v", err)
	}
	if _, err := store.SaveConfig(ctx, defaultTrendConfig()); !errors.Is(err, ErrLegacyHistorianQuiesced) {
		t.Fatalf("save config err=%v", err)
	}
	store.ResumeWriters()
	if err := store.InsertBatch(ctx, []Sample{{TS: 1, PointID: "UI-01", Value: 1}}); err != nil {
		t.Fatalf("resume insert: %v", err)
	}
}

func TestTrendStoreSerializesConcurrentLegacyWriters(t *testing.T) {
	store := openTestTrendStore(t)
	ctx := context.Background()
	const writers = 64
	errs := make(chan error, writers)
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			errs <- store.InsertBatch(ctx, []Sample{{TS: int64(index + 1), PointID: "UI-01", Value: float64(index)}})
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent writer error: %v", err)
		}
	}
	var count int
	if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM samples WHERE point_id='UI-01'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != writers {
		t.Fatalf("stored rows=%d want=%d", count, writers)
	}
}

func openTestTrendStore(t *testing.T) *TrendStore {
	t.Helper()
	store, err := OpenTrendStore(filepath.Join(t.TempDir(), "trend.sqlite"))
	if err != nil {
		t.Fatalf("OpenTrendStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}
