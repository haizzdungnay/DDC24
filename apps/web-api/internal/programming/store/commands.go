package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxDraftBytes    = 2 * 1024 * 1024
	maxManifestBytes = 256 * 1024
	maxObjectBytes   = 256 * 1024
)

func (s *Store) CreateProject(ctx context.Context, params CreateProjectParams) (Project, Draft, error) {
	if err := validateUUIDs(params.ProjectID, params.DraftID, params.AuditID); err != nil {
		return Project{}, Draft{}, err
	}
	if err := validateText("name", params.Name, 1, 128); err != nil {
		return Project{}, Draft{}, err
	}
	if err := validateText("description", params.Description, 0, 2048); err != nil {
		return Project{}, Draft{}, err
	}
	if err := validateActorAudit(params.ActorID, params.Role, params.CorrelationID, params.At.UnixMilli()); err != nil {
		return Project{}, Draft{}, err
	}
	if err := validateMutationIdentity(params.IdempotencyKeySHA256, params.RequestSHA256); err != nil {
		return Project{}, Draft{}, err
	}
	content, err := canonicalJSONObject(params.ContentJSON, maxDraftBytes)
	if err != nil {
		return Project{}, Draft{}, err
	}
	digest := sha256.Sum256(content)
	at := params.At.UTC().UnixMilli()
	project := Project{ProjectID: params.ProjectID, Name: params.Name, Description: params.Description,
		CreatedBy: params.ActorID, UpdatedBy: params.ActorID, CreatedAtUTCMS: at, UpdatedAtUTCMS: at}
	draft := Draft{DraftID: params.DraftID, ProjectID: params.ProjectID, ETag: 1,
		ContentJSON: content, ContentSHA256: digest, UpdatedBy: params.ActorID, UpdatedAtUTCMS: at}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, Draft{}, fmt.Errorf("begin CreateProject: %w", err)
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.ActorID, "PROJECT_CREATE", "", params.IdempotencyKeySHA256, params.RequestSHA256, at)
	if err != nil {
		return Project{}, Draft{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return Project{}, Draft{}, err
		}
		return Project{ProjectID: receipt.ProjectID, AuditID: receipt.AuditID, Replay: true},
			Draft{DraftID: receipt.DraftID, ProjectID: receipt.ProjectID, ETag: receipt.ETag, AuditID: receipt.AuditID, Replay: true}, nil
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO projects(project_id,name,description,created_by,updated_by,created_at_utc_ms,updated_at_utc_ms) VALUES(?,?,?,?,?,?,?)`,
		project.ProjectID, project.Name, project.Description, project.CreatedBy, project.UpdatedBy, at, at); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return Project{}, Draft{}, ErrAlreadyExists
		}
		return Project{}, Draft{}, fmt.Errorf("insert project: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO drafts(draft_id,project_id,etag,content_json,content_sha256,updated_by,updated_at_utc_ms) VALUES(?,?,?,?,?,?,?)`,
		draft.DraftID, draft.ProjectID, draft.ETag, draft.ContentJSON, digest[:], draft.UpdatedBy, at); err != nil {
		return Project{}, Draft{}, fmt.Errorf("insert draft: %w", err)
	}
	details, _ := json.Marshal(map[string]any{"draftId": draft.DraftID, "etag": draft.ETag})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: params.ActorID,
		Role: params.Role, Action: "PROJECT_CREATE", TargetType: "PROJECT", TargetID: params.ProjectID,
		OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: params.CorrelationID, DetailsJSON: details}); err != nil {
		return Project{}, Draft{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.ActorID, "PROJECT_CREATE", "", params.IdempotencyKeySHA256, params.RequestSHA256,
		mutationReceiptResult{ProjectID: project.ProjectID, DraftID: draft.DraftID, ETag: draft.ETag, AuditID: params.AuditID}, at); err != nil {
		return Project{}, Draft{}, err
	}
	if err := tx.Commit(); err != nil {
		return Project{}, Draft{}, fmt.Errorf("commit CreateProject: %w", err)
	}
	project.AuditID = params.AuditID
	draft.AuditID = params.AuditID
	return project, draft, nil
}

