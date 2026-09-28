package application

import (
	"context"
	"math"
	"testing"
	"time"
)

// U-02 (REC-DDC-FIELD-USE-20260927) — phiên Trace chạy bằng đường poll monitor
// phải đếm mọi chu kỳ nằm lọt giữa hai snapshot là mẫu rơi. Trên bo, phiên thứ
// hai của một Trace 100 ms nhận 111 mẫu trong 55,5 s (cách nhau 132–1 065 ms)
// mà vẫn báo `droppedSamples = 0`.
func TestTracePollCountsPeriodsMissedBetweenSnapshots(t *testing.T) {
	const traceID = "5d6a8f5e-51f1-4f59-9d8f-3d2b4c1a0e01"
	base := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	service := &RuntimeService{traces: newRuntimeTraceStore(), now: func() time.Time { return base }}
	service.traces.sessions[traceID] = &traceSession{
		view: TraceView{
			TraceID: traceID, State: "RUNNING", VariableIDs: []string{monitorVariableID},
			SamplePeriodMS: 100, EffectiveSamplePeriodMS: 100,
		},
		maxSamples: 100,
	}
	snapshot := func(offset time.Duration) MonitorPageView {
		return MonitorPageView{Items: []MonitorSampleView{{
			VariableID: monitorVariableID, Quality: "GOOD", Freshness: "LIVE",
			ObservedAt: base.Add(offset).Format(time.RFC3339Nano),
		}}}
	}
	// 0 ms, 100 ms (liền kề), 603 ms (bỏ 4 chu kỳ, jitter 3 ms không tính thêm),
	// 603 ms lặp lại (chưa có snapshot mới: không phải mẫu, không phải rơi).
	for _, offset := range []time.Duration{0, 100 * time.Millisecond, 603 * time.Millisecond, 603 * time.Millisecond} {
		if !service.captureTraceSample(traceID, snapshot(offset)) {
			t.Fatalf("captureTraceSample(%v) báo hết quota", offset)
		}
	}
	view, err := service.GetTrace(traceID)
	if err != nil {
		t.Fatalf("GetTrace: %v", err)
	}
	if len(view.Samples) != 3 {
		t.Fatalf("số mẫu = %d, muốn 3", len(view.Samples))
	}
	if view.DroppedSamples != 4 {
		t.Fatalf("droppedSamples = %d, muốn 4 (chu kỳ 200/300/400/500 ms không có mẫu)", view.DroppedSamples)
	}
}

func TestTracePollMissedPeriods(t *testing.T) {
	at := func(ms int) string {
		return time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC).Add(time.Duration(ms) * time.Millisecond).Format(time.RFC3339Nano)
	}
	cases := []struct {
		name            string
		previous, after string
		period          int
		want            uint32
	}{
		{"liền kề", at(0), at(100), 100, 0},
		{"jitter không thành mẫu rơi", at(0), at(149), 100, 0},
		{"bỏ một chu kỳ", at(0), at(200), 100, 1},
		{"đo trên bo 1 065 ms", at(0), at(1065), 100, 10},
		{"mốc chạy lùi", at(500), at(100), 100, 0},
		{"mốc hỏng", "không-phải-thời-gian", at(100), 100, 0},
		{"chu kỳ không hợp lệ", at(0), at(1000), 0, 0},
	}
	for _, tc := range cases {
		if got := tracePollMissedPeriods(tc.previous, tc.after, tc.period); got != tc.want {
			t.Errorf("%s: %d, muốn %d", tc.name, got, tc.want)
		}
	}
	if got := saturatingAddUint32(math.MaxUint32-1, 5); got != math.MaxUint32 {
		t.Fatalf("cộng bão hoà sai: %d", got)
	}
}

// U-09 — `ON_CHANGE` giữ mẫu Core chỉ khi có ô đổi, mỗi mẫu mang `cycle`. Dãy
// 21,5 ×3 rồi 22,0 ×2 phải còn đúng 2 mẫu ở chu kỳ 1 và 4, 0 mẫu rơi.
func TestTraceOnChangeKeepsOnlyChangedCoreSamplesWithCycle(t *testing.T) {
	service, _ := newMonitorTraceService(t)
	bits := func(value float32) uint64 { return uint64(math.Float32bits(value)) }
	samples := make([]traceReadSample, 0, 5)
	for index, value := range []float32{21.5, 21.5, 21.5, 22.0, 22.0} {
		samples = append(samples, traceReadSample{
			TimestampNS: 1_000_000_000 + uint64(index)*100_000_000,
			Values:      []traceReadCell{{Valid: true, Bits: bits(value)}},
		})
	}
	reader := &traceCoreReader{
		fakeRuntimeStatusReader: fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)},
		samples:                 samples,
	}
	service.runtime = reader
	accepted, err := service.CreateTrace(context.Background(), TraceRequest{
		SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID},
		DurationMS: 5000, SamplePeriodMS: 100, SampleMode: traceSampleModeOnChange,
	}, Actor{ID: "admin", Role: "admin"}, "trace-idem-u09-0001", "monitor-test-u09-01")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}
	var view TraceView
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, reads, _ := reader.counts()
		if view, err = service.GetTrace(accepted.TraceID); err == nil && reads > 0 && len(view.Samples) >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	_ = service.StopTrace(context.Background(), accepted.TraceID, Actor{ID: "admin", Role: "admin"}, "monitor-test-u09-02")
	if view.SampleMode != traceSampleModeOnChange {
		t.Fatalf("sampleMode = %q", view.SampleMode)
	}
	if len(view.Samples) != 2 {
		t.Fatalf("số mẫu giữ = %d, muốn 2", len(view.Samples))
	}
	if view.Samples[0].Cycle != 1 || view.Samples[1].Cycle != 4 {
		t.Fatalf("cycle = %d, %d; muốn 1, 4", view.Samples[0].Cycle, view.Samples[1].Cycle)
	}
	if view.DroppedSamples != 0 {
		t.Fatalf("mẫu bị bỏ vì không đổi không phải mẫu rơi: droppedSamples=%d", view.DroppedSamples)
	}
}

func TestTraceRequestRejectsUnknownSampleMode(t *testing.T) {
	request := TraceRequest{SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID},
		DurationMS: 1000, SamplePeriodMS: 100, SampleMode: "SOMETIMES"}
	if err := validateTraceRequest(request); err == nil {
		t.Fatal("sampleMode lạ phải bị từ chối")
	}
	for _, mode := range []string{"", traceSampleModeEvery, traceSampleModeOnChange} {
		request.SampleMode = mode
		if err := validateTraceRequest(request); err != nil {
			t.Fatalf("sampleMode %q bị từ chối: %v", mode, err)
		}
	}
}
