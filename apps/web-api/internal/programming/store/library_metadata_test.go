package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

/*
`T61-103` / `ISS-PGM04-03` — metadata TRÌNH BÀY của PROJECT Library ở lớp lưu trữ.

Bốn thứ được khoá ở đây, và cả bốn đều là loại lỗi im lặng: chúng không làm gì
đổ, chúng chỉ làm dữ liệu nói sai.

 1. Round-trip qua restart — mở lại DB phải đọc ra đúng thứ đã ghi.
 2. Migrate từ DB schema CŨ có dữ liệu thật, không phải DB mới tinh.
 3. PUBLISHED bất biến, và `contentSha256` không đổi vì metadata (`D61-09`).
 4. Client cũ không gửi field mới vẫn ghi được.
*/

// Đo độ dài theo KÝ TỰ, không theo byte — ở CẢ hai hàng rào (Go và trigger
// SQLite). Một mô tả 512 ký tự tiếng Việt chiếm tới 1536 byte; đo bằng byte sẽ
// từ chối nó ở khoảng một phần ba độ dài hợp đồng cho phép, kèm một thông điệp
// nói "vượt 512 ký tự" trong khi người dùng mới gõ 170.
func TestLibraryMetadataLimitsCountRunesNotBytes(t *testing.T) {
	store := openTestStore(t)
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")

	// Số tuyệt đối của hợp đồng §2.1, không đọc lại hằng của sản phẩm.
	description512 := strings.Repeat("ạ", 512)
	description513 := strings.Repeat("ạ", 513)
	category32 := strings.Repeat("ạ", 32)
	category33 := strings.Repeat("ạ", 33)
	tag24 := strings.Repeat("ạ", 24)
	tag25 := strings.Repeat("ạ", 25)

	// `ạ` (U+1EA1) là 3 byte UTF-8, nên 512 ký tự chiếm 1536 byte. Khẳng định
	// này giữ cho test khỏi trở nên vô nghĩa: nếu ai đổi ký tự mẫu sang ASCII
	// thì "đo theo ký tự" và "đo theo byte" cho cùng kết quả, và test thôi phân
	// biệt được hai thứ nó sinh ra để phân biệt.
	if len(description512) != 1536 {
		t.Fatalf("fixture hỏng: 512 ký tự 'ạ' phải là 1536 byte, nhận %d", len(description512))
	}

	for _, testCase := range []struct {
		name   string
		mutate func(*UpsertProjectLibraryEntryParams)
		accept bool
	}{
		{"mô tả 512 ký tự", func(p *UpsertProjectLibraryEntryParams) { p.Description = &description512 }, true},
		{"mô tả 513 ký tự", func(p *UpsertProjectLibraryEntryParams) { p.Description = &description513 }, false},
		{"phân loại 32 ký tự", func(p *UpsertProjectLibraryEntryParams) { p.Category = &category32 }, true},
		{"phân loại 33 ký tự", func(p *UpsertProjectLibraryEntryParams) { p.Category = &category33 }, false},
		{"thẻ 24 ký tự", func(p *UpsertProjectLibraryEntryParams) { p.Tags = []string{tag24} }, true},
		{"thẻ 25 ký tự", func(p *UpsertProjectLibraryEntryParams) { p.Tags = []string{tag25} }, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			params := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
			testCase.mutate(&params)
			_, err := fixture.tryUpsert(params)
			if testCase.accept && err != nil {
				t.Fatalf("phải chấp nhận (đo theo ký tự), nhận: %v", err)
			}
			if !testCase.accept && err == nil {
				t.Fatal("vượt trần mà vẫn ghi được")
			}
		})
	}
}

