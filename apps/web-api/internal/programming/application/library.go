package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const (
	actionLibraryEntryUpsert = "LIBRARY_ENTRY_UPSERT"
	actionLibraryEntryDelete = "LIBRARY_ENTRY_DELETE"
)

// LibraryEntryView là hình chiếu public của một entry. Nó KHÔNG mang
// `signatureJSON` nội bộ và không mang manifest revision: hai thứ đó là chi tiết
// lưu trữ, còn hợp đồng public chỉ hứa identity, interface, nguồn và hash.
type LibraryEntryView struct {
	Scope             string
	LibraryRevisionID string
	LibraryVersion    string
	LibraryState      string
	EntryID           string
	Kind              string
	Name              string
	Language          string
	FeatureState      string
	ContentSHA256     string
	InterfaceJSON     []byte
	Dependencies      []LibraryDependencyView
	StateLayoutKnown  bool
	StateSizeBytes    uint32
}

type LibraryDependencyView struct {
	EntryID string `json:"entryId"`
	Version string `json:"version"`
}

type LibraryPage struct {
	Items      []LibraryEntryView
	NextCursor *string
}

type SearchLibrariesCommand struct {
	ProjectID string
	Scope     string
	Kind      string
	Query     string
	Cursor    string
	Limit     int
}

type UpsertLibraryEntryCommand struct {
	ProjectID      string
	SchemaVersion  string
	EntryID        string
	Kind           string
	Name           string
	Language       string
	FeatureState   string
	Source         string
	InterfaceJSON  json.RawMessage
	Dependencies   []LibraryDependencyView
	StateLayout    *LibraryStateLayoutCommand
	IfMatch        string
	IdempotencyKey string
	CorrelationID  string
}

// LibraryStateLayoutCommand chỉ có mặt khi caller thật sự BIẾT layout. Không có
// nó nghĩa là "chưa biết", không phải "bằng 0" — hai thứ này khác nhau và trộn
// chúng sẽ làm lệch mọi offset RETAIN phía sau.
type LibraryStateLayoutCommand struct {
	Version        uint32 `json:"version"`
	StateSizeBytes uint32 `json:"stateSizeBytes"`
	SHA256         string `json:"sha256"`
}

type DeleteLibraryEntryCommand struct {
	ProjectID      string
	EntryID        string
	IfMatch        string
	IdempotencyKey string
	CorrelationID  string
}

type DeprecateLibraryRevisionCommand struct {
	ProjectID         string
	LibraryRevisionID string
	SchemaVersion     string
	IfMatch           string
	IdempotencyKey    string
	CorrelationID     string
}

type LibraryService struct {
	store        *programmingstore.Store
	now          func() time.Time
	newID        func() string
	cursorSecret []byte
}

func NewLibraryService(store *programmingstore.Store, cursorSecret []byte) (*LibraryService, error) {
	if store == nil || len(cursorSecret) < 16 {
		return nil, fmt.Errorf("Programming store và cursor secret >=16 byte là bắt buộc")
	}
	return &LibraryService{store: store, now: time.Now, newID: uuid.NewString,
		cursorSecret: append([]byte(nil), cursorSecret...)}, nil
}

