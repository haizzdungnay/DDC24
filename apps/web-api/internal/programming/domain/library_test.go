package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"
)

type libraryRegistryContract struct {
	RegistryID     string            `json:"registryId"`
	LibraryVersion string            `json:"libraryVersion"`
	Entries        []json.RawMessage `json:"entries"`
}

type libraryRegistryEntryContract struct {
	ID           string              `json:"id"`
	Kind         LibraryEntryKind    `json:"kind"`
	FeatureState LibraryFeatureState `json:"featureState"`
}

func readLibraryRegistryContract(t *testing.T) ([]byte, libraryRegistryContract) {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được source path")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(currentFile),
		"../../../../../contracts/programming/pou_library_registry_v1.json"))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var contract libraryRegistryContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	return raw, contract
}

func TestSystemLibraryGeneratedFromRegistryWithoutDrift(t *testing.T) {
	raw, contract := readLibraryRegistryContract(t)
	if SystemLibraryRegistryID != contract.RegistryID || SystemLibraryVersion != contract.LibraryVersion {
		t.Fatalf("token SYSTEM library lệch registry: %s/%s", SystemLibraryRegistryID, SystemLibraryVersion)
	}
	if SystemLibraryManifestJSON != string(raw) {
		t.Fatal("manifest Go không giữ đúng byte registry nguồn")
	}
	if digest := sha256.Sum256(raw); hex.EncodeToString(digest[:]) != SystemLibraryRegistrySHA256 {
		t.Fatal("hash registry Go lệch JSON nguồn")
	}
	entries, err := SystemLibraryEntries()
	if err != nil {
		t.Fatal(err)
	}
	// `T59-804` thêm TP/CTU/CTD (43). Con số ghim ở đây là CỐ Ý: nó bắt một
	// lần thêm entry phải đi kèm người sửa test đọc lại danh sách, thay vì để
	// registry lớn dần mà không ai đối chiếu.
	if len(entries) != len(contract.Entries) || len(entries) != 43 {
		t.Fatalf("số entry Go/JSON = %d/%d, cần 43", len(entries), len(contract.Entries))
	}
	for index, rawEntry := range contract.Entries {
		var want libraryRegistryEntryContract
		if err := json.Unmarshal(rawEntry, &want); err != nil {
			t.Fatal(err)
		}
		got := entries[index]
		if got.EntryID != want.ID || got.Name != want.ID || got.Kind != want.Kind ||
			got.FeatureState != want.FeatureState {
			t.Fatalf("entry %d lệch registry: got=%+v want=%+v", index, got, want)
		}
		var rawValue, signatureValue any
		if err := json.Unmarshal(rawEntry, &rawValue); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(got.SignatureJSON, &signatureValue); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(rawValue, signatureValue) {
			t.Fatalf("entry %d signature Go không giữ đủ metadata registry", index)
		}
	}

	// Caller nhận bản sao: sửa một lần đọc không được làm bẩn registry process-wide.
	entries[0].EntryID = "MUTATED"
	entries[0].SignatureJSON[0] = '!'
	again, err := SystemLibraryEntries()
	if err != nil {
		t.Fatal(err)
	}
	var first libraryRegistryEntryContract
	if err := json.Unmarshal(contract.Entries[0], &first); err != nil {
		t.Fatal(err)
	}
	if again[0].EntryID != first.ID || again[0].SignatureJSON[0] == '!' {
		t.Fatal("SYSTEM library registry bị caller sửa xuyên lần đọc")
	}
}

func TestSystemLibraryStateSizeOnlyClaimsAuthoritativeFacts(t *testing.T) {
	entries, err := SystemLibraryEntries()
	if err != nil {
		t.Fatal(err)
	}
	var functions, blocks int
	for _, entry := range entries {
		switch entry.Kind {
		case LibraryEntryFunction, LibraryEntryConversion:
			functions++
			if !entry.StateLayout.Authoritative || entry.StateLayout.StateSizeBytes != 0 {
				t.Fatalf("%s phải có state_size=0 authoritative", entry.EntryID)
			}
		case LibraryEntryFunctionBlock:
			blocks++
			if entry.StateLayout.Authoritative {
				t.Fatalf("%s không được đoán state_size khi JSON chưa mang layout", entry.EntryID)
			}
		}
	}
	if functions != 35 || blocks != 8 {
		t.Fatalf("phân loại FUNCTION/FB = %d/%d, cần 35/8", functions, blocks)
	}
}

