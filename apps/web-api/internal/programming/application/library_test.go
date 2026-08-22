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
	// Sửa một ký tự chữ ký cũng phải hỏng.
	tampered := *first.NextCursor
	tampered = tampered[:len(tampered)-1] + "A"
	if _, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Limit: 5, Cursor: tampered}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor bị sửa vẫn dùng được: %v", err)
	}
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
