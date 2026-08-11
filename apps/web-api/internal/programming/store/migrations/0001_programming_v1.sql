-- Programming SQLite schema v1. Áp dụng nguyên khối trong BEGIN IMMEDIATE.
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 128),
    checksum BLOB NOT NULL CHECK (length(checksum) = 32),
    applied_at_utc_ms INTEGER NOT NULL CHECK (applied_at_utc_ms >= 0)
) STRICT;

CREATE TABLE projects (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2048),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 128),
    updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 128),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    updated_at_utc_ms INTEGER NOT NULL CHECK (updated_at_utc_ms >= created_at_utc_ms)
) STRICT;
CREATE UNIQUE INDEX projects_name_ci_uq ON projects(lower(name));
CREATE INDEX projects_updated_idx ON projects(updated_at_utc_ms DESC);

CREATE TABLE revisions (
    revision_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
    parent_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    target_profile TEXT NOT NULL CHECK (target_profile = 'MKDDC24_REVA'),
    manifest_json BLOB NOT NULL CHECK (length(manifest_json) BETWEEN 2 AND 262144),
    manifest_sha256 BLOB NOT NULL CHECK (length(manifest_sha256) = 32),
    created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 128),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    UNIQUE(project_id, sequence)
) STRICT;
CREATE INDEX revisions_project_created_idx ON revisions(project_id, created_at_utc_ms DESC);

CREATE TABLE drafts (
    draft_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(project_id) ON DELETE RESTRICT,
    base_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    etag INTEGER NOT NULL CHECK (etag >= 1),
    content_json BLOB NOT NULL CHECK (length(content_json) BETWEEN 2 AND 2097152),
    content_sha256 BLOB NOT NULL CHECK (length(content_sha256) = 32),
    updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 128),
    updated_at_utc_ms INTEGER NOT NULL CHECK (updated_at_utc_ms >= 0)
) STRICT;

CREATE TABLE revision_objects (
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    object_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('PROGRAM','FUNCTION','FUNCTION_BLOCK','VARIABLE','BINDING','TASK','METADATA')),
    payload_json BLOB NOT NULL CHECK (length(payload_json) BETWEEN 2 AND 262144),
    payload_sha256 BLOB NOT NULL CHECK (length(payload_sha256) = 32),
    PRIMARY KEY(revision_id, object_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX revision_objects_kind_idx ON revision_objects(revision_id, kind);

CREATE TABLE checks (
    check_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 128),
    state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','PASSED','FAILED','TIMED_OUT')),
    input_sha256 BLOB NOT NULL CHECK (length(input_sha256) = 32),
    profile TEXT NOT NULL CHECK (length(profile) BETWEEN 1 AND 64),
    compiler_version TEXT NOT NULL CHECK (length(compiler_version) BETWEEN 1 AND 64),
    started_at_utc_ms INTEGER CHECK (started_at_utc_ms IS NULL OR started_at_utc_ms >= 0),
    completed_at_utc_ms INTEGER CHECK (completed_at_utc_ms IS NULL OR completed_at_utc_ms >= coalesce(started_at_utc_ms, 0)),
    result_json BLOB CHECK (result_json IS NULL OR length(result_json) BETWEEN 2 AND 1048576),
    result_sha256 BLOB CHECK (result_sha256 IS NULL OR length(result_sha256) = 32),
    CHECK ((state IN ('QUEUED','RUNNING') AND completed_at_utc_ms IS NULL) OR
           (state IN ('PASSED','FAILED','TIMED_OUT') AND completed_at_utc_ms IS NOT NULL AND result_json IS NOT NULL AND result_sha256 IS NOT NULL))
) STRICT;
CREATE INDEX checks_revision_idx ON checks(revision_id, state);

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
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    UNIQUE(sha256, profile, target_abi)
) STRICT;

CREATE TABLE operations (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('COMMISSION','RESTORE','IMPORT','RESET_RETAIN')),
    state TEXT NOT NULL CHECK (state IN ('PENDING','VALIDATING','STAGING','ACTIVATING','VERIFYING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')),
    step TEXT NOT NULL CHECK (length(step) BETWEEN 1 AND 64),
    controller_id TEXT NOT NULL CHECK (length(controller_id) BETWEEN 1 AND 128),
    requested_revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    expected_active_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    idempotency_key_sha256 BLOB NOT NULL CHECK (length(idempotency_key_sha256) = 32),
    request_sha256 BLOB NOT NULL CHECK (length(request_sha256) = 32),
    correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 16 AND 64),
    actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
    result_code TEXT,
    detail_code TEXT,
    keeps_running_revision INTEGER CHECK (keeps_running_revision IS NULL OR keeps_running_revision IN (0, 1)),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    updated_at_utc_ms INTEGER NOT NULL CHECK (updated_at_utc_ms >= created_at_utc_ms),
    UNIQUE(actor_id, kind, controller_id, idempotency_key_sha256)
) STRICT;
CREATE UNIQUE INDEX operations_controller_active_uq ON operations(controller_id)
    WHERE state IN ('PENDING','VALIDATING','STAGING','ACTIVATING','VERIFYING','UNKNOWN');
CREATE INDEX operations_state_idx ON operations(state, updated_at_utc_ms);

