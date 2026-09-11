package app

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

const historianDueQueueLimit = 4096

type HistorianDueRecord struct {
	PointID        string
	Generation     uint64
	FromUTCMS      int64
	ToUTCMS        int64
	PolicyRevision uint64
}

type HistorianDueQueue struct {
	mu       sync.Mutex
	capacity int
	records  []HistorianDueRecord
	overflow map[string]HistoryGap
}

func NewHistorianDueQueue(capacity int) *HistorianDueQueue {
	if capacity <= 0 || capacity > historianDueQueueLimit {
		capacity = historianDueQueueLimit
	}
	return &HistorianDueQueue{capacity: capacity, records: make([]HistorianDueRecord, 0, capacity), overflow: map[string]HistoryGap{}}
}

func (q *HistorianDueQueue) Enqueue(record HistorianDueRecord) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.records) < q.capacity {
		q.records = append(q.records, record)
		return true
	}
	key := historianIdentityKey(record.PointID, record.Generation)
	gap := q.overflow[key]
	if gap.PointID == "" {
		gap = HistoryGap{PointID: record.PointID, Generation: record.Generation, FromUTCMS: record.FromUTCMS, ToUTCMS: record.ToUTCMS, Reason: "queue", Detail: "queue_overflow"}
	} else if record.ToUTCMS > gap.ToUTCMS {
		gap.ToUTCMS = record.ToUTCMS
	}
	q.overflow[key] = gap
	return false
}

func (q *HistorianDueQueue) OverflowGap(createdAtUTCMS int64) (HistoryGap, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.overflow) == 0 {
		return HistoryGap{}, false
	}
	for key, gap := range q.overflow {
		delete(q.overflow, key)
		gap.CreatedAtUTCMS = createdAtUTCMS
		return gap, true
	}
	return HistoryGap{}, false
}

type historianSink interface {
	InsertHotBatch(context.Context, []HotSample) error
	InsertGap(context.Context, HistoryGap) error
}

type historianFrontierReader interface {
	LastHotBucket(context.Context, string, uint64) (int64, bool, error)
}

type HistorianShadowScheduler struct {
	mu             sync.RWMutex
	scheduleView   atomic.Value
	policyRevision uint64
	reader         historianSnapshotReader
	sink           historianSink
	schedules      []historianPointSchedule
	cache          *HistorianRAMCache
	pending        map[string][]HistorianRawSample
	pendingHot     []HotSample
	pendingGaps    map[string]HistoryGap
	clock          *HistorianClockTracker
	trendCache     *HistorianTrendCache
	nextCacheMono  uint64
}

func NewHistorianShadowScheduler(config HistorianConfig, reader historianSnapshotReader, sink historianSink, anchorUTC time.Time, anchorMonotonicNS uint64) (*HistorianShadowScheduler, error) {
	if config.Revision == 0 || reader == nil || sink == nil {
		return nil, fmt.Errorf("invalid historian shadow scheduler")
	}
	cache, err := NewHistorianRAMCache(historianRawRAMBudget)
	if err != nil {
		return nil, err
	}
	cacheBoundaryUTC := floorHistorianBoundary(anchorUTC.UTC().UnixMilli(), 15000) + 15000
	cacheDeltaMS := cacheBoundaryUTC - anchorUTC.UTC().UnixMilli()
	nextCacheMono := anchorMonotonicNS
	if cacheDeltaMS > 0 {
		nextCacheMono += uint64(cacheDeltaMS) * uint64(time.Millisecond)
	}
	scheduler := &HistorianShadowScheduler{policyRevision: config.Revision, reader: reader, sink: sink, cache: cache, pending: map[string][]HistorianRawSample{}, pendingGaps: map[string]HistoryGap{}, clock: NewHistorianClockTracker(), nextCacheMono: nextCacheMono}
	scheduler.clock.Observe(anchorUTC.UTC().UnixMilli(), anchorMonotonicNS)
	for _, policy := range append([]HistorianPolicy(nil), config.Points...) {
		if !policy.DBLoggingEnabled {
			continue
		}
		schedule, err := newHistorianPointSchedule(config.Revision, policy, anchorUTC, anchorMonotonicNS)
		if err != nil {
			return nil, err
		}
		scheduler.schedules = append(scheduler.schedules, schedule)
	}
	scheduler.publishSchedulesLocked()
	return scheduler, nil
}

