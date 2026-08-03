package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
)

var ErrHistorianQuiesceConflict = errors.New("historian legacy quiesce proof conflict")

type LegacyQuiesceProof struct {
	Epoch          uint64
	Token          [32]byte
	TokenSHA256    []byte
	TrendDBPath    string
	StoppedAtUTCMS int64
}

func newLegacyQuiesceToken() ([32]byte, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return token, fmt.Errorf("generate legacy quiesce token: %w", err)
	}
	return token, nil
}

func (s *HistorianStore) RecordLegacyHistorianQuiesce(ctx context.Context, token [32]byte, trendDBPath string, stoppedAtUTCMS int64) (LegacyQuiesceProof, error) {
	if s == nil || s.db == nil || token == ([32]byte{}) || trendDBPath == "" || stoppedAtUTCMS <= 0 {
		return LegacyQuiesceProof{}, fmt.Errorf("invalid legacy quiesce proof")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LegacyQuiesceProof{}, err
	}
	defer tx.Rollback()
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM historian_activation WHERE singleton=1 AND state='active'`).Scan(&active); err != nil {
		return LegacyQuiesceProof{}, err
	}
	if active != 0 {
		return LegacyQuiesceProof{}, fmt.Errorf("legacy quiesce is forbidden after v2 activation")
	}
	var previousEpoch uint64
	var previousState string
	err = tx.QueryRowContext(ctx, `SELECT epoch,state FROM historian_legacy_quiesce WHERE singleton=1`).Scan(&previousEpoch, &previousState)
	if err != nil && err != sql.ErrNoRows {
		return LegacyQuiesceProof{}, err
	}
	if err == nil && previousState != "abandoned" {
		return LegacyQuiesceProof{}, ErrHistorianQuiesceConflict
	}
	epoch := previousEpoch + 1
	digest := sha256.Sum256(token[:])
	_, err = tx.ExecContext(ctx, `INSERT INTO historian_legacy_quiesce(singleton,epoch,token_sha256,state,trend_db_path,stopped_at_utc_ms,migration_id,updated_at_utc_ms) VALUES(1,?,?,'quiesced',?,?,NULL,?) ON CONFLICT(singleton) DO UPDATE SET epoch=excluded.epoch,token_sha256=excluded.token_sha256,state='quiesced',trend_db_path=excluded.trend_db_path,stopped_at_utc_ms=excluded.stopped_at_utc_ms,migration_id=NULL,updated_at_utc_ms=excluded.updated_at_utc_ms`, epoch, digest[:], trendDBPath, stoppedAtUTCMS, stoppedAtUTCMS)
	if err != nil {
		return LegacyQuiesceProof{}, fmt.Errorf("persist legacy quiesce proof: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return LegacyQuiesceProof{}, err
	}
	return LegacyQuiesceProof{Epoch: epoch, Token: token, TokenSHA256: digest[:], TrendDBPath: trendDBPath, StoppedAtUTCMS: stoppedAtUTCMS}, nil
}

func (s *HistorianStore) AbandonLegacyHistorianQuiesce(ctx context.Context, proof LegacyQuiesceProof, atUTCMS int64) error {
	if s == nil || s.db == nil || atUTCMS <= 0 {
		return nil
	}
	result, err := s.db.ExecContext(ctx, `UPDATE historian_legacy_quiesce SET state='abandoned',migration_id=NULL,updated_at_utc_ms=? WHERE singleton=1 AND epoch=? AND token_sha256=? AND state IN ('quiesced','consumed')`, atUTCMS, proof.Epoch, proof.TokenSHA256)
	if err != nil {
		return fmt.Errorf("abandon legacy quiesce proof: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed == 0 && proof.Epoch != 0 {
		return ErrHistorianQuiesceConflict
	}
	return nil
}

func (s *HistorianStore) InvalidateLegacyHistorianQuiesceForResume(ctx context.Context, atUTCMS int64) error {
	if s == nil || s.db == nil || atUTCMS <= 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM historian_activation WHERE singleton=1 AND state='active'`).Scan(&active); err != nil {
		return err
	}
	if active != 0 {
		return fmt.Errorf("legacy writer resume forbidden after v2 activation")
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM historian_cutover_evidence`); err != nil {
		return fmt.Errorf("invalidate stale historian cutover evidence: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE historian_legacy_quiesce SET state='abandoned',migration_id=NULL,updated_at_utc_ms=? WHERE singleton=1 AND state!='abandoned'`, atUTCMS); err != nil {
		return fmt.Errorf("invalidate stale legacy quiesce proof: %w", err)
	}
	return tx.Commit()
}

func validateLegacyQuiesceTx(ctx context.Context, tx *sql.Tx, migrationID string, proof LegacyQuiesceProof) error {
	if proof.Epoch == 0 || len(proof.TokenSHA256) != sha256.Size || migrationID == "" {
		return fmt.Errorf("durable legacy quiesce proof is required")
	}
	digest := sha256.Sum256(proof.Token[:])
	if !equalBytes(digest[:], proof.TokenSHA256) {
		return ErrHistorianQuiesceConflict
	}
	var state, path string
	var consumedMigration sql.NullString
	var epoch uint64
	var storedDigest []byte
	if err := tx.QueryRowContext(ctx, `SELECT epoch,token_sha256,state,trend_db_path,migration_id FROM historian_legacy_quiesce WHERE singleton=1`).Scan(&epoch, &storedDigest, &state, &path, &consumedMigration); err != nil {
		return fmt.Errorf("read durable legacy quiesce proof: %w", err)
	}
	validState := state == "quiesced" || (state == "consumed" && consumedMigration.Valid && consumedMigration.String == migrationID)
	if epoch != proof.Epoch || !validState || path != proof.TrendDBPath || !equalBytes(storedDigest, proof.TokenSHA256) {
		return ErrHistorianQuiesceConflict
	}
	return nil
}
