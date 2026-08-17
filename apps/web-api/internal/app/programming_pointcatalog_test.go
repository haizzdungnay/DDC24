package app

import (
	"context"
	"testing"
)

type programmingMonitorCore struct {
	*pointsCore
	snapshot RuntimePointSnapshot
}

func (core *programmingMonitorCore) ReadPointSnapshot(context.Context) (RuntimePointSnapshot, error) {
	return core.snapshot, nil
}

func TestPointCatalogCategoryFromRealProducerKind(t *testing.T) {
	cases := []struct {
		kind             string
		wantCategory     string
		wantDeviceIDNote string
	}{
		{"UI", "LOCAL", ""},
		{"AO", "LOCAL", ""},
		{"DO", "LOCAL", ""},
		{"virtual", "VP", ""},
		{"modbus_rtu", "MB_RTU", "bus-2-slave-5"},
	}
	for _, testCase := range cases {
		point := PointDTO{Kind: testCase.kind, BusID: 2, SlaveAddr: 5}
		category, deviceID := pointCatalogCategory(point)
		if category != testCase.wantCategory {
			t.Fatalf("kind=%q category=%q, want %q", testCase.kind, category, testCase.wantCategory)
		}
		if testCase.wantDeviceIDNote != "" && deviceID != testCase.wantDeviceIDNote {
			t.Fatalf("kind=%q deviceId=%q, want %q", testCase.kind, deviceID, testCase.wantDeviceIDNote)
		}
	}
}

func TestPointCatalogQualityNeverFabricatesGood(t *testing.T) {
	cases := map[string]string{
		"GOOD": "GOOD", "UNCERTAIN": "UNCERTAIN", "BAD": "BAD", "STALE": "STALE",
		"OFFLINE": "OFFLINE", "UNKNOWN": "UNKNOWN", "CONFIG_ERROR": "BAD",
		"good": "GOOD", "stale": "STALE",
		"":            "UNKNOWN",
		"garbled_xyz": "UNKNOWN",
	}
	for input, want := range cases {
		if got := pointCatalogQuality(PointDTO{Quality: input}); got != want {
			t.Fatalf("quality(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestPointCatalogDirectionOutputsAreReadWrite(t *testing.T) {
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "AO"}); direction != "READ_WRITE" || !writable {
		t.Fatalf("AO direction=%q writable=%v", direction, writable)
	}
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "DO"}); direction != "READ_WRITE" || !writable {
		t.Fatalf("DO direction=%q writable=%v", direction, writable)
	}
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "UI"}); direction != "READ" || writable {
		t.Fatalf("UI direction=%q writable=%v", direction, writable)
	}
}

// F-PROG-ASBUILT-014 (phần WRITE vẫn mở, F-PROG-ASBUILT-016): dù VP cho phép
// operator sửa từ dashboard (`Writable=true`), Point Catalog phải báo READ
// cho ST Program — chưa có đường đồng bộ ngược Core->Web API cho VAR_OUTPUT.
func TestPointCatalogDirectionVirtualAlwaysReadRegardlessOfOperatorWritable(t *testing.T) {
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "virtual", Writable: true}); direction != "READ" || writable {
		t.Fatalf("virtual writable=true direction=%q writable=%v, want READ/false", direction, writable)
	}
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "virtual", Writable: false}); direction != "READ" || writable {
		t.Fatalf("virtual writable=false direction=%q writable=%v, want READ/false", direction, writable)
	}
}

// F-PROG-ASBUILT-014: một khi VP đã "bound" vào slot Core thật (BoundPointID),
// Point Catalog phải phát định danh Core (vd. "AV-01") thay vì id thân thiện
// "VP1" — đúng định dạng mà resolve_io_bindings() (Core) chấp nhận cho
// category VP; VP chưa bound vẫn giữ nguyên id cũ (sẽ tự fail Check với lỗi
// định danh rõ ràng thay vì bị Point Catalog giả vờ bindable).
func TestToPointCatalogEntryUsesBoundPointIdForVirtualWhenBound(t *testing.T) {
	bound := toPointCatalogEntry(PointDTO{ID: "VP1", Kind: "virtual", BoundPointID: "AV-01"})
	if bound.Category != "VP" || bound.PointID != "AV-01" {
		t.Fatalf("bound entry category=%q pointId=%q, want VP/AV-01", bound.Category, bound.PointID)
	}
	unbound := toPointCatalogEntry(PointDTO{ID: "VP2", Kind: "virtual"})
	if unbound.Category != "VP" || unbound.PointID != "VP2" {
		t.Fatalf("unbound entry category=%q pointId=%q, want VP/VP2", unbound.Category, unbound.PointID)
	}
}