// AttachTrendCache enables the all-point 15-second presentation cache while
// keeping database scheduling governed by the historian policies.
func (s *HistorianShadowScheduler) AttachTrendCache(cache *HistorianTrendCache) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.trendCache = cache
	s.mu.Unlock()
}

func (s *HistorianShadowScheduler) RunOnce(ctx context.Context, observedUTC time.Time, monotonicNS uint64) (err error) {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	defer s.publishSchedulesLocked()

	type duePoint struct {
		scheduleIndex int
		policy        HistorianPolicy
		boundaryUTCMS int64
	}
	duePoints := make([]duePoint, 0, len(s.schedules))
	due := make([]HistorianPolicy, 0, len(s.schedules))
	dueUTC := make(map[string]int64, len(s.schedules))
	for i := range s.schedules {
		schedule := &s.schedules[i]
		if monotonicNS < schedule.nextMonotonicNS {
			continue
		}
		if len(duePoints) == historianDueQueueLimit {
			break
		}
		policy := HistorianPolicy{PointID: schedule.pointID, Generation: schedule.generation, DBLoggingEnabled: true, DBInterval: historianIntervalName(schedule.intervalMS), StartAtUTC: observedUTC.UTC().Format(time.RFC3339Nano)}
		duePoints = append(duePoints, duePoint{scheduleIndex: i, policy: policy, boundaryUTCMS: schedule.nextUTCMS})
		due = append(due, policy)
		dueUTC[historianIdentityKey(schedule.pointID, schedule.generation)] = schedule.nextUTCMS
	}
	cacheDue := s.trendCache != nil && monotonicNS >= s.nextCacheMono
	if cacheDue {
		for s.nextCacheMono <= monotonicNS {
			s.nextCacheMono += uint64(15 * time.Second)
		}
	}
	if len(due) == 0 && !cacheDue {
		return s.flushPendingGaps(ctx)
	}
	/* Chu kỳ BẬN phải báo lỗi ghi gap tồn đọng y như chu kỳ rảnh ở ngay trên:
	 * nuốt lỗi tại đây làm một sink hỏng chỉ lộ ra trong những chu kỳ không có
	 * Point nào đến hạn, tức ngược chiều rủi ro. Nhưng lỗi này KHÔNG được cắt
	 * ngang chu kỳ — phần còn lại vẫn phải chạy — nên nó được gộp vào giá trị
	 * trả về bằng `errors.Join`, đúng quy ước ở `legacy_writers.go:194-200`. */
	if flushErr := s.flushPendingGaps(ctx); flushErr != nil {
		defer func() { err = errors.Join(flushErr, err) }()
	}
	advanceDue := func() {
		for _, point := range duePoints {
			schedule := &s.schedules[point.scheduleIndex]
			for schedule.nextMonotonicNS <= monotonicNS {
				schedule.nextUTCMS += schedule.intervalMS
				schedule.nextMonotonicNS += uint64(schedule.intervalMS) * uint64(time.Millisecond)
			}
		}
	}
	insertDueGaps := func(reason, detail string, createdAtUTCMS int64) error {
		for _, point := range duePoints {
			revision := s.policyRevision
			gap := HistoryGap{PointID: point.policy.PointID, Generation: point.policy.Generation, FromUTCMS: point.boundaryUTCMS, ToUTCMS: point.boundaryUTCMS + s.schedules[point.scheduleIndex].intervalMS, Reason: reason, Detail: detail, PolicyRevision: &revision, CreatedAtUTCMS: createdAtUTCMS}
			if err := s.sink.InsertGap(ctx, gap); err != nil {
				return err
			}
		}
		return nil
	}
	snapshot, err := s.reader.ReadPointSnapshot(ctx)
	if err != nil {
		if gapErr := insertDueGaps("snapshot", "read_failed", observedUTC.UTC().UnixMilli()); gapErr != nil {
			return gapErr
		}
		advanceDue()
		return nil
	}
	snapshotUTC, err := time.Parse(time.RFC3339Nano, snapshot.SnapshotObservedAtUTC)
	if err != nil {
		if gapErr := insertDueGaps("snapshot", "invalid_envelope", observedUTC.UTC().UnixMilli()); gapErr != nil {
			return gapErr
		}
		advanceDue()
		return nil
	}
	if cacheDue {
		if err := s.trendCache.AppendSnapshot(snapshot); err != nil {
			return err
		}
	}
	clockBefore := *s.clock
	backwardJump := clockBefore.BackwardJump(snapshotUTC.UnixMilli(), snapshot.CapturedMonotonicNs)
	if gap := s.clock.Observe(snapshotUTC.UnixMilli(), snapshot.CapturedMonotonicNs); gap != nil {
		updates := append([]historianPointSchedule(nil), s.schedules...)
		for i := range s.schedules {
			schedule := &updates[i]
			if backwardJump && snapshotUTC.UnixMilli() <= schedule.durableUntilUTCMS {
				schedule.suspended = true
				continue
			}
			base := floorHistorianBoundary(snapshotUTC.UnixMilli(), schedule.intervalMS) + schedule.intervalMS
			schedule.nextUTCMS = base
			delta := base - snapshotUTC.UnixMilli()
			schedule.nextMonotonicNS = snapshot.CapturedMonotonicNs + uint64(delta)*uint64(time.Millisecond)
		}
		for _, policy := range due {
			identityGap := *gap
			identityGap.PointID, identityGap.Generation = policy.PointID, policy.Generation
			revision := s.policyRevision
			identityGap.PolicyRevision = &revision
			if identityGap.ToUTCMS <= identityGap.FromUTCMS {
				identityGap.ToUTCMS = identityGap.FromUTCMS + 1
			}
			if err := s.sink.InsertGap(ctx, identityGap); err != nil {
				*s.clock = clockBefore
				return err
			}
		}
		s.schedules = updates
		return nil
	}
	activeDue := due[:0]
	activeDuePoints := duePoints[:0]
	for _, point := range duePoints {
		schedule := &s.schedules[point.scheduleIndex]
		if schedule.suspended {
			if snapshotUTC.UnixMilli() <= schedule.durableUntilUTCMS {
				continue
			}
			schedule.suspended = false
			base := floorHistorianBoundary(snapshotUTC.UnixMilli(), schedule.intervalMS) + schedule.intervalMS
			schedule.nextUTCMS = base
			schedule.nextMonotonicNS = snapshot.CapturedMonotonicNs + uint64(base-snapshotUTC.UnixMilli())*uint64(time.Millisecond)
			continue
		}
		activeDue = append(activeDue, point.policy)
		activeDuePoints = append(activeDuePoints, point)
	}
	due = activeDue
	duePoints = activeDuePoints
	if len(due) == 0 {
		return nil
	}
	samples, gaps, err := collectHistorianSnapshotSamples(snapshot, due, s.policyRevision, monotonicNS)
	if err != nil {
		if gapErr := insertDueGaps("snapshot", "invalid_envelope", snapshotUTC.UnixMilli()); gapErr != nil {
			return gapErr
		}
		advanceDue()
		return nil
	}
	for i := range samples {
		if boundary, ok := dueUTC[historianIdentityKey(samples[i].PointID, samples[i].Generation)]; ok {
			samples[i].ObservedUTCMS = boundary
		}
	}
	for i := range gaps {
		if boundary, ok := dueUTC[historianIdentityKey(gaps[i].PointID, gaps[i].Generation)]; ok {
			intervalMS, _ := historianIntervalMilliseconds(historianPolicyInterval(due, gaps[i].PointID, gaps[i].Generation))
			gaps[i].FromUTCMS, gaps[i].ToUTCMS = boundary, boundary+intervalMS
		}
	}
	for _, gap := range gaps {
		if err := s.sink.InsertGap(ctx, gap); err != nil {
			return err
		}
	}
	s.pendingHot = s.retainHotBeyondDurableFrontier(s.pendingHot)
	hot := append([]HotSample(nil), s.pendingHot...)
	pendingUpdates := make(map[string][]HistorianRawSample)
	for _, sample := range samples {
		if sample.IntervalMS == 1000 || sample.IntervalMS == 3000 || sample.IntervalMS == 5000 {
			if err := s.cache.Append(sample); err != nil {
				return err
			}
		} else {
			row, err := foldHistorianHot([]HistorianRawSample{sample}, s.policyRevision)
			if err != nil {
				return err
			}
			hot = append(hot, row)
			continue
		}
		key := historianIdentityKey(sample.PointID, sample.Generation)
		pending := s.pending[key]
		if len(pending) > 0 && floorHistorianBoundary(pending[0].ObservedUTCMS, 15000) < floorHistorianBoundary(sample.ObservedUTCMS, 15000) {
			row, err := foldHistorianHot(pending, s.policyRevision)
			if err != nil {
				return err
			}
			hot = append(hot, row)
			pending = nil
		}
		pendingUpdates[key] = upsertHistorianRawSample(pending, sample)
	}
	// A bucket remains pending until a later observation proves its boundary closed.
	for key, pending := range pendingUpdates {
		s.pending[key] = pending
	}
	hot = s.retainHotBeyondDurableFrontier(hot)
	if len(hot) == 0 {
		advanceDue()
		return nil
	}
	batch := hot
	if len(batch) > historianHotBatchLimit {
		batch = batch[:historianHotBatchLimit]
	}
	if err := s.sink.InsertHotBatch(ctx, batch); err != nil {
		s.pendingHot = mergeHistorianHotRows(s.pendingHot, hot)
		s.boundPendingHot()
		advanceDue()
		return err
	}
	if len(hot) > historianHotBatchLimit {
		s.pendingHot = append([]HotSample(nil), hot[historianHotBatchLimit:]...)
		s.applyDurableFrontiers(batch)
	} else {
		s.pendingHot = nil
		s.applyDurableFrontiers(hot)
	}
	advanceDue()
	return nil
}

