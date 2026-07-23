package main

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type historianQueryBackendStub struct {
	identities []HistorianQueryIdentity
	reads      map[HistorianTier]HistorianTierRead
	errors     map[HistorianTier]error
}

func (s historianQueryBackendStub) Identities(context.Context, []string, int64, int64, string) ([]HistorianQueryIdentity, error) {
	return append([]HistorianQueryIdentity(nil), s.identities...), nil
}

func (s historianQueryBackendStub) ReadTier(_ context.Context, tier HistorianTier, _ []HistorianQueryIdentity, _, _ int64) (HistorianTierRead, error) {
	return s.reads[tier], s.errors[tier]
}

func TestHistorianQueryValidatesCanonicalRequest(t *testing.T) {
	engine := NewHistorianQueryEngine(historianQueryBackendStub{})
	tests := []HistorianQueryRequest{
		{PointIDs: nil, FromUTCMS: 1, ToUTCMS: 2, Resolution: "15s"},
		{PointIDs: []string{"AI-01"}, FromUTCMS: 1, ToUTCMS: 2, Resolution: "15s"},
		{PointIDs: []string{"UI-01", "UI-01"}, FromUTCMS: 1, ToUTCMS: 2, Resolution: "15s"},
		{PointIDs: []string{"UI-01"}, FromUTCMS: 2, ToUTCMS: 2, Resolution: "15s"},
		{PointIDs: []string{"UI-01"}, FromUTCMS: 1, ToUTCMS: 2, Resolution: "10s"},
		{PointIDs: []string{"UI-01"}, FromUTCMS: 1, ToUTCMS: 2, Resolution: "15s", MaxPoints: 5001},
		{PointIDs: []string{"UI-01"}, FromUTCMS: 1, ToUTCMS: 2, Resolution: "15s", Source: "other"},
		{PointIDs: []string{"UI-01"}, FromUTCMS: 1, ToUTCMS: 24*60*60*1000 + 2, Resolution: "15s", Source: "cache"},
	}
	for _, request := range tests {
		_, err := engine.Query(context.Background(), request)
		var queryErr *HistorianQueryError
		if !errors.As(err, &queryErr) || queryErr.Code != "invalid_request" {
			t.Fatalf("request %#v: got %v", request, err)
		}
	}
}

func TestHistorianQueryRoutesCacheAndDatabaseSources(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	reads := map[HistorianTier]HistorianTierRead{
		HistorianTierCache:   {Tier: HistorianTierCache, Available: true, Rows: []HistorianAggregateRow{queryRow(identity, 0, 11, 0, "runtime", HistorianTierCache)}},
		HistorianTierHot:     {Tier: HistorianTierHot, Available: true, Rows: []HistorianAggregateRow{queryRow(identity, 0, 22, 0, "runtime", HistorianTierHot)}},
		HistorianTierArchive: {Tier: HistorianTierArchive, Available: true},
	}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{identities: []HistorianQueryIdentity{identity}, reads: reads})

	cacheResult, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"UI-01"}, FromUTCMS: 0, ToUTCMS: 15000, Resolution: "auto", MaxPoints: 10, Source: "cache"})
	if err != nil {
		t.Fatal(err)
	}
	if got := cacheResult.Series[0].Samples[0]; got.Value != 11 || got.Tier != HistorianTierCache {
		t.Fatalf("cache source leaked another tier: %#v", got)
	}

	databaseResult, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"UI-01"}, FromUTCMS: 0, ToUTCMS: 15000, Resolution: "auto", MaxPoints: 10, Source: "database"})
	if err != nil {
		t.Fatal(err)
	}
	if got := databaseResult.Series[0].Samples[0]; got.Value != 22 || got.Tier != HistorianTierHot {
		t.Fatalf("database source leaked cache data: %#v", got)
	}
}

func TestHistorianQueryFineResolutionUsesCoveredRAMOnly(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "VP2", Generation: 7}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{
		identities: []HistorianQueryIdentity{identity},
		reads: map[HistorianTier]HistorianTierRead{
			HistorianTierRAM: {
				Tier: HistorianTierRAM, Available: true, CoverageFromUTCMS: 1000, CoverageToUTCMS: 7000,
				Rows: []HistorianAggregateRow{
					queryRow(identity, 1000, 1, 0, "runtime", HistorianTierRAM),
					queryRow(identity, 2000, 3, 1, "runtime", HistorianTierRAM),
					queryRow(identity, 7000, 9, 0, "runtime", HistorianTierRAM),
				},
			},
		},
	})
	result, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"VP2"}, FromUTCMS: 1000, ToUTCMS: 7000, Resolution: "3s", MaxPoints: 10})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Complete || result.Resolution != "3s" || len(result.Series) != 1 || len(result.Series[0].Samples) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	first := result.Series[0].Samples[0]
	if first.TimeUTCMS != 0 || first.Value != 3 || first.Min != 1 || first.Max != 3 || first.Sum != 4 || first.Count != 2 || first.Quality != "UNCERTAIN" {
		t.Fatalf("unexpected aggregate: %#v", first)
	}
	if !reflect.DeepEqual(result.TiersUsed, []HistorianTier{HistorianTierRAM}) {
		t.Fatalf("tiersUsed=%v", result.TiersUsed)
	}
}