func TestPointCatalogDataTypeDigitalVsAnalog(t *testing.T) {
	if got := pointCatalogDataType(PointDTO{Kind: "DO"}); got != "BOOL" {
		t.Fatalf("DO dataType=%q, want BOOL", got)
	}
	if got := pointCatalogDataType(PointDTO{Kind: "AO"}); got != "REAL" {
		t.Fatalf("AO dataType=%q, want REAL", got)
	}
	if got := pointCatalogDataType(PointDTO{Kind: "virtual", Value: true}); got != "BOOL" {
		t.Fatalf("virtual bool dataType=%q, want BOOL", got)
	}
	if got := pointCatalogDataType(PointDTO{Kind: "virtual", Value: 12.5}); got != "REAL" {
		t.Fatalf("virtual numeric dataType=%q, want REAL", got)
	}
}

func TestListActiveOverridesOnlyReturnsForcedPointsAndNeverFabricatesActor(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	app.core = &pointsCore{points: []PointDTO{
		{ID: "AO1", Kind: "AO", Value: 42.0, Forced: true, Source: "LOCAL_MANUAL", OverrideExpiresInS: uint32Ptr(120)},
		{ID: "AO2", Kind: "AO", Value: 10.0, Forced: false},
	}}
	entries, err := app.programmingPointCatalog().ListActiveOverrides(context.Background())
	if err != nil {
		t.Fatalf("ListActiveOverrides: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %+v; want đúng 1 (chỉ Point đang bị force)", entries)
	}
	entry := entries[0]
	if entry.PointID == "" || entry.Category != "LOCAL" {
		t.Fatalf("entry = %+v", entry)
	}
	if entry.RemainingS == nil || *entry.RemainingS != 120 {
		t.Fatalf("remainingS = %+v; want 120 từ PointDTO.OverrideExpiresInS", entry.RemainingS)
	}
	// Registry chưa từng thấy override này (không qua force-point flow của
	// chính web-api) ⇒ actor phải RỖNG, không được bịa.
	if entry.ActorID != "" {
		t.Fatalf("actorId = %q; muốn rỗng vì registry không biết", entry.ActorID)
	}
}

func TestProgrammingMonitorUsesEndScanTruthOnlyForLocalPoints(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	programValue := 41.0
	priority := 2
	app.core = &programmingMonitorCore{
		pointsCore: &pointsCore{points: []PointDTO{
			{ID: "AO-01", Kind: "AO", Value: 60.0, Quality: "good", Source: "core", UpdatedAt: "2026-08-13T00:00:00Z", Unit: "V"},
			{ID: "AO-01", Kind: "modbus_rtu", BusID: 1, SlaveAddr: 7, Value: 99.0, Quality: "stale", Source: "modbus_rtu", UpdatedAt: "2026-08-13T00:00:01Z"},
		}},
		snapshot: RuntimePointSnapshot{
			SnapshotObservedAtUTC: "2026-08-13T00:00:02Z", SafeState: true, SafeStateNoControllerOnly: true,
			Task:   &RuntimeTaskSnapshot{TaskID: "main", State: "RUNNING", PeriodMS: 1000, BudgetMS: 200},
			Points: []RuntimePoint{{ID: "AO-01", Value: 62.0, ProgramValue: &programValue, EffectivePriority: &priority, Quality: "GOOD", Source: "manual", Unit: "V"}},
		},
	}

	truth, err := app.programmingPointCatalog().ReadProgrammingMonitorSnapshot(context.Background())
	if err != nil {
		t.Fatalf("ReadProgrammingMonitorSnapshot: %v", err)
	}
	if !truth.SafeState || !truth.SafeStateNoControllerOnly || truth.Task == nil || truth.Task.TaskID != "main" || len(truth.Points) != 2 {
		t.Fatalf("snapshot envelope sai: %+v", truth)
	}
	local := truth.Points[0]
	if local.Category != "LOCAL" || local.ActualValue != 62.0 || local.ProgramValue == nil || *local.ProgramValue != 41.0 || local.ObservedAt != "2026-08-13T00:00:02Z" {
		t.Fatalf("LOCAL không dùng end-scan truth: %+v", local)
	}
	external := truth.Points[1]
	if external.Category != "MB_RTU" || external.ActualValue != 99.0 || external.ProgramValue != nil || external.ObservedAt != "2026-08-13T00:00:01Z" || external.Quality != "STALE" {
		t.Fatalf("MB_RTU bị overlay nhầm theo ID vật lý: %+v", external)
	}
}

func uint32Ptr(value uint32) *uint32 { return &value }
