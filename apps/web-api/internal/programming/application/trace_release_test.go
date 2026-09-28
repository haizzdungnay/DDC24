package application

import (
	"context"
	"math"
	"testing"
	"time"
)

// Issue #798 (U-04) — mẫu Trace mang số release, lý do thiếu giá trị, và tách
// lệnh (`commandedValue`) khỏi giá trị đọc lại (`readbackValue`)
// (`SW-TRACE-RELEASE-COHERENT-MK-DDC-24-VI`).

func runReleaseTrace(t *testing.T, reader *traceCoreReader, want int) TraceView {
	t.Helper()
	service, _ := newMonitorTraceService(t)
	service.runtime = reader
	accepted, err := service.CreateTrace(context.Background(), TraceRequest{
		SchemaVersion: "1.0", VariableIDs: []string{monitorVariableID},
		DurationMS: 5000, SamplePeriodMS: 100,
	}, Actor{ID: "admin", Role: "admin"}, "trace-idem-798-0001", "monitor-test-798-01")
	if err != nil {
		t.Fatalf("CreateTrace: %v", err)
	}
	var view TraceView
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, reads, _ := reader.counts()
		if view, err = service.GetTrace(accepted.TraceID); err == nil && reads > 0 && len(view.Samples) >= want {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	_ = service.StopTrace(context.Background(), accepted.TraceID, Actor{ID: "admin", Role: "admin"}, "monitor-test-798-02")
	if len(view.Samples) != want {
		t.Fatalf("số mẫu = %d, muốn %d", len(view.Samples), want)
	}
	return view
}

func realBits(value float32) uint64 { return uint64(math.Float32bits(value)) }

// T-798-4: điểm đầu ra chưa theo kịp lệnh ⇒ `readbackValue` khác
// `commandedValue`, `readbackAgeMs` tăng giữa hai lần poll; `actualValue` là số
// đọc lại chứ không phải lệnh.
func TestTraceReadbackIsSeparateFromCommand(t *testing.T) {
	reader := &traceCoreReader{
		fakeRuntimeStatusReader: fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)},
		samples: []traceReadSample{
			{TimestampNS: 1_000_000_000, Values: []traceReadCell{{Valid: true, Bits: realBits(1), Extended: true,
				Reason: traceCellReasonOK, ReleaseSeq: 7, ReadbackState: traceReadbackValid, ReadbackBits: realBits(0), ReadbackAgeMS: 400}}},
			{TimestampNS: 1_100_000_000, Values: []traceReadCell{{Valid: true, Bits: realBits(1), Extended: true,
				Reason: traceCellReasonOK, ReleaseSeq: 8, ReadbackState: traceReadbackValid, ReadbackBits: realBits(0), ReadbackAgeMS: 500}}},
			{TimestampNS: 1_200_000_000, Values: []traceReadCell{{Valid: true, Bits: realBits(1), Extended: true,
				Reason: traceCellReasonOK, ReleaseSeq: 9, ReadbackState: traceReadbackUnavailable}}},
		},
	}
	view := runReleaseTrace(t, reader, 3)
	first := view.Samples[0].Values[0]
	if first.CommandedValue != float32(1) || first.ReadbackValue != float32(0) {
		t.Fatalf("lệnh/đọc lại = %v/%v, muốn 1/0", first.CommandedValue, first.ReadbackValue)
	}
	if first.ActualValue != first.ReadbackValue {
		t.Fatalf("actualValue = %v phải bằng readbackValue, không chép lệnh", first.ActualValue)
	}
	if first.ReadbackAgeMS == nil || *first.ReadbackAgeMS != 400 ||
		view.Samples[1].Values[0].ReadbackAgeMS == nil || *view.Samples[1].Values[0].ReadbackAgeMS != 500 {
		t.Fatalf("tuổi đọc lại phải tăng 400 → 500: %+v / %+v", first.ReadbackAgeMS, view.Samples[1].Values[0].ReadbackAgeMS)
	}
	if first.ReleaseSeq == nil || *first.ReleaseSeq != 7 {
		t.Fatalf("releaseSeq = %v", first.ReleaseSeq)
	}
	unavailable := view.Samples[2].Values[0]
	if unavailable.CommandedValue != float32(1) || unavailable.ReadbackValue != nil ||
		unavailable.ActualValue != nil || unavailable.ReadbackAgeMS != nil {
		t.Fatalf("điểm đầu ra không đọc được phải để trống đọc lại, giữ lệnh: %+v", unavailable)
	}
}

