package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

/*
`T61-102` / `D61-09` — danh tính THỰC THI tách khỏi phần TRÌNH BÀY.

Đây là bất biến đắt nhất của lát này, và nó không phải chuyện gọn gàng.
`contentSha256` đi vào artifact, vào chữ ký và vào pin của Revision. Nếu sửa một
dòng mô tả hay gắn thêm một cái thẻ mà nó đổi, thì mọi artifact và pin đã ký
thành lỗi thời chỉ vì một lần sửa chính tả — và hậu quả thật không phải "phải
build lại", mà là người ta sẽ thôi không sửa tài liệu nữa.

Bản trước băm TOÀN BỘ entry vào `ContentSHA256Hex`, nên `labelVi`, `labelEn` và
`category` — ba thứ thuần trình bày — nằm trong danh tính thực thi.

Bộ này đo trên registry THẬT đang được sinh, không trên fixture tự dựng: một
fixture chỉ chứng minh test khớp chính nó.
*/

func TestSystemLibraryPresentationIsOutsideExecutableIdentity(t *testing.T) {
	entries, err := SystemLibraryEntries()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("registry SYSTEM rỗng — fixture hỏng, không phải kết quả hợp lệ")
	}

	for _, mutation := range []struct {
		name  string
		field string
		value any
	}{
		{"mô tả", "description", "một mô tả hoàn toàn khác"},
		{"thẻ", "tags", []string{"zzz"}},
		{"nhãn tiếng Việt", "labelVi", "Nhãn khác"},
		{"phân loại", "category", "control"},
	} {
		t.Run(mutation.name, func(t *testing.T) {
			before, after := mutateSignature(t, entries[0].SignatureJSON, mutation.field, mutation.value)
			if before.executable != after.executable {
				t.Fatalf("sửa %s đã đổi danh tính THỰC THI (%s -> %s) — vi phạm D61-09",
					mutation.name, before.executable[:12], after.executable[:12])
			}
			if before.presentation == after.presentation {
				t.Fatalf("sửa %s mà presentation hash không đổi (%s) — hash ấy không canh gì cả",
					mutation.name, before.presentation[:12])
			}
		})
	}

	// Vế ngược lại. Không có nó thì một `splitLibrarySignature` trả về hằng số
	// rỗng cũng làm mọi khẳng định ở trên xanh.
	for _, mutation := range []struct {
		name  string
		field string
		value any
	}{
		{"dispatch", "dispatch", "FUNC_TABLE"},
		{"featureState", "featureState", "REVIEW_REQUIRED"},
		{"polymorphic", "polymorphic", true},
	} {
		t.Run("đổi "+mutation.name+" PHẢI đổi content hash", func(t *testing.T) {
			before, after := mutateSignature(t, entries[0].SignatureJSON, mutation.field, mutation.value)
			if before.executable == after.executable {
				t.Fatalf("đổi %s mà content hash không đổi", mutation.name)
			}
		})
	}
}

// Hai hằng sinh ra phải khớp thứ Go tự tính lại. `SystemLibraryEntries` đã kiểm
// điều này lúc nạp, nhưng test nói ra bằng một câu đọc được: nếu tập field của
// generator (Python) lệch tập field của `splitLibrarySignature` (Go), registry
// bị từ chối chứ không âm thầm công bố một danh tính đã đổi nghĩa.
func TestSystemLibraryHashesAreRecomputedNotTrusted(t *testing.T) {
	for _, definition := range systemLibraryEntryDefinitions {
		executable, presentation, err := splitLibrarySignature([]byte(definition.SignatureJSON))
		if err != nil {
			t.Fatalf("%s: %v", definition.EntryID, err)
		}
		content := sha256.Sum256(executable)
		if !strings.EqualFold(hex.EncodeToString(content[:]), definition.ContentSHA256Hex) {
			t.Fatalf("%s: content hash Go tính lại lệch hằng sinh", definition.EntryID)
		}
		digest := sha256.Sum256(presentation)
		if !strings.EqualFold(hex.EncodeToString(digest[:]), definition.PresentationSHA256Hex) {
			t.Fatalf("%s: presentation hash Go tính lại lệch hằng sinh", definition.EntryID)
		}
	}
}

// Metadata trình bày của registry phải đi TỚI được entry, không dừng ở hằng
// sinh. Đây đúng chỗ `category` từng đứt suốt một work package: registry có dữ
// liệu, hằng Go có dữ liệu, nhưng không endpoint nào trả được nó.
func TestSystemLibraryEntriesCarryPresentationMetadata(t *testing.T) {
	entries, err := SystemLibraryEntries()
	if err != nil {
		t.Fatal(err)
	}
	var described, tagged int
	for _, entry := range entries {
		if entry.Description != "" {
			described++
		}
		if len(entry.Tags) > 0 {
			tagged++
		}
		if len(entry.PresentationSHA256) != sha256.Size {
			t.Fatalf("%s: presentationSha256 phải là 32 byte, nhận %d",
				entry.EntryID, len(entry.PresentationSHA256))
		}
	}
	// Số tuyệt đối: registry hiện khai đủ mô tả và thẻ cho cả 46 entry. Kiểm
	// `> 0` sẽ xanh kể cả khi 45 entry rơi mất metadata.
	if described != len(entries) {
		t.Fatalf("chỉ %d/%d entry có mô tả", described, len(entries))
	}
	if tagged != len(entries) {
		t.Fatalf("chỉ %d/%d entry có thẻ", tagged, len(entries))
	}
}

// Thẻ phải tới ở dạng đã CHUẨN HOÁ. FE không chuẩn hoá lại, nên nếu registry
// lọt một thẻ viết hoa thì nó hiện nguyên như vậy và tách khỏi nhóm của nó.
func TestSystemLibraryTagsArriveCanonical(t *testing.T) {
	entries, err := SystemLibraryEntries()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		previous := ""
		for _, tag := range entry.Tags {
			if tag != strings.ToLower(tag) {
				t.Fatalf("%s: thẻ %q chưa viết thường", entry.EntryID, tag)
			}
			if tag != strings.Join(strings.Fields(tag), " ") {
				t.Fatalf("%s: thẻ %q có khoảng trắng thừa", entry.EntryID, tag)
			}
			if previous != "" && tag <= previous {
				t.Fatalf("%s: thẻ chưa sắp tăng dần (%q sau %q)", entry.EntryID, tag, previous)
			}
			previous = tag
		}
	}
}

type signatureHashes struct {
	executable   string
	presentation string
}

func mutateSignature(t *testing.T, signature []byte, field string, value any) (signatureHashes, signatureHashes) {
	t.Helper()
	hashes := func(raw []byte) signatureHashes {
		executable, presentation, err := splitLibrarySignature(raw)
		if err != nil {
			t.Fatal(err)
		}
		content := sha256.Sum256(executable)
		digest := sha256.Sum256(presentation)
		return signatureHashes{hex.EncodeToString(content[:]), hex.EncodeToString(digest[:])}
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(signature, &document); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	document[field] = encoded
	mutated, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	return hashes(signature), hashes(mutated)
}