func (s *Store) SaveDraft(ctx context.Context, params SaveDraftParams) (Draft, error) {
	if err := validateUUIDs(params.DraftID, params.AuditID); err != nil {
		return Draft{}, err
	}
	if params.ExpectedETag < 1 {
		return Draft{}, fmt.Errorf("expected ETag phải >=1")
	}
	if err := validateActorAudit(params.ActorID, params.Role, params.CorrelationID, params.At.UnixMilli()); err != nil {
		return Draft{}, err
	}
	if err := validateMutationIdentity(params.IdempotencyKeySHA256, params.RequestSHA256); err != nil {
		return Draft{}, err
	}
	content, err := canonicalJSONObject(params.ContentJSON, maxDraftBytes)
	if err != nil {
		return Draft{}, err
	}
	digest := sha256.Sum256(content)
	at := params.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Draft{}, err
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.ActorID, "DRAFT_SAVE", params.DraftID, params.IdempotencyKeySHA256, params.RequestSHA256, at)
	if err != nil {
		return Draft{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return Draft{}, err
		}
		return Draft{DraftID: receipt.DraftID, ProjectID: receipt.ProjectID, ETag: receipt.ETag, AuditID: receipt.AuditID, Replay: true}, nil
	}
	var projectID string
	var baseRevision sql.NullString
	var actualETag int64
	if err := tx.QueryRowContext(ctx, `SELECT project_id,base_revision_id,etag FROM drafts WHERE draft_id=?`, params.DraftID).
		Scan(&projectID, &baseRevision, &actualETag); errors.Is(err, sql.ErrNoRows) {
		return Draft{}, ErrNotFound
	} else if err != nil {
		return Draft{}, err
	}
	if actualETag != params.ExpectedETag {
		return Draft{}, ErrETagConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE drafts SET content_json=?,content_sha256=?,etag=etag+1,updated_by=?,updated_at_utc_ms=? WHERE draft_id=? AND etag=?`,
		content, digest[:], params.ActorID, at, params.DraftID, params.ExpectedETag)
	if err != nil {
		return Draft{}, fmt.Errorf("update Draft: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return Draft{}, err
	}
	if rows != 1 {
		return Draft{}, ErrETagConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE projects SET updated_by=?,updated_at_utc_ms=? WHERE project_id=?`, params.ActorID, at, projectID); err != nil {
		return Draft{}, fmt.Errorf("update Project timestamp: %w", err)
	}
	details, _ := json.Marshal(map[string]any{"fromEtag": params.ExpectedETag, "toEtag": params.ExpectedETag + 1})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: params.ActorID,
		Role: params.Role, Action: "DRAFT_SAVE", TargetType: "DRAFT", TargetID: params.DraftID,
		OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: params.CorrelationID, DetailsJSON: details}); err != nil {
		return Draft{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.ActorID, "DRAFT_SAVE", params.DraftID, params.IdempotencyKeySHA256, params.RequestSHA256,
		mutationReceiptResult{ProjectID: projectID, DraftID: params.DraftID, ETag: params.ExpectedETag + 1, AuditID: params.AuditID}, at); err != nil {
		return Draft{}, err
	}
	if err := tx.Commit(); err != nil {
		return Draft{}, err
	}
	draft := Draft{DraftID: params.DraftID, ProjectID: projectID, ETag: params.ExpectedETag + 1,
		ContentJSON: content, ContentSHA256: digest, UpdatedBy: params.ActorID, UpdatedAtUTCMS: at, AuditID: params.AuditID}
	if baseRevision.Valid {
		draft.BaseRevisionID = baseRevision.String
	}
	return draft, nil
}

