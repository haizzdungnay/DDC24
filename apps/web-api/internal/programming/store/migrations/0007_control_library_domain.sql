-- T59-201: Control Library PROJECT versioned, immutable và có reference guard.
--
-- SYSTEM Library KHÔNG được seed vào SQLite. Nó là snapshot chỉ đọc sinh từ
-- `pou_library_registry_v1.json` cùng compiler/firmware profile. Cách tách này
-- tránh tạo một đường đặc quyền để ghi thêm entry SYSTEM sau khi DB đã mở.
-- SQLite chỉ sở hữu PROJECT Library và usage của immutable Project Revision.

-- v6 mới chỉ tạo schema, chưa có producer. Một row v6 không mang source,
-- interface hay layout nên không thể nâng cấp trung thực; dừng trước ALTER để
-- operator phục hồi/điều tra từ backup thay vì mở DB rồi hỏng muộn ở lần đọc.
CREATE TABLE programming_v7_library_preflight (
    legacy_entry_count INTEGER NOT NULL CHECK (legacy_entry_count = 0)
) STRICT;
INSERT INTO programming_v7_library_preflight
SELECT count(*) FROM library_entries;
DROP TABLE programming_v7_library_preflight;

-- ---------------------------------------------------------------------------
-- 1. Nội dung source/layout canonical của PROJECT entry.
--
-- Các cột nullable để migration v6->v7 không bịa dữ liệu cho hàng cũ. Store chỉ
-- cho publish PROJECT revision khi FUNCTION/CONVERSION có state size 0
-- authoritative và FUNCTION_BLOCK có version/hash layout authoritative.
-- ---------------------------------------------------------------------------
ALTER TABLE library_entries ADD COLUMN language TEXT
    CHECK (language IS NULL OR language IN ('ST','FBD'));
ALTER TABLE library_entries ADD COLUMN source_blob BLOB
    CHECK (source_blob IS NULL OR length(source_blob) BETWEEN 1 AND 65536);
ALTER TABLE library_entries ADD COLUMN interface_json BLOB
    CHECK (interface_json IS NULL OR
        (length(interface_json) BETWEEN 2 AND 262144
         AND json_valid(CAST(interface_json AS TEXT))));
ALTER TABLE library_entries ADD COLUMN dependencies_json BLOB NOT NULL DEFAULT x'5B5D'
    CHECK (length(dependencies_json) BETWEEN 2 AND 65536
        AND json_valid(CAST(dependencies_json AS TEXT))
        AND json_type(CAST(dependencies_json AS TEXT)) = 'array');
ALTER TABLE library_entries ADD COLUMN state_layout_version INTEGER
    CHECK (state_layout_version IS NULL OR state_layout_version BETWEEN 1 AND 4294967295);
ALTER TABLE library_entries ADD COLUMN state_size_bytes INTEGER
    CHECK (state_size_bytes IS NULL OR state_size_bytes BETWEEN 0 AND 1048576);
ALTER TABLE library_entries ADD COLUMN state_layout_sha256 BLOB
    CHECK (
        (kind IN ('FUNCTION','CONVERSION')
         AND state_layout_version IS NULL AND state_size_bytes = 0
         AND state_layout_sha256 IS NULL)
        OR
        (kind = 'FUNCTION_BLOCK'
         AND state_layout_version IS NULL AND state_size_bytes IS NULL
         AND state_layout_sha256 IS NULL)
        OR
        (kind = 'FUNCTION_BLOCK'
         AND state_layout_version IS NOT NULL AND state_size_bytes IS NOT NULL
         AND length(state_layout_sha256) = 32)
    );

