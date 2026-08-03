package historian

import "time"

type ClockTracker struct {
	anchored          bool
	anchorUTCMS       int64
	anchorMonotonicNS uint64
	durableBucketMS   int64
	suspended         bool
}

func NewClockTracker() *ClockTracker { return &ClockTracker{} }

func (c *ClockTracker) Observe(observedUTCMS int64, monotonicNS uint64) *HistoryGap {
	if !c.anchored {
		c.anchor(observedUTCMS, monotonicNS)
		return nil
	}
	if monotonicNS < c.anchorMonotonicNS {
		gap := &HistoryGap{FromUTCMS: observedUTCMS, ToUTCMS: c.anchorUTCMS, Reason: "clock", Detail: "monotonic_discontinuity", CreatedAtUTCMS: observedUTCMS}
		c.anchor(observedUTCMS, monotonicNS)
		return gap
	}
	elapsedMS := int64((monotonicNS - c.anchorMonotonicNS) / uint64(time.Millisecond))
	expectedUTCMS := c.anchorUTCMS + elapsedMS
	delta := observedUTCMS - expectedUTCMS
	if delta > 2000 || delta < -2000 {
		from, to := expectedUTCMS, observedUTCMS
		if from > to {
			from, to = to, from
			c.suspended = observedUTCMS <= c.durableBucketMS
		}
		c.anchor(observedUTCMS, monotonicNS)
		return &HistoryGap{FromUTCMS: from, ToUTCMS: to, Reason: "clock", Detail: "clock_discontinuity", CreatedAtUTCMS: observedUTCMS}
	}
	if c.suspended && observedUTCMS > c.durableBucketMS {
		c.suspended = false
		c.anchor(observedUTCMS, monotonicNS)
	}
	return nil
}

func (c *ClockTracker) SetDurableBucket(bucketUTCMS int64) { c.durableBucketMS = bucketUTCMS }
func (c *ClockTracker) Suspended() bool                    { return c.suspended }

func (c *ClockTracker) BackwardJump(observedUTCMS int64, monotonicNS uint64) bool {
	if c == nil || !c.anchored || monotonicNS < c.anchorMonotonicNS {
		return false
	}
	elapsedMS := int64((monotonicNS - c.anchorMonotonicNS) / uint64(time.Millisecond))
	return observedUTCMS < c.anchorUTCMS+elapsedMS-2000
}

func (c *ClockTracker) anchor(utcMS int64, monotonicNS uint64) {
	c.anchored, c.anchorUTCMS, c.anchorMonotonicNS = true, utcMS, monotonicNS
}
