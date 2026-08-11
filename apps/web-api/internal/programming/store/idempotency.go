package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type mutationReceiptResult struct {
	ProjectID  string `json:"projectId,omitempty"`
	DraftID    string `json:"draftId,omitempty"`
	RevisionID string `json:"revisionId,omitempty"`
	ETag       int64  `json:"etag"`
	AuditID    string `json:"auditId"`
}

const mutationReceiptTTL = 24 * time.Hour

type MutationReplay struct {
	ProjectID  string
	DraftID    string
	RevisionID string
	ETag       int64
	AuditID    string
}

func (s *Store) LookupMutation(ctx context.Context, actorID, action, targetID string, key, request [sha256.Size]byte) (MutationReplay, bool, error) {
	if err := validateMutationIdentity(key, request); err != nil {
		return MutationReplay{}, false, err
	}
	var storedRequest, resultJSON []byte
	var expiresAt int64
	err := s.db.QueryRowContext(ctx, `SELECT request_sha256,result_json,expires_at_utc_ms FROM mutation_receipts WHERE actor_id=? AND action=? AND target_id=? AND idempotency_key_sha256=?`,
		actorID, action, targetID, key[:]).Scan(&storedRequest, &resultJSON, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return MutationReplay{}, false, nil
	}
	if err != nil {
		return MutationReplay{}, false, fmt.Errorf("đọc mutation receipt: %w", err)
	}
	if s.now().UTC().UnixMilli() >= expiresAt {
		return MutationReplay{}, false, nil
	}
	if !equalDigest(storedRequest, request) {
		return MutationReplay{}, false, ErrIdempotencyConflict
	}
	var result mutationReceiptResult
	if err := json.Unmarshal(resultJSON, &result); err != nil || result.AuditID == "" || result.ETag < 1 {
		return MutationReplay{}, false, fmt.Errorf("mutation receipt hỏng")
	}
	return MutationReplay{ProjectID: result.ProjectID, DraftID: result.DraftID, RevisionID: result.RevisionID,
		ETag: result.ETag, AuditID: result.AuditID}, true, nil
}

func validateMutationIdentity(key, request [sha256.Size]byte) error {
	if allZero(key[:]) || allZero(request[:]) {
		return fmt.Errorf("idempotency key hash và request hash là bắt buộc")
	}
	return nil
}

func readMutationReceiptTx(ctx context.Context, tx *sql.Tx, actorID, action, targetID string, key, request [sha256.Size]byte, at int64) (mutationReceiptResult, bool, error) {
	var storedRequest, resultJSON []byte
	var expiresAt int64
	err := tx.QueryRowContext(ctx, `SELECT request_sha256,result_json,expires_at_utc_ms FROM mutation_receipts WHERE actor_id=? AND action=? AND target_id=? AND idempotency_key_sha256=?`,
		actorID, action, targetID, key[:]).Scan(&storedRequest, &resultJSON, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return mutationReceiptResult{}, false, nil
	}
	if err != nil {
		return mutationReceiptResult{}, false, fmt.Errorf("đọc mutation receipt: %w", err)
	}
	if at >= expiresAt {
		if _, err := tx.ExecContext(ctx, `DELETE FROM mutation_receipts WHERE actor_id=? AND action=? AND target_id=? AND idempotency_key_sha256=? AND expires_at_utc_ms<=?`,
			actorID, action, targetID, key[:], at); err != nil {
			return mutationReceiptResult{}, false, fmt.Errorf("dọn mutation receipt hết hạn: %w", err)
		}
		return mutationReceiptResult{}, false, nil
	}
	if !equalDigest(storedRequest, request) {
		return mutationReceiptResult{}, false, ErrIdempotencyConflict
	}
	var result mutationReceiptResult
	if err := json.Unmarshal(resultJSON, &result); err != nil || result.AuditID == "" || result.ETag < 1 {
		return mutationReceiptResult{}, false, fmt.Errorf("mutation receipt hỏng")
	}
	return result, true, nil
}

func writeMutationReceiptTx(ctx context.Context, tx *sql.Tx, actorID, action, targetID string, key, request [sha256.Size]byte, result mutationReceiptResult, at int64) error {
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encode mutation receipt: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO mutation_receipts(actor_id,action,target_id,idempotency_key_sha256,request_sha256,result_json,created_at_utc_ms,expires_at_utc_ms) VALUES(?,?,?,?,?,?,?,?)`,
		actorID, action, targetID, key[:], request[:], resultJSON, at, at+mutationReceiptTTL.Milliseconds()); err != nil {
		return fmt.Errorf("ghi mutation receipt: %w", err)
	}
	return nil
}