-- Usage này chỉ chuẩn hóa dependency tới PROJECT Library. SYSTEM usage được
-- phân giải từ registry/profile lock, không tạo FK giả tới một row DB không có.
CREATE TABLE library_usages (
    revision_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    library_revision_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    required_version TEXT NOT NULL CHECK (length(required_version) BETWEEN 1 AND 64),
    usage_kind TEXT NOT NULL CHECK (usage_kind IN ('CALL','INSTANCE')),
    PRIMARY KEY(revision_id, object_id, library_revision_id, entry_id, usage_kind),
    FOREIGN KEY(revision_id, object_id)
        REFERENCES pou_objects(revision_id, object_id) ON DELETE RESTRICT,
    FOREIGN KEY(library_revision_id, entry_id)
        REFERENCES library_entries(library_revision_id, entry_id) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;
CREATE INDEX library_usages_entry_idx
    ON library_usages(library_revision_id, entry_id, revision_id, object_id);

-- ---------------------------------------------------------------------------
-- 2. Khóa lifecycle ở chính DB, không chỉ ở service.
-- ---------------------------------------------------------------------------
DROP TRIGGER library_revisions_published_immutable;
DROP TRIGGER library_revisions_published_no_delete;

-- SYSTEM là virtual; direct SQL không được tạo một bản SYSTEM song song.
CREATE TRIGGER library_revisions_no_system_insert
BEFORE INSERT ON library_revisions
WHEN NEW.scope = 'SYSTEM'
BEGIN
    SELECT RAISE(ABORT, 'SYSTEM library is virtual and read-only');
END;

CREATE TRIGGER library_revisions_no_system_update
BEFORE UPDATE ON library_revisions
WHEN OLD.scope = 'SYSTEM' OR NEW.scope = 'SYSTEM'
BEGIN
    SELECT RAISE(ABORT, 'SYSTEM library is virtual and read-only');
END;

-- Parent của version mới phải là snapshot PROJECT đã publish thuộc cùng Project.
CREATE TRIGGER library_revisions_parent_guard
BEFORE INSERT ON library_revisions
WHEN NEW.parent_library_revision_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'invalid parent library revision')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_revisions parent
        WHERE parent.library_revision_id = NEW.parent_library_revision_id
          AND parent.scope = 'PROJECT'
          AND parent.project_id = NEW.project_id
          AND parent.state IN ('PUBLISHED','DEPRECATED')
    );
END;

-- Identity/version/owner không đổi tại chỗ. DRAFT chỉ ở DRAFT hoặc publish;
-- PUBLISHED chỉ được đánh DEPRECATED mà không đổi manifest; DEPRECATED terminal.
CREATE TRIGGER library_revisions_lifecycle_guard
BEFORE UPDATE ON library_revisions
BEGIN
    SELECT RAISE(ABORT, 'immutable library revision identity')
    WHERE NEW.library_revision_id <> OLD.library_revision_id
       OR NEW.scope <> OLD.scope
       OR NEW.project_id IS NOT OLD.project_id
       OR NEW.version <> OLD.version
       OR NEW.parent_library_revision_id IS NOT OLD.parent_library_revision_id
       OR NEW.created_by <> OLD.created_by
       OR NEW.created_at_utc_ms <> OLD.created_at_utc_ms;

    SELECT RAISE(ABORT, 'invalid library revision transition')
    WHERE (OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','PUBLISHED'))
       OR (OLD.state = 'PUBLISHED' AND NEW.state <> 'DEPRECATED')
       OR OLD.state = 'DEPRECATED';

    SELECT RAISE(ABORT, 'immutable published library manifest')
    WHERE OLD.state = 'PUBLISHED'
      AND (NEW.manifest_sha256 <> OLD.manifest_sha256
           OR NEW.manifest_json <> OLD.manifest_json);
END;

CREATE TRIGGER library_revisions_no_delete_immutable
BEFORE DELETE ON library_revisions
WHEN OLD.state <> 'DRAFT' OR OLD.scope = 'SYSTEM'
BEGIN
    SELECT RAISE(ABORT, 'immutable library revision');
END;

-- Entry chỉ được tạo/sửa/xóa trong PROJECT DRAFT. Chuyển entry sang revision
-- khác bằng UPDATE bị chặn; clone version phải là INSERT có transaction riêng.
CREATE TRIGGER library_entries_insert_guard
BEFORE INSERT ON library_entries
BEGIN
    SELECT RAISE(ABORT, 'library entry parent is not mutable PROJECT DRAFT')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_revisions parent
        WHERE parent.library_revision_id = NEW.library_revision_id
          AND parent.scope = 'PROJECT' AND parent.state = 'DRAFT'
    );
    SELECT RAISE(ABORT, 'invalid PROJECT library entry')
    WHERE NEW.kind NOT IN ('FUNCTION','FUNCTION_BLOCK')
       OR NEW.language NOT IN ('ST','FBD')
       OR NEW.source_blob IS NULL OR NEW.interface_json IS NULL
       OR NOT json_valid(CAST(NEW.interface_json AS TEXT))
       OR NOT json_valid(CAST(NEW.dependencies_json AS TEXT))
       OR json_type(CAST(NEW.dependencies_json AS TEXT)) <> 'array'
       OR (NEW.language = 'FBD' AND NOT json_valid(CAST(NEW.source_blob AS TEXT)));
END;

