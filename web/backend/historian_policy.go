package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var historianIntervals = []string{"1s", "3s", "5s", "15s", "30s", "1m", "3m", "5m", "15m", "30m", "60m"}

// historianRetentionMaxDaysRevA is the deterministic Rev A rolling-retention
// contract. Slower sampling intervals permit a larger history window.
var historianRetentionMaxDaysRevA = map[string]int{
	"1s": 30, "3s": 60, "5s": 90, "15s": 180, "30s": 365,
	"1m": 730, "3m": 1095, "5m": 1460, "15m": 1825,
	"30m": 2555, "60m": 3650,
}

const (
	defaultHistorianBudgetBytes      = uint64(2 << 30)
	defaultHistorianWALReserveBytes  = uint64(128 << 20)
	defaultHistorianMigrationReserve = uint64(256 << 20)
	defaultHistorianRequiredFree     = uint64(512 << 20)
	// ponytail: Rev A reserves a conservative fixed ceiling per enabled point; replace with measured codec/tier projection in WEB-HIST-002.
	defaultHistorianPointReserve    = uint64(32 << 20)
	defaultHistorianMinPointReserve = uint64(1 << 20)
)

type historianPolicyFile struct {
	SchemaVersion         int               `json:"_schema_version"`
	Revision              uint64            `json:"revision"`
	HistorianBudgetBytes  uint64            `json:"historian_budget_bytes"`
	WALReserveBytes       uint64            `json:"wal_reserve_bytes"`
	MigrationReserveBytes uint64            `json:"migration_reserve_bytes"`
	RequiredFreeBytes     uint64            `json:"required_free_space_bytes"`
	Points                []HistorianPolicy `json:"points"`
}

type historianPolicyError struct {
	status int
	reason string
	msg    string
}

func (e historianPolicyError) Error() string { return e.msg }
func historianErrorStatus(err error) int {
	if typed, ok := err.(historianPolicyError); ok {
		return typed.status
	}
	return 500
}

type HistorianPolicyService struct {
	mu                sync.RWMutex
	path              string
	file              historianPolicyFile
	now               func() time.Time
	freeBytes         func() (uint64, error)
	identities        func() (map[string]uint64, string, error)
	namespaceRevision func() (uint64, error)
	committedBytes    []byte
	mirrorCommitted   func(context.Context, []byte, uint64, uint64) error
	writerActive      func(uint64) bool
}

func OpenHistorianPolicyService(path string, now func() time.Time, freeBytes func() (uint64, error)) (*HistorianPolicyService, error) {
	service := &HistorianPolicyService{path: path, now: now, freeBytes: freeBytes, namespaceRevision: func() (uint64, error) { return 0, nil }}
	service.file = historianPolicyFile{SchemaVersion: 1, HistorianBudgetBytes: defaultHistorianBudgetBytes, WALReserveBytes: defaultHistorianWALReserveBytes, MigrationReserveBytes: defaultHistorianMigrationReserve, RequiredFreeBytes: defaultHistorianRequiredFree, Points: []HistorianPolicy{}}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		service.committedBytes, err = marshalHistorianPolicyFile(service.file)
		if err != nil {
			return nil, err
		}
		return service, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read historian policy: %w", err)
	}
	if err := json.Unmarshal(data, &service.file); err != nil {
		return nil, fmt.Errorf("parse historian policy: %w", err)
	}
	service.committedBytes = append([]byte(nil), data...)
	return service, nil
}

func marshalHistorianPolicyFile(file historianPolicyFile) ([]byte, error) {
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal historian policy: %w", err)
	}
	return append(data, '\n'), nil
}

func (s *HistorianPolicyService) committedMirrorSnapshot() ([]byte, historianPolicyFile) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snapshot := s.file
	snapshot.Points = append([]HistorianPolicy(nil), s.file.Points...)
	return append([]byte(nil), s.committedBytes...), snapshot
}

func (s *HistorianPolicyService) revision() uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.file.Revision
}

func (s *HistorianPolicyService) Get() (HistorianConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	identities, namespaceState, err := s.identities()
	if err != nil {
		return HistorianConfig{}, err
	}
	free, err := s.freeBytes()
	if err != nil {
		return HistorianConfig{}, historianPolicyError{507, "historian_storage_unavailable", "historian storage unavailable"}
	}
	namespaceRevision, err := s.namespaceRevision()
	if err != nil {
		return HistorianConfig{}, err
	}
	return s.snapshotLocked(s.now().UTC(), namespaceState, namespaceRevision, free, identities), nil
}

