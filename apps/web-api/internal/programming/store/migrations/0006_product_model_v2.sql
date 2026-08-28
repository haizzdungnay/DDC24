-- T59-005: store schema v2 cho Product Programming thống nhất.
--
-- Nguồn: DDD-SW-PROG-UNIFIED-001 §4.1..§4.7. Migration CHỈ tạo chỗ chứa; nó
-- KHÔNG tự Commission, không đổi Active/LKG và không đụng dữ liệu Revision cũ.
-- Mọi bảng mới đều rỗng sau migration, nên rollback về binary v5 vẫn đọc được
-- toàn bộ dữ liệu v1 (binary cũ chỉ bỏ qua bảng nó không biết).

-- ---------------------------------------------------------------------------
-- 1. POU: PROGRAM / FUNCTION / FUNCTION_BLOCK do người dùng định nghĩa (§4.2).
-- ---------------------------------------------------------------------------
CREATE TABLE pou_objects (
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    object_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('PROGRAM','FUNCTION','FUNCTION_BLOCK')),
    -- Name unique case-folded trong Project: lưu sẵn dạng đã fold để UNIQUE
    -- index làm việc được, thay vì dựa vào COLLATE của từng truy vấn.
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
    name_folded TEXT NOT NULL CHECK (length(name_folded) BETWEEN 1 AND 64),
    language TEXT NOT NULL CHECK (language IN ('ST','FBD')),
    interface_json BLOB NOT NULL CHECK (length(interface_json) BETWEEN 2 AND 262144),
    source_blob BLOB NOT NULL CHECK (length(source_blob) BETWEEN 1 AND 65536),
    dependencies_json BLOB NOT NULL CHECK (length(dependencies_json) BETWEEN 2 AND 65536),
    content_sha256 BLOB NOT NULL CHECK (length(content_sha256) = 32),
    PRIMARY KEY(revision_id, object_id)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX pou_objects_name_idx ON pou_objects(revision_id, name_folded);
CREATE INDEX pou_objects_kind_idx ON pou_objects(revision_id, kind);

-- POU thuộc Revision đã đóng băng nên bất biến như revision_objects.
CREATE TRIGGER pou_objects_no_update BEFORE UPDATE ON pou_objects BEGIN
    SELECT RAISE(ABORT, 'immutable pou_objects');
END;
CREATE TRIGGER pou_objects_no_delete BEFORE DELETE ON pou_objects BEGIN
    SELECT RAISE(ABORT, 'immutable pou_objects');
END;

-- ---------------------------------------------------------------------------
-- 2. Control Library: SYSTEM read-only + PROJECT immutable revision (§0, §4.2).
-- ---------------------------------------------------------------------------
CREATE TABLE library_revisions (
    library_revision_id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(project_id) ON DELETE RESTRICT,
    -- scope SYSTEM không thuộc Project nào; PROJECT bắt buộc có project_id.
    scope TEXT NOT NULL CHECK (scope IN ('SYSTEM','PROJECT')),
    version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 64),
    parent_library_revision_id TEXT REFERENCES library_revisions(library_revision_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    state TEXT NOT NULL CHECK (state IN ('DRAFT','PUBLISHED','DEPRECATED')),
    manifest_json BLOB NOT NULL CHECK (length(manifest_json) BETWEEN 2 AND 262144),
    manifest_sha256 BLOB NOT NULL CHECK (length(manifest_sha256) = 32),
    created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 128),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    CHECK ((scope = 'SYSTEM' AND project_id IS NULL)
        OR (scope = 'PROJECT' AND project_id IS NOT NULL)),
    UNIQUE(scope, project_id, version)
) STRICT;
CREATE INDEX library_revisions_scope_idx ON library_revisions(scope, state, created_at_utc_ms DESC);

CREATE TABLE library_entries (
    library_revision_id TEXT NOT NULL REFERENCES library_revisions(library_revision_id)
        ON DELETE RESTRICT,
    entry_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('FUNCTION','FUNCTION_BLOCK','CONVERSION')),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
    name_folded TEXT NOT NULL CHECK (length(name_folded) BETWEEN 1 AND 64),
    -- Khớp `featureState` của pou_library_registry_v1.json: PID phải giữ
    -- REVIEW_REQUIRED cho tới khi có evidence Controls/Safety.
    feature_state TEXT NOT NULL CHECK (feature_state IN ('AVAILABLE','REVIEW_REQUIRED')),
    signature_json BLOB NOT NULL CHECK (length(signature_json) BETWEEN 2 AND 65536),
    content_sha256 BLOB NOT NULL CHECK (length(content_sha256) = 32),
    PRIMARY KEY(library_revision_id, entry_id)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX library_entries_name_idx ON library_entries(library_revision_id, name_folded);

-- Library revision đã PUBLISHED là bất biến; DRAFT vẫn sửa được nên chỉ chặn
-- update/delete trên revision không còn ở trạng thái DRAFT.
CREATE TRIGGER library_revisions_published_immutable BEFORE UPDATE ON library_revisions
BEGIN
    SELECT RAISE(ABORT, 'immutable library_revisions')
    WHERE OLD.state <> 'DRAFT'
       AND (NEW.manifest_sha256 <> OLD.manifest_sha256
            OR NEW.version <> OLD.version
            OR NEW.scope <> OLD.scope);
