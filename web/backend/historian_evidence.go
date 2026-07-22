package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"math"
	"net/url"
	"os"
	"path/filepath"
)

// HistorianCutoverEvidence is the durable proof required before v2 authority
// can be activated. The backup and migration hashes are immutable audit data.
type HistorianCutoverEvidence struct {
	MigrationID          string
	PolicyRevision       uint64
	PolicySHA256         []byte
	ManifestSHA256       []byte
	BackupPath           string
	BackupSourceIdentity string
	BackupSHA256         []byte
	BackupSchemaSHA256   []byte
	BackupByteSize       int64
	BackupQuickCheck     string
	SourceRowCount       uint64
	AcceptedRowCount     uint64
	RejectedRowCount     uint64
	SourceKeyspaceSHA256 []byte
	OutcomeSHA256        []byte
	QuiesceEpoch         uint64
	QuiesceTokenSHA256   []byte
	VerifiedAtUTCMS      int64
}

// RecordHistorianCutoverEvidence independently verifies the published native
// backup and the complete migration result, then persists one immutable proof.
// Caller booleans are deliberately not accepted as evidence.
func (s *HistorianStore) RecordHistorianCutoverEvidence(ctx context.Context, migrationID string, backup SQLiteBackupEvidence, verifiedAtUTCMS int64) error {
	return s.recordHistorianCutoverEvidence(ctx, migrationID, backup, LegacyQuiesceProof{}, verifiedAtUTCMS)
}

func (s *HistorianStore) RecordHistorianCutoverEvidenceWithQuiesce(ctx context.Context, migrationID string, backup SQLiteBackupEvidence, proof LegacyQuiesceProof, verifiedAtUTCMS int64) error {
	return s.recordHistorianCutoverEvidence(ctx, migrationID, backup, proof, verifiedAtUTCMS)
}

