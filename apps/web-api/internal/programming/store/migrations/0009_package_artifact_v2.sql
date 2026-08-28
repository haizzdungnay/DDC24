-- T59-302: artifact có thể là container package v2, không chỉ artifact v1.
--
-- `schema_version = 1` được viết cứng từ v1 khi mỗi Revision chỉ có MỘT Program.
-- Từ khi Check biên dịch cả package (T59-301/302), thứ Commission stage sang Core
-- là container `MKDDCIR2`. Giữ nguyên CHECK cũ sẽ chặn đúng thứ Check vừa dựng
-- được — và chặn ở lớp DB nên lỗi hiện ra rất xa nguyên nhân.
--
-- Rebuild giữ NGUYÊN hình dạng mà migration v3 đã chốt: KHÔNG có UNIQUE trên
-- content hash (v3 bỏ nó có chủ ý — hai Check có byte deterministic giống nhau
-- là chuyện bình thường), và giữ lại index + hai trigger bất biến.
DROP TRIGGER artifacts_no_update;
DROP TRIGGER artifacts_no_delete;
DROP INDEX artifacts_content_idx;
ALTER TABLE artifacts RENAME TO artifacts_v8_single_program;

CREATE TABLE artifacts (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    check_id TEXT NOT NULL UNIQUE REFERENCES checks(check_id) ON DELETE RESTRICT,
    -- 1 = artifact một Program; 2 = container package nhiều Program (DDD §5.3).
    schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
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

INSERT INTO artifacts SELECT * FROM artifacts_v8_single_program;
DROP TABLE artifacts_v8_single_program;

CREATE INDEX artifacts_content_idx ON artifacts(sha256, profile, target_abi);
CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable artifacts');
END;
CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts BEGIN
    SELECT RAISE(ABORT, 'immutable artifacts');
END;

PRAGMA user_version = 9;
