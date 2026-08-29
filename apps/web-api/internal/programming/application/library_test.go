package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

const (
	libraryProjectID = "11111111-1111-4111-8111-111111111111"
	libraryEntryA    = "66666666-6666-4666-8666-666666666661"
	libraryEntryB    = "66666666-6666-4666-8666-666666666662"
)

// openLibraryServices dựng Project thật rồi trả cả hai service. Store.now và
// service.now phải khớp, nếu không TTL biên nhận idempotency tính theo đồng hồ
// thật và test sẽ hỏng muộn — bẫy đã ghi ở `openProjectService`.
func openLibraryServices(t *testing.T) (*LibraryService, *ProjectService, MutationResult) {
	t.Helper()
	fixedNow := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming-v1.sqlite"),
		Now:  func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	projects, err := NewProjectService(store, []byte("cursor-secret-t59-202-library"))
	if err != nil {
		t.Fatal(err)
	}
	projectIDs := []string{libraryProjectID, "22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"}
	projects.newID = func() string {
		id := projectIDs[0]
		projectIDs = projectIDs[1:]
		return id
	}
	projects.now = func() time.Time { return fixedNow }

	created, err := projects.CreateProject(context.Background(), Actor{ID: testActorID, Role: "admin"},
		CreateProjectCommand{SchemaVersion: "1.0", Name: "AHU tầng 1", Description: "fixture library",
			IdempotencyKey: "10000000-0000-4000-8000-000000000001", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}

	library, err := NewLibraryService(store, []byte("cursor-secret-t59-202-library"))
	if err != nil {
		t.Fatal(err)
	}
	counter := 0
	library.newID = func() string {
		counter++
		return fmt.Sprintf("bbbbbbbb-bbbb-4bbb-8bbb-%012d", counter)
	}
	library.now = func() time.Time { return fixedNow }
	return library, projects, created
}

func upsertCommand(entryID, name, key string) UpsertLibraryEntryCommand {
	return UpsertLibraryEntryCommand{
		ProjectID: libraryProjectID, SchemaVersion: "1.0", EntryID: entryID,
		Kind: "FUNCTION", Name: name, Language: "ST",
		Source:         "FUNCTION " + name + " : REAL\nVAR_INPUT X : REAL; END_VAR\n" + name + " := X;\nEND_FUNCTION\n",
		InterfaceJSON:  json.RawMessage(`{"inputs":[{"name":"X","type":"REAL"}],"returnType":"REAL"}`),
		IdempotencyKey: key, CorrelationID: testCorrelationID,
	}
}

// Route entry KHÔNG yêu cầu người dùng tạo library trước: entry đầu tiên mở
// `1.0.0` Draft. Đây là hệ quả có chủ ý của việc DDD §5.1 chỉ khoá route entry.
func TestUpsertEntryOpensProjectLibraryDraftAndBumpsProjectDraftETag(t *testing.T) {
	library, projects, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000001")
	command.IfMatch = created.ETag
	result, err := library.UpsertEntry(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	if result.Replay {
		t.Fatal("lần ghi đầu không được là replay")
	}
	if result.ETag == created.ETag {
		t.Fatalf("mutation library phải tăng ETag Draft: %s", result.ETag)
	}
	libraryRevisionID, _ := result.Resource["libraryRevisionId"].(string)
	if libraryRevisionID == "" {
		t.Fatalf("resource thiếu libraryRevisionId: %+v", result.Resource)
	}

	// ETag cũ không dùng lại được — đúng nghĩa optimistic concurrency.
	stale := upsertCommand(libraryEntryB, "FILTER_T1", "20000000-0000-4000-8000-000000000002")
	stale.IfMatch = created.ETag
	if _, err := library.UpsertEntry(ctx, actor, stale); !errors.Is(err, programmingstore.ErrETagConflict) {
		t.Fatalf("If-Match cũ: %v", err)
	}

	// Entry thứ hai đi vào CÙNG Draft library, không mở library thứ hai.
	second := upsertCommand(libraryEntryB, "FILTER_T1", "20000000-0000-4000-8000-000000000003")
	second.IfMatch = result.ETag
	secondResult, err := library.UpsertEntry(ctx, actor, second)
	if err != nil {
		t.Fatal(err)
	}
	if secondResult.Resource["libraryRevisionId"] != libraryRevisionID {
		t.Fatalf("entry thứ hai mở library khác: %+v", secondResult.Resource)
	}

	// Project view phải phản ánh ETag mới; nếu không, FE lưu tài liệu tiếp theo
	// sẽ dùng ETag đã cũ và bị 409 mà không hiểu vì sao.
	view, err := projects.GetProject(ctx, libraryProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if view.ETag != secondResult.ETag {
		t.Fatalf("ETag Project=%s; mutation=%s", view.ETag, secondResult.ETag)
	}
}

// Gửi lại đúng một request với cùng khoá phải trả đúng kết quả cũ, KHÔNG tạo
// mutation thứ hai; đổi nội dung mà giữ khoá phải bị từ chối.
func TestUpsertEntryIsIdempotentAndRejectsKeyReuseWithDifferentBody(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000010")
	command.IfMatch = created.ETag
	first, err := library.UpsertEntry(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := library.UpsertEntry(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replay || replay.AuditID != first.AuditID || replay.ETag != first.ETag {
		t.Fatalf("replay=%+v first=%+v", replay, first)
	}

	changed := command
	changed.Name = "SCALE_LIN2"
	if _, err := library.UpsertEntry(ctx, actor, changed); !errors.Is(err, programmingstore.ErrIdempotencyConflict) {
		t.Fatalf("dùng lại khoá với body khác: %v", err)
	}
}

func TestDeprecateLibraryRevisionReadsBackStateAndReplaysOneAudit(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	upsert := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000015")
	upsert.IfMatch = created.ETag
	mutated, err := library.UpsertEntry(ctx, actor, upsert)
	if err != nil {
		t.Fatal(err)
	}
	libraryRevisionID := mutated.Resource["libraryRevisionId"].(string)
	if _, err := library.store.PublishProjectLibrary(ctx, libraryRevisionID); err != nil {
		t.Fatal(err)
	}
	command := DeprecateLibraryRevisionCommand{
		ProjectID: libraryProjectID, LibraryRevisionID: libraryRevisionID, SchemaVersion: "1.0",
		IfMatch: mutated.ETag, IdempotencyKey: "20000000-0000-4000-8000-000000000016",
		CorrelationID: testCorrelationID,
	}
	stale := command
	stale.IfMatch = created.ETag
	stale.IdempotencyKey = "20000000-0000-4000-8000-000000000017"
	if _, err := library.DeprecateRevision(ctx, actor, stale); !errors.Is(err, programmingstore.ErrETagConflict) {
		t.Fatalf("deprecate với If-Match cũ: %v", err)
	}
	stillPublished, err := library.store.GetLibraryRevision(ctx, libraryRevisionID)
	if err != nil || stillPublished.State != programmingstore.LibraryStatePublished {
		t.Fatalf("If-Match lỗi vẫn đổi state: err=%v revision=%+v", err, stillPublished)
	}
	first, err := library.DeprecateRevision(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := library.DeprecateRevision(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	if first.Resource["libraryState"] != programmingstore.LibraryStateDeprecated || first.ETag == mutated.ETag ||
		first.AuditID == "" || !replay.Replay || replay.AuditID != first.AuditID || replay.ETag != first.ETag {
		t.Fatalf("first=%+v replay=%+v", first, replay)
	}
	readBack, err := library.store.GetLibraryRevision(ctx, libraryRevisionID)
	if err != nil || readBack.State != programmingstore.LibraryStateDeprecated {
		t.Fatalf("read-back err=%v revision=%+v", err, readBack)
	}
	records, err := library.store.ListAuditRecords(ctx, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, record := range records {
		if record.Action == "LIBRARY_REVISION_DEPRECATE" && record.TargetID == libraryRevisionID {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("audit deprecate=%d; want 1", count)
	}
}

// Ba nguyên nhân phân giải library phải giữ ba mã public khác nhau tới tận HTTP.
func TestLibraryPublicErrorKeepsResolutionCausesDistinct(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	base := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000020")
	base.IfMatch = created.ETag
	first, err := library.UpsertEntry(ctx, actor, base)
	if err != nil {
		t.Fatal(err)
	}

	dependent := upsertCommand(libraryEntryB, "FILTER_T1", "20000000-0000-4000-8000-000000000021")
	dependent.IfMatch = first.ETag
	dependent.Dependencies = []LibraryDependencyView{{EntryID: libraryEntryA, Version: "1.0.0"}}
	second, err := library.UpsertEntry(ctx, actor, dependent)
	if err != nil {
		t.Fatal(err)
	}

	remove := DeleteLibraryEntryCommand{ProjectID: libraryProjectID, EntryID: libraryEntryA,
		IfMatch: second.ETag, IdempotencyKey: "20000000-0000-4000-8000-000000000022", CorrelationID: testCorrelationID}
	_, err = library.DeleteEntry(ctx, actor, remove)
	if !errors.Is(err, programmingstore.ErrLibraryReferenced) {
		t.Fatalf("xoá entry còn tham chiếu: %v", err)
	}
	public, mapped := LibraryPublicError(err)
	if !mapped || public.Code != "PRG-ERR-CONFLICT-001" || !public.KeepsRunningRevision {
		t.Fatalf("mapping reference guard: mapped=%v public=%+v", mapped, public)
	}
}

// Sau khi publish 1.0.0, lần sửa đầu mở Draft 1.1.0 ở server. FE chỉ đang giữ
// snapshot 1.0.0 nên dependency trong payload có thể còn version cũ; store phải
// pin theo revision 1.1.0 vừa mở, không ghi lại dependency mồ côi vào Draft mới.
func TestUpsertEntryRepinsStaleClientDependencyToAutoOpenedDraftVersion(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	base := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000023")
	base.IfMatch = created.ETag
	first, err := library.UpsertEntry(ctx, actor, base)
	if err != nil {
		t.Fatal(err)
	}
	dependent := upsertCommand(libraryEntryB, "FILTER_T1", "20000000-0000-4000-8000-000000000024")
	dependent.IfMatch = first.ETag
	dependent.Dependencies = []LibraryDependencyView{{EntryID: libraryEntryA, Version: "1.0.0"}}
	second, err := library.UpsertEntry(ctx, actor, dependent)
	if err != nil {
		t.Fatal(err)
	}
	publishedRevisionID, _ := second.Resource["libraryRevisionId"].(string)
	if _, err := library.store.PublishProjectLibrary(ctx, publishedRevisionID); err != nil {
		t.Fatal(err)
	}

	edit := upsertCommand(libraryEntryB, "FILTER_T1", "20000000-0000-4000-8000-000000000025")
	edit.IfMatch = second.ETag
	edit.Dependencies = []LibraryDependencyView{{EntryID: libraryEntryA, Version: "1.0.0"}}
	updated, err := library.UpsertEntry(ctx, actor, edit)
	if err != nil {
		t.Fatal(err)
	}
	draftRevisionID, _ := updated.Resource["libraryRevisionId"].(string)
	if draftRevisionID == "" || draftRevisionID == publishedRevisionID {
		t.Fatalf("không mở revision mới sau publish: published=%q draft=%q", publishedRevisionID, draftRevisionID)
	}
	stored, err := library.store.GetLibraryEntry(ctx, draftRevisionID, libraryEntryB)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Dependencies) != 1 || stored.Dependencies[0].Version != "1.1.0" {
		t.Fatalf("dependency payload cũ chưa được pin theo Draft mới: %+v", stored.Dependencies)
	}
}

// Draft chỉ lưu entryId để người dùng không tự chọn version. Seal phải pin
// dependency theo library revision đang đóng băng, rồi lần Seal kế tiếp (không
// sửa library nên không còn Draft library) vẫn giữ đúng bản PUBLISHED đó.
func TestSealRevisionPinsProjectLibraryDependencyAndKeepsPublishedPin(t *testing.T) {
	library, projects, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	entry := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000026")
	entry.IfMatch = created.ETag
	mutated, err := library.UpsertEntry(ctx, actor, entry)
	if err != nil {
		t.Fatal(err)
	}
	projectIDCounter := 0
	projects.newID = func() string {
		projectIDCounter++
		return fmt.Sprintf("dddddddd-dddd-4ddd-8ddd-%012d", projectIDCounter)
	}
	objectID := "99999999-9999-4999-8999-999999999991"
	programID := "99999999-9999-4999-8999-999999999992"
	saved, err := saveOps(t, projects, libraryProjectID,
		created.Resource["draftRevisionId"].(string), mutated.ETag,
		"20000000-0000-4000-8000-000000000027",
		op(map[string]any{"op": "upsertObject", "object": map[string]any{
			"objectId": objectID, "kind": "PROGRAM", "name": "AHU_MAIN", "language": "ST",
			"source":       "PROGRAM AHU_MAIN\nVAR_OUTPUT Y : REAL; END_VAR\nY := SCALE_LIN(1.0);\nEND_PROGRAM\n",
			"dependencies": []string{libraryEntryA},
		}}),
		programOp(programID, objectID, 1000))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := projects.SealRevision(ctx, actor, SealRevisionCommand{
		ProjectID: libraryProjectID, SchemaVersion: "1.0",
		BaseRevisionID: created.Resource["draftRevisionId"].(string), Label: "R1 library pin",
		IfMatch: saved.ETag, IdempotencyKey: "20000000-0000-4000-8000-000000000028",
		CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	revisionID := sealed.Resource["revisionId"].(string)
	snapshot, err := library.store.GetRevision(ctx, revisionID)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision.LibraryRevisionID == "" || len(snapshot.POUObjects) != 1 ||
		len(snapshot.POUObjects[0].Dependencies) != 1 ||
		snapshot.POUObjects[0].Dependencies[0].Version != "1.0.0" {
		t.Fatalf("pin lần đầu sai: revision=%+v pous=%+v", snapshot.Revision, snapshot.POUObjects)
	}

	counter := 50
	projects.newID = func() string {
		counter++
		return fmt.Sprintf("eeeeeeee-eeee-4eee-8eee-%012d", counter)
	}
	second, err := projects.SealRevision(ctx, actor, SealRevisionCommand{
		ProjectID: libraryProjectID, SchemaVersion: "1.0", BaseRevisionID: revisionID,
		Label: "R2 program only", IfMatch: sealed.ETag,
		IdempotencyKey: "20000000-0000-4000-8000-000000000029", CorrelationID: testCorrelationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	secondSnapshot, err := library.store.GetRevision(ctx, second.Resource["revisionId"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if secondSnapshot.Revision.LibraryRevisionID != snapshot.Revision.LibraryRevisionID ||
		secondSnapshot.POUObjects[0].Dependencies[0].Version != "1.0.0" {
		t.Fatalf("Seal kế tiếp làm rơi pin PUBLISHED: first=%+v second=%+v",
			snapshot.Revision, secondSnapshot.Revision)
	}
}

// `REVIEW_REQUIRED` là cờ Controls/Safety của registry SYSTEM. Nhận nó từ payload
// sẽ cho client tự dán nhãn review lên POU của mình và làm nhoè ý nghĩa cờ đó.
func TestUpsertEntryRejectsClientSuppliedReviewRequired(t *testing.T) {
	library, _, created := openLibraryServices(t)
	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000030")
	command.IfMatch = created.ETag
	command.FeatureState = "REVIEW_REQUIRED"
	if _, err := library.UpsertEntry(context.Background(), Actor{ID: testActorID, Role: "admin"}, command); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("featureState do client đặt: %v", err)
	}
}

// FUNCTION không được mang khối layout; FUNCTION_BLOCK vắng khối đó nghĩa là
// "chưa biết", không phải "bằng 0".
func TestUpsertEntryStateLayoutRulesPerKind(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	withLayout := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000040")
	withLayout.IfMatch = created.ETag
	withLayout.StateLayout = &LibraryStateLayoutCommand{Version: 1, StateSizeBytes: 8, SHA256: strings.Repeat("ab", 32)}
	if _, err := library.UpsertEntry(ctx, actor, withLayout); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("FUNCTION mang layout: %v", err)
	}

	block := upsertCommand(libraryEntryB, "FILTER_T1", "20000000-0000-4000-8000-000000000041")
	block.IfMatch = created.ETag
	block.Kind = "FUNCTION_BLOCK"
	block.Source = "FUNCTION_BLOCK FILTER_T1\nVAR_INPUT X : REAL; END_VAR\nEND_FUNCTION_BLOCK\n"
	block.InterfaceJSON = json.RawMessage(`{"inputs":[{"name":"X","type":"REAL"}]}`)
	stored, err := library.UpsertEntry(ctx, actor, block)
	if err != nil {
		t.Fatalf("FB chưa biết layout phải ghi được vào Draft: %v", err)
	}

	badHash := block
	badHash.EntryID = libraryEntryA
	badHash.Name = "FILTER_T2"
	badHash.IfMatch = stored.ETag
	badHash.IdempotencyKey = "20000000-0000-4000-8000-000000000042"
	badHash.StateLayout = &LibraryStateLayoutCommand{Version: 1, StateSizeBytes: 8, SHA256: "khong-phai-hex"}
	if _, err := library.UpsertEntry(ctx, actor, badHash); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("layout hash sai định dạng: %v", err)
	}
}

// Cursor phải ràng buộc luôn bộ lọc. Nếu không, trang thứ hai có thể đổi phạm vi
// so với trang đầu mà client không hay biết.
func TestSearchLibrariesCursorBindsFiltersAndRejectsTampering(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000050")
	command.IfMatch = created.ETag
	if _, err := library.UpsertEntry(ctx, actor, command); err != nil {
		t.Fatal(err)
	}

	first, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 5 || first.NextCursor == nil {
		t.Fatalf("trang đầu=%d cursor=%v", len(first.Items), first.NextCursor)
	}
	next, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Limit: 5, Cursor: *first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Items) == 0 || next.Items[0].EntryID == first.Items[0].EntryID {
		t.Fatalf("trang hai không tiến: %+v", next.Items)
	}

	// Đổi filter mà giữ cursor phải bị từ chối, không phải âm thầm đổi phạm vi.
	if _, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID,
		Scope: "SYSTEM", Limit: 5, Cursor: *first.NextCursor}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor không ràng buộc filter: %v", err)
	}
	// Sửa một ký tự chữ ký cũng phải hỏng — kiểm CẢ HAI đường: một ký tự đổi
	// giá trị byte đã decode, và một ký tự chỉ đổi những bit thừa ở cuối. Đường
	// thứ hai từng lọt: base64 raw không strict decode chúng về cùng 32 byte,
	// nên HMAC vẫn khớp và cursor giả mạo vẫn dùng được.
	tampered := *first.NextCursor
	last := tampered[len(tampered)-1]
	replacement := byte('A')
	if last == 'A' {
		replacement = 'B'
	}
	tampered = tampered[:len(tampered)-1] + string(replacement)
	if _, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Limit: 5, Cursor: tampered}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor bị sửa vẫn dùng được: %v", err)
	}
	// Bit thừa ở ký tự cuối: `Q` và `R` decode ra cùng byte trong base64 raw,
	// nên chỉ decoder strict mới chặn được.
	for _, pair := range [][2]byte{{'Q', 'R'}, {'A', 'B'}, {'g', 'h'}} {
		if first.NextCursor == nil {
			break
		}
		candidate := *first.NextCursor
		if candidate[len(candidate)-1] != pair[0] {
			continue
		}
		candidate = candidate[:len(candidate)-1] + string(pair[1])
		if _, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Limit: 5, Cursor: candidate}); !errors.Is(err, ErrInvalidCursor) {
			t.Fatalf("cursor đổi bit thừa vẫn dùng được: %v", err)
		}
	}

	// Cursor hết hạn đúng tại mốc 15 phút, không có cửa sổ thêm một mili giây.
	issuedAt := library.now()
	library.now = func() time.Time { return issuedAt.Add(15 * time.Minute) }
	if _, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Limit: 5, Cursor: *first.NextCursor}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor hết hạn vẫn dùng được: %v", err)
	}
	library.now = func() time.Time { return issuedAt }
	// PROJECT scope không có projectId thì không được trả gì.
	if _, err := library.SearchLibraries(ctx, SearchLibrariesCommand{Scope: "PROJECT", Limit: 5}); err == nil {
		t.Fatal("PROJECT search thiếu projectId vẫn chạy")
	}
	// Không có projectId thì chỉ thấy SYSTEM — không rò entry Project nào.
	systemOnly, err := library.SearchLibraries(ctx, SearchLibrariesCommand{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range systemOnly.Items {
		if item.Scope != "SYSTEM" {
			t.Fatalf("thiếu projectId vẫn trả entry PROJECT: %+v", item)
		}
	}
}

// Regression F-P59-UI-001: danh sách dài hơn 100 entry phải đọc hết bằng
// keyset, không mất nextCursor ở trang đầy và không lặp/mất entry giữa các trang.
func TestSearchLibrariesReadsMoreThanOneHundredEntriesWithoutLossOrDuplicates(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	etag := created.ETag
	const total = 125
	for index := 0; index < total; index++ {
		entryID := fmt.Sprintf("66666666-6666-4666-8666-%012d", index+100)
		key := fmt.Sprintf("20000000-0000-4000-8000-%012d", index+100)
		command := upsertCommand(entryID, fmt.Sprintf("CUSTOM_%03d", index), key)
		command.IfMatch = etag
		result, err := library.UpsertEntry(ctx, actor, command)
		if err != nil {
			t.Fatalf("upsert entry %d: %v", index, err)
		}
		etag = result.ETag
	}

	seen := make(map[string]struct{}, total)
	cursor := ""
	pages := 0
	for {
		page, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
			ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject,
			Limit: 37, Cursor: cursor,
		})
		if err != nil {
			t.Fatalf("đọc trang %d: %v", pages+1, err)
		}
		pages++
		for _, item := range page.Items {
			key := item.LibraryRevisionID + "/" + item.EntryID
			if _, duplicate := seen[key]; duplicate {
				t.Fatalf("entry lặp giữa các trang: %s", key)
			}
			seen[key] = struct{}{}
		}
		if page.NextCursor == nil {
			break
		}
		if len(page.Items) != 37 {
			t.Fatalf("trang có cursor nhưng không đầy: items=%d", len(page.Items))
		}
		cursor = *page.NextCursor
	}
	if len(seen) != total || pages != 4 {
		t.Fatalf("đọc được %d/%d entry qua %d trang; want 4 trang", len(seen), total, pages)
	}
}

// Cùng name/entryId có thể hiện diện ở nhiều Library revision. Revision ID là
// tie-break bắt buộc; nếu thiếu, cursor trang 1 sẽ nuốt hoặc lặp bản ở trang 2.
func TestSearchLibrariesKeysetUsesRevisionAsFinalTieBreak(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	firstCommand := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000070")
	firstCommand.IfMatch = created.ETag
	firstMutation, err := library.UpsertEntry(ctx, actor, firstCommand)
	if err != nil {
		t.Fatal(err)
	}
	firstRevisionID := firstMutation.Resource["libraryRevisionId"].(string)
	if _, err := library.store.PublishProjectLibrary(ctx, firstRevisionID); err != nil {
		t.Fatal(err)
	}
	secondCommand := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000071")
	secondCommand.IfMatch = firstMutation.ETag
	secondMutation, err := library.UpsertEntry(ctx, actor, secondCommand)
	if err != nil {
		t.Fatal(err)
	}
	secondRevisionID := secondMutation.Resource["libraryRevisionId"].(string)

	first, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject, Query: "SCALE_LIN", Limit: 1,
	})
	if err != nil || len(first.Items) != 1 || first.NextCursor == nil {
		t.Fatalf("trang đầu err=%v page=%+v", err, first)
	}
	second, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject, Query: "SCALE_LIN", Limit: 1,
		Cursor: *first.NextCursor,
	})
	if err != nil || len(second.Items) != 1 || second.NextCursor != nil {
		t.Fatalf("trang hai err=%v page=%+v", err, second)
	}
	got := []string{first.Items[0].LibraryRevisionID, second.Items[0].LibraryRevisionID}
	wantFirst, wantSecond := firstRevisionID, secondRevisionID
	if wantSecond < wantFirst {
		wantFirst, wantSecond = wantSecond, wantFirst
	}
	if got[0] != wantFirst || got[1] != wantSecond || first.Items[0].EntryID != second.Items[0].EntryID {
		t.Fatalf("tie-break revision sai: got=%v want=[%s %s]", got, wantFirst, wantSecond)
	}
}

