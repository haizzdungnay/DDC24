package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	retentionFaultAfterMetadataCommit = "retention_after_metadata_commit"
	retentionFaultAfterFileUnlink     = "retention_after_file_unlink"
	retentionFaultAfterDirectorySync  = "retention_after_directory_sync"
	retentionFaultBeforeQueueCleanup  = "retention_before_queue_cleanup"
	retentionDefaultMaxBlocks         = 64
	retentionDefaultMaxRows           = 1024
	retentionMaxIdentityScan          = 512
)

var ErrHistorianRetentionDeferred = errors.New("historian retention prune deferred until activation")

type HistorianActivationProof struct {
	PolicyRevision    uint64
	ConfigSHA256      []byte
	StableUTCMS       int64
	WriterAuthority   string
	LegacyQuiesced    bool
	MigrationVerified bool
	PruneEnabled      bool
	ReconciledAtUTCMS int64
}

type HistorianRetentionPruneRequest struct {
	ArchiveDir string
	MaxBlocks  int
	MaxRows    int
}

type HistorianRetentionPruneResult struct {
	ArchiveBlocks int64
	ArchiveFiles  int64
	HotSamples    int64
	Gaps          int64
}

type historianRetentionLease struct {
	pointID      string
	generation   uint64
	retentionDay int
}

type historianRetentionBlock struct {
	blockID       string
	pointID       string
	generation    uint64
	fromUTCMS     int64
	toUTCMS       int64
	fileName      string
	byteSize      int64
	payloadSHA256 []byte
}

