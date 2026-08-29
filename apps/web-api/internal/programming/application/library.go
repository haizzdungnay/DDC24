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
	// SignatureJSON là chữ ký canonical của registry SYSTEM.
	//
	// SYSTEM entry KHÔNG có `InterfaceJSON` — `domain.SystemLibraryEntries()`
	// đặt dữ liệu vào `SignatureJSON` và để `InterfaceJSON` rỗng. Trước lát này
	// view chỉ chép `InterfaceJSON`, nên toàn bộ 46 entry SYSTEM tới FE mà
	// không có cổng lẫn category: Thư viện nhanh hiện "Thiếu chữ ký từ thiết bị"
	// cho mọi mục và gom tất cả vào nhóm `other`. Lớp HTTP và hợp đồng OpenAPI
	// đều đã sẵn sàng cho `signature`; đứt dây nằm đúng ở đây.
	SignatureJSON    []byte
	Dependencies     []LibraryDependencyView
	StateLayoutKnown bool
	StateSizeBytes   uint32
	/* `T61-101` — metadata trình bày. Con trỏ chứ không phải chuỗi: `nil` là
	   "chưa ai điền" và phải tới FE dưới dạng field VẮNG, để màn hình render
	   `—` thay vì một ô trống trông như đã điền rỗng. */
	Category           *string
	Description        *string
	PresentationSHA256 string
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
	/* `T61-101` — lọc theo phân loại. So chính xác: đây là tập giá trị đóng của
	   `categoryOrder`, khớp mờ chỉ tạo ra kết quả không giải thích được. */
	Category string
	Query    string
	Cursor   string
	Limit    int
}

