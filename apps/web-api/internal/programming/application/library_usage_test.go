package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T61-107` / `LOCK-PGM04-CONTRACT-001` §1 — Used-In không được nói dối bằng số 0.

Đây là bất biến đắt nhất của lát này, và nó không phải chuyện trình bày:

  - `count: 0` nghĩa là "không chương trình nào đang dùng khối này" — một câu
    mời người ta xoá hoặc deprecate nó.
  - `UNAVAILABLE` nghĩa là "chưa đo được".

Trả `0` khi đang không đo được là cách một khối bị gỡ TRONG KHI nó đang điều
khiển tủ. Bộ này khoá đúng chỗ đó.
*/

func TestSystemEntryUsageIsUnavailableNotZero(t *testing.T) {
	service := &LibraryService{}
	view, err := service.Usage(context.Background(), LibraryUsageCommand{
		LibraryRevisionID: "PROGRAMMING-POU-LIBRARY-REGISTRY-V1:rev-a.3:deadbeef",
		EntryID:           "PID",
		Scope:             programmingstore.LibraryScopeSystem,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.Availability != LibraryUsageUnavailable {
		t.Fatalf("availability = %q; want UNAVAILABLE", view.Availability)
	}
	/* Count VẪN là 0 — đó là giá trị zero của kiểu, không tránh được. Điều
	   quan trọng là `availability` nói rõ con số ấy không có nghĩa. Nếu một
	   consumer đọc `count` mà bỏ qua `availability` thì lỗi nằm ở consumer, và
	   hợp đồng đã cho nó đủ dữ kiện để không sai. */
	if view.Sealed.Count != 0 || view.Draft.Count != 0 {
		t.Fatalf("SYSTEM entry không được tự bịa số: sealed=%d draft=%d",
			view.Sealed.Count, view.Draft.Count)
	}
	if view.Sealed.Items == nil || view.Draft.Items == nil {
		// Mảng `nil` serialize thành `null`, và `null` bắt mỗi client tự xử lý
		// một lần nữa. Rỗng phải là `[]`.
		t.Fatal("items phải là mảng rỗng, không phải nil")
	}
}

func TestUsageRequiresLibraryRevisionID(t *testing.T) {
	service := &LibraryService{}
	if _, err := service.Usage(context.Background(), LibraryUsageCommand{EntryID: "PID"}); err == nil {
		t.Fatal("thiếu libraryRevisionId phải là lỗi request, không phải một danh sách rỗng")
	}
}

/*
`T61-104` đổi hạn chế cũ: phạm vi Draft nay ĐO ĐƯỢC, nên `SEALED_ONLY` không còn
là câu trả lời mặc định.

Nó vẫn là câu trả lời đúng ở đúng MỘT trường hợp — khi request không nêu
`entryId`. Khi ấy mọi POU khai bất kỳ dependency nào đều khớp, và một danh sách
như thế không trả lời câu hỏi nào; nói "chưa đo được" đúng hơn nói "không ai
dùng".
*/
func TestProjectEntryUsageIsCompleteOnceDraftScopeIsMeasured(t *testing.T) {
	store := openUsageStore(t)
	service := &LibraryService{store: store}
	ctx := context.Background()

	// Store rỗng: đã đo cả hai phạm vi và thật sự không có usage nào. `count: 0`
	// ở đây là một con số HỢP LỆ, khác hẳn `count: 0` khi chưa đo được.
	measured, err := service.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: "11111111-1111-4111-8111-111111111111",
		EntryID:           "SCALE_LIN",
		Scope:             programmingstore.LibraryScopeProject,
	})
	if err != nil {
		t.Fatal(err)
	}
	if measured.Availability != LibraryUsageComplete {
		t.Fatalf("availability = %q; want COMPLETE — cả hai phạm vi đã đo được", measured.Availability)
	}

	// Không nêu `entryId`: phạm vi Draft không đo được, và phải NÓI RA.
	unscoped, err := service.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: "11111111-1111-4111-8111-111111111111",
		Scope:             programmingstore.LibraryScopeProject,
	})
	if err != nil {
		t.Fatal(err)
	}
	if unscoped.Availability != LibraryUsageSealedOnly {
		t.Fatalf("availability = %q; want SEALED_ONLY khi thiếu entryId", unscoped.Availability)
	}
	if unscoped.Draft.Count != 0 || len(unscoped.Draft.Items) != 0 {
		t.Fatal("phạm vi chưa đo được mà đã trả dữ liệu")
	}
}

func openUsageStore(t *testing.T) *programmingstore.Store {
	t.Helper()
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: t.TempDir() + "/programming-v1.sqlite",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

/*
`T61-101` — phân trang Used-In.

`truncated: true` mà không có `nextCursor` là một ngõ cụt: giao diện nói "còn
nữa" rồi không có cách nào đọc tiếp, và người vận hành kết luận bằng đúng 200
mục đầu tiên. Bộ dưới khoá cả hai đầu: keyset SQL có nhảy đúng chỗ không, và
cursor có chống giả mạo/lệch bộ lọc không.
*/

// Keyset của Used-In so BỐN trường theo đúng `ORDER BY`. Lệch một trường thì
// trang sau bỏ sót hoặc lặp mục mà không ai thấy — danh sách vẫn có nội dung,
// `truncated` vẫn đúng, chỉ là thiếu. Fixture ba POU đủ để bắt điều đó.
func TestListLibraryUsageRowsKeysetAdvancesWithoutLossOrDuplicates(t *testing.T) {
	library, projects, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	entry := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000950")
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
	operations := make([]json.RawMessage, 0, 6)
	for index := 1; index <= 3; index++ {
		objectID := fmt.Sprintf("99999999-9999-4999-8999-%012d", index)
		programID := fmt.Sprintf("88888888-8888-4888-8888-%012d", index)
		name := fmt.Sprintf("AHU_%d", index)
		operations = append(operations, op(map[string]any{"op": "upsertObject", "object": map[string]any{
			"objectId": objectID, "kind": "PROGRAM", "name": name, "language": "ST",
			"source":       "PROGRAM " + name + "\nVAR_OUTPUT Y : REAL; END_VAR\nY := SCALE_LIN(1.0);\nEND_PROGRAM\n",
			"dependencies": []string{libraryEntryA},
		}}), programOp(programID, objectID, 1000))
	}
	saved, err := saveOps(t, projects, libraryProjectID,
		created.Resource["draftRevisionId"].(string), mutated.ETag,
		"20000000-0000-4000-8000-000000000951", operations...)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := projects.SealRevision(ctx, actor, SealRevisionCommand{
		ProjectID: libraryProjectID, SchemaVersion: "1.0",
		BaseRevisionID: created.Resource["draftRevisionId"].(string), Label: "R1 usage",
		IfMatch: saved.ETag, IdempotencyKey: "20000000-0000-4000-8000-000000000952",
		CorrelationID: testCorrelationID,
	}); err != nil {
		t.Fatal(err)
	}
	libraryRevisionID := mutated.Resource["libraryRevisionId"].(string)

	all, err := library.store.ListLibraryUsageRows(ctx, programmingstore.ListLibraryUsageParams{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA, Limit: 200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("fixture phải cho 3 mục Used-In, nhận %d", len(all))
	}

	first, err := library.store.ListLibraryUsageRows(ctx, programmingstore.ListLibraryUsageParams{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA, Limit: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 {
		t.Fatalf("trang đầu phải có 2 mục, nhận %d", len(first))
	}
	last := first[len(first)-1]
	second, err := library.store.ListLibraryUsageRows(ctx, programmingstore.ListLibraryUsageParams{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA, Limit: 2,
		After: &programmingstore.LibraryUsageKey{
			ProjectName: last.ProjectName, RevisionID: last.RevisionID,
			ObjectID: last.ObjectID, UsageKind: last.UsageKind,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 {
		t.Fatalf("trang hai phải có đúng 1 mục còn lại, nhận %d", len(second))
	}
	joined := append(append([]programmingstore.LibraryUsageRow{}, first...), second...)
	seen := map[string]bool{}
	for index, row := range joined {
		key := row.RevisionID + "/" + row.ObjectID + "/" + row.UsageKind
		if seen[key] {
			t.Fatalf("mục lặp qua hai trang: %s", key)
		}
		seen[key] = true
		if row.ObjectID != all[index].ObjectID {
			t.Fatalf("thứ tự hai trang lệch danh sách đầy đủ ở vị trí %d: %s vs %s",
				index, row.ObjectID, all[index].ObjectID)
		}
	}
}

// Cursor phải mang cả bộ lọc và phải chống giả mạo — nếu không, trang thứ hai
// của một entry có thể trả về usage của entry khác và người dùng không hay.
func TestUsageCursorBindsFiltersAndRejectsTampering(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	ctx := context.Background()
	const libraryRevisionID = "11111111-1111-4111-8111-111111111111"

	encoded, err := library.encodeUsageCursor(libraryUsageCursor{
		ProjectName: "AHU tầng 1", RevisionID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
		ObjectID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", UsageKind: "CALL",
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA,
		ExpiresAtUTCMS: library.now().UTC().Add(time.Minute).UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Cursor đúng bộ lọc: đi qua được (store rỗng nên danh sách rỗng, điều đang
	// kiểm là KHÔNG bị từ chối).
	if _, err := library.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA,
		Scope: programmingstore.LibraryScopeProject, SealedCursor: encoded,
	}); err != nil {
		t.Fatalf("cursor hợp lệ bị từ chối: %v", err)
	}

	// Đổi entryId của request mà giữ cursor cũ: phải là ErrInvalidCursor.
	if _, err := library.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryB,
		Scope: programmingstore.LibraryScopeProject, SealedCursor: encoded,
	}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor lệch entryId phải bị từ chối, nhận %v", err)
	}

	// Sửa một ký tự của chữ ký: HMAC phải bắt được.
	tampered := encoded[:len(encoded)-1] + string(flipCursorChar(encoded[len(encoded)-1]))
	if _, err := library.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA,
		Scope: programmingstore.LibraryScopeProject, SealedCursor: tampered,
	}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor bị sửa phải bị từ chối, nhận %v", err)
	}
}

// Phạm vi Draft chưa đo được (`T61-104` mở đường ấy), nên một cursor Draft không
// thể là thật. Nhận nó im lặng sẽ hứa một trang không tồn tại.
func TestUsageRejectsDraftCursorUntilDraftScopeExists(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	if _, err := library.Usage(context.Background(), LibraryUsageCommand{
		LibraryRevisionID: "11111111-1111-4111-8111-111111111111",
		Scope:             programmingstore.LibraryScopeProject, DraftCursor: "bất-kỳ",
	}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("draftCursor phải bị từ chối, nhận %v", err)
	}
}

// Lỗi request phải là SENTINEL, không phải `fmt.Errorf` trần: lớp HTTP phân biệt
// 400 với 503 bằng chính sentinel ấy, và bản trước quy mọi lỗi của route này về
// 400 — nên store hỏng cũng ra "request không hợp lệ".
func TestUsageRequestErrorsAreStableSentinels(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	ctx := context.Background()
	cases := map[string]LibraryUsageCommand{
		"thiếu libraryRevisionId": {EntryID: libraryEntryA},
		"scope lạ":                {LibraryRevisionID: "11111111-1111-4111-8111-111111111111", Scope: "GLOBAL"},
		"entryId quá dài": {LibraryRevisionID: "11111111-1111-4111-8111-111111111111",
			EntryID: strings.Repeat("x", 129)},
	}
	for name, command := range cases {
		if _, err := library.Usage(ctx, command); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%s: phải là ErrInvalidRequest, nhận %v", name, err)
		}
	}
}

// Danh sách chưa bị cắt thì `nextCursor` phải là `nil` (`null` trên dây), không
// phải chuỗi rỗng: một `if (cursor)` ở FE sẽ đọc chuỗi rỗng thành hết trang một
// cách tình cờ chứ không phải theo hợp đồng.
func TestUsageOmitsNextCursorWhenNotTruncated(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	view, err := library.Usage(context.Background(), LibraryUsageCommand{
		LibraryRevisionID: "11111111-1111-4111-8111-111111111111",
		Scope:             programmingstore.LibraryScopeProject,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.Sealed.Truncated {
		t.Fatal("fixture rỗng mà báo truncated")
	}
	if view.Sealed.NextCursor != nil || view.Draft.NextCursor != nil {
		t.Fatalf("chưa cắt mà đã có nextCursor: sealed=%v draft=%v",
			view.Sealed.NextCursor, view.Draft.NextCursor)
	}
}

func flipCursorChar(value byte) byte {
	if value == 'A' {
		return 'B'
	}
	return 'A'
}

/*
`T61-104` — phạm vi Draft đo từ tài liệu Draft THẬT.

Nguồn là `objects[].dependencies` — cùng mảng mà đường Seal chuyển thành bản ghi
`library_usages`. Test dựng Draft qua ĐÚNG đường ghi của sản phẩm, không nhét
JSON thẳng vào DB: một fixture chèn tay chỉ chứng minh hàm đọc được thứ chính nó
vừa viết ra.
*/
func TestDraftUsageMeasuresRealDraftDocument(t *testing.T) {
	library, projects, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	entry := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000960")
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

	// Ba POU: hai dùng entry, một không. POU thứ hai khai entry HAI LẦN — vẫn
	// phải là MỘT mục (`LOCK-PGM04-CONTRACT-001` §1.2: một mục là một CẶP
	// (Revision, POU), không phải một lần gọi).
	operations := []json.RawMessage{}
	for index, dependencies := range [][]string{
		{libraryEntryA},
		{libraryEntryA, libraryEntryA},
		{},
	} {
		objectID := fmt.Sprintf("99999999-9999-4999-8999-%012d", index+1)
		programID := fmt.Sprintf("88888888-8888-4888-8888-%012d", index+1)
		name := fmt.Sprintf("AHU_%d", index+1)
		// POU "không dùng" thì mã cũng KHÔNG gọi entry. Bản cũ chép cùng một dòng
		// `SCALE_LIN(1.0)` cho cả ba POU; từ U-06 lưu Draft tự khai dependency cho
		// mọi lời gọi vào Thư viện PROJECT, nên POU đó thành POU dùng entry — và
		// với luật cũ nó vốn đã bị Check chặn `ST-LIB-001`.
		body := "Y := SCALE_LIN(1.0);"
		if len(dependencies) == 0 {
			body = "Y := 1.0;"
		}
		operations = append(operations, op(map[string]any{"op": "upsertObject", "object": map[string]any{
			"objectId": objectID, "kind": "PROGRAM", "name": name, "language": "ST",
			"source":       "PROGRAM " + name + "\nVAR_OUTPUT Y : REAL; END_VAR\n" + body + "\nEND_PROGRAM\n",
			"dependencies": dependencies,
		}}), programOp(programID, objectID, 1000))
	}
	if _, err := saveOps(t, projects, libraryProjectID,
		created.Resource["draftRevisionId"].(string), mutated.ETag,
		"20000000-0000-4000-8000-000000000961", operations...); err != nil {
		t.Fatal(err)
	}

	view, err := library.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: mutated.Resource["libraryRevisionId"].(string),
		EntryID:           libraryEntryA,
		Scope:             programmingstore.LibraryScopeProject,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.Availability != "COMPLETE" {
		t.Fatalf("availability = %q; want COMPLETE", view.Availability)
	}
	if view.Draft.Count != 2 {
		t.Fatalf("draft.count = %d; want 2 — POU thứ ba không dùng entry, và POU khai hai lần vẫn là MỘT mục: %+v",
			view.Draft.Count, view.Draft.Items)
	}
	seen := map[string]bool{}
	for _, item := range view.Draft.Items {
		key := item.RevisionID + "/" + item.ObjectID
		if seen[key] {
			t.Fatalf("mục Draft lặp theo cặp (Revision, POU): %s", key)
		}
		seen[key] = true
		// Deep link phải đủ ba mảnh để consumer mở đúng POU.
		if item.ProjectID == "" || item.RevisionID == "" || item.ObjectID == "" {
			t.Fatalf("mục Draft thiếu mảnh deep link: %+v", item)
		}
		if item.ObjectName == "" {
			t.Fatalf("mục Draft không có tên POU — danh sách toàn UUID không trả lời được câu người dùng hỏi: %+v", item)
		}
		// `usageKind` là loại của khối ĐƯỢC GỌI, không phải của POU gọi.
		// `SCALE_LIN` là FUNCTION nên phải là CALL.
		if item.UsageKind != "CALL" {
			t.Fatalf("usageKind = %q; SCALE_LIN là FUNCTION nên phải là CALL", item.UsageKind)
		}
		if item.IsActive {
			t.Fatal("mục Draft không thể đang vận hành — Draft chưa Seal")
		}
	}
}

// Cursor Draft phải ràng buộc bộ lọc và chống giả mạo y như cursor sealed. Trước
// `T61-104` mọi `draftCursor` đều bị từ chối, nên đường này chưa từng được đo.
func TestDraftUsageCursorBindsFiltersAndRejectsTampering(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	ctx := context.Background()
	const libraryRevisionID = "11111111-1111-4111-8111-111111111111"

	encoded, err := library.encodeUsageCursor(libraryUsageCursor{
		ProjectName: "AHU tầng 1", RevisionID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
		ObjectID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", UsageKind: "CALL",
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA,
		ExpiresAtUTCMS: library.now().UTC().Add(time.Minute).UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := library.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA,
		Scope: programmingstore.LibraryScopeProject, DraftCursor: encoded,
	}); err != nil {
		t.Fatalf("draftCursor hợp lệ bị từ chối: %v", err)
	}
	if _, err := library.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryB,
		Scope: programmingstore.LibraryScopeProject, DraftCursor: encoded,
	}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("draftCursor lệch entryId phải bị từ chối, nhận %v", err)
	}
	tampered := encoded[:len(encoded)-1] + string(flipCursorChar(encoded[len(encoded)-1]))
	if _, err := library.Usage(ctx, LibraryUsageCommand{
		LibraryRevisionID: libraryRevisionID, EntryID: libraryEntryA,
		Scope: programmingstore.LibraryScopeProject, DraftCursor: tampered,
	}); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("draftCursor bị sửa phải bị từ chối, nhận %v", err)
	}
}

// Entry SYSTEM vẫn `UNAVAILABLE`, và đó là câu trả lời ĐÚNG chứ không phải việc
// chưa làm: cả `library_usages` lẫn `objects[].dependencies` đều không mang entry
// SYSTEM, nên đo được nó đòi phân tích source ST/FBD.
func TestSystemUsageStaysUnavailableWithBothCursorsRejected(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	ctx := context.Background()
	command := LibraryUsageCommand{
		LibraryRevisionID: "PROGRAMMING-POU-LIBRARY-REGISTRY-V1:rev-a.4:deadbeef",
		EntryID:           "TON",
		Scope:             programmingstore.LibraryScopeSystem,
	}
	view, err := library.Usage(ctx, command)
	if err != nil {
		t.Fatal(err)
	}
	if view.Availability != "UNAVAILABLE" {
		t.Fatalf("availability = %q; want UNAVAILABLE", view.Availability)
	}
	// Cả hai cursor đều phải bị từ chối: hứa một trang cho một phạm vi chưa đo
	// được là hứa một thứ không tồn tại.
	for name, mutate := range map[string]func(*LibraryUsageCommand){
		"sealedCursor": func(c *LibraryUsageCommand) { c.SealedCursor = "bất-kỳ" },
		"draftCursor":  func(c *LibraryUsageCommand) { c.DraftCursor = "bất-kỳ" },
	} {
		candidate := command
		mutate(&candidate)
		if _, err := library.Usage(ctx, candidate); !errors.Is(err, ErrInvalidCursor) {
			t.Fatalf("%s trên entry SYSTEM phải bị từ chối, nhận %v", name, err)
		}
	}
}
