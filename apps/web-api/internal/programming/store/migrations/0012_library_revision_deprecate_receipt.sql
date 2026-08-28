-- F-P59-UI-001: biên nhận idempotency cho chuyển trạng thái PROJECT Library
-- revision từ PUBLISHED sang DEPRECATED.
--
-- `mutation_receipts.action` là enum đóng. Thêm action lifecycle mới phải qua
-- migration để một handler không thể tự ghi một loại receipt ngoài contract.
DROP TRIGGER mutation_receipts_no_update;
ALTER TABLE mutation_receipts RENAME TO mutation_receipts_v11;

CREATE TABLE mutation_receipts (
    actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
    action TEXT NOT NULL CHECK (action IN ('PROJECT_CREATE','DRAFT_SAVE','REVISION_CREATE',
        'BUNDLE_EXPORT','BUNDLE_IMPORT','LIBRARY_ENTRY_UPSERT','LIBRARY_ENTRY_DELETE',
        'PROGRAM_ENABLE','PROGRAM_DISABLE','LIBRARY_REVISION_DEPRECATE')),
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
FROM mutation_receipts_v11;
DROP TABLE mutation_receipts_v11;

CREATE TRIGGER mutation_receipts_no_update BEFORE UPDATE ON mutation_receipts BEGIN
    SELECT RAISE(ABORT, 'immutable mutation_receipts');
END;

PRAGMA user_version = 12;