func (s *HistorianShadowScheduler) boundPendingHot() {
	if len(s.pendingHot) <= historianDueQueueLimit {
		return
	}
	for _, row := range s.pendingHot[historianDueQueueLimit:] {
		revision := row.PolicyRevision
		if revision == 0 {
			revision = s.policyRevision
		}
		key := historianIdentityKey(row.PointID, row.Generation)
		gap := s.pendingGaps[key]
		if gap.PointID == "" {
			gap = HistoryGap{PointID: row.PointID, Generation: row.Generation, FromUTCMS: row.BucketUTCMS, ToUTCMS: row.BucketUTCMS + 15000, Reason: "storage", Detail: "pending_hot_overflow", PolicyRevision: &revision, CreatedAtUTCMS: row.BucketUTCMS + 15000}
		} else if row.BucketUTCMS+15000 > gap.ToUTCMS {
			gap.ToUTCMS = row.BucketUTCMS + 15000
		}
		s.pendingGaps[key] = gap
	}
	s.pendingHot = s.pendingHot[:historianDueQueueLimit]
}

func (s *HistorianShadowScheduler) flushPendingGaps(ctx context.Context) error {
	for key, gap := range s.pendingGaps {
		if err := s.sink.InsertGap(ctx, gap); err != nil {
			return err
		}
		delete(s.pendingGaps, key)
	}
	return nil
}