// T-798-5: biến không có kênh đọc lại ⇒ `actualValue` rỗng, không còn bằng
// `programValue`. Ô NOT_RELEASED không mang giá trị và nói rõ lý do; ô
// UNRESOLVED không có số release.
func TestTraceActualValueNoLongerCopiesProgramValue(t *testing.T) {
	notReleased := "NOT_RELEASED"
	unresolved := "UNRESOLVED"
	reader := &traceCoreReader{
		fakeRuntimeStatusReader: fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)},
		samples: []traceReadSample{
			{TimestampNS: 1_000_000_000, Values: []traceReadCell{{Valid: true, Bits: realBits(21.5), Extended: true,
				Reason: traceCellReasonOK, ReleaseSeq: 3, ReadbackState: traceReadbackNone}}},
			{TimestampNS: 1_010_000_000, Values: []traceReadCell{{Extended: true,
				Reason: traceCellReasonNotReleased, ReleaseSeq: 3}}},
			{TimestampNS: 1_020_000_000, Values: []traceReadCell{{Extended: true, Reason: traceCellReasonUnresolved}}},
		},
	}
	view := runReleaseTrace(t, reader, 3)
	value := view.Samples[0].Values[0]
	if value.ProgramValue != float32(21.5) || value.ActualValue != nil || value.CommandedValue != nil || value.ReadbackValue != nil {
		t.Fatalf("biến không gắn điểm đầu ra: %+v", value)
	}
	held := view.Samples[1].Values[0]
	if held.ProgramValue != nil || held.UnavailableReason == nil || *held.UnavailableReason != notReleased ||
		held.Quality != "UNKNOWN" || held.Freshness != "UNAVAILABLE" || held.ReleaseSeq == nil || *held.ReleaseSeq != 3 {
		t.Fatalf("ô NOT_RELEASED: %+v", held)
	}
	missing := view.Samples[2].Values[0]
	if missing.UnavailableReason == nil || *missing.UnavailableReason != unresolved || missing.ReleaseSeq != nil || missing.Quality != "BAD" {
		t.Fatalf("ô UNRESOLVED: %+v", missing)
	}
}

// Core đời trước #798 từ chối `cellFormat` bằng `IPC-PAYLOAD`: BE đọc tiếp bằng
// dạng cũ thay vì mất phiên, và ô dạng cũ không bịa số đọc lại.
func TestTraceFallsBackToLegacyCellsOnOldCore(t *testing.T) {
	reader := &traceCoreReader{
		fakeRuntimeStatusReader: fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY", active: stringPointer(monitorRevisionID)},
		legacyOnly:              true,
		samples: []traceReadSample{
			{TimestampNS: 1_000_000_000, Values: []traceReadCell{{Valid: true, Bits: realBits(21.5)}}},
		},
	}
	view := runReleaseTrace(t, reader, 1)
	reader.mu.Lock()
	legacyReads := reader.legacyReads
	reader.mu.Unlock()
	if legacyReads == 0 {
		t.Fatal("BE không rơi về dạng cũ khi Core cũ từ chối cellFormat")
	}
	value := view.Samples[0].Values[0]
	if value.ProgramValue != float32(21.5) || value.ActualValue != nil || value.ReleaseSeq != nil {
		t.Fatalf("ô dạng cũ: %+v", value)
	}
}

// Ô dạng 1 và dạng 2 giải mã được cùng một kiểu; số phần tử khác 2/7 bị từ chối.
func TestTraceReadCellDecodesBothFormats(t *testing.T) {
	for _, cell := range []traceReadCell{
		{Valid: true, Bits: 5},
		{Valid: true, Bits: 5, Extended: true, Reason: 2, ReleaseSeq: 9, ReadbackState: 1, ReadbackBits: 4, ReadbackAgeMS: 12},
	} {
		encoded, err := cell.MarshalCBOR()
		if err != nil {
			t.Fatal(err)
		}
		var decoded traceReadCell
		if err := decoded.UnmarshalCBOR(encoded); err != nil || decoded != cell {
			t.Fatalf("giải mã %+v → %+v (%v)", cell, decoded, err)
		}
	}
	var decoded traceReadCell
	if err := decoded.UnmarshalCBOR([]byte{0x83, 0xf5, 0x01, 0x02}); err == nil {
		t.Fatal("ô 3 phần tử phải bị từ chối")
	}
}
