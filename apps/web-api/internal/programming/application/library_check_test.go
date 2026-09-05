package application

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

/*
`T61-401` / `ISS-PGM04-11` — bước Check của wizard PROJECT Library.

Ba điều được khoá ở đây, theo đúng thứ tự chúng từng hỏng:

 1. Vòng phụ thuộc bị chặn ở ĐƯỜNG GHI, không phải mãi tới lần Seal.
 2. Check và Save cho CÙNG một câu trả lời trên cùng một payload.
 3. Check là DRY RUN: không tăng ETag Draft, không tạo entry nào.
*/

func diagnosticCodes(diagnostics []LibraryEntryDiagnostic) []string {
	codes := make([]string, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		codes = append(codes, diagnostic.Code)
	}
	return codes
}

func hasDiagnostic(diagnostics []LibraryEntryDiagnostic, field, code string) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Field == field && diagnostic.Code == code {
			return true
		}
	}
	return false
}

// seedTwoEntries dựng A và B trong Draft library, A phụ thuộc B.
func seedTwoEntries(t *testing.T) (*LibraryService, Actor, string) {
	t.Helper()
	library, _, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	first := upsertCommand(libraryEntryB, "SCALE_LIN", "20000000-0000-4000-8000-0000000000b1")
	first.IfMatch = created.ETag
	afterFirst, err := library.UpsertEntry(ctx, actor, first)
	if err != nil {
		t.Fatal(err)
	}
	second := upsertCommand(libraryEntryA, "LIMIT_RANGE", "20000000-0000-4000-8000-0000000000a1")
	second.IfMatch = afterFirst.ETag
	second.Dependencies = []LibraryDependencyView{{EntryID: libraryEntryB, Version: "1.0.0"}}
	afterSecond, err := library.UpsertEntry(ctx, actor, second)
	if err != nil {
		t.Fatal(err)
	}
	return library, actor, afterSecond.ETag
}

func TestUpsertEntryRefusesDependencyCycleBeforeItReachesTheDraft(t *testing.T) {
	library, actor, etag := seedTwoEntries(t)
	ctx := context.Background()

	// B phụ thuộc ngược A đóng vòng A -> B -> A. Trước lát này store nhận nó và
	// chỉ lần Seal sau đó mới nổ, cách chỗ gây lỗi hàng chục thao tác.
	cycle := upsertCommand(libraryEntryB, "SCALE_LIN", "20000000-0000-4000-8000-0000000000b2")
	cycle.IfMatch = etag
	cycle.Dependencies = []LibraryDependencyView{{EntryID: libraryEntryA, Version: "1.0.0"}}
	if _, err := library.UpsertEntry(ctx, actor, cycle); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("UpsertEntry với vòng phụ thuộc: err = %v; muốn ErrInvalidRequest", err)
	}

	/* Và Check phải nói CHẶN, không chỉ "có một phát hiện".
	   Đây là chỗ phép tiêm lỗi bắt được lỗ hổng: hạ severity của chẩn đoán vòng
	   xuống không-chặn vẫn giữ nguyên `ErrInvalidRequest` ở đường ghi (vì đường
	   ghi từ chối khi danh sách khác rỗng), nhưng FE đọc `blocking` để mở nút
	   Lưu — nên một chẩn đoán vòng không-chặn là một đường lưu thẳng vào Draft
	   một đồ thị không Seal được. */
	checked, err := library.CheckEntry(ctx, actor, cycle)
	if err != nil {
		t.Fatal(err)
	}
	if !checked.Blocking {
		t.Fatalf("Check nói không chặn cho một vòng phụ thuộc: %v", diagnosticCodes(checked.Diagnostics))
	}

	diagnostics, _, _, err := library.DiagnoseEntry(ctx, cycle)
	if err != nil {
		t.Fatal(err)
	}
	if !hasDiagnostic(diagnostics, "dependencies", LibraryDiagDependencyCycle) {
		t.Fatalf("chẩn đoán = %v; muốn có %s trên trường dependencies",
			diagnosticCodes(diagnostics), LibraryDiagDependencyCycle)
	}
	// Đường vòng phải NÊU TÊN các mắt xích: một câu "có vòng" không nói vòng nào
	// thì người dùng vẫn phải tự dò lại toàn bộ đồ thị.
	for _, diagnostic := range diagnostics {
		if diagnostic.Code != LibraryDiagDependencyCycle {
			continue
		}
		if !strings.Contains(diagnostic.Message, libraryEntryA) || !strings.Contains(diagnostic.Message, libraryEntryB) {
			t.Fatalf("thông báo vòng = %q; phải nêu cả %s và %s", diagnostic.Message, libraryEntryA, libraryEntryB)
		}
	}
}