func mergeHistorianHotRows(existing, incoming []HotSample) []HotSample {
	merged := append([]HotSample(nil), existing...)
	for _, row := range incoming {
		replaced := false
		for i := range merged {
			if merged[i].PointID == row.PointID && merged[i].Generation == row.Generation && merged[i].BucketUTCMS == row.BucketUTCMS {
				merged[i] = row
				replaced = true
				break
			}
		}
		if !replaced {
			merged = append(merged, row)
		}
	}
	return merged
}

func (s *HistorianShadowScheduler) retainHotBeyondDurableFrontier(rows []HotSample) []HotSample {
	kept := rows[:0]
	for _, row := range rows {
		durable := false
		for i := range s.schedules {
			schedule := &s.schedules[i]
			if schedule.pointID == row.PointID && schedule.generation == row.Generation {
				durable = row.BucketUTCMS+15000 <= schedule.durableUntilUTCMS
				break
			}
		}
		if !durable {
			kept = append(kept, row)
		}
	}
	return kept
}

func upsertHistorianRawSample(rows []HistorianRawSample, sample HistorianRawSample) []HistorianRawSample {
	for i := range rows {
		if rows[i].ObservedUTCMS == sample.ObservedUTCMS && rows[i].IntervalMS == sample.IntervalMS {
			return rows
		}
	}
	return append(rows, sample)
}

