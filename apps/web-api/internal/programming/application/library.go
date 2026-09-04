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
	Category    *string
	Description *string
	/* `T61-101` — thẻ đã CHUẨN HOÁ (trim, chữ thường, khử trùng lặp, sắp tăng
	   dần). `nil` là "chưa ai gắn thẻ" và tới FE dưới dạng field VẮNG. Mảng
	   rỗng không phải trạng thái thứ ba: khác `Description` (nơi chuỗi rỗng là
	   một mô tả đã viết và cố ý để trống), "không thẻ nào" và "chưa gắn thẻ" là
	   cùng một câu. */
	Tags               []string
	PresentationSHA256 string
	/* `T61-101` — read model tương thích. KHÔNG phải con trỏ: nó LUÔN có mặt,
	   và mặc định fail-closed là `UNKNOWN`. Để nó vắng được nghĩa là một client
	   nào đó sẽ đọc "vắng" thành "không sao", tức đúng cái kết luận mà `UNKNOWN`
	   sinh ra để chặn. */
	Compatibility LibraryCompatibility
}

/*
LibraryCompatibility — `LOCK-PGM04-CONTRACT-001` §4.

`UNKNOWN` là giá trị MẶC ĐỊNH, không phải trường hợp lỗi: khi Project chưa
Commission Revision nào thì không có gì để so, và nói "tương thích" lúc ấy là
một khẳng định không có cơ sở. Đây cũng là lý do ba trường sau là con trỏ —
`nil` nghĩa là "đã xét, chưa đo được", khác hẳn chuỗi rỗng nghĩa là "đo được và
bằng rỗng".

Phần "không âm thầm nâng version" (`AC-PGM04-05`) đã do cơ chế pin
`libraryRevisionId` ở Revision bảo đảm; read model này chỉ làm trạng thái ấy
NHÌN THẤY ĐƯỢC, nó không thêm cơ chế nào.
*/
type LibraryCompatibility struct {
	State            string
	RequiredVersion  *string
	AvailableVersion *string
	Reason           *string
}

const (
	LibraryCompatible         = "COMPATIBLE"
	LibraryRequiresMigration  = "REQUIRES_MIGRATION"
	LibraryCompatibleUnknown  = "UNKNOWN"
	libraryCompatReasonNoPin  = "Chưa có Revision vận hành nào pin entry này"
	libraryCompatReasonNoPub  = "Chưa có version PUBLISHED nào mang entry này"
	libraryCompatReasonSystem = "Usage của entry SYSTEM phân giải từ registry/profile lock, chưa đo được ở lát này"
)

