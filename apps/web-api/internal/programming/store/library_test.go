package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	libraryRevisionA = "55555555-5555-4555-8555-555555555551"
	libraryRevisionB = "55555555-5555-4555-8555-555555555552"
	entryScaleID     = "66666666-6666-4666-8666-666666666661"
	entryFilterID    = "66666666-6666-4666-8666-666666666662"
	pouObjectID      = "77777777-7777-4777-8777-777777777771"
)

func functionEntry(revisionID, entryID, name string, dependencies ...LibraryDependency) UpsertProjectLibraryEntryParams {
	return UpsertProjectLibraryEntryParams{
		LibraryRevisionID: revisionID, EntryID: entryID, Kind: LibraryKindFunction, Name: name,
		Language: "ST", FeatureState: "AVAILABLE",
		Source:        []byte("FUNCTION " + name + " : REAL\nVAR_INPUT X : REAL; END_VAR\n" + name + " := X;\nEND_FUNCTION\n"),
		InterfaceJSON: []byte(`{"inputs":[{"name":"X","type":"REAL"}],"returnType":"REAL"}`),
		Dependencies:  dependencies,
		StateLayout:   LibraryStateLayout{Authoritative: true},
	}
}

func functionBlockEntry(revisionID, entryID, name string, layout LibraryStateLayout) UpsertProjectLibraryEntryParams {
	return UpsertProjectLibraryEntryParams{
		LibraryRevisionID: revisionID, EntryID: entryID, Kind: LibraryKindFunctionBlock, Name: name,
		Language: "ST", FeatureState: "AVAILABLE",
		Source:        []byte("FUNCTION_BLOCK " + name + "\nVAR_INPUT X : REAL; END_VAR\nVAR_OUTPUT Y : REAL; END_VAR\nY := X;\nEND_FUNCTION_BLOCK\n"),
		InterfaceJSON: []byte(`{"inputs":[{"name":"X","type":"REAL"}],"outputs":[{"name":"Y","type":"REAL"}]}`),
		StateLayout:   layout,
	}
}

func authoritativeFBLayout(size uint32) LibraryStateLayout {
	return LibraryStateLayout{Authoritative: true, Version: 1, StateSizeBytes: size, SHA256: sha256.Sum256([]byte("fb-layout"))}
}

