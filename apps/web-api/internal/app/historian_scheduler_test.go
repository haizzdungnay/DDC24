package app

import (
	"context"
	"errors"
	"math"
	"path/filepath"
	"testing"
	"time"
)

type historianSnapshotReaderStub struct {
	snapshot RuntimePointSnapshot
	reads    int
	err      error
}

type historianRefreshCoreStub struct {
	snapshot RuntimePointSnapshot
}

func (r *historianRefreshCoreStub) ReadStatus(context.Context) (CoreStatus, error) {
	return CoreStatus{CoreAvailable: true}, nil
}

func (r *historianRefreshCoreStub) ReadPointSnapshot(context.Context) (RuntimePointSnapshot, error) {
	return r.snapshot, nil
}

func (r *historianSnapshotReaderStub) ReadPointSnapshot(context.Context) (RuntimePointSnapshot, error) {
	r.reads++
	if r.err != nil {
		return RuntimePointSnapshot{}, r.err
	}
	return r.snapshot, nil
}

func TestHistorianScheduleSupportsAllFixedIntervalsWithoutDrift(t *testing.T) {
	anchorUTC := time.Date(2026, 7, 20, 10, 0, 0, 250_000_000, time.UTC)
	const anchorMono = uint64(5_000_000_000)
	for _, value := range historianIntervals {
		intervalMS, ok := historianIntervalMilliseconds(value)
		if !ok {
			t.Fatalf("interval %s missing", value)
		}
		policy := HistorianPolicy{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: value, StartAtUTC: anchorUTC.Format(time.RFC3339Nano)}
		schedule, err := newHistorianPointSchedule(7, policy, anchorUTC, anchorMono)
		if err != nil {
			t.Fatalf("interval %s: %v", value, err)
		}
		firstUTC := floorHistorianBoundary(anchorUTC.UnixMilli(), intervalMS) + intervalMS
		for cycle := int64(0); cycle < 1000; cycle++ {
			wantUTC := firstUTC + cycle*intervalMS
			wantMono := anchorMono + uint64(wantUTC-anchorUTC.UnixMilli())*uint64(time.Millisecond)
			if schedule.nextUTCMS != wantUTC || schedule.nextMonotonicNS != wantMono {
				t.Fatalf("interval %s cycle %d: due=(%d,%d) want=(%d,%d)", value, cycle, schedule.nextUTCMS, schedule.nextMonotonicNS, wantUTC, wantMono)
			}
			if !schedule.advance(wantMono) {
				t.Fatalf("interval %s cycle %d not due", value, cycle)
			}
		}
	}
}