// SearchLibraries trả SYSTEM + PROJECT trong một danh sách đã sắp ổn định. Con
// trỏ được ký HMAC và mang cả bộ lọc: nếu cursor không ràng buộc filter thì một
// trang tiếp theo có thể đổi phạm vi so với trang đầu mà client không hay.
func (s *LibraryService) SearchLibraries(ctx context.Context, command SearchLibrariesCommand) (LibraryPage, error) {
	if command.Limit == 0 {
		command.Limit = 50
	}
	if command.Limit < 1 || command.Limit > 100 {
		return LibraryPage{}, ErrInvalidRequest
	}
	if command.ProjectID != "" && !isUUID(command.ProjectID) {
		return LibraryPage{}, ErrInvalidRequest
	}
	if command.Scope != "" && command.Scope != programmingstore.LibraryScopeSystem && command.Scope != programmingstore.LibraryScopeProject {
		return LibraryPage{}, ErrInvalidRequest
	}
	if command.Kind != "" && command.Kind != programmingstore.LibraryKindFunction &&
		command.Kind != programmingstore.LibraryKindFunctionBlock && command.Kind != programmingstore.LibraryKindConversion {
		return LibraryPage{}, ErrInvalidRequest
	}
	if !validText(command.Query, 0, 64) {
		return LibraryPage{}, ErrInvalidRequest
	}
	var after *programmingstore.LibrarySearchKey
	if command.Cursor != "" {
		cursor, err := s.decodeLibraryCursor(command.Cursor)
		if err != nil {
			return LibraryPage{}, err
		}
		if cursor.Scope != command.Scope || cursor.Kind != command.Kind ||
			cursor.Query != command.Query || cursor.ProjectID != command.ProjectID {
			return LibraryPage{}, ErrInvalidCursor
		}
		after = &programmingstore.LibrarySearchKey{
			NameFolded: cursor.NameFolded, EntryID: cursor.EntryID, LibraryRevisionID: cursor.LibraryRevisionID,
		}
	}
	// Keyset giữ mỗi lần đọc ở đúng limit+1 (tối đa 101), không tăng chi phí
	// theo số trang như OFFSET hoặc tải lại toàn bộ prefix từ đầu.
	entries, err := s.store.SearchLibraryEntries(ctx, programmingstore.LibrarySearchParams{
		ProjectID: command.ProjectID, Query: command.Query, Kind: command.Kind,
		Scope: command.Scope, Limit: command.Limit + 1, After: after,
	})
	if err != nil {
		return LibraryPage{}, err
	}
	page := LibraryPage{Items: make([]LibraryEntryView, 0, min(command.Limit, len(entries)))}
	revisions := make(map[string]programmingstore.LibraryRevision)
	for _, entry := range entries[:min(command.Limit, len(entries))] {
		revision, cached := revisions[entry.LibraryRevisionID]
		if !cached {
			revision, err = s.store.GetLibraryRevision(ctx, entry.LibraryRevisionID)
			if err != nil {
				return LibraryPage{}, err
			}
			revisions[entry.LibraryRevisionID] = revision
		}
		page.Items = append(page.Items, libraryEntryView(entry, revision))
	}
	if len(entries) > command.Limit {
		last := entries[command.Limit-1]
		encoded, err := s.encodeLibraryCursor(libraryCursor{
			NameFolded: strings.ToUpper(last.Name), EntryID: last.EntryID, LibraryRevisionID: last.LibraryRevisionID,
			Scope: command.Scope, Kind: command.Kind,
			Query: command.Query, ProjectID: command.ProjectID,
			ExpiresAtUTCMS: s.now().UTC().Add(15 * time.Minute).UnixMilli(),
		})
		if err != nil {
			return LibraryPage{}, err
		}
		page.NextCursor = &encoded
	}
	return page, nil
}

