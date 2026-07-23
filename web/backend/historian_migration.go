package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	sqlite3 "modernc.org/sqlite"
)

type sqliteBackuper interface {
	NewBackup(string) (*sqlite3.Backup, error)
}

type SQLiteBackupEvidence struct {
	Path           string
	SourceIdentity string
	SHA256         string
	SchemaSHA256   string
	QuickCheck     string
	ByteSize       int64
}

func NativeSQLiteBackup(ctx context.Context, source *sql.DB, destination string, pages int32) error {
	_, err := CreateNativeSQLiteBackup(ctx, source, destination, pages)
	return err
}

func CreateNativeSQLiteBackup(ctx context.Context, source *sql.DB, destination string, pages int32) (SQLiteBackupEvidence, error) {
	if source == nil || destination == "" {
		return SQLiteBackupEvidence{}, fmt.Errorf("source and destination are required")
	}
	if pages <= 0 {
		pages = 128
	}
	if _, err := os.Lstat(destination); err == nil || !os.IsNotExist(err) {
		return SQLiteBackupEvidence{}, fmt.Errorf("backup destination already exists")
	}
	dir := filepath.Dir(destination)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return SQLiteBackupEvidence{}, err
	}
	partial, err := os.CreateTemp(dir, filepath.Base(destination)+".partial-*")
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	partialPath := partial.Name()
	if err := partial.Chmod(0o600); err != nil {
		partial.Close()
		return SQLiteBackupEvidence{}, err
	}
	if err := partial.Close(); err != nil {
		return SQLiteBackupEvidence{}, err
	}
	conn, err := source.Conn(ctx)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	defer conn.Close()
	var sourceIdentity string
	if err := conn.QueryRowContext(ctx, `SELECT file FROM pragma_database_list WHERE name='main'`).Scan(&sourceIdentity); err != nil {
		return SQLiteBackupEvidence{}, fmt.Errorf("read sqlite source identity: %w", err)
	}
	err = conn.Raw(func(driverConn any) error {
		backuper, ok := driverConn.(sqliteBackuper)
		if !ok {
			return fmt.Errorf("sqlite driver does not support backup")
		}
		backup, err := backuper.NewBackup(partialPath)
		if err != nil {
			return err
		}
		var stepErr error
		busyRetries := 0
		for more := true; more; {
			if err := ctx.Err(); err != nil {
				stepErr = err
				break
			}
			more, stepErr = backup.Step(pages)
			if stepErr != nil {
				if sqliteBackupBusy(stepErr) && busyRetries < 8 {
					busyRetries++
					continue
				}
				break
			}
			busyRetries = 0
		}
		finishErr := backup.Finish()
		if stepErr != nil {
			return stepErr
		}
		return finishErr
	})
	if err != nil {
		return SQLiteBackupEvidence{}, fmt.Errorf("backup sqlite: %w", err)
	}
	durable, err := os.OpenFile(partialPath, os.O_RDWR, 0)
	if err != nil {
		return SQLiteBackupEvidence{}, fmt.Errorf("open sqlite backup for sync: %w", err)
	}
	if err := durable.Sync(); err != nil {
		durable.Close()
		return SQLiteBackupEvidence{}, fmt.Errorf("sync sqlite backup: %w", err)
	}
	if err := durable.Close(); err != nil {
		return SQLiteBackupEvidence{}, fmt.Errorf("close synced sqlite backup: %w", err)
	}
	evidence, err := verifySQLiteBackup(ctx, partialPath)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	evidence.SourceIdentity = sourceIdentity
	if err := os.Link(partialPath, destination); err != nil {
		return SQLiteBackupEvidence{}, fmt.Errorf("publish sqlite backup: %w", err)
	}
	if err := syncDirectory(dir); err != nil {
		return SQLiteBackupEvidence{}, err
	}
	published, err := verifySQLiteBackup(ctx, destination)
	if err != nil {
		return SQLiteBackupEvidence{}, fmt.Errorf("verify published sqlite backup: %w", err)
	}
	if published.SHA256 != evidence.SHA256 || published.SchemaSHA256 != evidence.SchemaSHA256 || published.ByteSize != evidence.ByteSize {
		return SQLiteBackupEvidence{}, fmt.Errorf("published sqlite backup mismatch")
	}
	if err := os.Remove(partialPath); err != nil {
		return SQLiteBackupEvidence{}, err
	}
	if err := syncDirectory(dir); err != nil {
		return SQLiteBackupEvidence{}, err
	}
	evidence.Path = destination
	return evidence, nil
}

