package main

import (
	"context"
	"math"
	"testing"
)

func TestNormalizeLegacyTimestamp(t *testing.T) {
	for _, tc := range []struct {
		in, want int64
		ok       bool
	}{{1, 1000, true}, {999_999_999_999, 999_999_999_999_000, true}, {1_000_000_000_000, 1_000_000_000_000, true}, {math.MaxInt64, math.MaxInt64, true}, {0, 0, false}, {-1, 0, false}} {
		got, ok := normalizeLegacyTimestamp(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Fatalf("normalize(%d)=%d,%v want %d,%v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

func TestHistorianMigrationNormalizesZeroAndRejectsAggregateOverflow(t *testing.T) {
	manifest := MigrationManifest{TimestampRuleVersion: 1, AliasRuleVersion: 1, Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}}}
	zero, err := MigrateLegacyRows(manifest, []LegacySampleRow{{TS: 1_752_746_401, PointID: "UI-01", Value: math.Copysign(0, -1), Quality: 0}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(zero.Hot) != 1 || math.Signbit(zero.Hot[0].Value) || math.Signbit(zero.Hot[0].Sum) {
		t.Fatalf("hot=%+v", zero.Hot)
	}
	overflow, err := MigrateLegacyRows(manifest, []LegacySampleRow{{TS: 1_752_746_401, PointID: "UI-01", Value: math.MaxFloat64}, {TS: 1_752_746_402, PointID: "UI-01", Value: math.MaxFloat64}}, 1)
	if err == nil || len(overflow.Hot) != 0 {
		t.Fatalf("overflow=%+v err=%v", overflow, err)
	}
}

func TestHistorianMigrationUsesFrozenVersionedRules(t *testing.T) {
	manifest := MigrationManifest{TimestampRuleVersion: 2, AliasRuleVersion: 1, Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}}}
	if _, err := MigrateLegacyRows(manifest, []LegacySampleRow{{TS: 1, PointID: "UI-01", Value: 1}}, 1); err == nil {
		t.Fatal("expected unsupported timestamp rule rejection")
	}
	manifest.TimestampRuleVersion, manifest.AliasRuleVersion = 1, 2
	if _, err := MigrateLegacyRows(manifest, []LegacySampleRow{{TS: 1, PointID: "UI-01", Value: 1}}, 1); err == nil {
		t.Fatal("expected unsupported alias rule rejection")
	}
}

func TestHistorianMigrationRejectsInvalidSourceRowsDeterministically(t *testing.T) {
	manifest := MigrationManifest{TimestampRuleVersion: 1, AliasRuleVersion: 1, Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}}}
	rows := []LegacySampleRow{{TS: 2, PointID: "UI-01", Value: 1, Quality: 3}, {TS: 1, PointID: "unknown", Value: 2}, {TS: 3, PointID: "UI-01", Value: math.NaN()}}
	result, err := MigrateLegacyRows(manifest, rows, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hot) != 0 || len(result.Rejected) != 3 || result.Rejected[0].TS != 1 || result.Rejected[1].TS != 2 || result.Rejected[2].TS != 3 {
		t.Fatalf("result=%+v", result)
	}
}

func TestHistorianMigrationCollisionCreatesGapEvidence(t *testing.T) {
	manifest := MigrationManifest{TimestampRuleVersion: 1, AliasRuleVersion: 1, Mappings: []MigrationMapping{{LegacyStorageID: "AI1", CanonicalPointID: "UI-01", Generation: 1}, {LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}}}
	result, err := MigrateLegacyRows(manifest, []LegacySampleRow{{TS: 1_752_746_401, PointID: "AI1", Value: 99}, {TS: 1_752_746_401, PointID: "UI-01", Value: 10}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Rejected) != 1 || len(result.Gaps) != 1 || result.Gaps[0].Reason != "migration" || result.Gaps[0].FromUTCMS != 1_752_746_401_000 || result.Gaps[0].ToUTCMS != 1_752_746_402_000 {
		t.Fatalf("result=%+v", result)
	}
	if result.Hot[0].Source != legacyMigrationSourceV1 {
		t.Fatalf("source=%q", result.Hot[0].Source)
	}
}

func TestHistorianMigrationTieOrderAndInputPermutation(t *testing.T) {
	manifest := MigrationManifest{TimestampRuleVersion: 1, AliasRuleVersion: 1, Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}, {LegacyStorageID: "UI1", CanonicalPointID: "UI-01", Generation: 1}}}
	rows := []LegacySampleRow{{TS: 1_752_746_401, PointID: "UI1", Value: 2}, {TS: 1_752_746_401, PointID: "UI-01", Value: 1}, {TS: 1_752_746_402, PointID: "UI1", Value: 3}}
	first, err := MigrateLegacyRows(manifest, rows, 1)
	if err != nil {
		t.Fatal(err)
	}
	rows[0], rows[2] = rows[2], rows[0]
	second, err := MigrateLegacyRows(manifest, rows, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Hot) != 1 || len(second.Hot) != 1 || first.Hot[0] != second.Hot[0] || first.Hot[0].Value != 3 || first.Hot[0].Count != 2 {
		t.Fatalf("first=%+v second=%+v", first, second)
	}
}

