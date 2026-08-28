-- `T61-103` / `LOCK-PGM04-CONTRACT-001` §2: metadata TRÌNH BÀY cho PROJECT
-- Library entry.
--
-- Ba cột này cố ý nằm NGOÀI phép tính `content_sha256`. `content_sha256` là
-- danh tính THỰC THI: nó đi vào artifact, vào chữ ký, và vào pin của Revision.
-- Nếu sửa một dòng mô tả cũng đổi nó thì mọi artifact và pin đã ký thành lỗi
-- thời chỉ vì một lần sửa chính tả — và hậu quả thật không phải "phải build
-- lại", mà là người ta sẽ thôi không sửa tài liệu nữa.
--
-- `presentation_sha256` băm riêng bộ ba trình bày, để client biết phần mô tả có
-- đổi hay không mà không phải so từng trường.
--
-- Cả ba đều NULL-able: entry đã tồn tại trước lát này không có metadata, và
-- NULL ở đây nghĩa là "chưa ai điền", KHÁC hẳn chuỗi rỗng nghĩa là "đã điền
-- rỗng có chủ đích". PGM-04 render NULL thành `—`, không render thành ô trống.
--
-- SYSTEM entry KHÔNG dùng bảng này: `category` của chúng sinh từ
-- `pou_library_registry_v1.json` (`T61-102`), và registry là read-only.
ALTER TABLE library_entries ADD COLUMN category TEXT;
ALTER TABLE library_entries ADD COLUMN description TEXT;
ALTER TABLE library_entries ADD COLUMN presentation_sha256 BLOB;

-- Ràng buộc bằng trigger vì SQLite không cho thêm CHECK qua ALTER TABLE.
-- Trần độ dài khớp hợp đồng §2.1; vượt trần là lỗi ghi, không phải cắt bớt im
-- lặng — cắt bớt sẽ làm read-back khác thứ client vừa gửi.
CREATE TRIGGER library_entries_presentation_bounds_insert
BEFORE INSERT ON library_entries
BEGIN
    SELECT RAISE(ABORT, 'library entry category quá dài')
    WHERE NEW.category IS NOT NULL AND length(NEW.category) > 32;
    SELECT RAISE(ABORT, 'library entry description quá dài')
    WHERE NEW.description IS NOT NULL AND length(NEW.description) > 512;
    SELECT RAISE(ABORT, 'presentation_sha256 phải là 32 byte')
    WHERE NEW.presentation_sha256 IS NOT NULL AND length(NEW.presentation_sha256) <> 32;
END;

CREATE TRIGGER library_entries_presentation_bounds_update
BEFORE UPDATE ON library_entries
BEGIN
    SELECT RAISE(ABORT, 'library entry category quá dài')
    WHERE NEW.category IS NOT NULL AND length(NEW.category) > 32;
    SELECT RAISE(ABORT, 'library entry description quá dài')
    WHERE NEW.description IS NOT NULL AND length(NEW.description) > 512;
    SELECT RAISE(ABORT, 'presentation_sha256 phải là 32 byte')
    WHERE NEW.presentation_sha256 IS NOT NULL AND length(NEW.presentation_sha256) <> 32;
END;

-- Lọc theo category phải đi qua index: thư viện một Project có thể lên tới
-- hàng trăm entry và PGM-04 lọc ở mỗi lần gõ.
CREATE INDEX library_entries_category_idx
    ON library_entries(library_revision_id, category);

PRAGMA user_version = 14;