// ensureProjectFixture giữ FK library_revisions.project_id hợp lệ mà không tạo
// hai lần khi test đã tự dựng Project để lấy Draft ETag.
func ensureProjectFixture(t *testing.T, store *Store) Draft {
	t.Helper()
	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM projects WHERE project_id=?`, projectID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count == 0 {
		return createProjectFixture(t, store)
	}
	draft, err := store.GetDraft(context.Background(), draftID)
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

// libraryFixture giữ ETag Draft hiện hành giữa các mutation. Mọi mutation
// Control Library đi chung lane optimistic-concurrency với tài liệu Draft, nên
// test cũng phải mang ETag theo thay vì giả vờ rằng nó không đổi.
type libraryFixture struct {
	store *Store
	draft Draft
	nonce int
	seq   int
}

// libraryFixtureNonce giữ khoá idempotency của hai fixture khác nhau không đụng
// nhau. Không có nó, fixture thứ hai trong cùng test gửi lại đúng cặp
// key+request của fixture thứ nhất và nhận REPLAY — test sẽ xanh vì lý do sai.
var libraryFixtureNonce int

func newLibraryFixture(t *testing.T, store *Store) *libraryFixture {
	t.Helper()
	libraryFixtureNonce++
	return &libraryFixture{store: store, draft: ensureProjectFixture(t, store), nonce: libraryFixtureNonce}
}

func (f *libraryFixture) identity(label string) LibraryMutationIdentity {
	f.seq++
	key, request := mutationIdentity(fmt.Sprintf("%s-%d-%d", label, f.nonce, f.seq))
	return LibraryMutationIdentity{
		ProjectID: projectID, ExpectedDraftETag: f.draft.ETag, ActorID: actorID, Role: role,
		AuditID:       fmt.Sprintf("aaaaaaaa-aaaa-4aaa-8aaa-%012d", f.seq),
		CorrelationID: correlationID, At: fixedNow.Add(time.Duration(f.seq) * time.Second),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	}
}

func (f *libraryFixture) upsert(t *testing.T, params UpsertProjectLibraryEntryParams) LibraryEntryMutation {
	t.Helper()
	result, err := f.tryUpsert(params)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func (f *libraryFixture) tryUpsert(params UpsertProjectLibraryEntryParams) (LibraryEntryMutation, error) {
	params.Identity = f.identity("library-upsert")
	result, err := f.store.UpsertProjectLibraryEntry(context.Background(), params)
	if err == nil {
		f.draft.ETag = result.DraftETag
	}
	return result, err
}

func (f *libraryFixture) tryDelete(libraryRevisionID, entryID string) (LibraryEntryMutation, error) {
	result, err := f.store.DeleteProjectLibraryEntry(context.Background(), DeleteProjectLibraryEntryParams{
		LibraryRevisionID: libraryRevisionID, EntryID: entryID, Identity: f.identity("library-delete"),
	})
	if err == nil {
		f.draft.ETag = result.DraftETag
	}
	return result, err
}

func createLibraryDraftFixture(t *testing.T, store *Store, revisionID, version string) LibraryRevision {
	t.Helper()
	ensureProjectFixture(t, store)
	revision, err := store.CreateProjectLibraryDraft(context.Background(), CreateProjectLibraryDraftParams{
		LibraryRevisionID: revisionID, ProjectID: projectID, Version: version,
		CreatedBy: actorID, AtUTCMS: fixedNow.UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return revision
}

// publishedLibraryFixture dựng một PROJECT Library đã publish gồm một FUNCTION
// và một FUNCTION_BLOCK phụ thuộc nó, để test reference/usage có dữ liệu thật.
func publishedLibraryFixture(t *testing.T, store *Store) LibraryRevision {
	t.Helper()
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	fixture.upsert(t, functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN"))
	fixture.upsert(t, functionBlockEntry(libraryRevisionA, entryFilterID, "FILTER_T1", authoritativeFBLayout(16)))
	revision, err := store.PublishProjectLibrary(context.Background(), libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	return revision
}

// SYSTEM Library không nằm trong SQLite. Test khoá cả hai chiều: store đọc được
// snapshot sinh từ registry, và không đường nào — API store lẫn SQL trực tiếp —
// tạo/sửa/xoá được một bản SYSTEM song song trong DB.
func TestSystemLibraryIsVirtualReadOnlyAndUnreachableBySQL(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	if store.system == nil {
		t.Fatal("store không nạp SYSTEM Control Library")
	}
	systemID := store.system.Revision.LibraryRevisionID

	revision, err := store.GetLibraryRevision(ctx, systemID)
	if err != nil {
		t.Fatal(err)
	}
	if revision.Scope != LibraryScopeSystem || revision.ProjectID != "" || revision.State != LibraryStatePublished {
		t.Fatalf("SYSTEM revision không đúng: %+v", revision)
	}
	entries, err := store.ListLibraryEntries(ctx, systemID)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != len(store.system.Entries) || len(entries) == 0 {
		t.Fatalf("SYSTEM entries=%d snapshot=%d", len(entries), len(store.system.Entries))
	}

	// SYSTEM revision không có hàng nào trong SQLite.
	var rows int
	if err := store.db.QueryRow(`SELECT count(*) FROM library_revisions WHERE scope='SYSTEM'`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("SYSTEM bị seed vào SQLite: %d hàng", rows)
	}

	// Sửa bản sao trả về không được chạm snapshot process-wide.
	entries[0].Name = "TAMPERED"
	entries[0].SignatureJSON[0] ^= 0xFF
	fresh, err := store.ListLibraryEntries(ctx, systemID)
	if err != nil {
		t.Fatal(err)
	}
	if fresh[0].Name == "TAMPERED" || fresh[0].SignatureJSON[0] == entries[0].SignatureJSON[0] {
		t.Fatal("snapshot SYSTEM bị caller sửa được")
	}

	// SQL trực tiếp cũng bị trigger chặn — không có đường đặc quyền nào. Hàng
	// dưới đây thoả mọi CHECK của schema, nên thứ từ chối nó đúng là trigger
	// SYSTEM chứ không phải một ràng buộc phụ nào khác.
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	for name, statement := range map[string]string{
		"insert": `INSERT INTO library_revisions(library_revision_id,project_id,scope,version,state,manifest_json,manifest_sha256,created_by,created_at_utc_ms)
			VALUES('88888888-8888-4888-8888-888888888881',NULL,'SYSTEM','rev-a.1','PUBLISHED',x'7B7D',randomblob(32),'attacker',1)`,
		"update": `UPDATE library_revisions SET scope='SYSTEM',project_id=NULL WHERE library_revision_id='` + libraryRevisionA + `'`,
	} {
		if _, err := store.db.ExecContext(ctx, statement); err == nil {
			t.Fatalf("SQL %s tạo được SYSTEM library", name)
		}
	}
}

// Publish đóng băng nội dung. Sau publish, mọi đường sửa entry hoặc quay lại
// DRAFT đều phải chết ở store lẫn ở trigger DB.
func TestPublishedProjectLibraryIsImmutableAtStoreAndSchema(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	published := publishedLibraryFixture(t, store)
	fixture := newLibraryFixture(t, store)
	if published.State != LibraryStatePublished || published.ManifestSHA256 == ([sha256.Size]byte{}) {
		t.Fatalf("publish không đặt state/manifest: %+v", published)
	}

	if _, err := fixture.tryUpsert(functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("upsert sau publish: %v", err)
	}
	if _, err := fixture.tryDelete(libraryRevisionA, entryScaleID); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("delete sau publish: %v", err)
	}
	if _, err := store.PublishProjectLibrary(ctx, libraryRevisionA); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("publish lần hai: %v", err)
	}

	for name, statement := range map[string]string{
		"entry-update":     `UPDATE library_entries SET name='HACKED' WHERE library_revision_id=?`,
		"entry-delete":     `DELETE FROM library_entries WHERE library_revision_id=?`,
		"revision-delete":  `DELETE FROM library_revisions WHERE library_revision_id=?`,
		"back-to-draft":    `UPDATE library_revisions SET state='DRAFT' WHERE library_revision_id=?`,
		"manifest-rewrite": `UPDATE library_revisions SET manifest_json=x'7B7D' WHERE library_revision_id=?`,
	} {
		if _, err := store.db.ExecContext(ctx, statement, libraryRevisionA); err == nil {
			t.Fatalf("SQL %s vượt được immutability", name)
		}
	}

	// Deprecate là chuyển trạng thái hợp lệ duy nhất, và là terminal.
	deprecated, err := store.DeprecateProjectLibrary(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	if deprecated.State != LibraryStateDeprecated || deprecated.ManifestSHA256 != published.ManifestSHA256 {
		t.Fatalf("deprecate đổi manifest: %+v", deprecated)
	}
	if _, err := store.DeprecateProjectLibrary(ctx, libraryRevisionA); !errors.Is(err, ErrLibraryImmutable) {
		t.Fatalf("deprecate lần hai: %v", err)
	}
}

// FUNCTION_BLOCK chỉ được publish khi có layout authoritative. Đây là chỗ dễ
// bịa nhất: một số 0 mặc định sẽ làm lệch mọi offset RETAIN phía sau.
func TestPublishRejectsFunctionBlockWithoutAuthoritativeLayout(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	if _, err := fixture.tryUpsert(
		functionBlockEntry(libraryRevisionA, entryFilterID, "FILTER_T1", LibraryStateLayout{})); err != nil {
		t.Fatalf("Draft phải nhận FB chưa có layout: %v", err)
	}
	if _, err := store.PublishProjectLibrary(ctx, libraryRevisionA); !errors.Is(err, ErrLibraryStateLayout) {
		t.Fatalf("publish FB không layout: %v", err)
	}
	// Publish thất bại không được đổi state.
	revision, err := store.GetLibraryRevision(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	if revision.State != LibraryStateDraft {
		t.Fatalf("state sau publish lỗi: %s", revision.State)
	}
	// Layout nửa vời (có size, thiếu version/hash) cũng bị chặn ngay ở upsert.
	if _, err := fixture.tryUpsert(functionBlockEntry(libraryRevisionA, entryFilterID, "FILTER_T1",
		LibraryStateLayout{Authoritative: true, StateSizeBytes: 16})); !errors.Is(err, ErrLibraryStateLayout) {
		t.Fatalf("layout thiếu version/hash: %v", err)
	}
	// FUNCTION không được mang state khác 0.
	bad := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	bad.StateLayout = authoritativeFBLayout(8)
	if _, err := fixture.tryUpsert(bad); !errors.Is(err, ErrLibraryStateLayout) {
		t.Fatalf("FUNCTION mang state: %v", err)
	}
}

// Version mới là revision mới: clone nội dung parent, pin lại dependency sang
// version mới, và tuyệt đối không sửa parent.
func TestCreateProjectLibraryVersionClonesParentAndRepinsDependencies(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	fixture.upsert(t, functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN"))
	fixture.upsert(t, functionEntry(libraryRevisionA, entryFilterID, "FILTER_T1",
		LibraryDependency{EntryID: entryScaleID, Version: "1.0.0"}))
	parent, err := store.PublishProjectLibrary(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}

	next, err := store.CreateProjectLibraryVersion(ctx, CreateProjectLibraryDraftParams{
		LibraryRevisionID: libraryRevisionB, ProjectID: projectID, Version: "1.1.0",
		ParentLibraryRevisionID: libraryRevisionA, CreatedBy: actorID, AtUTCMS: fixedNow.UnixMilli() + 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if next.State != LibraryStateDraft || next.ParentLibraryRevisionID != libraryRevisionA {
		t.Fatalf("version mới không phải Draft có parent: %+v", next)
	}
	cloned, err := store.ListLibraryEntries(ctx, libraryRevisionB)
	if err != nil {
		t.Fatal(err)
	}
	if len(cloned) != 2 {
		t.Fatalf("clone thiếu entry: %d", len(cloned))
	}
	for _, entry := range cloned {
		for _, dependency := range entry.Dependencies {
			if dependency.Version != "1.1.0" {
				t.Fatalf("dependency chưa re-pin: %+v", dependency)
			}
		}
	}
	// Nội dung khác version pin nên content hash phải khác parent ở đúng entry
	// có dependency, và giống parent ở entry không có dependency.
	parentEntries, err := store.ListLibraryEntries(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	byName := func(entries []LibraryEntry, name string) LibraryEntry {
		for _, entry := range entries {
			if entry.Name == name {
				return entry
			}
		}
		t.Fatalf("không tìm thấy entry %s", name)
		return LibraryEntry{}
	}
	if byName(parentEntries, "SCALE_LIN").ContentSHA256 != byName(cloned, "SCALE_LIN").ContentSHA256 {
		t.Fatal("entry không dependency phải giữ nguyên content hash")
	}
	if byName(parentEntries, "FILTER_T1").ContentSHA256 == byName(cloned, "FILTER_T1").ContentSHA256 {
		t.Fatal("entry đã re-pin dependency phải đổi content hash")
	}
	// Parent giữ nguyên state/manifest sau khi tạo version mới.
	after, err := store.GetLibraryRevision(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	if after.State != parent.State || after.ManifestSHA256 != parent.ManifestSHA256 {
		t.Fatalf("parent bị sửa khi tạo version: %+v", after)
	}
	// Parent phải là PROJECT đã publish của cùng Project.
	if _, err := store.CreateProjectLibraryVersion(ctx, CreateProjectLibraryDraftParams{
		LibraryRevisionID: "99999999-9999-4999-8999-999999999991", ProjectID: projectID, Version: "1.2.0",
		ParentLibraryRevisionID: libraryRevisionB, CreatedBy: actorID, AtUTCMS: fixedNow.UnixMilli() + 2000,
	}); err == nil {
		t.Fatal("parent còn DRAFT vẫn tạo được version")
	}
}

// Reference guard ở lớp Draft: entry đang bị entry khác trong cùng revision khai
// dependency thì không xoá được, còn entry tự do vẫn phải xoá được.
func TestLibraryReferenceGuardBlocksDeleteOfDependedEntry(t *testing.T) {
	store := openTestStore(t)
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	fixture.upsert(t, functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN"))
	fixture.upsert(t, functionEntry(libraryRevisionA, entryFilterID, "FILTER_T1",
		LibraryDependency{EntryID: entryScaleID, Version: "1.0.0"}))
	if _, err := fixture.tryDelete(libraryRevisionA, entryScaleID); !errors.Is(err, ErrLibraryReferenced) {
		t.Fatalf("xoá entry đang bị dependency tham chiếu: %v", err)
	}
	// Entry không bị ai tham chiếu vẫn xoá được — guard không được chặn tất cả.
	if _, err := fixture.tryDelete(libraryRevisionA, entryFilterID); err != nil {
		t.Fatalf("xoá entry tự do: %v", err)
	}
	if _, err := fixture.tryDelete(libraryRevisionA, entryScaleID); err != nil {
		t.Fatalf("xoá entry sau khi hết tham chiếu: %v", err)
	}
}

// Seal Revision v2 ghi POU + library usage nguyên tử và pin đúng version. Đây
// là bằng chứng usage không phải bảng trang trí: sai version/entry là fail.
func TestRevisionSealRecordsLibraryUsageAndRejectsWrongPin(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	createProjectFixture(t, store)
	publishedLibraryFixture(t, store)
	// publishedLibraryFixture đã tăng ETag Draft (mutation library đi chung lane
	// với tài liệu), nên phải đọc lại thay vì dùng ETag lúc tạo Project.
	draft, err := store.GetDraft(ctx, draftID)
	if err != nil {
		t.Fatal(err)
	}

	pou := POUObjectInput{
		ObjectID: pouObjectID, Kind: "PROGRAM", Name: "AHU_MAIN", Language: "ST",
		InterfaceJSON: []byte(`{"inputs":[]}`), SourceBlob: []byte("PROGRAM AHU_MAIN\nEND_PROGRAM\n"),
		Dependencies: []LibraryDependency{{EntryID: entryScaleID, Version: "1.0.0"}},
	}
	params := func(label string, mutate func(*CreateRevisionParams)) CreateRevisionParams {
		key, request := mutationIdentity(label)
		value := CreateRevisionParams{
			RevisionID: revisionID, ProjectID: projectID, DraftID: draftID, ExpectedDraftETag: draft.ETag,
			ManifestJSON:          []byte(`{"schemaVersion":2,"objects":["` + pouObjectID + `"]}`),
			Objects:               []RevisionObjectInput{{ObjectID: pouObjectID, Kind: "PROGRAM", PayloadJSON: []byte(`{"language":"ST","source":"X:=1;"}`)}},
			DocumentSchemaVersion: 2, ProgramCount: 1, LibraryRevisionID: libraryRevisionA,
			POUObjects: []POUObjectInput{pou},
			ActorID:    actorID, Role: role, AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
			CorrelationID: correlationID, At: fixedNow.Add(2 * time.Second),
			IdempotencyKeySHA256: key, RequestSHA256: request,
		}
		if mutate != nil {
			mutate(&value)
		}
		return value
	}

	// Version pin sai và entry không tồn tại phải cho hai lỗi khác nhau.
	wrongVersion := params("seal-wrong-version", func(p *CreateRevisionParams) {
		p.POUObjects[0].Dependencies = []LibraryDependency{{EntryID: entryScaleID, Version: "9.9.9"}}
	})
	if _, err := store.CreateRevision(ctx, wrongVersion); !errors.Is(err, ErrLibraryVersionMismatch) {
		t.Fatalf("pin version sai: %v", err)
	}
	missing := params("seal-missing-entry", func(p *CreateRevisionParams) {
		p.POUObjects[0].Dependencies = []LibraryDependency{{EntryID: "66666666-6666-4666-8666-66666666666f", Version: "1.0.0"}}
	})
	if _, err := store.CreateRevision(ctx, missing); !errors.Is(err, ErrLibraryEntryMissing) {
		t.Fatalf("entry thiếu: %v", err)
	}
	// Cả hai lần fail đều không được để lại Revision hay usage nào.
	for _, table := range []string{"revisions", "pou_objects", "library_usages"} {
		var count int
		if err := store.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s còn %d hàng sau seal lỗi", table, count)
		}
	}

	revision, err := store.CreateRevision(ctx, params("seal-ok", nil))
	if err != nil {
		t.Fatal(err)
	}
	if revision.DocumentSchemaVersion != 2 || revision.LibraryRevisionID != libraryRevisionA {
		t.Fatalf("revision v2 không giữ pin: %+v", revision)
	}
	usages, err := store.ListLibraryUsages(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	if len(usages) != 1 || usages[0].UsageKind != "CALL" || usages[0].RequiredVersion != "1.0.0" ||
		usages[0].RevisionID != revisionID || usages[0].ObjectID != pouObjectID {
		t.Fatalf("usage không đúng: %+v", usages)
	}
	// Sau khi seal, entry bị usage giữ lại: FK RESTRICT chặn cả SQL trực tiếp.
	if _, err := store.db.ExecContext(ctx, `DELETE FROM library_usages WHERE revision_id=?`, revisionID); err == nil {
		t.Fatal("usage của Revision immutable xoá được")
	}
	// Revision đã pin thì không thể trỏ sang library chưa publish.
	createLibraryDraftFixture(t, store, libraryRevisionB, "2.0.0")
	if _, err := store.db.ExecContext(ctx, `UPDATE revisions SET library_revision_id=? WHERE revision_id=?`,
		libraryRevisionB, revisionID); err == nil {
		t.Fatal("Revision pin được library chưa publish")
	}
	// Đọc lại Revision phải thấy đúng pin đã seal.
	snapshot, err := store.GetRevision(ctx, revisionID)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision.LibraryRevisionID != libraryRevisionA || snapshot.Revision.DocumentSchemaVersion != 2 {
		t.Fatalf("read-back pin lệch: %+v", snapshot.Revision)
	}
}

// Revision document v1 không được mang bất kỳ dữ liệu v2 nào; trộn hai đời
// document là cách nhanh nhất để một loader cũ đọc thiếu một nửa gói.
func TestRevisionDocumentV1RejectsV2Payload(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	createProjectFixture(t, store)
	publishedLibraryFixture(t, store)
	draft, err := store.GetDraft(ctx, draftID)
	if err != nil {
		t.Fatal(err)
	}
	key, request := mutationIdentity("seal-v1-with-v2")
	_, err = store.CreateRevision(ctx, CreateRevisionParams{
		RevisionID: revisionID, ProjectID: projectID, DraftID: draftID, ExpectedDraftETag: draft.ETag,
		ManifestJSON:      []byte(`{"schemaVersion":1,"objects":["` + pouObjectID + `"]}`),
		Objects:           []RevisionObjectInput{{ObjectID: pouObjectID, Kind: "PROGRAM", PayloadJSON: []byte(`{"language":"ST","source":"X:=1;"}`)}},
		LibraryRevisionID: libraryRevisionA,
		ActorID:           actorID, Role: role, AuditID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8",
		CorrelationID: correlationID, At: fixedNow.Add(2 * time.Second),
		IdempotencyKeySHA256: key, RequestSHA256: request,
	})
	if err == nil || !strings.Contains(err.Error(), "document v1") {
		t.Fatalf("v1 mang payload v2: %v", err)
	}
}

// Restart phải đọc lại đúng byte đã ghi. Checksum entry/manifest được xác minh
// khi scan, nên hỏng ngầm sẽ nổ ở lần đọc chứ không lặng lẽ chạy tiếp.
func TestProjectLibrarySurvivesRestartAndRejectsSilentCorruption(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "programming-v1.sqlite")
	ctx := context.Background()
	open := func() *Store {
		store, err := OpenProgrammingStore(ctx, Options{Path: path, Now: func() time.Time { return fixedNow }})
		if err != nil {
			t.Fatal(err)
		}
		return store
	}

	first := open()
	published := publishedLibraryFixture(t, first)
	entriesBefore, err := first.ListLibraryEntries(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second := open()
	revision, err := second.GetLibraryRevision(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	if revision.State != published.State || revision.ManifestSHA256 != published.ManifestSHA256 {
		t.Fatalf("restart đổi revision: %+v", revision)
	}
	entriesAfter, err := second.ListLibraryEntries(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	if len(entriesAfter) != len(entriesBefore) {
		t.Fatalf("restart mất entry: %d/%d", len(entriesAfter), len(entriesBefore))
	}
	for index := range entriesAfter {
		if entriesAfter[index].ContentSHA256 != entriesBefore[index].ContentSHA256 {
			t.Fatalf("entry %s đổi hash sau restart", entriesAfter[index].EntryID)
		}
	}

	// Ghi đè content_sha256 bằng đường vòng (tắt trigger không được, nên dùng
	// bảng khác đời): sửa trực tiếp phải bị trigger chặn.
	if _, err := second.db.ExecContext(ctx, `UPDATE library_entries SET content_sha256=randomblob(32) WHERE library_revision_id=?`, libraryRevisionA); err == nil {
		t.Fatal("sửa checksum entry đã publish không bị chặn")
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
}

// Migration v6→v7 dừng fail-closed khi DB đã có hàng library_entries đời v6.
// Hàng v6 không mang source/interface/layout nên nâng cấp là bịa dữ liệu.
func TestMigrationV7RefusesLegacyLibraryRowsAndKeepsV6Intact(t *testing.T) {
	// Migration đang kiểm là v6->v7, không phải head hiện tại, nên phải dừng
	// đúng ở v6 thay vì "head trừ một".
	db := openRawSQLite(t, filepath.Join(t.TempDir(), "legacy.sqlite"))
	migrateToVersion(t, db, 6)

	if _, err := db.Exec(`INSERT INTO projects(project_id,name,created_by,updated_by,created_at_utc_ms,updated_at_utc_ms)
		VALUES(?,'legacy','legacy','legacy',1,1)`, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO library_revisions(library_revision_id,project_id,scope,version,state,
		manifest_json,manifest_sha256,created_by,created_at_utc_ms)
		VALUES(?,?,'PROJECT','1.0.0','DRAFT',x'7B7D',randomblob(32),'legacy',1)`, libraryRevisionA, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO library_entries(library_revision_id,entry_id,kind,name,name_folded,
		feature_state,signature_json,content_sha256) VALUES(?,?,'FUNCTION','LEGACY','LEGACY','AVAILABLE',x'7B7D',randomblob(32))`,
		libraryRevisionA, entryScaleID); err != nil {
		t.Fatal(err)
	}

	if _, err := Migrate(context.Background(), db, MigrationOptions{AppliedAtUTCMS: fixedNow.UnixMilli()}); err == nil {
		t.Fatal("migration v7 chấp nhận hàng library_entries đời v6")
	}
	var userVersion int
	if err := db.QueryRow("PRAGMA user_version").Scan(&userVersion); err != nil {
		t.Fatal(err)
	}
	if userVersion != 6 {
		t.Fatalf("user_version=%d; want 6", userVersion)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM pragma_table_info('library_entries') WHERE name='source_blob'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("migration lỗi vẫn để lại cột v7")
	}
	if err := db.QueryRow(`SELECT count(*) FROM library_entries`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("dữ liệu v6 bị đụng: %d hàng", count)
	}
}

// Store phải từ chối mở nếu SYSTEM snapshot không hợp lệ. Nạp một registry lỗi
// mà vẫn chạy tiếp nghĩa là phân giải tên bằng dữ liệu không ai kiểm.
func TestOpenStoreFailsClosedOnInvalidSystemLibrary(t *testing.T) {
	_, err := OpenProgrammingStore(context.Background(), Options{
		Path: filepath.Join(t.TempDir(), "programming-v1.sqlite"),
		Now:  func() time.Time { return fixedNow },
		SystemLibraryProvider: providerFunc(func(context.Context) (SystemLibrarySnapshot, error) {
			return SystemLibrarySnapshot{Revision: LibraryRevision{
				LibraryRevisionID: "system-broken", Scope: LibraryScopeSystem,
				Version: "rev-a.1", State: LibraryStatePublished,
			}}, nil
		}),
	})
	if err == nil || !strings.Contains(err.Error(), "SYSTEM Control Library không hợp lệ") {
		t.Fatalf("mở store với SYSTEM snapshot hỏng: %v", err)
	}

	_, err = OpenProgrammingStore(context.Background(), Options{
		Path: filepath.Join(t.TempDir(), "programming-v1.sqlite"),
		Now:  func() time.Time { return fixedNow },
		SystemLibraryProvider: providerFunc(func(context.Context) (SystemLibrarySnapshot, error) {
			return SystemLibrarySnapshot{}, fmt.Errorf("registry không đọc được")
		}),
	})
	if err == nil || !strings.Contains(err.Error(), "nạp SYSTEM Control Library") {
		t.Fatalf("provider lỗi không fail-closed: %v", err)
	}
}

type providerFunc func(context.Context) (SystemLibrarySnapshot, error)

func (f providerFunc) LoadSystemLibrary(ctx context.Context) (SystemLibrarySnapshot, error) {
	return f(ctx)
}

// Search/list phải trộn SYSTEM ảo với PROJECT trong DB theo thứ tự ổn định và
// tôn trọng scope; nếu không, FE sẽ thấy kết quả nhảy giữa hai lần gọi.
func TestLibrarySearchMergesSystemAndProjectDeterministically(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	publishedLibraryFixture(t, store)

	systemOnly, err := store.SearchLibraryEntries(ctx, LibrarySearchParams{Scope: LibraryScopeSystem, Query: "TON"})
	if err != nil {
		t.Fatal(err)
	}
	if len(systemOnly) == 0 {
		t.Fatal("registry SYSTEM không trả entry nào cho TON")
	}
	for _, entry := range systemOnly {
		if entry.LibraryRevisionID != store.system.Revision.LibraryRevisionID {
			t.Fatalf("scope SYSTEM trả entry PROJECT: %+v", entry)
		}
	}
	projectOnly, err := store.SearchLibraryEntries(ctx, LibrarySearchParams{
		Scope: LibraryScopeProject, ProjectID: projectID, Query: "FILTER"})
	if err != nil {
		t.Fatal(err)
	}
	if len(projectOnly) != 1 || projectOnly[0].Name != "FILTER_T1" {
		t.Fatalf("scope PROJECT: %+v", projectOnly)
	}
	if _, err := store.SearchLibraryEntries(ctx, LibrarySearchParams{Scope: LibraryScopeProject}); err == nil {
		t.Fatal("PROJECT search thiếu projectId vẫn chạy")
	}

	both, err := store.SearchLibraryEntries(ctx, LibrarySearchParams{ProjectID: projectID, Limit: 101})
	if err != nil {
		t.Fatal(err)
	}
	repeat, err := store.SearchLibraryEntries(ctx, LibrarySearchParams{ProjectID: projectID, Limit: 101})
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(namesOf(both)) != fmt.Sprint(namesOf(repeat)) {
		t.Fatal("search không tất định giữa hai lần gọi")
	}
	if len(both) <= len(projectOnly) {
		t.Fatalf("scope rỗng không trộn SYSTEM: %d", len(both))
	}
	if _, err := store.SearchLibraryEntries(ctx, LibrarySearchParams{ProjectID: projectID, Limit: 102}); err == nil {
		t.Fatal("limit vượt trần vẫn chạy")
	}
}

func namesOf(entries []LibraryEntry) []string {
	names := make([]string, len(entries))
	for index, entry := range entries {
		names[index] = entry.Name + "/" + entry.EntryID
	}
	return names
}

// Publish dựng manifest canonical từ chính entries trong transaction. Test khoá
// tính tất định và việc manifest phủ đúng tập entry đang bị đóng băng.
func TestPublishedManifestIsCanonicalAndCoversEntries(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	published := publishedLibraryFixture(t, store)
	if !strings.Contains(string(published.ManifestJSON), entryScaleID) ||
		!strings.Contains(string(published.ManifestJSON), entryFilterID) {
		t.Fatalf("manifest thiếu entry: %s", published.ManifestJSON)
	}
	if sha256.Sum256(published.ManifestJSON) != published.ManifestSHA256 {
		t.Fatal("manifest hash không khớp byte manifest")
	}

	// Dựng lại cùng nội dung theo thứ tự upsert ngược phải cho đúng cùng hash.
	other := openTestStore(t)
	mirror := newLibraryFixture(t, other)
	createLibraryDraftFixture(t, other, libraryRevisionA, "1.0.0")
	mirror.upsert(t, functionBlockEntry(libraryRevisionA, entryFilterID, "FILTER_T1", authoritativeFBLayout(16)))
	mirror.upsert(t, functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN"))
	mirrored, err := other.PublishProjectLibrary(ctx, libraryRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	if mirrored.ManifestSHA256 != published.ManifestSHA256 {
		t.Fatalf("manifest phụ thuộc thứ tự upsert: %x vs %x", mirrored.ManifestSHA256, published.ManifestSHA256)
	}
}
