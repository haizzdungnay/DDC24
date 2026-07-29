package main

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"
)

type historianSnapshotReader interface {
	ReadPointSnapshot(context.Context) (RuntimePointSnapshot, error)
}

type historianRuntimeSnapshotReader struct {
	physical historianSnapshotReader
	virtual  *HistorianRuntimeRegistry
}

func (r historianRuntimeSnapshotReader) ReadPointSnapshot(ctx context.Context) (RuntimePointSnapshot, error) {
	if r.physical == nil {
		return RuntimePointSnapshot{}, fmt.Errorf("historian physical snapshot reader unavailable")
	}
	snapshot, err := r.physical.ReadPointSnapshot(ctx)
	if err != nil {
		return RuntimePointSnapshot{}, err
	}
	snapshot.Points = append(append([]RuntimePoint(nil), snapshot.Points...), r.virtual.Snapshot()...)
	return snapshot, nil
}

type HistorianRuntimeRegistry struct {
	mu     sync.RWMutex
	points map[string]RuntimePoint
}

func NewHistorianRuntimeRegistry() *HistorianRuntimeRegistry {
	return &HistorianRuntimeRegistry{points: map[string]RuntimePoint{}}
}

func (r *HistorianRuntimeRegistry) Update(point RuntimePoint) bool {
	if r == nil || point.ID == "" || point.Generation == 0 {
		return false
	}
	if _, ok := numericPointValue(point.Value); !ok {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if current, ok := r.points[point.ID]; ok && current.Generation > point.Generation {
		return false
	}
	r.points[point.ID] = point
	return true
}

func (r *HistorianRuntimeRegistry) Snapshot() []RuntimePoint {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	points := make([]RuntimePoint, 0, len(r.points))
	for _, point := range r.points {
		points = append(points, point)
	}
	sort.Slice(points, func(i, j int) bool { return points[i].ID < points[j].ID })
	return points
}

func collectHistorianDueSamples(ctx context.Context, reader historianSnapshotReader, policies []HistorianPolicy, policyRevision uint64, dueMonotonicNS uint64) ([]HistorianRawSample, []HistoryGap, error) {
	if reader == nil || policyRevision == 0 {
		return nil, nil, fmt.Errorf("invalid historian due cycle")
	}
	snapshot, err := reader.ReadPointSnapshot(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("read historian snapshot: %w", err)
	}
	return collectHistorianSnapshotSamples(snapshot, policies, policyRevision, dueMonotonicNS)
}

func collectHistorianSnapshotSamples(snapshot RuntimePointSnapshot, policies []HistorianPolicy, policyRevision uint64, dueMonotonicNS uint64) ([]HistorianRawSample, []HistoryGap, error) {
	observedAt, err := time.Parse(time.RFC3339Nano, snapshot.SnapshotObservedAtUTC)
	if err != nil || observedAt.Location() != time.UTC || snapshot.CapturedMonotonicNs == 0 || snapshot.CapturedMonotonicNs < dueMonotonicNS {
		return nil, nil, fmt.Errorf("invalid historian snapshot envelope")
	}
	byIdentity := make(map[string]RuntimePoint, len(snapshot.Points))
	for _, point := range snapshot.Points {
		byIdentity[historianIdentityKey(point.ID, point.Generation)] = point
	}
	samples := make([]HistorianRawSample, 0, len(policies))
	gaps := make([]HistoryGap, 0)
	observedUTCMS := observedAt.UnixMilli()
	for _, policy := range policies {
		intervalMS, ok := historianIntervalMilliseconds(policy.DBInterval)
		if !ok || !policy.DBLoggingEnabled || policy.PointID == "" || policy.Generation == 0 {
			continue
		}
		point, found := byIdentity[historianIdentityKey(policy.PointID, policy.Generation)]
		value, numeric := numericPointValue(point.Value)
		quality, qualityOK := historianQuality(point.Quality)
		roleOK := point.Kind != "AO" || point.Role == "resolved_setpoint"
		roleOK = roleOK && (point.Kind != "DO" || point.Role == "hardware_feedback")
		roleOK = roleOK && (point.Kind != "VP" || point.Role == "runtime_value")
		if !found || !numeric || !qualityOK || quality == 2 || point.Source == "" || !roleOK {
			revision := policyRevision
			gaps = append(gaps, HistoryGap{PointID: policy.PointID, Generation: policy.Generation, FromUTCMS: observedUTCMS, ToUTCMS: observedUTCMS + intervalMS, Reason: "snapshot", Detail: "missing_or_invalid", PolicyRevision: &revision, CreatedAtUTCMS: observedUTCMS})
			continue
		}
		samples = append(samples, HistorianRawSample{PointID: policy.PointID, Generation: policy.Generation, IntervalMS: intervalMS, ObservedUTCMS: observedUTCMS, Value: value, Quality: quality, Source: point.Source, PolicyRevision: policyRevision})
	}
	return samples, gaps, nil
}

func historianIdentityKey(pointID string, generation uint64) string {
	return fmt.Sprintf("%s\x00%d", pointID, generation)
}

func historianQuality(value string) (int, bool) {
	switch value {
	case "GOOD":
		return 0, true
	case "UNCERTAIN":
		return 1, true
	case "BAD":
		return 2, true
	default:
		return 0, false
	}
}
