package application

import (
	"context"
	"fmt"
	"testing"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T61-101` / `LOCK-PGM04-CONTRACT-001` §4 — read model `compatibility`.

Bất biến đắt nhất ở đây là FAIL-CLOSED, và nó cùng họ với `availability` của
Used-In: `COMPATIBLE` là một lời hứa rằng gói đang chạy và bản mới nhất là cùng
một thứ. Phát lời hứa ấy khi chưa đo được là cách người vận hành nâng version mà
không biết mình đang nâng.

Kỳ vọng viết bằng chuỗi TUYỆT ĐỐI (`"UNKNOWN"`, `"COMPATIBLE"`) chứ không bằng
hằng của sản phẩm: `if got != LibraryCompatibleUnknown` sẽ xanh kể cả khi ai đó
đặt `LibraryCompatibleUnknown = "COMPATIBLE"` — hai vế cùng đổi. Chính các hằng
được canh riêng ở `TestLibraryCompatibilityStateNames`.
*/

func TestLibraryCompatibilityStateNames(t *testing.T) {
	if LibraryCompatible != "COMPATIBLE" {
		t.Fatalf("LibraryCompatible = %q; hợp đồng §4 khoá \"COMPATIBLE\"", LibraryCompatible)
	}
	if LibraryRequiresMigration != "REQUIRES_MIGRATION" {
		t.Fatalf("LibraryRequiresMigration = %q; hợp đồng §4 khoá \"REQUIRES_MIGRATION\"", LibraryRequiresMigration)
	}
	if LibraryCompatibleUnknown != "UNKNOWN" {
		t.Fatalf("LibraryCompatibleUnknown = %q; hợp đồng §4 khoá \"UNKNOWN\"", LibraryCompatibleUnknown)
	}
	if len(LibraryCompatibilityStates) != 3 {
		t.Fatalf("enum state có %d giá trị; hợp đồng §4 khoá đúng 3", len(LibraryCompatibilityStates))
	}
}

func TestLibraryCompatibilityIsFailClosedWhenEitherSideIsUnmeasured(t *testing.T) {
	const entryID = "66666666-6666-4666-8666-666666666661"
	cases := []struct {
		name       string
		scope      string
		facts      programmingstore.LibraryCompatibilityFacts
		wantState  string
		wantReason bool
	}{
		{
			name:  "chưa Commission Revision nào",
			scope: programmingstore.LibraryScopeProject,
			facts: programmingstore.LibraryCompatibilityFacts{
				PinnedVersions:    map[string]string{},
				PublishedVersions: map[string]string{entryID: "1.0.0"},
			},
			wantState: "UNKNOWN", wantReason: true,
		},
		{
			name:  "có pin nhưng chưa version PUBLISHED nào mang entry",
			scope: programmingstore.LibraryScopeProject,
			facts: programmingstore.LibraryCompatibilityFacts{
				HasActiveRevision: true,
				PinnedVersions:    map[string]string{entryID: "1.0.0"},
				PublishedVersions: map[string]string{},
			},
			wantState: "UNKNOWN", wantReason: true,
		},
		{
			name:  "entry SYSTEM: usage phân giải từ registry, chưa đo được",
			scope: programmingstore.LibraryScopeSystem,
			facts: programmingstore.LibraryCompatibilityFacts{
				HasActiveRevision: true,
				PinnedVersions:    map[string]string{entryID: "1.0.0"},
				PublishedVersions: map[string]string{entryID: "1.0.0"},
			},
			wantState: "UNKNOWN", wantReason: true,
		},
		{
			name:  "hai vế đo được và bằng nhau",
			scope: programmingstore.LibraryScopeProject,
			facts: programmingstore.LibraryCompatibilityFacts{
				HasActiveRevision: true,
				PinnedVersions:    map[string]string{entryID: "1.1.0"},
				PublishedVersions: map[string]string{entryID: "1.1.0"},
			},
			wantState: "COMPATIBLE", wantReason: false,
		},
		{
			name:  "hai vế đo được và lệch nhau",
			scope: programmingstore.LibraryScopeProject,
			facts: programmingstore.LibraryCompatibilityFacts{
				HasActiveRevision: true,
				PinnedVersions:    map[string]string{entryID: "1.0.0"},
				PublishedVersions: map[string]string{entryID: "1.2.0"},
			},
			wantState: "REQUIRES_MIGRATION", wantReason: true,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := libraryCompatibility(testCase.scope, entryID, testCase.facts)
			if got.State != testCase.wantState {
				t.Fatalf("state = %q; want %q", got.State, testCase.wantState)
			}
			if testCase.wantReason && (got.Reason == nil || *got.Reason == "") {
				t.Fatal("state khác COMPATIBLE bắt buộc kèm lý do đọc được")
			}
			if !testCase.wantReason && got.Reason != nil {
				t.Fatalf("COMPATIBLE không được mang lý do: %q", *got.Reason)
			}
		})
	}
}

// `nil` (chưa đo được) KHÔNG được quy về chuỗi rỗng: chuỗi rỗng đọc như một
// version đã đo và bằng rỗng, và một client so `requiredVersion === ''` sẽ nghĩ
// mình đang đọc số liệu.
func TestLibraryCompatibilityKeepsUnmeasuredVersionsNil(t *testing.T) {
	got := libraryCompatibility(programmingstore.LibraryScopeProject, "X",
		programmingstore.LibraryCompatibilityFacts{
			PinnedVersions: map[string]string{}, PublishedVersions: map[string]string{},
		})
	if got.RequiredVersion != nil || got.AvailableVersion != nil {
		t.Fatalf("version chưa đo được phải là nil: required=%v available=%v",
			got.RequiredVersion, got.AvailableVersion)
	}
}

/*
Đường thật: một Project đã Seal (nên library đã PUBLISHED) nhưng CHƯA Commission
lần nào. `availableVersion` đo được, `requiredVersion` thì không — và kết quả
phải là `UNKNOWN`, không phải `COMPATIBLE`.

Đây là ca dễ sai nhất của lát này: khi một vế đã đo được thì rất dễ kết luận
bằng vế còn lại, và kết luận ấy đúng ở đúng những lúc không ai kiểm tra.
*/
func TestSearchLibrariesReportsUnknownUntilARevisionIsCommissioned(t *testing.T) {
	library, projects, created := openLibraryServices(t)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}

	entry := upsertCommand(libraryEntryA, "SCALE_LIN", "20000000-0000-4000-8000-000000000901")
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
		"20000000-0000-4000-8000-000000000902",
		op(map[string]any{"op": "upsertObject", "object": map[string]any{
			"objectId": objectID, "kind": "PROGRAM", "name": "AHU_MAIN", "language": "ST",
			"source":       "PROGRAM AHU_MAIN\nVAR_OUTPUT Y : REAL; END_VAR\nY := SCALE_LIN(1.0);\nEND_PROGRAM\n",
			"dependencies": []string{libraryEntryA},
		}}),
		programOp(programID, objectID, 1000))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := projects.SealRevision(ctx, actor, SealRevisionCommand{
		ProjectID: libraryProjectID, SchemaVersion: "1.0",
		BaseRevisionID: created.Resource["draftRevisionId"].(string), Label: "R1",
		IfMatch: saved.ETag, IdempotencyKey: "20000000-0000-4000-8000-000000000903",
		CorrelationID: testCorrelationID,
	}); err != nil {
		t.Fatal(err)
	}

	page, err := library.SearchLibraries(ctx, SearchLibrariesCommand{
		ProjectID: libraryProjectID, Scope: programmingstore.LibraryScopeProject,
	})
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, item := range page.Items {
		if item.EntryID != libraryEntryA {
			continue
		}
		found = true
		if item.Compatibility.State != "UNKNOWN" {
			t.Fatalf("chưa Commission mà state = %q; phải là UNKNOWN", item.Compatibility.State)
		}
		if item.Compatibility.RequiredVersion != nil {
			t.Fatalf("chưa Commission mà đã có requiredVersion = %q", *item.Compatibility.RequiredVersion)
		}
		if item.Compatibility.AvailableVersion == nil || *item.Compatibility.AvailableVersion != "1.0.0" {
			t.Fatalf("availableVersion đo được phải là 1.0.0, nhận %v", item.Compatibility.AvailableVersion)
		}
	}
	if !found {
		t.Fatalf("không thấy entry %s trong %d mục", libraryEntryA, len(page.Items))
	}
}

// Entry SYSTEM luôn `UNKNOWN` ở lát này và LUÔN có `compatibility` trên dây:
// một trường vắng sẽ được client đọc thành "không sao".
func TestSearchLibrariesAlwaysCarriesCompatibilityForSystemEntries(t *testing.T) {
	library, _, _ := openLibraryServices(t)
	page, err := library.SearchLibraries(context.Background(), SearchLibrariesCommand{
		Scope: programmingstore.LibraryScopeSystem, Limit: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) == 0 {
		t.Fatal("registry SYSTEM rỗng — fixture hỏng, không phải kết quả hợp lệ")
	}
	for _, item := range page.Items {
		if item.Compatibility.State != "UNKNOWN" {
			t.Fatalf("entry SYSTEM %s có state = %q; phải là UNKNOWN", item.EntryID, item.Compatibility.State)
		}
		if item.Compatibility.Reason == nil {
			t.Fatalf("entry SYSTEM %s thiếu lý do cho UNKNOWN", item.EntryID)
		}
	}
}
