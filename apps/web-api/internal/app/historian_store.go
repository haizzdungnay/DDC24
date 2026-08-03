package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	historianSchemaVersion = 5
	historianHotBatchLimit = 1024
)

type HistorianStore struct {
	db             *sql.DB
	path           string
	archiveFault   func(string) error
	retentionFault func(string) error
	archiveMu      sync.RWMutex
}

type HotSample struct {
	PointID         string
	Generation      uint64
	BucketUTCMS     int64
	LastSampleUTCMS int64
	Value           float64
	Min             float64
	Max             float64
	Sum             float64
	Count           int
	WorstQuality    int
	Source          string
	PolicyRevision  uint64
}

type HistoryGap struct {
	PointID        string
	Generation     uint64
	FromUTCMS      int64
	ToUTCMS        int64
	Reason         string
	Detail         string
	PolicyRevision *uint64
	CreatedAtUTCMS int64
}

func OpenHistorianStore(path string) (*HistorianStore, error) {
	if path == "" {
		return nil, fmt.Errorf("historian store path is required")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve historian store path: %w", err)
	}
	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("prepare historian directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("chmod historian directory: %w", err)
	}
	file, err := os.OpenFile(absPath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err == nil {
		if err := file.Close(); err != nil {
			return nil, fmt.Errorf("prepare historian store file: %w", err)
		}
	} else if !os.IsExist(err) {
		return nil, fmt.Errorf("prepare historian store file: %w", err)
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(absPath), RawQuery: url.Values{
		"_pragma": []string{"busy_timeout(5000)", "foreign_keys(1)", "journal_mode(WAL)", "synchronous(FULL)", "trusted_schema(0)", "wal_autocheckpoint(1000)"},
	}.Encode()}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open historian store: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &HistorianStore{db: db, path: absPath}
	if err := store.init(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(absPath, 0o600); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("chmod historian store: %w", err)
	}
	return store, nil
}

func (s *HistorianStore) init(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read historian schema version: %w", err)
	}
	if version != 0 && version != 1 && version != 2 && version != 3 && version != 4 && version != historianSchemaVersion {
		return fmt.Errorf("unsupported historian schema version %d", version)
	}
	if version == 0 {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin historian schema: %w", err)
		}
		for _, stmt := range historianSchemaV1 {
			if _, err := tx.ExecContext(ctx, stmt); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("create historian schema: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version=%d", historianSchemaVersion)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("set historian schema version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit historian schema: %w", err)
		}
	} else if version == 1 {
		if err := s.migrateHistorianSchemaV1ToV2(ctx); err != nil {
			return err
		}
		version = 2
	}
	if version == 2 {
		if err := s.migrateHistorianSchemaV2ToV3(ctx); err != nil {
			return err
		}
		version = 3
	}
	if version == 3 {
		if err := s.migrateHistorianSchemaV3ToV4(ctx); err != nil {
			return err
		}
		version = 4
	}
	if version == 4 {
		if err := s.migrateHistorianSchemaV4ToV5(ctx); err != nil {
			return err
		}
	}
	for pragma, want := range map[string]string{"journal_mode": "wal", "synchronous": "2", "foreign_keys": "1", "busy_timeout": "5000", "trusted_schema": "0", "quick_check": "ok"} {
		var got string
		if err := s.db.QueryRowContext(ctx, "PRAGMA "+pragma).Scan(&got); err != nil {
			return fmt.Errorf("verify PRAGMA %s: %w", pragma, err)
		}
		if got != want {
			return fmt.Errorf("verify PRAGMA %s: got %s want %s", pragma, got, want)
		}
	}
	return nil
}