type UpsertLibraryEntryCommand struct {
	ProjectID     string
	SchemaVersion string
	EntryID       string
	Kind          string
	Name          string
	Language      string
	FeatureState  string
	Source        string
	InterfaceJSON json.RawMessage
	Dependencies  []LibraryDependencyView
	StateLayout   *LibraryStateLayoutCommand
	/* `T61-401` — metadata TRÌNH BÀY. `nil` = entry không mang metadata đó,
	   con trỏ tới chuỗi rỗng = đã điền và nội dung rỗng. Cột store phân biệt
	   hai thứ (`NULL` khác `''`) và PGM-04 render `NULL` thành `—` kèm lý do. */
	Category       *string
	Description    *string
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
			cursor.Query != command.Query || cursor.ProjectID != command.ProjectID ||
			cursor.Category != command.Category {
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
		Category: command.Category,
		Scope:    command.Scope, Limit: command.Limit + 1, After: after,
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
			Query: command.Query, Category: command.Category, ProjectID: command.ProjectID,
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
	/* Trần metadata đếm theo KÝ TỰ để khớp `maxLength` của OpenAPI. Từ chối
	   thẳng thay vì cắt bớt: cắt im lặng làm read-back trả về thứ khác thứ
	   client vừa gửi, và người dùng không có cách nào biết mô tả của mình đã bị
	   xén. `validText` cũng chặn ký tự điều khiển. */
	if command.Category != nil && *command.Category != "" && !validText(*command.Category, 1, 32) {
		return MutationResult{}, ErrInvalidRequest
	}
	if command.Description != nil && *command.Description != "" && !validText(*command.Description, 1, 512) {
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
			"stateLayout": command.StateLayout, "category": command.Category,
			"description": command.Description, "ifMatch": command.IfMatch})
	if err != nil {
		return MutationResult{}, err
	}
	result, err := s.store.UpsertProjectLibraryEntry(ctx, programmingstore.UpsertProjectLibraryEntryParams{
		EntryID: command.EntryID, Kind: command.Kind, Name: command.Name, Language: command.Language,
		FeatureState: featureState, Source: []byte(command.Source), InterfaceJSON: command.InterfaceJSON,
		Dependencies: dependencies, StateLayout: layout,
		Category: command.Category, Description: command.Description,
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
		Category: entry.Category, Description: entry.Description,
	}
	if len(entry.PresentationSHA256) > 0 {
		view.PresentationSHA256 = hex.EncodeToString(entry.PresentationSHA256)
	}
	if len(entry.InterfaceJSON) > 0 {
		view.InterfaceJSON = append([]byte(nil), entry.InterfaceJSON...)
	}
	if len(entry.SignatureJSON) > 0 {
		view.SignatureJSON = append([]byte(nil), entry.SignatureJSON...)
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
	/* `T61-101` — cursor phải mang CẢ bộ lọc. Thiếu `category` ở đây thì trang
	   thứ hai của một bộ lọc trả về dữ liệu của bộ lọc khác, và người dùng
	   không có cách nào biết. */
	Category       string `json:"category"`
	ProjectID      string `json:"projectId"`
	ExpiresAtUTCMS int64  `json:"expiresAtUtcMs"`
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
	/* `Strict()` chứ không phải decoder mặc định: base64 raw cho phép ký tự
	 * cuối mang những bit KHÔNG được dùng, nên đổi ký tự cuối của chữ ký vẫn
	 * có thể decode ra đúng 32 byte cũ và HMAC vẫn khớp. Nghĩa là một cursor đã
	 * bị sửa vẫn đi qua được — phát hiện khi một thay đổi dữ liệu không liên
	 * quan (bump library registry) làm ký tự cuối rơi vào đúng trường hợp đó,
	 * và test chống giả mạo đang xanh chỉ vì may. */
	payload, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil {
		return libraryCursor{}, ErrInvalidCursor
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
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

/* ------------------------------------------------------------------ *
 * `T61-104` — Used-In                                                 *
 * ------------------------------------------------------------------ */

// LibraryUsageItem là một mục Used-In: MỘT CẶP (Revision, POU).
type LibraryUsageItem struct {
	ProjectID       string `json:"projectId"`
	ProjectName     string `json:"projectName"`
	RevisionID      string `json:"revisionId"`
	ObjectID        string `json:"objectId"`
	ObjectName      string `json:"objectName"`
	RequiredVersion string `json:"requiredVersion"`
	UsageKind       string `json:"usageKind"`
	IsActive        bool   `json:"isActive"`
}

// LibraryUsageScope là một phạm vi đếm. `Count` chỉ có nghĩa khi phạm vi này
// thật sự đo được — xem `LibraryUsageView.Availability`.
type LibraryUsageScope struct {
	Count     int                `json:"count"`
	Truncated bool               `json:"truncated"`
	Items     []LibraryUsageItem `json:"items"`
}

/*
LibraryUsageView — Used-In với `Availability` là trường BẮT BUỘC.

Đây là chỗ quan trọng nhất của lát này, và nó không phải chuyện trình bày.

`Count: 0` nghĩa là "không chương trình nào đang dùng khối này" — một câu mời
người ta xoá hoặc deprecate nó. `Availability: "UNAVAILABLE"` nghĩa là "chưa đo
được". Trả `0` khi đang không đo được là cách một khối bị gỡ **trong khi nó đang
điều khiển tủ**.

Ba giá trị:

  - `COMPLETE`     — cả Draft lẫn sealed đều đo được.
  - `SEALED_ONLY`  — chỉ đo được phần đã niêm phong; Draft chưa tính.
  - `UNAVAILABLE`  — không đo được phạm vi nào (entry SYSTEM: usage của chúng
    phân giải từ registry/profile lock chứ không nằm trong `library_usages`).
*/
type LibraryUsageView struct {
	Sealed       LibraryUsageScope `json:"sealed"`
	Draft        LibraryUsageScope `json:"draft"`
	Availability string            `json:"availability"`
}

const (
	LibraryUsageComplete    = "COMPLETE"
	LibraryUsageSealedOnly  = "SEALED_ONLY"
	LibraryUsageUnavailable = "UNAVAILABLE"
	libraryUsageMaxItems    = 200
)

type LibraryUsageCommand struct {
	LibraryRevisionID string
	EntryID           string
	Scope             string
}

/*
Usage đọc Used-In cho một entry.

Cho phép hiện tên Project khác: `ListProjects` không lọc theo chủ sở hữu và
`read` là quyền mọi vai đã đăng nhập đều có, nên sản phẩm không có phân vùng
theo Project và danh sách chéo Project không lộ thêm gì
(`LOCK-PGM04-CONTRACT-001` §1.3).
*/
func (s *LibraryService) Usage(ctx context.Context, command LibraryUsageCommand) (LibraryUsageView, error) {
	view := LibraryUsageView{
		Sealed: LibraryUsageScope{Items: []LibraryUsageItem{}},
		Draft:  LibraryUsageScope{Items: []LibraryUsageItem{}},
	}
	if command.LibraryRevisionID == "" {
		return view, fmt.Errorf("libraryRevisionId là bắt buộc")
	}
	if command.Scope == programmingstore.LibraryScopeSystem {
		/* Entry SYSTEM: `library_usages` cố ý không giữ usage của chúng
		   (migration `0007` — không tạo FK giả tới một row DB không có). Nói ra
		   là "chưa đo được", KHÔNG trả 0. */
		view.Availability = LibraryUsageUnavailable
		return view, nil
	}

	rows, err := s.store.ListLibraryUsageRows(ctx, command.LibraryRevisionID, command.EntryID,
		libraryUsageMaxItems+1)
	if err != nil {
		return LibraryUsageView{}, err
	}
	if len(rows) > libraryUsageMaxItems {
		rows = rows[:libraryUsageMaxItems]
		view.Sealed.Truncated = true
	}
	for _, row := range rows {
		view.Sealed.Items = append(view.Sealed.Items, LibraryUsageItem{
			ProjectID: row.ProjectID, ProjectName: row.ProjectName,
			RevisionID: row.RevisionID, ObjectID: row.ObjectID, ObjectName: row.ObjectName,
			RequiredVersion: row.RequiredVersion, UsageKind: row.UsageKind, IsActive: row.IsActive,
		})
	}
	view.Sealed.Count = len(view.Sealed.Items)

	/* Draft chưa Seal thì chưa có `pou_objects`, nên phạm vi Draft chưa đo được
	   ở lát này. Nói `SEALED_ONLY` thay vì để `draft.count = 0` — số 0 ở đó sẽ
	   đọc như "không Draft nào dùng khối này", một câu chưa ai kiểm chứng. */
	view.Availability = LibraryUsageSealedOnly
	return view, nil
}