// Mọi mutation phải để lại đúng một audit record với action và target đúng.
func TestLibraryMutationsAppendAudit(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000060")
	command.IfMatch = created.ETag
	upserted, err := library.UpsertEntry(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	removed, err := library.DeleteEntry(ctx, actor, DeleteLibraryEntryCommand{
		ProjectID: libraryProjectID, EntryID: libraryEntryA, IfMatch: upserted.ETag,
		IdempotencyKey: "20000000-0000-4000-8000-000000000061", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if removed.AuditID == upserted.AuditID {
		t.Fatal("hai mutation dùng chung một audit id")
	}
	records, err := library.store.ListAuditRecords(ctx, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	actions := map[string]int{}
	for _, record := range records {
		actions[record.Action]++
	}
	if actions["LIBRARY_ENTRY_UPSERT"] != 1 || actions["LIBRARY_ENTRY_DELETE"] != 1 {
		t.Fatalf("audit thiếu mutation library: %+v", actions)
	}
}

/*
`T61-401` — metadata TRÌNH BÀY phải đi được HẾT đường ghi.

Trước lát này `library_entries` đã có cột `category`/`description` (migration
`0014`) và store đã nhận `UpsertProjectLibraryEntryParams.Category/Description`,
nhưng KHÔNG caller nào đặt chúng: `UpsertLibraryEntryCommand` không có trường,
nên request HTTP không có chỗ mang, nên PGM-04 hiện "— chưa phân loại" vĩnh viễn
và bộ lọc `category` không bao giờ khớp một khối PROJECT.

Test này đóng đường đó bằng phép đo hai đầu: ghi vào rồi ĐỌC LẠI qua
`SearchLibraries`, không chỉ kiểm lệnh không lỗi.
*/
func TestUpsertEntryPersistsPresentationMetadataAndKeepsContentHashStable(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	plain := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000101")
	plain.IfMatch = created.ETag
	first, err := library.UpsertEntry(ctx, actor, plain)
	if err != nil {
		t.Fatal(err)
	}

	page, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Scope: "PROJECT", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	var before LibraryEntryView
	for _, item := range page.Items {
		if item.EntryID == libraryEntryA {
			before = item
		}
	}
	if before.EntryID == "" {
		t.Fatal("không đọc lại được entry vừa ghi")
	}
	if before.Category != nil || before.Description != nil {
		t.Fatalf("entry chưa gửi metadata phải VẮNG hai trường, không phải chuỗi rỗng: %+v", before)
	}

	category := "control"
	// Tiếng Việt có dấu: 24 ký tự nhưng nhiều hơn 24 byte. Nó ở đây để khoá
	// việc trần đo theo KÝ TỰ chứ không theo byte.
	description := "Bộ chuyển đổi tuyến tính"
	withMetadata := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000102")
	withMetadata.IfMatch = first.ETag
	withMetadata.Category = &category
	withMetadata.Description = &description
	if _, err := library.UpsertEntry(ctx, actor, withMetadata); err != nil {
		t.Fatal(err)
	}

	page, err = library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Scope: "PROJECT", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	var after LibraryEntryView
	for _, item := range page.Items {
		if item.EntryID == libraryEntryA {
			after = item
		}
	}
	if after.Category == nil || *after.Category != category {
		t.Fatalf("category không được lưu: %+v", after.Category)
	}
	if after.Description == nil || *after.Description != description {
		t.Fatalf("description không được lưu: %+v", after.Description)
	}
	if after.PresentationSHA256 == "" {
		t.Fatal("presentationSha256 phải có mặt khi metadata có mặt")
	}
	/* `D61-09` — sửa mô tả KHÔNG được đổi danh tính thực thi. Nếu đổi, mọi
	   artifact và pin đã ký thành lỗi thời chỉ vì một lần sửa chính tả. */
	if after.ContentSHA256 != before.ContentSHA256 {
		t.Fatalf("contentSha256 đổi theo metadata trình bày: %s -> %s", before.ContentSHA256, after.ContentSHA256)
	}

	// Lọc theo category phải khớp entry PROJECT vừa gắn nhãn — đây là nửa còn
	// lại của đường ghi: ghi được mà lọc không thấy thì vẫn là chưa dùng được.
	filtered, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: "PROJECT", Category: category, Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range filtered.Items {
		if item.EntryID == libraryEntryA {
			found = true
		}
	}
	if !found {
		t.Fatal("lọc theo category không thấy entry vừa gắn nhãn")
	}
}

// Vượt trần là LỖI, không phải cắt bớt im lặng: cắt bớt làm read-back trả về
// thứ khác thứ client vừa gửi, và người dùng không có cách nào biết.
func TestUpsertEntryRejectsOversizedPresentationMetadata(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	tooLongCategory := strings.Repeat("x", 33)
	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000103")
	command.IfMatch = created.ETag
	command.Category = &tooLongCategory
	if _, err := library.UpsertEntry(ctx, actor, command); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("category 33 ký tự phải bị từ chối: %v", err)
	}

	tooLongDescription := strings.Repeat("đ", 513)
	command = upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000104")
	command.IfMatch = created.ETag
	command.Description = &tooLongDescription
	if _, err := library.UpsertEntry(ctx, actor, command); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("description 513 ký tự phải bị từ chối: %v", err)
	}

	/* 512 ký tự tiếng Việt = 1024 byte. Trước lát này store đo bằng `len()`
	   nên payload này bị từ chối ở khoảng một phần hai độ dài hợp đồng cho
	   phép, kèm một thông điệp nói "vượt 512 ký tự" trong khi người dùng mới
	   gõ 512. Đây là case khoá phép đo theo ký tự. */
	atLimit := strings.Repeat("đ", 512)
	command = upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000105")
	command.IfMatch = created.ETag
	command.Description = &atLimit
	if _, err := library.UpsertEntry(ctx, actor, command); err != nil {
		t.Fatalf("description đúng 512 ký tự phải được nhận: %v", err)
	}
}