func verifySQLiteBackup(ctx context.Context, path string) (SQLiteBackupEvidence, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(absPath), RawQuery: url.Values{"mode": {"ro"}, "_pragma": {"trusted_schema(0)"}}.Encode()}).String()
	backup, err := sql.Open("sqlite", dsn)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	defer backup.Close()
	var check string
	if err := backup.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&check); err != nil || check != "ok" {
		return SQLiteBackupEvidence{}, fmt.Errorf("verify sqlite backup: %s: %w", check, err)
	}
	rows, err := backup.QueryContext(ctx, `SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name,sql`)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	var schema []string
	for rows.Next() {
		var kind, name, table, statement string
		if err := rows.Scan(&kind, &name, &table, &statement); err != nil {
			rows.Close()
			return SQLiteBackupEvidence{}, err
		}
		schema = append(schema, kind+"\x00"+name+"\x00"+table+"\x00"+statement)
	}
	if err := rows.Close(); err != nil {
		return SQLiteBackupEvidence{}, err
	}
	if err := backup.Close(); err != nil {
		return SQLiteBackupEvidence{}, err
	}
	schemaDigest := sha256.Sum256([]byte(strings.Join(schema, "\n")))
	file, err := os.Open(path)
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		file.Close()
		return SQLiteBackupEvidence{}, err
	}
	info, err := file.Stat()
	closeErr := file.Close()
	if err != nil {
		return SQLiteBackupEvidence{}, err
	}
	if closeErr != nil {
		return SQLiteBackupEvidence{}, closeErr
	}
	return SQLiteBackupEvidence{SHA256: hex.EncodeToString(hash.Sum(nil)), SchemaSHA256: hex.EncodeToString(schemaDigest[:]), QuickCheck: check, ByteSize: info.Size()}, nil
}

func sqliteBackupBusy(err error) bool {
	var sqliteErr *sqlite3.Error
	if !errors.As(err, &sqliteErr) {
		return false
	}
	code := sqliteErr.Code() & 0xff
	return code == 5 || code == 6
}

type MigrationMapping struct {
	LegacyStorageID  string `json:"legacyStorageId"`
	CanonicalPointID string `json:"canonicalPointId"`
	Generation       uint64 `json:"generation"`
}

type MigrationManifest struct {
	MigrationID          string             `json:"migrationId"`
	SourceIdentity       string             `json:"sourceIdentity"`
	SourceSHA256         string             `json:"sourceSha256"`
	NamespaceRevision    uint64             `json:"namespaceRevision"`
	PolicyRevision       uint64             `json:"policyRevision"`
	SchemaID             string             `json:"schemaId"`
	TimestampRuleVersion int                `json:"timestampRuleVersion"`
	AliasRuleVersion     int                `json:"aliasRuleVersion"`
	SourceRowCount       uint64             `json:"sourceRowCount"`
	Mappings             []MigrationMapping `json:"mappings"`
}

type LegacySampleRow struct {
	TS      int64
	PointID string
	Value   float64
	Quality int
}

type LegacyMigrationResult struct {
	Hot      []HotSample
	Rejected []LegacySampleRow
	Gaps     []HistoryGap
}

const legacyMigrationSourceV1 = "legacy-trend-v1"

func normalizeLegacyTimestamp(timestamp int64) (int64, bool) {
	if timestamp <= 0 {
		return 0, false
	}
	if timestamp < 1_000_000_000_000 {
		if timestamp > math.MaxInt64/1000 {
			return 0, false
		}
		return timestamp * 1000, true
	}
	return timestamp, true
}

