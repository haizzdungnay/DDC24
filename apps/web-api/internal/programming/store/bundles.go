package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"mkddc-web/internal/programming/domain"
)

// ImportProject tạo đúng một Project và một Draft từ bundle đã được lớp
// application kiểm chứng. Không có Revision, Check, Artifact hay Active state
// nào được tạo trong transaction này.
func (s *Store) ImportProject(ctx context.Context, params ImportProjectParams) (Project, Draft, error) {
	if err := validateUUIDs(params.ProjectID, params.DraftID, params.SourceProjectID, params.SourceRevisionID, params.AuditID); err != nil {
		return Project{}, Draft{}, err
	}
	if err := validateText("name", params.Name, 1, 128); err != nil {
		return Project{}, Draft{}, err
	}
	if err := validateText("description", params.Description, 0, 2048); err != nil {
		return Project{}, Draft{}, err
	}
	if len(params.BundleSHA256) != sha256.Size*2 {
		return Project{}, Draft{}, fmt.Errorf("bundle SHA-256 không hợp lệ")
	}
	if _, err := hex.DecodeString(params.BundleSHA256); err != nil || strings.ToLower(params.BundleSHA256) != params.BundleSHA256 {
		return Project{}, Draft{}, fmt.Errorf("bundle SHA-256 không hợp lệ")
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, Draft{}, fmt.Errorf("begin ImportProject: %w", err)
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.ActorID, "BUNDLE_IMPORT", "", params.IdempotencyKeySHA256, params.RequestSHA256, at)
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
		params.ProjectID, params.Name, params.Description, params.ActorID, params.ActorID, at, at); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return Project{}, Draft{}, ErrAlreadyExists
		}
		return Project{}, Draft{}, fmt.Errorf("insert imported Project: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO drafts(draft_id,project_id,etag,content_json,content_sha256,updated_by,updated_at_utc_ms) VALUES(?,?,?,?,?,?,?)`,
		params.DraftID, params.ProjectID, 1, content, digest[:], params.ActorID, at); err != nil {
		return Project{}, Draft{}, fmt.Errorf("insert imported Draft: %w", err)
	}
	// PROJECT Library đi CÙNG transaction với Project/Draft. Tách ra hai lần ghi
	// sẽ để lại một Project không có library sau một lần crash — và người dùng
	// không có cách nào biết bản import đó thiếu gì.
	if err := importProjectLibraryTx(ctx, tx, params, at); err != nil {
		return Project{}, Draft{}, err
	}
	details, _ := json.Marshal(map[string]any{"bundleSha256": params.BundleSHA256, "byteSize": len(content),
		"draftId": params.DraftID, "sourceProjectId": params.SourceProjectID, "sourceRevisionId": params.SourceRevisionID,
		"libraryEntryCount": len(params.LibraryEntries)})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: params.ActorID,
		Role: params.Role, Action: "BUNDLE_IMPORT", TargetType: "PROJECT", TargetID: params.ProjectID,
		OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: params.CorrelationID, DetailsJSON: details}); err != nil {
		return Project{}, Draft{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.ActorID, "BUNDLE_IMPORT", "", params.IdempotencyKeySHA256, params.RequestSHA256,
		mutationReceiptResult{ProjectID: params.ProjectID, DraftID: params.DraftID, RevisionID: params.SourceRevisionID, ETag: 1, AuditID: params.AuditID}, at); err != nil {
		return Project{}, Draft{}, err
	}
	if err := tx.Commit(); err != nil {
		return Project{}, Draft{}, fmt.Errorf("commit ImportProject: %w", err)
	}
	project := Project{ProjectID: params.ProjectID, Name: params.Name, Description: params.Description,
		CreatedBy: params.ActorID, UpdatedBy: params.ActorID, CreatedAtUTCMS: at, UpdatedAtUTCMS: at, AuditID: params.AuditID}
	draft := Draft{DraftID: params.DraftID, ProjectID: params.ProjectID, ETag: 1, ContentJSON: content,
		ContentSHA256: digest, UpdatedBy: params.ActorID, UpdatedAtUTCMS: at, AuditID: params.AuditID}
	return project, draft, nil
}

