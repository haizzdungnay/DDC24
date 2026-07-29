package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	defaultTrendDBPath          = "/data/mkddc/trend.sqlite"
	defaultTrendIntervalS       = 10
	defaultTrendRetentionRecord = 8640
)

type TrendStore struct {
	db            *sql.DB
	path          string
	writesMu      sync.RWMutex
	writeTxnMu    sync.Mutex
	writesEnabled bool
}

var ErrLegacyHistorianQuiesced = errors.New("legacy historian writers are quiesced")

type Sample struct {
	TS      int64
	PointID string
	Value   any
	Quality int
}

func OpenTrendStore(path string) (*TrendStore, error) {
	if strings.TrimSpace(path) == "" {
		path = defaultTrendDBPath
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("prepare trend db dir: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open trend db: %w", err)
	}
	store := &TrendStore{db: db, path: path, writesEnabled: true}
	if err := store.init(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	_ = os.Chmod(path, 0o600)
	return store, nil
}

func (s *TrendStore) init(ctx context.Context) error {
	stmts := []string{
		`PRAGMA journal_mode=WAL`,
		`PRAGMA synchronous=NORMAL`,
		`PRAGMA busy_timeout=5000`,
		`CREATE TABLE IF NOT EXISTS samples (
			ts INTEGER NOT NULL,
			point_id TEXT NOT NULL,
			value REAL NOT NULL,
			quality INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (point_id, ts)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_samples_point_ts ON samples(point_id, ts)`,
		`CREATE TABLE IF NOT EXISTS trend_config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			enabled INTEGER NOT NULL DEFAULT 1,
			point_ids_json TEXT NOT NULL DEFAULT '[]',
			interval_s INTEGER NOT NULL DEFAULT 30,
			retention_records INTEGER NOT NULL DEFAULT 2880,
			retention_hours INTEGER NOT NULL DEFAULT 24,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("init trend db: %w", err)
		}
	}
	return nil
}

func (s *TrendStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	s.writesMu.Lock()
	defer s.writesMu.Unlock()
	return s.db.Close()
}

// QuiesceWriters fences legacy TrendStore mutations and checkpoints WAL.
func (s *TrendStore) QuiesceWriters(ctx context.Context) error {
	if s == nil || s.db == nil {
		return ErrLegacyHistorianQuiesced
	}
	s.writesMu.Lock()
	defer s.writesMu.Unlock()
	if !s.writesEnabled {
		return nil
	}
	s.writesEnabled = false
	if _, err := s.db.ExecContext(ctx, "PRAGMA wal_checkpoint(FULL)"); err != nil {
		s.writesEnabled = true
		return fmt.Errorf("checkpoint legacy trend WAL: %w", err)
	}
	return nil
}

func (s *TrendStore) ResumeWriters() {
	if s == nil {
		return
	}
	s.writesMu.Lock()
	s.writesEnabled = true
	s.writesMu.Unlock()
}

func (s *TrendStore) beginWrite() (func(), error) {
	if s == nil || s.db == nil {
		return func() {}, fmt.Errorf("trend store unavailable")
	}
	s.writesMu.RLock()
	if !s.writesEnabled {
		s.writesMu.RUnlock()
		return func() {}, ErrLegacyHistorianQuiesced
	}
	// SQLite WAL supports concurrent readers, but legacy sampler/config/prune
	// transactions still contend on one writer lock. Serialize writers after
	// the authority fence so SQLITE_BUSY does not become silent data loss.
	s.writeTxnMu.Lock()
	return func() {
		s.writeTxnMu.Unlock()
		s.writesMu.RUnlock()
	}, nil
}

func (s *TrendStore) InsertBatch(ctx context.Context, samples []Sample) error {
	if s == nil || s.db == nil || len(samples) == 0 {
		return nil
	}
	release, err := s.beginWrite()
	if err != nil {
		return err
	}
	defer release()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin insert samples: %w", err)
	}
	stmt, err := tx.PrepareContext(ctx, `INSERT OR REPLACE INTO samples(ts, point_id, value, quality) VALUES(?, ?, ?, ?)`) // one sample per point/sec
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("prepare insert samples: %w", err)
	}
	for _, sample := range samples {
		pointID := strings.TrimSpace(sample.PointID)
		if pointID == "" {
			continue
		}
		value, ok := numericPointValue(sample.Value)
		if !ok {
			continue
		}
		if _, err := stmt.ExecContext(ctx, sample.TS, pointID, value, sample.Quality); err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			return fmt.Errorf("insert sample: %w", err)
		}
	}
	if err := stmt.Close(); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("close insert samples: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit insert samples: %w", err)
	}
	return nil
}

func (s *TrendStore) Query(ctx context.Context, pointIDs []string, fromTs, toTs int64) ([]Sample, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("trend store unavailable")
	}
	ids := storagePointIDs(normalizePointIDs(pointIDs))
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, 0, len(ids)+2)
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}
	args = append(args, fromTs, toTs)
	query := fmt.Sprintf(`SELECT ts, point_id, value, quality FROM samples WHERE point_id IN (%s) AND ts >= ? AND ts <= ? ORDER BY ts ASC, point_id ASC`, strings.Join(placeholders, ","))
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query samples: %w", err)
	}
	defer rows.Close()
	var out []Sample
	for rows.Next() {
		var value float64
		var sample Sample
		if err := rows.Scan(&sample.TS, &sample.PointID, &value, &sample.Quality); err != nil {
			return nil, fmt.Errorf("scan sample: %w", err)
		}
		sample.Value = value
		out = append(out, sample)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate samples: %w", err)
	}
	return out, nil
}

func (s *TrendStore) Prune(ctx context.Context, retentionRecords int) error {
	if s == nil || s.db == nil {
		return nil
	}
	release, err := s.beginWrite()
	if err != nil {
		return err
	}
	defer release()
	if retentionRecords < 1 {
		retentionRecords = defaultTrendRetentionRecord
	}
	_, err = s.db.ExecContext(ctx, `
		DELETE FROM samples
		WHERE rowid IN (
			SELECT rowid FROM (
				SELECT rowid, ROW_NUMBER() OVER (PARTITION BY point_id ORDER BY ts DESC) AS rn
				FROM samples
			)
			WHERE rn > ?
		)`, retentionRecords)
	if err != nil {
		return fmt.Errorf("prune samples: %w", err)
	}
	return nil
}

func (s *TrendStore) PruneBefore(ctx context.Context, pointID string, beforeTs int64) error {
	if s == nil || s.db == nil || strings.TrimSpace(pointID) == "" || beforeTs <= 0 {
		return nil
	}
	release, err := s.beginWrite()
	if err != nil {
		return err
	}
	defer release()
	_, err = s.db.ExecContext(ctx, `DELETE FROM samples WHERE point_id = ? AND ts < ?`, canonicalPointID(pointID), beforeTs)
	if err != nil {
		return fmt.Errorf("prune samples before: %w", err)
	}
	return nil
}

func (s *TrendStore) PurgePoint(ctx context.Context, pointID string) error {
	if s == nil || s.db == nil {
		return nil
	}
	pointID = canonicalHistoryPointID(pointID)
	if pointID == "" {
		return fmt.Errorf("point id is required")
	}
	// Administrative deletion is allowed while legacy sampling is quiesced.
	s.writesMu.RLock()
	s.writeTxnMu.Lock()
	defer func() {
		s.writeTxnMu.Unlock()
		s.writesMu.RUnlock()
	}()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin trend point purge: %w", err)
	}
	defer tx.Rollback()
	ids := storagePointIDs([]string{pointID})
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i], args[i] = "?", id
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM samples WHERE point_id IN (`+strings.Join(placeholders, ",")+`)`, args...); err != nil {
		return fmt.Errorf("purge trend samples: %w", err)
	}
	var raw string
	err = tx.QueryRowContext(ctx, `SELECT point_ids_json FROM trend_config WHERE id=1`).Scan(&raw)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("read trend point selection: %w", err)
	}
	if err == nil {
		var selected []string
		if err := json.Unmarshal([]byte(raw), &selected); err != nil {
			return fmt.Errorf("parse trend point selection: %w", err)
		}
		kept := make([]string, 0, len(selected))
		for _, id := range selected {
			if canonicalHistoryPointID(id) != pointID {
				kept = append(kept, id)
			}
		}
		data, err := json.Marshal(normalizePointIDs(kept))
		if err != nil {
			return fmt.Errorf("encode trend point selection: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE trend_config SET point_ids_json=?,updated_at=? WHERE id=1`, string(data), time.Now().UTC().Unix()); err != nil {
			return fmt.Errorf("purge trend point selection: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit trend point purge: %w", err)
	}
	return nil
}

func (s *TrendStore) GetConfig(ctx context.Context) (TrendConfig, error) {
	cfg := defaultTrendConfig()
	if s == nil || s.db == nil {
		return cfg, fmt.Errorf("trend store unavailable")
	}
	var enabled int
	var pointIDsJSON string
	var intervalS, retentionRecords int
	err := s.db.QueryRowContext(ctx, `SELECT enabled, point_ids_json, interval_s, retention_records FROM trend_config WHERE id = 1`).Scan(&enabled, &pointIDsJSON, &intervalS, &retentionRecords)
	if err == sql.ErrNoRows {
		return cfg, nil
	}
	if err != nil {
		return cfg, fmt.Errorf("read trend config: %w", err)
	}
	cfg.Enabled = enabled != 0
	if err := json.Unmarshal([]byte(pointIDsJSON), &cfg.PointIDs); err != nil {
		return cfg, fmt.Errorf("parse trend point ids: %w", err)
	}
	cfg.IntervalS = intervalS
	cfg.RetentionRecords = retentionRecords
	cfg.normalize()
	return cfg, nil
}

func (s *TrendStore) SaveConfig(ctx context.Context, cfg TrendConfig) (TrendConfig, error) {
	if s == nil || s.db == nil {
		return TrendConfig{}, fmt.Errorf("trend store unavailable")
	}
	release, err := s.beginWrite()
	if err != nil {
		return TrendConfig{}, err
	}
	defer release()
	cfg.normalize()
	pointIDsJSON, err := json.Marshal(cfg.PointIDs)
	if err != nil {
		return TrendConfig{}, fmt.Errorf("encode trend point ids: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO trend_config(id, enabled, point_ids_json, interval_s, retention_records, retention_hours, updated_at)
		VALUES(1, ?, ?, ?, ?, 24, ?)
		ON CONFLICT(id) DO UPDATE SET
			enabled = excluded.enabled,
			point_ids_json = excluded.point_ids_json,
			interval_s = excluded.interval_s,
			retention_records = excluded.retention_records,
			retention_hours = excluded.retention_hours,
			updated_at = excluded.updated_at`, boolToInt(cfg.Enabled), string(pointIDsJSON), cfg.IntervalS, cfg.RetentionRecords, time.Now().UTC().Unix())
	if err != nil {
		return TrendConfig{}, fmt.Errorf("save trend config: %w", err)
	}
	return cfg, nil
}

func defaultTrendConfig() TrendConfig {
	return TrendConfig{Enabled: true, PointIDs: []string{}, IntervalS: defaultTrendIntervalS, RetentionRecords: defaultTrendRetentionRecord}
}

func (c *TrendConfig) normalize() {
	if c.IntervalS == 0 {
		c.IntervalS = defaultTrendIntervalS
	}
	if c.RetentionRecords == 0 {
		c.RetentionRecords = defaultTrendRetentionRecord
	}
	c.PointIDs = normalizePointIDs(c.PointIDs)
}

func normalizePointIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = canonicalHistoryPointID(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func storagePointIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids)*3)
	out := make([]string, 0, len(ids)*3)
	for _, id := range ids {
		for _, item := range append([]string{id}, legacyPointIDAliases(id)...) {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if _, ok := seen[item]; ok {
				continue
			}
			seen[item] = struct{}{}
			out = append(out, item)
		}
	}
	sort.Strings(out)
	return out
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
