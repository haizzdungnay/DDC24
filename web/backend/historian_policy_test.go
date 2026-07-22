package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestHistorianPolicyCommittedMirrorSnapshotUsesExactBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "historian.conf")
	original := []byte("{\n  \"_schema_version\": 1,\n  \"revision\": 7,\n  \"historian_budget_bytes\": 2147483648,\n  \"wal_reserve_bytes\": 134217728,\n  \"migration_reserve_bytes\": 268435456,\n  \"required_free_space_bytes\": 536870912,\n  \"points\": []\n}\n")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	service, err := OpenHistorianPolicyService(path, time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	got, snapshot := service.committedMirrorSnapshot()
	got[0] = 'x'
	again, _ := service.committedMirrorSnapshot()
	if string(again) != string(original) || snapshot.Revision != 7 {
		t.Fatalf("snapshot revision=%d bytes=%q", snapshot.Revision, again)
	}
}

func TestHistorianPolicyMissingFileHasCanonicalRevisionZeroMirror(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	data, snapshot := service.committedMirrorSnapshot()
	var decoded historianPolicyFile
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("canonical empty mirror: %v", err)
	}
	if snapshot.Revision != 0 || decoded.Revision != 0 || decoded.Points == nil {
		t.Fatalf("snapshot=%+v decoded=%+v", snapshot, decoded)
	}
}

func TestHistorianPolicyMirrorRunsAfterCommitWithoutHoldingPolicyLock(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "valid", nil }
	started := make(chan struct{})
	release := make(chan struct{})
	service.mirrorCommitted = func(ctx context.Context, data []byte, namespaceRevision, observedAtUTCMS uint64) error {
		if _, err := os.Stat(service.path); err != nil {
			t.Errorf("policy not committed before mirror: %v", err)
		}
		close(started)
		select {
		case <-release:
			return errors.New("v2 unavailable")
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	done := make(chan error, 1)
	go func() {
		_, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}}})
		done <- err
	}()
	<-started
	if got, err := service.Get(); err != nil || got.Revision != 1 {
		t.Fatalf("Get while mirror blocked: revision=%d err=%v", got.Revision, err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("policy commit failed on mirror error: %v", err)
	}
}

func TestHistorianPolicyAtomicPatchPersistsAndRestarts(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 7, 17, 10, 0, 0, 0, time.UTC)
	service, err := OpenHistorianPolicyService(filepath.Join(dir, "historian.conf"), func() time.Time { return now }, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) {
		return map[string]uint64{"UI-01": 1, "AO-01": 1, "DO-01": 1, "VP1": 2}, "valid", nil
	}
	for _, interval := range historianIntervals {
		got, err := service.Update(HistorianConfigUpdate{BaseRevision: service.revision(), Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: interval}}})
		if err != nil {
			t.Fatalf("interval %s: %v", interval, err)
		}
		var policy HistorianPolicy
		for _, item := range got.Points {
			if item.PointID == "UI-01" {
				policy = item
			}
		}
		if policy.StartAtUTC != now.Format(time.RFC3339) || policy.State != "recording" {
			t.Fatalf("interval %s policy = %+v", interval, policy)
		}
	}

	reopened, err := OpenHistorianPolicyService(filepath.Join(dir, "historian.conf"), func() time.Time { return now }, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	if reopened.revision() != uint64(len(historianIntervals)) {
		t.Fatalf("revision = %d", reopened.revision())
	}
}

func TestHistorianRetentionRevAMaximumsAreMonotonic(t *testing.T) {
	want := map[string]int{
		"1s": 30, "3s": 60, "5s": 90, "15s": 180, "30s": 365,
		"1m": 730, "3m": 1095, "5m": 1460, "15m": 1825,
		"30m": 2555, "60m": 3650,
	}
	previous := 0
	for _, interval := range historianIntervals {
		got, ok := maxHistorianRetentionDays(interval)
		if !ok || got != want[interval] {
			t.Fatalf("interval %s max=%d ok=%v, want %d", interval, got, ok, want[interval])
		}
		if got < previous {
			t.Fatalf("interval %s max=%d decreased from %d", interval, got, previous)
		}
		previous = got
	}
}

