package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"mkddc-web/internal/programming/canonicaljson"
)

// Control Library là lớp có đủ dữ liệu để phân giải tên mà parser/model đã ghi
// lại. Ba lỗi dưới đây cố ý tách riêng vì người vận hành phải thực hiện ba cách
// khắc phục khác nhau: thêm entry, sửa pin version, hoặc phá vòng dependency.
var (
	ErrLibraryEntryMissing      = errors.New("Control Library thiếu entry")
	ErrLibraryVersionMismatch   = errors.New("Control Library lệch version")
	ErrLibraryDependencyCycle   = errors.New("Control Library có dependency vòng")
	ErrLibraryImmutable         = errors.New("Control Library revision bất biến")
	ErrLibraryStateLayout       = errors.New("Control Library thiếu state layout authoritative")
	ErrLibraryInvalidTransition = errors.New("chuyển trạng thái Control Library không hợp lệ")
)

const (
	LibraryDiagnosticMissing = "ST-LIB-001"
	LibraryDiagnosticVersion = "ST-LIB-002"
	LibraryDiagnosticCycle   = "ST-POU-003"
)

type LibraryScope string

const (
	LibraryScopeSystem  LibraryScope = "SYSTEM"
	LibraryScopeProject LibraryScope = "PROJECT"
)

type LibraryRevisionState string

const (
	LibraryRevisionDraft      LibraryRevisionState = "DRAFT"
	LibraryRevisionPublished  LibraryRevisionState = "PUBLISHED"
	LibraryRevisionDeprecated LibraryRevisionState = "DEPRECATED"
)

type LibraryEntryKind string

const (
	LibraryEntryFunction      LibraryEntryKind = "FUNCTION"
	LibraryEntryFunctionBlock LibraryEntryKind = "FUNCTION_BLOCK"
	LibraryEntryConversion    LibraryEntryKind = "CONVERSION"
)

type LibraryLanguage string

const (
	LibraryLanguageST  LibraryLanguage = "ST"
	LibraryLanguageFBD LibraryLanguage = "FBD"
)

type LibraryFeatureState string

const (
	LibraryFeatureAvailable      LibraryFeatureState = "AVAILABLE"
	LibraryFeatureReviewRequired LibraryFeatureState = "REVIEW_REQUIRED"
)

type LibraryUsageKind string

const (
	LibraryUsageCall     LibraryUsageKind = "CALL"
	LibraryUsageInstance LibraryUsageKind = "INSTANCE"
)

// LibraryRevision là identity/version/lifecycle của một snapshot library. Một
// version mới luôn là revision mới; kể cả DRAFT cũng không được đổi identity hay
// version tại chỗ sau khi đã tạo.
type LibraryRevision struct {
	LibraryRevisionID       string
	ProjectID               string
	Scope                   LibraryScope
	Version                 string
	ParentLibraryRevisionID string
	State                   LibraryRevisionState
	ManifestJSON            []byte
	ManifestSHA256          [sha256.Size]byte
	CreatedBy               string
	CreatedAtUTCMS          int64
}

// LibraryStateLayout phân biệt rõ 0 byte authoritative với "chưa biết". Chỉ
// FUNCTION/CONVERSION có StateSizeBytes=0 mà không cần layout; PROJECT FB phải
// mang version+hash layout trước publish. Không dùng 0 để giả vờ biết size FB.
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
	Kind              LibraryEntryKind
	Name              string
	FeatureState      LibraryFeatureState
	Language          LibraryLanguage
	SourceBlob        []byte
	InterfaceJSON     []byte
	// SignatureJSON chỉ là metadata canonical của registry SYSTEM. PROJECT
	// dùng InterfaceJSON; store giữ cột signature_json cũ như bản sao tương
	// thích, không dùng nó làm nguồn hash thứ hai.
	SignatureJSON []byte
	ContentSHA256 [sha256.Size]byte
	/* `T61-102` — phân loại nghiệp vụ. Với SYSTEM nó sinh từ registry; với
	   PROJECT nó do người dùng đặt và store giữ. Rỗng = chưa phân loại, và
	   PGM-04 render nó thành `—` chứ không thành một nhóm "khác" tự nghĩ ra. */
	Category    string
	StateLayout LibraryStateLayout
	Dependencies  []LibraryDependency
}

