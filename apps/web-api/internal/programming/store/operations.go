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

const operationLeaseMaximum = 10 * time.Minute

func (s *Store) GetCommissionRecord(ctx context.Context, operationID string) (CommissionRecord, error) {
	if err := validateUUIDs(operationID); err != nil {
		return CommissionRecord{}, err
	}
	var value CommissionRecord
	var previous sql.NullString
	var artifact, override []byte
	err := s.db.QueryRowContext(ctx, `SELECT operation_id,previous_revision_id,new_revision_id,
		artifact_sha256,runtime_readback_json,impact_json,override_inventory_sha256,
		result,closed_at_utc_ms FROM commission_records WHERE operation_id=?`, operationID).
		Scan(&value.OperationID, &previous, &value.NewRevisionID, &artifact,
			&value.RuntimeReadbackJSON, &value.ImpactJSON, &override, &value.Result,
			&value.ClosedAtUTCMS)
	if errors.Is(err, sql.ErrNoRows) {
		return CommissionRecord{}, ErrNotFound
	}
	if err != nil {
		return CommissionRecord{}, err
	}
	if previous.Valid {
		value.PreviousRevisionID = previous.String
	}
	if len(artifact) != sha256.Size || len(override) != sha256.Size {
		return CommissionRecord{}, fmt.Errorf("CommissionRecord digest không hợp lệ")
	}
	copy(value.ArtifactSHA256[:], artifact)
	copy(value.OverrideInventorySHA256[:], override)
	value.RuntimeReadbackJSON = append([]byte(nil), value.RuntimeReadbackJSON...)
	value.ImpactJSON = append([]byte(nil), value.ImpactJSON...)
	return value, nil
}

func (s *Store) GetOperation(ctx context.Context, operationID string) (Operation, error) {
	if err := validateUUIDs(operationID); err != nil {
		return Operation{}, err
	}
	return scanOperation(s.db.QueryRowContext(ctx, operationSelect+` WHERE operation_id=?`, operationID))
}

// LookupOperationByIdempotency phải chạy trước mọi side effect filesystem của
// coordinator. Nhờ vậy replay cùng request không tạo thêm staging directory;
// cùng key nhưng request khác bị chặn trước khi chạm artifact.
func (s *Store) LookupOperationByIdempotency(ctx context.Context, actorID, kind,
	controllerID string, keyHash, requestHash [32]byte) (Operation, bool, error) {
	if err := validateText("actorId", actorID, 1, 128); err != nil ||
		!validOperationKind(kind) || validateText("controllerId", controllerID, 1, 128) != nil ||
		allZero(keyHash[:]) || allZero(requestHash[:]) {
		return Operation{}, false, fmt.Errorf("identity idempotency Operation không hợp lệ")
	}
	operation, err := scanOperation(s.db.QueryRowContext(ctx, operationSelect+`
		WHERE actor_id=? AND kind=? AND controller_id=? AND idempotency_key_sha256=?`,
		actorID, kind, controllerID, keyHash[:]))
	if errors.Is(err, ErrNotFound) {
		return Operation{}, false, nil
	}
	if err != nil {
		return Operation{}, false, err
	}
	var stored []byte
	if err := s.db.QueryRowContext(ctx, `SELECT request_sha256 FROM operations WHERE operation_id=?`,
		operation.OperationID).Scan(&stored); err != nil {
		return Operation{}, false, err
	}
	if !equalDigest(stored, requestHash) {
		return Operation{}, false, ErrIdempotencyConflict
	}
	operation.Replay = true
	return operation, true, nil
}

