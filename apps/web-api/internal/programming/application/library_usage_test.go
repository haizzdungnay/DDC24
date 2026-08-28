package application

import (
	"context"
	"testing"

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

func TestProjectEntryUsageReportsSealedOnlyUntilDraftScopeExists(t *testing.T) {
	// Store rỗng: không có usage nào. Điều đang kiểm KHÔNG phải con số, mà là
	// việc phạm vi Draft tự khai là chưa đo được thay vì khai 0.
	store := openUsageStore(t)
	service := &LibraryService{store: store}
	view, err := service.Usage(context.Background(), LibraryUsageCommand{
		LibraryRevisionID: "11111111-1111-4111-8111-111111111111",
		EntryID:           "SCALE_LIN",
		Scope:             programmingstore.LibraryScopeProject,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.Availability != LibraryUsageSealedOnly {
		t.Fatalf("availability = %q; want SEALED_ONLY — phạm vi Draft chưa đo được", view.Availability)
	}
	if view.Draft.Count != 0 || len(view.Draft.Items) != 0 {
		t.Fatal("phạm vi Draft chưa giao mà đã trả dữ liệu")
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