// Round-trip qua restart. Không phải "đọc lại trong cùng tiến trình" — phải
// đóng store, mở lại, và đọc ra đúng thứ đã ghi.
func TestLibraryMetadataSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "programming-v1.sqlite")
	ctx := context.Background()
	open := func() *Store {
		t.Helper()
		store, err := OpenProgrammingStore(ctx, Options{Path: path, Now: func() time.Time { return fixedNow }})
		if err != nil {
			t.Fatal(err)
		}
		return store
	}

	first := open()
	fixture := newLibraryFixture(t, first)
	createLibraryDraftFixture(t, first, libraryRevisionA, "1.0.0")
	category, description := "math", "Quy đổi tuyến tính từ tín hiệu thô sang đơn vị kỹ thuật"
	params := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	params.Category, params.Description = &category, &description
	params.Tags = []string{"cảm biến", "quy đổi"}
	fixture.upsert(t, params)
	before, err := first.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second := open()
	t.Cleanup(func() { _ = second.Close() })
	after, err := second.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	assertSameMetadata(t, before, after, "restart")
	if after.ContentSHA256 != before.ContentSHA256 {
		t.Fatal("restart đổi contentSha256")
	}

	/*
	   So `before` với `after` là CHƯA ĐỦ, và đây là bẫy đã dính thật khi tiêm
	   lỗi: nếu cột `tags` không hề được ghi thì cả hai lần đọc đều trả về rỗng,
	   `assertSameMetadata` thấy "giống nhau" và xanh — trong khi dữ liệu đã mất
	   ngay từ lần ghi đầu.

	   Nên phải khẳng định GIÁ TRỊ TUYỆT ĐỐI đã ghi, không chỉ khẳng định hai
	   lần đọc bằng nhau.
	*/
	if after.Category == nil || *after.Category != category {
		t.Fatalf("category sau restart = %v; muốn %q", after.Category, category)
	}
	if after.Description == nil || *after.Description != description {
		t.Fatalf("description sau restart = %v; muốn %q", after.Description, description)
	}
	if strings.Join(after.Tags, "|") != "cảm biến|quy đổi" {
		t.Fatalf("tags sau restart = %v; muốn [cảm biến quy đổi]", after.Tags)
	}
	if len(after.PresentationSHA256) != sha256.Size {
		t.Fatalf("presentationSha256 sau restart phải là 32 byte, nhận %d", len(after.PresentationSHA256))
	}
}

/*
Migrate từ DB schema CŨ có dữ liệu thật — không phải DB mới tinh.

DB được dựng đầy đủ ở schema hiện tại qua ĐÚNG đường API, rồi hạ cấp nhân tạo
về `v14` (bỏ cột `tags` và hai trigger của `0015`). Cách này cho một baseline
`v14` mang dữ liệu do chính sản phẩm ghi ra, thay vì một hàng chèn tay mà chưa
đường nào của sản phẩm từng tạo.

Sau khi migrate: `category`/`description` còn nguyên, `tags` là NULL (cột mới,
"chưa ai gắn thẻ" — không phải mảng rỗng), và `contentSha256` KHÔNG đổi.
*/
func TestLibraryMetadataMigratesFromOlderSchemaWithData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "programming-v1.sqlite")
	ctx := context.Background()
	open := func() (*Store, error) {
		return OpenProgrammingStore(ctx, Options{Path: path, Now: func() time.Time { return fixedNow }})
	}

	store, err := open()
	if err != nil {
		t.Fatal(err)
	}
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	category, description := "math", "Quy đổi tuyến tính"
	params := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	params.Category, params.Description = &category, &description
	fixture.upsert(t, params)
	before, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	raw := openRawSQLite(t, path)
	for _, statement := range []string{
		// Trigger bất biến của `schema_migrations` phải gỡ trước — nó tồn tại
		// đúng để chặn việc này, nên phải gỡ có chủ đích trong test chứ không
		// phải "tình cờ làm được".
		`DROP TRIGGER schema_migrations_no_delete`,
		`DROP TRIGGER library_entries_tags_bounds_insert`,
		`DROP TRIGGER library_entries_tags_bounds_update`,
		`ALTER TABLE library_entries DROP COLUMN tags`,
		`DELETE FROM schema_migrations WHERE version=15`,
		`PRAGMA user_version=14`,
	} {
		if _, err := raw.ExecContext(ctx, statement); err != nil {
			t.Fatalf("hạ cấp về v14 [%s]: %v", statement, err)
		}
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	migrated, err := open()
	if err != nil {
		t.Fatalf("migrate v14 -> v15 trên DB CÓ DỮ LIỆU: %v", err)
	}
	t.Cleanup(func() { _ = migrated.Close() })
	after, err := migrated.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatalf("đọc lại sau migrate: %v", err)
	}
	if after.Category == nil || *after.Category != category {
		t.Fatalf("migrate làm mất category: %v", after.Category)
	}
	if after.Description == nil || *after.Description != description {
		t.Fatalf("migrate làm mất description: %v", after.Description)
	}
	if after.Tags != nil {
		t.Fatalf("cột mới phải là NULL sau migrate, nhận %v", after.Tags)
	}
	if after.ContentSHA256 != before.ContentSHA256 {
		t.Fatal("migrate đổi contentSha256 — thêm cột trình bày không được đụng danh tính thực thi")
	}
	// Ghi được sau migrate: cột mới dùng được ngay, không cần thao tác tay.
	//
	// Identity dựng thủ công thay vì `newLibraryFixture`: helper ấy sinh
	// `AuditID` từ một bộ đếm reset theo fixture, nên fixture thứ hai trên cùng
	// một DB sẽ đụng UNIQUE của `audit_records`.
	draft := ensureProjectFixture(t, migrated)
	key, request := mutationIdentity("migrate-then-tag")
	tagged := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	tagged.Category, tagged.Description = &category, &description
	tagged.Tags = []string{"cảm biến"}
	tagged.Identity = LibraryMutationIdentity{
		ProjectID: projectID, ExpectedDraftETag: draft.ETag, ActorID: actorID, Role: role,
		AuditID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", CorrelationID: correlationID,
		At: fixedNow.Add(time.Hour), IdempotencyKeySHA256: key, RequestSHA256: request,
	}
	if _, err := migrated.UpsertProjectLibraryEntry(ctx, tagged); err != nil {
		t.Fatalf("ghi thẻ sau migrate: %v", err)
	}
	retagged, err := migrated.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(retagged.Tags, "|") != "cảm biến" {
		t.Fatalf("thẻ ghi sau migrate đọc lại sai: %v", retagged.Tags)
	}
}

