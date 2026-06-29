package main

import (
	"context"
	"path/filepath"
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

func openTestTrendStore(t *testing.T) *TrendStore {
	t.Helper()
	store, err := OpenTrendStore(filepath.Join(t.TempDir(), "trend.sqlite"))
	if err != nil {
		t.Fatalf("OpenTrendStore: %v", err)
	}
	return store
}
