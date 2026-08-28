package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"mkddc-web/internal/programming/domain"
)

var (
	ErrLibraryImmutable       = domain.ErrLibraryImmutable
	ErrLibraryReferenced      = errors.New("Control Library entry đang được tham chiếu")
	ErrLibraryEntryMissing    = domain.ErrLibraryEntryMissing
	ErrLibraryVersionMismatch = domain.ErrLibraryVersionMismatch
	ErrLibraryDependencyCycle = domain.ErrLibraryDependencyCycle
	ErrLibraryStateLayout     = domain.ErrLibraryStateLayout
)

const (
	actionLibraryEntryUpsert       = "LIBRARY_ENTRY_UPSERT"
	actionLibraryEntryDelete       = "LIBRARY_ENTRY_DELETE"
	actionLibraryRevisionDeprecate = "LIBRARY_REVISION_DEPRECATE"

	LibraryScopeSystem  = "SYSTEM"
	LibraryScopeProject = "PROJECT"

	LibraryStateDraft      = "DRAFT"
	LibraryStatePublished  = "PUBLISHED"
	LibraryStateDeprecated = "DEPRECATED"

	LibraryKindFunction      = "FUNCTION"
	LibraryKindFunctionBlock = "FUNCTION_BLOCK"
	LibraryKindConversion    = "CONVERSION"
)