func (s *Store) ListRecoverableOperations(ctx context.Context, limit int) ([]Operation, error) {
	if limit < 1 || limit > 100 {
		return nil, fmt.Errorf("operation limit không hợp lệ")
	}
	rows, err := s.db.QueryContext(ctx, operationSelect+`
		WHERE state NOT IN ('SUCCEEDED','FAILED','CANCELLED')
		ORDER BY updated_at_utc_ms,operation_id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Operation, 0)
	for rows.Next() {
		operation, err := scanOperation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, operation)
	}
	return result, rows.Err()
}

func (s *Store) ClaimOperation(ctx context.Context, params ClaimOperationParams) (Operation, bool, error) {
	if err := validateText("leaseOwner", params.Owner, 1, 128); err != nil ||
		params.Lease < time.Second || params.Lease > operationLeaseMaximum {
		return Operation{}, false, fmt.Errorf("tham số lease Operation không hợp lệ")
	}
	at := params.At.UTC().UnixMilli()
	expires := params.At.UTC().Add(params.Lease).UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Operation{}, false, err
	}
	defer tx.Rollback()
	var operationID string
	err = tx.QueryRowContext(ctx, `SELECT operation_id FROM operations
		WHERE state NOT IN ('SUCCEEDED','FAILED','CANCELLED')
		AND (lease_owner IS NULL OR lease_expires_at_utc_ms<=?)
		ORDER BY updated_at_utc_ms,operation_id LIMIT 1`, at).Scan(&operationID)
	if errors.Is(err, sql.ErrNoRows) {
		return Operation{}, false, nil
	}
	if err != nil {
		return Operation{}, false, err
	}
	update, err := tx.ExecContext(ctx, `UPDATE operations SET lease_owner=?,lease_expires_at_utc_ms=?,
		lease_generation=lease_generation+1,attempt_count=attempt_count+1,updated_at_utc_ms=?
		WHERE operation_id=? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED')
		AND (lease_owner IS NULL OR lease_expires_at_utc_ms<=?)`, params.Owner, expires, at, operationID, at)
	if err != nil {
		return Operation{}, false, err
	}
	if rows, _ := update.RowsAffected(); rows != 1 {
		return Operation{}, false, ErrLeaseLost
	}
	operation, err := scanOperation(tx.QueryRowContext(ctx, operationSelect+` WHERE operation_id=?`, operationID))
	if err != nil {
		return Operation{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Operation{}, false, err
	}
	return operation, true, nil
}

func (s *Store) UpdateOperation(ctx context.Context, params UpdateOperationParams) (Operation, error) {
	if err := validateUUIDs(params.OperationID); err != nil {
		return Operation{}, err
	}
	if params.LeaseOwner == "" || params.LeaseGeneration < 1 || !validOperationState(params.State) ||
		params.Step == "" || len(params.Step) > 64 {
		return Operation{}, fmt.Errorf("transition Operation không hợp lệ")
	}
	if params.PreviousActive != "" {
		if err := validateUUIDs(params.PreviousActive); err != nil {
			return Operation{}, err
		}
	}
	if params.ActualActive != "" {
		if err := validateUUIDs(params.ActualActive); err != nil {
			return Operation{}, err
		}
	}
	var commission *validatedCommissionRecord
	if params.CommissionRecord != nil {
		value, err := validateCommissionRecord(*params.CommissionRecord)
		if err != nil {
			return Operation{}, err
		}
		commission = &value
	}
	var coreJSON any = nil
	var coreDigest any = nil
	if len(params.CoreResultJSON) > 0 {
		canonical, err := canonicalJSONObject(params.CoreResultJSON, 1<<20)
		if err != nil {
			return Operation{}, fmt.Errorf("core result: %w", err)
		}
		digest := sha256.Sum256(canonical)
		coreJSON, coreDigest = canonical, digest[:]
	}
	at := params.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Operation{}, err
	}
	defer tx.Rollback()
	var currentState, operationKind, requestedRevision string
	if err := tx.QueryRowContext(ctx, `SELECT state,kind,requested_revision_id FROM operations
		WHERE operation_id=? AND lease_owner=? AND lease_generation=?
		AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED')`, params.OperationID,
		params.LeaseOwner, params.LeaseGeneration).Scan(&currentState, &operationKind,
		&requestedRevision); errors.Is(err, sql.ErrNoRows) {
		return Operation{}, ErrLeaseLost
	} else if err != nil {
		return Operation{}, err
	}
	if !validOperationTransition(currentState, params.State) {
		return Operation{}, fmt.Errorf("transition Operation %s -> %s không hợp lệ",
			currentState, params.State)
	}
	if operationKind == "COMMISSION" && params.State == "SUCCEEDED" && commission == nil {
		return Operation{}, fmt.Errorf("Commission SUCCEEDED thiếu CommissionRecord atomic")
	}
	update, err := tx.ExecContext(ctx, `UPDATE operations SET state=?,step=?,result_code=?,detail_code=?,
		keeps_running_revision=?,previous_active_revision_id=coalesce(previous_active_revision_id,?),
		actual_active_revision_id=?,core_result_json=coalesce(?,core_result_json),
		core_result_sha256=coalesce(?,core_result_sha256),updated_at_utc_ms=?,
		lease_owner=CASE WHEN ? THEN NULL ELSE lease_owner END,
		lease_expires_at_utc_ms=CASE WHEN ? THEN NULL ELSE lease_expires_at_utc_ms END
		WHERE operation_id=? AND lease_owner=? AND lease_generation=?
		AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED')`,
		params.State, params.Step, nullableString(params.ResultCode), nullableString(params.DetailCode),
		nullableBool(params.KeepsRunningRevision), nullableString(params.PreviousActive), nullableString(params.ActualActive),
		coreJSON, coreDigest, at, params.ReleaseLease, params.ReleaseLease,
		params.OperationID, params.LeaseOwner, params.LeaseGeneration)
	if err != nil {
		return Operation{}, err
	}
	if rows, _ := update.RowsAffected(); rows != 1 {
		return Operation{}, ErrLeaseLost
	}
	if commission != nil {
		if operationKind != "COMMISSION" || requestedRevision != commission.newRevisionID ||
			(params.State != "SUCCEEDED" && params.State != "FAILED" && params.State != "CANCELLED") {
			return Operation{}, fmt.Errorf("CommissionRecord không khớp Operation terminal")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO commission_records(operation_id,
			previous_revision_id,new_revision_id,artifact_sha256,runtime_readback_json,
			impact_json,override_inventory_sha256,result,closed_at_utc_ms)
			VALUES(?,?,?,?,?,?,?,?,?)`, params.OperationID,
			nullableString(commission.previousRevisionID), commission.newRevisionID,
			commission.artifactSHA256[:], commission.runtimeReadbackJSON,
			commission.impactJSON, commission.overrideInventorySHA256[:],
			commission.result, at); err != nil {
			return Operation{}, fmt.Errorf("insert CommissionRecord: %w", err)
		}
	}
	if params.AuditID != "" {
		if err := validateUUIDs(params.AuditID); err != nil {
			return Operation{}, err
		}
		operation, err := scanOperation(tx.QueryRowContext(ctx, operationSelect+` WHERE operation_id=?`, params.OperationID))
		if err != nil {
			return Operation{}, err
		}
		details, _ := json.Marshal(map[string]any{"state": params.State, "step": params.Step, "detailCode": params.DetailCode})
		if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: operation.ActorID,
			Role: params.AuditRole, Action: params.AuditAction, TargetType: "OPERATION", TargetID: params.OperationID,
			RevisionID: operation.RequestedRevisionID, OperationID: params.OperationID, OccurredAtUTCMS: at,
			ResultCode: params.State, CorrelationID: operation.CorrelationID, DetailsJSON: details}); err != nil {
			return Operation{}, err
		}
	}
	operation, err := scanOperation(tx.QueryRowContext(ctx, operationSelect+` WHERE operation_id=?`, params.OperationID))
	if err != nil {
		return Operation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Operation{}, err
	}
	return operation, nil
}

type validatedCommissionRecord struct {
	previousRevisionID      string
	newRevisionID           string
	artifactSHA256          [32]byte
	runtimeReadbackJSON     []byte
	impactJSON              []byte
	overrideInventorySHA256 [32]byte
	result                  string
}

func validateCommissionRecord(input CommissionRecordInput) (validatedCommissionRecord, error) {
	if input.PreviousRevisionID != "" {
		if err := validateUUIDs(input.PreviousRevisionID); err != nil {
			return validatedCommissionRecord{}, err
		}
	}
	if err := validateUUIDs(input.NewRevisionID); err != nil {
		return validatedCommissionRecord{}, err
	}
	if allZero(input.ArtifactSHA256[:]) || allZero(input.OverrideInventorySHA256[:]) ||
		len(input.Result) < 1 || len(input.Result) > 64 {
		return validatedCommissionRecord{}, fmt.Errorf("CommissionRecord digest/result không hợp lệ")
	}
	runtimeJSON, err := canonicalJSONObject(input.RuntimeReadbackJSON, 65536)
	if err != nil {
		return validatedCommissionRecord{}, fmt.Errorf("CommissionRecord runtime read-back: %w", err)
	}
	impactJSON, err := canonicalJSONObject(input.ImpactJSON, 65536)
	if err != nil {
		return validatedCommissionRecord{}, fmt.Errorf("CommissionRecord impact: %w", err)
	}
	return validatedCommissionRecord{previousRevisionID: input.PreviousRevisionID,
		newRevisionID: input.NewRevisionID, artifactSHA256: input.ArtifactSHA256,
		runtimeReadbackJSON: runtimeJSON, impactJSON: impactJSON,
		overrideInventorySHA256: input.OverrideInventorySHA256, result: input.Result}, nil
}

const operationSelect = `SELECT operation_id,kind,state,step,controller_id,requested_revision_id,
	expected_active_revision_id,correlation_id,actor_id,created_at_utc_ms,updated_at_utc_ms,
	result_code,detail_code,keeps_running_revision,previous_active_revision_id,actual_active_revision_id,
	operation_context_json,operation_context_sha256,core_result_json,core_result_sha256,
	attempt_count,lease_owner,lease_expires_at_utc_ms,lease_generation FROM operations`

type operationScanner interface{ Scan(...any) error }

func scanOperation(row operationScanner) (Operation, error) {
	var value Operation
	var expected, result, detail, previous, actual, leaseOwner sql.NullString
	var keeps, leaseExpiry sql.NullInt64
	var contextJSON, contextDigest, coreJSON, coreDigest []byte
	err := row.Scan(&value.OperationID, &value.Kind, &value.State, &value.Step, &value.ControllerID,
		&value.RequestedRevisionID, &expected, &value.CorrelationID, &value.ActorID,
		&value.CreatedAtUTCMS, &value.UpdatedAtUTCMS, &result, &detail, &keeps, &previous, &actual,
		&contextJSON, &contextDigest, &coreJSON, &coreDigest, &value.AttemptCount, &leaseOwner,
		&leaseExpiry, &value.LeaseGeneration)
	if errors.Is(err, sql.ErrNoRows) {
		return Operation{}, ErrNotFound
	}
	if err != nil {
		return Operation{}, err
	}
	if expected.Valid {
		value.ExpectedActiveRevisionID = expected.String
	}
	if result.Valid {
		value.ResultCode = result.String
	}
	if detail.Valid {
		value.DetailCode = detail.String
	}
	if previous.Valid {
		value.PreviousActiveRevisionID = previous.String
	}
	if actual.Valid {
		value.ActualActiveRevisionID = actual.String
	}
	if keeps.Valid {
		v := keeps.Int64 != 0
		value.KeepsRunningRevision = &v
	}
	if leaseOwner.Valid {
		value.LeaseOwner = leaseOwner.String
	}
	if leaseExpiry.Valid {
		v := leaseExpiry.Int64
		value.LeaseExpiresAtUTCMS = &v
	}
	if err := verifyJSONDigest("operation context", contextJSON, contextDigest); err != nil {
		return Operation{}, err
	}
	if err := verifyJSONDigest("core result", coreJSON, coreDigest); err != nil {
		return Operation{}, err
	}
	value.ContextJSON = append([]byte(nil), contextJSON...)
	value.CoreResultJSON = append([]byte(nil), coreJSON...)
	return value, nil
}

func verifyJSONDigest(name string, raw, digest []byte) error {
	if len(raw) == 0 && len(digest) == 0 {
		return nil
	}
	if len(raw) == 0 || len(digest) != sha256.Size {
		return fmt.Errorf("%s thiếu dữ liệu/checksum", name)
	}
	actual := sha256.Sum256(raw)
	if !equalDigest(digest, actual) {
		return fmt.Errorf("%s checksum mismatch", name)
	}
	return nil
}

func nullableBool(value *bool) any {
	if value == nil {
		return nil
	}
	if *value {
		return 1
	}
	return 0
}

func validOperationState(value string) bool {
	switch value {
	case "PENDING", "VALIDATING", "STAGING", "ACTIVATING", "VERIFYING", "SUCCEEDED", "FAILED", "UNKNOWN", "CANCELLED":
		return true
	}
	return false
}

func validOperationTransition(from, to string) bool {
	if to == "FAILED" || to == "UNKNOWN" {
		return true
	}
	if from == to {
		return from == "VALIDATING" || from == "VERIFYING" || from == "UNKNOWN"
	}
	switch from {
	case "PENDING":
		return to == "VALIDATING" || to == "CANCELLED"
	case "VALIDATING":
		return to == "STAGING" || to == "CANCELLED"
	case "STAGING":
		return to == "ACTIVATING" || to == "VERIFYING"
	case "ACTIVATING":
		return to == "VERIFYING"
	case "VERIFYING", "UNKNOWN":
		return to == "VERIFYING" || to == "SUCCEEDED"
	}
	return false
}
