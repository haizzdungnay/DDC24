-- TASK-PROG-205: lease/idempotency bền vững cho compiler Check worker.
ALTER TABLE checks ADD COLUMN created_at_utc_ms INTEGER NOT NULL DEFAULT 0 CHECK (created_at_utc_ms >= 0);
ALTER TABLE checks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2);
ALTER TABLE checks ADD COLUMN lease_owner TEXT CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128);
ALTER TABLE checks ADD COLUMN lease_expires_at_utc_ms INTEGER CHECK (lease_expires_at_utc_ms IS NULL OR lease_expires_at_utc_ms >= 0);

CREATE INDEX checks_worker_queue_idx ON checks(state, lease_expires_at_utc_ms, created_at_utc_ms, check_id);
CREATE TRIGGER checks_state_transition BEFORE UPDATE ON checks
WHEN NOT (
    (OLD.state='QUEUED' AND NEW.state='RUNNING') OR
    (OLD.state='RUNNING' AND NEW.state='RUNNING') OR
    (OLD.state='RUNNING' AND NEW.state IN ('PASSED','FAILED','TIMED_OUT'))
)
BEGIN SELECT RAISE(ABORT, 'invalid check state transition'); END;
CREATE TRIGGER checks_lease_shape BEFORE UPDATE ON checks
WHEN (NEW.state='RUNNING' AND (NEW.lease_owner IS NULL OR NEW.lease_expires_at_utc_ms IS NULL)) OR
     (NEW.state IN ('PASSED','FAILED','TIMED_OUT') AND (NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at_utc_ms IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'invalid check lease shape'); END;

CREATE TABLE check_requests (
    actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 128),
    idempotency_key_sha256 BLOB NOT NULL CHECK (length(idempotency_key_sha256) = 32),
    request_sha256 BLOB NOT NULL CHECK (length(request_sha256) = 32),
    check_id TEXT NOT NULL UNIQUE REFERENCES checks(check_id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 32),
    correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 16 AND 64),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    expires_at_utc_ms INTEGER NOT NULL CHECK (expires_at_utc_ms > created_at_utc_ms),
    PRIMARY KEY(actor_id, revision_id, target_id, idempotency_key_sha256)
) STRICT, WITHOUT ROWID;
CREATE INDEX check_requests_expiry_idx ON check_requests(expires_at_utc_ms);

CREATE TRIGGER check_requests_identity_immutable BEFORE UPDATE ON check_requests
BEGIN SELECT RAISE(ABORT, 'immutable check request identity'); END;

-- Schema v1 vô tình đặt unique trên content hash mặc dù mỗi Check có một row
-- Artifact riêng. Hai Revision/Check có byte deterministic giống nhau vì thế
-- va chạm. Bỏ unique hash; content-addressed file vẫn được dedup và kiểm hash.
DROP TRIGGER artifacts_no_update;
DROP TRIGGER artifacts_no_delete;
ALTER TABLE artifacts RENAME TO artifacts_v2_unique_hash;
CREATE TABLE artifacts (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    check_id TEXT NOT NULL UNIQUE REFERENCES checks(check_id) ON DELETE RESTRICT,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    profile TEXT NOT NULL CHECK (length(profile) BETWEEN 1 AND 64),
    target_abi INTEGER NOT NULL CHECK (target_abi >= 1),
    compiler_version TEXT NOT NULL CHECK (length(compiler_version) BETWEEN 1 AND 64),
    library_version TEXT NOT NULL CHECK (length(library_version) BETWEEN 1 AND 64),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576),
    sha256 BLOB NOT NULL CHECK (length(sha256) = 32),
    relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 512),
    integrity_mode TEXT NOT NULL CHECK (integrity_mode IN ('HASH_ONLY','SIGNED')),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0)
) STRICT;
INSERT INTO artifacts SELECT * FROM artifacts_v2_unique_hash;
DROP TABLE artifacts_v2_unique_hash;
CREATE INDEX artifacts_content_idx ON artifacts(sha256, profile, target_abi);
CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable artifacts');
END;
CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable artifacts');
END;

PRAGMA user_version = 3;