func (s *LibraryService) UpsertEntry(ctx context.Context, actor Actor, command UpsertLibraryEntryCommand) (MutationResult, error) {
	if command.SchemaVersion != "1.0" || !isUUID(command.ProjectID) || !isUUID(command.EntryID) ||
		!validText(command.Name, 1, 64) || !validLibrarySource(command.Source) {
		return MutationResult{}, ErrInvalidRequest
	}
	if command.Kind != programmingstore.LibraryKindFunction && command.Kind != programmingstore.LibraryKindFunctionBlock {
		return MutationResult{}, ErrInvalidRequest
	}
	if command.Language != "ST" && command.Language != "FBD" {
		return MutationResult{}, ErrInvalidRequest
	}
	featureState := command.FeatureState
	if featureState == "" {
		featureState = "AVAILABLE"
	}
	// `REVIEW_REQUIRED` là cờ Controls/Safety, không phải thứ payload FE tự đặt
	// cho entry người dùng. Nhận nó ở đây sẽ cho phép client tự dán nhãn review
	// lên POU của mình và làm nhoè ý nghĩa của cờ trên registry SYSTEM.
	if featureState != "AVAILABLE" {
		return MutationResult{}, ErrInvalidRequest
	}
	layout, err := libraryStateLayoutFromCommand(command.Kind, command.StateLayout)
	if err != nil {
		return MutationResult{}, err
	}
	dependencies := make([]programmingstore.LibraryDependency, 0, len(command.Dependencies))
	for _, dependency := range command.Dependencies {
		if !isUUID(dependency.EntryID) {
			return MutationResult{}, ErrInvalidRequest
		}
		dependencies = append(dependencies, programmingstore.LibraryDependency{EntryID: dependency.EntryID, Version: dependency.Version})
	}
	identity, err := s.mutationIdentity(actor, command.ProjectID, command.IfMatch, command.IdempotencyKey, command.CorrelationID,
		map[string]any{"projectId": command.ProjectID, "entryId": command.EntryID, "kind": command.Kind,
			"name": command.Name, "language": command.Language, "source": command.Source,
			"interface": string(command.InterfaceJSON), "dependencies": command.Dependencies,
			"stateLayout": command.StateLayout, "ifMatch": command.IfMatch})
	if err != nil {
		return MutationResult{}, err
	}
	result, err := s.store.UpsertProjectLibraryEntry(ctx, programmingstore.UpsertProjectLibraryEntryParams{
		EntryID: command.EntryID, Kind: command.Kind, Name: command.Name, Language: command.Language,
		FeatureState: featureState, Source: []byte(command.Source), InterfaceJSON: command.InterfaceJSON,
		Dependencies: dependencies, StateLayout: layout,
		NewLibraryRevisionID: s.newID(), Identity: identity,
	})
	if err != nil {
		return MutationResult{}, err
	}
	return libraryMutationResult(command.ProjectID, command.EntryID, result), nil
}

func (s *LibraryService) DeleteEntry(ctx context.Context, actor Actor, command DeleteLibraryEntryCommand) (MutationResult, error) {
	if !isUUID(command.ProjectID) || !isUUID(command.EntryID) {
		return MutationResult{}, ErrInvalidRequest
	}
	identity, err := s.mutationIdentity(actor, command.ProjectID, command.IfMatch, command.IdempotencyKey, command.CorrelationID,
		map[string]any{"projectId": command.ProjectID, "entryId": command.EntryID, "ifMatch": command.IfMatch})
	if err != nil {
		return MutationResult{}, err
	}
	result, err := s.store.DeleteProjectLibraryEntry(ctx, programmingstore.DeleteProjectLibraryEntryParams{
		EntryID: command.EntryID, Identity: identity,
	})
	if err != nil {
		return MutationResult{}, err
	}
	return libraryMutationResult(command.ProjectID, command.EntryID, result), nil
}

// DeprecateRevision chỉ mở chuyển tiếp PUBLISHED -> DEPRECATED. Publish không
// có API riêng: nó vẫn thuộc transaction Seal Revision để không tiêu version
// mà chưa có Revision bất biến nào pin tới.
func (s *LibraryService) DeprecateRevision(ctx context.Context, actor Actor,
	command DeprecateLibraryRevisionCommand) (MutationResult, error) {
	if command.SchemaVersion != "1.0" || !isUUID(command.ProjectID) || !isUUID(command.LibraryRevisionID) {
		return MutationResult{}, ErrInvalidRequest
	}
	identity, err := s.mutationIdentity(actor, command.ProjectID, command.IfMatch,
		command.IdempotencyKey, command.CorrelationID, map[string]any{
			"schemaVersion": command.SchemaVersion, "projectId": command.ProjectID,
			"libraryRevisionId": command.LibraryRevisionID, "state": programmingstore.LibraryStateDeprecated,
			"ifMatch": command.IfMatch,
		})
	if err != nil {
		return MutationResult{}, err
	}
	result, err := s.store.DeprecateProjectLibraryRevision(ctx, programmingstore.DeprecateProjectLibraryRevisionParams{
		LibraryRevisionID: command.LibraryRevisionID, Identity: identity,
	})
	if err != nil {
		return MutationResult{}, err
	}
	resource := map[string]any{
		"projectId": command.ProjectID, "draftRevisionId": result.DraftID,
		"libraryRevisionId": result.Revision.LibraryRevisionID, "libraryVersion": result.Revision.Version,
		"libraryState": result.Revision.State,
	}
	return MutationResult{Resource: resource, ETag: FormatDraftETag(result.DraftID, result.DraftETag),
		AuditID: result.AuditID, Replay: result.Replay}, nil
}