func TestProjectFunctionBlockPublishRequiresAuthoritativeLayout(t *testing.T) {
	entry := testLibraryEntry("Controller", LibraryEntryFunctionBlock)
	if err := ValidateLibraryEntry(entry, LibraryScopeProject, false); err != nil {
		t.Fatalf("DRAFT được phép chờ layout: %v", err)
	}
	if err := ValidateLibraryEntry(entry, LibraryScopeProject, true); !errors.Is(err, ErrLibraryStateLayout) {
		t.Fatalf("publish FB thiếu layout: got %v", err)
	}
	entry.StateLayout.Authoritative = true
	entry.StateLayout.Version = 1
	entry.StateLayout.SHA256[0] = 1
	if err := ValidateLibraryEntry(entry, LibraryScopeProject, true); err != nil {
		t.Fatalf("layout authoritative hợp lệ bị từ chối: %v", err)
	}

	function := testLibraryEntry("Clamp", LibraryEntryFunction)
	function.StateLayout.Authoritative = true
	if err := ValidateLibraryEntry(function, LibraryScopeProject, true); err != nil {
		t.Fatalf("FUNCTION state_size=0 authoritative bị từ chối: %v", err)
	}
	function.StateLayout.StateSizeBytes = 1
	if err := ValidateLibraryEntry(function, LibraryScopeProject, true); !errors.Is(err, ErrLibraryStateLayout) {
		t.Fatalf("FUNCTION state_size khác 0 không fail-closed: %v", err)
	}
}

func TestProjectLibraryRejectsConversionUnknownScopeAndStaleUnknownLayout(t *testing.T) {
	conversion := testLibraryEntry("REAL_TO_INT", LibraryEntryConversion)
	if err := ValidateLibraryEntry(conversion, LibraryScopeProject, false); err == nil {
		t.Fatal("PROJECT CONVERSION được chấp nhận dù Product chỉ cho user Function/FB")
	}
	function := testLibraryEntry("Clamp", LibraryEntryFunction)
	if err := ValidateLibraryEntry(function, LibraryScope("TENANT"), false); err == nil {
		t.Fatal("scope lạ được chấp nhận")
	}
	block := testLibraryEntry("Controller", LibraryEntryFunctionBlock)
	block.StateLayout.Version = 1
	if err := ValidateLibraryEntry(block, LibraryScopeProject, false); !errors.Is(err, ErrLibraryStateLayout) {
		t.Fatalf("layout unknown mang version stale không fail-closed: %v", err)
	}
}