func TestHistorianQueryRejectsFineResolutionOutsideRAMTail(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{
		identities: []HistorianQueryIdentity{identity},
		reads:      map[HistorianTier]HistorianTierRead{HistorianTierRAM: {Tier: HistorianTierRAM, Available: true, CoverageFromUTCMS: 2000, CoverageToUTCMS: 7000}},
	})
	_, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"UI-01"}, FromUTCMS: 1000, ToUTCMS: 7000, Resolution: "1s"})
	var queryErr *HistorianQueryError
	if !errors.As(err, &queryErr) || queryErr.Code != "resolution_unavailable" {
		t.Fatalf("got %v", err)
	}
}

func TestHistorianQueryMergesTierPriorityAndGenerations(t *testing.T) {
	oldGeneration := HistorianQueryIdentity{PointID: "AO-01", Generation: 2}
	newGeneration := HistorianQueryIdentity{PointID: "AO-01", Generation: 3}
	reads := map[HistorianTier]HistorianTierRead{
		HistorianTierArchive: {Tier: HistorianTierArchive, Available: true, Rows: []HistorianAggregateRow{
			queryAggregate(oldGeneration, 0, 10, 8, 12, 20, 2, 0, "archive", HistorianTierArchive),
			queryAggregate(newGeneration, 0, 100, 100, 100, 100, 1, 0, "archive", HistorianTierArchive),
		}},
		HistorianTierHot: {Tier: HistorianTierHot, Available: true, Rows: []HistorianAggregateRow{
			queryAggregate(oldGeneration, 0, 20, 20, 20, 20, 1, 1, "hot", HistorianTierHot),
			queryAggregate(oldGeneration, 15000, 30, 30, 30, 30, 1, 0, "hot", HistorianTierHot),
		}},
		HistorianTierRAM: {Tier: HistorianTierRAM, Available: true, Rows: []HistorianAggregateRow{
			queryAggregate(oldGeneration, 1000, 40, 40, 40, 40, 1, 2, "runtime", HistorianTierRAM),
		}},
	}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{identities: []HistorianQueryIdentity{newGeneration, oldGeneration}, reads: reads})
	result, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"AO-01"}, FromUTCMS: 0, ToUTCMS: 30000, Resolution: "30s", MaxPoints: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Series) != 2 || result.Series[0].Generation != 2 || result.Series[1].Generation != 3 {
		t.Fatalf("generation split lost: %#v", result.Series)
	}
	sample := result.Series[0].Samples[0]
	if sample.Value != 30 || sample.Min != 30 || sample.Max != 40 || sample.Sum != 70 || sample.Count != 2 || sample.Quality != "BAD" || sample.Source != "mixed" || sample.Tier != HistorianTierHot {
		t.Fatalf("unexpected merged sample: %#v", sample)
	}
	if result.Series[1].Samples[0].Value != 100 {
		t.Fatalf("generation data crossed: %#v", result.Series[1])
	}
	if !reflect.DeepEqual(result.TiersUsed, []HistorianTier{HistorianTierRAM, HistorianTierHot, HistorianTierArchive}) {
		t.Fatalf("tiersUsed=%v", result.TiersUsed)
	}
}

func TestHistorianQueryAutoChoosesFinestResolutionWithinBudget(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "DO-01", Generation: 1}
	rows := []HistorianAggregateRow{
		queryRow(identity, 0, 0, 0, "output", HistorianTierHot),
		queryRow(identity, 15000, 1, 0, "output", HistorianTierHot),
		queryRow(identity, 30000, 2, 0, "output", HistorianTierHot),
		queryRow(identity, 45000, 3, 0, "output", HistorianTierHot),
	}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{
		identities: []HistorianQueryIdentity{identity},
		reads: map[HistorianTier]HistorianTierRead{
			HistorianTierArchive: {Tier: HistorianTierArchive, Available: true},
			HistorianTierHot:     {Tier: HistorianTierHot, Available: true, Rows: rows},
			HistorianTierRAM:     {Tier: HistorianTierRAM, Available: true},
		},
	})
	result, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"DO-01"}, FromUTCMS: 0, ToUTCMS: 60000, Resolution: "auto", MaxPoints: 2})
	if err != nil {
		t.Fatal(err)
	}
	if result.Resolution != "30s" || len(result.Series[0].Samples) != 2 || result.Series[0].EffectiveResolution != "30s" {
		t.Fatalf("unexpected auto choice: %#v", result)
	}
}