func (a *App) historianIdentities() (map[string]uint64, string, error) {
	identities := make(map[string]uint64, 24)
	for i := 1; i <= 16; i++ {
		identities[formatPointID("UI", i)] = 1
	}
	for i := 1; i <= 4; i++ {
		identities[formatPointID("AO", i)] = 1
		identities[formatPointID("DO", i)] = 1
	}
	ioCfg, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		return nil, "conflicted", err
	}
	vpCfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return nil, "conflicted", err
	}
	authority, err := a.readPointNamespaceAuthority()
	if err != nil {
		return nil, "conflicted", err
	}
	for _, point := range normalizeVirtualPointsConfig(vpCfg).Items {
		if !point.Enabled || !virtualPointLoggableSignalType(point.SignalType) {
			continue
		}
		generation := point.Generation
		if generation == 0 {
			generation = authority.Generations[point.ID]
		}
		if generation == 0 {
			generation = 1
		}
		identities[point.ID] = generation
	}
	state := "valid"
	if len(validatePointNamespace(ioCfg, vpCfg)) > 0 {
		state = "conflicted"
	}
	return identities, state, nil
}

func (s *HistorianPolicyService) Update(update HistorianConfigUpdate) (HistorianConfig, error) {
	s.mu.Lock()
	locked := true
	defer func() {
		if locked {
			s.mu.Unlock()
		}
	}()
	if update.BaseRevision != s.file.Revision {
		return HistorianConfig{}, historianPolicyError{409, "config_conflict", "historian revision conflict"}
	}
	namespaceRevision, err := s.namespaceRevision()
	if err != nil {
		return HistorianConfig{}, err
	}
	if update.BaseNamespaceRevision != namespaceRevision {
		return HistorianConfig{}, historianPolicyError{409, "config_conflict", "point namespace revision conflict"}
	}
	if len(update.Points) == 0 {
		return HistorianConfig{}, historianPolicyError{400, "historian_policy_invalid", "points must not be empty"}
	}
	identities, namespaceState, err := s.identities()
	if err != nil {
		return HistorianConfig{}, err
	}
	if namespaceState != "valid" {
		return HistorianConfig{}, historianPolicyError{409, "point_namespace_conflicted", "point namespace conflicted"}
	}
	now := s.now().UTC()
	byID := make(map[string]HistorianPolicy, len(s.file.Points)+len(update.Points))
	for _, policy := range s.file.Points {
		if generation, ok := identities[policy.PointID]; ok && generation == policy.Generation {
			byID[policy.PointID] = policy
		}
	}
	seen := map[string]bool{}
	for _, patch := range update.Points {
		patch.PointID = canonicalHistoryPointID(patch.PointID)
		if seen[patch.PointID] || patch.PointID == "" {
			return HistorianConfig{}, historianPolicyError{400, "historian_policy_invalid", "duplicate or invalid point identity"}
		}
		seen[patch.PointID] = true
		generation, ok := identities[patch.PointID]
		if !ok || generation != patch.Generation {
			return HistorianConfig{}, historianPolicyError{409, "historian_generation_conflict", "historian generation conflict"}
		}
		policy := byID[patch.PointID]
		policy.PointID, policy.Generation, policy.DBLoggingEnabled = patch.PointID, patch.Generation, patch.DBLoggingEnabled
		if patch.DBLoggingEnabled {
			if !validHistorianInterval(patch.DBInterval) {
				return HistorianConfig{}, historianPolicyError{400, "historian_interval_invalid", "historian interval invalid"}
			}
			policy.DBInterval = patch.DBInterval
			maxRetention, _ := maxHistorianRetentionDays(patch.DBInterval)
			retention := patch.RetentionDays
			if retention == 0 && patch.retentionDaysSet {
				return HistorianConfig{}, historianPolicyError{400, "historian_retention_invalid", "retentionDays must be a positive integer"}
			}
			if retention == 0 {
				retention = policy.RetentionDays
				if retention > maxRetention {
					return HistorianConfig{}, historianPolicyError{400, "historian_retention_invalid", fmt.Sprintf("retentionDays must be supplied in range 1..%d when changing to interval %s", maxRetention, patch.DBInterval)}
				}
				if retention <= 0 {
					retention = maxRetention
				}
			}
			if retention < 1 || retention > maxRetention {
				return HistorianConfig{}, historianPolicyError{400, "historian_retention_invalid", fmt.Sprintf("retentionDays must be in range 1..%d for interval %s", maxRetention, patch.DBInterval)}
			}
			policy.RetentionDays = retention
			start := now
			if patch.StartAtUTC != nil {
				parsed, err := time.Parse(time.RFC3339, *patch.StartAtUTC)
				if err != nil || !strings.HasSuffix(*patch.StartAtUTC, "Z") || parsed.Before(now) {
					return HistorianConfig{}, historianPolicyError{400, "historian_start_in_past", "historian start invalid"}
				}
				start = parsed
			}
			policy.StartAtUTC = start.Format(time.RFC3339)
		} else {
			if policy.DBInterval == "" {
				policy.DBInterval = "15s"
			}
			if policy.StartAtUTC == "" {
				policy.StartAtUTC = now.Format(time.RFC3339)
			}
		}
		if policy.RetentionDays <= 0 {
			maxRetention, _ := maxHistorianRetentionDays(policy.DBInterval)
			policy.RetentionDays = maxRetention
		}
		policy.HotCacheEnabled, policy.HotCacheHours = true, 48
		byID[patch.PointID] = policy
	}
	points := make([]HistorianPolicy, 0, len(byID))
	for _, policy := range byID {
		points = append(points, policy)
	}
	sort.Slice(points, func(i, j int) bool { return points[i].PointID < points[j].PointID })
	free, err := s.freeBytes()
	if err != nil || free < s.file.RequiredFreeBytes {
		return HistorianConfig{}, historianPolicyError{507, "historian_storage_unavailable", "historian storage unavailable"}
	}
	enabled := 0
	for _, policy := range points {
		if policy.DBLoggingEnabled {
			enabled++
		}
	}
	reserved := s.file.WALReserveBytes + s.file.MigrationReserveBytes
	for _, policy := range points {
		if policy.DBLoggingEnabled {
			reserved += historianPointReserveBytes(policy.DBInterval, policy.RetentionDays)
		}
	}
	if reserved > s.file.HistorianBudgetBytes {
		return HistorianConfig{}, historianPolicyError{507, "historian_capacity_exceeded", "historian capacity exceeded"}
	}
	if reserved > free-s.file.RequiredFreeBytes {
		return HistorianConfig{}, historianPolicyError{507, "historian_storage_unavailable", "historian storage unavailable"}
	}
	next := s.file
	next.Revision++
	next.Points = points
	data, err := marshalHistorianPolicyFile(next)
	if err != nil {
		return HistorianConfig{}, err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return HistorianConfig{}, err
	}
	if err := writeConfigFileAtomic(s.path, data, 0o600); err != nil {
		return HistorianConfig{}, err
	}
	s.file = next
	s.committedBytes = append([]byte(nil), data...)
	result := s.snapshotLocked(now, namespaceState, namespaceRevision, free, identities)
	mirror := s.mirrorCommitted
	s.mu.Unlock()
	locked = false
	if mirror != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = mirror(ctx, append([]byte(nil), data...), namespaceRevision, uint64(now.UnixMilli()))
		cancel()
	}
	return result, nil
}

