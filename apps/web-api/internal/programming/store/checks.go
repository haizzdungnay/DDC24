package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const checkReceiptTTL = 24 * time.Hour

func (s *Store) EnqueueCheck(ctx context.Context, params EnqueueCheckParams) (Check, error) {
	if err := validateUUIDs(params.CheckID, params.RevisionID, params.AuditID); err != nil {
		return Check{}, err
	}
	if err := validateText("targetId", params.TargetID, 1, 128); err != nil {
		return Check{}, err
	}
	if err := validateText("profile", params.Profile, 1, 64); err != nil {
		return Check{}, err
	}
	if err := validateText("compilerVersion", params.CompilerVersion, 1, 64); err != nil {
		return Check{}, err
	}
	if err := validateActorAudit(params.ActorID, params.Role, params.CorrelationID, params.At.UnixMilli()); err != nil {
		return Check{}, err
	}
	if params.InputSHA256 == ([32]byte{}) {
		return Check{}, fmt.Errorf("Check input hash rỗng")
	}
	if err := validateMutationIdentity(params.IdempotencyKeySHA256, params.RequestSHA256); err != nil {
		return Check{}, err
	}
	at := params.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Check{}, fmt.Errorf("begin EnqueueCheck: %w", err)
	}
	defer tx.Rollback()
	var oldRequest []byte
	var oldCheckID string
	var expiresAt int64
	err = tx.QueryRowContext(ctx, `SELECT request_sha256,check_id,expires_at_utc_ms FROM check_requests
		WHERE actor_id=? AND revision_id=? AND target_id=? AND idempotency_key_sha256=?`,
		params.ActorID, params.RevisionID, params.TargetID, params.IdempotencyKeySHA256[:]).Scan(&oldRequest, &oldCheckID, &expiresAt)
	switch {
	case err == nil && expiresAt > at:
		if len(oldRequest) != sha256.Size || !equalDigest(oldRequest, params.RequestSHA256) {
			return Check{}, ErrIdempotencyConflict
		}
		check, readErr := getCheckTx(ctx, tx, oldCheckID)
		if readErr != nil {
			return Check{}, readErr
		}
		check.Replay = true
		if err := tx.Commit(); err != nil {
			return Check{}, err
		}
		return check, nil
	case err == nil:
		if _, err := tx.ExecContext(ctx, `DELETE FROM check_requests WHERE actor_id=? AND revision_id=? AND target_id=? AND idempotency_key_sha256=?`,
			params.ActorID, params.RevisionID, params.TargetID, params.IdempotencyKeySHA256[:]); err != nil {
			return Check{}, err
		}
	case !errors.Is(err, sql.ErrNoRows):
		return Check{}, fmt.Errorf("đọc Check receipt: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO checks(check_id,revision_id,target_id,state,input_sha256,profile,compiler_version,created_at_utc_ms)
		VALUES(?,?,?,'QUEUED',?,?,?,?)`, params.CheckID, params.RevisionID, params.TargetID,
		params.InputSHA256[:], params.Profile, params.CompilerVersion, at); err != nil {
		if strings.Contains(err.Error(), "FOREIGN KEY") {
			return Check{}, ErrNotFound
		}
		return Check{}, fmt.Errorf("insert Check: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO check_requests(actor_id,revision_id,target_id,idempotency_key_sha256,request_sha256,
		check_id,role,correlation_id,created_at_utc_ms,expires_at_utc_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		params.ActorID, params.RevisionID, params.TargetID, params.IdempotencyKeySHA256[:], params.RequestSHA256[:],
		params.CheckID, params.Role, params.CorrelationID, at, params.At.UTC().Add(checkReceiptTTL).UnixMilli()); err != nil {
		return Check{}, fmt.Errorf("insert Check receipt: %w", err)
	}
	details, _ := json.Marshal(map[string]any{"state": "QUEUED", "targetId": params.TargetID})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: params.ActorID, Role: params.Role,
		Action: "CHECK_REQUEST", TargetType: "CHECK", TargetID: params.CheckID, RevisionID: params.RevisionID,
		OccurredAtUTCMS: at, ResultCode: "QUEUED", CorrelationID: params.CorrelationID, DetailsJSON: details}); err != nil {
		return Check{}, err
	}
	if err := tx.Commit(); err != nil {
		return Check{}, fmt.Errorf("commit EnqueueCheck: %w", err)
	}
	return Check{CheckID: params.CheckID, RevisionID: params.RevisionID, TargetID: params.TargetID, State: "QUEUED",
		InputSHA256: params.InputSHA256, Profile: params.Profile, CompilerVersion: params.CompilerVersion, CreatedAtUTCMS: at}, nil
}

func (s *Store) GetCheck(ctx context.Context, checkID string) (Check, error) {
	if err := validateUUIDs(checkID); err != nil {
		return Check{}, err
	}
	return getCheckTx(ctx, s.db, checkID)
}

func (s *Store) GetPassedCheckForRevision(ctx context.Context, revisionID string) (Check, error) {
	if err := validateUUIDs(revisionID); err != nil {
		return Check{}, err
	}
	var checkID string
	err := s.db.QueryRowContext(ctx, `SELECT check_id FROM checks
		WHERE revision_id=? AND state='PASSED'
		ORDER BY completed_at_utc_ms DESC,check_id DESC LIMIT 1`, revisionID).Scan(&checkID)
	if errors.Is(err, sql.ErrNoRows) {
		return Check{}, ErrNotFound
	}
	if err != nil {
		return Check{}, err
	}
	return getCheckTx(ctx, s.db, checkID)
}

// GetLatestCheckForRevision — WP-01 (Overview state model, D-01): Check gần
// nhất cho một Revision bất kể state (QUEUED/RUNNING/PASSED/FAILED/TIMED_OUT),
// khác `GetPassedCheckForRevision` vốn chỉ tìm bản PASSED (dùng cho
// Commission). `Overview` cần biết cả trạng thái đang chạy/vừa lỗi, không chỉ
// bản đạt gần nhất. `created_at_utc_ms` luôn có giá trị (NOT NULL) nên dùng
// làm khoá sắp xếp chính, khác `completed_at_utc_ms` vốn NULL khi
// QUEUED/RUNNING.
func (s *Store) GetLatestCheckForRevision(ctx context.Context, revisionID string) (Check, error) {
	if err := validateUUIDs(revisionID); err != nil {
		return Check{}, err
	}
	var checkID string
	err := s.db.QueryRowContext(ctx, `SELECT check_id FROM checks
		WHERE revision_id=?
		ORDER BY created_at_utc_ms DESC,check_id DESC LIMIT 1`, revisionID).Scan(&checkID)
	if errors.Is(err, sql.ErrNoRows) {
		return Check{}, ErrNotFound
	}
	if err != nil {
		return Check{}, err
	}
	return getCheckTx(ctx, s.db, checkID)
}

type queryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func getCheckTx(ctx context.Context, query queryRower, checkID string) (Check, error) {
	var value Check
	var input, resultDigest, artifactDigest []byte
	var started, completed, leaseExpires sql.NullInt64
	var leaseOwner, resultJSON sql.NullString
	var artifactID, artifactRevision, artifactCheck, artifactProfile, artifactCompiler, artifactLibrary, artifactPath, artifactIntegrity sql.NullString
	var artifactSchema, artifactABI, artifactSize, artifactCreated sql.NullInt64
	err := query.QueryRowContext(ctx, `SELECT c.check_id,c.revision_id,c.target_id,c.state,c.input_sha256,c.profile,c.compiler_version,
		c.created_at_utc_ms,c.started_at_utc_ms,c.completed_at_utc_ms,c.attempt_count,c.lease_owner,c.lease_expires_at_utc_ms,c.result_json,c.result_sha256,
		a.artifact_id,a.revision_id,a.check_id,a.schema_version,a.profile,a.target_abi,a.compiler_version,a.library_version,a.byte_size,a.sha256,a.relative_path,a.integrity_mode,a.created_at_utc_ms
		FROM checks c LEFT JOIN artifacts a ON a.check_id=c.check_id WHERE c.check_id=?`, checkID).Scan(
		&value.CheckID, &value.RevisionID, &value.TargetID, &value.State, &input, &value.Profile, &value.CompilerVersion,
		&value.CreatedAtUTCMS, &started, &completed, &value.AttemptCount, &leaseOwner, &leaseExpires, &resultJSON, &resultDigest,
		&artifactID, &artifactRevision, &artifactCheck, &artifactSchema, &artifactProfile, &artifactABI, &artifactCompiler,
		&artifactLibrary, &artifactSize, &artifactDigest, &artifactPath, &artifactIntegrity, &artifactCreated)
	if errors.Is(err, sql.ErrNoRows) {
		return Check{}, ErrNotFound
	}
	if err != nil {
		return Check{}, fmt.Errorf("đọc Check: %w", err)
	}
	if len(input) != sha256.Size {
		return Check{}, fmt.Errorf("Check input checksum hỏng")
	}
	copy(value.InputSHA256[:], input)
	if started.Valid {
		v := started.Int64
		value.StartedAtUTCMS = &v
	}
	if completed.Valid {
		v := completed.Int64
		value.CompletedAtUTCMS = &v
	}
	if leaseExpires.Valid {
		v := leaseExpires.Int64
		value.LeaseExpiresAtUTCMS = &v
	}
	if leaseOwner.Valid {
		value.LeaseOwner = leaseOwner.String
	}
	if resultJSON.Valid {
		value.ResultJSON = []byte(resultJSON.String)
		if len(resultDigest) != sha256.Size {
			return Check{}, fmt.Errorf("Check result checksum hỏng")
		}
		copy(value.ResultSHA256[:], resultDigest)
		if got := sha256.Sum256(value.ResultJSON); got != value.ResultSHA256 {
			return Check{}, fmt.Errorf("Check result checksum mismatch")
		}
	}
	if artifactID.Valid {
		if len(artifactDigest) != sha256.Size {
			return Check{}, fmt.Errorf("Artifact checksum hỏng")
		}
		artifact := &Artifact{ArtifactID: artifactID.String, RevisionID: artifactRevision.String, CheckID: artifactCheck.String,
			SchemaVersion: int(artifactSchema.Int64), Profile: artifactProfile.String, TargetABI: artifactABI.Int64,
			CompilerVersion: artifactCompiler.String, LibraryVersion: artifactLibrary.String, ByteSize: artifactSize.Int64,
			RelativePath: artifactPath.String, IntegrityMode: artifactIntegrity.String, CreatedAtUTCMS: artifactCreated.Int64}
		copy(artifact.SHA256[:], artifactDigest)
		value.Artifact = artifact
	}
	return value, nil
}

func (s *Store) ClaimCheck(ctx context.Context, owner string, now time.Time, lease time.Duration) (Check, bool, error) {
	if err := validateText("leaseOwner", owner, 1, 128); err != nil || lease < time.Second || lease > 10*time.Minute {
		return Check{}, false, fmt.Errorf("tham số lease Check không hợp lệ")
	}
	at, expires := now.UTC().UnixMilli(), now.UTC().Add(lease).UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Check{}, false, err
	}
	defer tx.Rollback()
	var checkID string
	err = tx.QueryRowContext(ctx, `SELECT check_id FROM checks WHERE
		(state='QUEUED' OR (state='RUNNING' AND lease_expires_at_utc_ms<=? AND attempt_count<2))
		ORDER BY created_at_utc_ms,check_id LIMIT 1`, at).Scan(&checkID)
	if errors.Is(err, sql.ErrNoRows) {
		return Check{}, false, nil
	}
	if err != nil {
		return Check{}, false, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE checks SET state='RUNNING',started_at_utc_ms=coalesce(started_at_utc_ms,?),
		attempt_count=attempt_count+1,lease_owner=?,lease_expires_at_utc_ms=? WHERE check_id=? AND
		(state='QUEUED' OR (state='RUNNING' AND lease_expires_at_utc_ms<=? AND attempt_count<2))`, at, owner, expires, checkID, at)
	if err != nil {
		return Check{}, false, err
	}
	rows, _ := result.RowsAffected()
	if rows != 1 {
		return Check{}, false, ErrLeaseLost
	}
	check, err := getCheckTx(ctx, tx, checkID)
	if err != nil {
		return Check{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Check{}, false, err
	}
	return check, true, nil
}

func (s *Store) CompleteCheck(ctx context.Context, params CompleteCheckParams) (Check, error) {
	if err := validateUUIDs(params.CheckID, params.AuditID); err != nil {
		return Check{}, err
	}
	if params.State != "PASSED" && params.State != "FAILED" && params.State != "TIMED_OUT" {
		return Check{}, fmt.Errorf("terminal Check state không hợp lệ")
	}
	resultJSON, err := canonicalJSONObject(params.ResultJSON, 1<<20)
	if err != nil {
		return Check{}, err
	}
	resultDigest := sha256.Sum256(resultJSON)
	at := params.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Check{}, err
	}
	defer tx.Rollback()
	var revisionID, state, leaseOwner, actorID, role, correlationID string
	err = tx.QueryRowContext(ctx, `SELECT c.revision_id,c.state,coalesce(c.lease_owner,''),r.actor_id,r.role,r.correlation_id
		FROM checks c JOIN check_requests r ON r.check_id=c.check_id WHERE c.check_id=?`, params.CheckID).
		Scan(&revisionID, &state, &leaseOwner, &actorID, &role, &correlationID)
	if errors.Is(err, sql.ErrNoRows) {
		return Check{}, ErrNotFound
	}
	if err != nil {
		return Check{}, err
	}
	if state != "RUNNING" || leaseOwner != params.LeaseOwner {
		return Check{}, ErrLeaseLost
	}
	if params.State == "PASSED" && params.Artifact == nil {
		return Check{}, fmt.Errorf("Check PASSED thiếu Artifact")
	}
	if params.State != "PASSED" && params.Artifact != nil {
		return Check{}, fmt.Errorf("Check lỗi không được tạo Artifact")
	}
	if params.Artifact != nil {
		a := params.Artifact
		if err := validateUUIDs(a.ArtifactID); err != nil || a.RevisionID != revisionID || a.CheckID != params.CheckID ||
			// v1 = artifact một Program; v2 = container package nhiều Program
			// (T59-302). Khoá cứng ở 1 sẽ chặn đúng thứ Check vừa dựng được.
			(a.SchemaVersion != 1 && a.SchemaVersion != 2) ||
			a.ByteSize < 1 || a.ByteSize > 1<<20 || a.SHA256 == ([32]byte{}) {
			return Check{}, fmt.Errorf("Artifact metadata không hợp lệ")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO artifacts(artifact_id,revision_id,check_id,schema_version,profile,target_abi,
			compiler_version,library_version,byte_size,sha256,relative_path,integrity_mode,created_at_utc_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			a.ArtifactID, a.RevisionID, a.CheckID, a.SchemaVersion, a.Profile, a.TargetABI, a.CompilerVersion,
			a.LibraryVersion, a.ByteSize, a.SHA256[:], a.RelativePath, a.IntegrityMode, at); err != nil {
			return Check{}, fmt.Errorf("insert Artifact: %w", err)
		}
	}
	update, err := tx.ExecContext(ctx, `UPDATE checks SET state=?,completed_at_utc_ms=?,result_json=?,result_sha256=?,lease_owner=NULL,lease_expires_at_utc_ms=NULL
		WHERE check_id=? AND state='RUNNING' AND lease_owner=?`, params.State, at, resultJSON, resultDigest[:], params.CheckID, params.LeaseOwner)
	if err != nil {
		return Check{}, err
	}
	rows, _ := update.RowsAffected()
	if rows != 1 {
		return Check{}, ErrLeaseLost
	}
	details, _ := json.Marshal(map[string]any{"state": params.State, "attempts": 1})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: actorID, Role: role,
		Action: "CHECK_COMPLETE", TargetType: "CHECK", TargetID: params.CheckID, RevisionID: revisionID,
		OccurredAtUTCMS: at, ResultCode: params.State, CorrelationID: correlationID, DetailsJSON: details}); err != nil {
		return Check{}, err
	}
	check, err := getCheckTx(ctx, tx, params.CheckID)
	if err != nil {
		return Check{}, err
	}
	if err := tx.Commit(); err != nil {
		return Check{}, err
	}
	return check, nil
}

