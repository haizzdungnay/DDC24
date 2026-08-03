package historian

import (
	"testing"
	"time"
)

func TestClockTrackerSuspendsOnBackwardJumpUntilDurableFrontier(t *testing.T) {
	clock := NewClockTracker()
	clock.SetDurableBucket(10_000)
	clock.Observe(10_000, uint64(time.Second))
	gap := clock.Observe(5_000, uint64(2*time.Second))
	if gap == nil || gap.Reason != "clock" || !clock.Suspended() {
		t.Fatalf("gap/suspended = %+v/%v", gap, clock.Suspended())
	}
	clock.Observe(11_001, uint64(8*time.Second))
	if clock.Suspended() {
		t.Fatal("lifecycle không resume sau durable frontier")
	}
}