func TestHistorianScheduleFutureStartNeverSamplesEarly(t *testing.T) {
	anchorUTC := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	startUTC := anchorUTC.Add(17 * time.Second)
	policy := HistorianPolicy{PointID: "AO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "5s", StartAtUTC: startUTC.Format(time.RFC3339)}
	schedule, err := newHistorianPointSchedule(8, policy, anchorUTC, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	wantUTC := startUTC.UnixMilli() + 3_000
	if schedule.nextUTCMS != wantUTC {
		t.Fatalf("next UTC = %d, want %d", schedule.nextUTCMS, wantUTC)
	}
	if schedule.advance(schedule.nextMonotonicNS - 1) {
		t.Fatal("future policy became due before start boundary")
	}
}

func TestHistorianScheduleRestartUsesNextBoundaryWithoutBackfill(t *testing.T) {
	restartUTC := time.Date(2026, 7, 20, 10, 1, 47, 0, time.UTC)
	policy := HistorianPolicy{PointID: "DO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: time.Date(2026, 7, 20, 9, 0, 0, 0, time.UTC).Format(time.RFC3339)}
	schedule, err := newHistorianPointSchedule(9, policy, restartUTC, 9_000)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 7, 20, 10, 2, 0, 0, time.UTC).UnixMilli()
	if schedule.nextUTCMS != want {
		t.Fatalf("restart next UTC = %d, want %d", schedule.nextUTCMS, want)
	}
	if schedule.policyRevision != 9 || schedule.pointID != "DO-01" || schedule.generation != 1 {
		t.Fatalf("schedule identity changed: %+v", schedule)
	}
}

func TestHistorianScheduleRejectsDisabledOrMalformedPolicy(t *testing.T) {
	now := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	tests := []HistorianPolicy{
		{PointID: "UI-01", Generation: 1, DBInterval: "1s", StartAtUTC: now.Format(time.RFC3339)},
		{PointID: "", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", StartAtUTC: now.Format(time.RFC3339)},
		{PointID: "UI-01", Generation: 0, DBLoggingEnabled: true, DBInterval: "1s", StartAtUTC: now.Format(time.RFC3339)},
		{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "2s", StartAtUTC: now.Format(time.RFC3339)},
		{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", StartAtUTC: "bad"},
	}
	for i, policy := range tests {
		if _, err := newHistorianPointSchedule(1, policy, now, 0); err == nil {
			t.Fatalf("case %d accepted malformed policy", i)
		}
	}
}

func TestHistorianSnapshotFanoutUsesOneValidatedSnapshot(t *testing.T) {
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{
		SnapshotObservedAtUTC: "2026-07-20T10:00:15Z", CapturedMonotonicNs: 15_000_000_000,
		Points: []RuntimePoint{
			{ID: "AO-01", Kind: "AO", Value: 12.5, Quality: "GOOD", Source: "schedule", Role: "resolved_setpoint", Generation: 1},
			{ID: "DO-01", Kind: "DO", Value: 1.0, Quality: "GOOD", Source: "io", Role: "hardware_feedback", Generation: 1},
		},
	}}
	policies := []HistorianPolicy{
		{PointID: "AO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"},
		{PointID: "DO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"},
	}
	samples, gaps, err := collectHistorianDueSamples(context.Background(), reader, policies, 3, 15_000_000_000)
	if err != nil || reader.reads != 1 || len(gaps) != 0 || len(samples) != 2 {
		t.Fatalf("samples=%+v gaps=%+v reads=%d err=%v", samples, gaps, reader.reads, err)
	}
	if samples[0].Value != samples[1].Value && samples[0].PointID == samples[1].PointID {
		t.Fatal("unexpected fanout identity")
	}
}

func TestHistorianRuntimeRegistryIsGenerationAwareAndRejectsConfigValue(t *testing.T) {
	registry := NewHistorianRuntimeRegistry()
	if !registry.Update(RuntimePoint{ID: "VP-01", Generation: 2, Value: 42.0, Quality: "GOOD"}) {
		t.Fatal("runtime update rejected")
	}
	if registry.Update(RuntimePoint{ID: "VP-01", Generation: 1, Value: 7.0, Quality: "GOOD"}) {
		t.Fatal("stale generation accepted")
	}
	points := registry.Snapshot()
	if len(points) != 1 || points[0].Value != 42.0 {
		t.Fatalf("registry snapshot=%+v", points)
	}
}

func TestHistorianRuntimeSnapshotReaderUnionsVPRegistryWithoutConfigFallback(t *testing.T) {
	base := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{SnapshotID: 2, SnapshotObservedAtUTC: "2026-07-20T10:00:00Z", CapturedMonotonicNs: 10, Points: []RuntimePoint{{ID: "UI-01", Generation: 1}}}}
	registry := NewHistorianRuntimeRegistry()
	registry.Update(RuntimePoint{ID: "VP1", Kind: "VP", Generation: 3, Value: 7.5, Quality: "GOOD", Source: "web"})
	reader := historianRuntimeSnapshotReader{physical: base, virtual: registry}
	snapshot, err := reader.ReadPointSnapshot(context.Background())
	if err != nil || base.reads != 1 || len(snapshot.Points) != 2 || snapshot.Points[1].ID != "VP1" || snapshot.Points[1].Value != 7.5 {
		t.Fatalf("snapshot=%+v reads=%d err=%v", snapshot, base.reads, err)
	}
}

func TestHistorianRamTailRetentionCapacityAndClockInvalidIsolation(t *testing.T) {
	cache, err := NewHistorianRAMCache(64 << 20)
	if err != nil {
		t.Fatal(err)
	}
	for i := int64(0); i < 601; i++ {
		if err := cache.Append(HistorianRawSample{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: i * 1000, Value: float64(i), Quality: 0, Source: "io"}); err != nil {
			t.Fatal(err)
		}
	}
	rows := cache.Raw("UI-01", 1, 1000, 600_000)
	if len(rows) != 600 || rows[0].ObservedUTCMS != 1000 {
		t.Fatalf("retained rows=%d first=%+v", len(rows), rows[0])
	}
	if got := cache.Raw("UI-01", 1, 1000, 600_000, true); len(got) != 0 {
		t.Fatal("clock-invalid rows exposed")
	}
	if _, err := NewHistorianRAMCache(1); err == nil {
		t.Fatal("capacity ceiling accepted impossible cache")
	}
}

func TestHistorianHotFoldDeterministicAndRejectsNonfinite(t *testing.T) {
	rows := []HistorianRawSample{
		{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: 15_001, Value: 3, Quality: 0, Source: "io"},
		{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: 15_005, Value: 1, Quality: 2, Source: "io"},
		{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: 15_005, Value: 2, Quality: 1, Source: "manual"},
	}
	hot, err := foldHistorianHot(rows, 9)
	if err != nil || hot.Value != 2 || hot.Min != 1 || hot.Max != 3 || hot.Sum != 6 || hot.Count != 3 || hot.WorstQuality != 2 || hot.Source != "mixed" {
		t.Fatalf("hot=%+v err=%v", hot, err)
	}
	rows[0].Value = math.NaN()
	if _, err := foldHistorianHot(rows, 9); err == nil {
		t.Fatal("nonfinite sample accepted")
	}
}

func TestHistorianQueueOverflowCoalescesExplicitGap(t *testing.T) {
	queue := NewHistorianDueQueue(2)
	queue.Enqueue(HistorianDueRecord{PointID: "UI-01", Generation: 1, FromUTCMS: 1000, ToUTCMS: 2000})
	queue.Enqueue(HistorianDueRecord{PointID: "UI-01", Generation: 1, FromUTCMS: 2000, ToUTCMS: 3000})
	if queue.Enqueue(HistorianDueRecord{PointID: "UI-01", Generation: 1, FromUTCMS: 3000, ToUTCMS: 4000}) {
		t.Fatal("overflow enqueue blocked or accepted")
	}
	if queue.Enqueue(HistorianDueRecord{PointID: "UI-01", Generation: 1, FromUTCMS: 4000, ToUTCMS: 5000}) {
		t.Fatal("second overflow accepted")
	}
	gap, ok := queue.OverflowGap(6000)
	if !ok || gap.PointID != "UI-01" || gap.Generation != 1 || gap.FromUTCMS != 3000 || gap.ToUTCMS != 5000 || gap.Reason != "queue" || gap.Detail != "queue_overflow" {
		t.Fatalf("gap=%+v ok=%v", gap, ok)
	}
}

func TestHistorianClockDiscontinuityForwardAndBackward(t *testing.T) {
	clock := NewHistorianClockTracker()
	if gap := clock.Observe(10_000, 10_000_000_000); gap != nil {
		t.Fatal(gap)
	}
	if gap := clock.Observe(13_001, 11_000_000_000); gap == nil || gap.Reason != "clock" {
		t.Fatalf("forward gap=%+v", gap)
	}
	clock.SetDurableBucket(12_000)
	if gap := clock.Observe(11_000, 12_000_000_000); gap == nil || gap.Reason != "clock" || !clock.Suspended() {
		t.Fatalf("backward gap=%+v suspended=%v", gap, clock.Suspended())
	}
	clock.Observe(12_001, 13_000_000_000)
	if clock.Suspended() {
		t.Fatal("clock did not resume after durable bucket")
	}
	if gap := clock.Observe(12_002, 12_000_000_000); gap == nil || gap.Reason != "clock" {
		t.Fatal("monotonic regression was not treated as clock discontinuity")
	}
}

func TestHistorianClockTrackerTreatsMonotonicRollbackAsDiscontinuity(t *testing.T) {
	clock := NewHistorianClockTracker()
	clock.Observe(10_000, 10_000_000_000)
	if gap := clock.Observe(9_000, 9_000_000_000); gap == nil || gap.Reason != "clock" {
		t.Fatalf("rollback gap=%+v", gap)
	}
}

func TestHistorianSnapshotMissingOrBadCreatesGapWithoutHoldLast(t *testing.T) {
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{
		SnapshotObservedAtUTC: "2026-07-20T10:00:15Z", CapturedMonotonicNs: 15_000_000_000,
		Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 12.5, Quality: "BAD", Source: "io", Generation: 1}},
	}}
	policies := []HistorianPolicy{
		{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", StartAtUTC: "2026-07-20T09:00:00Z"},
		{PointID: "AO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", StartAtUTC: "2026-07-20T09:00:00Z"},
	}
	samples, gaps, err := collectHistorianDueSamples(context.Background(), reader, policies, 4, 15_000_000_000)
	if err != nil || len(samples) != 0 || len(gaps) != 2 {
		t.Fatalf("samples=%+v gaps=%+v err=%v", samples, gaps, err)
	}
}

