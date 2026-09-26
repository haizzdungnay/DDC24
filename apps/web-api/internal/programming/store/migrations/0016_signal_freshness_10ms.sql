-- ADR-061 mục 4.5: dải hạn tươi Published Signal thành 10..150000 ms.
--
-- Triệu chứng: với tập chu kỳ mới {10…50000} ms, một signal do Program 10 ms
-- publish không khai được hạn tươi dưới 1000 ms, còn signal của Program
-- 50000 ms không khai được hạn tươi ≥ chu kỳ publisher (tối đa cũ 90000 ms <
-- 2 × 50000 ms). Mọi lớp phía trên (OpenAPI, Draft, Check, IPC) đã nới dải,
-- nhưng CHECK của migration `0006` vẫn ép `BETWEEN 1000 AND 90000` — lớp trên
-- nhận rồi lớp dưới chối.
--
-- Nguyên nhân gốc: CHECK nằm trong DDL của bảng; SQLite không có ALTER ...
-- DROP CONSTRAINT. Migration `0006` đã được ghim sha trong manifest store nên
-- KHÔNG được sửa tại chỗ — sửa nó sẽ làm mọi DB đã migrate báo checksum lệch.
--
-- Cách sửa: rebuild bảng như `0011`. `published_signal_defs` là bảng CON
-- (FK một chiều sang `revisions`), không bảng nào trỏ ngược vào nó, nên
-- rename-copy-drop an toàn. Dữ liệu cũ (1000..90000) nằm trọn trong dải mới.
DROP TRIGGER published_signal_defs_no_update;
DROP TRIGGER published_signal_defs_no_delete;
DROP INDEX published_signal_defs_name_idx;
DROP INDEX published_signal_defs_producer_idx;
ALTER TABLE published_signal_defs RENAME TO published_signal_defs_v15;

CREATE TABLE published_signal_defs (
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    signal_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
    name_folded TEXT NOT NULL CHECK (length(name_folded) BETWEEN 1 AND 64),
    data_type TEXT NOT NULL CHECK (data_type IN ('BOOL','INT','DINT','UINT','REAL','TIME')),
    unit TEXT CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 32),
    producer_program_id TEXT NOT NULL CHECK (length(producer_program_id) BETWEEN 1 AND 64),
    freshness_ms INTEGER NOT NULL CHECK (freshness_ms BETWEEN 10 AND 150000),
    on_invalid TEXT NOT NULL CHECK (on_invalid IN ('USE_FALLBACK','HOLD_PRIVATE','BLOCK_PROGRAM')),
    fallback_json BLOB CHECK (fallback_json IS NULL OR length(fallback_json) BETWEEN 2 AND 4096),
    CHECK ((on_invalid = 'USE_FALLBACK' AND fallback_json IS NOT NULL)
        OR (on_invalid <> 'USE_FALLBACK' AND fallback_json IS NULL)),
    PRIMARY KEY(revision_id, signal_id)
) STRICT, WITHOUT ROWID;

INSERT INTO published_signal_defs
SELECT revision_id,signal_id,name,name_folded,data_type,unit,producer_program_id,
       freshness_ms,on_invalid,fallback_json
FROM published_signal_defs_v15;
DROP TABLE published_signal_defs_v15;

CREATE UNIQUE INDEX published_signal_defs_name_idx
    ON published_signal_defs(revision_id, name_folded);
CREATE INDEX published_signal_defs_producer_idx
    ON published_signal_defs(revision_id, producer_program_id);

-- Khôi phục ĐÚNG hai trigger bất biến. Bỏ sót chúng biến một bảng append-only
-- thành bảng sửa được, và không phép kiểm nào phía Go bắt được điều đó.
CREATE TRIGGER published_signal_defs_no_update BEFORE UPDATE ON published_signal_defs BEGIN
    SELECT RAISE(ABORT, 'immutable published_signal_defs');
END;
CREATE TRIGGER published_signal_defs_no_delete BEFORE DELETE ON published_signal_defs BEGIN
    SELECT RAISE(ABORT, 'immutable published_signal_defs');
END;

PRAGMA user_version = 16;