type LibraryUsage struct {
	RevisionID        string
	ObjectID          string
	LibraryRevisionID string
	EntryID           string
	RequiredVersion   string
	Kind              LibraryUsageKind
}

// LibraryEntryDefinition là dạng chỉ-đọc mà generator Go sinh từ registry JSON.
// ContentSHA256 là hash metadata canonical (signature, port, category, dispatch,
// feature state), KHÔNG phải hash executable implementation hay artifact đã
// biên dịch. Hàm materialize vẫn xác minh hash trước khi dùng.
type LibraryEntryDefinition struct {
	EntryID      string
	Name         string
	Kind         LibraryEntryKind
	FeatureState LibraryFeatureState
	/*
	   `T61-102` — phân loại nghiệp vụ, sinh từ `pou_library_registry_v1.json`.

	   Trường này đã có sẵn trong registry từ đầu nhưng chưa bao giờ đi ra tới
	   API, nên PGM-04 không lọc theo nó được. Nó KHÔNG suy được từ `Kind`:
	   `Kind` là hình dạng gọi (FUNCTION/FUNCTION_BLOCK), còn `Category` là
	   nhóm nghiệp vụ (logic/math/timer/control…). Suy từ `Kind` cho ra ba rổ
	   vô nghĩa với người vận hành — và tệ hơn, chúng TRÔNG như phân loại thật.
	*/
	Category               string
	SignatureJSON          string
	ContentSHA256Hex       string
	StateSizeBytes         uint32
	StateSizeAuthoritative bool
}

// LibraryResolutionError giữ dữ kiện vận hành và unwrap về đúng sentinel. Không
// gộp missing/version/cycle thành "unknown function".
type LibraryResolutionError struct {
	Cause           error
	EntryID         string
	RequiredBy      string
	ExpectedVersion string
	ActualVersion   string
	Cycle           []string
}

func (e *LibraryResolutionError) Error() string {
	switch {
	case errors.Is(e.Cause, ErrLibraryEntryMissing):
		return fmt.Sprintf("%s: entry %q do %q yêu cầu không tồn tại", LibraryDiagnosticMissing, e.EntryID, e.RequiredBy)
	case errors.Is(e.Cause, ErrLibraryVersionMismatch):
		return fmt.Sprintf("%s: entry %q cần version %q nhưng hiện có %q", LibraryDiagnosticVersion, e.EntryID, e.ExpectedVersion, e.ActualVersion)
	case errors.Is(e.Cause, ErrLibraryDependencyCycle):
		return fmt.Sprintf("%s: dependency vòng %s", LibraryDiagnosticCycle, strings.Join(e.Cycle, " -> "))
	default:
		return "lỗi phân giải Control Library"
	}
}

func (e *LibraryResolutionError) Unwrap() error { return e.Cause }

func (e *LibraryResolutionError) DiagnosticCode() string {
	switch {
	case errors.Is(e.Cause, ErrLibraryEntryMissing):
		return LibraryDiagnosticMissing
	case errors.Is(e.Cause, ErrLibraryVersionMismatch):
		return LibraryDiagnosticVersion
	case errors.Is(e.Cause, ErrLibraryDependencyCycle):
		return LibraryDiagnosticCycle
	default:
		return ""
	}
}