func (s *HistorianPolicyService) RemovePoint(ctx context.Context, pointID string) error {
	if s == nil {
		return nil
	}
	pointID = canonicalHistoryPointID(pointID)
	if pointID == "" {
		return fmt.Errorf("point id is required")
	}
	s.mu.Lock()
	previous := s.file
	previous.Points = append([]HistorianPolicy(nil), s.file.Points...)
	previousBytes := append([]byte(nil), s.committedBytes...)
	kept := make([]HistorianPolicy, 0, len(s.file.Points))
	found := false
	for _, policy := range s.file.Points {
		if canonicalHistoryPointID(policy.PointID) == pointID {
			found = true
			continue
		}
		kept = append(kept, policy)
	}
	if !found {
		s.mu.Unlock()
		return nil
	}
	next := s.file
	next.Revision++
	next.Points = kept
	data, err := marshalHistorianPolicyFile(next)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		s.mu.Unlock()
		return err
	}
	if err := writeConfigFileAtomic(s.path, data, 0o600); err != nil {
		s.mu.Unlock()
		return err
	}
	s.file = next
	s.committedBytes = append([]byte(nil), data...)
	mirror := s.mirrorCommitted
	s.mu.Unlock()

	if mirror == nil {
		return nil
	}
	namespaceRevision, err := s.namespaceRevision()
	if err == nil {
		err = mirror(ctx, append([]byte(nil), data...), namespaceRevision, uint64(s.now().UTC().UnixMilli()))
	}
	if err == nil {
		return nil
	}
	s.mu.Lock()
	restoreErr := writeConfigFileAtomic(s.path, previousBytes, 0o600)
	if restoreErr == nil {
		s.file = previous
		s.committedBytes = previousBytes
	}
	s.mu.Unlock()
	if restoreErr != nil {
		return fmt.Errorf("mirror historian policy after point purge: %v; restore policy: %w", err, restoreErr)
	}
	return fmt.Errorf("mirror historian policy after point purge: %w", err)
}