CREATE TRIGGER library_entries_update_guard
BEFORE UPDATE ON library_entries
BEGIN
    SELECT RAISE(ABORT, 'library entry cannot move revision')
    WHERE NEW.library_revision_id <> OLD.library_revision_id;
    SELECT RAISE(ABORT, 'immutable library entry')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_revisions parent
        WHERE parent.library_revision_id = OLD.library_revision_id
          AND parent.scope = 'PROJECT' AND parent.state = 'DRAFT'
    );
    SELECT RAISE(ABORT, 'invalid PROJECT library entry')
    WHERE NEW.kind NOT IN ('FUNCTION','FUNCTION_BLOCK')
       OR NEW.language NOT IN ('ST','FBD')
       OR NEW.source_blob IS NULL OR NEW.interface_json IS NULL
       OR NOT json_valid(CAST(NEW.interface_json AS TEXT))
       OR NOT json_valid(CAST(NEW.dependencies_json AS TEXT))
       OR json_type(CAST(NEW.dependencies_json AS TEXT)) <> 'array'
       OR (NEW.language = 'FBD' AND NOT json_valid(CAST(NEW.source_blob AS TEXT)));
END;

CREATE TRIGGER library_entries_delete_guard
BEFORE DELETE ON library_entries
BEGIN
    SELECT RAISE(ABORT, 'immutable library entry')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_revisions parent
        WHERE parent.library_revision_id = OLD.library_revision_id
          AND parent.scope = 'PROJECT' AND parent.state = 'DRAFT'
    );
END;

-- Direct SQL cũng không được đổi state trước khi mọi entry mang dữ liệu/layout
-- tối thiểu. Store còn dựng và đối chiếu manifest/hash canonical trong cùng
-- transaction; trigger này là backstop schema, không tự nhận mình là compiler.
CREATE TRIGGER library_revisions_publish_guard
BEFORE UPDATE OF state ON library_revisions
WHEN OLD.state = 'DRAFT' AND NEW.state = 'PUBLISHED'
BEGIN
    SELECT RAISE(ABORT, 'PROJECT library entry is not publishable')
    WHERE EXISTS (
        SELECT 1 FROM library_entries entry
        WHERE entry.library_revision_id = OLD.library_revision_id
          AND (
              entry.kind NOT IN ('FUNCTION','FUNCTION_BLOCK')
              OR entry.language NOT IN ('ST','FBD')
              OR entry.source_blob IS NULL OR entry.interface_json IS NULL
              OR NOT json_valid(CAST(entry.interface_json AS TEXT))
              OR NOT json_valid(CAST(entry.dependencies_json AS TEXT))
              OR json_type(CAST(entry.dependencies_json AS TEXT)) <> 'array'
              OR (entry.kind = 'FUNCTION' AND
                  (entry.state_layout_version IS NOT NULL
                   OR entry.state_size_bytes <> 0
                   OR entry.state_layout_sha256 IS NOT NULL))
              OR (entry.kind = 'FUNCTION_BLOCK' AND
                  (entry.state_layout_version IS NULL
                   OR entry.state_size_bytes IS NULL
                   OR length(entry.state_layout_sha256) <> 32))
          )
    );
END;

-- Revision chỉ được pin một PROJECT Library đã publish. FK giữ revision; trigger
-- này giữ đúng lifecycle/scope thay vì chỉ kiểm row có tồn tại.
CREATE TRIGGER revisions_library_pin_insert_guard
BEFORE INSERT ON revisions
WHEN NEW.library_revision_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'revision library pin is not published PROJECT library')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_revisions library
        WHERE library.library_revision_id = NEW.library_revision_id
          AND library.scope = 'PROJECT'
          AND library.state IN ('PUBLISHED','DEPRECATED')
          AND library.project_id = NEW.project_id
    );
END;

CREATE TRIGGER revisions_library_pin_update_guard
BEFORE UPDATE OF library_revision_id ON revisions
WHEN NEW.library_revision_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'revision library pin is not published PROJECT library')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_revisions library
        WHERE library.library_revision_id = NEW.library_revision_id
          AND library.scope = 'PROJECT'
          AND library.state IN ('PUBLISHED','DEPRECATED')
          AND library.project_id = NEW.project_id
    );
END;

-- Usage được tạo cùng immutable Revision và phải khớp đúng pin/version.
CREATE TRIGGER library_usages_insert_guard
BEFORE INSERT ON library_usages
BEGIN
    SELECT RAISE(ABORT, 'library usage does not match revision lock')
    WHERE NOT EXISTS (
        SELECT 1
        FROM revisions revision
        JOIN library_revisions library
          ON library.library_revision_id = revision.library_revision_id
        WHERE revision.revision_id = NEW.revision_id
          AND revision.library_revision_id = NEW.library_revision_id
          AND library.version = NEW.required_version
          AND library.state IN ('PUBLISHED','DEPRECATED')
    );
END;

CREATE TRIGGER library_usages_no_update BEFORE UPDATE ON library_usages BEGIN
    SELECT RAISE(ABORT, 'immutable library usage');
END;
CREATE TRIGGER library_usages_no_delete BEFORE DELETE ON library_usages BEGIN
    SELECT RAISE(ABORT, 'immutable library usage');
END;

PRAGMA user_version = 7;