var (
	iecIdentifierPattern    = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)
	projectLibraryIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	projectSemverPattern    = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
	systemVersionPattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,63}$`)
)

func ValidateLibraryRevision(revision LibraryRevision) error {
	if revision.LibraryRevisionID == "" || len(revision.LibraryRevisionID) > 128 {
		return fmt.Errorf("libraryRevisionId phải dài 1..128 ký tự")
	}
	switch revision.Scope {
	case LibraryScopeSystem:
		if revision.ProjectID != "" {
			return fmt.Errorf("SYSTEM library không được thuộc Project")
		}
		if !systemVersionPattern.MatchString(revision.Version) {
			return fmt.Errorf("SYSTEM library version không hợp lệ")
		}
	case LibraryScopeProject:
		if revision.ProjectID == "" {
			return fmt.Errorf("PROJECT library bắt buộc có projectId")
		}
		if err := ValidateProjectLibraryVersion(revision.Version); err != nil {
			return err
		}
	default:
		return fmt.Errorf("library scope không hợp lệ: %q", revision.Scope)
	}
	switch revision.State {
	case LibraryRevisionDraft, LibraryRevisionPublished, LibraryRevisionDeprecated:
	default:
		return fmt.Errorf("library revision state không hợp lệ: %q", revision.State)
	}
	if revision.Scope == LibraryScopeSystem && revision.State == LibraryRevisionDraft {
		return fmt.Errorf("%w: SYSTEM library không có trạng thái DRAFT", ErrLibraryImmutable)
	}
	if revision.CreatedAtUTCMS < 0 {
		return fmt.Errorf("createdAtUtcMs không hợp lệ")
	}
	if len(revision.CreatedBy) < 1 || len(revision.CreatedBy) > 128 {
		return fmt.Errorf("createdBy phải dài 1..128 ký tự")
	}
	if len(revision.ManifestJSON) < 2 || len(revision.ManifestJSON) > 256*1024 ||
		!json.Valid(revision.ManifestJSON) {
		return fmt.Errorf("library manifest phải là JSON hợp lệ 2..262144 byte")
	}
	if digest := sha256.Sum256(revision.ManifestJSON); digest != revision.ManifestSHA256 {
		return fmt.Errorf("library manifest checksum mismatch")
	}
	return nil
}

// ValidateLibraryTransition khóa identity/version sau khi tạo và khóa content
// sau publish. DRAFT còn được sửa; Publish phải tự dựng manifest canonical từ
// entries trong cùng transaction (không nhận manifest do caller cung cấp).
// PUBLISHED chỉ có thể được đánh deprecated; không có đường quay lại DRAFT.
func ValidateLibraryTransition(current, next LibraryRevision) error {
	if err := ValidateLibraryRevision(current); err != nil {
		return fmt.Errorf("revision hiện tại: %w", err)
	}
	if err := ValidateLibraryRevision(next); err != nil {
		return fmt.Errorf("revision kế tiếp: %w", err)
	}
	// SYSTEM là virtual snapshot sinh cùng firmware/compiler profile. PUBLISHED
	// (hoặc record DEPRECATED do registry authoritative cung cấp) đọc được, nhưng
	// không có mutation/transition sau khi đã materialize.
	if current.Scope == LibraryScopeSystem || next.Scope == LibraryScopeSystem {
		return ErrLibraryImmutable
	}
	if current.LibraryRevisionID != next.LibraryRevisionID ||
		current.ProjectID != next.ProjectID || current.Scope != next.Scope ||
		current.Version != next.Version ||
		current.ParentLibraryRevisionID != next.ParentLibraryRevisionID ||
		current.CreatedBy != next.CreatedBy || current.CreatedAtUTCMS != next.CreatedAtUTCMS {
		return ErrLibraryImmutable
	}
	if current.State == next.State {
		if current.State != LibraryRevisionDraft {
			return ErrLibraryImmutable
		}
		return nil
	}
	if current.State == LibraryRevisionDraft && next.State == LibraryRevisionPublished {
		return nil
	}
	if current.State == LibraryRevisionPublished && next.State == LibraryRevisionDeprecated &&
		current.ManifestSHA256 == next.ManifestSHA256 {
		return nil
	}
	return ErrLibraryInvalidTransition
}

func ValidateLibraryEntry(entry LibraryEntry, scope LibraryScope, publishing bool) error {
	if entry.LibraryRevisionID == "" || entry.EntryID == "" {
		return fmt.Errorf("libraryRevisionId và entryId là bắt buộc")
	}
	if !iecIdentifierPattern.MatchString(entry.Name) {
		return fmt.Errorf("library entry name không phải IEC identifier 1..64")
	}
	switch scope {
	case LibraryScopeSystem:
		if len(entry.SignatureJSON) < 2 || len(entry.SignatureJSON) > 64*1024 ||
			!json.Valid(entry.SignatureJSON) {
			return fmt.Errorf("SYSTEM library signature phải là JSON hợp lệ 2..65536 byte")
		}
		if digest := sha256.Sum256(entry.SignatureJSON); digest != entry.ContentSHA256 {
			return fmt.Errorf("SYSTEM library entry content checksum mismatch")
		}
		if entry.Language != "" || len(entry.SourceBlob) != 0 || len(entry.InterfaceJSON) != 0 {
			return fmt.Errorf("SYSTEM registry không được giả làm PROJECT source")
		}
	case LibraryScopeProject:
		if !projectLibraryIDPattern.MatchString(entry.EntryID) {
			return fmt.Errorf("PROJECT library entryId phải là UUID v4 lowercase")
		}
		if entry.Kind == LibraryEntryConversion {
			return fmt.Errorf("PROJECT library chỉ nhận FUNCTION/FUNCTION_BLOCK")
		}
		digest, err := ProjectLibraryEntryContentSHA256(entry)
		if err != nil {
			return err
		}
		if digest != entry.ContentSHA256 {
			return fmt.Errorf("PROJECT library entry content checksum mismatch")
		}
	default:
		return fmt.Errorf("library scope không hợp lệ: %q", scope)
	}
	switch entry.Kind {
	case LibraryEntryFunction, LibraryEntryConversion:
		if !entry.StateLayout.Authoritative || entry.StateLayout.StateSizeBytes != 0 ||
			entry.StateLayout.Version != 0 || !allZeroDigest(entry.StateLayout.SHA256) {
			return fmt.Errorf("%w: %s phải có state_size authoritative bằng 0", ErrLibraryStateLayout, entry.Kind)
		}
	case LibraryEntryFunctionBlock:
		if !entry.StateLayout.Authoritative &&
			(entry.StateLayout.Version != 0 || entry.StateLayout.StateSizeBytes != 0 ||
				!allZeroDigest(entry.StateLayout.SHA256)) {
			return fmt.Errorf("%w: layout unknown phải không mang version/size/hash", ErrLibraryStateLayout)
		}
		if publishing && scope == LibraryScopeProject &&
			(!entry.StateLayout.Authoritative || entry.StateLayout.Version == 0 || allZeroDigest(entry.StateLayout.SHA256)) {
			return fmt.Errorf("%w: PROJECT FUNCTION_BLOCK %q", ErrLibraryStateLayout, entry.Name)
		}
		if entry.StateLayout.Authoritative &&
			(entry.StateLayout.Version == 0 || allZeroDigest(entry.StateLayout.SHA256)) {
			return fmt.Errorf("%w: layout authoritative thiếu version/hash", ErrLibraryStateLayout)
		}
	default:
		return fmt.Errorf("library entry kind không hợp lệ: %q", entry.Kind)
	}
	switch entry.FeatureState {
	case LibraryFeatureAvailable, LibraryFeatureReviewRequired:
	default:
		return fmt.Errorf("library feature state không hợp lệ: %q", entry.FeatureState)
	}
	return nil
}

// ProjectLibraryEntryContentSHA256 là thuật toán hash duy nhất cho PROJECT
// entry. Nó canonicalize JSON interface/FBD và sắp dependency theo tên fold +
// version, nên thứ tự input không đổi identity nội dung. State layout có hash
// riêng và không được trộn vào contentSha256 của source/interface/dependency.
func ProjectLibraryEntryContentSHA256(entry LibraryEntry) ([sha256.Size]byte, error) {
	if entry.Language != LibraryLanguageST && entry.Language != LibraryLanguageFBD {
		return [sha256.Size]byte{}, fmt.Errorf("PROJECT library language phải là ST hoặc FBD")
	}
	if len(entry.SourceBlob) < 1 || len(entry.SourceBlob) > 64*1024 {
		return [sha256.Size]byte{}, fmt.Errorf("PROJECT library source phải dài 1..65536 byte")
	}
	if !utf8.Valid(entry.SourceBlob) {
		return [sha256.Size]byte{}, fmt.Errorf("PROJECT library source phải là UTF-8")
	}
	if len(entry.InterfaceJSON) < 2 || len(entry.InterfaceJSON) > 256*1024 {
		return [sha256.Size]byte{}, fmt.Errorf("PROJECT library interface phải dài 2..262144 byte")
	}
	canonicalInterface, err := canonicalLibraryJSON(entry.InterfaceJSON)
	if err != nil {
		return [sha256.Size]byte{}, fmt.Errorf("PROJECT library interface JSON: %w", err)
	}
	canonicalSource := append([]byte(nil), entry.SourceBlob...)
	if entry.Language == LibraryLanguageFBD {
		canonicalSource, err = canonicalLibraryJSON(entry.SourceBlob)
		if err != nil {
			return [sha256.Size]byte{}, fmt.Errorf("PROJECT library FBD source JSON: %w", err)
		}
	}
	dependencies := make([]LibraryDependency, len(entry.Dependencies))
	copy(dependencies, entry.Dependencies)
	for _, dependency := range dependencies {
		if !projectLibraryIDPattern.MatchString(dependency.EntryID) ||
			len(dependency.Version) < 1 || len(dependency.Version) > 64 {
			return [sha256.Size]byte{}, fmt.Errorf("PROJECT library dependency không hợp lệ")
		}
	}
	sort.Slice(dependencies, func(left, right int) bool {
		leftID, rightID := foldLibraryIdentifier(dependencies[left].EntryID), foldLibraryIdentifier(dependencies[right].EntryID)
		if leftID != rightID {
			return leftID < rightID
		}
		return dependencies[left].Version < dependencies[right].Version
	})
	type canonicalContent struct {
		SchemaVersion int                 `json:"schemaVersion"`
		Language      LibraryLanguage     `json:"language"`
		Source        string              `json:"source"`
		Interface     string              `json:"interface"`
		Dependencies  []LibraryDependency `json:"dependencies"`
	}
	raw, err := json.Marshal(canonicalContent{
		SchemaVersion: 1,
		Language:      entry.Language,
		Source:        string(canonicalSource),
		Interface:     string(canonicalInterface),
		Dependencies:  dependencies,
	})
	if err != nil {
		return [sha256.Size]byte{}, fmt.Errorf("canonicalize PROJECT library entry: %w", err)
	}
	return sha256.Sum256(raw), nil
}

// BuildProjectLibraryManifest chỉ nhận dữ liệu đã đọc trong transaction
// Publish. Caller không truyền manifest kết quả; nhờ vậy không thể ký một
// manifest khác với các entry thực sự sắp được đóng băng.
func BuildProjectLibraryManifest(revision LibraryRevision, entries []LibraryEntry) ([]byte, [sha256.Size]byte, error) {
	if revision.Scope != LibraryScopeProject || revision.State != LibraryRevisionDraft {
		return nil, [sha256.Size]byte{}, fmt.Errorf("chỉ PROJECT DRAFT được dựng manifest publish")
	}
	if !validProjectSemver(revision.Version) || revision.LibraryRevisionID == "" || revision.ProjectID == "" {
		return nil, [sha256.Size]byte{}, fmt.Errorf("PROJECT DRAFT identity/version không hợp lệ")
	}
	ordered := append([]LibraryEntry(nil), entries...)
	sort.Slice(ordered, func(left, right int) bool {
		return foldLibraryIdentifier(ordered[left].EntryID) < foldLibraryIdentifier(ordered[right].EntryID)
	})
	seenIDs := make(map[string]struct{}, len(ordered))
	seenNames := make(map[string]struct{}, len(ordered))
	type manifestEntry struct {
		EntryID            string              `json:"entryId"`
		Name               string              `json:"name"`
		Kind               LibraryEntryKind    `json:"kind"`
		Language           LibraryLanguage     `json:"language"`
		FeatureState       LibraryFeatureState `json:"featureState"`
		ContentSHA256      string              `json:"contentSha256"`
		Dependencies       []LibraryDependency `json:"dependencies"`
		StateLayoutKnown   bool                `json:"stateLayoutKnown"`
		StateLayoutVersion uint32              `json:"stateLayoutVersion,omitempty"`
		StateSizeBytes     uint32              `json:"stateSizeBytes"`
		StateLayoutSHA256  string              `json:"stateLayoutSha256,omitempty"`
	}
	manifestEntries := make([]manifestEntry, 0, len(ordered))
	for _, entry := range ordered {
		if entry.LibraryRevisionID != revision.LibraryRevisionID {
			return nil, [sha256.Size]byte{}, fmt.Errorf("entry %q thuộc library revision khác", entry.EntryID)
		}
		if err := ValidateLibraryEntry(entry, LibraryScopeProject, true); err != nil {
			return nil, [sha256.Size]byte{}, fmt.Errorf("entry %q: %w", entry.EntryID, err)
		}
		foldedID, foldedName := foldLibraryIdentifier(entry.EntryID), foldLibraryIdentifier(entry.Name)
		if _, exists := seenIDs[foldedID]; exists {
			return nil, [sha256.Size]byte{}, fmt.Errorf("entryId trùng case-insensitive: %s", entry.EntryID)
		}
		if _, exists := seenNames[foldedName]; exists {
			return nil, [sha256.Size]byte{}, fmt.Errorf("entry name trùng case-insensitive: %s", entry.Name)
		}
		seenIDs[foldedID], seenNames[foldedName] = struct{}{}, struct{}{}
		dependencies := make([]LibraryDependency, len(entry.Dependencies))
		copy(dependencies, entry.Dependencies)
		sort.Slice(dependencies, func(left, right int) bool {
			leftID, rightID := foldLibraryIdentifier(dependencies[left].EntryID), foldLibraryIdentifier(dependencies[right].EntryID)
			if leftID != rightID {
				return leftID < rightID
			}
			return dependencies[left].Version < dependencies[right].Version
		})
		item := manifestEntry{
			EntryID:            entry.EntryID,
			Name:               entry.Name,
			Kind:               entry.Kind,
			Language:           entry.Language,
			FeatureState:       entry.FeatureState,
			ContentSHA256:      hex.EncodeToString(entry.ContentSHA256[:]),
			Dependencies:       dependencies,
			StateLayoutKnown:   entry.StateLayout.Authoritative,
			StateLayoutVersion: entry.StateLayout.Version,
			StateSizeBytes:     entry.StateLayout.StateSizeBytes,
		}
		if entry.StateLayout.Authoritative && !allZeroDigest(entry.StateLayout.SHA256) {
			item.StateLayoutSHA256 = hex.EncodeToString(entry.StateLayout.SHA256[:])
		}
		manifestEntries = append(manifestEntries, item)
	}
	if err := ValidateLibraryDependencies(revision.Version, ordered); err != nil {
		return nil, [sha256.Size]byte{}, err
	}
	manifest := struct {
		SchemaVersion           int             `json:"schemaVersion"`
		LibraryRevisionID       string          `json:"libraryRevisionId"`
		ProjectID               string          `json:"projectId"`
		Version                 string          `json:"version"`
		ParentLibraryRevisionID string          `json:"parentLibraryRevisionId,omitempty"`
		Entries                 []manifestEntry `json:"entries"`
	}{
		SchemaVersion:           1,
		LibraryRevisionID:       revision.LibraryRevisionID,
		ProjectID:               revision.ProjectID,
		Version:                 revision.Version,
		ParentLibraryRevisionID: revision.ParentLibraryRevisionID,
		Entries:                 manifestEntries,
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return nil, [sha256.Size]byte{}, fmt.Errorf("dựng PROJECT library manifest: %w", err)
	}
	return raw, sha256.Sum256(raw), nil
}

func canonicalLibraryJSON(raw []byte) ([]byte, error) {
	return canonicaljson.Value(raw, 256*1024)
}

func validProjectSemver(value string) bool {
	if !projectSemverPattern.MatchString(value) {
		return false
	}
	withoutBuild := strings.SplitN(value, "+", 2)[0]
	parts := strings.SplitN(withoutBuild, "-", 2)
	if len(parts) != 2 {
		return true
	}
	for _, identifier := range strings.Split(parts[1], ".") {
		allDigits := true
		for _, character := range identifier {
			if character < '0' || character > '9' {
				allDigits = false
				break
			}
		}
		if allDigits && len(identifier) > 1 && identifier[0] == '0' {
			return false
		}
	}
	return true
}

// ValidateProjectLibraryVersion là validator SemVer duy nhất mà cả domain và
// store dùng. Numeric prerelease có leading zero bị từ chối theo SemVer 2.0.0.
func ValidateProjectLibraryVersion(value string) error {
	if !validProjectSemver(value) {
		return fmt.Errorf("PROJECT library version phải là SemVer")
	}
	return nil
}

// NextProjectLibraryMinorVersion sinh version Draft kế tiếp từ một bản đã
// publish. Chỉ tăng MINOR và xoá patch/prerelease/build: một Draft mới mở là
// tập thay đổi chưa biết trước, nên đoán PATCH sẽ nói sai mức tương thích ngay
// từ lúc chưa có thay đổi nào.
func NextProjectLibraryMinorVersion(current string) (string, error) {
	if err := ValidateProjectLibraryVersion(current); err != nil {
		return "", err
	}
	core := current
	for _, separator := range []string{"+", "-"} {
		if index := strings.Index(core, separator); index >= 0 {
			core = core[:index]
		}
	}
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("PROJECT library version không phải SemVer ba phần: %s", current)
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil || minor < 0 || minor >= 1<<20 {
		return "", fmt.Errorf("PROJECT library minor version không hợp lệ: %s", current)
	}
	return fmt.Sprintf("%s.%d.0", parts[0], minor+1), nil
}

// ValidateLibraryDependencies phân giải trên đúng một immutable revision. Tên
// được fold ASCII như IEC identifier; output và đường cycle đều deterministic.
func ValidateLibraryDependencies(version string, entries []LibraryEntry) error {
	byID := make(map[string]*LibraryEntry, len(entries))
	keys := make([]string, 0, len(entries))
	for index := range entries {
		key := foldLibraryIdentifier(entries[index].EntryID)
		if key == "" {
			return fmt.Errorf("entryId là bắt buộc")
		}
		if _, duplicate := byID[key]; duplicate {
			return fmt.Errorf("entryId trùng case-insensitive: %s", entries[index].EntryID)
		}
		byID[key] = &entries[index]
		keys = append(keys, key)
	}
	sort.Strings(keys)

	adjacency := make(map[string][]string, len(entries))
	for _, key := range keys {
		entry := byID[key]
		deps := append([]LibraryDependency(nil), entry.Dependencies...)
		sort.Slice(deps, func(left, right int) bool {
			return foldLibraryIdentifier(deps[left].EntryID) < foldLibraryIdentifier(deps[right].EntryID)
		})
		for _, dependency := range deps {
			dependencyKey := foldLibraryIdentifier(dependency.EntryID)
			actual, exists := byID[dependencyKey]
			if !exists {
				return &LibraryResolutionError{Cause: ErrLibraryEntryMissing, EntryID: dependency.EntryID, RequiredBy: entry.EntryID}
			}
			if dependency.Version != version {
				return &LibraryResolutionError{Cause: ErrLibraryVersionMismatch, EntryID: actual.EntryID, RequiredBy: entry.EntryID, ExpectedVersion: dependency.Version, ActualVersion: version}
			}
			adjacency[key] = append(adjacency[key], dependencyKey)
		}
	}

	const (
		unseen uint8 = iota
		visiting
		done
	)
	state := make(map[string]uint8, len(entries))
	stack := make([]string, 0, len(entries))
	var visit func(string) error
	visit = func(key string) error {
		state[key] = visiting
		stack = append(stack, key)
		for _, dependency := range adjacency[key] {
			switch state[dependency] {
			case unseen:
				if err := visit(dependency); err != nil {
					return err
				}
			case visiting:
				start := 0
				for stack[start] != dependency {
					start++
				}
				cycle := make([]string, 0, len(stack)-start+1)
				for _, item := range stack[start:] {
					cycle = append(cycle, byID[item].EntryID)
				}
				cycle = append(cycle, byID[dependency].EntryID)
				return &LibraryResolutionError{Cause: ErrLibraryDependencyCycle, Cycle: cycle}
			}
		}
		stack = stack[:len(stack)-1]
		state[key] = done
		return nil
	}
	for _, key := range keys {
		if state[key] == unseen {
			if err := visit(key); err != nil {
				return err
			}
		}
	}
	return nil
}

// SystemLibraryEntries trả bản sao để caller không thể sửa registry process-wide.
func SystemLibraryEntries() ([]LibraryEntry, error) {
	entries := make([]LibraryEntry, 0, len(systemLibraryEntryDefinitions))
	for _, definition := range systemLibraryEntryDefinitions {
		digestBytes, err := hex.DecodeString(definition.ContentSHA256Hex)
		if err != nil || len(digestBytes) != sha256.Size {
			return nil, fmt.Errorf("SYSTEM library entry %s có content hash sinh lỗi", definition.EntryID)
		}
		actual := sha256.Sum256([]byte(definition.SignatureJSON))
		if !strings.EqualFold(hex.EncodeToString(actual[:]), definition.ContentSHA256Hex) {
			return nil, fmt.Errorf("SYSTEM library entry %s content hash mismatch", definition.EntryID)
		}
		var digest [sha256.Size]byte
		copy(digest[:], digestBytes)
		entry := LibraryEntry{
			LibraryRevisionID: SystemLibraryRevisionID,
			EntryID:           definition.EntryID,
			Kind:              definition.Kind,
			Name:              definition.Name,
			FeatureState:      definition.FeatureState,
			SignatureJSON:     []byte(definition.SignatureJSON),
			ContentSHA256:     digest,
			Category:          definition.Category,
			StateLayout: LibraryStateLayout{
				Authoritative:  definition.StateSizeAuthoritative,
				StateSizeBytes: definition.StateSizeBytes,
			},
		}
		if err := ValidateLibraryEntry(entry, LibraryScopeSystem, true); err != nil {
			return nil, fmt.Errorf("SYSTEM library entry %s: %w", definition.EntryID, err)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func SystemLibraryRevision() (LibraryRevision, error) {
	manifest := []byte(SystemLibraryManifestJSON)
	digest := sha256.Sum256(manifest)
	if hex.EncodeToString(digest[:]) != SystemLibraryRegistrySHA256 {
		return LibraryRevision{}, fmt.Errorf("SYSTEM library registry hash mismatch")
	}
	revision := LibraryRevision{
		LibraryRevisionID: SystemLibraryRevisionID,
		Scope:             LibraryScopeSystem,
		Version:           SystemLibraryVersion,
		State:             LibraryRevisionPublished,
		ManifestJSON:      append([]byte(nil), manifest...),
		ManifestSHA256:    digest,
		CreatedBy:         "mkddc-system-registry",
	}
	if err := ValidateLibraryRevision(revision); err != nil {
		return LibraryRevision{}, err
	}
	return revision, nil
}

func foldLibraryIdentifier(value string) string { return strings.ToUpper(value) }

func allZeroDigest(value [sha256.Size]byte) bool {
	return value == [sha256.Size]byte{}
}
