-- T59-405: biên nhận idempotency cho intent Enable/Disable Program.
--
-- `mutation_receipts.action` là enum đóng có chủ ý: nó ngăn một action tự chế
-- lọt vào bảng biên nhận rồi "replay" một thứ không ai định nghĩa. Vì vậy thêm
-- action mới bắt buộc phải là migration, không phải sửa hằng ở lớp Go.
--
-- SQLite không có ALTER ... DROP CONSTRAINT, nên phải rebuild bảng — đúng cách
-- migration v4 và v8 đã làm.
DROP TRIGGER mutation_receipts_no_update;
ALTER TABLE mutation_receipts RENAME TO mutation_receipts_v9;

CREATE TABLE mutation_receipts (
    actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
    action TEXT NOT NULL CHECK (action IN ('PROJECT_CREATE','DRAFT_SAVE','REVISION_CREATE',
        'BUNDLE_EXPORT','BUNDLE_IMPORT','LIBRARY_ENTRY_UPSERT','LIBRARY_ENTRY_DELETE',
        'PROGRAM_ENABLE','PROGRAM_DISABLE')),
    target_id TEXT NOT NULL CHECK (length(target_id) <= 128),
    idempotency_key_sha256 BLOB NOT NULL CHECK (length(idempotency_key_sha256) = 32),
    request_sha256 BLOB NOT NULL CHECK (length(request_sha256) = 32),
    result_json BLOB NOT NULL CHECK (length(result_json) BETWEEN 2 AND 4096),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    expires_at_utc_ms INTEGER NOT NULL CHECK (expires_at_utc_ms > created_at_utc_ms),
    PRIMARY KEY(actor_id, action, target_id, idempotency_key_sha256)
) STRICT, WITHOUT ROWID;

INSERT INTO mutation_receipts
SELECT actor_id,action,target_id,idempotency_key_sha256,request_sha256,result_json,created_at_utc_ms,expires_at_utc_ms
FROM mutation_receipts_v9;
DROP TABLE mutation_receipts_v9;

CREATE TRIGGER mutation_receipts_no_update BEFORE UPDATE ON mutation_receipts BEGIN
    SELECT RAISE(ABORT, 'immutable mutation_receipts');
END;

-- ---------------------------------------------------------------------------
-- Trigger `generation` bị SIẾT QUÁ TAY ở v6.
--
-- Triệu chứng: read-back của Core (`last_known_runtime_state`) không ghi được —
-- SQLite trả "generation must increase" cho MỌI UPDATE, kể cả UPDATE không đụng
-- tới `desired_enabled`.
--
-- Nguyên nhân gốc: trigger canh `generation` cho MỌI update, trong khi thứ nó
-- sinh ra để bảo vệ là "intent cũ tới muộn không được ghi đè intent mới". Ghi
-- lại trạng thái quan sát được KHÔNG phải một intent, nên nó không có generation
-- mới để mang — và trigger biến một quan sát thành một lỗi.
--
-- Cách sửa: tách thành hai luật đúng với hai việc khác nhau.
--   1. Đổi `desired_enabled` BẮT BUỘC tăng generation.
--   2. Generation KHÔNG BAO GIỜ lùi, kể cả ở update không đổi intent.
DROP TRIGGER program_runtime_intents_generation_monotonic;

CREATE TRIGGER program_runtime_intents_generation_on_intent_change
BEFORE UPDATE ON program_runtime_intents
BEGIN
    SELECT RAISE(ABORT, 'program_runtime_intents generation must increase')
    WHERE NEW.desired_enabled <> OLD.desired_enabled AND NEW.generation <= OLD.generation;
END;

CREATE TRIGGER program_runtime_intents_generation_never_decreases
BEFORE UPDATE ON program_runtime_intents
BEGIN
    SELECT RAISE(ABORT, 'program_runtime_intents generation must not decrease')
    WHERE NEW.generation < OLD.generation;
END;

-- Enable/Disable là hai action RIÊNG chứ không phải một action `PROGRAM_SET_ENABLED`
-- mang tham số: biên nhận idempotency khoá theo (actor, action, target, key), nên
-- gộp hai chiều vào một action sẽ làm một lần "bật" và một lần "tắt" cùng
-- idempotency key trở thành cùng một ô — và lần thứ hai sẽ replay kết quả của
-- lần thứ nhất thay vì đổi trạng thái.

PRAGMA user_version = 10;