func (s *HistorianPolicyService) snapshotLocked(now time.Time, namespaceState string, namespaceRevision, free uint64, identities map[string]uint64) HistorianConfig {
	points := make([]HistorianPolicy, 0, len(identities))
	known := make(map[string]bool, len(points))
	for _, point := range s.file.Points {
		if generation, ok := identities[point.PointID]; ok && generation == point.Generation {
			points = append(points, point)
			known[point.PointID] = true
		}
	}
	for id, generation := range identities {
		if !known[id] {
			points = append(points, HistorianPolicy{PointID: id, Generation: generation, DBInterval: "15s", RetentionDays: 180, MaxRetentionDays: 180, HotCacheEnabled: true, HotCacheHours: 48, StartAtUTC: now.Format(time.RFC3339)})
		}
	}
	sort.Slice(points, func(i, j int) bool { return points[i].PointID < points[j].PointID })
	enabled := 0
	for i := range points {
		points[i].MaxRetentionDays, _ = maxHistorianRetentionDays(points[i].DBInterval)
		if points[i].RetentionDays <= 0 {
			points[i].RetentionDays = points[i].MaxRetentionDays
		}
		if !points[i].DBLoggingEnabled {
			points[i].State = "off"
		} else if start, _ := time.Parse(time.RFC3339, points[i].StartAtUTC); now.Before(start) {
			points[i].State = "scheduled"
			enabled++
		} else {
			points[i].State = "recording"
			enabled++
		}
		if s.writerActive != nil && s.writerActive(s.file.Revision) {
			points[i].Health = "healthy"
			points[i].LastError = ""
		} else {
			points[i].Health = "degraded"
			points[i].LastError = "historian writer not active"
		}
	}
	reserved := s.file.WALReserveBytes + s.file.MigrationReserveBytes
	for _, point := range points {
		if point.DBLoggingEnabled {
			reserved += historianPointReserveBytes(point.DBInterval, point.RetentionDays)
		}
	}
	retentionMax := historianRetentionMaxDays()
	return HistorianConfig{Revision: s.file.Revision, ServerNowUTC: now.Format(time.RFC3339), Points: points, Capacity: HistorianCapacity{EnabledPoints: enabled, ReservedBytes: reserved, BudgetBytes: s.file.HistorianBudgetBytes, FreeBytes: free, RequiredFreeBytes: s.file.RequiredFreeBytes}, RetentionMaxDaysByInterval: retentionMax, NamespaceState: namespaceState, NamespaceRevision: namespaceRevision}
}

func validHistorianInterval(value string) bool {
	for _, interval := range historianIntervals {
		if value == interval {
			return true
		}
	}
	return false
}

func maxHistorianRetentionDays(interval string) (int, bool) {
	value, ok := historianRetentionMaxDaysRevA[interval]
	return value, ok
}

func historianRetentionMaxDays() map[string]int {
	result := make(map[string]int, len(historianRetentionMaxDaysRevA))
	for _, interval := range historianIntervals {
		if value, ok := maxHistorianRetentionDays(interval); ok {
			result[interval] = value
		}
	}
	return result
}

func historianPointReserveBytes(interval string, retentionDays int) uint64 {
	maxDays, ok := maxHistorianRetentionDays(interval)
	if !ok || retentionDays <= 0 {
		return defaultHistorianPointReserve
	}
	if retentionDays > maxDays {
		retentionDays = maxDays
	}
	reserve := (defaultHistorianPointReserve*uint64(retentionDays) + uint64(maxDays) - 1) / uint64(maxDays)
	if reserve < defaultHistorianMinPointReserve {
		return defaultHistorianMinPointReserve
	}
	if reserve > defaultHistorianPointReserve {
		return defaultHistorianPointReserve
	}
	return reserve
}
