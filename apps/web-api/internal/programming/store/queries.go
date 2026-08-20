package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
)

func (s *Store) GetProject(ctx context.Context, projectID string) (ProjectSnapshot, error) {
	if err := validateUUIDs(projectID); err != nil {
		return ProjectSnapshot{}, err
	}
	row := s.db.QueryRowContext(ctx, `SELECT p.project_id,p.name,p.description,p.archived,p.created_by,p.updated_by,p.created_at_utc_ms,p.updated_at_utc_ms,
		d.draft_id,d.project_id,d.base_revision_id,d.etag,d.content_json,d.content_sha256,d.updated_by,d.updated_at_utc_ms
		FROM projects p JOIN drafts d ON d.project_id=p.project_id WHERE p.project_id=? AND p.archived=0`, projectID)
	return scanProjectSnapshot(row)
}

func (s *Store) ListProjects(ctx context.Context, afterUpdatedAt int64, afterProjectID string, limit int) ([]ProjectSnapshot, error) {
	if limit < 1 || limit > 101 || afterUpdatedAt < 0 {
		return nil, fmt.Errorf("cursor/limit Project không hợp lệ")
	}
	if afterProjectID != "" {
		if err := validateUUIDs(afterProjectID); err != nil {
			return nil, err
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT p.project_id,p.name,p.description,p.archived,p.created_by,p.updated_by,p.created_at_utc_ms,p.updated_at_utc_ms,
		d.draft_id,d.project_id,d.base_revision_id,d.etag,d.content_json,d.content_sha256,d.updated_by,d.updated_at_utc_ms
		FROM projects p JOIN drafts d ON d.project_id=p.project_id
		WHERE p.archived=0 AND (?='' OR p.updated_at_utc_ms<? OR (p.updated_at_utc_ms=? AND p.project_id>?))
		ORDER BY p.updated_at_utc_ms DESC,p.project_id ASC LIMIT ?`, afterProjectID, afterUpdatedAt, afterUpdatedAt, afterProjectID, limit)
	if err != nil {
		return nil, fmt.Errorf("liệt kê Project: %w", err)
	}
	defer rows.Close()
	items := make([]ProjectSnapshot, 0, limit)
	for rows.Next() {
		item, err := scanProjectSnapshot(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("đọc trang Project: %w", err)
	}
	return items, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanProjectSnapshot(row rowScanner) (ProjectSnapshot, error) {
	var snapshot ProjectSnapshot
	var archived int
	var base sql.NullString
	var digest []byte
	err := row.Scan(&snapshot.Project.ProjectID, &snapshot.Project.Name, &snapshot.Project.Description, &archived,
		&snapshot.Project.CreatedBy, &snapshot.Project.UpdatedBy, &snapshot.Project.CreatedAtUTCMS, &snapshot.Project.UpdatedAtUTCMS,
		&snapshot.Draft.DraftID, &snapshot.Draft.ProjectID, &base, &snapshot.Draft.ETag, &snapshot.Draft.ContentJSON,
		&digest, &snapshot.Draft.UpdatedBy, &snapshot.Draft.UpdatedAtUTCMS)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectSnapshot{}, ErrNotFound
	}
	if err != nil {
		return ProjectSnapshot{}, fmt.Errorf("đọc Project aggregate: %w", err)
	}
	snapshot.Project.Archived = archived == 1
	if base.Valid {
		snapshot.Draft.BaseRevisionID = base.String
	}
	if len(digest) != sha256.Size {
		return ProjectSnapshot{}, fmt.Errorf("Draft checksum hỏng")
	}
	copy(snapshot.Draft.ContentSHA256[:], digest)
	if got := sha256.Sum256(snapshot.Draft.ContentJSON); got != snapshot.Draft.ContentSHA256 {
		return ProjectSnapshot{}, fmt.Errorf("Draft content checksum mismatch")
	}
	return snapshot, nil
}

func (s *Store) GetRevision(ctx context.Context, revisionID string) (RevisionSnapshot, error) {
	if err := validateUUIDs(revisionID); err != nil {
		return RevisionSnapshot{}, err
	}
	var snapshot RevisionSnapshot
	var parent sql.NullString
	var libraryRevision sql.NullString
	var manifestDigest []byte
	err := s.db.QueryRowContext(ctx, `SELECT revision_id,project_id,parent_revision_id,sequence,
		document_schema_version,program_count,library_revision_id,
		manifest_json,manifest_sha256,created_by,created_at_utc_ms FROM revisions WHERE revision_id=?`, revisionID).
		Scan(&snapshot.Revision.RevisionID, &snapshot.Revision.ProjectID, &parent, &snapshot.Revision.Sequence,
			&snapshot.Revision.DocumentSchemaVersion, &snapshot.Revision.ProgramCount, &libraryRevision,
			&snapshot.Revision.ManifestJSON, &manifestDigest, &snapshot.Revision.CreatedBy, &snapshot.Revision.CreatedAtUTCMS)
	if errors.Is(err, sql.ErrNoRows) {
		return RevisionSnapshot{}, ErrNotFound
	}
	if err != nil {
		return RevisionSnapshot{}, fmt.Errorf("đọc Revision: %w", err)
	}
	if parent.Valid {
		snapshot.Revision.ParentRevisionID = parent.String
	}
	if libraryRevision.Valid {
		snapshot.Revision.LibraryRevisionID = libraryRevision.String
	}
	if len(manifestDigest) != sha256.Size {
		return RevisionSnapshot{}, fmt.Errorf("Revision manifest checksum hỏng")
	}
	copy(snapshot.Revision.ManifestSHA256[:], manifestDigest)
	if got := sha256.Sum256(snapshot.Revision.ManifestJSON); got != snapshot.Revision.ManifestSHA256 {
		return RevisionSnapshot{}, fmt.Errorf("Revision manifest checksum mismatch")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT object_id,kind,payload_json,payload_sha256 FROM revision_objects WHERE revision_id=? ORDER BY kind,object_id`, revisionID)
	if err != nil {
		return RevisionSnapshot{}, fmt.Errorf("đọc Revision objects: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var object RevisionObject
		var digest []byte
		if err := rows.Scan(&object.ObjectID, &object.Kind, &object.PayloadJSON, &digest); err != nil {
			return RevisionSnapshot{}, err
		}
		if len(digest) != sha256.Size {
			return RevisionSnapshot{}, fmt.Errorf("Revision object checksum hỏng")
		}
		copy(object.PayloadSHA256[:], digest)
		if got := sha256.Sum256(object.PayloadJSON); got != object.PayloadSHA256 {
			return RevisionSnapshot{}, fmt.Errorf("Revision object checksum mismatch")
		}
		snapshot.Objects = append(snapshot.Objects, object)
	}
	if err := rows.Err(); err != nil {
		return RevisionSnapshot{}, err
	}
	return snapshot, nil
}