END;
CREATE TRIGGER library_revisions_published_no_delete BEFORE DELETE ON library_revisions
BEGIN
    SELECT RAISE(ABORT, 'immutable library_revisions') WHERE OLD.state <> 'DRAFT';
END;

-- ---------------------------------------------------------------------------
-- 3. Published Signal definitions (§4.5).
-- ---------------------------------------------------------------------------
CREATE TABLE published_signal_defs (
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    signal_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
    name_folded TEXT NOT NULL CHECK (length(name_folded) BETWEEN 1 AND 64),
    data_type TEXT NOT NULL CHECK (data_type IN ('BOOL','INT','DINT','UINT','REAL','TIME')),
    unit TEXT CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 32),
    producer_program_id TEXT NOT NULL CHECK (length(producer_program_id) BETWEEN 1 AND 64),
    freshness_ms INTEGER NOT NULL CHECK (freshness_ms BETWEEN 1000 AND 90000),
    on_invalid TEXT NOT NULL CHECK (on_invalid IN ('USE_FALLBACK','HOLD_PRIVATE','BLOCK_PROGRAM')),
    fallback_json BLOB CHECK (fallback_json IS NULL OR length(fallback_json) BETWEEN 2 AND 4096),
    -- USE_FALLBACK bắt buộc có giá trị dự phòng typed; ba chính sách còn lại
    -- không được mang fallback để tránh nhầm "im lặng thay bằng 0".
    CHECK ((on_invalid = 'USE_FALLBACK' AND fallback_json IS NOT NULL)
        OR (on_invalid <> 'USE_FALLBACK' AND fallback_json IS NULL)),
    PRIMARY KEY(revision_id, signal_id)
) STRICT, WITHOUT ROWID;
-- Đúng MỘT publisher cho mỗi signal name trong một Revision.
CREATE UNIQUE INDEX published_signal_defs_name_idx
    ON published_signal_defs(revision_id, name_folded);
CREATE INDEX published_signal_defs_producer_idx
    ON published_signal_defs(revision_id, producer_program_id);

CREATE TRIGGER published_signal_defs_no_update BEFORE UPDATE ON published_signal_defs BEGIN
    SELECT RAISE(ABORT, 'immutable published_signal_defs');
END;
CREATE TRIGGER published_signal_defs_no_delete BEFORE DELETE ON published_signal_defs BEGIN
    SELECT RAISE(ABORT, 'immutable published_signal_defs');
END;

-- ---------------------------------------------------------------------------
-- 4. Enable intent per Program (§4.3, §7.2).
--
-- Đây là bảng DUY NHẤT trong migration này KHÔNG bất biến: intent là trạng thái
-- người vận hành đặt và Core đối chiếu. `desired_enabled` mặc định 0 vì Program
-- mới sau Commission luôn Disabled (DDD §0); migration không được bật gì cả.
-- ---------------------------------------------------------------------------
CREATE TABLE program_runtime_intents (
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
    program_id TEXT NOT NULL CHECK (length(program_id) BETWEEN 1 AND 64),
    desired_enabled INTEGER NOT NULL DEFAULT 0 CHECK (desired_enabled IN (0,1)),
    -- Generation tăng mỗi lần đổi intent để read-back của Core so được thứ tự,
    -- không phụ thuộc đồng hồ tường.
    generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
    last_known_runtime_state TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (last_known_runtime_state IN
            ('DISABLED','STARTING','RUNNING','WAITING','STOPPING','FAULTED','UNKNOWN')),
    updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 128),
    updated_at_utc_ms INTEGER NOT NULL CHECK (updated_at_utc_ms >= 0),
    PRIMARY KEY(project_id, program_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX program_runtime_intents_enabled_idx
    ON program_runtime_intents(project_id, desired_enabled);

-- Generation chỉ được tăng, không bao giờ lùi: intent cũ tới muộn không được ghi đè.
CREATE TRIGGER program_runtime_intents_generation_monotonic
BEFORE UPDATE ON program_runtime_intents
BEGIN
    SELECT RAISE(ABORT, 'program_runtime_intents generation must increase')
    WHERE NEW.generation <= OLD.generation;
END;

-- ---------------------------------------------------------------------------
-- 5. Project document v2 trên Revision hiện hữu.
--
-- Dùng ADD COLUMN chứ KHÔNG rebuild bảng `revisions`: bảng này được sáu bảng
-- khác tham chiếu, và `ALTER TABLE ... RENAME` sẽ viết lại các FK đó sang tên
-- tạm. Cột mới có DEFAULT nên hàng cũ giữ nguyên nghĩa, và binary v5 bỏ qua cột
-- nó không biết — rollback an toàn.
-- ---------------------------------------------------------------------------
ALTER TABLE revisions ADD COLUMN document_schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (document_schema_version IN (1,2));
ALTER TABLE revisions ADD COLUMN program_count INTEGER NOT NULL DEFAULT 1
    CHECK (program_count BETWEEN 1 AND 32);
ALTER TABLE revisions ADD COLUMN library_revision_id TEXT
    REFERENCES library_revisions(library_revision_id) ON DELETE RESTRICT;

PRAGMA user_version = 6;