var (
	libraryIECNamePattern   = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)
	libraryEntryIDPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)
	librarySystemVerPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,63}$`)
)

var projectLibraryLegacySignature = []byte(`{"schemaVersion":1,"authority":"interface_json"}`)

// SystemLibraryProvider là hook read-only tới registry Go được sinh. Store
// không seed SYSTEM entry vào SQLite và không chép literal registry.
type SystemLibraryProvider interface {
	LoadSystemLibrary(context.Context) (SystemLibrarySnapshot, error)
}

type generatedSystemLibraryProvider struct{}

func (generatedSystemLibraryProvider) LoadSystemLibrary(context.Context) (SystemLibrarySnapshot, error) {
	revision, err := domain.SystemLibraryRevision()
	if err != nil {
		return SystemLibrarySnapshot{}, err
	}
	entries, err := domain.SystemLibraryEntries()
	if err != nil {
		return SystemLibrarySnapshot{}, err
	}
	snapshot := SystemLibrarySnapshot{Revision: fromDomainLibraryRevision(revision), Entries: make([]LibraryEntry, len(entries))}
	for index := range entries {
		snapshot.Entries[index] = fromDomainLibraryEntry(entries[index])
	}
	return snapshot, nil
}

type SystemLibrarySnapshot struct {
	Revision LibraryRevision
	Entries  []LibraryEntry
}

type LibraryRevision struct {
	LibraryRevisionID       string
	ProjectID               string
	Scope                   string
	Version                 string
	ParentLibraryRevisionID string
	State                   string
	ManifestJSON            []byte
	ManifestSHA256          [sha256.Size]byte
	CreatedBy               string
	CreatedAtUTCMS          int64
}

// LibraryStateLayout phân biệt rõ state 0 byte authoritative với layout FB
// chưa biết. FUNCTION/CONVERSION dùng Authoritative=true, size=0,
// version/hash=0. FUNCTION_BLOCK publish phải có version/hash authoritative.
type LibraryStateLayout struct {
	Authoritative  bool
	Version        uint32
	StateSizeBytes uint32
	SHA256         [sha256.Size]byte
}

type LibraryDependency struct {
	EntryID string `json:"entryId"`
	Version string `json:"version"`
}

type LibraryEntry struct {
	LibraryRevisionID string
	EntryID           string
	Kind              string
	Name              string
	Language          string
	FeatureState      string
	Source            []byte
	InterfaceJSON     []byte
	SignatureJSON     []byte
	Dependencies      []LibraryDependency
	StateLayout       LibraryStateLayout
	ContentSHA256     [sha256.Size]byte
	/*
	   `T61-103` — metadata TRÌNH BÀY. Nằm ngoài `ContentSHA256` một cách có
	   chủ ý: sửa mô tả không được đổi danh tính thực thi, nếu không mọi
	   artifact và pin đã ký thành lỗi thời chỉ vì một lần sửa chính tả.

	   `nil` nghĩa là "chưa ai điền", KHÁC chuỗi rỗng nghĩa là "đã điền rỗng có
	   chủ đích". Phân biệt này đi thẳng ra tới màn hình: `nil` render `—`.
	*/
	Category           *string
	Description        *string
	PresentationSHA256 []byte
}

type LibraryUsage struct {
	RevisionID        string
	ObjectID          string
	LibraryRevisionID string
	EntryID           string
	RequiredVersion   string
	UsageKind         string
}

type CreateProjectLibraryDraftParams struct {
	LibraryRevisionID       string
	ProjectID               string
	Version                 string
	ParentLibraryRevisionID string
	CreatedBy               string
	AtUTCMS                 int64
}

// LibraryMutationIdentity là phần bắt buộc của MỌI mutation Control Library.
// Nó không optional: biên nhận idempotency và audit phải nằm trong CÙNG
// transaction với thay đổi, nếu không một lần crash giữa hai bước sẽ để lại
// mutation không có dấu vết hoặc biên nhận không có mutation.
type LibraryMutationIdentity struct {
	ProjectID            string
	ExpectedDraftETag    int64
	ActorID              string
	Role                 string
	AuditID              string
	CorrelationID        string
	At                   time.Time
	IdempotencyKeySHA256 [sha256.Size]byte
	RequestSHA256        [sha256.Size]byte
}

type UpsertProjectLibraryEntryParams struct {
	LibraryRevisionID string
	EntryID           string
	Kind              string
	Name              string
	Language          string
	FeatureState      string
	Source            []byte
	InterfaceJSON     []byte
	Dependencies      []LibraryDependency
	StateLayout       LibraryStateLayout
	/* `T61-103` — metadata trình bày. `nil` = không đổi trường đó; con trỏ tới
	   chuỗi rỗng = xoá nội dung có chủ đích. Hai thứ khác nhau, và gộp chúng
	   lại sẽ làm người dùng không xoá được một mô tả đã viết. */
	Category    *string
	Description *string
	// NewLibraryRevisionID chỉ dùng khi LibraryRevisionID rỗng và Project chưa
	// có Draft library nào. Store KHÔNG tự sinh UUID: sinh ID bên trong
	// transaction làm cùng một request retry ra hai identity khác nhau.
	NewLibraryRevisionID string
	Identity             LibraryMutationIdentity
}

// LibraryEntryMutation trả cả entry lẫn ETag Draft mới. Mutation library đổi
// working set của Project, nên nó đi CHUNG một lane optimistic-concurrency với
// tài liệu Draft thay vì có ETag riêng — hai lane song song sẽ cho phép một lần
// lưu tài liệu và một lần sửa library xen kẽ nhau mà không bên nào thấy.
type LibraryEntryMutation struct {
	Entry             LibraryEntry
	LibraryRevisionID string
	DraftID           string
	DraftETag         int64
	AuditID           string
	Replay            bool
}

type DeleteProjectLibraryEntryParams struct {
	LibraryRevisionID string
	EntryID           string
	Identity          LibraryMutationIdentity
}

type DeprecateProjectLibraryRevisionParams struct {
	LibraryRevisionID string
	Identity          LibraryMutationIdentity
}

type LibraryRevisionMutation struct {
	Revision  LibraryRevision
	DraftID   string
	DraftETag int64
	AuditID   string
	Replay    bool
}

type LibrarySearchParams struct {
	ProjectID string
	Query     string
	Kind      string
	Scope     string
	/* `T61-103` — lọc theo phân loại nghiệp vụ. So CHÍNH XÁC, không mờ: đây là
	   một tập giá trị đóng (`categoryOrder` của registry), nên khớp mờ chỉ tạo
	   ra kết quả không giải thích được. */
	Category string
	Limit    int
	After    *LibrarySearchKey
}

// LibrarySearchKey là khoá keyset của danh sách Control Library. Thứ tự phải
// khớp tuyệt đối với ORDER BY trong SearchLibraryEntries; libraryRevisionId là
// tie-break cuối vì cùng một entry có thể tồn tại ở nhiều revision.
type LibrarySearchKey struct {
	NameFolded        string
	EntryID           string
	LibraryRevisionID string
}

type RecordLibraryUsageParams struct {
	RevisionID        string
	ObjectID          string
	LibraryRevisionID string
	EntryID           string
	RequiredVersion   string
	UsageKind         string
}

func (s *Store) CreateProjectLibraryDraft(ctx context.Context, params CreateProjectLibraryDraftParams) (LibraryRevision, error) {
	return s.createProjectLibraryDraft(ctx, params, false)
}

// CreateProjectLibraryVersion tạo identity/version mới và clone snapshot parent.
// Dependency nội revision được pin sang version mới; parent không bị sửa.
func (s *Store) CreateProjectLibraryVersion(ctx context.Context, params CreateProjectLibraryDraftParams) (LibraryRevision, error) {
	if params.ParentLibraryRevisionID == "" {
		return LibraryRevision{}, fmt.Errorf("parentLibraryRevisionId là bắt buộc khi tạo version")
	}
	return s.createProjectLibraryDraft(ctx, params, true)
}

func (s *Store) createProjectLibraryDraft(ctx context.Context, params CreateProjectLibraryDraftParams, cloneParent bool) (LibraryRevision, error) {
	if err := validateUUIDs(params.LibraryRevisionID, params.ProjectID); err != nil {
		return LibraryRevision{}, err
	}
	if params.ParentLibraryRevisionID != "" {
		if err := validateUUIDs(params.ParentLibraryRevisionID); err != nil {
			return LibraryRevision{}, err
		}
	}
	if err := domain.ValidateProjectLibraryVersion(params.Version); err != nil {
		return LibraryRevision{}, err
	}
	if err := validateText("createdBy", params.CreatedBy, 1, 128); err != nil || params.AtUTCMS < 0 {
		if err != nil {
			return LibraryRevision{}, err
		}
		return LibraryRevision{}, fmt.Errorf("createdAtUtcMs không hợp lệ")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LibraryRevision{}, err
	}
	defer tx.Rollback()
	if params.ParentLibraryRevisionID != "" {
		var projectID, state, parentVersion string
		if err := tx.QueryRowContext(ctx, `SELECT project_id,state,version FROM library_revisions WHERE library_revision_id=? AND scope='PROJECT'`, params.ParentLibraryRevisionID).
			Scan(&projectID, &state, &parentVersion); errors.Is(err, sql.ErrNoRows) {
			return LibraryRevision{}, ErrNotFound
		} else if err != nil {
			return LibraryRevision{}, err
		} else if projectID != params.ProjectID || (state != LibraryStatePublished && state != LibraryStateDeprecated) {
			return LibraryRevision{}, fmt.Errorf("parent library revision không thuộc cùng Project hoặc chưa publish")
		}
		_ = parentVersion
	}
	manifest, digest, err := buildLibraryManifest(params.LibraryRevisionID, params.ProjectID, params.Version, nil)
	if err != nil {
		return LibraryRevision{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO library_revisions(
		library_revision_id,project_id,scope,version,parent_library_revision_id,state,
		manifest_json,manifest_sha256,created_by,created_at_utc_ms)
		VALUES(?,?,'PROJECT',?,?,'DRAFT',?,?,?,?)`, params.LibraryRevisionID, params.ProjectID,
		params.Version, nullableString(params.ParentLibraryRevisionID), manifest, digest[:], params.CreatedBy, params.AtUTCMS)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return LibraryRevision{}, ErrAlreadyExists
		}
		return LibraryRevision{}, fmt.Errorf("tạo PROJECT library Draft: %w", err)
	}
	if cloneParent {
		if err := cloneLibraryEntriesTx(ctx, tx, params.ParentLibraryRevisionID, params.LibraryRevisionID, params.Version); err != nil {
			return LibraryRevision{}, err
		}
		if err := refreshLibraryManifestTx(ctx, tx, params.LibraryRevisionID); err != nil {
			return LibraryRevision{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return LibraryRevision{}, err
	}
	return s.GetLibraryRevision(ctx, params.LibraryRevisionID)
}

func cloneLibraryEntriesTx(ctx context.Context, tx *sql.Tx, fromID, toID, newVersion string) error {
	rows, err := tx.QueryContext(ctx, libraryEntrySelect+` WHERE library_revision_id=? ORDER BY entry_id`, fromID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var entries []LibraryEntry
	for rows.Next() {
		entry, err := scanLibraryEntry(rows)
		if err != nil {
			return err
		}
		for index := range entry.Dependencies {
			entry.Dependencies[index].Version = newVersion
		}
		entry.LibraryRevisionID = toID
		entry.ContentSHA256, err = libraryEntryDigest(entry)
		if err != nil {
			return err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, entry := range entries {
		if err := insertLibraryEntryTx(ctx, tx, entry); err != nil {
			return err
		}
	}
	return nil
}

// EnsureProjectLibraryDraftTx trả về library revision DRAFT đang mở của Project.
// Nếu chưa có: Project chưa từng có library thì mở `1.0.0`; đã có bản publish thì
// mở version minor kế tiếp CLONE từ bản publish mới nhất. Không có route riêng để
// "tạo library" vì DDD §5.1 chỉ khoá route entry — thêm route ngoài thiết kế là
// tự chế contract, còn bắt người dùng tạo library thủ công trước khi thêm entry
// là dựng một bước không có trong luồng nào.
func ensureProjectLibraryDraftTx(ctx context.Context, tx *sql.Tx, projectID, newRevisionID string, at int64, actorID string) (string, error) {
	var draftID string
	err := tx.QueryRowContext(ctx, `SELECT library_revision_id FROM library_revisions
		WHERE scope='PROJECT' AND project_id=? AND state='DRAFT'
		ORDER BY created_at_utc_ms DESC,library_revision_id LIMIT 1`, projectID).Scan(&draftID)
	if err == nil {
		return draftID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	var parentID, parentVersion string
	version := "1.0.0"
	err = tx.QueryRowContext(ctx, `SELECT library_revision_id,version FROM library_revisions
		WHERE scope='PROJECT' AND project_id=? AND state IN ('PUBLISHED','DEPRECATED')
		ORDER BY created_at_utc_ms DESC,library_revision_id LIMIT 1`, projectID).Scan(&parentID, &parentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if err == nil {
		version, err = domain.NextProjectLibraryMinorVersion(parentVersion)
		if err != nil {
			return "", err
		}
	} else {
		parentID = ""
	}
	manifest, digest, err := buildLibraryManifest(newRevisionID, projectID, version, nil)
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO library_revisions(
		library_revision_id,project_id,scope,version,parent_library_revision_id,state,
		manifest_json,manifest_sha256,created_by,created_at_utc_ms)
		VALUES(?,?,'PROJECT',?,?,'DRAFT',?,?,?,?)`, newRevisionID, projectID, version,
		nullableString(parentID), manifest, digest[:], actorID, at); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return "", ErrAlreadyExists
		}
		return "", fmt.Errorf("mở PROJECT library Draft: %w", err)
	}
	if parentID != "" {
		if err := cloneLibraryEntriesTx(ctx, tx, parentID, newRevisionID, version); err != nil {
			return "", err
		}
		if err := refreshLibraryManifestTx(ctx, tx, newRevisionID); err != nil {
			return "", err
		}
	}
	return newRevisionID, nil
}

// lockProjectDraftTx ép mutation library đi qua đúng ETag Draft mà caller đã
// đọc, rồi tăng ETag đó. Không làm vậy thì hai lane (tài liệu và library) sửa
// xen kẽ nhau mà không lane nào thấy — đúng lớp lỗi mà `If-Match` sinh ra để
// chặn.
func lockProjectDraftTx(ctx context.Context, tx *sql.Tx, identity LibraryMutationIdentity, at int64) (string, int64, error) {
	var draftID string
	var actualETag int64
	if err := tx.QueryRowContext(ctx, `SELECT draft_id,etag FROM drafts WHERE project_id=?`, identity.ProjectID).
		Scan(&draftID, &actualETag); errors.Is(err, sql.ErrNoRows) {
		return "", 0, ErrNotFound
	} else if err != nil {
		return "", 0, err
	}
	if actualETag != identity.ExpectedDraftETag {
		return "", 0, ErrETagConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE drafts SET etag=etag+1,updated_by=?,updated_at_utc_ms=? WHERE draft_id=? AND etag=?`,
		identity.ActorID, at, draftID, identity.ExpectedDraftETag)
	if err != nil {
		return "", 0, fmt.Errorf("tăng ETag Draft sau mutation library: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil {
		return "", 0, err
	} else if rows != 1 {
		return "", 0, ErrETagConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE projects SET updated_by=?,updated_at_utc_ms=? WHERE project_id=?`,
		identity.ActorID, at, identity.ProjectID); err != nil {
		return "", 0, fmt.Errorf("cập nhật timestamp Project: %w", err)
	}
	return draftID, identity.ExpectedDraftETag + 1, nil
}

func validateLibraryMutationIdentity(identity LibraryMutationIdentity) error {
	if err := validateUUIDs(identity.ProjectID, identity.AuditID); err != nil {
		return err
	}
	if identity.ExpectedDraftETag < 1 {
		return fmt.Errorf("expected Draft ETag phải >=1")
	}
	if err := validateActorAudit(identity.ActorID, identity.Role, identity.CorrelationID, identity.At.UnixMilli()); err != nil {
		return err
	}
	return validateMutationIdentity(identity.IdempotencyKeySHA256, identity.RequestSHA256)
}

func (s *Store) UpsertProjectLibraryEntry(ctx context.Context, params UpsertProjectLibraryEntryParams) (LibraryEntryMutation, error) {
	if err := validateLibraryMutationIdentity(params.Identity); err != nil {
		return LibraryEntryMutation{}, err
	}
	// LibraryRevisionID rỗng nghĩa là "dùng Draft library đang mở của Project".
	// Khi caller nêu tên tường minh, nó vẫn phải là Draft của đúng Project đó.
	autoDraftID := params.LibraryRevisionID
	if autoDraftID == "" {
		if err := validateUUIDs(params.NewLibraryRevisionID); err != nil {
			return LibraryEntryMutation{}, err
		}
		autoDraftID = params.NewLibraryRevisionID
	}
	entryParams := params
	entryParams.LibraryRevisionID = autoDraftID
	entry, err := prepareProjectLibraryEntry(entryParams, false)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	at := params.Identity.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.Identity.ActorID, actionLibraryEntryUpsert,
		params.EntryID, params.Identity.IdempotencyKeySHA256, params.Identity.RequestSHA256, at)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return LibraryEntryMutation{}, err
		}
		return LibraryEntryMutation{LibraryRevisionID: receipt.RevisionID, DraftID: receipt.DraftID,
			DraftETag: receipt.ETag, AuditID: receipt.AuditID, Replay: true}, nil
	}
	draftID, nextETag, err := lockProjectDraftTx(ctx, tx, params.Identity, at)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	libraryRevisionID := params.LibraryRevisionID
	if libraryRevisionID == "" {
		libraryRevisionID, err = ensureProjectLibraryDraftTx(ctx, tx, params.Identity.ProjectID, autoDraftID, at, params.Identity.ActorID)
		if err != nil {
			return LibraryEntryMutation{}, err
		}
	}
	if err := requireMutableProjectLibraryOfProjectTx(ctx, tx, libraryRevisionID, params.Identity.ProjectID); err != nil {
		return LibraryEntryMutation{}, err
	}
	// Dependency của PROJECT Library luôn trỏ tới entry trong CHÍNH revision
	// đang sửa. Khi mutation đầu tiên sau một bản publish tự mở Draft minor mới,
	// client vẫn chỉ có snapshot PUBLISHED cũ và vì vậy gửi version cũ. Clone đã
	// re-pin toàn bộ entry sang version mới; nếu tin payload cũ ở đây thì riêng
	// entry vừa sửa lại bị kéo ngược về version parent và Publish/Check thất bại
	// với LIB-VERSION-001. Version của revision trong transaction mới là nguồn
	// sự thật: pin lại trước khi tính content hash và ghi DB.
	revision, err := getLibraryRevisionTx(ctx, tx, libraryRevisionID)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	for index := range entry.Dependencies {
		entry.Dependencies[index].Version = revision.Version
	}
	entry.LibraryRevisionID = libraryRevisionID
	if entry.ContentSHA256, err = libraryEntryDigest(entry); err != nil {
		return LibraryEntryMutation{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO library_entries(
		library_revision_id,entry_id,kind,name,name_folded,feature_state,signature_json,content_sha256,
		language,source_blob,interface_json,dependencies_json,state_layout_version,state_size_bytes,state_layout_sha256,
		category,description,presentation_sha256)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(library_revision_id,entry_id) DO UPDATE SET
		kind=excluded.kind,name=excluded.name,name_folded=excluded.name_folded,
		feature_state=excluded.feature_state,signature_json=excluded.signature_json,
		content_sha256=excluded.content_sha256,language=excluded.language,source_blob=excluded.source_blob,
		interface_json=excluded.interface_json,dependencies_json=excluded.dependencies_json,
		state_layout_version=excluded.state_layout_version,state_size_bytes=excluded.state_size_bytes,
		state_layout_sha256=excluded.state_layout_sha256,
		category=excluded.category,description=excluded.description,
		presentation_sha256=excluded.presentation_sha256`, libraryEntrySQLArgs(entry)...); err != nil {
		if strings.Contains(err.Error(), "library_entries_name_idx") || strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return LibraryEntryMutation{}, ErrAlreadyExists
		}
		return LibraryEntryMutation{}, fmt.Errorf("upsert PROJECT library entry: %w", err)
	}
	if err := refreshLibraryManifestTx(ctx, tx, libraryRevisionID); err != nil {
		return LibraryEntryMutation{}, err
	}
	details, _ := json.Marshal(map[string]any{"libraryRevisionId": libraryRevisionID, "entryId": params.EntryID,
		"kind": entry.Kind, "language": entry.Language, "contentSha256": hex.EncodeToString(entry.ContentSHA256[:]),
		"dependencyCount": len(entry.Dependencies)})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.Identity.AuditID, ActorID: params.Identity.ActorID,
		Role: params.Identity.Role, Action: actionLibraryEntryUpsert, TargetType: "LIBRARY_ENTRY", TargetID: params.EntryID,
		OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: params.Identity.CorrelationID, DetailsJSON: details}); err != nil {
		return LibraryEntryMutation{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.Identity.ActorID, actionLibraryEntryUpsert, params.EntryID,
		params.Identity.IdempotencyKeySHA256, params.Identity.RequestSHA256,
		mutationReceiptResult{ProjectID: params.Identity.ProjectID, DraftID: draftID, RevisionID: libraryRevisionID,
			ETag: nextETag, AuditID: params.Identity.AuditID}, at); err != nil {
		return LibraryEntryMutation{}, err
	}
	if err := tx.Commit(); err != nil {
		return LibraryEntryMutation{}, err
	}
	stored, err := s.GetLibraryEntry(ctx, libraryRevisionID, params.EntryID)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	return LibraryEntryMutation{Entry: stored, LibraryRevisionID: libraryRevisionID, DraftID: draftID,
		DraftETag: nextETag, AuditID: params.Identity.AuditID}, nil
}

func (s *Store) DeleteProjectLibraryEntry(ctx context.Context, params DeleteProjectLibraryEntryParams) (LibraryEntryMutation, error) {
	if err := validateLibraryMutationIdentity(params.Identity); err != nil {
		return LibraryEntryMutation{}, err
	}
	if err := validateUUIDs(params.EntryID); err != nil {
		return LibraryEntryMutation{}, err
	}
	at := params.Identity.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.Identity.ActorID, actionLibraryEntryDelete,
		params.EntryID, params.Identity.IdempotencyKeySHA256, params.Identity.RequestSHA256, at)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return LibraryEntryMutation{}, err
		}
		return LibraryEntryMutation{LibraryRevisionID: receipt.RevisionID, DraftID: receipt.DraftID,
			DraftETag: receipt.ETag, AuditID: receipt.AuditID, Replay: true}, nil
	}
	libraryRevisionID := params.LibraryRevisionID
	if libraryRevisionID == "" {
		if err := tx.QueryRowContext(ctx, `SELECT library_revision_id FROM library_revisions
			WHERE scope='PROJECT' AND project_id=? AND state='DRAFT'
			ORDER BY created_at_utc_ms DESC,library_revision_id LIMIT 1`, params.Identity.ProjectID).
			Scan(&libraryRevisionID); errors.Is(err, sql.ErrNoRows) {
			return LibraryEntryMutation{}, ErrNotFound
		} else if err != nil {
			return LibraryEntryMutation{}, err
		}
	}
	if err := requireMutableProjectLibraryOfProjectTx(ctx, tx, libraryRevisionID, params.Identity.ProjectID); err != nil {
		return LibraryEntryMutation{}, err
	}
	draftID, nextETag, err := lockProjectDraftTx(ctx, tx, params.Identity, at)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	entries, err := listProjectLibraryEntriesTx(ctx, tx, libraryRevisionID)
	if err != nil {
		return LibraryEntryMutation{}, err
	}
	for _, entry := range entries {
		if strings.EqualFold(entry.EntryID, params.EntryID) {
			continue
		}
		for _, dependency := range entry.Dependencies {
			if strings.EqualFold(dependency.EntryID, params.EntryID) {
				return LibraryEntryMutation{}, fmt.Errorf("%w: %s <- %s", ErrLibraryReferenced, entry.EntryID, params.EntryID)
			}
		}
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM library_entries WHERE library_revision_id=? AND entry_id=?`, libraryRevisionID, params.EntryID)
	if err != nil {
		if strings.Contains(err.Error(), "FOREIGN KEY constraint failed") {
			return LibraryEntryMutation{}, ErrLibraryReferenced
		}
		return LibraryEntryMutation{}, err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return LibraryEntryMutation{}, ErrNotFound
	}
	if err := refreshLibraryManifestTx(ctx, tx, libraryRevisionID); err != nil {
		return LibraryEntryMutation{}, err
	}
	details, _ := json.Marshal(map[string]any{"libraryRevisionId": libraryRevisionID, "entryId": params.EntryID})
	if _, err := appendAuditTx(ctx, tx, AuditInput{AuditID: params.Identity.AuditID, ActorID: params.Identity.ActorID,
		Role: params.Identity.Role, Action: actionLibraryEntryDelete, TargetType: "LIBRARY_ENTRY", TargetID: params.EntryID,
		OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: params.Identity.CorrelationID, DetailsJSON: details}); err != nil {
		return LibraryEntryMutation{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.Identity.ActorID, actionLibraryEntryDelete, params.EntryID,
		params.Identity.IdempotencyKeySHA256, params.Identity.RequestSHA256,
		mutationReceiptResult{ProjectID: params.Identity.ProjectID, DraftID: draftID, RevisionID: libraryRevisionID,
			ETag: nextETag, AuditID: params.Identity.AuditID}, at); err != nil {
		return LibraryEntryMutation{}, err
	}
	if err := tx.Commit(); err != nil {
		return LibraryEntryMutation{}, err
	}
	return LibraryEntryMutation{LibraryRevisionID: libraryRevisionID, DraftID: draftID,
		DraftETag: nextETag, AuditID: params.Identity.AuditID}, nil
}

func (s *Store) PublishProjectLibrary(ctx context.Context, libraryRevisionID string) (LibraryRevision, error) {
	if err := validateUUIDs(libraryRevisionID); err != nil {
		return LibraryRevision{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LibraryRevision{}, err
	}
	defer tx.Rollback()
	if err := publishProjectLibraryTx(ctx, tx, libraryRevisionID); err != nil {
		return LibraryRevision{}, err
	}
	if err := tx.Commit(); err != nil {
		return LibraryRevision{}, err
	}
	return s.GetLibraryRevision(ctx, libraryRevisionID)
}

// publishProjectLibraryTx tách ra để Seal Revision publish library trong CÙNG
// transaction với việc đóng băng Revision. Publish ở transaction riêng cho phép
// một lần crash để lại library đã publish mà không Revision nào trỏ tới — version
// bị tiêu mà không ai dùng, và người vận hành không hiểu vì sao số nhảy.
func publishProjectLibraryTx(ctx context.Context, tx *sql.Tx, libraryRevisionID string) error {
	revision, err := getLibraryRevisionTx(ctx, tx, libraryRevisionID)
	if err != nil {
		return err
	}
	if revision.Scope != LibraryScopeProject || revision.State != LibraryStateDraft {
		return ErrLibraryImmutable
	}
	entries, err := listProjectLibraryEntriesTx(ctx, tx, libraryRevisionID)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		return fmt.Errorf("PROJECT library không có entry")
	}
	canonicalEntries := make([]LibraryEntry, 0, len(entries))
	for _, entry := range entries {
		canonical, err := prepareProjectLibraryEntry(UpsertProjectLibraryEntryParams{
			LibraryRevisionID: entry.LibraryRevisionID, EntryID: entry.EntryID, Kind: entry.Kind,
			Name: entry.Name, Language: entry.Language, FeatureState: entry.FeatureState,
			Source: entry.Source, InterfaceJSON: entry.InterfaceJSON, Dependencies: entry.Dependencies,
			StateLayout: entry.StateLayout,
		}, true)
		if err != nil {
			return err
		}
		if canonical.ContentSHA256 != entry.ContentSHA256 {
			return fmt.Errorf("entry %s content checksum mismatch", entry.EntryID)
		}
		canonicalEntries = append(canonicalEntries, canonical)
	}
	// Canonical source/interface/dependency order là dữ liệu authoritative của
	// snapshot publish, không chỉ là bản tạm dùng để tính manifest. Mọi rewrite
	// diễn ra trước state transition và cùng transaction nên fault sẽ rollback
	// cả entries lẫn manifest.
	for _, entry := range canonicalEntries {
		if err := updateLibraryEntryTx(ctx, tx, entry); err != nil {
			return fmt.Errorf("canonicalize PROJECT library entry %s: %w", entry.EntryID, err)
		}
	}
	manifest, manifestDigest, err := buildPublishedLibraryManifest(revision, canonicalEntries)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE library_revisions SET manifest_json=?,manifest_sha256=?,state='PUBLISHED'
		WHERE library_revision_id=? AND state='DRAFT'`, manifest, manifestDigest[:], libraryRevisionID); err != nil {
		return fmt.Errorf("publish PROJECT library: %w", err)
	}
	return nil
}

func (s *Store) DeprecateProjectLibraryRevision(ctx context.Context,
	params DeprecateProjectLibraryRevisionParams) (LibraryRevisionMutation, error) {
	if err := validateLibraryMutationIdentity(params.Identity); err != nil {
		return LibraryRevisionMutation{}, err
	}
	if err := validateUUIDs(params.LibraryRevisionID); err != nil {
		return LibraryRevisionMutation{}, err
	}
	at := params.Identity.At.UTC().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LibraryRevisionMutation{}, err
	}
	defer tx.Rollback()
	receipt, found, err := readMutationReceiptTx(ctx, tx, params.Identity.ActorID, actionLibraryRevisionDeprecate,
		params.LibraryRevisionID, params.Identity.IdempotencyKeySHA256, params.Identity.RequestSHA256, at)
	if err != nil {
		return LibraryRevisionMutation{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return LibraryRevisionMutation{}, err
		}
		revision, err := s.GetLibraryRevision(ctx, params.LibraryRevisionID)
		if err != nil {
			return LibraryRevisionMutation{}, err
		}
		if revision.State != LibraryStateDeprecated {
			return LibraryRevisionMutation{}, fmt.Errorf("receipt deprecate lệch read-back PROJECT library")
		}
		return LibraryRevisionMutation{Revision: revision, DraftID: receipt.DraftID,
			DraftETag: receipt.ETag, AuditID: receipt.AuditID, Replay: true}, nil
	}
	revision, err := getLibraryRevisionTx(ctx, tx, params.LibraryRevisionID)
	if err != nil {
		return LibraryRevisionMutation{}, err
	}
	// Sai Project được che thành not-found để một admin không dùng route này
	// thăm dò identity library của Project khác.
	if revision.Scope != LibraryScopeProject || revision.ProjectID != params.Identity.ProjectID {
		return LibraryRevisionMutation{}, ErrNotFound
	}
	if revision.State != LibraryStatePublished {
		return LibraryRevisionMutation{}, ErrLibraryImmutable
	}
	draftID, nextETag, err := lockProjectDraftTx(ctx, tx, params.Identity, at)
	if err != nil {
		return LibraryRevisionMutation{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE library_revisions SET state='DEPRECATED'
		WHERE library_revision_id=? AND project_id=? AND scope='PROJECT' AND state='PUBLISHED'`,
		params.LibraryRevisionID, params.Identity.ProjectID)
	if err != nil {
		return LibraryRevisionMutation{}, fmt.Errorf("deprecate PROJECT library: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil {
		return LibraryRevisionMutation{}, err
	} else if rows != 1 {
		return LibraryRevisionMutation{}, ErrLibraryImmutable
	}
	details, _ := json.Marshal(map[string]any{
		"libraryRevisionId": params.LibraryRevisionID, "version": revision.Version,
		"previousState": LibraryStatePublished, "state": LibraryStateDeprecated,
	})
	if _, err := appendAuditTx(ctx, tx, AuditInput{
		AuditID: params.Identity.AuditID, ActorID: params.Identity.ActorID, Role: params.Identity.Role,
		Action: actionLibraryRevisionDeprecate, TargetType: "LIBRARY_REVISION", TargetID: params.LibraryRevisionID,
		OccurredAtUTCMS: at, ResultCode: "OK", CorrelationID: params.Identity.CorrelationID, DetailsJSON: details,
	}); err != nil {
		return LibraryRevisionMutation{}, err
	}
	if err := writeMutationReceiptTx(ctx, tx, params.Identity.ActorID, actionLibraryRevisionDeprecate,
		params.LibraryRevisionID, params.Identity.IdempotencyKeySHA256, params.Identity.RequestSHA256,
		mutationReceiptResult{ProjectID: params.Identity.ProjectID, DraftID: draftID,
			RevisionID: params.LibraryRevisionID, ETag: nextETag, AuditID: params.Identity.AuditID}, at); err != nil {
		return LibraryRevisionMutation{}, err
	}
	if err := tx.Commit(); err != nil {
		return LibraryRevisionMutation{}, err
	}
	deprecated, err := s.GetLibraryRevision(ctx, params.LibraryRevisionID)
	if err != nil {
		return LibraryRevisionMutation{}, err
	}
	if deprecated.State != LibraryStateDeprecated {
		return LibraryRevisionMutation{}, fmt.Errorf("read-back PROJECT library chưa DEPRECATED")
	}
	return LibraryRevisionMutation{Revision: deprecated, DraftID: draftID,
		DraftETag: nextETag, AuditID: params.Identity.AuditID}, nil
}

func (s *Store) GetLibraryRevision(ctx context.Context, libraryRevisionID string) (LibraryRevision, error) {
	if s.system != nil && s.system.Revision.LibraryRevisionID == libraryRevisionID {
		return cloneLibraryRevision(s.system.Revision), nil
	}
	return getLibraryRevisionQuery(ctx, s.db, libraryRevisionID)
}

func (s *Store) ListLibraryRevisions(ctx context.Context, projectID, scope string) ([]LibraryRevision, error) {
	if scope != "" && scope != LibraryScopeProject && scope != LibraryScopeSystem {
		return nil, fmt.Errorf("library scope không hợp lệ")
	}
	if projectID != "" {
		if err := validateUUIDs(projectID); err != nil {
			return nil, err
		}
	}
	if scope == LibraryScopeProject && projectID == "" {
		return nil, fmt.Errorf("PROJECT library list bắt buộc projectId")
	}
	var revisions []LibraryRevision
	if s.system != nil && (scope == "" || scope == LibraryScopeSystem) {
		revisions = append(revisions, cloneLibraryRevision(s.system.Revision))
	}
	if scope != LibraryScopeSystem && projectID != "" {
		rows, err := s.db.QueryContext(ctx, `SELECT library_revision_id,project_id,scope,version,parent_library_revision_id,state,
			manifest_json,manifest_sha256,created_by,created_at_utc_ms FROM library_revisions
			WHERE scope='PROJECT' AND project_id=? ORDER BY created_at_utc_ms DESC,library_revision_id`, projectID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			revision, err := scanLibraryRevision(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			revisions = append(revisions, revision)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return revisions, nil
}

func (s *Store) GetLibraryEntry(ctx context.Context, libraryRevisionID, entryID string) (LibraryEntry, error) {
	if s.system != nil && s.system.Revision.LibraryRevisionID == libraryRevisionID {
		for _, entry := range s.system.Entries {
			if strings.EqualFold(entry.EntryID, entryID) {
				return cloneLibraryEntry(entry), nil
			}
		}
		return LibraryEntry{}, ErrNotFound
	}
	row := s.db.QueryRowContext(ctx, libraryEntrySelect+` WHERE library_revision_id=? AND entry_id=?`, libraryRevisionID, entryID)
	entry, err := scanLibraryEntry(row)
	if errors.Is(err, sql.ErrNoRows) {
		return LibraryEntry{}, ErrNotFound
	}
	return entry, err
}

func (s *Store) ListLibraryEntries(ctx context.Context, libraryRevisionID string) ([]LibraryEntry, error) {
	if s.system != nil && s.system.Revision.LibraryRevisionID == libraryRevisionID {
		entries := make([]LibraryEntry, len(s.system.Entries))
		for index := range s.system.Entries {
			entries[index] = cloneLibraryEntry(s.system.Entries[index])
		}
		return entries, nil
	}
	rows, err := s.db.QueryContext(ctx, libraryEntrySelect+` WHERE library_revision_id=? ORDER BY name_folded,entry_id`, libraryRevisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []LibraryEntry
	for rows.Next() {
		entry, err := scanLibraryEntry(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) SearchLibraryEntries(ctx context.Context, params LibrarySearchParams) ([]LibraryEntry, error) {
	if params.Limit == 0 {
		params.Limit = 100
	}
	if params.Limit < 1 || params.Limit > 101 {
		return nil, fmt.Errorf("library search limit không hợp lệ")
	}
	if params.Scope != "" && params.Scope != LibraryScopeProject && params.Scope != LibraryScopeSystem {
		return nil, fmt.Errorf("library search scope không hợp lệ")
	}
	if params.Kind != "" && !validLibraryKind(params.Kind) {
		return nil, fmt.Errorf("library search kind không hợp lệ")
	}
	if params.Scope == LibraryScopeProject && params.ProjectID == "" {
		return nil, fmt.Errorf("PROJECT library search bắt buộc projectId")
	}
	if params.ProjectID != "" {
		if err := validateUUIDs(params.ProjectID); err != nil {
			return nil, err
		}
	}
	if params.After != nil {
		if err := validateText("library search after name", params.After.NameFolded, 1, 64); err != nil {
			return nil, fmt.Errorf("library search key không hợp lệ: %w", err)
		}
		if err := validateText("library search after entryId", params.After.EntryID, 1, 128); err != nil {
			return nil, fmt.Errorf("library search key không hợp lệ: %w", err)
		}
		if err := validateText("library search after revisionId", params.After.LibraryRevisionID, 1, 128); err != nil {
			return nil, fmt.Errorf("library search key không hợp lệ: %w", err)
		}
		if params.After.NameFolded != strings.ToUpper(params.After.NameFolded) {
			return nil, fmt.Errorf("library search key không canonical")
		}
	}
	query := strings.ToUpper(strings.TrimSpace(params.Query))
	var result []LibraryEntry
	if s.system != nil && (params.Scope == "" || params.Scope == LibraryScopeSystem) {
		for _, entry := range s.system.Entries {
			if (params.Kind == "" || entry.Kind == params.Kind) &&
				(params.Category == "" || (entry.Category != nil && *entry.Category == params.Category)) &&
				(query == "" || libraryEntryMatchesQuery(entry, query)) &&
				(params.After == nil || compareLibraryEntryWithKey(entry, *params.After) > 0) {
				result = append(result, cloneLibraryEntry(entry))
			}
		}
	}
	if params.Scope != LibraryScopeSystem && params.ProjectID != "" {
		arguments := []any{params.ProjectID, params.Kind, params.Kind,
			params.Category, params.Category,
			query, query, query, query}
		arguments = append(arguments, librarySearchAfterSQLArgs(params.After, params.Limit)...)
		rows, err := s.db.QueryContext(ctx, libraryEntrySelect+` JOIN library_revisions r USING(library_revision_id)
			WHERE r.scope='PROJECT' AND r.project_id=? AND (?='' OR e.kind=?)
			AND (?='' OR e.category=?)
			AND (?='' OR instr(e.name_folded,?)>0 OR instr(upper(e.entry_id),?)>0
				OR instr(upper(coalesce(e.description,'')),?)>0)
			AND (?='' OR e.name_folded>? OR
				(e.name_folded=? AND e.entry_id>?) OR
				(e.name_folded=? AND e.entry_id=? AND e.library_revision_id>?))
			ORDER BY e.name_folded,e.entry_id,e.library_revision_id LIMIT ?`, arguments...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			entry, err := scanLibraryEntry(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			result = append(result, entry)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	sort.Slice(result, func(left, right int) bool {
		return compareLibraryEntries(result[left], result[right]) < 0
	})
	if len(result) > params.Limit {
		result = result[:params.Limit]
	}
	return result, nil
}

func librarySearchAfterSQLArgs(after *LibrarySearchKey, limit int) []any {
	if after == nil {
		return []any{"", "", "", "", "", "", "", limit}
	}
	return []any{after.NameFolded, after.NameFolded, after.NameFolded, after.EntryID,
		after.NameFolded, after.EntryID, after.LibraryRevisionID, limit}
}

func compareLibraryEntries(left, right LibraryEntry) int {
	return compareLibraryEntryWithKey(left, LibrarySearchKey{
		NameFolded: strings.ToUpper(right.Name), EntryID: right.EntryID, LibraryRevisionID: right.LibraryRevisionID,
	})
}

func compareLibraryEntryWithKey(entry LibraryEntry, key LibrarySearchKey) int {
	nameFolded := strings.ToUpper(entry.Name)
	if nameFolded < key.NameFolded {
		return -1
	}
	if nameFolded > key.NameFolded {
		return 1
	}
	if entry.EntryID < key.EntryID {
		return -1
	}
	if entry.EntryID > key.EntryID {
		return 1
	}
	if entry.LibraryRevisionID < key.LibraryRevisionID {
		return -1
	}
	if entry.LibraryRevisionID > key.LibraryRevisionID {
		return 1
	}
	return 0
}

type preparedPOUObject struct {
	objectID, kind, name, language string
	interfaceJSON, source          []byte
	dependenciesJSON               []byte
	dependencies                   []LibraryDependency
	digest                         [sha256.Size]byte
}

func prepareRevisionPOUObjects(inputs []POUObjectInput) ([]preparedPOUObject, error) {
	prepared := make([]preparedPOUObject, 0, len(inputs))
	seenIDs := make(map[string]struct{}, len(inputs))
	seenNames := make(map[string]struct{}, len(inputs))
	for _, input := range inputs {
		if err := validateUUIDs(input.ObjectID); err != nil {
			return nil, err
		}
		if input.Kind != "PROGRAM" && input.Kind != "FUNCTION" && input.Kind != "FUNCTION_BLOCK" {
			return nil, fmt.Errorf("POU kind không hợp lệ: %s", input.Kind)
		}
		if !libraryIECNamePattern.MatchString(input.Name) || (input.Language != "ST" && input.Language != "FBD") {
			return nil, fmt.Errorf("POU name/language không hợp lệ")
		}
		if _, duplicate := seenIDs[input.ObjectID]; duplicate {
			return nil, fmt.Errorf("POU objectId trùng: %s", input.ObjectID)
		}
		nameKey := strings.ToUpper(input.Name)
		if _, duplicate := seenNames[nameKey]; duplicate {
			return nil, fmt.Errorf("POU name trùng case-insensitive: %s", input.Name)
		}
		seenIDs[input.ObjectID], seenNames[nameKey] = struct{}{}, struct{}{}
		if len(input.SourceBlob) < 1 || len(input.SourceBlob) > 65536 || !utf8.Valid(input.SourceBlob) {
			return nil, fmt.Errorf("POU source phải là UTF-8 1..65536 byte")
		}
		source := append([]byte(nil), input.SourceBlob...)
		var err error
		if input.Language == "FBD" {
			source, err = canonicalJSONObject(source, 65536)
			if err != nil {
				return nil, fmt.Errorf("POU FBD source: %w", err)
			}
		}
		interfaceJSON, err := canonicalJSONObject(input.InterfaceJSON, 262144)
		if err != nil {
			return nil, fmt.Errorf("POU interface: %w", err)
		}
		dependencies, err := normalizeLibraryDependencies(input.Dependencies)
		if err != nil {
			return nil, err
		}
		dependenciesJSON, err := json.Marshal(dependencies)
		if err != nil || len(dependenciesJSON) > 65536 {
			return nil, fmt.Errorf("POU dependencies vượt giới hạn")
		}
		domainEntry := domain.LibraryEntry{
			LibraryRevisionID: "revision-snapshot", EntryID: input.ObjectID,
			Kind: domain.LibraryEntryKind(input.Kind), Name: input.Name,
			FeatureState: domain.LibraryFeatureAvailable, Language: domain.LibraryLanguage(input.Language),
			SourceBlob: source, InterfaceJSON: interfaceJSON,
			Dependencies: make([]domain.LibraryDependency, len(dependencies)),
		}
		for index, dependency := range dependencies {
			domainEntry.Dependencies[index] = domain.LibraryDependency{EntryID: dependency.EntryID, Version: dependency.Version}
		}
		digest, err := domain.ProjectLibraryEntryContentSHA256(domainEntry)
		if err != nil {
			return nil, err
		}
		prepared = append(prepared, preparedPOUObject{input.ObjectID, input.Kind, input.Name,
			input.Language, interfaceJSON, source, dependenciesJSON, dependencies, digest})
	}
	return prepared, nil
}

func insertRevisionLibrarySnapshotTx(ctx context.Context, tx *sql.Tx, revisionID, projectID, libraryRevisionID string,
	pous []preparedPOUObject) error {
	for _, pou := range pous {
		if _, err := tx.ExecContext(ctx, `INSERT INTO pou_objects(revision_id,object_id,kind,name,name_folded,language,
			interface_json,source_blob,dependencies_json,content_sha256) VALUES(?,?,?,?,?,?,?,?,?,?)`,
			revisionID, pou.objectID, pou.kind, pou.name, strings.ToUpper(pou.name), pou.language,
			pou.interfaceJSON, pou.source, pou.dependenciesJSON, pou.digest[:]); err != nil {
			return fmt.Errorf("seal POU object: %w", err)
		}
	}
	if libraryRevisionID == "" {
		if countPreparedPOUDependencies(pous) != 0 {
			return fmt.Errorf("POU dependency thiếu projectLibraryRevisionId")
		}
		return nil
	}
	var version, libraryProject, state string
	if err := tx.QueryRowContext(ctx, `SELECT version,project_id,state FROM library_revisions
		WHERE library_revision_id=? AND scope='PROJECT'`, libraryRevisionID).Scan(&version, &libraryProject, &state); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if libraryProject != projectID || (state != LibraryStatePublished && state != LibraryStateDeprecated) {
		return fmt.Errorf("projectLibraryRevisionId không thuộc Project hoặc chưa publish")
	}
	for _, pou := range pous {
		for _, dependency := range pou.dependencies {
			if dependency.Version != version {
				return &domain.LibraryResolutionError{Cause: domain.ErrLibraryVersionMismatch, EntryID: dependency.EntryID,
					RequiredBy: pou.objectID, ExpectedVersion: dependency.Version, ActualVersion: version}
			}
			var entryKind string
			if err := tx.QueryRowContext(ctx, `SELECT kind FROM library_entries WHERE library_revision_id=? AND entry_id=?`,
				libraryRevisionID, dependency.EntryID).Scan(&entryKind); errors.Is(err, sql.ErrNoRows) {
				return &domain.LibraryResolutionError{Cause: domain.ErrLibraryEntryMissing, EntryID: dependency.EntryID, RequiredBy: pou.objectID}
			} else if err != nil {
				return err
			}
			var usageKind string
			switch entryKind {
			case LibraryKindFunction:
				usageKind = "CALL"
			case LibraryKindFunctionBlock:
				usageKind = "INSTANCE"
			default:
				return fmt.Errorf("PROJECT library entry kind không hợp lệ: %s", entryKind)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO library_usages(
			revision_id,object_id,library_revision_id,entry_id,required_version,usage_kind)
			VALUES(?,?,?,?,?,?)`, revisionID, pou.objectID, libraryRevisionID, dependency.EntryID, version, usageKind); err != nil {
				return fmt.Errorf("seal library usage: %w", err)
			}
		}
	}
	return nil
}