func (s *HistorianStore) recordHistorianCutoverEvidence(ctx context.Context, migrationID string, backup SQLiteBackupEvidence, proof LegacyQuiesceProof, verifiedAtUTCMS int64) error {
	if s == nil || s.db == nil || migrationID == "" || backup.Path == "" || backup.SourceIdentity == "" || verifiedAtUTCMS <= 0 {
		return fmt.Errorf("invalid historian cutover evidence request")
	}
	absBackup, err := filepath.Abs(backup.Path)
	if err != nil {
		return fmt.Errorf("resolve historian backup path: %w", err)
	}
	info, err := os.Stat(absBackup)
	if err != nil {
		return fmt.Errorf("stat historian backup: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("historian backup is not a regular file")
	}
	verified, err := verifySQLiteBackup(ctx, absBackup)
	if err != nil {
		return fmt.Errorf("verify historian cutover backup: %w", err)
	}
	if verified.SHA256 != backup.SHA256 || verified.SchemaSHA256 != backup.SchemaSHA256 || verified.ByteSize != backup.ByteSize || verified.QuickCheck != "ok" || backup.QuickCheck != "ok" {
		return fmt.Errorf("historian cutover backup evidence mismatch")
	}
	rows, sourceDigest, err := readLegacyBackupRows(ctx, absBackup)
	if err != nil {
		return err
	}
	var phase, sourceIdentity string
	var manifestJSON, durableManifestDigest []byte
	err = s.db.QueryRowContext(ctx, `SELECT phase,source_identity,manifest_json,manifest_sha256 FROM migration_runs WHERE migration_id=?`, migrationID).Scan(&phase, &sourceIdentity, &manifestJSON, &durableManifestDigest)
	if err != nil {
		return fmt.Errorf("read migration evidence: %w", err)
	}
	if phase != "verified" || sourceIdentity != backup.SourceIdentity {
		return fmt.Errorf("migration is not durably verified")
	}
	var manifest MigrationManifest
	if err := json.Unmarshal(manifestJSON, &manifest); err != nil {
		return fmt.Errorf("parse durable migration manifest: %w", err)
	}
	canonicalManifest, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	manifestDigest := sha256.Sum256(canonicalManifest)
	if !equalBytes(durableManifestDigest, manifestDigest[:]) || manifest.MigrationID != migrationID || manifest.SourceIdentity != backup.SourceIdentity || manifest.SourceSHA256 != backup.SHA256 || manifest.SourceRowCount != uint64(len(rows)) {
		return fmt.Errorf("migration manifest does not cover the verified backup")
	}
	policyDigest, err := s.verifiedPolicyDigest(ctx, manifest.PolicyRevision)
	if err != nil {
		return err
	}
	result, err := MigrateLegacyRows(manifest, rows, manifest.PolicyRevision)
	if err != nil {
		return fmt.Errorf("recompute migration outcome: %w", err)
	}
	if err := s.verifyMigrationOutcome(ctx, migrationID, manifest.PolicyRevision, result); err != nil {
		return err
	}
	outcomeDigest := sha256.Sum256(mustJSON(result))
	quiesceDigest := append([]byte(nil), proof.TokenSHA256...)
	if len(quiesceDigest) == 0 {
		quiesceDigest = make([]byte, sha256.Size)
	}
	evidence := HistorianCutoverEvidence{
		MigrationID: migrationID, PolicyRevision: manifest.PolicyRevision, PolicySHA256: policyDigest,
		ManifestSHA256: manifestDigest[:], BackupPath: absBackup, BackupSourceIdentity: backup.SourceIdentity,
		BackupSHA256: mustHexBytes(backup.SHA256), BackupSchemaSHA256: mustHexBytes(backup.SchemaSHA256),
		BackupByteSize: backup.ByteSize, BackupQuickCheck: backup.QuickCheck,
		SourceRowCount: uint64(len(rows)), AcceptedRowCount: uint64(len(rows) - len(result.Rejected)), RejectedRowCount: uint64(len(result.Rejected)),
		SourceKeyspaceSHA256: sourceDigest, OutcomeSHA256: outcomeDigest[:], QuiesceEpoch: proof.Epoch,
		QuiesceTokenSHA256: quiesceDigest, VerifiedAtUTCMS: verifiedAtUTCMS,
	}
	return s.persistHistorianCutoverEvidence(ctx, evidence, proof)
}

func (s *HistorianStore) verifiedPolicyDigest(ctx context.Context, revision uint64) ([]byte, error) {
	var digest []byte
	var status string
	if err := s.db.QueryRowContext(ctx, `SELECT config_sha256,mirror_status FROM policy_revisions WHERE revision=?`, revision).Scan(&digest, &status); err != nil {
		return nil, fmt.Errorf("read migration policy revision: %w", err)
	}
	if status != "verified" || len(digest) != sha256.Size {
		return nil, fmt.Errorf("migration policy revision is not verified")
	}
	return append([]byte(nil), digest...), nil
}

func (s *HistorianStore) verifyMigrationOutcome(ctx context.Context, migrationID string, policyRevision uint64, result LegacyMigrationResult) error {
	var rejected int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM migration_rejections WHERE migration_id=?`, migrationID).Scan(&rejected); err != nil {
		return fmt.Errorf("read migration rejections: %w", err)
	}
	if rejected != len(result.Rejected) {
		return fmt.Errorf("migration rejection coverage mismatch: got=%d want=%d", rejected, len(result.Rejected))
	}
	var hotCount int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM hot_samples WHERE policy_revision=? AND source=?`, policyRevision, legacyMigrationSourceV1).Scan(&hotCount); err != nil {
		return fmt.Errorf("read migration hot coverage: %w", err)
	}
	if hotCount != len(result.Hot) {
		return fmt.Errorf("migration hot coverage count mismatch: got=%d want=%d", hotCount, len(result.Hot))
	}
	for _, hot := range result.Hot {
		var existing HotSample
		if err := s.db.QueryRowContext(ctx, `SELECT point_id,generation,bucket_utc_ms,last_sample_utc_ms,value,min_value,max_value,sum_value,sample_count,worst_quality,source,policy_revision FROM hot_samples WHERE point_id=? AND generation=? AND bucket_utc_ms=? AND policy_revision=?`, hot.PointID, hot.Generation, hot.BucketUTCMS, policyRevision).Scan(&existing.PointID, &existing.Generation, &existing.BucketUTCMS, &existing.LastSampleUTCMS, &existing.Value, &existing.Min, &existing.Max, &existing.Sum, &existing.Count, &existing.WorstQuality, &existing.Source, &existing.PolicyRevision); err != nil {
			return fmt.Errorf("migration hot coverage missing: %w", err)
		}
		if existing != hot {
			return fmt.Errorf("migration hot coverage mismatch")
		}
	}
	var gapCount int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM history_gaps WHERE policy_revision=? AND reason='migration'`, policyRevision).Scan(&gapCount); err != nil {
		return fmt.Errorf("read migration gap coverage: %w", err)
	}
	if gapCount != len(result.Gaps) {
		return fmt.Errorf("migration gap coverage mismatch: got=%d want=%d", gapCount, len(result.Gaps))
	}
	return nil
}

func (s *HistorianStore) persistHistorianCutoverEvidence(ctx context.Context, evidence HistorianCutoverEvidence, proof LegacyQuiesceProof) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin historian cutover evidence: %w", err)
	}
	defer tx.Rollback()
	if proof.Epoch > 0 {
		if err := validateLegacyQuiesceTx(ctx, tx, evidence.MigrationID, proof); err != nil {
			return err
		}
	}
	var phase string
	var manifestDigest []byte
	if err := tx.QueryRowContext(ctx, `SELECT phase,manifest_sha256 FROM migration_runs WHERE migration_id=?`, evidence.MigrationID).Scan(&phase, &manifestDigest); err != nil {
		return fmt.Errorf("recheck migration cutover evidence: %w", err)
	}
	if phase != "verified" || !equalBytes(manifestDigest, evidence.ManifestSHA256) {
		return fmt.Errorf("migration evidence changed before commit")
	}
	var existing HistorianCutoverEvidence
	err = tx.QueryRowContext(ctx, `SELECT migration_id,policy_revision,policy_sha256,manifest_sha256,backup_path,backup_source_identity,backup_sha256,backup_schema_sha256,backup_byte_size,backup_quick_check,source_row_count,accepted_row_count,rejected_row_count,source_keyspace_sha256,outcome_sha256,quiesce_epoch,quiesce_token_sha256,verified_at_utc_ms FROM historian_cutover_evidence WHERE singleton=1`).Scan(&existing.MigrationID, &existing.PolicyRevision, &existing.PolicySHA256, &existing.ManifestSHA256, &existing.BackupPath, &existing.BackupSourceIdentity, &existing.BackupSHA256, &existing.BackupSchemaSHA256, &existing.BackupByteSize, &existing.BackupQuickCheck, &existing.SourceRowCount, &existing.AcceptedRowCount, &existing.RejectedRowCount, &existing.SourceKeyspaceSHA256, &existing.OutcomeSHA256, &existing.QuiesceEpoch, &existing.QuiesceTokenSHA256, &existing.VerifiedAtUTCMS)
	if err == nil {
		if !sameHistorianCutoverEvidence(existing, evidence) {
			return fmt.Errorf("historian cutover evidence is immutable")
		}
		return tx.Commit()
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("read existing historian cutover evidence: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO historian_cutover_evidence(singleton,migration_id,policy_revision,policy_sha256,manifest_sha256,backup_path,backup_source_identity,backup_sha256,backup_schema_sha256,backup_byte_size,backup_quick_check,source_row_count,accepted_row_count,rejected_row_count,source_keyspace_sha256,outcome_sha256,quiesce_epoch,quiesce_token_sha256,verified_at_utc_ms) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, evidence.MigrationID, evidence.PolicyRevision, evidence.PolicySHA256, evidence.ManifestSHA256, evidence.BackupPath, evidence.BackupSourceIdentity, evidence.BackupSHA256, evidence.BackupSchemaSHA256, evidence.BackupByteSize, evidence.BackupQuickCheck, evidence.SourceRowCount, evidence.AcceptedRowCount, evidence.RejectedRowCount, evidence.SourceKeyspaceSHA256, evidence.OutcomeSHA256, evidence.QuiesceEpoch, evidence.QuiesceTokenSHA256, evidence.VerifiedAtUTCMS)
	if err != nil {
		return fmt.Errorf("persist historian cutover evidence: %w", err)
	}
	if proof.Epoch > 0 {
		result, err := tx.ExecContext(ctx, `UPDATE historian_legacy_quiesce SET state='consumed',migration_id=?,updated_at_utc_ms=? WHERE singleton=1 AND epoch=? AND token_sha256=? AND state='quiesced'`, evidence.MigrationID, evidence.VerifiedAtUTCMS, proof.Epoch, proof.TokenSHA256)
		if err != nil {
			return fmt.Errorf("consume legacy quiesce proof: %w", err)
		}
		changed, _ := result.RowsAffected()
		if changed != 1 {
			return ErrHistorianQuiesceConflict
		}
	}
	return tx.Commit()
}

func sameHistorianCutoverEvidence(a, b HistorianCutoverEvidence) bool {
	return a.MigrationID == b.MigrationID && a.PolicyRevision == b.PolicyRevision && equalBytes(a.PolicySHA256, b.PolicySHA256) && equalBytes(a.ManifestSHA256, b.ManifestSHA256) && a.BackupPath == b.BackupPath && a.BackupSourceIdentity == b.BackupSourceIdentity && equalBytes(a.BackupSHA256, b.BackupSHA256) && equalBytes(a.BackupSchemaSHA256, b.BackupSchemaSHA256) && a.BackupByteSize == b.BackupByteSize && a.BackupQuickCheck == b.BackupQuickCheck && a.SourceRowCount == b.SourceRowCount && a.AcceptedRowCount == b.AcceptedRowCount && a.RejectedRowCount == b.RejectedRowCount && equalBytes(a.SourceKeyspaceSHA256, b.SourceKeyspaceSHA256) && equalBytes(a.OutcomeSHA256, b.OutcomeSHA256) && a.QuiesceEpoch == b.QuiesceEpoch && equalBytes(a.QuiesceTokenSHA256, b.QuiesceTokenSHA256)
}

func (s *HistorianStore) HistorianCutoverEvidence(ctx context.Context) (HistorianCutoverEvidence, error) {
	var evidence HistorianCutoverEvidence
	if s == nil || s.db == nil {
		return evidence, fmt.Errorf("historian store unavailable")
	}
	err := s.db.QueryRowContext(ctx, `SELECT migration_id,policy_revision,policy_sha256,manifest_sha256,backup_path,backup_source_identity,backup_sha256,backup_schema_sha256,backup_byte_size,backup_quick_check,source_row_count,accepted_row_count,rejected_row_count,source_keyspace_sha256,outcome_sha256,quiesce_epoch,quiesce_token_sha256,verified_at_utc_ms FROM historian_cutover_evidence WHERE singleton=1`).Scan(&evidence.MigrationID, &evidence.PolicyRevision, &evidence.PolicySHA256, &evidence.ManifestSHA256, &evidence.BackupPath, &evidence.BackupSourceIdentity, &evidence.BackupSHA256, &evidence.BackupSchemaSHA256, &evidence.BackupByteSize, &evidence.BackupQuickCheck, &evidence.SourceRowCount, &evidence.AcceptedRowCount, &evidence.RejectedRowCount, &evidence.SourceKeyspaceSHA256, &evidence.OutcomeSHA256, &evidence.QuiesceEpoch, &evidence.QuiesceTokenSHA256, &evidence.VerifiedAtUTCMS)
	if err != nil {
		return evidence, fmt.Errorf("read historian cutover evidence: %w", err)
	}
	return evidence, nil
}

func readLegacyBackupRows(ctx context.Context, path string) ([]LegacySampleRow, []byte, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, nil, err
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(absPath), RawQuery: url.Values{"mode": {"ro"}, "_pragma": {"trusted_schema(0)"}}.Encode()}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, nil, fmt.Errorf("open legacy backup: %w", err)
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `SELECT ts,point_id,value,quality FROM samples ORDER BY point_id,ts,quality,value`)
	if err != nil {
		return nil, nil, fmt.Errorf("read legacy backup keyspace: %w", err)
	}
	defer rows.Close()
	h := sha256.New()
	var result []LegacySampleRow
	for rows.Next() {
		var row LegacySampleRow
		if err := rows.Scan(&row.TS, &row.PointID, &row.Value, &row.Quality); err != nil {
			return nil, nil, err
		}
		if err := hashLegacyRow(h, row); err != nil {
			return nil, nil, err
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return result, h.Sum(nil), nil
}

func hashLegacyRow(h hash.Hash, row LegacySampleRow) error {
	var fixed [24]byte
	binary.BigEndian.PutUint64(fixed[0:8], uint64(row.TS))
	binary.BigEndian.PutUint64(fixed[8:16], math.Float64bits(row.Value))
	binary.BigEndian.PutUint64(fixed[16:24], uint64(int64(row.Quality)))
	if _, err := h.Write(fixed[:]); err != nil {
		return err
	}
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(row.PointID)))
	if _, err := h.Write(length[:]); err != nil {
		return err
	}
	_, err := h.Write([]byte(row.PointID))
	return err
}

func mustJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}

func mustHexBytes(value string) []byte {
	decoded, err := hex.DecodeString(value)
	if err != nil {
		return nil
	}
	return decoded
}

func (s *HistorianStore) historianCutoverEvidenceValid(ctx context.Context, revision uint64, digest []byte) error {
	var storedRevision uint64
	var quiesceEpoch uint64
	var migrationID, consumedMigrationID string
	var policyDigest, manifestDigest, runManifestDigest, runSourceDigest, backupDigest, sourceDigest, outcomeDigest, mirroredPolicyDigest, quiesceDigest, storedQuiesceDigest []byte
	var backupSize, sourceRows, acceptedRows, rejectedRows int64
	var quick, migrationPhase, mirrorStatus, quiesceState string
	if err := s.db.QueryRowContext(ctx, `SELECT e.policy_revision,e.policy_sha256,e.manifest_sha256,m.manifest_sha256,m.source_sha256,e.backup_sha256,e.backup_quick_check,e.backup_byte_size,e.source_row_count,e.accepted_row_count,e.rejected_row_count,e.source_keyspace_sha256,e.outcome_sha256,m.phase,p.config_sha256,p.mirror_status,e.migration_id,e.quiesce_epoch,e.quiesce_token_sha256,q.token_sha256,q.state,q.migration_id FROM historian_cutover_evidence e JOIN migration_runs m ON m.migration_id=e.migration_id JOIN policy_revisions p ON p.revision=e.policy_revision JOIN historian_legacy_quiesce q ON q.epoch=e.quiesce_epoch AND q.token_sha256=e.quiesce_token_sha256 WHERE e.singleton=1`).Scan(&storedRevision, &policyDigest, &manifestDigest, &runManifestDigest, &runSourceDigest, &backupDigest, &quick, &backupSize, &sourceRows, &acceptedRows, &rejectedRows, &sourceDigest, &outcomeDigest, &migrationPhase, &mirroredPolicyDigest, &mirrorStatus, &migrationID, &quiesceEpoch, &quiesceDigest, &storedQuiesceDigest, &quiesceState, &consumedMigrationID); err != nil {
		return fmt.Errorf("read historian cutover evidence: %w", err)
	}
	if storedRevision != revision || !equalBytes(policyDigest, digest) || !equalBytes(mirroredPolicyDigest, digest) || mirrorStatus != "verified" || migrationPhase != "verified" || !equalBytes(manifestDigest, runManifestDigest) || !equalBytes(runSourceDigest, backupDigest) || quiesceEpoch == 0 || !equalBytes(quiesceDigest, storedQuiesceDigest) || quiesceState != "consumed" || consumedMigrationID != migrationID || quick != "ok" || backupSize <= 0 || sourceRows < 0 || acceptedRows < 0 || rejectedRows < 0 || acceptedRows+rejectedRows != sourceRows || len(manifestDigest) != sha256.Size || len(backupDigest) != sha256.Size || len(sourceDigest) != sha256.Size || len(outcomeDigest) != sha256.Size {
		return fmt.Errorf("historian cutover evidence is invalid")
	}
	return nil
}