func TestProjectLibraryContentHashCoversCanonicalSourceInterfaceAndDependencies(t *testing.T) {
	entry := testLibraryEntry("Controller", LibraryEntryFunctionBlock)
	original := entry.ContentSHA256

	changedSource := entry
	changedSource.SourceBlob = []byte("FUNCTION_BLOCK Controller\nVAR x : BOOL; END_VAR\nEND_FUNCTION_BLOCK")
	if digest, err := ProjectLibraryEntryContentSHA256(changedSource); err != nil || digest == original {
		t.Fatalf("đổi source không đổi hash: digest=%x err=%v", digest, err)
	}
	changedInterface := entry
	changedInterface.InterfaceJSON = []byte(`{"ports":[{"name":"IN","type":"BOOL"}]}`)
	if digest, err := ProjectLibraryEntryContentSHA256(changedInterface); err != nil || digest == original {
		t.Fatalf("đổi interface không đổi hash: digest=%x err=%v", digest, err)
	}
	changedDependency := entry
	changedDependency.Dependencies = []LibraryDependency{{EntryID: testLibraryUUID("Helper"), Version: "1.2.3"}}
	if digest, err := ProjectLibraryEntryContentSHA256(changedDependency); err != nil || digest == original {
		t.Fatalf("đổi dependency không đổi hash: digest=%x err=%v", digest, err)
	}

	// Chỉ đảo key JSON/whitespace hoặc thứ tự dependency không được đổi identity.
	canonicalA := entry
	canonicalA.InterfaceJSON = []byte(`{"return":"REAL","ports":[]}`)
	canonicalA.Dependencies = []LibraryDependency{{EntryID: testLibraryUUID("Zed"), Version: "1.2.3"}, {EntryID: testLibraryUUID("Alpha"), Version: "1.2.3"}}
	canonicalB := canonicalA
	canonicalB.InterfaceJSON = []byte("{ \"ports\": [], \"return\": \"REAL\" }")
	canonicalB.Dependencies = []LibraryDependency{{EntryID: testLibraryUUID("Alpha"), Version: "1.2.3"}, {EntryID: testLibraryUUID("Zed"), Version: "1.2.3"}}
	hashA, errA := ProjectLibraryEntryContentSHA256(canonicalA)
	hashB, errB := ProjectLibraryEntryContentSHA256(canonicalB)
	if errA != nil || errB != nil || hashA != hashB {
		t.Fatalf("canonical content không ổn định: %x/%x err=%v/%v", hashA, hashB, errA, errB)
	}
}

func TestProjectLibraryManifestIsCanonicalAndRejectsCycle(t *testing.T) {
	revision := testLibraryRevision(LibraryRevisionDraft, "1.2.3")
	left := testLibraryEntry("Left", LibraryEntryFunction)
	right := testLibraryEntry("Right", LibraryEntryFunctionBlock)
	left.LibraryRevisionID = revision.LibraryRevisionID
	right.LibraryRevisionID = revision.LibraryRevisionID
	right.StateLayout.Authoritative = true
	right.StateLayout.Version = 1
	right.StateLayout.SHA256[0] = 1
	left.Dependencies = []LibraryDependency{{EntryID: right.EntryID, Version: revision.Version}}
	left.ContentSHA256, _ = ProjectLibraryEntryContentSHA256(left)

	manifestA, digestA, err := BuildProjectLibraryManifest(revision, []LibraryEntry{left, right})
	if err != nil {
		t.Fatal(err)
	}
	manifestB, digestB, err := BuildProjectLibraryManifest(revision, []LibraryEntry{right, left})
	if err != nil || string(manifestA) != string(manifestB) || digestA != digestB {
		t.Fatalf("manifest phụ thuộc thứ tự input: %s / %s / %v", manifestA, manifestB, err)
	}

	right.Dependencies = []LibraryDependency{{EntryID: left.EntryID, Version: revision.Version}}
	right.ContentSHA256, _ = ProjectLibraryEntryContentSHA256(right)
	if _, _, err := BuildProjectLibraryManifest(revision, []LibraryEntry{left, right}); !errors.Is(err, ErrLibraryDependencyCycle) {
		t.Fatalf("manifest publish nhận dependency vòng: %v", err)
	}
}

func TestLibraryResolutionKeepsMissingVersionAndCycleDistinct(t *testing.T) {
	base := []LibraryEntry{
		testLibraryEntry("A", LibraryEntryFunction),
		testLibraryEntry("B", LibraryEntryFunction),
	}

	missing := cloneLibraryEntries(base)
	missing[0].Dependencies = []LibraryDependency{{EntryID: "DOES_NOT_EXIST", Version: "1.2.3"}}
	err := ValidateLibraryDependencies("1.2.3", missing)
	assertLibraryDiagnostic(t, err, ErrLibraryEntryMissing, LibraryDiagnosticMissing)

	wrongVersion := cloneLibraryEntries(base)
	wrongVersion[0].Dependencies = []LibraryDependency{{EntryID: wrongVersion[1].EntryID, Version: "1.2.4"}}
	err = ValidateLibraryDependencies("1.2.3", wrongVersion)
	assertLibraryDiagnostic(t, err, ErrLibraryVersionMismatch, LibraryDiagnosticVersion)

	cycle := cloneLibraryEntries(base)
	cycle[0].Dependencies = []LibraryDependency{{EntryID: cycle[1].EntryID, Version: "1.2.3"}}
	cycle[1].Dependencies = []LibraryDependency{{EntryID: cycle[0].EntryID, Version: "1.2.3"}}
	err = ValidateLibraryDependencies("1.2.3", cycle)
	assertLibraryDiagnostic(t, err, ErrLibraryDependencyCycle, LibraryDiagnosticCycle)
}