// mutationIdentity gom bốn thứ luôn đi cùng nhau: ETag Draft đã đọc, khoá
// idempotency, hash ngữ nghĩa request và dấu vết actor/audit. Tách chúng ra
// từng chỗ gọi là cách một trong bốn bị bỏ quên.
func (s *LibraryService) mutationIdentity(actor Actor, projectID, ifMatch, idempotencyKey, correlationID string,
	request map[string]any) (programmingstore.LibraryMutationIdentity, error) {
	// Actor rỗng nghĩa là middleware auth chưa chạy. Không chặn ở đây thì store
	// từ chối bằng một lỗi không có sentinel, và lớp HTTP dịch nó thành 503
	// "retryable" — bảo client thử lại một thứ không bao giờ thành công.
	if !validText(actor.ID, 1, 128) || !validText(actor.Role, 1, 32) {
		return programmingstore.LibraryMutationIdentity{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(idempotencyKey)
	if err != nil {
		return programmingstore.LibraryMutationIdentity{}, err
	}
	requestHash, err := semanticHash(request)
	if err != nil {
		return programmingstore.LibraryMutationIdentity{}, err
	}
	snapshot, err := s.store.GetProject(context.Background(), projectID)
	if err != nil {
		return programmingstore.LibraryMutationIdentity{}, err
	}
	etag, err := ParseDraftETag(ifMatch, snapshot.Draft.DraftID)
	if err != nil {
		return programmingstore.LibraryMutationIdentity{}, err
	}
	return programmingstore.LibraryMutationIdentity{
		ProjectID: projectID, ExpectedDraftETag: etag, ActorID: actor.ID, Role: actor.Role,
		AuditID: s.newID(), CorrelationID: correlationID, At: s.now(),
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	}, nil
}

func libraryMutationResult(projectID, entryID string, result programmingstore.LibraryEntryMutation) MutationResult {
	resource := map[string]any{"projectId": projectID, "entryId": entryID,
		"draftRevisionId": result.DraftID, "libraryRevisionId": result.LibraryRevisionID}
	return MutationResult{Resource: resource, ETag: FormatDraftETag(result.DraftID, result.DraftETag),
		AuditID: result.AuditID, Replay: result.Replay}
}

// validLibrarySource khác `validText`: mã nguồn POU BẮT BUỘC có xuống dòng và
// tab, nên bộ lọc ký tự điều khiển dùng cho tên/nhãn sẽ từ chối mọi source hợp
// lệ. Chỉ ba ký tự trắng đó được phép; các ký tự điều khiển khác vẫn bị chặn vì
// chúng không có nghĩa trong ST/FBD và là kênh giấu nội dung.
func validLibrarySource(value string) bool {
	if len(value) < 1 || len(value) > 65536 || !utf8.ValidString(value) {
		return false
	}
	return strings.IndexFunc(value, func(candidate rune) bool {
		if candidate == '\n' || candidate == '\r' || candidate == '\t' {
			return false
		}
		return candidate < 0x20 || candidate == 0x7f
	}) < 0
}

func libraryStateLayoutFromCommand(kind string, command *LibraryStateLayoutCommand) (programmingstore.LibraryStateLayout, error) {
	if kind == programmingstore.LibraryKindFunction {
		if command != nil {
			return programmingstore.LibraryStateLayout{}, ErrInvalidRequest
		}
		return programmingstore.LibraryStateLayout{Authoritative: true}, nil
	}
	if command == nil {
		return programmingstore.LibraryStateLayout{}, nil
	}
	digest, err := hex.DecodeString(command.SHA256)
	if err != nil || len(digest) != sha256.Size || command.Version == 0 {
		return programmingstore.LibraryStateLayout{}, ErrInvalidRequest
	}
	layout := programmingstore.LibraryStateLayout{Authoritative: true,
		Version: command.Version, StateSizeBytes: command.StateSizeBytes}
	copy(layout.SHA256[:], digest)
	return layout, nil
}

func libraryEntryView(entry programmingstore.LibraryEntry, revision programmingstore.LibraryRevision) LibraryEntryView {
	dependencies := make([]LibraryDependencyView, 0, len(entry.Dependencies))
	for _, dependency := range entry.Dependencies {
		dependencies = append(dependencies, LibraryDependencyView{EntryID: dependency.EntryID, Version: dependency.Version})
	}
	view := LibraryEntryView{
		Scope: revision.Scope, LibraryRevisionID: entry.LibraryRevisionID, LibraryVersion: revision.Version,
		LibraryState: revision.State, EntryID: entry.EntryID, Kind: entry.Kind, Name: entry.Name,
		Language: entry.Language, FeatureState: entry.FeatureState,
		ContentSHA256: hex.EncodeToString(entry.ContentSHA256[:]), Dependencies: dependencies,
		StateLayoutKnown: entry.StateLayout.Authoritative, StateSizeBytes: entry.StateLayout.StateSizeBytes,
	}
	if len(entry.InterfaceJSON) > 0 {
		view.InterfaceJSON = append([]byte(nil), entry.InterfaceJSON...)
	}
	return view
}

type libraryCursor struct {
	NameFolded        string `json:"nameFolded"`
	EntryID           string `json:"entryId"`
	LibraryRevisionID string `json:"libraryRevisionId"`
	Scope             string `json:"scope"`
	Kind              string `json:"kind"`
	Query             string `json:"query"`
	ProjectID         string `json:"projectId"`
	ExpiresAtUTCMS    int64  `json:"expiresAtUtcMs"`
}

func (s *LibraryService) encodeLibraryCursor(cursor libraryCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *LibraryService) decodeLibraryCursor(encoded string) (libraryCursor, error) {
	parts := strings.Split(encoded, ".")
	if len(parts) != 2 || len(encoded) > 1024 {
		return libraryCursor{}, ErrInvalidCursor
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return libraryCursor{}, ErrInvalidCursor
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return libraryCursor{}, ErrInvalidCursor
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return libraryCursor{}, ErrInvalidCursor
	}
	var cursor libraryCursor
	if err := decodeStrict(payload, &cursor); err != nil ||
		!validText(cursor.NameFolded, 1, 64) || cursor.NameFolded != strings.ToUpper(cursor.NameFolded) ||
		!validText(cursor.EntryID, 1, 128) || !validText(cursor.LibraryRevisionID, 1, 128) ||
		s.now().UTC().UnixMilli() >= cursor.ExpiresAtUTCMS {
		return libraryCursor{}, ErrInvalidCursor
	}
	return cursor, nil
}

// LibraryPublicError dịch lỗi phân giải của domain sang mã public đúng nghĩa.
// Ba nguyên nhân giữ ba mã khác nhau ở tận lớp HTTP, đúng như DDD §5.2 khoá.
func LibraryPublicError(err error) (domain.PublicError, bool) {
	var resolution *domain.LibraryResolutionError
	if errors.As(err, &resolution) {
		public := domain.NewPublicError(domain.MapComponentError("compiler", resolution.DiagnosticCode()))
		public.KeepsRunningRevision = true
		return public, true
	}
	switch {
	case errors.Is(err, programmingstore.ErrLibraryReferenced):
		public := domain.NewPublicError(domain.ErrConflict)
		public.KeepsRunningRevision = true
		return public, true
	case errors.Is(err, programmingstore.ErrLibraryImmutable):
		public := domain.NewPublicError(domain.ErrConflict)
		public.KeepsRunningRevision = true
		return public, true
	case errors.Is(err, programmingstore.ErrLibraryStateLayout):
		public := domain.NewPublicError(domain.ErrPouKind)
		public.KeepsRunningRevision = true
		return public, true
	}
	return domain.PublicError{}, false
}