func (s *HistorianStore) migrateHistorianSchemaV1ToV2(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin historian schema migration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `ALTER TABLE point_policies RENAME TO point_policies_v1`); err != nil {
		return fmt.Errorf("rename historian policies during migration: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE point_policies (
		revision INTEGER NOT NULL,
		point_id TEXT NOT NULL,
		generation INTEGER NOT NULL CHECK (generation > 0),
		enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
		interval_ms INTEGER NOT NULL CHECK (interval_ms IN (1000,3000,5000,15000,30000,60000,180000,300000,900000,1800000,3600000)),
		start_utc_ms INTEGER NOT NULL CHECK (start_utc_ms > 0),
		retention_days INTEGER NOT NULL CHECK (retention_days >= 1),
		hot_cache_hours INTEGER NOT NULL CHECK (hot_cache_hours = 48),
		PRIMARY KEY (revision, point_id, generation),
		FOREIGN KEY (revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`); err != nil {
		return fmt.Errorf("create migrated historian policies: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO point_policies(revision,point_id,generation,enabled,interval_ms,start_utc_ms,retention_days,hot_cache_hours) SELECT revision,point_id,generation,enabled,interval_ms,start_utc_ms,retention_days,hot_cache_hours FROM point_policies_v1`); err != nil {
		return fmt.Errorf("copy migrated historian policies: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DROP TABLE point_policies_v1`); err != nil {
		return fmt.Errorf("drop migrated historian policies: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "PRAGMA user_version=2"); err != nil {
		return fmt.Errorf("set historian schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit historian schema migration: %w", err)
	}
	return nil
}

func (s *HistorianStore) migrateHistorianSchemaV2ToV3(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin historian prune schema migration: %w", err)
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`CREATE TABLE IF NOT EXISTS historian_activation (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
			config_sha256 BLOB NOT NULL CHECK (length(config_sha256) = 32),
			state TEXT NOT NULL CHECK (state IN ('prepared','active')),
			writer_authority TEXT NOT NULL CHECK (writer_authority IN ('legacy','v2')),
			legacy_quiesced INTEGER NOT NULL CHECK (legacy_quiesced IN (0,1)),
			migration_verified INTEGER NOT NULL CHECK (migration_verified IN (0,1)),
			prune_enabled INTEGER NOT NULL CHECK (prune_enabled IN (0,1)),
			stable_utc_ms INTEGER NOT NULL CHECK (stable_utc_ms > 0),
			reconciled_at_utc_ms INTEGER NOT NULL CHECK (reconciled_at_utc_ms > 0),
			FOREIGN KEY (policy_revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT
		) STRICT, WITHOUT ROWID`,
		`CREATE TABLE IF NOT EXISTS retention_prune_queue (
			block_id TEXT PRIMARY KEY,
			point_id TEXT NOT NULL,
			generation INTEGER NOT NULL CHECK (generation > 0),
			from_utc_ms INTEGER NOT NULL,
			to_utc_ms INTEGER NOT NULL CHECK (to_utc_ms > from_utc_ms),
			file_name TEXT NOT NULL,
			byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
			payload_sha256 BLOB NOT NULL CHECK (length(payload_sha256) = 32),
			queued_at_utc_ms INTEGER NOT NULL CHECK (queued_at_utc_ms > 0)
		) STRICT, WITHOUT ROWID`,
		`CREATE INDEX IF NOT EXISTS retention_prune_queue_identity ON retention_prune_queue(point_id,generation,from_utc_ms,to_utc_ms)`,
	} {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("create historian prune schema: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, "PRAGMA user_version=3"); err != nil {
		return fmt.Errorf("set historian prune schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit historian prune schema migration: %w", err)
	}
	return nil
}

func (s *HistorianStore) migrateHistorianSchemaV3ToV4(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin historian evidence schema migration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS historian_cutover_evidence (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		migration_id TEXT NOT NULL UNIQUE,
		policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
		policy_sha256 BLOB NOT NULL CHECK (length(policy_sha256) = 32),
		manifest_sha256 BLOB NOT NULL CHECK (length(manifest_sha256) = 32),
		backup_path TEXT NOT NULL,
		backup_source_identity TEXT NOT NULL,
		backup_sha256 BLOB NOT NULL CHECK (length(backup_sha256) = 32),
		backup_schema_sha256 BLOB NOT NULL CHECK (length(backup_schema_sha256) = 32),
		backup_byte_size INTEGER NOT NULL CHECK (backup_byte_size > 0),
		backup_quick_check TEXT NOT NULL CHECK (backup_quick_check = 'ok'),
		source_row_count INTEGER NOT NULL CHECK (source_row_count >= 0),
		accepted_row_count INTEGER NOT NULL CHECK (accepted_row_count >= 0),
		rejected_row_count INTEGER NOT NULL CHECK (rejected_row_count >= 0),
		source_keyspace_sha256 BLOB NOT NULL CHECK (length(source_keyspace_sha256) = 32),
		outcome_sha256 BLOB NOT NULL CHECK (length(outcome_sha256) = 32),
		verified_at_utc_ms INTEGER NOT NULL CHECK (verified_at_utc_ms > 0),
		CHECK (accepted_row_count + rejected_row_count = source_row_count),
		FOREIGN KEY (migration_id) REFERENCES migration_runs(migration_id) ON DELETE RESTRICT,
		FOREIGN KEY (policy_revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`); err != nil {
		return fmt.Errorf("create historian evidence schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "PRAGMA user_version=4"); err != nil {
		return fmt.Errorf("set historian schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit historian evidence schema migration: %w", err)
	}
	return nil
}

func (s *HistorianStore) migrateHistorianSchemaV4ToV5(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin historian quiesce schema migration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS historian_legacy_quiesce (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			epoch INTEGER NOT NULL CHECK (epoch > 0),
			token_sha256 BLOB NOT NULL CHECK (length(token_sha256) = 32),
			state TEXT NOT NULL CHECK (state IN ('quiesced','consumed','abandoned')),
			trend_db_path TEXT NOT NULL,
			stopped_at_utc_ms INTEGER NOT NULL CHECK (stopped_at_utc_ms > 0),
			migration_id TEXT,
			updated_at_utc_ms INTEGER NOT NULL CHECK (updated_at_utc_ms > 0)
		) STRICT, WITHOUT ROWID`); err != nil {
		return fmt.Errorf("create historian quiesce schema: %w", err)
	}
	for column, statement := range map[string]string{
		"quiesce_epoch":        `ALTER TABLE historian_cutover_evidence ADD COLUMN quiesce_epoch INTEGER NOT NULL DEFAULT 0`,
		"quiesce_token_sha256": `ALTER TABLE historian_cutover_evidence ADD COLUMN quiesce_token_sha256 BLOB NOT NULL DEFAULT X'0000000000000000000000000000000000000000000000000000000000000000'`,
	} {
		exists, err := sqliteTableColumnExists(ctx, tx, "historian_cutover_evidence", column)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("add historian quiesce column %s: %w", column, err)
			}
		}
	}
	if _, err := tx.ExecContext(ctx, "PRAGMA user_version=5"); err != nil {
		return fmt.Errorf("set historian schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit historian quiesce schema migration: %w", err)
	}
	return nil
}

func sqliteTableColumnExists(ctx context.Context, tx *sql.Tx, table, column string) (bool, error) {
	rows, err := tx.QueryContext(ctx, `SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return false, fmt.Errorf("inspect sqlite table %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

func (s *HistorianStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *HistorianStore) MirrorPolicy(ctx context.Context, config []byte, namespaceRevision, observedAtUTCMS uint64) error {
	var payload struct {
		Revision uint64 `json:"revision"`
		Points   []struct {
			PointID          string `json:"pointId"`
			Generation       uint64 `json:"generation"`
			DBLoggingEnabled bool   `json:"dbLoggingEnabled"`
			DBInterval       string `json:"dbInterval"`
			RetentionDays    int    `json:"retentionDays"`
			HotCacheHours    int    `json:"hotCacheHours"`
			StartAtUTC       string `json:"startAtUtc"`
		} `json:"points"`
	}
	if err := json.Unmarshal(config, &payload); err != nil {
		return fmt.Errorf("parse historian policy mirror: %w", err)
	}
	if observedAtUTCMS == 0 {
		observedAtUTCMS = uint64(time.Now().UTC().UnixMilli())
	}
	digest := sha256.Sum256(config)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin policy mirror: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `INSERT INTO policy_revisions(revision,namespace_revision,schema_id,config_sha256,config_bytes,observed_at_utc_ms,mirror_status) VALUES(?,?,?,?,?,?,'verified') ON CONFLICT(revision) DO NOTHING`, payload.Revision, namespaceRevision, "hist-v1", digest[:], config, observedAtUTCMS)
	if err != nil {
		return fmt.Errorf("mirror policy revision: %w", err)
	}
	inserted, _ := result.RowsAffected()
	if inserted == 0 {
		var existing []byte
		if err := tx.QueryRowContext(ctx, `SELECT config_sha256 FROM policy_revisions WHERE revision=?`, payload.Revision).Scan(&existing); err != nil {
			return fmt.Errorf("read mirrored policy checksum: %w", err)
		}
		if !equalBytes(existing, digest[:]) {
			return fmt.Errorf("policy revision %d checksum conflict", payload.Revision)
		}
		return tx.Commit()
	}
	for _, point := range payload.Points {
		intervalMS, ok := historianIntervalMilliseconds(point.DBInterval)
		start, parseErr := time.Parse(time.RFC3339, point.StartAtUTC)
		// A legacy mirror may contain the former 180-day floor; newly committed
		// policies are bounded by the interval-specific Rev A maximum in the
		// policy service. The store accepts any positive value and never prunes
		// solely from this mirror until activation/cutover enables a safe writer.
		if point.PointID == "" || point.Generation == 0 || !ok || parseErr != nil || point.RetentionDays < 1 || point.HotCacheHours != 48 {
			return fmt.Errorf("invalid mirrored policy point %s", point.PointID)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO point_policies(revision,point_id,generation,enabled,interval_ms,start_utc_ms,retention_days,hot_cache_hours) VALUES(?,?,?,?,?,?,?,?)`, payload.Revision, point.PointID, point.Generation, boolToInt(point.DBLoggingEnabled), intervalMS, start.UnixMilli(), point.RetentionDays, point.HotCacheHours); err != nil {
			return fmt.Errorf("mirror point policy: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit policy mirror: %w", err)
	}
	return nil
}

func (s *HistorianStore) InsertHotBatch(ctx context.Context, samples []HotSample) error {
	if len(samples) > historianHotBatchLimit {
		return fmt.Errorf("hot sample batch exceeds %d rows", historianHotBatchLimit)
	}
	for _, sample := range samples {
		if sample.PointID == "" || sample.Generation == 0 || sample.BucketUTCMS <= 0 || sample.BucketUTCMS%15000 != 0 || sample.LastSampleUTCMS < sample.BucketUTCMS || sample.LastSampleUTCMS >= sample.BucketUTCMS+15000 || sample.Count <= 0 || sample.WorstQuality < 0 || sample.WorstQuality > 2 || sample.Source == "" || sample.PolicyRevision == 0 || !finite(sample.Value) || !finite(sample.Min) || !finite(sample.Max) || !finite(sample.Sum) || sample.Min > sample.Value || sample.Value > sample.Max {
			return fmt.Errorf("invalid hot sample %s", sample.PointID)
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, sample := range samples {
		result, err := tx.ExecContext(ctx, `INSERT INTO hot_samples(point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(point_id,generation,bucket_utc_ms) DO NOTHING`, sample.PointID, sample.Generation, sample.BucketUTCMS, sample.LastSampleUTCMS, sample.Value, sample.Min, sample.Max, sample.Sum, sample.Count, sample.WorstQuality, sample.Source, sample.PolicyRevision)
		if err != nil {
			return fmt.Errorf("insert hot sample: %w", err)
		}
		inserted, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read hot sample insert result: %w", err)
		}
		if inserted == 0 {
			var existing HotSample
			err := tx.QueryRowContext(ctx, `SELECT point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision FROM hot_samples WHERE point_id=? AND generation=? AND bucket_utc_ms=?`, sample.PointID, sample.Generation, sample.BucketUTCMS).Scan(&existing.PointID, &existing.Generation, &existing.BucketUTCMS, &existing.LastSampleUTCMS, &existing.Value, &existing.Min, &existing.Max, &existing.Sum, &existing.Count, &existing.WorstQuality, &existing.Source, &existing.PolicyRevision)
			if err != nil {
				return fmt.Errorf("read existing hot sample: %w", err)
			}
			if existing != sample {
				return fmt.Errorf("hot sample conflict for %s generation %d bucket %d", sample.PointID, sample.Generation, sample.BucketUTCMS)
			}
		}
	}
	return tx.Commit()
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func (s *HistorianStore) InsertGap(ctx context.Context, gap HistoryGap) error {
	if gap.PointID == "" || gap.Generation == 0 || gap.FromUTCMS <= 0 || gap.ToUTCMS <= gap.FromUTCMS || gap.Reason == "" || gap.CreatedAtUTCMS <= 0 {
		return fmt.Errorf("invalid history gap")
	}
	var revision any
	if gap.PolicyRevision != nil {
		revision = *gap.PolicyRevision
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO history_gaps(point_id,generation,from_utc_ms,to_utc_ms,reason,detail,policy_revision,created_at_utc_ms) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(point_id,generation,from_utc_ms,to_utc_ms,reason,detail) DO NOTHING`, gap.PointID, gap.Generation, gap.FromUTCMS, gap.ToUTCMS, gap.Reason, gap.Detail, revision, gap.CreatedAtUTCMS)
	if err != nil {
		return fmt.Errorf("insert history gap: %w", err)
	}
	return nil
}

func (s *HistorianStore) LastHotBucket(ctx context.Context, pointID string, generation uint64) (int64, bool, error) {
	var bucket int64
	err := s.db.QueryRowContext(ctx, `SELECT bucket_utc_ms FROM hot_samples WHERE point_id=? AND generation=? ORDER BY bucket_utc_ms DESC LIMIT 1`, pointID, generation).Scan(&bucket)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read last hot bucket: %w", err)
	}
	return bucket, true, nil
}

func historianIntervalMilliseconds(value string) (int64, bool) {
	values := map[string]int64{"1s": 1000, "3s": 3000, "5s": 5000, "15s": 15000, "30s": 30000, "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000, "60m": 3600000}
	interval, ok := values[value]
	return interval, ok
}

func equalBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

var historianSchemaV1 = []string{
	`CREATE TABLE historian_meta (key TEXT PRIMARY KEY, value BLOB NOT NULL) STRICT, WITHOUT ROWID`,
	`CREATE TABLE policy_revisions (
		revision INTEGER PRIMARY KEY CHECK (revision >= 0),
		namespace_revision INTEGER NOT NULL CHECK (namespace_revision >= 0),
		schema_id TEXT NOT NULL,
		config_sha256 BLOB NOT NULL CHECK (length(config_sha256) = 32),
		config_bytes BLOB NOT NULL,
		observed_at_utc_ms INTEGER NOT NULL CHECK (observed_at_utc_ms > 0),
		mirror_status TEXT NOT NULL CHECK (mirror_status IN ('observed','verified','conflict')),
		UNIQUE (schema_id, revision)
	) STRICT`,
	`CREATE TABLE point_policies (
		revision INTEGER NOT NULL,
		point_id TEXT NOT NULL,
		generation INTEGER NOT NULL CHECK (generation > 0),
		enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
		interval_ms INTEGER NOT NULL CHECK (interval_ms IN (1000,3000,5000,15000,30000,60000,180000,300000,900000,1800000,3600000)),
		start_utc_ms INTEGER NOT NULL CHECK (start_utc_ms > 0),
		retention_days INTEGER NOT NULL CHECK (retention_days >= 1),
		hot_cache_hours INTEGER NOT NULL CHECK (hot_cache_hours = 48),
		PRIMARY KEY (revision, point_id, generation),
		FOREIGN KEY (revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE hot_samples (
		point_id TEXT NOT NULL,
		generation INTEGER NOT NULL CHECK (generation > 0),
		bucket_utc_ms INTEGER NOT NULL CHECK (bucket_utc_ms > 0 AND bucket_utc_ms % 15000 = 0),
		last_sample_utc_ms INTEGER NOT NULL,
		value REAL NOT NULL, min_value REAL NOT NULL, max_value REAL NOT NULL, sum_value REAL NOT NULL,
		sample_count INTEGER NOT NULL CHECK (sample_count > 0),
		worst_quality INTEGER NOT NULL CHECK (worst_quality BETWEEN 0 AND 2),
		source TEXT NOT NULL,
		policy_revision INTEGER NOT NULL,
		PRIMARY KEY (point_id, generation, bucket_utc_ms),
		FOREIGN KEY (policy_revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT,
		CHECK (last_sample_utc_ms >= bucket_utc_ms AND last_sample_utc_ms < bucket_utc_ms + 15000),
		CHECK (min_value <= value AND value <= max_value AND min_value <= max_value)
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE history_gaps (
		gap_id INTEGER PRIMARY KEY,
		point_id TEXT NOT NULL,
		generation INTEGER NOT NULL CHECK (generation > 0),
		from_utc_ms INTEGER NOT NULL CHECK (from_utc_ms > 0),
		to_utc_ms INTEGER NOT NULL CHECK (to_utc_ms > from_utc_ms),
		reason TEXT NOT NULL CHECK (reason IN ('restart','clock','queue','snapshot','storage','migration','corruption')),
		detail TEXT NOT NULL DEFAULT '',
		policy_revision INTEGER,
		created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms > 0),
		UNIQUE (point_id, generation, from_utc_ms, to_utc_ms, reason, detail),
		FOREIGN KEY (policy_revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT
	) STRICT`,
	`CREATE INDEX history_gaps_identity_range ON history_gaps(point_id, generation, from_utc_ms, to_utc_ms)`,
	`CREATE TABLE archive_blocks (
		block_id TEXT PRIMARY KEY,
		point_id TEXT NOT NULL,
		generation INTEGER NOT NULL CHECK (generation > 0),
		from_utc_ms INTEGER NOT NULL CHECK (from_utc_ms > 0 AND from_utc_ms % 15000 = 0),
		to_utc_ms INTEGER NOT NULL CHECK (to_utc_ms > from_utc_ms AND to_utc_ms % 15000 = 0),
		codec TEXT NOT NULL CHECK (codec = 'mkhab-v1'),
		file_name TEXT NOT NULL UNIQUE,
		byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
		sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
		gap_count INTEGER NOT NULL CHECK (gap_count >= 0),
		payload_sha256 BLOB NOT NULL CHECK (length(payload_sha256) = 32),
		state TEXT NOT NULL CHECK (state IN ('building','verified','committed')),
		created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms > 0),
		verified_at_utc_ms INTEGER,
		committed_at_utc_ms INTEGER,
		UNIQUE (point_id, generation, from_utc_ms, to_utc_ms)
	) STRICT, WITHOUT ROWID`,
	`CREATE INDEX archive_blocks_query ON archive_blocks(point_id, generation, state, from_utc_ms, to_utc_ms)`,
	`CREATE TABLE archive_watermarks (
		point_id TEXT NOT NULL,
		generation INTEGER NOT NULL CHECK (generation > 0),
		origin_utc_ms INTEGER NOT NULL CHECK (origin_utc_ms >= 0 AND origin_utc_ms % 15000 = 0),
		covered_until_utc_ms INTEGER NOT NULL CHECK (covered_until_utc_ms >= origin_utc_ms AND covered_until_utc_ms % 15000 = 0),
		block_id TEXT NOT NULL,
		updated_at_utc_ms INTEGER NOT NULL CHECK (updated_at_utc_ms > 0),
		PRIMARY KEY (point_id, generation),
		FOREIGN KEY (block_id) REFERENCES archive_blocks(block_id) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE migration_runs (
		migration_id TEXT PRIMARY KEY,
		source_identity TEXT NOT NULL,
		source_sha256 BLOB CHECK (source_sha256 IS NULL OR length(source_sha256) = 32),
		namespace_revision INTEGER NOT NULL CHECK (namespace_revision >= 0),
		manifest_json BLOB NOT NULL,
		manifest_sha256 BLOB NOT NULL CHECK (length(manifest_sha256) = 32),
		phase TEXT NOT NULL CHECK (phase IN ('detected','backed_up','copying','verified')),
		cursor_json BLOB,
		backup_path TEXT,
		created_at_utc_ms INTEGER NOT NULL,
		updated_at_utc_ms INTEGER NOT NULL
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE migration_rejections (
		migration_id TEXT NOT NULL,
		legacy_point_id TEXT NOT NULL,
		legacy_ts INTEGER NOT NULL,
		reason TEXT NOT NULL,
		row_json BLOB NOT NULL,
		row_sha256 BLOB NOT NULL CHECK (length(row_sha256) = 32),
		PRIMARY KEY (migration_id, legacy_point_id, legacy_ts, row_sha256),
		FOREIGN KEY (migration_id) REFERENCES migration_runs(migration_id) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE migration_staging (
		migration_id TEXT NOT NULL,
		row_sha256 BLOB NOT NULL CHECK (length(row_sha256) = 32),
		legacy_ts INTEGER NOT NULL,
		legacy_point_id TEXT NOT NULL,
		value REAL NOT NULL,
		quality INTEGER NOT NULL,
		PRIMARY KEY (migration_id, row_sha256),
		FOREIGN KEY (migration_id) REFERENCES migration_runs(migration_id) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE historian_activation (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
		config_sha256 BLOB NOT NULL CHECK (length(config_sha256) = 32),
		state TEXT NOT NULL CHECK (state IN ('prepared','active')),
		writer_authority TEXT NOT NULL CHECK (writer_authority IN ('legacy','v2')),
		legacy_quiesced INTEGER NOT NULL CHECK (legacy_quiesced IN (0,1)),
		migration_verified INTEGER NOT NULL CHECK (migration_verified IN (0,1)),
		prune_enabled INTEGER NOT NULL CHECK (prune_enabled IN (0,1)),
		stable_utc_ms INTEGER NOT NULL CHECK (stable_utc_ms > 0),
		reconciled_at_utc_ms INTEGER NOT NULL CHECK (reconciled_at_utc_ms > 0),
		FOREIGN KEY (policy_revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE retention_prune_queue (
		block_id TEXT PRIMARY KEY,
		point_id TEXT NOT NULL,
		generation INTEGER NOT NULL CHECK (generation > 0),
		from_utc_ms INTEGER NOT NULL,
		to_utc_ms INTEGER NOT NULL CHECK (to_utc_ms > from_utc_ms),
		file_name TEXT NOT NULL,
		byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
		payload_sha256 BLOB NOT NULL CHECK (length(payload_sha256) = 32),
		queued_at_utc_ms INTEGER NOT NULL CHECK (queued_at_utc_ms > 0)
	) STRICT, WITHOUT ROWID`,
	`CREATE INDEX retention_prune_queue_identity ON retention_prune_queue(point_id,generation,from_utc_ms,to_utc_ms)`,
	`CREATE TABLE historian_cutover_evidence (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		migration_id TEXT NOT NULL UNIQUE,
		policy_revision INTEGER NOT NULL CHECK (policy_revision > 0),
		policy_sha256 BLOB NOT NULL CHECK (length(policy_sha256) = 32),
		manifest_sha256 BLOB NOT NULL CHECK (length(manifest_sha256) = 32),
		backup_path TEXT NOT NULL,
		backup_source_identity TEXT NOT NULL,
		backup_sha256 BLOB NOT NULL CHECK (length(backup_sha256) = 32),
		backup_schema_sha256 BLOB NOT NULL CHECK (length(backup_schema_sha256) = 32),
		backup_byte_size INTEGER NOT NULL CHECK (backup_byte_size > 0),
		backup_quick_check TEXT NOT NULL CHECK (backup_quick_check = 'ok'),
		source_row_count INTEGER NOT NULL CHECK (source_row_count >= 0),
		accepted_row_count INTEGER NOT NULL CHECK (accepted_row_count >= 0),
		rejected_row_count INTEGER NOT NULL CHECK (rejected_row_count >= 0),
		source_keyspace_sha256 BLOB NOT NULL CHECK (length(source_keyspace_sha256) = 32),
		outcome_sha256 BLOB NOT NULL CHECK (length(outcome_sha256) = 32),
		quiesce_epoch INTEGER NOT NULL CHECK (quiesce_epoch >= 0),
		quiesce_token_sha256 BLOB NOT NULL CHECK (length(quiesce_token_sha256) = 32),
		verified_at_utc_ms INTEGER NOT NULL CHECK (verified_at_utc_ms > 0),
		CHECK (accepted_row_count + rejected_row_count = source_row_count),
		FOREIGN KEY (migration_id) REFERENCES migration_runs(migration_id) ON DELETE RESTRICT,
		FOREIGN KEY (policy_revision) REFERENCES policy_revisions(revision) ON DELETE RESTRICT
	) STRICT, WITHOUT ROWID`,
	`CREATE TABLE historian_legacy_quiesce (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		epoch INTEGER NOT NULL CHECK (epoch > 0),
		token_sha256 BLOB NOT NULL CHECK (length(token_sha256) = 32),
		state TEXT NOT NULL CHECK (state IN ('quiesced','consumed','abandoned')),
		trend_db_path TEXT NOT NULL,
		stopped_at_utc_ms INTEGER NOT NULL CHECK (stopped_at_utc_ms > 0),
		migration_id TEXT,
		updated_at_utc_ms INTEGER NOT NULL CHECK (updated_at_utc_ms > 0)
	) STRICT, WITHOUT ROWID`,
}