func (s *Store) FailExhaustedChecks(ctx context.Context, now time.Time, newAuditID func() string, resultJSON []byte) (int64, error) {
	if newAuditID == nil {
		return 0, fmt.Errorf("audit ID factory là bắt buộc")
	}
	canonical, err := canonicalJSONObject(resultJSON, 1<<20)
	if err != nil {
		return 0, err
	}
	digest := sha256.Sum256(canonical)
	at := now.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT c.check_id,c.revision_id,r.actor_id,r.role,r.correlation_id FROM checks c
		JOIN check_requests r ON r.check_id=c.check_id WHERE c.state='RUNNING' AND c.attempt_count>=2 AND c.lease_expires_at_utc_ms<=?`, at)
	if err != nil {
		return 0, err
	}
	type stale struct{ checkID, revisionID, actorID, role, correlationID string }
	var items []stale
	for rows.Next() {
		var item stale
		if err := rows.Scan(&item.checkID, &item.revisionID, &item.actorID, &item.role, &item.correlationID); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	for _, item := range items {
		if _, err := tx.ExecContext(ctx, `UPDATE checks SET state='FAILED',completed_at_utc_ms=?,result_json=?,result_sha256=?,lease_owner=NULL,lease_expires_at_utc_ms=NULL WHERE check_id=? AND state='RUNNING'`, at, canonical, digest[:], item.checkID); err != nil {
			return 0, err
		}
		details, _ := json.Marshal(map[string]any{"state": "FAILED", "reason": "lease_exhausted"})
		if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: newAuditID(), ActorID: item.actorID, Role: item.role, Action: "CHECK_COMPLETE", TargetType: "CHECK", TargetID: item.checkID, RevisionID: item.revisionID, OccurredAtUTCMS: at, ResultCode: "FAILED", CorrelationID: item.correlationID, DetailsJSON: details}); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return int64(len(items)), nil
}