func (s *HistorianShadowScheduler) applyDurableFrontiers(rows []HotSample) {
	for _, row := range rows {
		frontier := row.BucketUTCMS + 15000
		for i := range s.schedules {
			schedule := &s.schedules[i]
			if schedule.pointID == row.PointID && schedule.generation == row.Generation && frontier > schedule.durableUntilUTCMS {
				schedule.durableUntilUTCMS = frontier
			}
		}
	}
}

func historianPolicyInterval(policies []HistorianPolicy, pointID string, generation uint64) string {
	for _, policy := range policies {
		if policy.PointID == pointID && policy.Generation == generation {
			return policy.DBInterval
		}
	}
	return ""
}

func (s *HistorianShadowScheduler) DueRecords(monotonicNS uint64) []HistorianDueRecord {
	if s == nil {
		return nil
	}
	view := s.scheduleView.Load()
	if view == nil {
		return nil
	}
	schedules := view.([]historianPointSchedule)
	records := make([]HistorianDueRecord, 0)
	for _, schedule := range schedules {
		if monotonicNS < schedule.nextMonotonicNS {
			continue
		}
		records = append(records, HistorianDueRecord{
			PointID:        schedule.pointID,
			Generation:     schedule.generation,
			FromUTCMS:      schedule.nextUTCMS,
			ToUTCMS:        schedule.nextUTCMS + schedule.intervalMS,
			PolicyRevision: schedule.policyRevision,
		})
	}
	return records
}

func (s *HistorianShadowScheduler) publishSchedulesLocked() {
	if s == nil {
		return
	}
	s.scheduleView.Store(append([]historianPointSchedule(nil), s.schedules...))
}

func (s *HistorianShadowScheduler) RecordQueueOverflowRecords(ctx context.Context, records []HistorianDueRecord) error {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, record := range records {
		if record.PointID == "" || record.Generation == 0 || record.ToUTCMS <= record.FromUTCMS {
			continue
		}
		revision := record.PolicyRevision
		if revision == 0 {
			revision = s.policyRevision
		}
		gap := HistoryGap{PointID: record.PointID, Generation: record.Generation, FromUTCMS: record.FromUTCMS, ToUTCMS: record.ToUTCMS, Reason: "queue", Detail: "queue_overflow", PolicyRevision: &revision, CreatedAtUTCMS: record.ToUTCMS}
		if err := s.sink.InsertGap(ctx, gap); err != nil {
			return err
		}
	}
	return nil
}