func (s *Store) GetDraft(ctx context.Context, draftID string) (Draft, error) {
	if err := validateUUIDs(draftID); err != nil {
		return Draft{}, err
	}
	var draft Draft
	var base sql.NullString
	var digest []byte
	err := s.db.QueryRowContext(ctx, `SELECT draft_id,project_id,base_revision_id,etag,content_json,content_sha256,updated_by,updated_at_utc_ms FROM drafts WHERE draft_id=?`, draftID).
		Scan(&draft.DraftID, &draft.ProjectID, &base, &draft.ETag, &draft.ContentJSON, &digest, &draft.UpdatedBy, &draft.UpdatedAtUTCMS)
	if errors.Is(err, sql.ErrNoRows) {
		return Draft{}, ErrNotFound
	}
	if err != nil {
		return Draft{}, err
	}
	if len(digest) != sha256.Size {
		return Draft{}, fmt.Errorf("Draft checksum hỏng")
	}
	copy(draft.ContentSHA256[:], digest)
	if base.Valid {
		draft.BaseRevisionID = base.String
	}
	if got := sha256.Sum256(draft.ContentJSON); got != draft.ContentSHA256 {
		return Draft{}, fmt.Errorf("Draft content checksum mismatch")
	}
	return draft, nil
}

func (s *Store) CreateRevision(ctx context.Context, params CreateRevisionParams) (Revision, error) {
	if err := validateUUIDs(params.RevisionID, params.ProjectID, params.DraftID, params.AuditID); err != nil {
		return Revision{}, err
	}
	if params.ParentRevisionID != "" {
		if err := validateUUIDs(params.ParentRevisionID); err != nil {
			return Revision{}, err
		}
	}
	if params.ExpectedDraftETag < 1 || len(params.Objects) == 0 {
		return Revision{}, fmt.Errorf("Draft ETag và ít nhất một Revision object là bắt buộc")
	}
	if err := validateActorAudit(params.ActorID, params.Role, params.CorrelationID, params.At.UnixMilli()); err != nil {
		return Revision{}, err
	}
	if err := validateMutationIdentity(params.IdempotencyKeySHA256, params.RequestSHA256); err != nil {
		return Revision{}, err
	}
	manifest, err := canonicalJSONObject(params.ManifestJSON, maxManifestBytes)
	if err != nil {
		return Revision{}, err
	}
	manifestDigest := sha256.Sum256(manifest)
	type preparedObject struct {
		id, kind string
		payload  []byte
		digest   [sha256.Size]byte
	}
	prepared := make([]preparedObject, 0, len(params.Objects))
	seen := make(map[string]struct{}, len(params.Objects))
	for _, object := range params.Objects {
		if err := validateUUIDs(object.ObjectID); err != nil {
			return Revision{}, err
		}
		if _, duplicate := seen[object.ObjectID]; duplicate {
			return Revision{}, fmt.Errorf("Revision object ID trùng: %s", object.ObjectID)
		}
		seen[object.ObjectID] = struct{}{}
		if !validObjectKind(object.Kind) {
			return Revision{}, fmt.Errorf("Revision object kind không hợp lệ: %s", object.Kind)
		}
		payload, err := canonicalJSONObject(object.PayloadJSON, maxObjectBytes)
		if err != nil {
			return Revision{}, err
		}
		prepared = append(prepared, preparedObject{id: object.ObjectID, kind: object.Kind, payload: payload, digest: sha256.Sum256(payload)})
	}
	documentSchemaVersion := params.DocumentSchemaVersion
	if documentSchemaVersion == 0 {
		documentSchemaVersion = 1
	}
	programCount := params.ProgramCount
	if programCount == 0 {
		programCount = 1
	}
	if documentSchemaVersion != 1 && documentSchemaVersion != 2 {
		return Revision{}, fmt.Errorf("documentSchemaVersion phải là 1 hoặc 2")
	}
	if programCount < 1 || programCount > 32 {
		return Revision{}, fmt.Errorf("programCount phải trong khoảng 1..32")
	}
	if documentSchemaVersion == 1 && (params.LibraryRevisionID != "" || len(params.POUObjects) != 0 || programCount != 1) {
		return Revision{}, fmt.Errorf("Revision document v1 không được mang POU/library v2")
	}
	if params.LibraryRevisionID != "" {
		if err := validateUUIDs(params.LibraryRevisionID); err != nil {
			return Revision{}, err
		}
	}
	preparedPOUs, err := prepareRevisionPOUObjects(params.POUObjects)
	if err != nil {
		return Revision{}, err
	}
	for _, pou := range preparedPOUs {
		if _, exists := seen[pou.objectID]; !exists {
			return Revision{}, fmt.Errorf("POU %s không có Revision object tương ứng", pou.objectID)
		}
	}
	at := params.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Revision{}, err
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.ActorID, "REVISION_CREATE", params.ProjectID, params.IdempotencyKeySHA256, params.RequestSHA256, at)
	if err != nil {
		return Revision{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return Revision{}, err
		}
		return Revision{RevisionID: receipt.RevisionID, ProjectID: receipt.ProjectID, DraftETag: receipt.ETag, AuditID: receipt.AuditID, Replay: true}, nil
	}
	var draftProject string
	var actualETag int64
	if err := tx.QueryRowContext(ctx, `SELECT project_id,etag FROM drafts WHERE draft_id=?`, params.DraftID).Scan(&draftProject, &actualETag); errors.Is(err, sql.ErrNoRows) {
		return Revision{}, ErrNotFound
	} else if err != nil {
		return Revision{}, err
	}
	if draftProject != params.ProjectID || actualETag != params.ExpectedDraftETag {
		return Revision{}, ErrETagConflict
	}
	if params.ParentRevisionID != "" {
		var parentProject string
		if err := tx.QueryRowContext(ctx, `SELECT project_id FROM revisions WHERE revision_id=?`, params.ParentRevisionID).Scan(&parentProject); errors.Is(err, sql.ErrNoRows) {
			return Revision{}, ErrNotFound
		} else if err != nil {
			return Revision{}, err
		}
		if parentProject != params.ProjectID {
			return Revision{}, fmt.Errorf("parent Revision khác Project")
		}
	}
	var sequence int64
	if err := tx.QueryRowContext(ctx, `SELECT coalesce(max(sequence),0)+1 FROM revisions WHERE project_id=?`, params.ProjectID).Scan(&sequence); err != nil {
		return Revision{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO revisions(revision_id,project_id,parent_revision_id,sequence,schema_version,target_profile,
		manifest_json,manifest_sha256,created_by,created_at_utc_ms,document_schema_version,program_count,library_revision_id)
		VALUES(?,?,?,?,1,'MKDDC24_REVA',?,?,?,?,?,?,?)`,
		params.RevisionID, params.ProjectID, nullableString(params.ParentRevisionID), sequence, manifest, manifestDigest[:],
		params.ActorID, at, documentSchemaVersion, programCount, nullableString(params.LibraryRevisionID)); err != nil {
		return Revision{}, fmt.Errorf("insert Revision: %w", err)
	}
	for _, object := range prepared {
		if _, err := tx.ExecContext(ctx, `INSERT INTO revision_objects(revision_id,object_id,kind,payload_json,payload_sha256) VALUES(?,?,?,?,?)`,
			params.RevisionID, object.id, object.kind, object.payload, object.digest[:]); err != nil {
			return Revision{}, fmt.Errorf("insert Revision object: %w", err)
		}
	}
	if err := insertRevisionLibrarySnapshotTx(ctx, tx, params.RevisionID, params.ProjectID,
		params.LibraryRevisionID, preparedPOUs); err != nil {
		return Revision{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE drafts SET base_revision_id=?,etag=etag+1,updated_by=?,updated_at_utc_ms=? WHERE draft_id=? AND etag=?`,
		params.RevisionID, params.ActorID, at, params.DraftID, params.ExpectedDraftETag)
	if err != nil {
		return Revision{}, fmt.Errorf("advance Draft sau khi seal Revision: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		if rowsErr != nil {
			return Revision{}, rowsErr
		}
		return Revision{}, ErrETagConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE projects SET updated_by=?,updated_at_utc_ms=? WHERE project_id=?`, params.ActorID, at, params.ProjectID); err != nil {
		return Revision{}, fmt.Errorf("update Project sau khi seal Revision: %w", err)
	}
	draftETag := params.ExpectedDraftETag + 1
	details, _ := json.Marshal(map[string]any{"sequence": sequence, "objectCount": len(prepared),
		"pouCount": len(preparedPOUs), "libraryUsageCount": countPreparedPOUDependencies(preparedPOUs), "draftEtag": draftETag})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: params.ActorID,
		Role: params.Role, Action: "REVISION_CREATE", TargetType: "REVISION", TargetID: params.RevisionID,
		RevisionID: params.RevisionID, OccurredAtUTCMS: at, ResultCode: "OK",
		CorrelationID: params.CorrelationID, DetailsJSON: details}); err != nil {
		return Revision{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.ActorID, "REVISION_CREATE", params.ProjectID, params.IdempotencyKeySHA256, params.RequestSHA256,
		mutationReceiptResult{ProjectID: params.ProjectID, DraftID: params.DraftID, RevisionID: params.RevisionID, ETag: draftETag, AuditID: params.AuditID}, at); err != nil {
		return Revision{}, err
	}
	if err := tx.Commit(); err != nil {
		return Revision{}, err
	}
	return Revision{RevisionID: params.RevisionID, ProjectID: params.ProjectID,
		ParentRevisionID: params.ParentRevisionID, Sequence: sequence,
		DocumentSchemaVersion: documentSchemaVersion, ProgramCount: programCount, LibraryRevisionID: params.LibraryRevisionID,
		ManifestJSON:   manifest,
		ManifestSHA256: manifestDigest, CreatedBy: params.ActorID, CreatedAtUTCMS: at,
		DraftETag: draftETag, AuditID: params.AuditID}, nil
}

func (s *Store) BeginOperation(ctx context.Context, params BeginOperationParams) (Operation, error) {
	if err := validateUUIDs(params.OperationID, params.RequestedRevisionID, params.AuditID); err != nil {
		return Operation{}, err
	}
	if params.ExpectedActiveRevisionID != "" {
		if err := validateUUIDs(params.ExpectedActiveRevisionID); err != nil {
			return Operation{}, err
		}
	}
	if !validOperationKind(params.Kind) || allZero(params.IdempotencyKeySHA256[:]) {
		return Operation{}, fmt.Errorf("operation kind hoặc idempotency hash không hợp lệ")
	}
	if err := validateText("controllerId", params.ControllerID, 1, 128); err != nil {
		return Operation{}, err
	}
	if err := validateActorAudit(params.ActorID, params.Role, params.CorrelationID, params.At.UnixMilli()); err != nil {
		return Operation{}, err
	}
	contextInput := params.ContextJSON
	if len(contextInput) == 0 {
		contextInput = []byte(`{}`)
	}
	contextJSON, err := canonicalJSONObject(contextInput, 1<<20)
	if err != nil {
		return Operation{}, fmt.Errorf("operation context: %w", err)
	}
	contextDigest := sha256.Sum256(contextJSON)
	requestDigest := params.RequestSHA256
	if requestDigest == ([32]byte{}) {
		requestJSON, _ := json.Marshal(map[string]any{"kind": params.Kind, "controllerId": params.ControllerID,
			"requestedRevisionId": params.RequestedRevisionID, "expectedActiveRevisionId": params.ExpectedActiveRevisionID})
		requestDigest = sha256.Sum256(requestJSON)
	}
	at := params.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Operation{}, err
	}
	defer tx.Rollback()
	existing, found, err := getOperationByIdempotencyTx(ctx, tx, params.ActorID, params.Kind, params.ControllerID, params.IdempotencyKeySHA256[:])
	if err != nil {
		return Operation{}, err
	}
	if found {
		var existingDigest []byte
		if err := tx.QueryRowContext(ctx, `SELECT request_sha256 FROM operations WHERE operation_id=?`, existing.OperationID).Scan(&existingDigest); err != nil {
			return Operation{}, err
		}
		if !equalDigest(existingDigest, requestDigest) {
			return Operation{}, ErrIdempotencyConflict
		}
		existing.Replay = true
		if err := tx.Commit(); err != nil {
			return Operation{}, err
		}
		return existing, nil
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO operations(operation_id,kind,state,step,controller_id,requested_revision_id,expected_active_revision_id,idempotency_key_sha256,request_sha256,correlation_id,actor_id,created_at_utc_ms,updated_at_utc_ms,operation_context_json,operation_context_sha256) VALUES(?,?,'PENDING','PENDING',?,?,?,?,?,?,?,?,?,?,?)`,
		params.OperationID, params.Kind, params.ControllerID, params.RequestedRevisionID,
		nullableString(params.ExpectedActiveRevisionID), params.IdempotencyKeySHA256[:], requestDigest[:],
		params.CorrelationID, params.ActorID, at, at, contextJSON, contextDigest[:]); err != nil {
		return Operation{}, fmt.Errorf("insert Operation: %w", err)
	}
	details, _ := json.Marshal(map[string]any{"kind": params.Kind, "controllerId": params.ControllerID})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: params.ActorID,
		Role: params.Role, Action: "OPERATION_BEGIN", TargetType: "OPERATION", TargetID: params.OperationID,
		RevisionID: params.RequestedRevisionID, OperationID: params.OperationID, OccurredAtUTCMS: at,
		ResultCode: "PENDING", CorrelationID: params.CorrelationID, DetailsJSON: details}); err != nil {
		return Operation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Operation{}, err
	}
	return Operation{OperationID: params.OperationID, Kind: params.Kind, State: "PENDING", Step: "PENDING",
		ControllerID: params.ControllerID, RequestedRevisionID: params.RequestedRevisionID,
		ExpectedActiveRevisionID: params.ExpectedActiveRevisionID, CorrelationID: params.CorrelationID,
		ActorID: params.ActorID, CreatedAtUTCMS: at, UpdatedAtUTCMS: at,
		ContextJSON: contextJSON}, nil
}

