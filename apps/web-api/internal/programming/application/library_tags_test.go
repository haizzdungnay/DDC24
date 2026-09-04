package application

import (
	"context"
	"errors"
	"strings"
	"testing"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T61-101` / `LOCK-PGM04-CONTRACT-001` §2.1 — thẻ (`tags`).

Bộ này khoá đúng hai thứ mà một bản "thêm field" dễ bỏ sót:

 1. CHUẨN HOÁ là hợp đồng, không phải tiện ích. Nếu `["VAV", " vav "]` không quy
    về `["vav"]` thì bộ lọc theo thẻ chia đôi cùng một nhóm khối, và
    `presentationSha256` — thứ client dùng để biết "phần trình bày có đổi
    không" — báo đổi trong khi không có gì đổi.
 2. VƯỢT TRẦN là 400, không phải cắt bớt. Cắt bớt im lặng làm read-back trả về
    thứ khác thứ client vừa gửi, và người dùng không có cách nào biết thẻ của
    mình đã mất.

Số đo trong bộ này là SỐ TUYỆT ĐỐI (8, 24, "vav"), không phải hằng của sản
phẩm: so một test với chính hằng nó đang kiểm sẽ xanh kể cả khi hằng bị đặt về
0. Hằng được canh riêng ở `TestLibraryTagLimitsAreTheContractNumbers`.
*/

func TestLibraryTagLimitsAreTheContractNumbers(t *testing.T) {
	// Trần THÔ của payload, khoá bằng số tuyệt đối của hợp đồng §2.1.
	if libraryRequestMaxTags != 8 {
		t.Fatalf("trần thẻ = %d; hợp đồng §2.1 khoá 8", libraryRequestMaxTags)
	}
	// 24 ký tự: một thẻ 24 ký tự phải qua, 25 phải trượt. Đo ở chính đường
	// chuẩn hoá chứ không đọc lại hằng của store.
	if _, err := normalizeLibraryTags([]string{strings.Repeat("a", 24)}); err != nil {
		t.Fatalf("thẻ 24 ký tự phải hợp lệ: %v", err)
	}
	if _, err := normalizeLibraryTags([]string{strings.Repeat("a", 25)}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("thẻ 25 ký tự phải bị từ chối, nhận: %v", err)
	}
}

func TestNormalizeLibraryTagsFoldsCaseWhitespaceAndDuplicates(t *testing.T) {
	got, err := normalizeLibraryTags([]string{" VAV  Box ", "vav box", "HVAC", "hvac", "  Air "})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"air", "hvac", "vav box"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("chuẩn hoá thẻ = %v; want %v", got, want)
	}
}

// Sắp xếp không phải để nhìn cho đẹp: hai payload cùng một TẬP phải cho cùng
// một `presentationSha256`, nếu không client dùng hash ấy sẽ thấy "đổi" ở mọi
// lần lưu lại cùng nội dung.
func TestNormalizeLibraryTagsIsOrderIndependent(t *testing.T) {
	first, err := normalizeLibraryTags([]string{"zone", "alarm", "pid"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := normalizeLibraryTags([]string{"pid", "zone", "alarm"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(first, "|") != strings.Join(second, "|") {
		t.Fatalf("thứ tự gửi làm đổi kết quả: %v vs %v", first, second)
	}
}

func TestNormalizeLibraryTagsRejectsHostilePayloads(t *testing.T) {
	cases := map[string][]string{
		"quá 8 thẻ thô":        {"a", "b", "c", "d", "e", "f", "g", "h", "i"},
		"thẻ rỗng":             {"ok", ""},
		"thẻ chỉ khoảng trắng": {"ok", "   "},
		"ký tự điều khiển":     {"ok\x00tag"},
		"quá 24 ký tự":         {strings.Repeat("x", 25)},
	}
	for name, tags := range cases {
		if _, err := normalizeLibraryTags(tags); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%s: phải là ErrInvalidRequest, nhận %v", name, err)
		}
	}
}

// Mảng rỗng và `nil` là CÙNG một câu ("không thẻ nào"), nên cả hai ra `nil` để
// lớp HTTP `omitempty` chúng thành field vắng. Đây là quyết định đã ghi rõ, và
// nó khác `description` — nơi chuỗi rỗng là một mô tả đã viết và cố ý để trống.
func TestNormalizeLibraryTagsTreatsEmptyListAsAbsent(t *testing.T) {
	for name, input := range map[string][]string{"nil": nil, "rỗng": {}} {
		got, err := normalizeLibraryTags(input)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got != nil {
			t.Fatalf("%s: muốn nil, nhận %v", name, got)
		}
	}
}

/*
Đường ghi thật: thẻ đọc lại phải là dạng đã chuẩn hoá, `contentSha256` KHÔNG
được đổi vì một lần gắn thẻ (`D61-09`), và `presentationSha256` thì PHẢI đổi —
nếu không nó không nói lên điều gì.
*/
func TestUpsertEntryPersistsNormalizedTagsAndKeepsContentHashStable(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	plain := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000801")
	plain.IfMatch = created.ETag
	first, err := library.UpsertEntry(ctx, actor, plain)
	if err != nil {
		t.Fatal(err)
	}
	before := readLibraryEntryView(t, library, libraryEntryA)
	if len(before.Tags) != 0 {
		t.Fatalf("entry chưa gắn thẻ phải không có thẻ, nhận %v", before.Tags)
	}
	if before.PresentationSHA256 != "" {
		t.Fatalf("chưa có metadata nào mà đã có presentationSha256: %q", before.PresentationSHA256)
	}

	tagged := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000802")
	tagged.IfMatch = first.ETag
	tagged.Tags = []string{"  VAV  Box ", "vav box", "HVAC"}
	if _, err := library.UpsertEntry(ctx, actor, tagged); err != nil {
		t.Fatal(err)
	}
	after := readLibraryEntryView(t, library, libraryEntryA)
	if strings.Join(after.Tags, "|") != "hvac|vav box" {
		t.Fatalf("thẻ đọc lại = %v; want [hvac vav box]", after.Tags)
	}
	if after.ContentSHA256 != before.ContentSHA256 {
		t.Fatalf("gắn thẻ đã đổi contentSha256 (%s -> %s) — mọi artifact đã ký thành lỗi thời (D61-09)",
			before.ContentSHA256, after.ContentSHA256)
	}
	if after.PresentationSHA256 == "" || after.PresentationSHA256 == before.PresentationSHA256 {
		t.Fatalf("presentationSha256 không đổi khi thẻ đổi: %q -> %q",
			before.PresentationSHA256, after.PresentationSHA256)
	}
}

// Vượt trần phải là lỗi REQUEST ở lớp application, không phải một lỗi SQLite lọt
// xuống store rồi được lớp HTTP dịch thành 503 "thử lại đi".
func TestUpsertEntryRejectsOversizedTagsAsRequestError(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000810")
	command.IfMatch = created.ETag
	command.Tags = []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"}
	if _, err := library.UpsertEntry(ctx, actor, command); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("9 thẻ phải là ErrInvalidRequest, nhận %v", err)
	}
}

// `q` phải phủ thẻ ở CẢ hai nhánh (SYSTEM trong bộ nhớ, PROJECT bằng SQL); nếu
// chỉ một nhánh phủ thì cùng một từ khoá cho hai kết quả khác nhau tuỳ scope
// người dùng đang xem.
func TestSearchLibrariesMatchesTags(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000820")
	command.IfMatch = created.ETag
	command.Tags = []string{"quạt gió"}
	if _, err := library.UpsertEntry(ctx, actor, command); err != nil {
		t.Fatal(err)
	}

	page, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject, Query: "quạt",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].EntryID != libraryEntryA {
		t.Fatalf("tìm theo thẻ không ra entry: %+v", page.Items)
	}

	// Không phân biệt hoa thường: thẻ lưu chữ thường, truy vấn viết hoa.
	upper, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject, Query: "QUẠT",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(upper.Items) != 1 {
		t.Fatalf("tìm theo thẻ phải không phân biệt hoa thường: %+v", upper.Items)
	}

	// Truy vấn không khớp thẻ nào thì không được trả bừa: đây là vế chứng minh
	// phép so ở trên thật sự lọc chứ không phải luôn khớp.
	none, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject, Query: "bơm nước",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(none.Items) != 0 {
		t.Fatalf("từ khoá không khớp mà vẫn trả %d entry", len(none.Items))
	}
}

func readLibraryEntryView(t *testing.T, library *LibraryService, entryID string) LibraryEntryView {
	t.Helper()
	page, err := library.SearchLibraries(context.Background(), SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range page.Items {
		if item.EntryID == entryID {
			return item
		}
	}
	t.Fatalf("không tìm thấy entry %s trong %d mục", entryID, len(page.Items))
	return LibraryEntryView{}
}

/*
`q` phủ `description` — kể cả mô tả TIẾNG VIỆT.

Đây là một lỗi thật đã đo được, không phải một ca giả định: `upper()` của SQLite
chỉ gấp ASCII, nên trên driver của sản phẩm

	SELECT instr(upper('điều khiển quạt'), 'QUẠT')  ->  0

trong khi Go đã `strings.ToUpper` từ khoá thành `QUẠT`. Nghĩa là mệnh đề
`instr(upper(e.description), ?)` KHÔNG BAO GIỜ khớp một mô tả tiếng Việt khi từ
khoá mang dấu. Trên một sản phẩm mà mọi mô tả đều viết bằng tiếng Việt, đó là
một ô tìm kiếm im lặng bỏ sót gần hết kết quả nó hứa phủ.

Test này canh `mkddc_upper` — hàm SQL dùng chính `strings.ToUpper` của Go, để
nhánh SQL (PROJECT) và nhánh trong bộ nhớ (SYSTEM) gấp chữ theo CÙNG một luật.
*/
func TestSearchLibrariesMatchesVietnameseDescription(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	description := "Điều khiển quạt hồi gió"
	command := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000830")
	command.IfMatch = created.ETag
	command.Description = &description
	if _, err := library.UpsertEntry(ctx, actor, command); err != nil {
		t.Fatal(err)
	}

	for _, query := range []string{"quạt", "QUẠT", "Điều khiển"} {
		page, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
			ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject, Query: query,
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 {
			t.Fatalf("từ khoá %q không khớp mô tả tiếng Việt: %d kết quả", query, len(page.Items))
		}
	}
}

/*
`presentationSha256` phải phủ THẺ, và chỉ phủ NỘI DUNG của thẻ.

Hai vế, và vế nào thiếu cũng làm hash mất nghĩa:

  - Đổi TẬP thẻ mà hash không đổi ⇒ client dùng hash để biết "phần trình bày có
    đổi không" sẽ bỏ qua một thay đổi thật.
  - Gửi lại CÙNG một tập theo thứ tự khác mà hash đổi ⇒ client thấy "đổi" ở mọi
    lần lưu lại cùng nội dung, và sẽ thôi tin vào hash.

Test trước đó (`...KeepsContentHashStable`) so hash sau khi gắn thẻ với hash lúc
entry CHƯA có metadata nào — nên nó xanh kể cả khi thẻ không hề vào phép băm.
Đo đã chứng minh đúng như vậy: phép tiêm "bỏ tags khỏi payload băm" không làm nó
đỏ. Bộ dưới đây đo đúng chỗ ấy.
*/
func TestPresentationHashTracksTagContentNotTagOrder(t *testing.T) {
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	write := func(key string, ifMatch string, tags []string) (string, string) {
		t.Helper()
		command := upsertCommand(libraryEntryA, "SCALE_LIN", key)
		command.IfMatch = ifMatch
		command.Tags = tags
		result, err := library.UpsertEntry(ctx, actor, command)
		if err != nil {
			t.Fatal(err)
		}
		return readLibraryEntryView(t, library, libraryEntryA).PresentationSHA256, result.ETag
	}

	first, etag := write("20000000-0000-4000-8000-000000000840", created.ETag, []string{"vav", "hvac"})
	if first == "" {
		t.Fatal("gắn thẻ mà không sinh presentationSha256")
	}

	// Cùng một TẬP, thứ tự khác: hash phải Y NGUYÊN.
	reordered, etag := write("20000000-0000-4000-8000-000000000841", etag, []string{"HVAC", " vav "})
	if reordered != first {
		t.Fatalf("cùng tập thẻ mà hash đổi: %s -> %s", first, reordered)
	}

	// Tập khác: hash PHẢI đổi.
	changed, _ := write("20000000-0000-4000-8000-000000000842", etag, []string{"vav", "hvac", "zone"})
	if changed == first {
		t.Fatalf("đổi tập thẻ mà hash không đổi (%s) — thẻ không vào phép băm", changed)
	}
}