func TestHistorianMigrationCheckpointIsAtomicAndIdempotent(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	manifest := MigrationManifest{MigrationID: "m1", SourceIdentity: "legacy", SourceSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", NamespaceRevision: 1, PolicyRevision: 1, SchemaID: "hist-v1", TimestampRuleVersion: 1, AliasRuleVersion: 1, SourceRowCount: 2, Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}}}
	rows := []LegacySampleRow{{TS: 1_752_746_401, PointID: "UI-01", Value: 1}, {TS: 1_752_746_416, PointID: "UI-01", Value: 2}}
	if err := store.ApplyLegacyMigrationChunk(context.Background(), manifest, rows[:1], 1, false); err != nil {
		t.Fatal(err)
	}
	if err := store.ApplyLegacyMigrationChunk(context.Background(), manifest, rows[1:], 1, true); err != nil {
		t.Fatal(err)
	}
	if err := store.ApplyLegacyMigrationChunk(context.Background(), manifest, rows, 2, true); err != nil {
		t.Fatalf("idempotent replay: %v", err)
	}
	var hot, staging int
	if err := store.db.QueryRow(`SELECT count(*) FROM hot_samples`).Scan(&hot); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM migration_staging`).Scan(&staging); err != nil {
		t.Fatal(err)
	}
	if hot != 2 || staging != 0 {
		t.Fatalf("hot=%d staging=%d", hot, staging)
	}
}

func TestHistorianMigrationFinalizationRequiresCompleteSourceCoverage(t *testing.T) {
	store := openHistorianStoreTest(t)
	mirrorHistorianTestPolicy(t, store)
	manifest := MigrationManifest{MigrationID: "m1", SourceIdentity: "legacy", SourceSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", PolicyRevision: 1, SchemaID: "hist-v1", TimestampRuleVersion: 1, AliasRuleVersion: 1, SourceRowCount: 2, Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}}}
	if err := store.ApplyLegacyMigrationChunk(context.Background(), manifest, []LegacySampleRow{{TS: 1, PointID: "UI-01", Value: 1}}, 1, true); err == nil {
		t.Fatal("expected incomplete source rejection")
	}
	var hot int
	if err := store.db.QueryRow(`SELECT count(*) FROM hot_samples`).Scan(&hot); err != nil || hot != 0 {
		t.Fatalf("hot=%d err=%v", hot, err)
	}
}

func TestMigrateLegacyRowsChoosesWinnerBeforeAggregate(t *testing.T) {
	manifest := MigrationManifest{TimestampRuleVersion: 1, AliasRuleVersion: 1, Mappings: []MigrationMapping{{LegacyStorageID: "AI1", CanonicalPointID: "UI-01", Generation: 1}, {LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}}}
	rows := []LegacySampleRow{
		{TS: 1_752_746_401, PointID: "AI1", Value: 99, Quality: 0},
		{TS: 1_752_746_401, PointID: "UI-01", Value: 10, Quality: 1},
		{TS: 1_752_746_407, PointID: "AI1", Value: 12, Quality: 2},
	}
	result, err := MigrateLegacyRows(manifest, rows, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hot) != 1 || result.Hot[0].Value != 12 || result.Hot[0].Min != 10 || result.Hot[0].Max != 12 || result.Hot[0].Sum != 22 || result.Hot[0].Count != 2 || result.Hot[0].WorstQuality != 2 {
		t.Fatalf("hot=%+v", result.Hot)
	}
	if len(result.Rejected) != 1 || result.Rejected[0].PointID != "AI1" {
		t.Fatalf("rejected=%+v", result.Rejected)
	}
}
