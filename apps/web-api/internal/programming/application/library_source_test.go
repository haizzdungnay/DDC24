package application

import (
	"context"
	"errors"
	"testing"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T61-404` / `ISS-PGM04-13` — đường đọc mã nguồn theo ĐÚNG một revision.

Bốn điều được khoá, và cả bốn là điều kiện để Preview có nghĩa: đúng revision,
không lùi ngầm về bản mới nhất, phát hiện được dữ liệu lệch băm, và nói ra được
vì sao entry SYSTEM không có mã nguồn.
*/

func sourceOf(t *testing.T, library *LibraryService, revisionID, entryID string) LibraryEntrySourceView {
	t.Helper()
	view, err := library.EntrySource(context.Background(), LibraryEntrySourceCommand{
		LibraryRevisionID: revisionID, EntryID: entryID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func TestEntrySourceReturnsStoredSourceOfExactlyThatRevision(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	first := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-0000000a0001")
	first.IfMatch = created.ETag
	first.Source = "FUNCTION SCALE_LIN : REAL\nSCALE_LIN := 1.0;\nEND_FUNCTION\n"
	afterFirst, err := library.UpsertEntry(ctx, actor, first)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := library.store.FindProjectLibraryDraft(ctx, libraryProjectID)
	if err != nil {
		t.Fatal(err)
	}
	oldRevisionID := draft.LibraryRevisionID

	view := sourceOf(t, library, oldRevisionID, libraryEntryA)
	if view.Availability != LibrarySourceAvailable {
		t.Fatalf("availability = %q (%s)", view.Availability, view.Reason)
	}
	if view.Source == nil || *view.Source != first.Source {
		t.Fatalf("source = %v; muốn đúng mã đã ghi", view.Source)
	}
	if view.LibraryRevisionID != oldRevisionID || view.Scope != programmingstore.LibraryScopeProject {
		t.Fatalf("view nhận diện sai revision: %+v", view)
	}

	/* Publish rồi ghi tiếp: bản Draft mới mang mã KHÁC. Đọc lại bản CŨ phải ra
	   mã CŨ — nếu đường đọc lùi ngầm về "bản mới nhất" thì đây là chỗ nó lộ ra,
	   và đó đúng là lỗi im lặng nhất của cả màn hình này. */
	if _, err := library.store.PublishProjectLibrary(ctx, oldRevisionID); err != nil {
		t.Fatal(err)
	}
	second := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-0000000a0002")
	second.IfMatch = afterFirst.ETag
	second.Source = "FUNCTION SCALE_LIN : REAL\nSCALE_LIN := 2.0;\nEND_FUNCTION\n"
	if _, err := library.UpsertEntry(ctx, actor, second); err != nil {
		t.Fatal(err)
	}
	newDraft, err := library.store.FindProjectLibraryDraft(ctx, libraryProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if newDraft.LibraryRevisionID == oldRevisionID {
		t.Fatal("bản ghi thứ hai phải mở một Draft mới; test mất ý nghĩa nếu vẫn cùng revision")
	}

	old := sourceOf(t, library, oldRevisionID, libraryEntryA)
	if old.Source == nil || *old.Source != first.Source {
		t.Fatalf("đọc bản cũ ra mã %v; phải ra mã của chính bản đó", old.Source)
	}
	fresh := sourceOf(t, library, newDraft.LibraryRevisionID, libraryEntryA)
	if fresh.Source == nil || *fresh.Source != second.Source {
		t.Fatalf("đọc bản mới ra mã %v; phải ra mã của chính bản đó", fresh.Source)
	}
	if old.ContentSHA256 == fresh.ContentSHA256 {
		t.Fatal("hai bản phải khác contentSha256; nếu bằng nhau thì phép so ở trên không phân biệt được gì")
	}
}

/*
Băm lệch phải fail-closed.

Kiểm ở lớp QUYẾT ĐỊNH chứ không qua SQLite, và đó là một phát hiện chứ không
phải một lối tắt: trigger của `library_entries` đã ép `content_sha256` khớp nội
dung ở mọi lần ghi, nên một hàng lệch băm KHÔNG dựng được qua đường ghi. Nhánh
này là hàng rào cho dữ liệu tới bằng đường khác — phục hồi từ backup, một lần
migrate hỏng, một tệp SQLite bị sửa ngoài ứng dụng.

Đây là ca mà một đường đọc "dễ tính" sẽ trả mã nguồn của một hàng đã hỏng, và
người dùng đọc một thứ KHÔNG phải thứ thiết bị sẽ chạy.
*/
func TestEntrySourceFailsClosedWhenStoredHashDoesNotMatch(t *testing.T) {
	good := programmingstore.LibraryEntry{
		EntryID: libraryEntryA, Kind: programmingstore.LibraryKindFunction, Name: "SCALE_LIN",
		Language: "ST", FeatureState: "AVAILABLE",
		Source:        []byte("FUNCTION SCALE_LIN : REAL\nSCALE_LIN := 1.0;\nEND_FUNCTION\n"),
		InterfaceJSON: []byte(`{"inputs":[]}`),
		StateLayout:   programmingstore.LibraryStateLayout{Authoritative: true},
	}
	digest, err := programmingstore.LibraryEntryContentSHA256(good)
	if err != nil {
		t.Fatal(err)
	}
	good.ContentSHA256 = digest

	// Vế dương: băm khớp thì trả mã nguồn. Thiếu vế này thì một hàm luôn trả
	// HASH_MISMATCH vẫn qua được ca dưới.
	availability, reason, source := libraryEntrySourceAvailability(good)
	if availability != LibrarySourceAvailable || source == nil || reason != "" {
		t.Fatalf("băm khớp: availability=%q reason=%q source=%v", availability, reason, source)
	}

	// Vế âm: đúng một byte của source đổi, băm giữ nguyên.
	corrupted := good
	corrupted.Source = []byte("FUNCTION SCALE_LIN : REAL\nSCALE_LIN := 999.0;\nEND_FUNCTION\n")
	availability, reason, source = libraryEntrySourceAvailability(corrupted)
	if availability != LibrarySourceHashMismatch {
		t.Fatalf("availability = %q; muốn %s", availability, LibrarySourceHashMismatch)
	}
	if source != nil {
		t.Fatalf("băm lệch mà vẫn trả source: %q", *source)
	}
	if reason == "" {
		t.Fatal("phải nói ra lý do ổn định, không để client tự đoán")
	}
}

// Entry SYSTEM không lưu mã nguồn — đó là thiết kế, không phải sự cố, nên nó
// phải nói ra được chứ không trả lỗi.
func TestEntrySourceSaysWhySystemEntriesHaveNoStoredSource(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	page, err := library.SearchLibraries(context.Background(), SearchLibrariesCommand{Scope: "SYSTEM", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) == 0 {
		t.Fatal("registry SYSTEM rỗng; test mất ý nghĩa")
	}
	system := page.Items[0]
	view := sourceOf(t, library, system.LibraryRevisionID, system.EntryID)
	if view.Availability != LibrarySourceNotStored {
		t.Fatalf("availability = %q; muốn %s", view.Availability, LibrarySourceNotStored)
	}
	if view.Source != nil || view.Reason == "" {
		t.Fatalf("SYSTEM: source=%v reason=%q", view.Source, view.Reason)
	}
	// Vẫn phải nhận diện đúng revision và entry, để màn hình nói được "bản nào".
	if view.LibraryRevisionID != system.LibraryRevisionID || view.EntryID != system.EntryID {
		t.Fatalf("view nhận diện sai: %+v", view)
	}
}

func TestEntrySourceRequiresBothIdentifiersAndRejectsUnknownOnes(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	ctx := context.Background()

	// Thiếu định danh: 400, KHÔNG phải "lấy bản mới nhất".
	for _, command := range []LibraryEntrySourceCommand{
		{EntryID: libraryEntryA},
		{LibraryRevisionID: "33333333-3333-4333-8333-333333333333"},
		{},
	} {
		if _, err := library.EntrySource(ctx, command); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("command=%+v err=%v; muốn ErrInvalidRequest", command, err)
		}
	}
	// Revision không tồn tại: 404, không im lặng trả rỗng.
	_, err := library.EntrySource(ctx, LibraryEntrySourceCommand{
		LibraryRevisionID: "33333333-3333-4333-8333-333333333333", EntryID: libraryEntryA,
	})
	if !errors.Is(err, programmingstore.ErrNotFound) {
		t.Fatalf("revision lạ: err = %v; muốn ErrNotFound", err)
	}
}
