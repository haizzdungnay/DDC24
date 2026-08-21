-- T59-502: `SIGNAL` vào danh sách kind hợp lệ của `revision_objects`.
--
-- Triệu chứng: `SealRevision` từ chối MỌI Revision có Published Signal với
-- "CHECK constraint failed: kind IN (...)".
--
-- Nguyên nhân gốc: `revisionPayload` (draft.go) sinh object kind `SIGNAL` từ
-- collection `signals` của document v2, nhưng danh sách kind ở migration v1
-- được viết trước khi Published Signal tồn tại và chưa bao giờ được mở rộng.
-- Hệ quả: TOÀN BỘ lane signal — validate ở Check (`T59-304`), đóng gói vào
-- container (`T59-404`), bus ở runtime — không bao giờ chạm tới một Revision
-- thật. Không test nào bắt được vì chưa test nào seal một Revision có signal.
--
-- SQLite không có ALTER ... DROP CONSTRAINT nên phải rebuild bảng. `revisions`
-- tham chiếu tới đây bằng FK một chiều (revision_objects -> revisions), nên
-- rebuild bảng CON là an toàn: không bảng nào trỏ ngược vào nó.
DROP TRIGGER revision_objects_no_update;
DROP TRIGGER revision_objects_no_delete;
DROP INDEX revision_objects_kind_idx;
ALTER TABLE revision_objects RENAME TO revision_objects_v10;

CREATE TABLE revision_objects (
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    object_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN
        ('PROGRAM','FUNCTION','FUNCTION_BLOCK','VARIABLE','BINDING','TASK','METADATA','SIGNAL')),
    payload_json BLOB NOT NULL CHECK (length(payload_json) BETWEEN 2 AND 262144),
    payload_sha256 BLOB NOT NULL CHECK (length(payload_sha256) = 32),
    PRIMARY KEY(revision_id, object_id)
) STRICT, WITHOUT ROWID;

INSERT INTO revision_objects
SELECT revision_id,object_id,kind,payload_json,payload_sha256 FROM revision_objects_v10;
DROP TABLE revision_objects_v10;

CREATE INDEX revision_objects_kind_idx ON revision_objects(revision_id, kind);

-- Khôi phục ĐÚNG hai trigger bất biến. Bỏ sót chúng ở đây sẽ biến một bảng
-- append-only thành một bảng sửa được, và không phép kiểm nào phía Go bắt được
-- điều đó — bất biến này thuộc về schema.
CREATE TRIGGER revision_objects_no_update BEFORE UPDATE ON revision_objects BEGIN
    SELECT RAISE(ABORT, 'immutable revision_objects');
END;
CREATE TRIGGER revision_objects_no_delete BEFORE DELETE ON revision_objects BEGIN
    SELECT RAISE(ABORT, 'immutable revision_objects');
END;

PRAGMA user_version = 11;
