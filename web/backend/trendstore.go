package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	defaultTrendDBPath          = "/data/mkddc/trend.sqlite"
	defaultTrendIntervalS       = 30
	defaultTrendRetentionRecord = 2880
)

type TrendStore struct {
	db *sql.DB
}

type Sample struct {
	TS      int64
	PointID string
	Value   float64
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
	store := &TrendStore{db: db}
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
	return s.db.Close()
}

func (s *TrendStore) InsertBatch(ctx context.Context, samples []Sample) error {
	if s == nil || s.db == nil || len(samples) == 0 {
		return nil
	}
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
		if _, err := stmt.ExecContext(ctx, sample.TS, pointID, sample.Value, sample.Quality); err != nil {
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
	ids := normalizePointIDs(pointIDs)
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
		var sample Sample
		if err := rows.Scan(&sample.TS, &sample.PointID, &sample.Value, &sample.Quality); err != nil {
			return nil, fmt.Errorf("scan sample: %w", err)
		}
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
	if retentionRecords < 1 {
		retentionRecords = defaultTrendRetentionRecord
	}
	_, err := s.db.ExecContext(ctx, `
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
		id = strings.TrimSpace(id)
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

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
