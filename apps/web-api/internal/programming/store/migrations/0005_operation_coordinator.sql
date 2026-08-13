-- TASK-PROG-403: projection bền vững cho Commission/Restore coordinator.
-- Giữ state enum v1 để rollback binary cũ vẫn đọc được; lớp application ánh
-- xạ PENDING/VALIDATING/ACTIVATING/UNKNOWN sang contract công khai.
ALTER TABLE operations ADD COLUMN operation_context_json BLOB;
ALTER TABLE operations ADD COLUMN operation_context_sha256 BLOB;
ALTER TABLE operations ADD COLUMN previous_active_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE RESTRICT;
ALTER TABLE operations ADD COLUMN actual_active_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE RESTRICT;
ALTER TABLE operations ADD COLUMN core_result_json BLOB;
ALTER TABLE operations ADD COLUMN core_result_sha256 BLOB;
-- Reconcile là read-only và phải tiếp tục được sau outage dài; không đặt trần
-- số lần query khiến Operation bị kẹt vĩnh viễn sau 16 giây mất Core.
ALTER TABLE operations ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);
ALTER TABLE operations ADD COLUMN lease_owner TEXT;
ALTER TABLE operations ADD COLUMN lease_expires_at_utc_ms INTEGER;
ALTER TABLE operations ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0);

CREATE INDEX operations_lease_idx
    ON operations(state, lease_expires_at_utc_ms, updated_at_utc_ms);

-- Lần Commission đầu tiên hợp lệ không có previous Revision. V1 đặt cột này
-- NOT NULL nên không thể ghi CommissionRecord dù Operation đã COMMITTED. Rebuild
-- bảng trong migration v5, giữ nguyên dữ liệu cũ và hai trigger bất biến.
DROP TRIGGER commission_records_no_update;
DROP TRIGGER commission_records_no_delete;
ALTER TABLE commission_records RENAME TO commission_records_v1;
CREATE TABLE commission_records (
    operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id) ON DELETE RESTRICT,
    previous_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    new_revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE RESTRICT,
    artifact_sha256 BLOB NOT NULL CHECK (length(artifact_sha256) = 32),
    runtime_readback_json BLOB NOT NULL CHECK (length(runtime_readback_json) BETWEEN 2 AND 65536),
    impact_json BLOB NOT NULL CHECK (length(impact_json) BETWEEN 2 AND 65536),
    override_inventory_sha256 BLOB NOT NULL CHECK (length(override_inventory_sha256) = 32),
    result TEXT NOT NULL CHECK (length(result) BETWEEN 1 AND 64),
    closed_at_utc_ms INTEGER NOT NULL CHECK (closed_at_utc_ms >= 0)
) STRICT;
INSERT INTO commission_records(operation_id,previous_revision_id,new_revision_id,
    artifact_sha256,runtime_readback_json,impact_json,override_inventory_sha256,
    result,closed_at_utc_ms)
SELECT operation_id,previous_revision_id,new_revision_id,artifact_sha256,
    runtime_readback_json,impact_json,override_inventory_sha256,result,closed_at_utc_ms
FROM commission_records_v1;
DROP TABLE commission_records_v1;
CREATE TRIGGER commission_records_no_update BEFORE UPDATE ON commission_records BEGIN
    SELECT RAISE(ABORT, 'immutable commission_records');
END;
CREATE TRIGGER commission_records_no_delete BEFORE DELETE ON commission_records BEGIN
    SELECT RAISE(ABORT, 'immutable commission_records');
END;

PRAGMA user_version = 5;