// LibraryCompatibilityStates là NGUỒN của enum `compatibility.state` cho cả
// OpenAPI lẫn test hợp đồng. Chép tay danh sách này ở chỗ khác là cách một giá
// trị thứ tư mọc ra ở một đầu mà đầu kia không biết.
var LibraryCompatibilityStates = []string{
	LibraryCompatible, LibraryRequiresMigration, LibraryCompatibleUnknown,
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
	Category    *string
	Description *string
	/* `T61-101` — thẻ. Vắng (`nil`) nghĩa là entry sau lần ghi KHÔNG có thẻ,
	   đúng như mọi field optional khác của một phép GHI ĐÈ toàn phần. */
	Tags           []string
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
	/* Một phép đo cho CẢ TRANG, không phải một phép đo mỗi entry: trang tối đa
	   100 mục, và hỏi store 100 lần cho một câu trả lời giống nhau là cách một
	   danh sách đọc thành N+1 truy vấn. */
	facts, err := s.store.LibraryCompatibilityFacts(ctx, command.ProjectID)
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
		view := libraryEntryView(entry, revision)
		view.Compatibility = libraryCompatibility(revision.Scope, entry.EntryID, facts)
		page.Items = append(page.Items, view)
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
	/* Thẻ được CHUẨN HOÁ ở đây, trước cả hash ngữ nghĩa lẫn store.
	 *
	 * Thứ tự này quan trọng: `mutationIdentity` băm payload để nhận diện một
	 * request lặp. Băm dạng THÔ thì hai lần gửi `["VAV"]` và `["vav"]` — cùng
	 * một ý định sau chuẩn hoá — ra hai hash khác nhau, và khoá idempotency
	 * dùng lại sẽ bị coi là xung đột thay vì replay.
	 *
	 * Vượt trần là 400 `ErrInvalidRequest`, KHÔNG phải lỗi store: trigger SQL
	 * cũng chặn nhưng nó trả một chuỗi lỗi SQLite mà lớp HTTP dịch thành 503
	 * "thử lại đi" — bảo client thử lại một thứ không bao giờ thành công. */
	tags, err := normalizeLibraryTags(command.Tags)
	if err != nil {
		return MutationResult{}, err
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
			"description": command.Description, "tags": tags, "ifMatch": command.IfMatch})
	if err != nil {
		return MutationResult{}, err
	}
	result, err := s.store.UpsertProjectLibraryEntry(ctx, programmingstore.UpsertProjectLibraryEntryParams{
		EntryID: command.EntryID, Kind: command.Kind, Name: command.Name, Language: command.Language,
		FeatureState: featureState, Source: []byte(command.Source), InterfaceJSON: command.InterfaceJSON,
		Dependencies: dependencies, StateLayout: layout,
		Category: command.Category, Description: command.Description, Tags: tags,
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
		Tags: append([]string(nil), entry.Tags...),
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

/*
normalizeLibraryTags — cổng vào của thẻ ở lớp application.

Quyết định chuẩn hoá (`LOCK-PGM04-CONTRACT-001` §2.1) nằm một chỗ duy nhất, ở
store (`libraryNormalizeTags`), và hàm này chỉ dịch lỗi của nó sang
`ErrInvalidRequest` để lớp HTTP trả 400 ổn định. Viết lại luật ở đây sẽ tạo ra
hai bản luật, và bản nào sai thì đường ghi HTTP và đường import bundle sẽ chuẩn
hoá khác nhau trên cùng một dữ liệu.

Trần đếm ở CẢ HAI đầu: quá 8 phần tử THÔ bị chặn trước khi khử trùng lặp (một
payload 10 000 thẻ không được phép bắt server chuẩn hoá xong mới từ chối), và
quá 8 phần tử SAU khi khử trùng lặp cũng bị chặn.
*/
func normalizeLibraryTags(tags []string) ([]string, error) {
	if len(tags) > libraryRequestMaxTags {
		return nil, ErrInvalidRequest
	}
	normalized, err := programmingstore.NormalizeLibraryTags(tags)
	if err != nil {
		return nil, ErrInvalidRequest
	}
	return normalized, nil
}

// libraryRequestMaxTags là trần ĐẾM THÔ của payload, khớp `maxItems` của
// OpenAPI. Số tuyệt đối chứ không tham chiếu hằng store: hai đầu phải khoá lẫn
// nhau, và một hằng dùng chung sẽ làm test "so một hằng với chính nó".
const libraryRequestMaxTags = 8

/*
libraryCompatibility phân loại một entry theo `LOCK-PGM04-CONTRACT-001` §4.

Fail-closed là luật ở đây, không phải phong cách: thiếu BẤT KỲ vế nào trong hai
vế (version Revision vận hành đang pin, version PUBLISHED mới nhất) thì kết quả
là `UNKNOWN` kèm lý do — không phải `COMPATIBLE`. `COMPATIBLE` là một lời hứa
rằng gói đang chạy và bản mới nhất là cùng một thứ; phát lời hứa ấy khi chưa đo
được là cách người vận hành nâng version mà không biết mình đang nâng.

Entry SYSTEM luôn `UNKNOWN`: `library_usages` cố ý không giữ usage của chúng
(migration `0007`), nên không có pin nào để đọc. `T61-102`/`T61-104` mở đường
phân giải từ registry/profile lock; tới lúc đó câu trả lời đúng là "chưa đo
được", không phải một con số.
*/
func libraryCompatibility(scope, entryID string, facts programmingstore.LibraryCompatibilityFacts) LibraryCompatibility {
	if scope == programmingstore.LibraryScopeSystem {
		reason := libraryCompatReasonSystem
		return LibraryCompatibility{State: LibraryCompatibleUnknown, Reason: &reason}
	}
	result := LibraryCompatibility{State: LibraryCompatibleUnknown}
	if version, ok := facts.PublishedVersions[entryID]; ok {
		value := version
		result.AvailableVersion = &value
	}
	if version, ok := facts.PinnedVersions[entryID]; ok {
		value := version
		result.RequiredVersion = &value
	}
	switch {
	case result.RequiredVersion == nil:
		reason := libraryCompatReasonNoPin
		result.Reason = &reason
	case result.AvailableVersion == nil:
		reason := libraryCompatReasonNoPub
		result.Reason = &reason
	case *result.RequiredVersion == *result.AvailableVersion:
		result.State = LibraryCompatible
	default:
		reason := fmt.Sprintf("Revision vận hành đang pin %s, bản PUBLISHED mới nhất là %s",
			*result.RequiredVersion, *result.AvailableVersion)
		result.State = LibraryRequiresMigration
		result.Reason = &reason
	}
	return result
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
	/*
	   `T61-101` — con trỏ trang KẾ.

	   `truncated: true` mà không có `nextCursor` là một ngõ cụt: giao diện nói
	   "còn nữa" rồi không có cách nào đọc tiếp, và người dùng kết luận bằng
	   đúng 200 mục đầu tiên. Hai trường đi cùng nhau: `truncated` nói CÓ CÒN,
	   `nextCursor` nói ĐỌC TIẾP BẰNG GÌ.

	   `nil` (`null` trên dây) = đã đọc hết. Cố ý KHÔNG dùng chuỗi rỗng: một
	   `if (cursor)` ở FE sẽ đọc chuỗi rỗng thành hết trang một cách tình cờ
	   chứ không phải theo hợp đồng.
	*/
	NextCursor *string `json:"nextCursor"`
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
	/* Hai cursor TÁCH BẠCH, mỗi phạm vi một cái. Một cursor dùng chung sẽ buộc
	   phải thêm một tham số "đang phân trang phạm vi nào", và hai danh sách
	   độc lập thì không có lý do gì phải tiến cùng nhịp. */
	SealedCursor string
	DraftCursor  string
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
	/* Mọi lỗi request ở đây phải là `ErrInvalidRequest` — một SENTINEL, không
	 * phải `fmt.Errorf` trần.
	 *
	 * Bản trước trả `fmt.Errorf("libraryRevisionId là bắt buộc")`, và handler
	 * HTTP che khuyết điểm ấy bằng cách quy MỌI lỗi của route này về 400. Hệ
	 * quả là chiều ngược lại: store hỏng, đọc lỗi, DB khoá — tất cả cũng ra
	 * 400 "request không hợp lệ", bảo người dùng sửa một request đúng. Sentinel
	 * ở đây cho handler phân biệt được hai loại và trả 503 cho loại thứ hai.
	 */
	if !validText(command.LibraryRevisionID, 1, 128) {
		return view, ErrInvalidRequest
	}
	if command.EntryID != "" && !validText(command.EntryID, 1, 128) {
		return view, ErrInvalidRequest
	}
	if command.Scope != "" && command.Scope != programmingstore.LibraryScopeSystem &&
		command.Scope != programmingstore.LibraryScopeProject {
		return view, ErrInvalidRequest
	}
	var draftAfter *programmingstore.LibraryUsageKey
	if command.DraftCursor != "" {
		cursor, err := s.decodeUsageCursor(command.DraftCursor)
		if err != nil {
			return view, err
		}
		if cursor.LibraryRevisionID != command.LibraryRevisionID || cursor.EntryID != command.EntryID {
			return view, ErrInvalidCursor
		}
		draftAfter = &programmingstore.LibraryUsageKey{
			ProjectName: cursor.ProjectName, RevisionID: cursor.RevisionID,
			ObjectID: cursor.ObjectID, UsageKind: cursor.UsageKind,
		}
	}
	if command.Scope == programmingstore.LibraryScopeSystem {
		/*
		   Entry SYSTEM vẫn `UNAVAILABLE`, và `T61-104` KHÔNG mở được nó — nên
		   ghi ra đây vì sao, thay vì để người sau tưởng là chưa ai làm.

		   Hai nguồn usage của sản phẩm đều không thấy entry SYSTEM:

		     - `library_usages` cố ý không giữ chúng (migration `0007` — không
		       tạo FK giả tới một row DB không tồn tại).
		     - `objects[].dependencies` của Draft cũng không: `recordLibraryUsagesTx`
		       đòi mọi dependency phải có hàng trong `library_entries` của PROJECT
		       library revision, nên khai một entry SYSTEM ở đó là lỗi Seal.

		   Một POU gọi `TON` dùng entry SYSTEM ấy qua SOURCE ST/FBD, không qua
		   khai báo. Đo được nó đòi phân tích cây cú pháp — việc của compiler,
		   không phải của store. Cho tới khi có đường ấy, câu trả lời đúng là
		   "chưa đo được", KHÔNG phải `count: 0`: số 0 ở đây là một câu mời người
		   ta gỡ một khối đang chạy trong mọi tủ.
		*/
		if command.SealedCursor != "" || command.DraftCursor != "" {
			return view, ErrInvalidCursor
		}
		view.Availability = LibraryUsageUnavailable
		return view, nil
	}

	var after *programmingstore.LibraryUsageKey
	if command.SealedCursor != "" {
		cursor, err := s.decodeUsageCursor(command.SealedCursor)
		if err != nil {
			return view, err
		}
		/* Cursor mang cả bộ lọc, y như cursor của `GET /libraries`: không ràng
		   buộc thì trang thứ hai của một entry có thể trả về usage của entry
		   khác, và người dùng không có cách nào biết. */
		if cursor.LibraryRevisionID != command.LibraryRevisionID || cursor.EntryID != command.EntryID {
			return view, ErrInvalidCursor
		}
		after = &programmingstore.LibraryUsageKey{
			ProjectName: cursor.ProjectName, RevisionID: cursor.RevisionID,
			ObjectID: cursor.ObjectID, UsageKind: cursor.UsageKind,
		}
	}

	/* Kind của entry ĐANG HỎI, tra một lần rồi dùng cho mọi mục Draft. `CALL`
	   với `INSTANCE` có hệ quả khác nhau khi đổi version — `INSTANCE` mang trạng
	   thái — nên gán bừa một trong hai là nói sai về thứ người vận hành sắp
	   quyết định. Entry không tra được thì để rỗng chứ không đoán. */
	entryUsageKind := ""
	if entry, entryErr := s.store.GetLibraryEntry(ctx, command.LibraryRevisionID, command.EntryID); entryErr == nil {
		switch entry.Kind {
		case programmingstore.LibraryKindFunctionBlock:
			entryUsageKind = "INSTANCE"
		case programmingstore.LibraryKindFunction, programmingstore.LibraryKindConversion:
			entryUsageKind = "CALL"
		}
	}

	rows, err := s.store.ListLibraryUsageRows(ctx, programmingstore.ListLibraryUsageParams{
		LibraryRevisionID: command.LibraryRevisionID, EntryID: command.EntryID,
		Limit: libraryUsageMaxItems + 1, After: after,
	})
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
	/* `Count` là số mục CỦA TRANG NÀY, không phải tổng toàn cục — đúng như
	   `truncated` đã nói ra. Đếm tổng đòi một `COUNT(*)` không giới hạn trên
	   một bảng mà một khối SYSTEM phổ biến chiếm mọi POU của mọi Project. */
	view.Sealed.Count = len(view.Sealed.Items)
	if view.Sealed.Truncated {
		last := view.Sealed.Items[len(view.Sealed.Items)-1]
		encoded, err := s.encodeUsageCursor(libraryUsageCursor{
			ProjectName: last.ProjectName, RevisionID: last.RevisionID,
			ObjectID: last.ObjectID, UsageKind: last.UsageKind,
			LibraryRevisionID: command.LibraryRevisionID, EntryID: command.EntryID,
			ExpiresAtUTCMS: s.now().UTC().Add(15 * time.Minute).UnixMilli(),
		})
		if err != nil {
			return LibraryUsageView{}, err
		}
		view.Sealed.NextCursor = &encoded
	}

	/*
	   `T61-104` — phạm vi Draft nay ĐO ĐƯỢC.

	   Nguồn là `objects[].dependencies` của chính tài liệu Draft — cùng mảng mà
	   đường Seal chuyển thành bản ghi `library_usages`. Đó là dữ liệu
	   authoritative của máy chủ, không phải cache của giao diện.

	   Một điều kiện: phải có `entryId`. Không có nó thì mọi POU khai bất kỳ
	   dependency nào đều khớp, và danh sách trả về không trả lời câu hỏi nào —
	   nên khi ấy phạm vi Draft vẫn là "chưa đo được", chứ không phải "không ai
	   dùng".
	*/
	if command.EntryID == "" {
		view.Availability = LibraryUsageSealedOnly
		return view, nil
	}
	draftRows, err := s.store.ListDraftLibraryUsageRows(ctx, programmingstore.ListLibraryUsageParams{
		EntryID: command.EntryID, Limit: libraryUsageMaxItems + 1, After: draftAfter,
	})
	if err != nil {
		return LibraryUsageView{}, err
	}
	if len(draftRows) > libraryUsageMaxItems {
		draftRows = draftRows[:libraryUsageMaxItems]
		view.Draft.Truncated = true
	}
	for _, row := range draftRows {
		view.Draft.Items = append(view.Draft.Items, LibraryUsageItem{
			ProjectID: row.ProjectID, ProjectName: row.ProjectName,
			RevisionID: row.RevisionID, ObjectID: row.ObjectID, ObjectName: row.ObjectName,
			/* `usageKind` lấy từ chính entry đang hỏi, không suy từ POU gọi: tài
			   liệu Draft không mang kind của khối được gọi, và `kind` của POU là
			   loại của bên GỌI. `INSTANCE` mang trạng thái còn `CALL` thì không,
			   nên đoán sai ở đây làm người đọc kết luận sai hệ quả khi đổi
			   version. */
			RequiredVersion: row.RequiredVersion, UsageKind: entryUsageKind, IsActive: row.IsActive,
		})
	}
	view.Draft.Count = len(view.Draft.Items)
	if view.Draft.Truncated {
		last := view.Draft.Items[len(view.Draft.Items)-1]
		encoded, err := s.encodeUsageCursor(libraryUsageCursor{
			ProjectName: last.ProjectName, RevisionID: last.RevisionID,
			ObjectID: last.ObjectID, UsageKind: last.UsageKind,
			LibraryRevisionID: command.LibraryRevisionID, EntryID: command.EntryID,
			ExpiresAtUTCMS: s.now().UTC().Add(15 * time.Minute).UnixMilli(),
		})
		if err != nil {
			return LibraryUsageView{}, err
		}
		view.Draft.NextCursor = &encoded
	}

	view.Availability = LibraryUsageComplete
	return view, nil
}

// libraryUsageCursor — keyset của Used-In, ký HMAC như cursor của `GET
// /libraries`. Bốn trường đầu là vị trí; hai trường sau ràng buộc bộ lọc.
type libraryUsageCursor struct {
	ProjectName       string `json:"projectName"`
	RevisionID        string `json:"revisionId"`
	ObjectID          string `json:"objectId"`
	UsageKind         string `json:"usageKind"`
	LibraryRevisionID string `json:"libraryRevisionId"`
	EntryID           string `json:"entryId"`
	ExpiresAtUTCMS    int64  `json:"expiresAtUtcMs"`
}

func (s *LibraryService) encodeUsageCursor(cursor libraryUsageCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *LibraryService) decodeUsageCursor(encoded string) (libraryUsageCursor, error) {
	parts := strings.Split(encoded, ".")
	if len(parts) != 2 || len(encoded) > 1024 {
		return libraryUsageCursor{}, ErrInvalidCursor
	}
	/* `Strict()` chứ không decoder mặc định — cùng lý do như cursor thư viện:
	   base64 raw cho phép ký tự cuối mang những bit KHÔNG được dùng, nên đổi ký
	   tự cuối của chữ ký vẫn decode ra đúng 32 byte cũ và HMAC vẫn khớp. Một
	   cursor đã bị sửa đi qua được là một lỗ, không phải một chi tiết. */
	payload, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil {
		return libraryUsageCursor{}, ErrInvalidCursor
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return libraryUsageCursor{}, ErrInvalidCursor
	}
	mac := hmac.New(sha256.New, s.cursorSecret)
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return libraryUsageCursor{}, ErrInvalidCursor
	}
	var cursor libraryUsageCursor
	if err := decodeStrict(payload, &cursor); err != nil ||
		!validText(cursor.RevisionID, 1, 128) || !validText(cursor.ObjectID, 1, 128) ||
		!validText(cursor.LibraryRevisionID, 1, 128) ||
		(cursor.UsageKind != "CALL" && cursor.UsageKind != "INSTANCE") ||
		s.now().UTC().UnixMilli() >= cursor.ExpiresAtUTCMS {
		return libraryUsageCursor{}, ErrInvalidCursor
	}
	return cursor, nil
}