func countPreparedPOUDependencies(pous []preparedPOUObject) int {
	count := 0
	for _, pou := range pous {
		count += len(pou.dependencies)
	}
	return count
}

func (s *Store) ListLibraryUsages(ctx context.Context, libraryRevisionID, entryID string) ([]LibraryUsage, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT revision_id,object_id,library_revision_id,entry_id,required_version,usage_kind
		FROM library_usages WHERE library_revision_id=? AND (?='' OR entry_id=?) ORDER BY revision_id,object_id,entry_id,usage_kind`,
		libraryRevisionID, entryID, entryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var usages []LibraryUsage
	for rows.Next() {
		var usage LibraryUsage
		if err := rows.Scan(&usage.RevisionID, &usage.ObjectID, &usage.LibraryRevisionID, &usage.EntryID, &usage.RequiredVersion, &usage.UsageKind); err != nil {
			return nil, err
		}
		usages = append(usages, usage)
	}
	return usages, rows.Err()
}

const libraryEntrySelect = `SELECT e.library_revision_id,e.entry_id,e.kind,e.name,e.language,e.feature_state,
	e.source_blob,e.interface_json,e.signature_json,e.dependencies_json,e.state_layout_version,e.state_size_bytes,e.state_layout_sha256,e.content_sha256,
	e.category,e.description,e.presentation_sha256
	FROM library_entries e`

func prepareProjectLibraryEntry(params UpsertProjectLibraryEntryParams, publishing bool) (LibraryEntry, error) {
	if err := validateUUIDs(params.LibraryRevisionID); err != nil {
		return LibraryEntry{}, err
	}
	if err := validateUUIDs(params.EntryID); err != nil {
		return LibraryEntry{}, err
	}
	if !libraryIECNamePattern.MatchString(params.Name) {
		return LibraryEntry{}, fmt.Errorf("name Control Library không hợp lệ")
	}
	if (params.Kind != LibraryKindFunction && params.Kind != LibraryKindFunctionBlock) ||
		(params.Language != "ST" && params.Language != "FBD") ||
		(params.FeatureState != "AVAILABLE" && params.FeatureState != "REVIEW_REQUIRED") {
		return LibraryEntry{}, fmt.Errorf("kind/language/featureState Control Library không hợp lệ")
	}
	if len(params.Source) < 1 || len(params.Source) > 65536 || !utf8.Valid(params.Source) {
		return LibraryEntry{}, fmt.Errorf("library source phải là UTF-8 1..65536 byte")
	}
	source := append([]byte(nil), params.Source...)
	if params.Language == "FBD" {
		var err error
		source, err = canonicalJSONObject(source, 65536)
		if err != nil {
			return LibraryEntry{}, fmt.Errorf("FBD source: %w", err)
		}
	}
	interfaceJSON, err := canonicalJSONObject(params.InterfaceJSON, 262144)
	if err != nil {
		return LibraryEntry{}, fmt.Errorf("library interface: %w", err)
	}
	dependencies, err := normalizeLibraryDependencies(params.Dependencies)
	if err != nil {
		return LibraryEntry{}, err
	}
	if err := validateLibraryStateLayout(params.Kind, params.StateLayout, publishing); err != nil {
		return LibraryEntry{}, err
	}
	entry := LibraryEntry{LibraryRevisionID: params.LibraryRevisionID, EntryID: params.EntryID,
		Kind: params.Kind, Name: params.Name, Language: params.Language, FeatureState: params.FeatureState,
		Source: source, InterfaceJSON: interfaceJSON, SignatureJSON: append([]byte(nil), projectLibraryLegacySignature...),
		Dependencies: dependencies, StateLayout: params.StateLayout}
	/* `T61-103` — metadata TRÌNH BÀY được gán SAU khi tính `ContentSHA256`.
	   Thứ tự này là bản thân bất biến `D61-09`: danh tính thực thi không được
	   phụ thuộc vào mô tả. Đảo thứ tự ở đây sẽ làm mỗi lần sửa chính tả sinh ra
	   một `contentSha256` mới, và mọi artifact đã ký thành lỗi thời. */
	entry.ContentSHA256, err = libraryEntryDigest(entry)
	if err != nil {
		return entry, err
	}
	if params.Category != nil {
		if len(*params.Category) > 32 {
			return LibraryEntry{}, fmt.Errorf("library entry category vượt 32 ký tự")
		}
		value := *params.Category
		entry.Category = &value
	}
	if params.Description != nil {
		if len(*params.Description) > 512 {
			return LibraryEntry{}, fmt.Errorf("library entry description vượt 512 ký tự")
		}
		value := *params.Description
		entry.Description = &value
	}
	entry.PresentationSHA256 = libraryPresentationDigest(entry.Category, entry.Description)
	return entry, nil
}

/*
libraryPresentationDigest băm RIÊNG phần trình bày.

Nó cho client biết mô tả có đổi hay không mà không phải so từng trường, và quan
trọng hơn: nó tồn tại để KHÔNG ai bị cám dỗ nhét mô tả vào `contentSha256`. Khi
cả hai đều rỗng thì trả `nil` — "chưa ai điền" phải phân biệt được với "đã điền
rồi và nội dung rỗng".
*/
func libraryPresentationDigest(category, description *string) []byte {
	if category == nil && description == nil {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{"category": category, "description": description})
	digest := sha256.Sum256(payload)
	return digest[:]
}

func validLibraryKind(kind string) bool {
	return kind == LibraryKindFunction || kind == LibraryKindFunctionBlock || kind == LibraryKindConversion
}

func validateLibraryStateLayout(kind string, layout LibraryStateLayout, publishing bool) error {
	zero := [sha256.Size]byte{}
	switch kind {
	case LibraryKindFunction, LibraryKindConversion:
		if !layout.Authoritative || layout.StateSizeBytes != 0 || layout.Version != 0 || layout.SHA256 != zero {
			return fmt.Errorf("%w: %s phải có state size authoritative bằng 0", ErrLibraryStateLayout, kind)
		}
	case LibraryKindFunctionBlock:
		if !layout.Authoritative {
			if publishing {
				return fmt.Errorf("%w: FUNCTION_BLOCK chưa có layout", ErrLibraryStateLayout)
			}
			if layout.Version != 0 || layout.StateSizeBytes != 0 || layout.SHA256 != zero {
				return fmt.Errorf("%w: layout chưa authoritative phải rỗng", ErrLibraryStateLayout)
			}
			return nil
		}
		if layout.Version == 0 || layout.SHA256 == zero || layout.StateSizeBytes > 1048576 {
			return fmt.Errorf("%w: FUNCTION_BLOCK layout thiếu version/hash/size", ErrLibraryStateLayout)
		}
	default:
		return fmt.Errorf("library kind không hợp lệ")
	}
	return nil
}

// normalizeLibraryDependencies luôn trả slice khác nil. Hash canonical của
// entry đã dùng mảng rỗng `[]`, nên trả nil ở đây sẽ ghi `null` xuống
// `dependencies_json` — lệch với hash và bị `json_type(...)='array'` của schema
// từ chối, tức là mọi entry không có dependency đều không ghi được.
func normalizeLibraryDependencies(input []LibraryDependency) ([]LibraryDependency, error) {
	result := make([]LibraryDependency, 0, len(input))
	result = append(result, input...)
	sort.Slice(result, func(left, right int) bool {
		return strings.ToUpper(result[left].EntryID) < strings.ToUpper(result[right].EntryID)
	})
	for index := range result {
		if err := validateUUIDs(result[index].EntryID); err != nil {
			return nil, err
		}
		if err := domain.ValidateProjectLibraryVersion(result[index].Version); err != nil {
			return nil, err
		}
		if index > 0 && strings.EqualFold(result[index-1].EntryID, result[index].EntryID) {
			return nil, fmt.Errorf("library dependency trùng: %s", result[index].EntryID)
		}
	}
	return result, nil
}

func libraryEntryDigest(entry LibraryEntry) ([sha256.Size]byte, error) {
	return domain.ProjectLibraryEntryContentSHA256(toDomainLibraryEntry(entry))
}

// requireMutableProjectLibraryOfProjectTx kiểm CẢ quyền sở hữu Project. Chỉ kiểm
// "là PROJECT DRAFT" cho phép một admin sửa library Draft của Project khác chỉ
// bằng cách đoán đúng `libraryRevisionId` — sai lệch quyền im lặng.
func requireMutableProjectLibraryOfProjectTx(ctx context.Context, tx *sql.Tx, revisionID, projectID string) error {
	var scope, state string
	var owner sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT scope,state,project_id FROM library_revisions WHERE library_revision_id=?`, revisionID).
		Scan(&scope, &state, &owner); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if scope != LibraryScopeProject || !owner.Valid || owner.String != projectID {
		return ErrNotFound
	}
	if state != LibraryStateDraft {
		return ErrLibraryImmutable
	}
	return nil
}

