-- T59-814 / ADR-053: metadata reconciliation của phiên Simulation.
--
-- Bảng này CỐ Ý nghèo nàn. Nó không lưu process image, không lưu virtual RETAIN,
-- không lưu source plaintext và không lưu artifact — tất cả những thứ đó sống và
-- chết cùng tiến trình worker. Thứ duy nhất cần bền là đủ để trả lời một câu
-- hỏi sau khi `mkddc-web` khởi động lại: "phiên này còn hợp lệ không, và nếu
-- không thì phải dọn cái gì".
--
-- `DDD-SW-PGM02-WORKSPACE-001` §4.7 dự kiến ordinal `0013` cho migration
-- read-back của R1 và `0014` cho R3. Head thực tế lúc viết lát này là `0012` —
-- migration R1 đó chưa bao giờ được tạo. Theo đúng quy tắc trong cùng §4.7
-- ("đọc lại migration head; nếu ordinal đã bị chiếm thì dùng ordinal trống kế
-- tiếp"), R3 lấy `0013` và DDD được cập nhật cùng change-set này thay vì để lại
-- một khoảng trống ordinal mà lần sau không ai giải thích được.

CREATE TABLE simulation_sessions (
    session_id TEXT PRIMARY KEY,
    controller_id TEXT NOT NULL CHECK (length(controller_id) BETWEEN 1 AND 128),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
    source_draft_revision_id TEXT NOT NULL CHECK (length(source_draft_revision_id) BETWEEN 1 AND 64),
    -- Hash của Saved Draft đã dùng để seal. Giữ ở đây để một phiên không bao giờ
    -- được nối lại với một Draft đã đi tiếp: đó chính là cách một người vận hành
    -- tin rằng mình đang mô phỏng thứ mình vừa sửa.
    source_content_sha256 BLOB NOT NULL CHECK (length(source_content_sha256) = 32),
    snapshot_id TEXT CHECK (snapshot_id IS NULL OR length(snapshot_id) BETWEEN 1 AND 64),
    artifact_sha256 BLOB CHECK (artifact_sha256 IS NULL OR length(artifact_sha256) = 32),
    state TEXT NOT NULL CHECK (state IN
        ('PREPARING','PAUSED','RUNNING','COMPLETED','FAILED','EXPIRED','STOPPED')),
    session_sequence INTEGER NOT NULL CHECK (session_sequence >= 0),
    base_tick_ms INTEGER CHECK (base_tick_ms IS NULL OR base_tick_ms >= 1),
    virtual_time_ms INTEGER NOT NULL CHECK (virtual_time_ms >= 0),
    speed INTEGER NOT NULL CHECK (speed IN (1,10,60)),
    observation_sequence INTEGER NOT NULL CHECK (observation_sequence >= 0),
    reset_epoch INTEGER NOT NULL CHECK (reset_epoch >= 0),
    created_at_utc_ms INTEGER NOT NULL CHECK (created_at_utc_ms >= 0),
    last_activity_at_utc_ms INTEGER NOT NULL CHECK (last_activity_at_utc_ms >= 0),
    idle_expires_at_utc_ms INTEGER NOT NULL CHECK (idle_expires_at_utc_ms > 0),
    hard_expires_at_utc_ms INTEGER NOT NULL CHECK (hard_expires_at_utc_ms > 0),
    failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 64),
    created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 128),
    worker_version TEXT CHECK (worker_version IS NULL OR length(worker_version) BETWEEN 1 AND 32)
) STRICT;

-- "Một phiên trên mỗi controller" là BẤT BIẾN CỦA DỮ LIỆU, không phải một phép
-- kiểm trong lớp Go. Hai request create đến cùng lúc sẽ bị chính SQLite từ chối
-- một cái; nếu chỉ kiểm ở Go thì cửa sổ giữa "đếm" và "ghi" đủ rộng để sinh ra
-- hai worker cùng sống — đúng thứ quota tồn tại để chặn.
CREATE UNIQUE INDEX simulation_sessions_live_controller_idx
    ON simulation_sessions(controller_id)
    WHERE state IN ('PREPARING','PAUSED','RUNNING');

CREATE INDEX simulation_sessions_project_idx ON simulation_sessions(project_id, created_at_utc_ms);
CREATE INDEX simulation_sessions_expiry_idx ON simulation_sessions(state, hard_expires_at_utc_ms);

-- Trạng thái terminal là terminal. Không có đường nào đưa một phiên đã
-- STOPPED/FAILED/EXPIRED/COMPLETED quay lại chạy: `sessionId` không được tái
-- sinh, vì client cũ vẫn có thể đang giữ ETag của phiên đó.
CREATE TRIGGER simulation_sessions_terminal_is_final BEFORE UPDATE ON simulation_sessions
WHEN OLD.state IN ('COMPLETED','FAILED','EXPIRED','STOPPED')
 AND NEW.state NOT IN ('COMPLETED','FAILED','EXPIRED','STOPPED')
BEGIN
    SELECT RAISE(ABORT, 'simulation session terminal is final');
END;

-- Sequence chỉ tăng. Một sequence đi lùi làm mọi `If-Match` của client trở nên
-- vô nghĩa mà không có dấu hiệu nào ở phía họ.
CREATE TRIGGER simulation_sessions_sequence_monotonic BEFORE UPDATE ON simulation_sessions
WHEN NEW.session_sequence < OLD.session_sequence
BEGIN
    SELECT RAISE(ABORT, 'simulation session sequence must not regress');
END;

-- `mutation_receipts.action` là enum đóng có chủ ý: nó ngăn một handler tự chế
-- ghi một loại receipt ngoài contract. Thêm bốn action của R3 vì vậy phải là
-- migration, không phải sửa hằng ở lớp Go.
DROP TRIGGER mutation_receipts_no_update;
ALTER TABLE mutation_receipts RENAME TO mutation_receipts_v12;

CREATE TABLE mutation_receipts (
    actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
    action TEXT NOT NULL CHECK (action IN ('PROJECT_CREATE','DRAFT_SAVE','REVISION_CREATE',
        'BUNDLE_EXPORT','BUNDLE_IMPORT','LIBRARY_ENTRY_UPSERT','LIBRARY_ENTRY_DELETE',
        'PROGRAM_ENABLE','PROGRAM_DISABLE','LIBRARY_REVISION_DEPRECATE',
        'SIMULATION_CREATE','SIMULATION_ACTION','SIMULATION_SET_INPUT','SIMULATION_STOP')),
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
FROM mutation_receipts_v12;
DROP TABLE mutation_receipts_v12;

CREATE TRIGGER mutation_receipts_no_update BEFORE UPDATE ON mutation_receipts BEGIN
    SELECT RAISE(ABORT, 'immutable mutation_receipts');
END;

PRAGMA user_version = 13;