func getOperationByIdempotencyTx(ctx context.Context, tx *sql.Tx, actorID, kind, controllerID string, key []byte) (Operation, bool, error) {
	var operation Operation
	var expected sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT operation_id,kind,state,step,controller_id,requested_revision_id,expected_active_revision_id,correlation_id,actor_id,created_at_utc_ms,updated_at_utc_ms FROM operations WHERE actor_id=? AND kind=? AND controller_id=? AND idempotency_key_sha256=?`,
		actorID, kind, controllerID, key).Scan(&operation.OperationID, &operation.Kind, &operation.State,
		&operation.Step, &operation.ControllerID, &operation.RequestedRevisionID, &expected,
		&operation.CorrelationID, &operation.ActorID, &operation.CreatedAtUTCMS, &operation.UpdatedAtUTCMS)
	if errors.Is(err, sql.ErrNoRows) {
		return Operation{}, false, nil
	}
	if err != nil {
		return Operation{}, false, err
	}
	if expected.Valid {
		operation.ExpectedActiveRevisionID = expected.String
	}
	return operation, true, nil
}

func validateUUIDs(values ...string) error {
	for _, value := range values {
		if !uuidPattern.MatchString(value) {
			return fmt.Errorf("UUID v4 lowercase không hợp lệ: %s", value)
		}
	}
	return nil
}

func validateText(field, value string, minimum, maximum int) error {
	if !utf8.ValidString(value) || strings.IndexFunc(value, func(candidate rune) bool {
		return candidate < 0x20 || candidate == 0x7f
	}) >= 0 {
		return fmt.Errorf("%s không phải text public hợp lệ", field)
	}
	length := utf8.RuneCountInString(value)
	if length < minimum || length > maximum {
		return fmt.Errorf("%s dài %d, cần %d..%d", field, length, minimum, maximum)
	}
	return nil
}

func validateActorAudit(actorID, role, correlationID string, at int64) error {
	if err := validateText("actorId", actorID, 1, 128); err != nil {
		return err
	}
	if err := validateText("role", role, 1, 32); err != nil {
		return err
	}
	if !correlationPattern.MatchString(correlationID) || at < 0 {
		return fmt.Errorf("correlationId hoặc timestamp không hợp lệ")
	}
	return nil
}

func validObjectKind(value string) bool {
	switch value {
	case "PROGRAM", "FUNCTION", "FUNCTION_BLOCK", "VARIABLE", "BINDING", "TASK", "METADATA":
		return true
	default:
		return false
	}
}

func validOperationKind(value string) bool {
	switch value {
	case "COMMISSION", "RESTORE", "IMPORT", "RESET_RETAIN":
		return true
	default:
		return false
	}
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func allZero(value []byte) bool {
	for _, item := range value {
		if item != 0 {
			return false
		}
	}
	return true
}

func equalDigest(value []byte, expected [sha256.Size]byte) bool {
	if len(value) != sha256.Size {
		return false
	}
	for index := range expected {
		if value[index] != expected[index] {
			return false
		}
	}
	return true
}