func TestHistorianRamCapacityFailureDoesNotMutateCache(t *testing.T) {
	cache, err := NewHistorianRAMCache(historianRawSampleBytes)
	if err != nil {
		t.Fatal(err)
	}
	first := HistorianRawSample{PointID: "UI-01", Generation: 1, IntervalMS: 1000, ObservedUTCMS: 1000, Value: 1, Quality: 0, Source: "io"}
	if err := cache.Append(first); err != nil {
		t.Fatal(err)
	}
	second := first
	second.ObservedUTCMS = 2000
	if err := cache.Append(second); err == nil {
		t.Fatal("capacity overflow accepted")
	}
	rows := cache.Raw("UI-01", 1, 0, 3000)
	if len(rows) != 1 || rows[0].ObservedUTCMS != 1000 {
		t.Fatalf("cache mutated after rejection: %+v", rows)
	}
}

type historianSinkStub struct {
	hot    []HotSample
	gaps   []HistoryGap
	hotErr error
}

type blockingHistorianSink struct {
	entered chan struct{}
	release chan struct{}
}

func (s *blockingHistorianSink) InsertHotBatch(context.Context, []HotSample) error {
	close(s.entered)
	<-s.release
	return nil
}

func (*blockingHistorianSink) InsertGap(context.Context, HistoryGap) error { return nil }

type historianFrontierStub struct{ bucket int64 }

func (f historianFrontierStub) LastHotBucket(context.Context, string, uint64) (int64, bool, error) {
	return f.bucket, f.bucket > 0, nil
}

