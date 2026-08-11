package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"hash"
)

type AuditRecord struct {
	AuditInput
	Sequence   int64
	Details    []byte
	PrevHash   [sha256.Size]byte
	RecordHash [sha256.Size]byte
}

func (s *Store) CommitAudit(ctx context.Context, input AuditInput) (AuditRecord, error) {
	if s == nil || s.db == nil {
		return AuditRecord{}, fmt.Errorf("Programming store chưa mở")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AuditRecord{}, err
	}
	defer tx.Rollback()
	record, err := appendAuditTx(ctx, tx, input)
	if err != nil {
		return AuditRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return AuditRecord{}, err
	}
	return record, nil
}

func appendAuditTx(ctx context.Context, tx *sql.Tx, input AuditInput) (AuditRecord, error) {
	if err := validateUUIDs(input.AuditID); err != nil {
		return AuditRecord{}, err
	}
	if input.RevisionID != "" {
		if err := validateUUIDs(input.RevisionID); err != nil {
			return AuditRecord{}, err
		}
	}
	if input.OperationID != "" {
		if err := validateUUIDs(input.OperationID); err != nil {
			return AuditRecord{}, err
		}
	}
	if err := validateActorAudit(input.ActorID, input.Role, input.CorrelationID, input.OccurredAtUTCMS); err != nil {
		return AuditRecord{}, err
	}
	for _, field := range []struct {
		name, value string
		maximum     int
	}{{"action", input.Action, 64}, {"targetType", input.TargetType, 64},
		{"targetId", input.TargetID, 128}, {"resultCode", input.ResultCode, 64}} {
		if err := validateText(field.name, field.value, 1, field.maximum); err != nil {
			return AuditRecord{}, err
		}
	}
	details, err := canonicalJSON(input.DetailsJSON, 16*1024)
	if err != nil {
		return AuditRecord{}, err
	}
	if err := validateAuditDetails(details); err != nil {
		return AuditRecord{}, err
	}
	var sequence int64
	var previous []byte
	err = tx.QueryRowContext(ctx,
		`SELECT sequence,record_hash FROM audit_records ORDER BY sequence DESC LIMIT 1`).Scan(&sequence, &previous)
	if errors.Is(err, sql.ErrNoRows) {
		sequence = 0
		previous = make([]byte, sha256.Size)
	} else if err != nil {
		return AuditRecord{}, fmt.Errorf("đọc audit tail: %w", err)
	}
	if len(previous) != sha256.Size {
		return AuditRecord{}, fmt.Errorf("audit previous hash hỏng")
	}
	sequence++
	var prevHash [sha256.Size]byte
	copy(prevHash[:], previous)
	recordHash := hashAuditRecord(prevHash, sequence, input, details)
	if _, err := tx.ExecContext(ctx, `INSERT INTO audit_records(audit_id,sequence,actor_id,role,action,target_type,target_id,revision_id,operation_id,occurred_at_utc_ms,result_code,correlation_id,details_json,prev_hash,record_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		input.AuditID, sequence, input.ActorID, input.Role, input.Action, input.TargetType,
		input.TargetID, nullableString(input.RevisionID), nullableString(input.OperationID),
		input.OccurredAtUTCMS, input.ResultCode, input.CorrelationID, details, prevHash[:], recordHash[:]); err != nil {
		return AuditRecord{}, fmt.Errorf("append audit: %w", err)
	}
	return AuditRecord{AuditInput: input, Sequence: sequence, Details: details,
		PrevHash: prevHash, RecordHash: recordHash}, nil
}

func (s *Store) VerifyAuditChain(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT audit_id,sequence,actor_id,role,action,target_type,target_id,revision_id,operation_id,occurred_at_utc_ms,result_code,correlation_id,details_json,prev_hash,record_hash FROM audit_records ORDER BY sequence`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var previous [sha256.Size]byte
	var expectedSequence int64 = 1
	for rows.Next() {
		var input AuditInput
		var sequence int64
		var revision, operation sql.NullString
		var details, prevHash, recordHash []byte
		if err := rows.Scan(&input.AuditID, &sequence, &input.ActorID, &input.Role, &input.Action,
			&input.TargetType, &input.TargetID, &revision, &operation, &input.OccurredAtUTCMS,
			&input.ResultCode, &input.CorrelationID, &details, &prevHash, &recordHash); err != nil {
			return err
		}
		if revision.Valid {
			input.RevisionID = revision.String
		}
		if operation.Valid {
			input.OperationID = operation.String
		}
		if sequence != expectedSequence || !bytes.Equal(prevHash, previous[:]) {
			return fmt.Errorf("audit gap/hash link sai tại sequence %d", sequence)
		}
		expected := hashAuditRecord(previous, sequence, input, details)
		if !bytes.Equal(recordHash, expected[:]) {
			return fmt.Errorf("audit record hash sai tại sequence %d", sequence)
		}
		previous = expected
		expectedSequence++
	}
	return rows.Err()
}

func hashAuditRecord(previous [sha256.Size]byte, sequence int64, input AuditInput, details []byte) [sha256.Size]byte {
	hasher := sha256.New()
	hasher.Write(previous[:])
	var sequenceBytes [8]byte
	binary.BigEndian.PutUint64(sequenceBytes[:], uint64(sequence))
	hasher.Write(sequenceBytes[:])
	for _, value := range []string{
		input.AuditID, input.ActorID, input.Role, input.Action, input.TargetType, input.TargetID,
		input.RevisionID, input.OperationID, input.ResultCode, input.CorrelationID,
	} {
		writeHashField(hasher, []byte(value))
	}
	binary.BigEndian.PutUint64(sequenceBytes[:], uint64(input.OccurredAtUTCMS))
	hasher.Write(sequenceBytes[:])
	writeHashField(hasher, details)
	var result [sha256.Size]byte
	copy(result[:], hasher.Sum(nil))
	return result
}

func writeHashField(hasher hash.Hash, value []byte) {
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	hasher.Write(length[:])
	hasher.Write(value)
}