func insertLibraryEntryTx(ctx context.Context, tx *sql.Tx, entry LibraryEntry) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO library_entries(
		library_revision_id,entry_id,kind,name,name_folded,feature_state,signature_json,content_sha256,
		language,source_blob,interface_json,dependencies_json,state_layout_version,state_size_bytes,state_layout_sha256,
		category,description,presentation_sha256)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, libraryEntrySQLArgs(entry)...)
	return err
}

func updateLibraryEntryTx(ctx context.Context, tx *sql.Tx, entry LibraryEntry) error {
	arguments := libraryEntrySQLArgs(entry)
	result, err := tx.ExecContext(ctx, `UPDATE library_entries SET
		kind=?,name=?,name_folded=?,feature_state=?,signature_json=?,content_sha256=?,
		language=?,source_blob=?,interface_json=?,dependencies_json=?,state_layout_version=?,state_size_bytes=?,state_layout_sha256=?
		WHERE library_revision_id=? AND entry_id=?`,
		arguments[2], arguments[3], arguments[4], arguments[5], arguments[6], arguments[7], arguments[8], arguments[9],
		arguments[10], arguments[11], arguments[12], arguments[13], arguments[14], arguments[0], arguments[1])
	if err != nil {
		return err
	}
	if rows, err := result.RowsAffected(); err != nil {
		return err
	} else if rows != 1 {
		return ErrNotFound
	}
	return nil
}

