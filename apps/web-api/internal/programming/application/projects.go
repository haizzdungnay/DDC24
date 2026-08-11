package application

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"

	programmingstore "mkddc-web/internal/programming/store"
)

const (
	actionProjectCreate  = "PROJECT_CREATE"
	actionDraftSave      = "DRAFT_SAVE"
	actionRevisionCreate = "REVISION_CREATE"
	targetProfile        = "MKDDC24_REVA"
)

var (
	ErrInvalidRequest = errors.New("Programming request không hợp lệ")
	ErrInvalidCursor  = errors.New("Programming cursor không hợp lệ")
)

type Actor struct {
	ID   string
	Role string
}

type MutationResult struct {
	Resource map[string]any
	ETag     string
	AuditID  string
	Replay   bool
}

type ProjectView struct {
	ProjectID        string
	Name             string
	ETag             string
	ActiveRevisionID *string
	DraftRevisionID  string
	UpdatedAt        string
}

type ProjectPage struct {
	Items      []ProjectView
	NextCursor *string
}

type RevisionView struct {
	RevisionID  string
	ProjectID   string
	State       string
	ContentHash string
	CreatedAt   string
	Snapshot    map[string]any
}

type CreateProjectCommand struct {
	SchemaVersion  string
	Name           string
	Description    string
	IdempotencyKey string
	CorrelationID  string
}

type SaveDraftCommand struct {
	ProjectID      string
	SchemaVersion  string
	BaseRevisionID string
	Operations     []json.RawMessage
	IfMatch        string
	IdempotencyKey string
	CorrelationID  string
}

type SealRevisionCommand struct {
	ProjectID      string
	SchemaVersion  string
	BaseRevisionID string
	Label          string
	Comment        string
	IfMatch        string
	IdempotencyKey string
	CorrelationID  string
}

type ProjectService struct {
	store        *programmingstore.Store
	now          func() time.Time
	newID        func() string
	cursorSecret []byte
}

func NewProjectService(store *programmingstore.Store, cursorSecret []byte) (*ProjectService, error) {
	if store == nil || len(cursorSecret) < 16 {
		return nil, fmt.Errorf("Programming store và cursor secret >=16 byte là bắt buộc")
	}
	return &ProjectService{store: store, now: time.Now, newID: uuid.NewString, cursorSecret: append([]byte(nil), cursorSecret...)}, nil
}