CREATE TABLE commission_records (
    operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id) ON DELETE RESTRICT,
    previous_revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    new_revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    artifact_sha256 BLOB NOT NULL CHECK (length(artifact_sha256) = 32),
    runtime_readback_json BLOB NOT NULL CHECK (length(runtime_readback_json) BETWEEN 2 AND 65536),
    impact_json BLOB NOT NULL CHECK (length(impact_json) BETWEEN 2 AND 65536),
    override_inventory_sha256 BLOB NOT NULL CHECK (length(override_inventory_sha256) = 32),
    result TEXT NOT NULL CHECK (length(result) BETWEEN 1 AND 64),
    closed_at_utc_ms INTEGER NOT NULL CHECK (closed_at_utc_ms >= 0)
) STRICT;

CREATE TABLE audit_records (
    audit_id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL UNIQUE CHECK (sequence >= 1),
    actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
    role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 32),
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
    target_type TEXT NOT NULL CHECK (length(target_type) BETWEEN 1 AND 64),
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 128),
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    operation_id TEXT REFERENCES operations(operation_id) ON DELETE RESTRICT,
    occurred_at_utc_ms INTEGER NOT NULL CHECK (occurred_at_utc_ms >= 0),
    result_code TEXT NOT NULL CHECK (length(result_code) BETWEEN 1 AND 64),
    correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 16 AND 64),
    details_json BLOB NOT NULL CHECK (length(details_json) BETWEEN 2 AND 16384),
    prev_hash BLOB NOT NULL CHECK (length(prev_hash) = 32),
    record_hash BLOB NOT NULL UNIQUE CHECK (length(record_hash) = 32)
) STRICT;
CREATE INDEX audit_revision_idx ON audit_records(revision_id, sequence);
CREATE INDEX audit_operation_idx ON audit_records(operation_id, sequence);

CREATE TRIGGER revisions_no_update BEFORE UPDATE ON revisions BEGIN
    SELECT RAISE(ABORT, 'immutable revisions');
END;
CREATE TRIGGER schema_migrations_no_update BEFORE UPDATE ON schema_migrations BEGIN
    SELECT RAISE(ABORT, 'immutable schema_migrations');
END;
CREATE TRIGGER schema_migrations_no_delete BEFORE DELETE ON schema_migrations BEGIN
    SELECT RAISE(ABORT, 'immutable schema_migrations');
END;
CREATE TRIGGER revisions_no_delete BEFORE DELETE ON revisions BEGIN
    SELECT RAISE(ABORT, 'immutable revisions');
END;
CREATE TRIGGER revision_objects_no_update BEFORE UPDATE ON revision_objects BEGIN
    SELECT RAISE(ABORT, 'immutable revision_objects');
END;
CREATE TRIGGER revision_objects_no_delete BEFORE DELETE ON revision_objects BEGIN
    SELECT RAISE(ABORT, 'immutable revision_objects');
END;
CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable artifacts');
END;
CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable artifacts');
END;
CREATE TRIGGER commission_records_no_update BEFORE UPDATE ON commission_records BEGIN
    SELECT RAISE(ABORT, 'immutable commission_records');
END;
CREATE TRIGGER commission_records_no_delete BEFORE DELETE ON commission_records BEGIN
    SELECT RAISE(ABORT, 'immutable commission_records');
END;
CREATE TRIGGER audit_records_no_update BEFORE UPDATE ON audit_records BEGIN
    SELECT RAISE(ABORT, 'immutable audit_records');
END;
CREATE TRIGGER audit_records_no_delete BEFORE DELETE ON audit_records BEGIN
    SELECT RAISE(ABORT, 'immutable audit_records');
END;
CREATE TRIGGER checks_identity_immutable BEFORE UPDATE ON checks
WHEN OLD.revision_id IS NOT NEW.revision_id OR OLD.target_id IS NOT NEW.target_id OR
     OLD.input_sha256 IS NOT NEW.input_sha256 OR OLD.profile IS NOT NEW.profile OR
     OLD.compiler_version IS NOT NEW.compiler_version OR OLD.state IN ('PASSED','FAILED','TIMED_OUT')
BEGIN SELECT RAISE(ABORT, 'immutable check identity or terminal state'); END;
CREATE TRIGGER operations_identity_immutable BEFORE UPDATE ON operations
WHEN OLD.kind IS NOT NEW.kind OR OLD.controller_id IS NOT NEW.controller_id OR
     OLD.requested_revision_id IS NOT NEW.requested_revision_id OR
     OLD.expected_active_revision_id IS NOT NEW.expected_active_revision_id OR
     OLD.idempotency_key_sha256 IS NOT NEW.idempotency_key_sha256 OR
     OLD.request_sha256 IS NOT NEW.request_sha256 OR OLD.actor_id IS NOT NEW.actor_id OR
     OLD.state IN ('SUCCEEDED','FAILED','CANCELLED')
BEGIN SELECT RAISE(ABORT, 'immutable operation identity or terminal state'); END;
CREATE TRIGGER operations_no_delete BEFORE DELETE ON operations BEGIN
    SELECT RAISE(ABORT, 'immutable operations');
END;
CREATE TRIGGER projects_no_delete BEFORE DELETE ON projects BEGIN
    SELECT RAISE(ABORT, 'projects require soft delete');
END;

PRAGMA user_version = 1;