func (s *HistorianStore) RecordReconciledHistorianActivation(ctx context.Context, proof HistorianActivationProof) error {
	if proof.PolicyRevision == 0 || len(proof.ConfigSHA256) != sha256.Size || proof.StableUTCMS <= 0 || proof.ReconciledAtUTCMS < proof.StableUTCMS || proof.WriterAuthority != "v2" || !proof.LegacyQuiesced {
		return fmt.Errorf("invalid historian activation proof")
	}
	if err := s.historianCutoverEvidenceValid(ctx, proof.PolicyRevision, proof.ConfigSHA256); err != nil {
		return fmt.Errorf("activation requires durable cutover evidence: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin historian activation reconciliation: %w", err)
	}
	defer tx.Rollback()
	var digest []byte
	var status string
	if err := tx.QueryRowContext(ctx, `SELECT config_sha256,mirror_status FROM policy_revisions WHERE revision=?`, proof.PolicyRevision).Scan(&digest, &status); err != nil {
		return fmt.Errorf("read activation policy revision: %w", err)
	}
	if status != "verified" || !equalBytes(digest, proof.ConfigSHA256) {
		return fmt.Errorf("activation policy revision is not verified")
	}
	var previousRevision uint64
	var previousStable int64
	err = tx.QueryRowContext(ctx, `SELECT policy_revision,stable_utc_ms FROM historian_activation WHERE singleton=1`).Scan(&previousRevision, &previousStable)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("read historian activation marker: %w", err)
	}
	if err == nil {
		if proof.PolicyRevision < previousRevision {
			return fmt.Errorf("historian activation revision moved backwards")
		}
		if proof.StableUTCMS < previousStable {
			return fmt.Errorf("historian stable UTC moved backwards")
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO historian_activation(singleton,policy_revision,config_sha256,state,writer_authority,legacy_quiesced,migration_verified,prune_enabled,stable_utc_ms,reconciled_at_utc_ms) VALUES(1,?,?, 'active','v2',1,1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET policy_revision=excluded.policy_revision,config_sha256=excluded.config_sha256,state='active',writer_authority='v2',legacy_quiesced=1,migration_verified=1,prune_enabled=excluded.prune_enabled,stable_utc_ms=excluded.stable_utc_ms,reconciled_at_utc_ms=excluded.reconciled_at_utc_ms`, proof.PolicyRevision, proof.ConfigSHA256, boolToInt(proof.PruneEnabled), proof.StableUTCMS, proof.ReconciledAtUTCMS)
	if err != nil {
		return fmt.Errorf("persist historian activation marker: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit historian activation marker: %w", err)
	}
	return nil
}

func (s *HistorianStore) PruneRetention(ctx context.Context, request HistorianRetentionPruneRequest) (HistorianRetentionPruneResult, error) {
	var result HistorianRetentionPruneResult
	if request.ArchiveDir == "" {
		return result, fmt.Errorf("historian archive directory is required")
	}
	archiveDir, err := filepath.Abs(request.ArchiveDir)
	if err != nil {
		return result, fmt.Errorf("resolve historian archive directory: %w", err)
	}
	if request.MaxBlocks <= 0 {
		request.MaxBlocks = retentionDefaultMaxBlocks
	}
	if request.MaxRows <= 0 {
		request.MaxRows = retentionDefaultMaxRows
	}
	if request.MaxBlocks > archiveMaxRows {
		request.MaxBlocks = archiveMaxRows
	}
	if request.MaxRows > archiveMaxRows {
		request.MaxRows = archiveMaxRows
	}
	s.archiveMu.Lock()
	defer s.archiveMu.Unlock()
	activation, err := s.activeHistorianActivation(ctx)
	if err != nil {
		return result, err
	}
	if activation == nil || activation.WriterAuthority != "v2" || !activation.LegacyQuiesced || !activation.MigrationVerified || !activation.PruneEnabled {
		return result, ErrHistorianRetentionDeferred
	}
	leases, err := s.retentionLeases(ctx, activation.PolicyRevision)
	if err != nil {
		return result, err
	}
	selected := make([]historianRetentionBlock, 0, request.MaxBlocks)
	selectedByIdentity := make(map[string][]historianRetentionBlock)
	for _, lease := range leases {
		if len(selected) >= request.MaxBlocks {
			break
		}
		cutoff, ok := historianRetentionCutoff(activation.StableUTCMS, lease.retentionDay)
		if !ok {
			continue
		}
		blocks, err := s.retentionCandidates(ctx, lease, cutoff, request.MaxBlocks-len(selected))
		if err != nil {
			return result, err
		}
		for _, block := range blocks {
			if err := verifyRetentionArchiveFile(archiveDir, block); err != nil {
				return result, err
			}
			selected = append(selected, block)
			key := retentionIdentityKey(block.pointID, block.generation)
			selectedByIdentity[key] = append(selectedByIdentity[key], block)
		}
	}
	if len(selected) > 0 || len(leases) > 0 {
		if err := s.commitRetentionMetadata(ctx, selectedByIdentity, leases, activation.StableUTCMS, request.MaxRows, &result); err != nil {
			return result, err
		}
		if err := runRetentionFault(s.retentionFault, retentionFaultAfterMetadataCommit); err != nil {
			return result, err
		}
	}
	queued, err := s.loadRetentionQueue(ctx, request.MaxBlocks)
	if err != nil {
		return result, err
	}
	if len(queued) > 0 {
		for _, block := range queued {
			if !safeRetentionArchiveFileName(block.fileName) {
				return result, fmt.Errorf("unsafe retired archive file name")
			}
			path := filepath.Join(archiveDir, block.fileName)
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return result, fmt.Errorf("remove retired archive file %s: %w", block.fileName, err)
			}
			result.ArchiveFiles++
			if err := runRetentionFault(s.retentionFault, retentionFaultAfterFileUnlink); err != nil {
				return result, err
			}
		}
		if err := syncDirectory(archiveDir); err != nil {
			return result, fmt.Errorf("sync retired archive directory: %w", err)
		}
		if err := runRetentionFault(s.retentionFault, retentionFaultAfterDirectorySync); err != nil {
			return result, err
		}
		if err := runRetentionFault(s.retentionFault, retentionFaultBeforeQueueCleanup); err != nil {
			return result, err
		}
		if err := s.deleteRetentionQueue(ctx, queued); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s *HistorianStore) activeHistorianActivation(ctx context.Context) (*HistorianActivationProof, error) {
	var proof HistorianActivationProof
	var state, writer string
	var legacyQuiesced, migrationVerified, pruneEnabled int
	if err := s.db.QueryRowContext(ctx, `SELECT policy_revision,config_sha256,state,writer_authority,legacy_quiesced,migration_verified,prune_enabled,stable_utc_ms,reconciled_at_utc_ms FROM historian_activation WHERE singleton=1`).Scan(&proof.PolicyRevision, &proof.ConfigSHA256, &state, &writer, &legacyQuiesced, &migrationVerified, &pruneEnabled, &proof.StableUTCMS, &proof.ReconciledAtUTCMS); err == sql.ErrNoRows {
		return nil, ErrHistorianRetentionDeferred
	} else if err != nil {
		return nil, fmt.Errorf("read historian activation marker: %w", err)
	}
	proof.WriterAuthority, proof.LegacyQuiesced, proof.MigrationVerified, proof.PruneEnabled = writer, legacyQuiesced == 1, migrationVerified == 1, pruneEnabled == 1
	if state != "active" {
		return nil, ErrHistorianRetentionDeferred
	}
	var digest []byte
	var mirrorStatus string
	if err := s.db.QueryRowContext(ctx, `SELECT config_sha256,mirror_status FROM policy_revisions WHERE revision=?`, proof.PolicyRevision).Scan(&digest, &mirrorStatus); err != nil {
		return nil, fmt.Errorf("read active historian policy revision: %w", err)
	}
	if mirrorStatus != "verified" || !equalBytes(digest, proof.ConfigSHA256) || proof.StableUTCMS <= 0 {
		return nil, ErrHistorianRetentionDeferred
	}
	if err := s.historianCutoverEvidenceValid(ctx, proof.PolicyRevision, proof.ConfigSHA256); err != nil {
		return nil, ErrHistorianRetentionDeferred
	}
	return &proof, nil
}

func (s *HistorianStore) retentionLeases(ctx context.Context, revision uint64) ([]historianRetentionLease, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT p.point_id,p.generation,p.retention_days FROM point_policies p WHERE p.revision=(SELECT max(p2.revision) FROM point_policies p2 WHERE p2.point_id=p.point_id AND p2.generation=p.generation AND p2.revision<=?) ORDER BY p.point_id,p.generation LIMIT ?`, revision, retentionMaxIdentityScan)
	if err != nil {
		return nil, fmt.Errorf("read historian retention leases: %w", err)
	}
	defer rows.Close()
	leases := make([]historianRetentionLease, 0)
	for rows.Next() {
		var lease historianRetentionLease
		if err := rows.Scan(&lease.pointID, &lease.generation, &lease.retentionDay); err != nil {
			return nil, fmt.Errorf("scan historian retention lease: %w", err)
		}
		if lease.retentionDay > 0 {
			leases = append(leases, lease)
		}
	}
	return leases, rows.Err()
}

func (s *HistorianStore) retentionCandidates(ctx context.Context, lease historianRetentionLease, cutoff int64, limit int) ([]historianRetentionBlock, error) {
	var origin, covered int64
	var watermarkBlockID string
	err := s.db.QueryRowContext(ctx, `SELECT origin_utc_ms,covered_until_utc_ms,block_id FROM archive_watermarks WHERE point_id=? AND generation=?`, lease.pointID, lease.generation).Scan(&origin, &covered, &watermarkBlockID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read retention watermark: %w", err)
	}
	var frontierState string
	if err := s.db.QueryRowContext(ctx, `SELECT state FROM archive_blocks WHERE block_id=? AND point_id=? AND generation=? AND to_utc_ms=?`, watermarkBlockID, lease.pointID, lease.generation, covered).Scan(&frontierState); err != nil || frontierState != "committed" {
		if err == nil {
			err = fmt.Errorf("state=%s", frontierState)
		}
		return nil, fmt.Errorf("retention watermark frontier is not committed: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT block_id,point_id,generation,from_utc_ms,to_utc_ms,file_name,byte_size,payload_sha256 FROM archive_blocks WHERE point_id=? AND generation=? AND state='committed' AND from_utc_ms>=? AND to_utc_ms<=? ORDER BY from_utc_ms LIMIT ?`, lease.pointID, lease.generation, origin, covered, archiveMaxRows)
	if err != nil {
		return nil, fmt.Errorf("read retention archive frontier: %w", err)
	}
	defer rows.Close()
	cursor := origin
	blocks := make([]historianRetentionBlock, 0, limit)
	for rows.Next() {
		var block historianRetentionBlock
		if err := rows.Scan(&block.blockID, &block.pointID, &block.generation, &block.fromUTCMS, &block.toUTCMS, &block.fileName, &block.byteSize, &block.payloadSHA256); err != nil {
			return nil, fmt.Errorf("scan retention archive frontier: %w", err)
		}
		if block.fromUTCMS != cursor {
			return nil, fmt.Errorf("retention archive frontier has a coverage hole")
		}
		cursor = block.toUTCMS
		if block.toUTCMS <= cutoff && len(blocks) < limit {
			blocks = append(blocks, block)
		}
		if cursor >= covered {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read retention archive frontier: %w", err)
	}
	if cursor < covered {
		return nil, fmt.Errorf("retention archive frontier is incomplete")
	}
	return blocks, nil
}

func (s *HistorianStore) commitRetentionMetadata(ctx context.Context, selected map[string][]historianRetentionBlock, leases []historianRetentionLease, stableUTCMS int64, maxRows int, result *HistorianRetentionPruneResult) error {
	if len(selected) == 0 && len(leases) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin historian retention prune: %w", err)
	}
	defer tx.Rollback()
	for _, blocks := range selected {
		if len(blocks) == 0 {
			continue
		}
		first := blocks[0]
		last := blocks[len(blocks)-1]
		for _, block := range blocks {
			if _, err := tx.ExecContext(ctx, `INSERT INTO retention_prune_queue(block_id,point_id,generation,from_utc_ms,to_utc_ms,file_name,byte_size,payload_sha256,queued_at_utc_ms) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(block_id) DO NOTHING`, block.blockID, block.pointID, block.generation, block.fromUTCMS, block.toUTCMS, block.fileName, block.byteSize, block.payloadSHA256, stableUTCMS); err != nil {
				return fmt.Errorf("queue retired archive block: %w", err)
			}
		}
		var currentOrigin, currentCovered int64
		var currentBlockID string
		if err := tx.QueryRowContext(ctx, `SELECT origin_utc_ms,covered_until_utc_ms,block_id FROM archive_watermarks WHERE point_id=? AND generation=?`, first.pointID, first.generation).Scan(&currentOrigin, &currentCovered, &currentBlockID); err != nil {
			return fmt.Errorf("read retention watermark in transaction: %w", err)
		}
		if currentOrigin != first.fromUTCMS {
			return fmt.Errorf("retention prune is not a watermark prefix")
		}
		var nextFrom int64
		var nextBlockID string
		nextErr := tx.QueryRowContext(ctx, `SELECT from_utc_ms,block_id FROM archive_blocks WHERE point_id=? AND generation=? AND state='committed' AND from_utc_ms=?`, first.pointID, first.generation, last.toUTCMS).Scan(&nextFrom, &nextBlockID)
		if nextErr == sql.ErrNoRows {
			if _, err := tx.ExecContext(ctx, `DELETE FROM archive_watermarks WHERE point_id=? AND generation=?`, first.pointID, first.generation); err != nil {
				return fmt.Errorf("remove exhausted retention watermark: %w", err)
			}
		} else if nextErr != nil {
			return fmt.Errorf("read retained archive frontier: %w", nextErr)
		} else {
			if nextFrom != last.toUTCMS {
				return fmt.Errorf("retention prune frontier gap")
			}
			var finalBlock string
			if err := tx.QueryRowContext(ctx, `SELECT block_id FROM archive_blocks WHERE point_id=? AND generation=? AND state='committed' AND to_utc_ms=? ORDER BY from_utc_ms DESC LIMIT 1`, first.pointID, first.generation, currentCovered).Scan(&finalBlock); err != nil {
				return fmt.Errorf("read retained archive frontier tail: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `UPDATE archive_watermarks SET origin_utc_ms=?,block_id=?,updated_at_utc_ms=? WHERE point_id=? AND generation=?`, last.toUTCMS, finalBlock, stableUTCMS, first.pointID, first.generation); err != nil {
				return fmt.Errorf("rebase retention watermark: %w", err)
			}
		}
		for _, block := range blocks {
			if _, err := tx.ExecContext(ctx, `DELETE FROM archive_blocks WHERE block_id=? AND state='committed'`, block.blockID); err != nil {
				return fmt.Errorf("hide retired archive block: %w", err)
			}
			result.ArchiveBlocks++
		}
	}
	remainingRows := maxRows
	for _, lease := range leases {
		if remainingRows <= 0 {
			break
		}
		cutoff, ok := historianRetentionCutoff(stableUTCMS, lease.retentionDay)
		if !ok {
			continue
		}
		if remainingRows > 0 {
			res, err := tx.ExecContext(ctx, `DELETE FROM hot_samples WHERE (point_id,generation,bucket_utc_ms) IN (SELECT point_id,generation,bucket_utc_ms FROM hot_samples WHERE point_id=? AND generation=? AND bucket_utc_ms<? ORDER BY bucket_utc_ms LIMIT ?)`, lease.pointID, lease.generation, cutoff, remainingRows)
			if err != nil {
				return fmt.Errorf("prune expired hot samples: %w", err)
			}
			deleted, _ := res.RowsAffected()
			result.HotSamples += deleted
			remainingRows -= int(deleted)
		}
		if remainingRows > 0 {
			res, err := tx.ExecContext(ctx, `DELETE FROM history_gaps WHERE gap_id IN (SELECT gap_id FROM history_gaps WHERE point_id=? AND generation=? AND to_utc_ms<=? ORDER BY gap_id LIMIT ?)`, lease.pointID, lease.generation, cutoff, remainingRows)
			if err != nil {
				return fmt.Errorf("prune expired history gaps: %w", err)
			}
			deleted, _ := res.RowsAffected()
			result.Gaps += deleted
			remainingRows -= int(deleted)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit historian retention prune: %w", err)
	}
	return nil
}

func (s *HistorianStore) loadRetentionQueue(ctx context.Context, limit int) ([]historianRetentionBlock, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT block_id,point_id,generation,from_utc_ms,to_utc_ms,file_name,byte_size,payload_sha256 FROM retention_prune_queue ORDER BY queued_at_utc_ms,block_id LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("read retention prune queue: %w", err)
	}
	defer rows.Close()
	queue := make([]historianRetentionBlock, 0)
	for rows.Next() {
		var block historianRetentionBlock
		if err := rows.Scan(&block.blockID, &block.pointID, &block.generation, &block.fromUTCMS, &block.toUTCMS, &block.fileName, &block.byteSize, &block.payloadSHA256); err != nil {
			return nil, fmt.Errorf("scan retention prune queue: %w", err)
		}
		queue = append(queue, block)
	}
	return queue, rows.Err()
}

func (s *HistorianStore) deleteRetentionQueue(ctx context.Context, queue []historianRetentionBlock) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin retention queue cleanup: %w", err)
	}
	defer tx.Rollback()
	for _, block := range queue {
		if _, err := tx.ExecContext(ctx, `DELETE FROM retention_prune_queue WHERE block_id=?`, block.blockID); err != nil {
			return fmt.Errorf("delete retention queue row: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit retention queue cleanup: %w", err)
	}
	return nil
}

func verifyRetentionArchiveFile(dir string, block historianRetentionBlock) error {
	if !safeRetentionArchiveFileName(block.fileName) || block.byteSize < archiveHeaderSize+archiveTrailerSize || len(block.payloadSHA256) != sha256.Size {
		return fmt.Errorf("unsafe retired archive metadata")
	}
	path := filepath.Join(dir, block.fileName)
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("verify retired archive file: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() != block.byteSize {
		return fmt.Errorf("retired archive file metadata mismatch")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read retired archive file: %w", err)
	}
	digest := sha256.Sum256(data[:len(data)-archiveTrailerSize])
	if !equalBytes(digest[:], block.payloadSHA256) {
		return fmt.Errorf("retired archive checksum mismatch")
	}
	decoded, err := DecodeArchiveBlock(data)
	if err != nil || decoded.PointID != block.pointID || decoded.Generation != block.generation || decoded.StartUTCMS != block.fromUTCMS {
		return fmt.Errorf("retired archive decode mismatch")
	}
	return nil
}

func safeRetentionArchiveFileName(name string) bool {
	return name != "" && filepath.Base(name) == name && !strings.ContainsAny(name, `/\\`)
}

func historianRetentionCutoff(stableUTCMS int64, days int) (int64, bool) {
	if stableUTCMS <= 0 || days <= 0 || int64(days) > (1<<62)/archiveDayMS {
		return 0, false
	}
	return stableUTCMS - int64(days)*archiveDayMS, true
}

func retentionIdentityKey(pointID string, generation uint64) string {
	return fmt.Sprintf("%s#%d", pointID, generation)
}

func runRetentionFault(fault func(string) error, stage string) error {
	if fault == nil {
		return nil
	}
	return fault(stage)
}