// RecordBundleExport ghi audit và biên nhận idempotency trong cùng transaction.
// Nội dung source không bao giờ đi vào audit; chỉ hash, kích thước và Revision ID.
func (s *Store) RecordBundleExport(ctx context.Context, params RecordBundleExportParams) (MutationReplay, error) {
	if err := validateUUIDs(params.AuditID); err != nil {
		return MutationReplay{}, err
	}
	if len(params.RevisionIDs) == 0 || params.ByteSize < 1 || len(params.BundleSHA256) != sha256.Size*2 {
		return MutationReplay{}, fmt.Errorf("metadata bundle export không hợp lệ")
	}
	for _, revisionID := range params.RevisionIDs {
		if err := validateUUIDs(revisionID); err != nil {
			return MutationReplay{}, err
		}
	}
	if _, err := hex.DecodeString(params.BundleSHA256); err != nil || strings.ToLower(params.BundleSHA256) != params.BundleSHA256 {
		return MutationReplay{}, fmt.Errorf("bundle SHA-256 không hợp lệ")
	}
	if err := validateActorAudit(params.ActorID, params.Role, params.CorrelationID, params.At.UnixMilli()); err != nil {
		return MutationReplay{}, err
	}
	if err := validateMutationIdentity(params.IdempotencyKeySHA256, params.RequestSHA256); err != nil {
		return MutationReplay{}, err
	}
	at := params.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationReplay{}, err
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.ActorID, "BUNDLE_EXPORT", "", params.IdempotencyKeySHA256, params.RequestSHA256, at)
	if err != nil {
		return MutationReplay{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return MutationReplay{}, err
		}
		return MutationReplay{RevisionID: receipt.RevisionID, ETag: receipt.ETag, AuditID: receipt.AuditID}, nil
	}
	details, _ := json.Marshal(map[string]any{"bundleSha256": params.BundleSHA256, "byteSize": params.ByteSize, "revisionIds": params.RevisionIDs})
	selected := params.RevisionIDs[len(params.RevisionIDs)-1]
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.AuditID, ActorID: params.ActorID,
		Role: params.Role, Action: "BUNDLE_EXPORT", TargetType: "BUNDLE", TargetID: params.BundleSHA256,
		RevisionID: selected, OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: params.CorrelationID, DetailsJSON: details}); err != nil {
		return MutationReplay{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.ActorID, "BUNDLE_EXPORT", "", params.IdempotencyKeySHA256, params.RequestSHA256,
		mutationReceiptResult{RevisionID: selected, ETag: 1, AuditID: params.AuditID}, at); err != nil {
		return MutationReplay{}, err
	}
	if err := tx.Commit(); err != nil {
		return MutationReplay{}, err
	}
	return MutationReplay{RevisionID: selected, ETag: 1, AuditID: params.AuditID}, nil
}

// importProjectLibraryTx dựng lại PROJECT Library ở trạng thái DRAFT, không phải
// PUBLISHED. Bundle là NGUỒN, không phải bằng chứng đã publish: publish lại là
// quyết định của người nhận, và chỉ Publish thật mới dựng manifest canonical
// trong transaction của nó.
func importProjectLibraryTx(ctx context.Context, tx *sql.Tx, params ImportProjectParams, at int64) error {
	if params.LibraryRevisionID == "" {
		if len(params.LibraryEntries) != 0 {
			return fmt.Errorf("bundle có entry library nhưng thiếu libraryRevisionId")
		}
		return nil
	}
	if err := validateUUIDs(params.LibraryRevisionID); err != nil {
		return err
	}
	if err := domain.ValidateProjectLibraryVersion(params.LibraryVersion); err != nil {
		return err
	}
	if len(params.LibraryEntries) == 0 {
		return fmt.Errorf("PROJECT library import không có entry")
	}
	manifest, digest, err := buildLibraryManifest(params.LibraryRevisionID, params.ProjectID, params.LibraryVersion, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO library_revisions(
		library_revision_id,project_id,scope,version,parent_library_revision_id,state,
		manifest_json,manifest_sha256,created_by,created_at_utc_ms)
		VALUES(?,?,'PROJECT',?,NULL,'DRAFT',?,?,?,?)`, params.LibraryRevisionID, params.ProjectID,
		params.LibraryVersion, manifest, digest[:], params.ActorID, at); err != nil {
		return fmt.Errorf("insert imported PROJECT library: %w", err)
	}
	for _, input := range params.LibraryEntries {
		entry, err := prepareProjectLibraryEntry(UpsertProjectLibraryEntryParams{
			LibraryRevisionID: params.LibraryRevisionID, EntryID: input.EntryID, Kind: input.Kind,
			Name: input.Name, Language: input.Language, FeatureState: input.FeatureState,
			Source: input.Source, InterfaceJSON: input.InterfaceJSON, Dependencies: input.Dependencies,
			StateLayout: input.StateLayout,
		}, false)
		if err != nil {
			return err
		}
		if err := insertLibraryEntryTx(ctx, tx, entry); err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint failed") ||
				strings.Contains(err.Error(), "library_entries_name_idx") {
				return ErrAlreadyExists
			}
			return fmt.Errorf("insert imported library entry: %w", err)
		}
	}
	return refreshLibraryManifestTx(ctx, tx, params.LibraryRevisionID)
}
