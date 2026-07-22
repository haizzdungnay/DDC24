package main

import (
	"context"
	"strconv"
	"sync"
	"time"
)

type historianCycle struct {
	utc         time.Time
	monotonicNS uint64
}

type historianShadowRuntime struct {
	cycles   chan historianCycle
	done     chan struct{}
	once     sync.Once
	mu       sync.Mutex
	overflow map[string]HistorianDueRecord
}

func newHistorianShadowRuntime() *historianShadowRuntime {
	return &historianShadowRuntime{cycles: make(chan historianCycle, historianDueQueueLimit), done: make(chan struct{}), overflow: map[string]HistorianDueRecord{}}
}

func (a *App) runHistorianShadowScheduler(ctx context.Context) {
	runtime := newHistorianShadowRuntime()
	a.historianShadowRuntime = runtime
	go a.consumeHistorianShadowCycles(ctx, runtime)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	defer func() {
		close(runtime.cycles)
		<-runtime.done
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			a.refreshHistorianShadowScheduler(ctx)
			if !a.ensureHistorianRestartGaps(ctx, now.UTC().UnixMilli()) {
				continue
			}
			a.historianShadowMu.RLock()
			shadow := a.historianShadow
			shadowMono := a.historianShadowMono
			shadowStart := a.historianShadowStart
			a.historianShadowMu.RUnlock()
			if shadow == nil {
				continue
			}
			elapsed := now.Sub(shadowStart)
			if elapsed < 0 || uint64(elapsed) > ^uint64(0)-shadowMono {
				continue
			}
			monotonicNS := shadowMono + uint64(elapsed)
			cycle := historianCycle{utc: now.UTC(), monotonicNS: monotonicNS}
			select {
			case runtime.cycles <- cycle:
			default:
				runtime.recordOverflow(shadow.DueRecords(monotonicNS))
			}
		}
	}
}

func (a *App) ensureHistorianRestartGaps(ctx context.Context, atUTCMS int64) bool {
	a.historianShadowMu.RLock()
	shadow := a.historianShadow
	ready := a.historianRestartReady
	a.historianShadowMu.RUnlock()
	if ready || !a.historianAuthority.WriterV2 || shadow == nil || a.historianV2 == nil {
		return true
	}
	if err := shadow.PrepareRestartGaps(ctx, a.historianV2, atUTCMS); err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN historian_v2 restart gap pending err=%v", err)
		}
		return false
	}
	a.historianShadowMu.Lock()
	if a.historianShadow == shadow {
		a.historianRestartReady = true
	}
	a.historianShadowMu.Unlock()
	return true
}

func (a *App) consumeHistorianShadowCycles(ctx context.Context, runtime *historianShadowRuntime) {
	defer close(runtime.done)
	for cycle := range runtime.cycles {
		a.historianShadowMu.RLock()
		shadow := a.historianShadow
		a.historianShadowMu.RUnlock()
		if shadow == nil {
			continue
		}
		if err := shadow.RunOnce(ctx, cycle.utc, cycle.monotonicNS); err != nil && a.logger != nil {
			a.logger.Printf("WARN historian_v2 shadow cycle err=%v", err)
		}
		if records := runtime.takeOverflow(); len(records) > 0 {
			if err := shadow.RecordQueueOverflowRecords(ctx, records); err != nil && a.logger != nil {
				a.logger.Printf("WARN historian_v2 queue gap err=%v", err)
			}
		}
	}
}

func (r *historianShadowRuntime) recordOverflow(records []HistorianDueRecord) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, record := range records {
		if record.PointID == "" || record.Generation == 0 || record.ToUTCMS <= record.FromUTCMS {
			continue
		}
		key := historianIdentityKey(record.PointID, record.Generation) + "\x00" + strconv.FormatUint(record.PolicyRevision, 10)
		if current, ok := r.overflow[key]; !ok || record.FromUTCMS < current.FromUTCMS {
			r.overflow[key] = record
		}
		if current := r.overflow[key]; record.ToUTCMS > current.ToUTCMS {
			current.ToUTCMS = record.ToUTCMS
			r.overflow[key] = current
		}
	}
}

func (r *historianShadowRuntime) takeOverflow() []HistorianDueRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.overflow) == 0 {
		return nil
	}
	records := make([]HistorianDueRecord, 0, len(r.overflow))
	for key, record := range r.overflow {
		delete(r.overflow, key)
		records = append(records, record)
	}
	return records
}

func (a *App) refreshHistorianShadowScheduler(ctx context.Context) {
	physicalReader, ok := a.core.(historianSnapshotReader)
	if !ok || a.historian == nil || a.historianV2 == nil {
		return
	}
	config, err := a.historian.Get()
	a.historianShadowMu.RLock()
	currentRevision := uint64(0)
	if a.historianShadow != nil {
		currentRevision = a.historianShadow.policyRevision
	}
	a.historianShadowMu.RUnlock()
	if err != nil || config.Revision == 0 || currentRevision == config.Revision {
		return
	}
	data, _ := a.historian.committedMirrorSnapshot()
	namespaceRevision, err := a.historian.namespaceRevision()
	if err != nil || a.historianV2.MirrorPolicy(ctx, data, namespaceRevision, uint64(time.Now().UTC().UnixMilli())) != nil {
		if a.logger != nil {
			a.logger.Printf("WARN historian_v2 policy mirror pending revision=%d", config.Revision)
		}
		return
	}
	reader := historianRuntimeSnapshotReader{physical: physicalReader, virtual: a.virtualPointRuntime}
	snapshot, err := reader.ReadPointSnapshot(ctx)
	if err != nil {
		return
	}
	anchorUTC, err := time.Parse(time.RFC3339Nano, snapshot.SnapshotObservedAtUTC)
	if err != nil {
		return
	}
	sink := historianCachingSink{store: a.historianV2, cache: a.historianTrendCache}
	shadow, err := NewHistorianShadowScheduler(config, reader, sink, anchorUTC, snapshot.CapturedMonotonicNs)
	if err != nil {
		return
	}
	shadow.AttachTrendCache(a.historianTrendCache)
	if err := shadow.PrepareRestartGaps(ctx, a.historianV2, anchorUTC.UnixMilli()); err != nil {
		return
	}
	a.historianShadowMu.Lock()
	a.historianShadow = shadow
	a.historianRestartReady = true
	a.historianShadowMono = snapshot.CapturedMonotonicNs
	a.historianShadowStart = time.Now()
	a.historianShadowMu.Unlock()
}