func TestCheckEntryIsDryRunAndDoesNotTouchDraft(t *testing.T) {
	library, actor, etag := seedTwoEntries(t)
	ctx := context.Background()

	before, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Scope: "PROJECT"})
	if err != nil {
		t.Fatal(err)
	}
	candidate := upsertCommand("66666666-6666-4666-8666-666666666663", "RAMP_LIMIT",
		"20000000-0000-4000-8000-0000000000c1")
	result, err := library.CheckEntry(ctx, actor, candidate)
	if err != nil {
		t.Fatal(err)
	}
	if result.Blocking || len(result.Diagnostics) != 0 {
		t.Fatalf("Check payload hợp lệ: blocking=%v diagnostics=%v", result.Blocking, diagnosticCodes(result.Diagnostics))
	}
	if result.LibraryVersion == "" {
		t.Fatal("Check phải nói Draft library nào sẽ nhận thay đổi")
	}

	after, err := library.SearchLibraries(ctx, SearchLibrariesCommand{ProjectID: libraryProjectID, Scope: "PROJECT"})
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Items) != len(before.Items) {
		t.Fatalf("Check đã tạo entry: %d -> %d", len(before.Items), len(after.Items))
	}
	// ETag Draft không đổi thì lần Save ngay sau đó vẫn dùng được ETag cũ. Đây
	// là toàn bộ lý do Check không mang `If-Match`.
	commit := candidate
	commit.IfMatch = etag
	if _, err := library.UpsertEntry(ctx, actor, commit); err != nil {
		t.Fatalf("Save ngay sau Check với ETag cũ: %v", err)
	}
}

/*
Check và Save phải khớp trên CÙNG payload. Đây là bất biến làm cho bước Check là
authoritative chứ không phải một bản sao lạc quan ở client: nếu hai đầu tách
nhau, bên thua luôn là người dùng — Check nói "được" rồi Save trả 400 mà không
nói trường nào.
*/
func TestCheckAndSaveAgreeOnEveryPayload(t *testing.T) {
	cases := []struct {
		name   string
		field  string
		code   string
		mutate func(*UpsertLibraryEntryCommand)
	}{
		{name: "tên không phải IEC identifier", field: "name", code: LibraryDiagName,
			mutate: func(c *UpsertLibraryEntryCommand) { c.Name = "1BAD" }},
		{name: "tên có ký tự Unicode ngoài IEC", field: "name", code: LibraryDiagName,
			mutate: func(c *UpsertLibraryEntryCommand) { c.Name = "SCALE_LÍN" }},
		{name: "source rỗng", field: "source", code: LibraryDiagSource,
			mutate: func(c *UpsertLibraryEntryCommand) { c.Source = "" }},
		{name: "source vượt 65536 byte", field: "source", code: LibraryDiagSource,
			mutate: func(c *UpsertLibraryEntryCommand) { c.Source = strings.Repeat("A", 65537) }},
		{name: "source mang ký tự điều khiển", field: "source", code: LibraryDiagSource,
			mutate: func(c *UpsertLibraryEntryCommand) { c.Source = "A\x00B" }},
		{name: "FBD nhưng source không phải JSON object", field: "source", code: LibraryDiagSourceJSON,
			mutate: func(c *UpsertLibraryEntryCommand) { c.Language = "FBD"; c.Source = "khong-phai-json" }},
		{name: "interface không phải object", field: "interface", code: LibraryDiagInterface,
			mutate: func(c *UpsertLibraryEntryCommand) { c.InterfaceJSON = json.RawMessage(`[1,2]`) }},
		{name: "mô tả vượt 512 ký tự", field: "description", code: LibraryDiagDescription,
			mutate: func(c *UpsertLibraryEntryCommand) { value := strings.Repeat("đ", 513); c.Description = &value }},
		{name: "phân loại vượt 32 ký tự", field: "category", code: LibraryDiagCategory,
			mutate: func(c *UpsertLibraryEntryCommand) { value := strings.Repeat("x", 33); c.Category = &value }},
		{name: "quá 8 thẻ", field: "tags", code: LibraryDiagTags,
			mutate: func(c *UpsertLibraryEntryCommand) {
				c.Tags = []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"}
			}},
		{name: "featureState do client tự dán", field: "featureState", code: LibraryDiagFeatureState,
			mutate: func(c *UpsertLibraryEntryCommand) { c.FeatureState = "REVIEW_REQUIRED" }},
		{name: "phụ thuộc chính nó", field: "dependencies", code: LibraryDiagDependencySelf,
			mutate: func(c *UpsertLibraryEntryCommand) {
				c.Dependencies = []LibraryDependencyView{{EntryID: c.EntryID, Version: "1.0.0"}}
			}},
		{name: "phụ thuộc một entry không tồn tại", field: "dependencies", code: LibraryDiagDependencyUnknwn,
			mutate: func(c *UpsertLibraryEntryCommand) {
				c.Dependencies = []LibraryDependencyView{
					{EntryID: "77777777-7777-4777-8777-777777777777", Version: "1.0.0"}}
			}},
		{name: "khai trùng một phụ thuộc", field: "dependencies", code: LibraryDiagDependencyDup,
			mutate: func(c *UpsertLibraryEntryCommand) {
				c.Dependencies = []LibraryDependencyView{
					{EntryID: libraryEntryB, Version: "1.0.0"}, {EntryID: libraryEntryB, Version: "1.0.0"}}
			}},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			library, actor, etag := seedTwoEntries(t)
			ctx := context.Background()

			command := upsertCommand("66666666-6666-4666-8666-666666666664", "NEW_BLOCK",
				"20000000-0000-4000-8000-0000000000d1")
			testCase.mutate(&command)

			checked, err := library.CheckEntry(ctx, actor, command)
			if err != nil {
				t.Fatalf("CheckEntry: %v", err)
			}
			if !checked.Blocking {
				t.Fatalf("Check nói không chặn; chẩn đoán = %v", diagnosticCodes(checked.Diagnostics))
			}
			if !hasDiagnostic(checked.Diagnostics, testCase.field, testCase.code) {
				t.Fatalf("chẩn đoán = %v; muốn %s trên trường %s",
					diagnosticCodes(checked.Diagnostics), testCase.code, testCase.field)
			}

			command.IfMatch = etag
			if _, err := library.UpsertEntry(ctx, actor, command); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("Save cùng payload: err = %v; Check đã nói chặn nên Save phải từ chối", err)
			}
		})
	}
}