func TestHistorianQueryFixedResolutionDoesNotTruncateBudget(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "DO-01", Generation: 1}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{
		identities: []HistorianQueryIdentity{identity},
		reads: map[HistorianTier]HistorianTierRead{
			HistorianTierArchive: {Tier: HistorianTierArchive, Available: true},
			HistorianTierHot: {Tier: HistorianTierHot, Available: true, Rows: []HistorianAggregateRow{
				queryRow(identity, 0, 0, 0, "output", HistorianTierHot),
				queryRow(identity, 15000, 1, 0, "output", HistorianTierHot),
			}},
			HistorianTierRAM: {Tier: HistorianTierRAM, Available: true},
		},
	})
	_, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"DO-01"}, FromUTCMS: 0, ToUTCMS: 30000, Resolution: "15s", MaxPoints: 1})
	var queryErr *HistorianQueryError
	if !errors.As(err, &queryErr) || queryErr.Code != "output_budget_exceeded" {
		t.Fatalf("got %v", err)
	}
}

func TestHistorianQueryPreservesUsablePartialTierAndExplicitGaps(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	gap := HistorianQueryGap{PointID: identity.PointID, Generation: identity.Generation, FromUTCMS: -1000, ToUTCMS: 10000, Reason: "restart", Detail: "boot"}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{
		identities: []HistorianQueryIdentity{identity},
		reads: map[HistorianTier]HistorianTierRead{
			HistorianTierArchive: {Tier: HistorianTierArchive, Available: false},
			HistorianTierHot:     {Tier: HistorianTierHot, Available: true, Rows: []HistorianAggregateRow{queryRow(identity, 0, 5, 0, "runtime", HistorianTierHot)}, Gaps: []HistorianQueryGap{gap, gap}},
			HistorianTierRAM:     {Tier: HistorianTierRAM, Available: false},
		},
		errors: map[HistorianTier]error{HistorianTierHot: errors.New("last page unreadable")},
	})
	result, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"UI-01"}, FromUTCMS: 0, ToUTCMS: 15000, Resolution: "15s"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Complete || len(result.Series) != 1 || len(result.Series[0].Samples) != 1 {
		t.Fatalf("usable partial row lost: %#v", result)
	}
	foundRestart := false
	for _, item := range result.Gaps {
		if item.Reason == "restart" {
			foundRestart = true
			if item.FromUTCMS != 0 || item.ToUTCMS != 10000 {
				t.Fatalf("gap not clipped: %#v", item)
			}
		}
	}
	if !foundRestart {
		t.Fatalf("explicit gap missing: %#v", result.Gaps)
	}
}

func TestHistorianQueryFailsWhenAllTiersUnavailable(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "UI-01", Generation: 1}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{identities: []HistorianQueryIdentity{identity}, reads: map[HistorianTier]HistorianTierRead{}})
	_, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"UI-01"}, FromUTCMS: 0, ToUTCMS: 15000, Resolution: "15s"})
	var queryErr *HistorianQueryError
	if !errors.As(err, &queryErr) || queryErr.Code != "historian_unavailable" {
		t.Fatalf("got %v", err)
	}
}

func TestHistorianQueryEmitsEmptyGenerationSeries(t *testing.T) {
	identity := HistorianQueryIdentity{PointID: "VP2", Generation: 9}
	engine := NewHistorianQueryEngine(historianQueryBackendStub{
		identities: []HistorianQueryIdentity{identity},
		reads: map[HistorianTier]HistorianTierRead{
			HistorianTierArchive: {Tier: HistorianTierArchive, Available: true},
			HistorianTierHot:     {Tier: HistorianTierHot, Available: true},
			HistorianTierRAM:     {Tier: HistorianTierRAM, Available: true, CoverageFromUTCMS: 0, CoverageToUTCMS: 15000},
		},
	})
	result, err := engine.Query(context.Background(), HistorianQueryRequest{PointIDs: []string{"VP2"}, FromUTCMS: 0, ToUTCMS: 15000, Resolution: "15s"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Series) != 1 || result.Series[0].PointID != "VP2" || result.Series[0].Generation != 9 || result.Series[0].Samples == nil || len(result.Series[0].Samples) != 0 {
		t.Fatalf("empty generation series missing: %#v", result)
	}
}

func queryRow(identity HistorianQueryIdentity, bucketUTCMS int64, value float64, quality int, source string, tier HistorianTier) HistorianAggregateRow {
	return queryAggregate(identity, bucketUTCMS, value, value, value, value, 1, quality, source, tier)
}

func queryAggregate(identity HistorianQueryIdentity, bucketUTCMS int64, value, min, max, sum float64, count, quality int, source string, tier HistorianTier) HistorianAggregateRow {
	return HistorianAggregateRow{PointID: identity.PointID, Generation: identity.Generation, BucketUTCMS: bucketUTCMS, LastSampleUTCMS: bucketUTCMS, Value: value, Min: min, Max: max, Sum: sum, Count: count, Quality: quality, Source: source, Tier: tier}
}