func MigrateLegacyRows(manifest MigrationManifest, rows []LegacySampleRow, policyRevision uint64) (LegacyMigrationResult, error) {
	if policyRevision == 0 {
		return LegacyMigrationResult{}, fmt.Errorf("policy revision is required")
	}
	if manifest.TimestampRuleVersion != 1 || manifest.AliasRuleVersion != 1 {
		return LegacyMigrationResult{}, fmt.Errorf("unsupported migration rule version")
	}
	mappings := make(map[string]MigrationMapping, len(manifest.Mappings))
	for _, mapping := range manifest.Mappings {
		if mapping.LegacyStorageID == "" || mapping.CanonicalPointID == "" || mapping.Generation == 0 || mappings[mapping.LegacyStorageID].LegacyStorageID != "" {
			return LegacyMigrationResult{}, fmt.Errorf("invalid migration mapping")
		}
		mappings[mapping.LegacyStorageID] = mapping
	}
	type candidate struct {
		row       LegacySampleRow
		timestamp int64
		mapping   MigrationMapping
	}
	chosen := map[string]candidate{}
	result := LegacyMigrationResult{}
	for _, row := range rows {
		timestamp, ok := normalizeLegacyTimestamp(row.TS)
		mapping, mapped := mappings[row.PointID]
		if !ok || !mapped || !finite(row.Value) || row.Quality < 0 || row.Quality > 2 {
			result.Rejected = append(result.Rejected, row)
			continue
		}
		item := candidate{row: row, timestamp: timestamp, mapping: mapping}
		key := fmt.Sprintf("%s\x00%d\x00%d", mapping.CanonicalPointID, mapping.Generation, timestamp)
		if previous, exists := chosen[key]; exists {
			if previous.row.Value == row.Value && previous.row.Quality == row.Quality {
				continue
			}
			if legacyCandidateWins(item, previous) {
				result.Rejected = append(result.Rejected, previous.row)
				result.Gaps = append(result.Gaps, migrationCollisionGap(previous, policyRevision))
				chosen[key] = item
			} else {
				result.Rejected = append(result.Rejected, row)
				result.Gaps = append(result.Gaps, migrationCollisionGap(item, policyRevision))
			}
			continue
		}
		chosen[key] = item
	}
	candidates := make([]candidate, 0, len(chosen))
	for _, item := range chosen {
		candidates = append(candidates, item)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].mapping.CanonicalPointID != candidates[j].mapping.CanonicalPointID {
			return candidates[i].mapping.CanonicalPointID < candidates[j].mapping.CanonicalPointID
		}
		if candidates[i].mapping.Generation != candidates[j].mapping.Generation {
			return candidates[i].mapping.Generation < candidates[j].mapping.Generation
		}
		return candidates[i].timestamp < candidates[j].timestamp
	})
	for _, item := range candidates {
		bucket := item.timestamp - item.timestamp%15_000
		last := len(result.Hot) - 1
		if last < 0 || result.Hot[last].PointID != item.mapping.CanonicalPointID || result.Hot[last].Generation != item.mapping.Generation || result.Hot[last].BucketUTCMS != bucket {
			value := positiveZero(item.row.Value)
			result.Hot = append(result.Hot, HotSample{PointID: item.mapping.CanonicalPointID, Generation: item.mapping.Generation, BucketUTCMS: bucket, LastSampleUTCMS: item.timestamp, Value: value, Min: value, Max: value, Sum: value, Count: 1, WorstQuality: item.row.Quality, Source: legacyMigrationSourceV1, PolicyRevision: policyRevision})
			continue
		}
		hot := &result.Hot[last]
		hot.LastSampleUTCMS = item.timestamp
		hot.Value = item.row.Value
		hot.Min = math.Min(hot.Min, item.row.Value)
		hot.Max = math.Max(hot.Max, item.row.Value)
		hot.Sum += item.row.Value
		if !finite(hot.Sum) {
			return LegacyMigrationResult{}, fmt.Errorf("legacy aggregate sum overflow")
		}
		hot.Sum = positiveZero(hot.Sum)
		hot.Count++
		if item.row.Quality > hot.WorstQuality {
			hot.WorstQuality = item.row.Quality
		}
	}
	sort.Slice(result.Rejected, func(i, j int) bool {
		if result.Rejected[i].TS != result.Rejected[j].TS {
			return result.Rejected[i].TS < result.Rejected[j].TS
		}
		if result.Rejected[i].PointID != result.Rejected[j].PointID {
			return result.Rejected[i].PointID < result.Rejected[j].PointID
		}
		if result.Rejected[i].Quality != result.Rejected[j].Quality {
			return result.Rejected[i].Quality < result.Rejected[j].Quality
		}
		return math.Float64bits(result.Rejected[i].Value) < math.Float64bits(result.Rejected[j].Value)
	})
	sort.Slice(result.Gaps, func(i, j int) bool {
		if result.Gaps[i].PointID != result.Gaps[j].PointID {
			return result.Gaps[i].PointID < result.Gaps[j].PointID
		}
		if result.Gaps[i].Generation != result.Gaps[j].Generation {
			return result.Gaps[i].Generation < result.Gaps[j].Generation
		}
		if result.Gaps[i].FromUTCMS != result.Gaps[j].FromUTCMS {
			return result.Gaps[i].FromUTCMS < result.Gaps[j].FromUTCMS
		}
		return result.Gaps[i].Detail < result.Gaps[j].Detail
	})
	return result, nil
}