func TestLibraryDependencyDiamondIsNotCycleAndOrderIndependent(t *testing.T) {
	entries := []LibraryEntry{
		testLibraryEntry("Top", LibraryEntryFunction),
		testLibraryEntry("Left", LibraryEntryFunction),
		testLibraryEntry("Right", LibraryEntryFunction),
		testLibraryEntry("Shared", LibraryEntryFunction),
	}
	entries[0].Dependencies = []LibraryDependency{{EntryID: entries[2].EntryID, Version: "2.0.0"}, {EntryID: entries[1].EntryID, Version: "2.0.0"}}
	entries[1].Dependencies = []LibraryDependency{{EntryID: entries[3].EntryID, Version: "2.0.0"}}
	entries[2].Dependencies = []LibraryDependency{{EntryID: entries[3].EntryID, Version: "2.0.0"}}
	if err := ValidateLibraryDependencies("2.0.0", entries); err != nil {
		t.Fatalf("diamond hợp lệ bị coi là cycle: %v", err)
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].EntryID > entries[right].EntryID })
	if err := ValidateLibraryDependencies("2.0.0", entries); err != nil {
		t.Fatalf("đảo thứ tự input làm đổi kết quả: %v", err)
	}
}

func TestProjectRevisionUsesImmutableSemverLifecycle(t *testing.T) {
	draft := testLibraryRevision(LibraryRevisionDraft, "1.2.3")
	if err := ValidateLibraryRevision(draft); err != nil {
		t.Fatal(err)
	}
	badVersion := draft
	badVersion.Version = "rev-a.1"
	if err := ValidateLibraryRevision(badVersion); err == nil {
		t.Fatal("PROJECT version ngoài SemVer được chấp nhận")
	}
	for _, invalid := range []string{"1.2.3-01", "1.2.3-alpha.01"} {
		badVersion = draft
		badVersion.Version = invalid
		if err := ValidateLibraryRevision(badVersion); err == nil {
			t.Fatalf("SemVer prerelease leading-zero %q được chấp nhận", invalid)
		}
	}

	published := draft
	published.State = LibraryRevisionPublished
	if err := ValidateLibraryTransition(draft, published); err != nil {
		t.Fatalf("DRAFT→PUBLISHED bị từ chối: %v", err)
	}
	refreshedDraft := draft
	refreshedDraft.ManifestJSON = []byte(`{"entries":[{"entryId":"A"}]}`)
	refreshedDraft.ManifestSHA256 = sha256.Sum256(refreshedDraft.ManifestJSON)
	if err := ValidateLibraryTransition(draft, refreshedDraft); err != nil {
		t.Fatalf("refresh manifest khi còn DRAFT bị từ chối: %v", err)
	}
	mutatedPublished := published
	mutatedPublished.ManifestJSON = refreshedDraft.ManifestJSON
	mutatedPublished.ManifestSHA256 = refreshedDraft.ManifestSHA256
	if err := ValidateLibraryTransition(published, mutatedPublished); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("đổi manifest PUBLISHED không bị khóa: %v", err)
	}
	deprecated := published
	deprecated.State = LibraryRevisionDeprecated
	if err := ValidateLibraryTransition(published, deprecated); err != nil {
		t.Fatalf("PUBLISHED→DEPRECATED bị từ chối: %v", err)
	}
	rollback := deprecated
	rollback.State = LibraryRevisionDraft
	if err := ValidateLibraryTransition(deprecated, rollback); !errors.Is(err, ErrLibraryInvalidTransition) {
		t.Fatalf("DEPRECATED→DRAFT không fail-closed: %v", err)
	}
	changedVersion := draft
	changedVersion.Version = "1.2.4"
	if err := ValidateLibraryTransition(draft, changedVersion); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("đổi version tại chỗ không bị khóa immutable: %v", err)
	}
}