func libraryEntrySQLArgs(entry LibraryEntry) []any {
	dependencies, _ := json.Marshal(entry.Dependencies)
	var layoutVersion, layoutSize, layoutHash any
	if entry.Kind == LibraryKindFunction || entry.Kind == LibraryKindConversion {
		layoutSize = int64(0)
	} else if entry.StateLayout.Authoritative {
		layoutVersion = int64(entry.StateLayout.Version)
		layoutSize = int64(entry.StateLayout.StateSizeBytes)
		layoutHash = entry.StateLayout.SHA256[:]
	}
	var category, description, presentation any
	if entry.Category != nil {
		category = *entry.Category
	}
	if entry.Description != nil {
		description = *entry.Description
	}
	if len(entry.PresentationSHA256) > 0 {
		presentation = entry.PresentationSHA256
	}
	return []any{entry.LibraryRevisionID, entry.EntryID, entry.Kind, entry.Name, strings.ToUpper(entry.Name),
		entry.FeatureState, projectLibraryLegacySignature, entry.ContentSHA256[:], entry.Language, entry.Source,
		entry.InterfaceJSON, dependencies, layoutVersion, layoutSize, layoutHash,
		category, description, presentation}
}

func refreshLibraryManifestTx(ctx context.Context, tx *sql.Tx, libraryRevisionID string) error {
	revision, err := getLibraryRevisionTx(ctx, tx, libraryRevisionID)
	if err != nil {
		return err
	}
	entries, err := listProjectLibraryEntriesTx(ctx, tx, libraryRevisionID)
	if err != nil {
		return err
	}
	manifest, digest, err := buildLibraryManifest(revision.LibraryRevisionID, revision.ProjectID, revision.Version, entries)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE library_revisions SET manifest_json=?,manifest_sha256=? WHERE library_revision_id=? AND state='DRAFT'`, manifest, digest[:], libraryRevisionID)
	return err
}

func buildLibraryManifest(libraryRevisionID, projectID, version string, entries []LibraryEntry) ([]byte, [sha256.Size]byte, error) {
	type manifestEntry struct {
		EntryID       string `json:"entryId"`
		ContentSHA256 string `json:"contentSha256"`
	}
	items := make([]manifestEntry, len(entries))
	for index, entry := range entries {
		items[index] = manifestEntry{entry.EntryID, hex.EncodeToString(entry.ContentSHA256[:])}
	}
	sort.Slice(items, func(left, right int) bool {
		return strings.ToUpper(items[left].EntryID) < strings.ToUpper(items[right].EntryID)
	})
	manifest, err := json.Marshal(struct {
		SchemaVersion     int             `json:"schemaVersion"`
		LibraryRevisionID string          `json:"libraryRevisionId"`
		ProjectID         string          `json:"projectId"`
		Version           string          `json:"version"`
		Entries           []manifestEntry `json:"entries"`
	}{1, libraryRevisionID, projectID, version, items})
	if err != nil {
		return nil, [sha256.Size]byte{}, err
	}
	return manifest, sha256.Sum256(manifest), nil
}

func buildPublishedLibraryManifest(revision LibraryRevision, entries []LibraryEntry) ([]byte, [sha256.Size]byte, error) {
	domainEntries := make([]domain.LibraryEntry, len(entries))
	for index := range entries {
		domainEntries[index] = toDomainLibraryEntry(entries[index])
	}
	return domain.BuildProjectLibraryManifest(toDomainLibraryRevision(revision), domainEntries)
}

func toDomainLibraryRevision(input LibraryRevision) domain.LibraryRevision {
	return domain.LibraryRevision{
		LibraryRevisionID: input.LibraryRevisionID, ProjectID: input.ProjectID,
		Scope: domain.LibraryScope(input.Scope), Version: input.Version,
		ParentLibraryRevisionID: input.ParentLibraryRevisionID,
		State:                   domain.LibraryRevisionState(input.State), ManifestJSON: append([]byte(nil), input.ManifestJSON...),
		ManifestSHA256: input.ManifestSHA256, CreatedBy: input.CreatedBy, CreatedAtUTCMS: input.CreatedAtUTCMS,
	}
}

func fromDomainLibraryRevision(input domain.LibraryRevision) LibraryRevision {
	return LibraryRevision{
		LibraryRevisionID: input.LibraryRevisionID, ProjectID: input.ProjectID,
		Scope: string(input.Scope), Version: input.Version,
		ParentLibraryRevisionID: input.ParentLibraryRevisionID, State: string(input.State),
		ManifestJSON: append([]byte(nil), input.ManifestJSON...), ManifestSHA256: input.ManifestSHA256,
		CreatedBy: input.CreatedBy, CreatedAtUTCMS: input.CreatedAtUTCMS,
	}
}

func toDomainLibraryEntry(input LibraryEntry) domain.LibraryEntry {
	dependencies := make([]domain.LibraryDependency, len(input.Dependencies))
	for index, dependency := range input.Dependencies {
		dependencies[index] = domain.LibraryDependency{EntryID: dependency.EntryID, Version: dependency.Version}
	}
	return domain.LibraryEntry{
		LibraryRevisionID: input.LibraryRevisionID, EntryID: input.EntryID,
		Kind: domain.LibraryEntryKind(input.Kind), Name: input.Name,
		FeatureState: domain.LibraryFeatureState(input.FeatureState), Language: domain.LibraryLanguage(input.Language),
		SourceBlob: append([]byte(nil), input.Source...), InterfaceJSON: append([]byte(nil), input.InterfaceJSON...),
		SignatureJSON: append([]byte(nil), input.SignatureJSON...),
		ContentSHA256: input.ContentSHA256,
		StateLayout: domain.LibraryStateLayout{Authoritative: input.StateLayout.Authoritative,
			Version: input.StateLayout.Version, StateSizeBytes: input.StateLayout.StateSizeBytes, SHA256: input.StateLayout.SHA256},
		Dependencies: dependencies,
	}
}

func fromDomainLibraryEntry(input domain.LibraryEntry) LibraryEntry {
	dependencies := make([]LibraryDependency, len(input.Dependencies))
	for index, dependency := range input.Dependencies {
		dependencies[index] = LibraryDependency{EntryID: dependency.EntryID, Version: dependency.Version}
	}
	return LibraryEntry{
		LibraryRevisionID: input.LibraryRevisionID, EntryID: input.EntryID,
		Kind: string(input.Kind), Name: input.Name, FeatureState: string(input.FeatureState),
		Language: string(input.Language), Source: append([]byte(nil), input.SourceBlob...),
		InterfaceJSON: append([]byte(nil), input.InterfaceJSON...), SignatureJSON: append([]byte(nil), input.SignatureJSON...),
		ContentSHA256: input.ContentSHA256,
		Category:      optionalString(input.Category),
		StateLayout: LibraryStateLayout{Authoritative: input.StateLayout.Authoritative,
			Version: input.StateLayout.Version, StateSizeBytes: input.StateLayout.StateSizeBytes, SHA256: input.StateLayout.SHA256},
		Dependencies: dependencies,
	}
}

func getLibraryRevisionQuery(ctx context.Context, query interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, libraryRevisionID string) (LibraryRevision, error) {
	return scanLibraryRevision(query.QueryRowContext(ctx, `SELECT library_revision_id,project_id,scope,version,parent_library_revision_id,state,
		manifest_json,manifest_sha256,created_by,created_at_utc_ms FROM library_revisions WHERE library_revision_id=?`, libraryRevisionID))
}

func getLibraryRevisionTx(ctx context.Context, tx *sql.Tx, libraryRevisionID string) (LibraryRevision, error) {
	return getLibraryRevisionQuery(ctx, tx, libraryRevisionID)
}

func scanLibraryRevision(row rowScanner) (LibraryRevision, error) {
	var revision LibraryRevision
	var projectID, parent sql.NullString
	var digest []byte
	err := row.Scan(&revision.LibraryRevisionID, &projectID, &revision.Scope, &revision.Version, &parent,
		&revision.State, &revision.ManifestJSON, &digest, &revision.CreatedBy, &revision.CreatedAtUTCMS)
	if errors.Is(err, sql.ErrNoRows) {
		return LibraryRevision{}, ErrNotFound
	}
	if err != nil {
		return LibraryRevision{}, err
	}
	if projectID.Valid {
		revision.ProjectID = projectID.String
	}
	if parent.Valid {
		revision.ParentLibraryRevisionID = parent.String
	}
	if len(digest) != sha256.Size {
		return LibraryRevision{}, fmt.Errorf("library manifest checksum hỏng")
	}
	copy(revision.ManifestSHA256[:], digest)
	if sha256.Sum256(revision.ManifestJSON) != revision.ManifestSHA256 {
		return LibraryRevision{}, fmt.Errorf("library manifest checksum mismatch")
	}
	return revision, nil
}

func listProjectLibraryEntriesTx(ctx context.Context, tx *sql.Tx, libraryRevisionID string) ([]LibraryEntry, error) {
	rows, err := tx.QueryContext(ctx, libraryEntrySelect+` WHERE library_revision_id=? ORDER BY entry_id`, libraryRevisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []LibraryEntry
	for rows.Next() {
		entry, err := scanLibraryEntry(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func scanLibraryEntry(row rowScanner) (LibraryEntry, error) {
	var entry LibraryEntry
	var dependenciesJSON, digest []byte
	var language sql.NullString
	var source, interfaceJSON, signatureJSON []byte
	var layoutVersion, layoutSize sql.NullInt64
	var layoutHash []byte
	var category, description sql.NullString
	var presentationHash []byte
	if err := row.Scan(&entry.LibraryRevisionID, &entry.EntryID, &entry.Kind, &entry.Name, &language,
		&entry.FeatureState, &source, &interfaceJSON, &signatureJSON, &dependenciesJSON,
		&layoutVersion, &layoutSize, &layoutHash, &digest,
		&category, &description, &presentationHash); err != nil {
		return LibraryEntry{}, err
	}
	if category.Valid {
		value := category.String
		entry.Category = &value
	}
	if description.Valid {
		value := description.String
		entry.Description = &value
	}
	if len(presentationHash) > 0 {
		entry.PresentationSHA256 = append([]byte(nil), presentationHash...)
	}
	if !language.Valid || len(source) == 0 || len(interfaceJSON) == 0 {
		return LibraryEntry{}, fmt.Errorf("PROJECT library entry v6 thiếu source/interface authoritative")
	}
	if !bytes.Equal(signatureJSON, projectLibraryLegacySignature) {
		return LibraryEntry{}, fmt.Errorf("PROJECT library signature legacy marker không hợp lệ")
	}
	entry.Language, entry.Source, entry.InterfaceJSON, entry.SignatureJSON = language.String, source, interfaceJSON, signatureJSON
	if err := json.Unmarshal(dependenciesJSON, &entry.Dependencies); err != nil {
		return LibraryEntry{}, fmt.Errorf("library dependencies JSON hỏng: %w", err)
	}
	if len(digest) != sha256.Size {
		return LibraryEntry{}, fmt.Errorf("library entry checksum hỏng")
	}
	copy(entry.ContentSHA256[:], digest)
	switch entry.Kind {
	case LibraryKindFunction, LibraryKindConversion:
		if !layoutSize.Valid || layoutSize.Int64 != 0 || layoutVersion.Valid || len(layoutHash) != 0 {
			return LibraryEntry{}, fmt.Errorf("%w: state 0 không authoritative", ErrLibraryStateLayout)
		}
		entry.StateLayout.Authoritative = true
	case LibraryKindFunctionBlock:
		if layoutVersion.Valid || layoutSize.Valid || len(layoutHash) > 0 {
			if !layoutVersion.Valid || !layoutSize.Valid || len(layoutHash) != sha256.Size || layoutVersion.Int64 < 1 || layoutSize.Int64 < 0 {
				return LibraryEntry{}, fmt.Errorf("%w: FB layout DB không nhất quán", ErrLibraryStateLayout)
			}
			entry.StateLayout.Authoritative = true
			entry.StateLayout.Version = uint32(layoutVersion.Int64)
			entry.StateLayout.StateSizeBytes = uint32(layoutSize.Int64)
			copy(entry.StateLayout.SHA256[:], layoutHash)
		}
	}
	if calculated, err := libraryEntryDigest(entry); err != nil {
		return LibraryEntry{}, err
	} else if calculated != entry.ContentSHA256 {
		return LibraryEntry{}, fmt.Errorf("PROJECT library entry content checksum mismatch")
	}
	return entry, nil
}

func validateSystemLibrarySnapshot(snapshot SystemLibrarySnapshot) error {
	revision := snapshot.Revision
	if revision.Scope != LibraryScopeSystem || revision.ProjectID != "" ||
		(revision.State != LibraryStatePublished && revision.State != LibraryStateDeprecated) ||
		!librarySystemVerPattern.MatchString(revision.Version) || len(snapshot.Entries) == 0 {
		return fmt.Errorf("SYSTEM revision scope/version/state không hợp lệ")
	}
	if sha256.Sum256(revision.ManifestJSON) != revision.ManifestSHA256 {
		return fmt.Errorf("SYSTEM manifest checksum mismatch")
	}
	seen := make(map[string]struct{}, len(snapshot.Entries))
	for _, entry := range snapshot.Entries {
		if entry.LibraryRevisionID != revision.LibraryRevisionID || !libraryEntryIDPattern.MatchString(entry.EntryID) || !validLibraryKind(entry.Kind) {
			return fmt.Errorf("SYSTEM entry identity/kind không hợp lệ")
		}
		key := strings.ToUpper(entry.EntryID)
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("SYSTEM entry trùng: %s", entry.EntryID)
		}
		seen[key] = struct{}{}
		if err := domain.ValidateLibraryEntry(toDomainLibraryEntry(entry), domain.LibraryScopeSystem, true); err != nil {
			return fmt.Errorf("SYSTEM entry %s: %w", entry.EntryID, err)
		}
	}
	return nil
}

func cloneSystemLibrarySnapshot(input *SystemLibrarySnapshot) *SystemLibrarySnapshot {
	if input == nil {
		return nil
	}
	result := &SystemLibrarySnapshot{Revision: cloneLibraryRevision(input.Revision), Entries: make([]LibraryEntry, len(input.Entries))}
	for index := range input.Entries {
		result.Entries[index] = cloneLibraryEntry(input.Entries[index])
	}
	return result
}

func cloneLibraryRevision(input LibraryRevision) LibraryRevision {
	input.ManifestJSON = append([]byte(nil), input.ManifestJSON...)
	return input
}

func cloneLibraryEntry(input LibraryEntry) LibraryEntry {
	input.Source = append([]byte(nil), input.Source...)
	input.InterfaceJSON = append([]byte(nil), input.InterfaceJSON...)
	input.SignatureJSON = append([]byte(nil), input.SignatureJSON...)
	input.Dependencies = append([]LibraryDependency(nil), input.Dependencies...)
	return input
}

// FindProjectLibraryDraft trả library DRAFT đang mở của Project, hoặc rỗng khi
// chưa có. Seal Revision dùng nó để đóng băng library cùng lúc với Revision.
func (s *Store) FindProjectLibraryDraft(ctx context.Context, projectID string) (LibraryRevision, error) {
	if err := validateUUIDs(projectID); err != nil {
		return LibraryRevision{}, err
	}
	var libraryRevisionID string
	err := s.db.QueryRowContext(ctx, `SELECT library_revision_id FROM library_revisions
		WHERE scope='PROJECT' AND project_id=? AND state='DRAFT'
		ORDER BY created_at_utc_ms DESC,library_revision_id LIMIT 1`, projectID).Scan(&libraryRevisionID)
	if errors.Is(err, sql.ErrNoRows) {
		return LibraryRevision{}, ErrNotFound
	}
	if err != nil {
		return LibraryRevision{}, err
	}
	return s.GetLibraryRevision(ctx, libraryRevisionID)
}

/*
libraryEntryMatchesQuery — phép so `q` cho nhánh SYSTEM (giữ trong bộ nhớ).

Phủ `name`, `entryId` và `description`. **Không** phủ chữ ký: chữ ký nằm trong
`signature_json`, và quét chuỗi trong một khối JSON sẽ khớp cả tên kiểu, tên
tham số lẫn giá trị mặc định — gõ `REAL` sẽ trả về gần như mọi khối. Một phép
tìm cho kết quả không giải thích được thì tệ hơn một phép tìm hẹp mà đúng
(`LOCK-PGM04-CONTRACT-001` §3).

Nhánh PROJECT làm cùng phép so bằng SQL; hai nhánh phải phủ CÙNG một tập trường,
nếu không cùng một từ khoá sẽ cho hai kết quả khác nhau tuỳ scope người dùng
đang xem.
*/
func libraryEntryMatchesQuery(entry LibraryEntry, upperQuery string) bool {
	if strings.Contains(strings.ToUpper(entry.Name), upperQuery) {
		return true
	}
	if strings.Contains(strings.ToUpper(entry.EntryID), upperQuery) {
		return true
	}
	return entry.Description != nil && strings.Contains(strings.ToUpper(*entry.Description), upperQuery)
}


/* Chuỗi rỗng của registry nghĩa là "không phân loại"; ở store nó là `nil` để
   phân biệt với một phân loại đã đặt thành chuỗi rỗng. */
func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// LibraryUsageRow là một mục Used-In đã ghép đủ ngữ cảnh để hiển thị.
//
// Khác `LibraryUsage` (bản thô của bảng) ở chỗ nó mang tên Project và tên POU:
// một danh sách toàn UUID không trả lời được câu người dùng hỏi ("chương trình
// nào đang dùng khối này"), và `AC-PGM01-01` cấm UUID ở mặt trước.
type LibraryUsageRow struct {
	ProjectID       string
	ProjectName     string
	RevisionID      string
	ObjectID        string
	ObjectName      string
	RequiredVersion string
	UsageKind       string
	// IsActive = Revision này đang là gói vận hành của Project.
	IsActive bool
}

/*
ListLibraryUsageRows — Used-In trên các Revision ĐÃ NIÊM PHONG.

Bảng `library_usages` được ghi trong chính đường Seal Revision, nên nó chỉ biết
những gì đã seal. Draft đang sửa KHÔNG có ở đây (chưa có `pou_objects`), và
usage của entry SYSTEM cũng không — migration `0007` cố ý không tạo FK giả tới
một row DB không tồn tại. Cả hai khoảng trống ấy được lớp application nói ra
bằng `availability`, chứ không được lấp bằng số 0.

Một mục là MỘT CẶP (Revision, POU), không phải một lần gọi: câu hỏi là "chương
trình nào dùng khối này", không phải "khối này bị gọi bao nhiêu lần". `usage_kind`
đi kèm vì `INSTANCE` mang trạng thái còn `CALL` thì không — hai loại có hệ quả
khác nhau khi đổi version.
*/
func (s *Store) ListLibraryUsageRows(ctx context.Context, libraryRevisionID, entryID string,
	limit int) ([]LibraryUsageRow, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("Programming store chưa mở")
	}
	if limit < 1 || limit > 200 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `SELECT p.project_id,p.name,u.revision_id,u.object_id,
		coalesce(o.name,''),u.required_version,u.usage_kind,
		CASE WHEN c.new_revision_id IS NOT NULL THEN 1 ELSE 0 END
		FROM library_usages u
		JOIN revisions rev ON rev.revision_id=u.revision_id
		JOIN projects p ON p.project_id=rev.project_id
		LEFT JOIN pou_objects o ON o.revision_id=u.revision_id AND o.object_id=u.object_id
		LEFT JOIN commission_records c ON c.new_revision_id=u.revision_id AND c.result='SUCCEEDED'
		WHERE u.library_revision_id=? AND (?='' OR u.entry_id=?)
		ORDER BY p.name,u.revision_id,u.object_id,u.usage_kind
		LIMIT ?`, libraryRevisionID, entryID, entryID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usages := make([]LibraryUsageRow, 0, limit)
	for rows.Next() {
		var row LibraryUsageRow
		var active int
		if err := rows.Scan(&row.ProjectID, &row.ProjectName, &row.RevisionID, &row.ObjectID,
			&row.ObjectName, &row.RequiredVersion, &row.UsageKind, &active); err != nil {
			return nil, err
		}
		row.IsActive = active == 1
		usages = append(usages, row)
	}
	return usages, rows.Err()
}