func TestHistorianShadowSchedulerRecordsQueueOverflowForEveryActiveIdentity(t *testing.T) {
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 7, Points: []HistorianPolicy{
		{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", StartAtUTC: "2026-07-20T09:00:00Z"},
		{PointID: "AO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "3s", StartAtUTC: "2026-07-20T09:00:00Z"},
	}}
	scheduler, err := NewHistorianShadowScheduler(config, &historianSnapshotReaderStub{}, sink, time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC), 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := scheduler.RecordQueueOverflow(context.Background(), 1000, 2000); err != nil {
		t.Fatal(err)
	}
	if len(sink.gaps) != 2 {
		t.Fatalf("gaps=%+v", sink.gaps)
	}
	for _, gap := range sink.gaps {
		if gap.Reason != "queue" || gap.Detail != "queue_overflow" || gap.FromUTCMS != 1000 || gap.ToUTCMS != 2000 {
			t.Fatalf("gap=%+v", gap)
		}
	}
}

func TestHistorianShadowSchedulerPreparesRestartGapWithoutBackfill(t *testing.T) {
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 7, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, &historianSnapshotReaderStub{}, sink, time.Date(2026, 7, 20, 10, 1, 0, 0, time.UTC), 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := scheduler.PrepareRestartGaps(context.Background(), historianFrontierStub{bucket: time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC).UnixMilli()}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if len(sink.gaps) != 1 || sink.gaps[0].Reason != "restart" || sink.gaps[0].ToUTCMS <= sink.gaps[0].FromUTCMS {
		t.Fatalf("gaps=%+v", sink.gaps)
	}
}

func TestHistorianRuntimePreparesRestartGapBeforeFirstActiveCycle(t *testing.T) {
	store := openHistorianStoreTest(t)
	policy := []byte(`{"_schema_version":1,"revision":7,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-20T09:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), policy, 1, 1); err != nil {
		t.Fatal(err)
	}
	anchor := time.Date(2026, 7, 20, 10, 1, 0, 0, time.UTC)
	last := anchor.Add(-time.Minute).UnixMilli()
	if err := store.InsertHotBatch(context.Background(), []HotSample{{
		PointID: "UI-01", Generation: 1, BucketUTCMS: last, LastSampleUTCMS: last + 1000,
		Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, WorstQuality: 0, Source: "test", PolicyRevision: 7,
	}}); err != nil {
		t.Fatal(err)
	}
	config := HistorianConfig{Revision: 7, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, &historianSnapshotReaderStub{}, store, anchor, 1)
	if err != nil {
		t.Fatal(err)
	}
	app := &App{historianV2: store, historianAuthority: HistorianRuntimeAuthority{WriterV2: true}, historianShadow: scheduler}
	if !app.ensureHistorianRestartGaps(context.Background(), anchor.UnixMilli()) || !app.historianRestartReady {
		t.Fatal("active runtime did not prepare restart gaps")
	}
	if !app.ensureHistorianRestartGaps(context.Background(), anchor.UnixMilli()) {
		t.Fatal("prepared restart gap should be idempotent")
	}
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM history_gaps WHERE point_id='UI-01' AND reason='restart' AND detail='scheduler_restart_no_backfill'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("restart gaps=%d err=%v", count, err)
	}
}

func TestHistorianShadowSchedulerBackwardClockSuspendsUntilDurableFrontier(t *testing.T) {
	reader := &historianSnapshotReaderStub{}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 9, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	anchor := time.Date(2026, 7, 20, 10, 1, 0, 0, time.UTC)
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, anchor, uint64(60)*uint64(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	frontier := anchor.Add(15 * time.Second).UnixMilli()
	if err := scheduler.PrepareRestartGaps(context.Background(), historianFrontierStub{bucket: frontier}, anchor.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: anchor.Add(-time.Minute).Format(time.RFC3339), CapturedMonotonicNs: uint64(75) * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 1.0, Quality: "GOOD", Source: "io", Generation: 1}}}
	if err := scheduler.RunOnce(context.Background(), anchor.Add(15*time.Second), uint64(75)*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	reader.snapshot.SnapshotObservedAtUTC = anchor.Add(10 * time.Second).Format(time.RFC3339)
	reader.snapshot.CapturedMonotonicNs = uint64(90) * uint64(time.Second)
	if err := scheduler.RunOnce(context.Background(), anchor.Add(30*time.Second), uint64(90)*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 0 {
		t.Fatalf("persisted during rollback suspension: %+v", sink.hot)
	}
	reader.snapshot.SnapshotObservedAtUTC = anchor.Add(31 * time.Second).Format(time.RFC3339)
	reader.snapshot.CapturedMonotonicNs = uint64(105) * uint64(time.Second)
	if err := scheduler.RunOnce(context.Background(), anchor.Add(45*time.Second), uint64(105)*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 0 {
		t.Fatalf("persisted before resumed boundary: %+v", sink.hot)
	}
	// Cycle vượt qua frontier bền vững chỉ ĐẶT LẠI lịch rồi nhường chỗ; mẫu đầu
	// tiên sau khi hồi phục nằm ở cycle kế tiếp. Bản trước thấy hot row ngay tại
	// đây vì `PrepareRestartGaps` gán frontier vào một bản sao rồi vứt đi, nên
	// `durableUntilUTCMS` là 0 và lịch chưa từng bị treo lần nào.
	reader.snapshot.SnapshotObservedAtUTC = anchor.Add(45 * time.Second).Format(time.RFC3339)
	reader.snapshot.CapturedMonotonicNs = uint64(119) * uint64(time.Second)
	if err := scheduler.RunOnce(context.Background(), anchor.Add(59*time.Second), uint64(119)*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 0 {
		t.Fatalf("persisted on the resuming cycle: %+v", sink.hot)
	}
	reader.snapshot.SnapshotObservedAtUTC = anchor.Add(60 * time.Second).Format(time.RFC3339)
	reader.snapshot.CapturedMonotonicNs = uint64(134) * uint64(time.Second)
	if err := scheduler.RunOnce(context.Background(), anchor.Add(74*time.Second), uint64(134)*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 1 {
		t.Fatalf("did not resume beyond durable frontier: %+v", sink.hot)
	}
}

// Frontier bền vững phải sống sót qua `PrepareRestartGaps`, nếu không mọi bảo vệ
// dựa vào nó (treo lịch khi đồng hồ nhảy lùi, lọc row đã bền vững) đều tắt ngóm
// ngay sau mỗi lần khởi động lại.
func TestHistorianShadowSchedulerRestartKeepsDurableFrontier(t *testing.T) {
	config := HistorianConfig{Revision: 7, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	anchor := time.Date(2026, 7, 20, 10, 1, 0, 0, time.UTC)
	scheduler, err := NewHistorianShadowScheduler(config, &historianSnapshotReaderStub{}, &historianSinkStub{}, anchor, 1)
	if err != nil {
		t.Fatal(err)
	}
	frontier := anchor.Add(15 * time.Second).UnixMilli()
	if err := scheduler.PrepareRestartGaps(context.Background(), historianFrontierStub{bucket: frontier}, anchor.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if got := scheduler.schedules[0].durableUntilUTCMS; got != frontier+15000 {
		t.Fatalf("durableUntilUTCMS=%d want=%d", got, frontier+15000)
	}
}

// Khởi động lại xong BÊN TRONG bucket đang mở thì bucket đó vẫn đóng được bằng
// số đo hiện tại, và phần duy nhất còn thiếu mới là gap. Đo trên bo 2026-09-05:
// dịch vụ dừng 11:07:33, lên lại 11:07:47, nhưng cả bucket 11:07:45 bị tuyên bố
// mất trắng nên trang Trends treo cờ PARTIAL cho khoảng vẫn lấy được.
func TestHistorianShadowSchedulerRestartClosesOpenBucketInsteadOfGap(t *testing.T) {
	anchor := time.Date(2026, 9, 5, 11, 7, 47, 0, time.UTC)
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{
		SnapshotObservedAtUTC: anchor.Format(time.RFC3339Nano),
		CapturedMonotonicNs:   uint64(60) * uint64(time.Second),
		Points:                []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 23.5, Quality: "GOOD", Source: "io", Generation: 1}},
	}}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 7, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-09-05T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, anchor, uint64(60)*uint64(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	last := time.Date(2026, 9, 5, 11, 7, 30, 0, time.UTC).UnixMilli()
	if err := scheduler.PrepareRestartGaps(context.Background(), historianFrontierStub{bucket: last}, anchor.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if len(sink.gaps) != 0 {
		t.Fatalf("bucket đang mở vẫn bị báo là gap: %+v", sink.gaps)
	}
	if len(sink.hot) != 1 {
		t.Fatalf("hot=%+v", sink.hot)
	}
	openBucket := time.Date(2026, 9, 5, 11, 7, 45, 0, time.UTC).UnixMilli()
	row := sink.hot[0]
	if row.PointID != "UI-01" || row.BucketUTCMS != openBucket || row.Value != 23.5 || row.Count != 1 {
		t.Fatalf("row=%+v", row)
	}
	// Mẫu phục hồi giữ nguyên thời điểm đo thật, không bị kéo về biên bucket:
	// bản ghi phải nói được rằng nó đóng muộn 2 giây.
	if row.LastSampleUTCMS != anchor.UnixMilli() {
		t.Fatalf("last_sample=%d want=%d", row.LastSampleUTCMS, anchor.UnixMilli())
	}
	// Bucket kế tiếp vẫn theo đúng nhịp cũ, mẫu phục hồi không được đẩy lịch.
	if got := scheduler.schedules[0].nextUTCMS; got != openBucket+15000 {
		t.Fatalf("nextUTCMS=%d want=%d", got, openBucket+15000)
	}
}

// Phần trôi qua trọn vẹn vẫn phải ra gap: chỉ bucket cuối — bucket đang mở lúc
// tiến trình sống lại — mới được đóng bằng số đo hiện tại.
func TestHistorianShadowSchedulerRestartStillReportsFullyMissedBuckets(t *testing.T) {
	anchor := time.Date(2026, 9, 5, 3, 14, 5, 0, time.UTC)
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{
		SnapshotObservedAtUTC: anchor.Format(time.RFC3339Nano),
		CapturedMonotonicNs:   uint64(60) * uint64(time.Second),
		Points:                []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 21, Quality: "GOOD", Source: "io", Generation: 1}},
	}}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 7, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-09-05T03:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, anchor, uint64(60)*uint64(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	last := time.Date(2026, 9, 5, 3, 13, 30, 0, time.UTC).UnixMilli()
	if err := scheduler.PrepareRestartGaps(context.Background(), historianFrontierStub{bucket: last}, anchor.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if len(sink.gaps) != 1 {
		t.Fatalf("gaps=%+v", sink.gaps)
	}
	gap := sink.gaps[0]
	wantFrom := time.Date(2026, 9, 5, 3, 13, 45, 0, time.UTC).UnixMilli()
	wantTo := time.Date(2026, 9, 5, 3, 14, 0, 0, time.UTC).UnixMilli()
	if gap.Reason != "restart" || gap.Detail != "scheduler_restart_no_backfill" || gap.FromUTCMS != wantFrom || gap.ToUTCMS != wantTo {
		t.Fatalf("gap=%+v", gap)
	}
	if len(sink.hot) != 1 || sink.hot[0].BucketUTCMS != wantTo {
		t.Fatalf("hot=%+v", sink.hot)
	}
}

// Không đọc nổi snapshot thì quay về hành vi cũ: báo thiếu trọn khoảng, tuyệt
// đối không dựng một bucket không có số đo nào đứng sau.
func TestHistorianShadowSchedulerRestartFallsBackToFullGapWhenSnapshotUnavailable(t *testing.T) {
	anchor := time.Date(2026, 9, 5, 11, 7, 47, 0, time.UTC)
	reader := &historianSnapshotReaderStub{err: errors.New("core unavailable")}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 7, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-09-05T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, anchor, uint64(60)*uint64(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	last := time.Date(2026, 9, 5, 11, 7, 30, 0, time.UTC).UnixMilli()
	if err := scheduler.PrepareRestartGaps(context.Background(), historianFrontierStub{bucket: last}, anchor.UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 0 {
		t.Fatalf("dựng bucket khi không có số đo: %+v", sink.hot)
	}
	wantTo := time.Date(2026, 9, 5, 11, 8, 0, 0, time.UTC).UnixMilli()
	if len(sink.gaps) != 1 || sink.gaps[0].ToUTCMS != wantTo {
		t.Fatalf("gaps=%+v", sink.gaps)
	}
}

func (s *historianSinkStub) InsertHotBatch(_ context.Context, rows []HotSample) error {
	if s.hotErr != nil {
		return s.hotErr
	}
	s.hot = append(s.hot, rows...)
	return nil
}

func (s *historianSinkStub) InsertGap(_ context.Context, gap HistoryGap) error {
	s.gaps = append(s.gaps, gap)
	return nil
}

func TestHistorianShadowSchedulerUsesImmutablePolicyAndV2Sink(t *testing.T) {
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{
		SnapshotObservedAtUTC: "2026-07-20T10:00:15Z", CapturedMonotonicNs: 15_000_000_000,
		Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 3.5, Quality: "GOOD", Source: "io", Generation: 1}},
	}}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 5, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, time.Date(2026, 7, 20, 10, 0, 14, 0, time.UTC), 14_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if err := scheduler.RunOnce(context.Background(), time.Date(2026, 7, 20, 10, 0, 15, 0, time.UTC), 15_000_000_000); err != nil {
		t.Fatal(err)
	}
	if reader.reads != 1 || len(sink.hot) != 1 || sink.hot[0].PolicyRevision != 5 || sink.hot[0].PointID != "UI-01" {
		t.Fatalf("reads=%d hot=%+v", reader.reads, sink.hot)
	}
}

func TestHistorianShadowSchedulerFeedsTrendCacheWhenDatabasePolicyIsNotDue(t *testing.T) {
	anchor := time.Date(2026, 7, 22, 6, 12, 0, 0, time.UTC)
	const anchorMono = uint64(30_000_000_000)
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{
		SnapshotObservedAtUTC: anchor.Add(15 * time.Second).Format(time.RFC3339Nano),
		CapturedMonotonicNs:   anchorMono + uint64(15*time.Second),
		Points: []RuntimePoint{
			{ID: "UI-01", Kind: "UI", Value: 40.1, Quality: "GOOD", Source: "io", Role: "engineering_value", Generation: 1},
			{ID: "UI-02", Kind: "UI", Value: 12.2, Quality: "GOOD", Source: "io", Role: "engineering_value", Generation: 1},
			{ID: "UI-06", Kind: "UI", Value: 5.4, Quality: "GOOD", Source: "io", Role: "engineering_value", Generation: 1},
		},
	}}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 5, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "60m", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, anchor, anchorMono)
	if err != nil {
		t.Fatal(err)
	}
	cache := NewHistorianTrendCache()
	scheduler.AttachTrendCache(cache)
	if err := scheduler.RunOnce(context.Background(), anchor.Add(15*time.Second), anchorMono+uint64(15*time.Second)); err != nil {
		t.Fatal(err)
	}
	if reader.reads != 1 || len(sink.hot) != 0 || len(sink.gaps) != 0 {
		t.Fatalf("reads=%d hot=%+v gaps=%+v", reader.reads, sink.hot, sink.gaps)
	}
	identities := []HistorianQueryIdentity{{PointID: "UI-01", Generation: 1}, {PointID: "UI-02", Generation: 1}, {PointID: "UI-06", Generation: 1}}
	read := cache.Read(identities, anchor.Add(15*time.Second).UnixMilli(), anchor.Add(30*time.Second).UnixMilli())
	if !read.Available || len(read.Rows) != 3 {
		t.Fatalf("runtime cache read=%+v", read)
	}
}

func TestHistorianShadowSchedulerFoldsFineSamplesBeforeImmutableHotWrite(t *testing.T) {
	reader := &historianSnapshotReaderStub{}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 6, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "5s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, time.Date(2026, 7, 20, 10, 0, 4, 0, time.UTC), 4_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	for _, second := range []int{5, 10, 15} {
		reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: time.Date(2026, 7, 20, 10, 0, second, 0, time.UTC).Format(time.RFC3339), CapturedMonotonicNs: uint64(second) * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: float64(second), Quality: "GOOD", Source: "io", Generation: 1}}}
		if err := scheduler.RunOnce(context.Background(), time.Date(2026, 7, 20, 10, 0, second, 0, time.UTC), uint64(second)*uint64(time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	if len(sink.hot) != 1 || sink.hot[0].BucketUTCMS != time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC).UnixMilli() || sink.hot[0].Count != 2 || sink.hot[0].Value != 10 {
		t.Fatalf("hot=%+v", sink.hot)
	}
}

func TestHistorianShadowSchedulerKeepsFineBucketUntilStorageRecovers(t *testing.T) {
	reader := &historianSnapshotReaderStub{}
	sink := &historianSinkStub{hotErr: errors.New("storage down")}
	config := HistorianConfig{Revision: 8, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "5s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, time.Date(2026, 7, 20, 10, 0, 4, 0, time.UTC), uint64(4)*uint64(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	for _, second := range []int{5, 10, 15} {
		reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: time.Date(2026, 7, 20, 10, 0, second, 0, time.UTC).Format(time.RFC3339), CapturedMonotonicNs: uint64(second) * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: float64(second), Quality: "GOOD", Source: "io", Generation: 1}}}
		_ = scheduler.RunOnce(context.Background(), time.Date(2026, 7, 20, 10, 0, second, 0, time.UTC), uint64(second)*uint64(time.Second))
	}
	sink.hotErr = nil
	reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: "2026-07-20T10:00:20Z", CapturedMonotonicNs: uint64(20) * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 20.0, Quality: "GOOD", Source: "io", Generation: 1}}}
	if err := scheduler.RunOnce(context.Background(), time.Date(2026, 7, 20, 10, 0, 20, 0, time.UTC), uint64(20)*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 1 || sink.hot[0].Count != 2 || sink.hot[0].Value != 10 {
		t.Fatalf("hot=%+v", sink.hot)
	}
	for _, second := range []int{25, 30} {
		reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: time.Date(2026, 7, 20, 10, 0, second, 0, time.UTC).Format(time.RFC3339), CapturedMonotonicNs: uint64(second) * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: float64(second), Quality: "GOOD", Source: "io", Generation: 1}}}
		if err := scheduler.RunOnce(context.Background(), time.Date(2026, 7, 20, 10, 0, second, 0, time.UTC), uint64(second)*uint64(time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	if len(sink.hot) != 2 || sink.hot[1].Count != 3 || sink.hot[1].Value != 25 || sink.hot[1].Sum != 60 {
		t.Fatalf("failed-cycle sample was not retained: hot=%+v", sink.hot)
	}
}

func TestHistorianShadowSchedulerDropsPendingHotAtDurableFrontier(t *testing.T) {
	store := openHistorianStoreTest(t)
	anchor := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	policy := []byte(`{"_schema_version":1,"revision":14,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-20T09:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), policy, 1, 1); err != nil {
		t.Fatal(err)
	}
	durable := HotSample{PointID: "UI-01", Generation: 1, BucketUTCMS: anchor.UnixMilli(), LastSampleUTCMS: anchor.UnixMilli(), Value: 1, Min: 1, Max: 1, Sum: 1, Count: 1, WorstQuality: 0, Source: "io", PolicyRevision: 14}
	if err := store.InsertHotBatch(context.Background(), []HotSample{durable}); err != nil {
		t.Fatal(err)
	}
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{
		SnapshotObservedAtUTC: anchor.Add(15 * time.Second).Format(time.RFC3339),
		CapturedMonotonicNs:   15 * uint64(time.Second),
		Points:                []RuntimePoint{{ID: "UI-01", Kind: "UI", Generation: 1, Value: 15, Quality: "GOOD", Source: "io"}},
	}}
	scheduler, err := NewHistorianShadowScheduler(HistorianConfig{Revision: 14, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}, reader, store, anchor, 0)
	if err != nil {
		t.Fatal(err)
	}
	scheduler.schedules[0].durableUntilUTCMS = anchor.Add(15 * time.Second).UnixMilli()
	poison := durable
	poison.Value, poison.Min, poison.Max, poison.Sum = 2, 2, 2, 2
	scheduler.pendingHot = []HotSample{poison}

	if err := scheduler.RunOnce(context.Background(), anchor.Add(15*time.Second), 15*uint64(time.Second)); err != nil {
		t.Fatalf("durable pending row blocked writer progress: %v", err)
	}
	var count int
	var frontier int64
	if err := store.db.QueryRow(`SELECT COUNT(*),MAX(bucket_utc_ms) FROM hot_samples WHERE point_id='UI-01' AND generation=1`).Scan(&count, &frontier); err != nil {
		t.Fatal(err)
	}
	if count != 2 || frontier != anchor.Add(15*time.Second).UnixMilli() || len(scheduler.pendingHot) != 0 {
		t.Fatalf("count=%d frontier=%d pending=%+v", count, frontier, scheduler.pendingHot)
	}
}

