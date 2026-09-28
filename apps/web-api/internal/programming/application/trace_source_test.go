package application

import (
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
