-- TASK-PROG-204: biên nhận idempotency bền vững cho mutation Project/Draft/Revision.
CREATE TABLE mutation_receipts (
    actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
    action TEXT NOT NULL CHECK (action IN ('PROJECT_CREATE','DRAFT_SAVE','REVISION_CREATE')),
    target_id TEXT NOT NULL CHECK (length(target_id) <= 128),
    idempotency_key_sha256 BLOB NOT NULL CHECK (length(idempotency_key_sha256) = 32),
    request_sha256 BLOB NOT NULL CHECK (length(request_sha256) = 32),
    result_json BLOB NOT NULL CHECK (length(result_json) BETWEEN 2 AND 4096),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    expires_at_utc_ms INTEGER NOT NULL CHECK (expires_at_utc_ms > created_at_utc_ms),
    PRIMARY KEY(actor_id, action, target_id, idempotency_key_sha256)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER mutation_receipts_no_update BEFORE UPDATE ON mutation_receipts BEGIN
    SELECT RAISE(ABORT, 'immutable mutation_receipts');
END;
PRAGMA user_version = 2;