func TestHistorianShadowSchedulerReaderFailureCreatesGapAndAdvancesOnlyAfterGap(t *testing.T) {
	reader := &historianSnapshotReaderStub{err: errors.New("ipc unavailable")}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 10, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "5s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, time.Date(2026, 7, 20, 10, 0, 4, 0, time.UTC), uint64(4)*uint64(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := scheduler.RunOnce(context.Background(), time.Date(2026, 7, 20, 10, 0, 5, 0, time.UTC), uint64(5)*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.gaps) != 1 || sink.gaps[0].Reason != "snapshot" || sink.gaps[0].Detail != "read_failed" {
		t.Fatalf("reader failure gap=%+v", sink.gaps)
	}
	if scheduler.schedules[0].nextUTCMS != time.Date(2026, 7, 20, 10, 0, 10, 0, time.UTC).UnixMilli() {
		t.Fatalf("next boundary advanced incorrectly: %+v", scheduler.schedules[0])
	}
}

func TestHistorianShadowSchedulerLiveBackwardClockUsesDurableFrontier(t *testing.T) {
	reader := &historianSnapshotReaderStub{}
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 11, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}
	anchor := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	scheduler, err := NewHistorianShadowScheduler(config, reader, sink, anchor, 0)
	if err != nil {
		t.Fatal(err)
	}
	reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: anchor.Add(15 * time.Second).Format(time.RFC3339), CapturedMonotonicNs: 15 * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 15, Quality: "GOOD", Source: "io", Generation: 1}}}
	if err := scheduler.RunOnce(context.Background(), anchor.Add(15*time.Second), 15*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 1 {
		t.Fatalf("initial durable sample missing: %+v", sink.hot)
	}
	reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: anchor.Format(time.RFC3339), CapturedMonotonicNs: 30 * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 0, Quality: "GOOD", Source: "io", Generation: 1}}}
	if err := scheduler.RunOnce(context.Background(), anchor.Add(30*time.Second), 30*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	reader.snapshot = RuntimePointSnapshot{SnapshotObservedAtUTC: anchor.Add(20 * time.Second).Format(time.RFC3339), CapturedMonotonicNs: 45 * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Value: 20, Quality: "GOOD", Source: "io", Generation: 1}}}
	if err := scheduler.RunOnce(context.Background(), anchor.Add(45*time.Second), 45*uint64(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(sink.hot) != 1 {
		t.Fatalf("sample persisted during rollback suspension: %+v", sink.hot)
	}
}

func TestHistorianShadowSchedulerQueueOverflowTargetsDueIdentities(t *testing.T) {
	sink := &historianSinkStub{}
	config := HistorianConfig{Revision: 12, Points: []HistorianPolicy{
		{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "1s", StartAtUTC: "2026-07-20T09:00:00Z"},
		{PointID: "AO-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "60m", StartAtUTC: "2026-07-20T09:00:00Z"},
	}}
	scheduler, err := NewHistorianShadowScheduler(config, &historianSnapshotReaderStub{}, sink, time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC), 0)
	if err != nil {
		t.Fatal(err)
	}
	records := scheduler.DueRecords(uint64(time.Second))
	if len(records) != 1 || records[0].PointID != "UI-01" {
		t.Fatalf("due overflow records=%+v", records)
	}
	if err := scheduler.RecordQueueOverflowRecords(context.Background(), records); err != nil {
		t.Fatal(err)
	}
	if len(sink.gaps) != 1 || sink.gaps[0].PointID != "UI-01" {
		t.Fatalf("overflow gaps=%+v", sink.gaps)
	}
}

func TestHistorianShadowRefreshRetriesPolicyMirrorBeforeRevisionActivation(t *testing.T) {
	now := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	service, err := OpenHistorianPolicyService(filepath.Join(t.TempDir(), "historian.conf"), func() time.Time { return now }, func() (uint64, error) { return 1 << 40, nil })
	if err != nil {
		t.Fatal(err)
	}
	service.identities = func() (map[string]uint64, string, error) {
		return map[string]uint64{"UI-01": 1}, "valid", nil
	}
	service.namespaceRevision = func() (uint64, error) { return 1, nil }
	service.mirrorCommitted = func(context.Context, []byte, uint64, uint64) error {
		return errors.New("first mirror unavailable")
	}
	if _, err := service.Update(HistorianConfigUpdate{BaseRevision: 0, BaseNamespaceRevision: 1, Points: []HistorianPolicyPatch{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s"}}}); err != nil {
		t.Fatal(err)
	}
	store, err := OpenHistorianStore(filepath.Join(t.TempDir(), "historian-v2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	core := &historianRefreshCoreStub{snapshot: RuntimePointSnapshot{SnapshotObservedAtUTC: now.Format(time.RFC3339), CapturedMonotonicNs: uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Generation: 1, Value: 1, Quality: "GOOD", Source: "io"}}}}
	app := &App{core: core, historian: service, historianV2: store, virtualPointRuntime: NewHistorianRuntimeRegistry()}
	app.refreshHistorianShadowScheduler(context.Background())
	if app.historianShadow == nil || app.historianShadow.policyRevision != 1 {
		t.Fatalf("shadow revision was not activated after mirror retry: %+v", app.historianShadow)
	}
	var mirrored int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM policy_revisions WHERE revision=1`).Scan(&mirrored); err != nil || mirrored != 1 {
		t.Fatalf("mirrored revision count=%d err=%v", mirrored, err)
	}
}

func TestHistorianShadowDueInspectionDoesNotBlockOnSlowStorage(t *testing.T) {
	anchor := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	reader := &historianSnapshotReaderStub{snapshot: RuntimePointSnapshot{SnapshotObservedAtUTC: anchor.Add(15 * time.Second).Format(time.RFC3339), CapturedMonotonicNs: 15 * uint64(time.Second), Points: []RuntimePoint{{ID: "UI-01", Kind: "UI", Generation: 1, Value: 1, Quality: "GOOD", Source: "io"}}}}
	sink := &blockingHistorianSink{entered: make(chan struct{}), release: make(chan struct{})}
	scheduler, err := NewHistorianShadowScheduler(HistorianConfig{Revision: 13, Points: []HistorianPolicy{{PointID: "UI-01", Generation: 1, DBLoggingEnabled: true, DBInterval: "15s", StartAtUTC: "2026-07-20T09:00:00Z"}}}, reader, sink, anchor, 0)
	if err != nil {
		t.Fatal(err)
	}
	runDone := make(chan error, 1)
	go func() {
		runDone <- scheduler.RunOnce(context.Background(), anchor.Add(15*time.Second), 15*uint64(time.Second))
	}()
	<-sink.entered
	inspectionDone := make(chan struct{})
	go func() {
		_ = scheduler.DueRecords(15 * uint64(time.Second))
		close(inspectionDone)
	}()
	select {
	case <-inspectionDone:
	case <-time.After(time.Second):
		t.Fatal("due inspection blocked behind storage")
	}
	close(sink.release)
	if err := <-runDone; err != nil {
		t.Fatal(err)
	}
}