func TestHistorianPolicyRetentionPersistsAndDefaultsToIntervalMaximum(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(dir, "historian.conf")
	open := func() *HistorianPolicyService {
		service, err := OpenHistorianPolicyService(path, func() time.Time { return now }, func() (uint64, error) { return 8 << 30, nil })
		if err != nil {
			t.Fatal(err)
		}
		service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "valid", nil }
		return service
	}
	service := open()
	got, err := service.Update(HistorianConfigUpdate{Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", RetentionDays: 21}}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Points[0].RetentionDays != 21 || got.Points[0].MaxRetentionDays != 30 || got.RetentionMaxDaysByInterval["15s"] != 180 {
		t.Fatalf("config=%+v", got)
	}
	reopened := open()
	persisted, err := reopened.Get()
	if err != nil || persisted.Points[0].RetentionDays != 21 || persisted.Points[0].MaxRetentionDays != 30 {
		t.Fatalf("persisted=%+v err=%v", persisted, err)
	}
	got, err = reopened.Update(HistorianConfigUpdate{BaseRevision: 1, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}}})
	if err != nil || got.Points[0].RetentionDays != 21 || got.Points[0].MaxRetentionDays != 180 {
		t.Fatalf("preserved selection=%+v err=%v", got, err)
	}
}

func TestHistorianPolicyRetentionValidationIsAtomic(t *testing.T) {
	now := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "historian.conf")
	service, err := OpenHistorianPolicyService(path, func() time.Time { return now }, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) {
		return map[string]uint64{"UI-01": 1, "UI-02": 1}, "valid", nil
	}
	_, err = service.Update(HistorianConfigUpdate{Points: []HistorianPolicyPatch{
		{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", RetentionDays: 90},
		{PointID: "UI-02", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", RetentionDays: 31},
	}})
	if err == nil || historianErrorStatus(err) != 400 || service.revision() != 0 {
		t.Fatalf("err=%v revision=%d", err, service.revision())
	}
	if typed, ok := err.(historianPolicyError); !ok || typed.reason != "historian_retention_invalid" {
		t.Fatalf("err=%#v", err)
	}
	if _, statErr := os.Stat(path); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("policy file err=%v", statErr)
	}
}

func TestHistorianPolicyShorterRetentionReducesReservedCapacity(t *testing.T) {
	newService := func(t *testing.T) *HistorianPolicyService {
		t.Helper()
		service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
		if err != nil {
			t.Fatal(err)
		}
		service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "valid", nil }
		return service
	}
	short := newService(t)
	shortConfig, err := short.Update(HistorianConfigUpdate{Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", RetentionDays: 90}}})
	if err != nil {
		t.Fatal(err)
	}
	full := newService(t)
	fullConfig, err := full.Update(HistorianConfigUpdate{Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", RetentionDays: 180}}})
	if err != nil {
		t.Fatal(err)
	}
	if shortConfig.Capacity.ReservedBytes >= fullConfig.Capacity.ReservedBytes {
		t.Fatalf("short=%d full=%d", shortConfig.Capacity.ReservedBytes, fullConfig.Capacity.ReservedBytes)
	}
	if fullConfig.Capacity.ReservedBytes != defaultHistorianWALReserveBytes+defaultHistorianMigrationReserve+defaultHistorianPointReserve {
		t.Fatalf("full reserve=%d", fullConfig.Capacity.ReservedBytes)
	}
}

func TestHistorianPolicyReconcilesRecreatedPointGeneration(t *testing.T) {
	now := time.Date(2026, 7, 17, 10, 0, 0, 0, time.UTC)
	generation := uint64(1)
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), func() time.Time { return now }, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"VP1": generation}, "valid", nil }
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: "VP1", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}}}); err != nil {
		t.Fatal(err)
	}
	generation = 2
	got, err := service.Get()
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Points) != 1 || got.Points[0].PointID != "VP1" || got.Points[0].Generation != 2 || got.Points[0].DBLoggingEnabled || got.Points[0].State != "off" {
		t.Fatalf("points = %+v, want current VP1 generation 2 off", got.Points)
	}
	if got.Capacity.EnabledPoints != 0 {
		t.Fatalf("capacity = %+v, stale generation must not count", got.Capacity)
	}
}

func TestHistorianPolicyCapacityLeavesRequiredFreeSpace(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) {
		return defaultHistorianRequiredFree + defaultHistorianWALReserveBytes + defaultHistorianMigrationReserve + defaultHistorianPointReserve - 1, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "valid", nil }
	_, err = service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}}})
	if err == nil || historianErrorStatus(err) != 507 {
		t.Fatalf("err = %v, want 507 insufficient headroom", err)
	}
}

func TestHistorianPolicyConcurrentSameRevisionCommitsOnce(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) {
		return map[string]uint64{"UI-01": 1, "UI-02": 1}, "valid", nil
	}
	var success atomic.Int32
	var conflict atomic.Int32
	var wg sync.WaitGroup
	for _, id := range []string{"UI-01", "UI-02"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: id, Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}}})
			if err == nil {
				success.Add(1)
			} else if historianErrorStatus(err) == 409 {
				conflict.Add(1)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 1 || conflict.Load() != 1 || service.revision() != 1 {
		t.Fatalf("success=%d conflict=%d revision=%d", success.Load(), conflict.Load(), service.revision())
	}
}