/*
`presentationSha256` đọc ra phải TÁI TẠO ĐƯỢC từ chính ba trường trình bày.

Đây là lỗ đã đo được và lát này sửa. Công thức đổi một lần: trước `T61-101` nó
băm `{category, description}`, từ `T61-101` băm `{category, description, tags}`.
Nếu đường đọc tin cột `presentation_sha256` thì mọi hàng ghi trước `T61-101` trả
một hash KHÔNG phép tính nào hiện tại tái tạo được — và hash ấy tồn tại đúng để
client biết "phần trình bày có đổi không", nên client sẽ thấy mọi entry cũ "đã
đổi" ở lần đọc đầu tiên sau nâng cấp rồi thôi tin vào nó.

Test dựng đúng tình huống ấy: ghi cột bằng công thức CŨ rồi đọc lại.
*/
func TestPresentationHashIsRecomputedNotTrustedFromColumn(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	category, description := "math", "Quy đổi tuyến tính"
	params := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	params.Category, params.Description = &category, &description
	fixture.upsert(t, params)

	// Công thức CŨ (trước `T61-101`): không có khoá `tags`.
	legacyPayload, err := json.Marshal(map[string]any{"category": &category, "description": &description})
	if err != nil {
		t.Fatal(err)
	}
	legacy := sha256.Sum256(legacyPayload)
	expected := libraryPresentationDigest(&category, &description, nil)
	if string(legacy[:]) == string(expected) {
		t.Fatal("fixture hỏng: hai công thức phải KHÁC nhau, nếu không test này không đo gì")
	}
	if _, err := store.db.ExecContext(ctx,
		`UPDATE library_entries SET presentation_sha256=? WHERE library_revision_id=? AND entry_id=?`,
		legacy[:], libraryRevisionA, entryScaleID); err != nil {
		t.Fatal(err)
	}

	entry, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	if string(entry.PresentationSHA256) != string(expected) {
		t.Fatalf("đường đọc tin cột thay vì tính lại: cột cũ=%x, đọc ra=%x, phải là=%x",
			legacy[:8], entry.PresentationSHA256[:8], expected[:8])
	}
}

// Sửa metadata KHÔNG được đổi `contentSha256` (`D61-09`), và PHẢI đổi
// `presentationSha256` — nếu không hash ấy không nói lên điều gì.
func TestMetadataEditKeepsContentHashAndMovesPresentationHash(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")

	plain := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	fixture.upsert(t, plain)
	bare, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}

	category, description := "math", "Quy đổi tuyến tính"
	described := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	described.Category, described.Description = &category, &description
	described.Tags = []string{"quy đổi"}
	fixture.upsert(t, described)
	withMetadata, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}

	if withMetadata.ContentSHA256 != bare.ContentSHA256 {
		t.Fatalf("thêm metadata đã đổi contentSha256 (%x -> %x) — mọi artifact và pin đã ký thành lỗi thời (D61-09)",
			bare.ContentSHA256[:4], withMetadata.ContentSHA256[:4])
	}
	if len(bare.PresentationSHA256) != 0 {
		t.Fatalf("entry chưa có metadata mà đã có presentationSha256: %x", bare.PresentationSHA256)
	}
	if len(withMetadata.PresentationSHA256) == 0 {
		t.Fatal("có metadata mà không có presentationSha256")
	}

	// Đổi RIÊNG thẻ: content giữ nguyên, presentation phải đổi.
	retagged := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	retagged.Category, retagged.Description = &category, &description
	retagged.Tags = []string{"cảm biến", "quy đổi"}
	fixture.upsert(t, retagged)
	changed, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	if changed.ContentSHA256 != withMetadata.ContentSHA256 {
		t.Fatal("đổi thẻ đã đổi contentSha256")
	}
	if string(changed.PresentationSHA256) == string(withMetadata.PresentationSHA256) {
		t.Fatal("đổi thẻ mà presentationSha256 không đổi")
	}
}