func TestSystemLibraryRevisionRoundTripDefinition(t *testing.T) {
	revision, err := SystemLibraryRevision()
	if err != nil {
		t.Fatal(err)
	}
	if revision.Scope != LibraryScopeSystem || revision.State != LibraryRevisionPublished ||
		revision.ProjectID != "" || revision.Version != SystemLibraryVersion {
		t.Fatalf("SYSTEM revision sai: %+v", revision)
	}
	if revision.ManifestSHA256 != sha256.Sum256(revision.ManifestJSON) {
		t.Fatal("SYSTEM revision manifest hash không khớp")
	}
}

func TestSystemLibraryHasNoDraftOrLifecycleTransition(t *testing.T) {
	revision, err := SystemLibraryRevision()
	if err != nil {
		t.Fatal(err)
	}
	draft := revision
	draft.State = LibraryRevisionDraft
	if err := ValidateLibraryRevision(draft); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("SYSTEM+DRAFT không bị từ chối: %v", err)
	}
	deprecated := revision
	deprecated.State = LibraryRevisionDeprecated
	if err := ValidateLibraryRevision(deprecated); err != nil {
		t.Fatalf("record SYSTEM DEPRECATED authoritative phải đọc được: %v", err)
	}
	if err := ValidateLibraryTransition(revision, deprecated); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("SYSTEM transition không bị khóa read-only: %v", err)
	}
}

func testLibraryEntry(name string, kind LibraryEntryKind) LibraryEntry {
	entry := LibraryEntry{
		LibraryRevisionID: "library-revision",
		EntryID:           testLibraryUUID(name),
		Kind:              kind,
		Name:              name,
		FeatureState:      LibraryFeatureAvailable,
		Language:          LibraryLanguageST,
		SourceBlob:        []byte("FUNCTION " + name + "\nEND_FUNCTION"),
		InterfaceJSON:     []byte(`{"ports":[]}`),
	}
	if kind != LibraryEntryFunctionBlock {
		entry.StateLayout.Authoritative = true
	}
	entry.ContentSHA256, _ = ProjectLibraryEntryContentSHA256(entry)
	return entry
}

func testLibraryUUID(seed string) string {
	digest := sha256.Sum256([]byte(seed))
	digest[6] = (digest[6] & 0x0f) | 0x40
	digest[8] = (digest[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		digest[0:4], digest[4:6], digest[6:8], digest[8:10], digest[10:16])
}

func testLibraryRevision(state LibraryRevisionState, version string) LibraryRevision {
	manifest := []byte(`{"entries":[]}`)
	return LibraryRevision{
		LibraryRevisionID: "11111111-1111-4111-8111-111111111111",
		ProjectID:         "22222222-2222-4222-8222-222222222222",
		Scope:             LibraryScopeProject,
		Version:           version,
		State:             state,
		ManifestJSON:      manifest,
		ManifestSHA256:    sha256.Sum256(manifest),
		CreatedBy:         "tester",
		CreatedAtUTCMS:    1,
	}
}

func cloneLibraryEntries(entries []LibraryEntry) []LibraryEntry {
	clone := append([]LibraryEntry(nil), entries...)
	for index := range clone {
		clone[index].Dependencies = append([]LibraryDependency(nil), entries[index].Dependencies...)
	}
	return clone
}

func assertLibraryDiagnostic(t *testing.T, err, cause error, code string) {
	t.Helper()
	if !errors.Is(err, cause) {
		t.Fatalf("got %v, cần cause %v", err, cause)
	}
	var resolution *LibraryResolutionError
	if !errors.As(err, &resolution) {
		t.Fatalf("lỗi %v không giữ LibraryResolutionError", err)
	}
	if resolution.DiagnosticCode() != code {
		t.Fatalf("diagnostic = %s, cần %s", resolution.DiagnosticCode(), code)
	}
}
