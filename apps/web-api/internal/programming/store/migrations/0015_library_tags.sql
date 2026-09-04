-- `T61-101` / `LOCK-PGM04-CONTRACT-001` §2.1: thẻ (`tags`) của Control Library
-- entry.
--
-- Cùng họ với `category`/`description` của migration `0014`: nằm NGOÀI phép tính
-- `content_sha256`, và nằm TRONG `presentation_sha256`. Lý do y nguyên — danh
-- tính THỰC THI không được đổi vì một lần gắn thẻ, nếu không mọi artifact và pin
-- đã ký thành lỗi thời chỉ vì ai đó phân loại lại thư viện.
--
-- Lưu dạng JSON array đã CHUẨN HOÁ (`libraryNormalizeTags` bên Go): mỗi phần tử
-- đã trim, hạ về chữ thường, khử trùng lặp và sắp tăng dần. Chuẩn hoá phải xảy
-- ra TRƯỚC khi băm, nếu không `["VAV","vav "]` và `["vav"]` — hai payload cùng
-- nghĩa — sinh ra hai `presentation_sha256` khác nhau, và client dùng hash ấy để
-- biết "mô tả có đổi không" sẽ thấy đổi trong khi không có gì đổi.
--
-- `NULL` = "chưa ai gắn thẻ". KHÔNG có ngữ nghĩa thứ ba cho mảng rỗng: khác
-- `description` (nơi chuỗi rỗng là một mô tả đã viết và cố ý để trống), một tập
-- thẻ rỗng và "chưa gắn thẻ" là cùng một câu, nên đường ghi quy `[]` về `NULL`.
ALTER TABLE library_entries ADD COLUMN tags TEXT;

-- Ràng buộc bằng trigger vì SQLite không cho thêm CHECK qua ALTER TABLE. Trần
-- khớp hợp đồng §2.1 (≤8 phần tử, mỗi phần tử ≤24 ký tự). Vượt trần là lỗi GHI,
-- không phải cắt bớt im lặng: cắt bớt làm read-back trả về thứ khác thứ client
-- vừa gửi, và người dùng không có cách nào biết thẻ của mình đã bị xén.
--
-- Trigger là hàng rào CUỐI, không phải hàng rào duy nhất: lớp application từ
-- chối trước với `ErrInvalidRequest` (400) để client nhận lỗi ổn định thay vì
-- một chuỗi lỗi SQLite. Giữ cả hai vì chúng canh hai đường khác nhau — trigger
-- còn canh cả đường import bundle, nơi dữ liệu không đi qua handler HTTP.
CREATE TRIGGER library_entries_tags_bounds_insert
BEFORE INSERT ON library_entries
BEGIN
    SELECT RAISE(ABORT, 'library entry tags không hợp lệ')
    WHERE NEW.tags IS NOT NULL AND (
        json_valid(NEW.tags) = 0
        OR json_type(NEW.tags) <> 'array'
        OR json_array_length(NEW.tags) > 8
        OR EXISTS (
            SELECT 1 FROM json_each(NEW.tags)
            WHERE json_each.type <> 'text'
               OR length(json_each.value) < 1
               OR length(json_each.value) > 24)
    );
END;

CREATE TRIGGER library_entries_tags_bounds_update
BEFORE UPDATE ON library_entries
BEGIN
    SELECT RAISE(ABORT, 'library entry tags không hợp lệ')
    WHERE NEW.tags IS NOT NULL AND (
        json_valid(NEW.tags) = 0
        OR json_type(NEW.tags) <> 'array'
        OR json_array_length(NEW.tags) > 8
        OR EXISTS (
            SELECT 1 FROM json_each(NEW.tags)
            WHERE json_each.type <> 'text'
               OR length(json_each.value) < 1
               OR length(json_each.value) > 24)
    );
END;

PRAGMA user_version = 15;