func (s *HistorianShadowScheduler) RecordQueueOverflow(ctx context.Context, fromUTCMS, toUTCMS int64) error {
	if s == nil || toUTCMS <= fromUTCMS {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, schedule := range s.schedules {
		revision := s.policyRevision
		gap := HistoryGap{PointID: schedule.pointID, Generation: schedule.generation, FromUTCMS: fromUTCMS, ToUTCMS: toUTCMS, Reason: "queue", Detail: "queue_overflow", PolicyRevision: &revision, CreatedAtUTCMS: toUTCMS}
		if err := s.sink.InsertGap(ctx, gap); err != nil {
			return err
		}
	}
	return nil
}

// PrepareRestartGaps ghi bằng chứng cho phần lịch sử trôi qua trong lúc tiến
// trình không chạy, và ĐÓNG NỐT bucket đang mở khi tiến trình sống lại bên
// trong chính bucket đó.
//
// Bản trước tuyên bố mất trắng mọi thứ từ frontier tới biên kế tiếp. Đo trên bo
// (2026-09-05): dịch vụ dừng 11:07:33, lên lại 11:07:47 — tức là bên trong
// bucket 11:07:45 — nhưng lịch đặt mốc kế tiếp ở 11:08:00 rồi ghi gap
// [11:07:45, 11:08:00). Bucket ấy vẫn đang mở và core vẫn còn số đo để đóng nó,
// nên gap đó nói quá: trang Trends treo cờ PARTIAL cho một khoảng thật ra lấy
// được, và mỗi lần nâng cấp lại thêm một vệt cảnh báo vĩnh viễn.
//
// Mẫu phục hồi KHÔNG bị ép về biên: `last_sample_utc_ms` giữ đúng thời điểm core
// quan sát (11:07:47), nên bản ghi vẫn nói thật rằng bucket này được đóng muộn.
// Phần thật sự trôi qua trọn vẹn vẫn ra gap như cũ.
func (s *HistorianShadowScheduler) PrepareRestartGaps(ctx context.Context, frontier historianFrontierReader, restartUTCMS int64) error {
	if s == nil || frontier == nil || restartUTCMS <= 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	defer s.publishSchedulesLocked()

	type restartHole struct {
		index           int
		fromUTCMS       int64
		toUTCMS         int64
		openBucketUTCMS int64
	}
	holes := make([]restartHole, 0, len(s.schedules))
	candidates := make(map[int]int64, len(s.schedules))
	for i := range s.schedules {
		// Con trỏ, không phải bản sao: bản trước dùng biến vòng lặp value nên
		// mọi lần gán `durableUntilUTCMS` ở đây đều rơi vào bản sao rồi mất, và
		// sau khởi động lại frontier bền vững tụt về 0.
		schedule := &s.schedules[i]
		last, ok, err := frontier.LastHotBucket(ctx, schedule.pointID, schedule.generation)
		if err != nil {
			return err
		}
		if ok {
			schedule.durableUntilUTCMS = last + 15000
		}
		if !ok || last+schedule.intervalMS >= schedule.nextUTCMS {
			continue
		}
		hole := restartHole{index: i, fromUTCMS: last + schedule.intervalMS, toUTCMS: schedule.nextUTCMS}
		// Chỉ đóng được bucket đang mở khi biên gần nhất trước lúc khởi động lại
		// trùng đúng một bucket hot 15 giây. Với chu kỳ 30s trở lên biên rơi
		// giữa hai bucket, mẫu phục hồi sẽ mang nhãn không thuộc lịch của điểm,
		// nên trường hợp đó giữ nguyên gap.
		current := floorHistorianBoundary(restartUTCMS, schedule.intervalMS)
		if current > last && current < schedule.nextUTCMS && current == floorHistorianBoundary(restartUTCMS, 15000) {
			hole.openBucketUTCMS = current
			candidates[i] = current
		}
		holes = append(holes, hole)
	}
	if len(holes) == 0 {
		return nil
	}

	filled := s.recoverRestartOpenBuckets(ctx, candidates)
	for _, hole := range holes {
		toUTCMS := hole.toUTCMS
		if filled[hole.index] {
			toUTCMS = hole.openBucketUTCMS
		}
		if toUTCMS <= hole.fromUTCMS {
			continue
		}
		schedule := &s.schedules[hole.index]
		revision := s.policyRevision
		gap := HistoryGap{PointID: schedule.pointID, Generation: schedule.generation, FromUTCMS: hole.fromUTCMS, ToUTCMS: toUTCMS, Reason: "restart", Detail: "scheduler_restart_no_backfill", PolicyRevision: &revision, CreatedAtUTCMS: restartUTCMS}
		if err := s.sink.InsertGap(ctx, gap); err != nil {
			return err
		}
	}
	return nil
}

// recoverRestartOpenBuckets đóng các bucket còn mở bằng số đo hiện tại của core.
// Trả về tập chỉ số lịch đã đóng được; mọi trục trặc (không đọc nổi snapshot,
// snapshot đã trôi sang bucket khác, ghi hỏng) đều trả về rỗng để nơi gọi ghi
// gap đầy đủ như cũ — thà báo thiếu còn hơn báo có một bucket không có thật.
func (s *HistorianShadowScheduler) recoverRestartOpenBuckets(ctx context.Context, candidates map[int]int64) map[int]bool {
	if len(candidates) == 0 || s.reader == nil {
		return nil
	}
	snapshot, err := s.reader.ReadPointSnapshot(ctx)
	if err != nil {
		return nil
	}
	observedAt, err := time.Parse(time.RFC3339Nano, snapshot.SnapshotObservedAtUTC)
	if err != nil {
		return nil
	}
	observedUTCMS := observedAt.UTC().UnixMilli()
	policies := make([]HistorianPolicy, 0, len(candidates))
	wanted := make(map[string]int, len(candidates))
	for index, bucket := range candidates {
		if floorHistorianBoundary(observedUTCMS, 15000) != bucket {
			continue
		}
		schedule := &s.schedules[index]
		interval := historianIntervalName(schedule.intervalMS)
		if interval == "" {
			continue
		}
		policies = append(policies, HistorianPolicy{PointID: schedule.pointID, Generation: schedule.generation, DBLoggingEnabled: true, DBInterval: interval, StartAtUTC: observedAt.UTC().Format(time.RFC3339Nano)})
		wanted[historianIdentityKey(schedule.pointID, schedule.generation)] = index
	}
	if len(policies) == 0 {
		return nil
	}
	// `dueMonotonicNS` = 0: mẫu phục hồi không gắn với một tick đã đến hạn nào,
	// nó chỉ cần là số đo hợp lệ nằm trong bucket đang mở.
	samples, _, err := collectHistorianSnapshotSamples(snapshot, policies, s.policyRevision, 0)
	if err != nil || len(samples) == 0 {
		return nil
	}
	rows := make([]HotSample, 0, len(samples))
	filled := make(map[int]bool, len(samples))
	for _, sample := range samples {
		index, ok := wanted[historianIdentityKey(sample.PointID, sample.Generation)]
		if !ok {
			continue
		}
		row, err := foldHistorianHot([]HistorianRawSample{sample}, s.policyRevision)
		if err != nil {
			continue
		}
		rows = append(rows, row)
		filled[index] = true
	}
	if len(rows) == 0 {
		return nil
	}
	if err := s.sink.InsertHotBatch(ctx, rows); err != nil {
		return nil
	}
	s.applyDurableFrontiers(rows)
	return filled
}

func historianIntervalName(intervalMS int64) string {
	for _, value := range historianIntervals {
		if candidate, ok := historianIntervalMilliseconds(value); ok && candidate == intervalMS {
			return value
		}
	}
	return ""
}

type historianPointSchedule struct {
	pointID           string
	generation        uint64
	policyRevision    uint64
	intervalMS        int64
	nextUTCMS         int64
	nextMonotonicNS   uint64
	durableUntilUTCMS int64
	suspended         bool
}

func newHistorianPointSchedule(policyRevision uint64, policy HistorianPolicy, anchorUTC time.Time, anchorMonotonicNS uint64) (historianPointSchedule, error) {
	intervalMS, ok := historianIntervalMilliseconds(policy.DBInterval)
	if policyRevision == 0 || !policy.DBLoggingEnabled || policy.PointID == "" || policy.Generation == 0 || !ok {
		return historianPointSchedule{}, fmt.Errorf("invalid historian schedule policy")
	}
	startUTC, err := time.Parse(time.RFC3339Nano, policy.StartAtUTC)
	if err != nil || startUTC.Location() != time.UTC {
		return historianPointSchedule{}, fmt.Errorf("invalid historian schedule start")
	}
	anchorUTC = anchorUTC.UTC()
	boundaryBaseMS := anchorUTC.UnixMilli()
	if startUTC.After(anchorUTC) {
		boundaryBaseMS = startUTC.UnixMilli()
	}
	nextUTCMS := floorHistorianBoundary(boundaryBaseMS, intervalMS) + intervalMS
	deltaMS := nextUTCMS - anchorUTC.UnixMilli()
	if deltaMS < 0 || uint64(deltaMS) > (^uint64(0)-anchorMonotonicNS)/uint64(time.Millisecond) {
		return historianPointSchedule{}, fmt.Errorf("historian schedule due time overflow")
	}
	return historianPointSchedule{
		pointID:         policy.PointID,
		generation:      policy.Generation,
		policyRevision:  policyRevision,
		intervalMS:      intervalMS,
		nextUTCMS:       nextUTCMS,
		nextMonotonicNS: anchorMonotonicNS + uint64(deltaMS)*uint64(time.Millisecond),
	}, nil
}

func floorHistorianBoundary(utcMS, intervalMS int64) int64 {
	return utcMS - utcMS%intervalMS
}

func (s *historianPointSchedule) advance(monotonicNS uint64) bool {
	if monotonicNS < s.nextMonotonicNS {
		return false
	}
	s.nextUTCMS += s.intervalMS
	s.nextMonotonicNS += uint64(s.intervalMS) * uint64(time.Millisecond)
	return true
}