func migrationCollisionGap(item struct {
	row       LegacySampleRow
	timestamp int64
	mapping   MigrationMapping
}, policyRevision uint64) HistoryGap {
	revision := policyRevision
	return HistoryGap{PointID: item.mapping.CanonicalPointID, Generation: item.mapping.Generation, FromUTCMS: item.timestamp, ToUTCMS: item.timestamp + 1000, Reason: "migration", Detail: "legacy alias collision: " + item.row.PointID, PolicyRevision: &revision, CreatedAtUTCMS: item.timestamp}
}

func (s *HistorianStore) ApplyLegacyMigrationChunk(ctx context.Context, manifest MigrationManifest, rows []LegacySampleRow, chunk int, final bool) error {
	if s == nil || s.db == nil || chunk < 1 || manifest.PolicyRevision == 0 {
		return fmt.Errorf("invalid migration chunk")
	}
	if err := validateMigrationManifest(manifest); err != nil {
		return err
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	manifestDigest := sha256.Sum256(manifestJSON)
	sourceDigest, _ := hex.DecodeString(manifest.SourceSHA256)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var phase string
	var durableManifest []byte
	err = tx.QueryRowContext(ctx, `SELECT phase,manifest_sha256 FROM migration_runs WHERE migration_id=?`, manifest.MigrationID).Scan(&phase, &durableManifest)
	if err == sql.ErrNoRows {
		now := time.Now().UTC().UnixMilli()
		cursor, _ := json.Marshal(map[string]int{"chunk": chunk})
		if _, err := tx.ExecContext(ctx, `INSERT INTO migration_runs(migration_id,source_identity,source_sha256,namespace_revision,manifest_json,manifest_sha256,phase,cursor_json,created_at_utc_ms,updated_at_utc_ms) VALUES(?,?,?,?,?,?,'copying',?,?,?)`, manifest.MigrationID, manifest.SourceIdentity, sourceDigest, manifest.NamespaceRevision, manifestJSON, manifestDigest[:], cursor, now, now); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		if !bytes.Equal(durableManifest, manifestDigest[:]) {
			return fmt.Errorf("migration manifest conflict")
		}
		if phase == "verified" {
			return tx.Commit()
		}
	}
	for _, row := range rows {
		data, err := json.Marshal(row)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(data)
		if _, err := tx.ExecContext(ctx, `INSERT INTO migration_staging(migration_id,row_sha256,legacy_ts,legacy_point_id,value,quality) VALUES(?,?,?,?,?,?) ON CONFLICT(migration_id,row_sha256) DO NOTHING`, manifest.MigrationID, digest[:], row.TS, row.PointID, row.Value, row.Quality); err != nil {
			return err
		}
	}
	cursor, _ := json.Marshal(map[string]int{"chunk": chunk})
	if _, err := tx.ExecContext(ctx, `UPDATE migration_runs SET cursor_json=?,updated_at_utc_ms=? WHERE migration_id=?`, cursor, time.Now().UTC().UnixMilli(), manifest.MigrationID); err != nil {
		return err
	}
	if !final {
		return tx.Commit()
	}
	var stagedCount uint64
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM migration_staging WHERE migration_id=?`, manifest.MigrationID).Scan(&stagedCount); err != nil {
		return err
	}
	if stagedCount != manifest.SourceRowCount {
		return fmt.Errorf("migration source coverage mismatch: staged=%d expected=%d", stagedCount, manifest.SourceRowCount)
	}
	staged, err := tx.QueryContext(ctx, `SELECT legacy_ts,legacy_point_id,value,quality FROM migration_staging WHERE migration_id=? ORDER BY legacy_ts,legacy_point_id,row_sha256`, manifest.MigrationID)
	if err != nil {
		return err
	}
	var all []LegacySampleRow
	for staged.Next() {
		var row LegacySampleRow
		if err := staged.Scan(&row.TS, &row.PointID, &row.Value, &row.Quality); err != nil {
			staged.Close()
			return err
		}
		all = append(all, row)
	}
	if err := staged.Close(); err != nil {
		return err
	}
	result, err := MigrateLegacyRows(manifest, all, manifest.PolicyRevision)
	if err != nil {
		return err
	}
	for _, hot := range result.Hot {
		insert, err := tx.ExecContext(ctx, `INSERT INTO hot_samples(point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(point_id,generation,bucket_utc_ms) DO NOTHING`, hot.PointID, hot.Generation, hot.BucketUTCMS, hot.LastSampleUTCMS, hot.Value, hot.Min, hot.Max, hot.Sum, hot.Count, hot.WorstQuality, hot.Source, hot.PolicyRevision)
		if err != nil {
			return err
		}
		inserted, err := insert.RowsAffected()
		if err != nil {
			return err
		}
		if inserted == 0 {
			var existing HotSample
			if err := tx.QueryRowContext(ctx, `SELECT point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision FROM hot_samples WHERE point_id=? AND generation=? AND bucket_utc_ms=?`, hot.PointID, hot.Generation, hot.BucketUTCMS).Scan(&existing.PointID, &existing.Generation, &existing.BucketUTCMS, &existing.LastSampleUTCMS, &existing.Value, &existing.Min, &existing.Max, &existing.Sum, &existing.Count, &existing.WorstQuality, &existing.Source, &existing.PolicyRevision); err != nil {
				return err
			}
			if existing != hot {
				return fmt.Errorf("migration hot row conflict")
			}
		}
	}
	for _, rejected := range result.Rejected {
		data, _ := json.Marshal(rejected)
		digest := sha256.Sum256(data)
		if _, err := tx.ExecContext(ctx, `INSERT INTO migration_rejections(migration_id,legacy_point_id,legacy_ts,reason,row_json,row_sha256) VALUES(?,?,?,'collision-or-invalid',?,?) ON CONFLICT DO NOTHING`, manifest.MigrationID, rejected.PointID, rejected.TS, data, digest[:]); err != nil {
			return err
		}
	}
	for _, gap := range result.Gaps {
		if _, err := tx.ExecContext(ctx, `INSERT INTO history_gaps(point_id,generation,from_utc_ms,to_utc_ms,reason,detail,policy_revision,created_at_utc_ms) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(point_id,generation,from_utc_ms,to_utc_ms,reason,detail) DO NOTHING`, gap.PointID, gap.Generation, gap.FromUTCMS, gap.ToUTCMS, gap.Reason, gap.Detail, *gap.PolicyRevision, gap.CreatedAtUTCMS); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM migration_staging WHERE migration_id=?`, manifest.MigrationID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE migration_runs SET phase='verified',updated_at_utc_ms=? WHERE migration_id=?`, time.Now().UTC().UnixMilli(), manifest.MigrationID); err != nil {
		return err
	}
	return tx.Commit()
}

func legacyCandidateWins(candidate, current struct {
	row       LegacySampleRow
	timestamp int64
	mapping   MigrationMapping
}) bool {
	candidateCanonical := candidate.row.PointID == candidate.mapping.CanonicalPointID
	currentCanonical := current.row.PointID == current.mapping.CanonicalPointID
	if candidateCanonical != currentCanonical {
		return candidateCanonical
	}
	return candidate.row.PointID < current.row.PointID
}

type migrationManifestEnvelope struct {
	Manifest json.RawMessage `json:"manifest"`
	SHA256   string          `json:"sha256"`
}

func WriteMigrationManifest(path string, manifest MigrationManifest) error {
	if manifest.TimestampRuleVersion == 0 {
		manifest.TimestampRuleVersion = 1
	}
	if manifest.AliasRuleVersion == 0 {
		manifest.AliasRuleVersion = 1
	}
	if err := validateMigrationManifest(manifest); err != nil {
		return err
	}
	manifest.Mappings = append([]MigrationMapping(nil), manifest.Mappings...)
	sort.Slice(manifest.Mappings, func(i, j int) bool {
		return manifest.Mappings[i].LegacyStorageID < manifest.Mappings[j].LegacyStorageID
	})
	payload, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(payload)
	envelope, err := json.MarshalIndent(migrationManifestEnvelope{Manifest: payload, SHA256: hex.EncodeToString(digest[:])}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data := append(envelope, '\n')
	if existing, err := os.ReadFile(path); err == nil {
		if bytes.Equal(existing, data) {
			return nil
		}
		return fmt.Errorf("migration manifest already exists with different content")
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := writeExclusiveFile(path, data, 0o600); err != nil {
		if existing, readErr := os.ReadFile(path); readErr == nil && bytes.Equal(existing, data) {
			return nil
		}
		return err
	}
	return nil
}

func ReadMigrationManifest(path string) (MigrationManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return MigrationManifest{}, err
	}
	var envelope migrationManifestEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return MigrationManifest{}, err
	}
	var manifest MigrationManifest
	if err := json.Unmarshal(envelope.Manifest, &manifest); err != nil {
		return MigrationManifest{}, err
	}
	canonical, err := json.Marshal(manifest)
	if err != nil {
		return MigrationManifest{}, err
	}
	digest := sha256.Sum256(canonical)
	if hex.EncodeToString(digest[:]) != envelope.SHA256 {
		return MigrationManifest{}, fmt.Errorf("migration manifest checksum mismatch")
	}
	if err := validateMigrationManifest(manifest); err != nil {
		return MigrationManifest{}, err
	}
	return manifest, nil
}

func ReadMigrationManifestForResume(path, sourceSHA256, schemaID string) (MigrationManifest, error) {
	manifest, err := ReadMigrationManifest(path)
	if err != nil {
		return MigrationManifest{}, err
	}
	if manifest.SourceSHA256 != sourceSHA256 || manifest.SchemaID != schemaID {
		return MigrationManifest{}, fmt.Errorf("migration manifest resume conflict")
	}
	return manifest, nil
}

func validateMigrationManifest(manifest MigrationManifest) error {
	if manifest.MigrationID == "" || manifest.SourceIdentity == "" || manifest.SchemaID == "" || manifest.TimestampRuleVersion <= 0 || manifest.AliasRuleVersion <= 0 {
		return fmt.Errorf("invalid migration manifest")
	}
	digest, err := hex.DecodeString(manifest.SourceSHA256)
	if err != nil || len(digest) != sha256.Size || manifest.SourceSHA256 != strings.ToLower(manifest.SourceSHA256) {
		return fmt.Errorf("invalid migration source checksum")
	}
	seen := make(map[string]bool, len(manifest.Mappings))
	for _, mapping := range manifest.Mappings {
		if mapping.LegacyStorageID == "" || mapping.CanonicalPointID == "" || mapping.Generation == 0 || seen[mapping.LegacyStorageID] {
			return fmt.Errorf("invalid migration mapping")
		}
		seen[mapping.LegacyStorageID] = true
	}
	return nil
}

func writeExclusiveFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".manifest-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(perm); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Link(tempPath, path); err != nil {
		return err
	}
	if err := os.Remove(tempPath); err != nil {
		return err
	}
	return syncDirectory(dir)
}
