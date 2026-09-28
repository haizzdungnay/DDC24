package app

import (
	"bytes"
	"log"
	"strings"
	"testing"
	"time"
)

// U-19 (REC-DDC-FIELD-USE-20260927) — lệnh ghi VP chậm quá ngưỡng phải để lại
// một dòng WARN có phân rã theo pha; lệnh nhanh thì không log gì.
func TestVPWriteTimingReportsOnlySlowWritesWithPhaseBreakdown(t *testing.T) {
	var buffer bytes.Buffer
	logger := log.New(&buffer, "", 0)

	fast := vpWriteTiming{start: time.Now()}
	fast.mark(&fast.lock)
	fast.report(logger, "VP7")
	if buffer.Len() != 0 {
		t.Fatalf("lệnh nhanh không được log: %q", buffer.String())
	}

	slow := vpWriteTiming{start: time.Now().Add(-4 * time.Second)}
	slow.last = slow.start
	slow.lock = 3900 * time.Millisecond
	slow.persist = 60 * time.Millisecond
	slow.report(logger, "VP7")
	line := buffer.String()
	for _, want := range []string{"WARN points.vp_write_slow", "id=VP7", "lock_ms=3900", "persist_ms=60", "total_ms="} {
		if !strings.Contains(line, want) {
			t.Fatalf("thiếu %q trong %q", want, line)
		}
	}
}