func TestHistorianPolicyFailedBatchKeepsPriorRevision(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), func() time.Time { return time.Date(2026, 7, 17, 10, 0, 0, 0, time.UTC) }, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "valid", nil }
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "auto"}}}); err == nil || historianErrorStatus(err) != 400 {
		t.Fatalf("err = %v", err)
	}
	if service.revision() != 0 {
		t.Fatalf("revision = %d, want 0", service.revision())
	}
	if _, err := os.Stat(service.path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("policy file err = %v, want not exist", err)
	}
}

func TestHistorianPolicyRejectsConflictAndCapacity(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 1, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"VP1": 2}, "valid", nil }
	patch := HistorianPolicyPatch{PointID: "VP1", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{patch}}); err == nil || historianErrorStatus(err) != 409 {
		t.Fatalf("generation err = %v", err)
	}
	patch.Generation = 2
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{patch}}); err == nil || historianErrorStatus(err) != 507 {
		t.Fatalf("capacity err = %v", err)
	}
}

func TestHistorianPolicyFileShape(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"DO-01": 1}, "valid", nil }
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: "DO-01", Generation: 1, DBLoggingEnabled: false}}}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(service.path)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil || raw["revision"] != float64(1) {
		t.Fatalf("file = %s err=%v", data, err)
	}
}

func TestHistorianPolicyAllKindsAndIntervals(t *testing.T) {
	now := time.Date(2026, 7, 17, 10, 0, 0, 0, time.UTC)
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), func() time.Time { return now }, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) {
		return map[string]uint64{"UI-01": 1, "AO-01": 1, "DO-01": 1, "VP1": 2}, "valid", nil
	}
	for _, id := range []struct {
		id         string
		generation uint64
	}{{"UI-01", 1}, {"AO-01", 1}, {"DO-01", 1}, {"VP1", 2}} {
		for _, interval := range historianIntervals {
			if _, err := service.Update(HistorianConfigUpdate{BaseRevision: service.revision(), Points: []HistorianPolicyPatch{{PointID: id.id, Generation: id.generation, DBLoggingEnabled: true, DBInterval: interval}}}); err != nil {
				t.Fatalf("%s %s: %v", id.id, interval, err)
			}
		}
	}
}

func TestHistorianPolicyFutureAndPastStart(t *testing.T) {
	now := time.Date(2026, 7, 17, 10, 0, 0, 0, time.UTC)
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), func() time.Time { return now }, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "valid", nil }
	future := now.Add(time.Hour).Format(time.RFC3339)
	got, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: &future}}})
	if err != nil || !hasHistorianPolicyState(got.Points, "UI-01", "scheduled") {
		t.Fatalf("future config=%+v err=%v", got, err)
	}
	past := now.Add(-time.Second).Format(time.RFC3339)
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 1, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: &past}}}); err == nil || historianErrorStatus(err) != 400 || service.revision() != 1 {
		t.Fatalf("past err=%v revision=%d", err, service.revision())
	}
}

func TestHistorianPolicyMixedInvalidBatchPreservesFile(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) {
		return map[string]uint64{"UI-01": 1, "AO-01": 1}, "valid", nil
	}
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}}}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(service.path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Update(HistorianConfigUpdate{BaseRevision: 1, Points: []HistorianPolicyPatch{{PointID: "AO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "30s"}, {PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "auto"}}})
	after, readErr := os.ReadFile(service.path)
	if err == nil || readErr != nil || string(before) != string(after) || service.revision() != 1 {
		t.Fatalf("err=%v readErr=%v revision=%d fileChanged=%v", err, readErr, service.revision(), string(before) != string(after))
	}
}

func TestHistorianPolicyRejectsNamespaceConflictAndBudget(t *testing.T) {
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), time.Now, func() (uint64, error) { return 8 << 30, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "conflicted", nil }
	patch := HistorianPolicyPatch{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}
	if _, err := service.Update(HistorianConfigUpdate{Points: []HistorianPolicyPatch{patch}}); err == nil || historianErrorStatus(err) != 409 {
		t.Fatalf("namespace err=%v", err)
	}
	service.identities = func() (map[string]uint64, string, error) { return map[string]uint64{"UI-01": 1}, "valid", nil }
	service.file.HistorianBudgetBytes = 1
	if _, err := service.Update(HistorianConfigUpdate{Points: []HistorianPolicyPatch{patch}}); err == nil || historianErrorStatus(err) != 507 {
		t.Fatalf("budget err=%v", err)
	}
}

func hasHistorianPolicyState(points []HistorianPolicy, id, state string) bool {
	for _, point := range points {
		if point.PointID == id && point.State == state {
			return true
		}
	}
	return false
}
