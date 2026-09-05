package application

import (
	"context"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
`T61-404` / `ISS-PGM04-13` — đường ĐỌC mã nguồn của một entry Thư viện.

Triệu chứng: `SearchLibraryEntries` không mang `source`, nên Inspector không có
Preview và wizard Sửa bắt đầu từ ô mã nguồn TRỐNG — trong khi upsert là phép ghi
đè toàn phần. Người dùng phải tự dán lại toàn bộ mã của một khối họ không đọc
được.

Nguyên nhân gốc: hợp đồng đọc chỉ có một đường DANH SÁCH, và một danh sách không
phải chỗ để trả 64 KiB mã nguồn cho mỗi mục. Thiếu đường đọc theo TỪNG entry nên
không có chỗ nào để đặt `source`.

Cách sửa: một đường đọc riêng, nhận định danh CHÍNH XÁC `libraryRevisionId +
entryId`. Không có "bản mới nhất" ngầm: đọc mã nguồn của sai revision là đọc sai
thứ thiết bị đang chạy, và đó là lỗi im lặng nhất trong cả màn hình này.
*/

// LibraryEntrySourceAvailability — vì sao KHÔNG có mã nguồn, khi không có.
//
// Ba giá trị, và không có giá trị nào nghĩa là "chưa biết": mỗi nhánh nói ra một
// nguyên nhân người vận hành xử lý được. Gộp chúng vào một chuỗi lỗi chung sẽ
// làm "entry SYSTEM vốn không lưu mã" trông giống "dữ liệu của bạn hỏng".
const (
	// Đọc được, và băm tính lại khớp băm đã lưu.
	LibrarySourceAvailable = "AVAILABLE"
	/* Registry SYSTEM mô tả CHỮ KÝ, không mang phần hiện thực: `domain` ép
	   `SourceBlob` của entry SYSTEM phải rỗng. Đây không phải sự cố. */
	LibrarySourceNotStored = "NOT_STORED"
	/* Băm tính lại KHÁC băm đã lưu. Fail-closed: không trả `source`, và tuyệt
	   đối không lùi về một revision khác — một bản "gần đúng" đọc như bản thật. */
	LibrarySourceHashMismatch = "HASH_MISMATCH"
)

// LibraryEntrySourceView là hình chiếu public của một lần đọc mã nguồn.
//
// `Source` là con trỏ chứ không phải chuỗi: `nil` nghĩa là KHÔNG CÓ mã nguồn để
// đọc, còn chuỗi rỗng sẽ đọc như "khối này có mã nguồn, và nó rỗng" — hai câu
// khác hẳn nhau, và câu thứ hai là câu dẫn tới một lần ghi đè mất mã.
type LibraryEntrySourceView struct {
	Scope             string
	LibraryRevisionID string
	LibraryVersion    string
	LibraryState      string
	EntryID           string
	Name              string
	Kind              string
	Language          string
	ContentSHA256     string
	Availability      string
	Source            *string
	InterfaceJSON     []byte
	// Reason chỉ khác rỗng khi `Availability` khác `AVAILABLE`.
	Reason string
}

type LibraryEntrySourceCommand struct {
	LibraryRevisionID string
	EntryID           string
}

const (
	librarySourceReasonSystem   = "Entry SYSTEM thuộc registry chữ ký; phần hiện thực nằm trong firmware và không được lưu như mã nguồn"
	librarySourceReasonMismatch = "Băm nội dung tính lại không khớp băm đã lưu của revision này"
)

/*
EntrySource đọc mã nguồn theo ĐÚNG một cặp (revision, entry).

Ba điều được ép ở đây, và cả ba đều là điều kiện để câu trả lời có nghĩa:

 1. Định danh revision là BẮT BUỘC. Không có nhánh "lấy bản mới nhất": một
    Preview lặng lẽ hiển thị bản mới nhất khi người dùng mở một bản cũ là cách
    họ đọc sai thứ thiết bị đang chạy mà không có dấu hiệu nào.
 2. Băm được TÍNH LẠI từ chính dữ liệu vừa đọc và so với băm đã lưu. Lệch thì
    KHÔNG trả mã nguồn.
 3. Entry SYSTEM trả `NOT_STORED` kèm lý do ổn định, không trả lỗi: registry
    không lưu mã nguồn là thiết kế, không phải sự cố.
*/
func (s *LibraryService) EntrySource(ctx context.Context, command LibraryEntrySourceCommand) (LibraryEntrySourceView, error) {
	if !validText(command.LibraryRevisionID, 1, 200) || !validText(command.EntryID, 1, 200) {
		return LibraryEntrySourceView{}, ErrInvalidRequest
	}
	revision, err := s.store.GetLibraryRevision(ctx, command.LibraryRevisionID)
	if err != nil {
		return LibraryEntrySourceView{}, err
	}
	entry, err := s.store.GetLibraryEntry(ctx, command.LibraryRevisionID, command.EntryID)
	if err != nil {
		return LibraryEntrySourceView{}, err
	}

	view := LibraryEntrySourceView{
		Scope: revision.Scope, LibraryRevisionID: revision.LibraryRevisionID,
		LibraryVersion: revision.Version, LibraryState: revision.State,
		EntryID: entry.EntryID, Name: entry.Name, Kind: entry.Kind, Language: entry.Language,
		ContentSHA256: hex.EncodeToString(entry.ContentSHA256[:]),
	}
	if len(entry.InterfaceJSON) > 0 {
		view.InterfaceJSON = append([]byte(nil), entry.InterfaceJSON...)
	}
	view.Availability, view.Reason, view.Source = libraryEntrySourceAvailability(entry)
	return view, nil
}

/*
libraryEntrySourceAvailability là TOÀN BỘ quyết định "có trả mã nguồn không",
tách thành hàm thuần để kiểm được ở đúng nơi nó sống.

Nhánh `HASH_MISMATCH` là hàng rào phòng vệ theo chiều sâu, không phải nhánh của
đường ghi thường: trigger SQLite của `library_entries` đã ép `content_sha256`
khớp nội dung ở mọi lần `INSERT`/`UPDATE`, nên một hàng lệch băm KHÔNG dựng được
qua đường ghi. Nó vẫn tới được đây bằng đường khác — phục hồi từ backup, một lần
migrate hỏng, một tệp SQLite bị sửa ngoài ứng dụng — và đúng lúc ấy, trả về mã
nguồn của một hàng đã hỏng là để người dùng đọc một thứ KHÔNG phải thứ thiết bị
sẽ chạy, không có dấu hiệu nào.
*/
func libraryEntrySourceAvailability(entry programmingstore.LibraryEntry) (string, string, *string) {
	if len(entry.Source) == 0 {
		return LibrarySourceNotStored, librarySourceReasonSystem, nil
	}
	digest, err := programmingstore.LibraryEntryContentSHA256(entry)
	/* Băm tính lại HỎNG cũng là không khớp. Bỏ qua lỗi ở đây rồi trả mã nguồn là
	   đúng cái nhánh mà phép so này sinh ra để chặn. */
	if err != nil || subtle.ConstantTimeCompare(digest[:], entry.ContentSHA256[:]) != 1 {
		return LibrarySourceHashMismatch, librarySourceReasonMismatch, nil
	}
	source := string(entry.Source)
	return LibrarySourceAvailable, "", &source
}

// LibraryEntrySourceInterface phân giải `interface` thành JSON hợp lệ, hoặc
// `nil` khi nó không phải một object. KHÔNG sửa chữa dữ liệu: một `interface`
// hỏng phải VẮNG MẶT chứ không được thay bằng `{}` — một object rỗng đọc như
// "khối này không có cổng nào".
func LibraryEntrySourceInterface(raw []byte) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	var document map[string]json.RawMessage
	if json.Unmarshal(raw, &document) != nil {
		return nil
	}
	return json.RawMessage(append([]byte(nil), raw...))
}