func (s *ProjectService) CreateProject(ctx context.Context, actor Actor, command CreateProjectCommand) (MutationResult, error) {
	if command.SchemaVersion != "1.0" || !validText(command.Name, 1, 120) || !validText(command.Description, 0, 1000) {
		return MutationResult{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return MutationResult{}, err
	}
	requestHash, err := semanticHash(map[string]any{"schemaVersion": command.SchemaVersion, "name": command.Name, "description": command.Description})
	if err != nil {
		return MutationResult{}, err
	}
	if replay, found, err := s.store.LookupMutation(ctx, actor.ID, actionProjectCreate, "", keyHash, requestHash); err != nil {
		return MutationResult{}, err
	} else if found {
		return mutationFromReplay(replay), nil
	}
	projectID, draftID, taskID, auditID := s.newID(), s.newID(), s.newID(), s.newID()
	document := map[string]any{
		"schemaVersion": 1,
		"project":       map[string]any{"projectId": projectID, "name": norm.NFC.String(command.Name), "functionalTags": []any{}},
		"programs":      []any{}, "variables": []any{}, "bindings": []any{},
		"task":    map[string]any{"taskId": taskID, "periodMs": 1000, "programOrder": []any{}},
		"library": map[string]any{"profile": "CORE_REVA", "version": "1"},
	}
	content, _ := json.Marshal(document)
	project, draft, err := s.store.CreateProject(ctx, programmingstore.CreateProjectParams{
		ProjectID: projectID, DraftID: draftID, Name: norm.NFC.String(command.Name), Description: norm.NFC.String(command.Description),
		ContentJSON: content, ActorID: actor.ID, Role: actor.Role, AuditID: auditID, CorrelationID: command.CorrelationID,
		At: s.now(), IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	})
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{Resource: map[string]any{"projectId": project.ProjectID, "draftRevisionId": draft.DraftID},
		ETag: FormatDraftETag(draft.DraftID, draft.ETag), AuditID: draft.AuditID, Replay: draft.Replay}, nil
}

func (s *ProjectService) SaveDraft(ctx context.Context, actor Actor, command SaveDraftCommand) (MutationResult, error) {
	if command.SchemaVersion != "1.0" || len(command.Operations) < 1 || len(command.Operations) > 512 || !isUUID(command.ProjectID) || !isUUID(command.BaseRevisionID) {
		return MutationResult{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return MutationResult{}, err
	}
	requestHash, err := semanticHash(map[string]any{"projectId": command.ProjectID, "schemaVersion": command.SchemaVersion,
		"baseRevisionId": command.BaseRevisionID, "operations": command.Operations, "ifMatch": command.IfMatch})
	if err != nil {
		return MutationResult{}, err
	}
	snapshot, err := s.store.GetProject(ctx, command.ProjectID)
	if err != nil {
		return MutationResult{}, err
	}
	if replay, found, err := s.store.LookupMutation(ctx, actor.ID, actionDraftSave, snapshot.Draft.DraftID, keyHash, requestHash); err != nil {
		return MutationResult{}, err
	} else if found {
		return mutationFromReplay(replay), nil
	}
	etag, err := ParseDraftETag(command.IfMatch, snapshot.Draft.DraftID)
	if err != nil {
		return MutationResult{}, err
	}
	expectedBase := snapshot.Draft.BaseRevisionID
	if expectedBase == "" {
		expectedBase = snapshot.Draft.DraftID
	}
	if command.BaseRevisionID != expectedBase {
		return MutationResult{}, programmingstore.ErrETagConflict
	}
	content, err := applyDraftOperations(snapshot.Draft.ContentJSON, command.Operations)
	if err != nil {
		return MutationResult{}, err
	}
	auditID := s.newID()
	draft, err := s.store.SaveDraft(ctx, programmingstore.SaveDraftParams{
		DraftID: snapshot.Draft.DraftID, ExpectedETag: etag, ContentJSON: content,
		ActorID: actor.ID, Role: actor.Role, AuditID: auditID, CorrelationID: command.CorrelationID,
		At: s.now(), IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	})
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{Resource: map[string]any{"projectId": command.ProjectID, "draftRevisionId": draft.DraftID},
		ETag: FormatDraftETag(draft.DraftID, draft.ETag), AuditID: draft.AuditID, Replay: draft.Replay}, nil
}

func (s *ProjectService) SealRevision(ctx context.Context, actor Actor, command SealRevisionCommand) (MutationResult, error) {
	if command.SchemaVersion != "1.0" || !isUUID(command.ProjectID) || !isUUID(command.BaseRevisionID) ||
		!validText(command.Label, 1, 120) || !validText(command.Comment, 0, 2000) {
		return MutationResult{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return MutationResult{}, err
	}
	requestHash, err := semanticHash(map[string]any{"projectId": command.ProjectID, "schemaVersion": command.SchemaVersion,
		"baseRevisionId": command.BaseRevisionID, "label": command.Label, "comment": command.Comment, "ifMatch": command.IfMatch})
	if err != nil {
		return MutationResult{}, err
	}
	if replay, found, err := s.store.LookupMutation(ctx, actor.ID, actionRevisionCreate, command.ProjectID, keyHash, requestHash); err != nil {
		return MutationResult{}, err
	} else if found {
		return mutationFromReplay(replay), nil
	}
	snapshot, err := s.store.GetProject(ctx, command.ProjectID)
	if err != nil {
		return MutationResult{}, err
	}
	etag, err := ParseDraftETag(command.IfMatch, snapshot.Draft.DraftID)
	if err != nil {
		return MutationResult{}, err
	}
	expectedBase := snapshot.Draft.BaseRevisionID
	if expectedBase == "" {
		expectedBase = snapshot.Draft.DraftID
	}
	if command.BaseRevisionID != expectedBase {
		return MutationResult{}, programmingstore.ErrETagConflict
	}
	objects, manifest, err := revisionPayload(snapshot.Draft.ContentJSON, command.ProjectID, command.Label, command.Comment)
	if err != nil {
		return MutationResult{}, err
	}
	revisionID, auditID := s.newID(), s.newID()
	revision, err := s.store.CreateRevision(ctx, programmingstore.CreateRevisionParams{
		RevisionID: revisionID, ProjectID: command.ProjectID, DraftID: snapshot.Draft.DraftID, ExpectedDraftETag: etag,
		ParentRevisionID: snapshot.Draft.BaseRevisionID, ManifestJSON: manifest, Objects: objects,
		ActorID: actor.ID, Role: actor.Role, AuditID: auditID, CorrelationID: command.CorrelationID,
		At: s.now(), IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	})
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{Resource: map[string]any{"projectId": command.ProjectID, "revisionId": revision.RevisionID},
		ETag: FormatDraftETag(snapshot.Draft.DraftID, revision.DraftETag), AuditID: revision.AuditID, Replay: revision.Replay}, nil
}

func (s *ProjectService) GetProject(ctx context.Context, projectID string) (ProjectView, error) {
	if !isUUID(projectID) {
		return ProjectView{}, ErrInvalidRequest
	}
	snapshot, err := s.store.GetProject(ctx, projectID)
	if err != nil {
		return ProjectView{}, err
	}
	return projectView(snapshot), nil
}

func (s *ProjectService) ListProjects(ctx context.Context, encodedCursor string, limit int) (ProjectPage, error) {
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 100 {
		return ProjectPage{}, ErrInvalidRequest
	}
	var afterAt int64
	var afterID string
	if encodedCursor != "" {
		cursor, err := s.decodeCursor(encodedCursor)
		if err != nil {
			return ProjectPage{}, err
		}
		afterAt, afterID = cursor.UpdatedAtUTCMS, cursor.ProjectID
	}
	items, err := s.store.ListProjects(ctx, afterAt, afterID, limit+1)
	if err != nil {
		return ProjectPage{}, err
	}
	page := ProjectPage{Items: make([]ProjectView, 0, min(limit, len(items)))}
	for _, item := range items[:min(limit, len(items))] {
		page.Items = append(page.Items, projectView(item))
	}
	if len(items) > limit {
		last := items[limit-1]
		encoded, err := s.encodeCursor(projectCursor{UpdatedAtUTCMS: last.Project.UpdatedAtUTCMS, ProjectID: last.Project.ProjectID,
			ExpiresAtUTCMS: s.now().UTC().Add(15 * time.Minute).UnixMilli()})
		if err != nil {
			return ProjectPage{}, err
		}
		page.NextCursor = &encoded
	}
	return page, nil
}

func (s *ProjectService) GetRevision(ctx context.Context, revisionID string) (RevisionView, error) {
	if !isUUID(revisionID) {
		return RevisionView{}, ErrInvalidRequest
	}
	snapshot, err := s.store.GetRevision(ctx, revisionID)
	if err != nil {
		return RevisionView{}, err
	}
	var manifest map[string]any
	if err := json.Unmarshal(snapshot.Revision.ManifestJSON, &manifest); err != nil {
		return RevisionView{}, fmt.Errorf("decode Revision manifest: %w", err)
	}
	objects := make([]any, 0, len(snapshot.Objects))
	for _, object := range snapshot.Objects {
		var payload any
		if err := json.Unmarshal(object.PayloadJSON, &payload); err != nil {
			return RevisionView{}, fmt.Errorf("decode Revision object: %w", err)
		}
		objects = append(objects, map[string]any{"objectId": object.ObjectID, "kind": object.Kind,
			"sha256": hex.EncodeToString(object.PayloadSHA256[:]), "payload": payload})
	}
	return RevisionView{RevisionID: snapshot.Revision.RevisionID, ProjectID: snapshot.Revision.ProjectID, State: "IMMUTABLE",
		ContentHash: hex.EncodeToString(snapshot.Revision.ManifestSHA256[:]), CreatedAt: formatTime(snapshot.Revision.CreatedAtUTCMS),
		Snapshot: map[string]any{"manifest": manifest, "objects": objects}}, nil
}

func mutationFromReplay(replay programmingstore.MutationReplay) MutationResult {
	resource := map[string]any{"projectId": replay.ProjectID}
	if replay.DraftID != "" {
		resource["draftRevisionId"] = replay.DraftID
	}
	if replay.RevisionID != "" {
		resource["revisionId"] = replay.RevisionID
	}
	return MutationResult{Resource: resource, ETag: FormatDraftETag(replay.DraftID, replay.ETag), AuditID: replay.AuditID, Replay: true}
}

func projectView(snapshot programmingstore.ProjectSnapshot) ProjectView {
	var active *string
	return ProjectView{ProjectID: snapshot.Project.ProjectID, Name: snapshot.Project.Name,
		ETag: FormatDraftETag(snapshot.Draft.DraftID, snapshot.Draft.ETag), ActiveRevisionID: active,
		DraftRevisionID: snapshot.Draft.DraftID, UpdatedAt: formatTime(snapshot.Project.UpdatedAtUTCMS)}
}

func FormatDraftETag(draftID string, generation int64) string {
	return fmt.Sprintf("\"%s:%d\"", draftID, generation)
}

func ParseDraftETag(value, expectedDraftID string) (int64, error) {
	if len(value) < 3 || !strings.HasPrefix(value, "\"") || !strings.HasSuffix(value, "\"") || strings.HasPrefix(value, "W/") {
		return 0, ErrInvalidRequest
	}
	inner := value[1 : len(value)-1]
	if strings.Contains(inner, "\"") {
		return 0, ErrInvalidRequest
	}
	parts := strings.Split(inner, ":")
	if len(parts) != 2 || parts[0] != expectedDraftID {
		return 0, programmingstore.ErrETagConflict
	}
	generation, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || generation < 1 {
		return 0, ErrInvalidRequest
	}
	return generation, nil
}

type projectCursor struct {
	UpdatedAtUTCMS int64  `json:"updatedAtUtcMs"`
	ProjectID      string `json:"projectId"`
	ExpiresAtUTCMS int64  `json:"expiresAtUtcMs"`
}

func (s *ProjectService) encodeCursor(cursor projectCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *ProjectService) decodeCursor(encoded string) (projectCursor, error) {
	parts := strings.Split(encoded, ".")
	if len(parts) != 2 || len(encoded) > 1024 {
		return projectCursor{}, ErrInvalidCursor
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return projectCursor{}, ErrInvalidCursor
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return projectCursor{}, ErrInvalidCursor
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return projectCursor{}, ErrInvalidCursor
	}
	var cursor projectCursor
	if err := decodeStrict(payload, &cursor); err != nil || !isUUID(cursor.ProjectID) || cursor.UpdatedAtUTCMS < 0 || s.now().UTC().UnixMilli() > cursor.ExpiresAtUTCMS {
		return projectCursor{}, ErrInvalidCursor
	}
	return cursor, nil
}

func idempotencyHash(key string) ([sha256.Size]byte, error) {
	id, err := uuid.Parse(key)
	if err != nil || id.Version() != 4 || id.String() != key {
		return [sha256.Size]byte{}, ErrInvalidRequest
	}
	return sha256.Sum256([]byte(key)), nil
}

func semanticHash(value any) ([sha256.Size]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	return sha256.Sum256(raw), nil
}

func decodeStrict(raw []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return ErrInvalidRequest
	}
	return nil
}

func validText(value string, minimum, maximum int) bool {
	if !utf8.ValidString(value) || norm.NFC.String(value) != value || strings.IndexFunc(value, func(candidate rune) bool {
		return candidate < 0x20 || candidate == 0x7f
	}) >= 0 {
		return false
	}
	length := utf8.RuneCountInString(value)
	return length >= minimum && length <= maximum
}

func isUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.Version() == 4 && id.String() == value
}

func formatTime(milliseconds int64) string {
	return time.UnixMilli(milliseconds).UTC().Format(time.RFC3339Nano)
}