// Chiều ngược lại: payload SẠCH phải được cả hai đầu chấp nhận. Thiếu vế này thì
// một `DiagnoseEntry` luôn trả về "có lỗi" vẫn qua được mọi case phía trên.
func TestCheckCleanPayloadIsAcceptedBySave(t *testing.T) {
	library, actor, etag := seedTwoEntries(t)
	ctx := context.Background()

	command := upsertCommand("66666666-6666-4666-8666-666666666665", "PID_TRIM",
		"20000000-0000-4000-8000-0000000000e1")
	command.Dependencies = []LibraryDependencyView{{EntryID: libraryEntryB, Version: "1.0.0"}}
	category, description := "control", "Khối trim cho vòng PID"
	command.Category, command.Description = &category, &description
	command.Tags = []string{"AHU", "ahu", " pid "}

	checked, err := library.CheckEntry(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	if checked.Blocking || len(checked.Diagnostics) != 0 {
		t.Fatalf("payload sạch bị chặn: %v", diagnosticCodes(checked.Diagnostics))
	}
	command.IfMatch = etag
	if _, err := library.UpsertEntry(ctx, actor, command); err != nil {
		t.Fatalf("Save payload sạch: %v", err)
	}
}

// Sau một lần Publish, Project KHÔNG còn Draft library: lần ghi kế tiếp tự mở
// Draft mới bằng cách clone bản PUBLISHED. Bước Check phải soi đúng bộ entry đó,
// nếu không nó từ chối mọi phụ thuộc ngay ở trạng thái phổ biến nhất sau Publish.
func TestCheckResolvesDependenciesAgainstThePublishedParentWhenNoDraftIsOpen(t *testing.T) {
	library, actor, _ := seedTwoEntries(t)
	ctx := context.Background()

	draft, err := library.store.FindProjectLibraryDraft(ctx, libraryProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := library.store.PublishProjectLibrary(ctx, draft.LibraryRevisionID); err != nil {
		t.Fatal(err)
	}

	command := upsertCommand("66666666-6666-4666-8666-666666666666", "AFTER_PUBLISH",
		"20000000-0000-4000-8000-0000000000f1")
	command.Dependencies = []LibraryDependencyView{{EntryID: libraryEntryB, Version: "1.0.0"}}
	checked, err := library.CheckEntry(ctx, actor, command)
	if err != nil {
		t.Fatal(err)
	}
	if checked.Blocking {
		t.Fatalf("Check sau Publish chặn nhầm: %v", diagnosticCodes(checked.Diagnostics))
	}
	if checked.LibraryVersion != "1.1.0" {
		t.Fatalf("version đích = %q; lần ghi kế tiếp nâng minor lên 1.1.0", checked.LibraryVersion)
	}
	if checked.LibraryRevisionID != "" {
		t.Fatalf("libraryRevisionId = %q; chưa có Draft nào mở nên phải rỗng", checked.LibraryRevisionID)
	}
}