// Publish không được làm rơi metadata. Đường publish dựng lại entry canonical;
// bỏ trống ba trường trình bày ở đó là một quả mìn — nó chưa nổ chỉ vì câu
// UPDATE hiện không ghi ba cột ấy.
func TestPublishKeepsPresentationMetadataAndContentHash(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")
	category, description := "math", "Quy đổi tuyến tính"
	scale := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	scale.Category, scale.Description = &category, &description
	scale.Tags = []string{"cảm biến", "quy đổi"}
	fixture.upsert(t, scale)
	fixture.upsert(t, functionBlockEntry(libraryRevisionA, entryFilterID, "FILTER_T1", authoritativeFBLayout(16)))

	before, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PublishProjectLibrary(ctx, libraryRevisionA); err != nil {
		t.Fatal(err)
	}
	after, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	assertSameMetadata(t, before, after, "publish")
	if after.ContentSHA256 != before.ContentSHA256 {
		t.Fatal("publish đổi contentSha256")
	}

	// PUBLISHED là bất biến: không đường nào sửa metadata của nó nữa.
	retagged := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	retagged.Category, retagged.Description = &category, &description
	retagged.Tags = []string{"đã sửa"}
	if _, err := fixture.tryUpsert(retagged); err == nil {
		t.Fatal("sửa metadata trên revision đã PUBLISHED không bị chặn")
	}
}

// Client cũ không gửi field mới vẫn ghi được — đó là ý nghĩa của "additive".
// Không có test này thì một trần bắt buộc lọt vào đường ghi sẽ chỉ lộ ra khi
// một bản FE cũ gặp máy chủ mới ngoài hiện trường.
func TestLegacyClientWithoutNewFieldsStillWrites(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	fixture := newLibraryFixture(t, store)
	createLibraryDraftFixture(t, store, libraryRevisionA, "1.0.0")

	legacy := functionEntry(libraryRevisionA, entryScaleID, "SCALE_LIN")
	legacy.Category, legacy.Description, legacy.Tags = nil, nil, nil
	if _, err := fixture.tryUpsert(legacy); err != nil {
		t.Fatalf("payload không mang field mới phải ghi được: %v", err)
	}
	entry, err := store.GetLibraryEntry(ctx, libraryRevisionA, entryScaleID)
	if err != nil {
		t.Fatal(err)
	}
	// Vắng phải ở lại là VẮNG. Quy về chuỗi rỗng hay mảng rỗng làm mọi entry
	// chưa phân loại trông như đã phân loại vào một nhóm tên rỗng.
	if entry.Category != nil || entry.Description != nil || entry.Tags != nil {
		t.Fatalf("field vắng bị quy về giá trị rỗng: category=%v description=%v tags=%v",
			entry.Category, entry.Description, entry.Tags)
	}
	if len(entry.PresentationSHA256) != 0 {
		t.Fatalf("không có metadata nào mà vẫn sinh presentationSha256: %x", entry.PresentationSHA256)
	}
}

func assertSameMetadata(t *testing.T, before, after LibraryEntry, stage string) {
	t.Helper()
	same := func(left, right *string) bool {
		if left == nil || right == nil {
			return left == nil && right == nil
		}
		return *left == *right
	}
	if !same(before.Category, after.Category) {
		t.Fatalf("%s đổi category: %v -> %v", stage, before.Category, after.Category)
	}
	if !same(before.Description, after.Description) {
		t.Fatalf("%s đổi description: %v -> %v", stage, before.Description, after.Description)
	}
	if strings.Join(before.Tags, "|") != strings.Join(after.Tags, "|") {
		t.Fatalf("%s đổi tags: %v -> %v", stage, before.Tags, after.Tags)
	}
	if string(before.PresentationSHA256) != string(after.PresentationSHA256) {
		t.Fatalf("%s đổi presentationSha256", stage)
	}
}
