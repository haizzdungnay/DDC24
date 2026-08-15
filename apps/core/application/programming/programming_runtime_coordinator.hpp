#ifndef CORE_APPLICATION_PROGRAMMING_PROGRAMMING_RUNTIME_COORDINATOR_HPP
#define CORE_APPLICATION_PROGRAMMING_PROGRAMMING_RUNTIME_COORDINATOR_HPP

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#include "programming/programming_cutover.hpp"
#include "priority/priority_resolver.hpp"
#include "st/st_journal.hpp"
#include "st/st_scheduler.hpp"

namespace core::programming {

enum class LifecycleState : uint8_t {
    IDLE = 0, STAGED, COMMIT_INTENT, ACTIVE_CANDIDATE, FIRST_CYCLE_OK,
    COMMITTED, FAILED, ROLLING_BACK, ROLLED_BACK, RECOVERY_REQUIRED,
};

const char* lifecycle_state_name(LifecycleState state);

struct RuntimeOperationSnapshot {
    LifecycleState state = LifecycleState::IDLE;
    std::string operation_id;
    std::string requested_revision_id;
    std::string active_revision_id;
    std::string lkg_revision_id;
    std::string artifact_sha256;
    std::string detail_code;
    CutoverMode producer_mode = CutoverMode::GRAPH_ONLY;
    bool keeps_running = true;
    bool impact_snapshot_valid = false;
    std::vector<std::string> active_override_ids;
};

struct StageCommand {
    std::string operation_id;
    std::string revision_id;
    std::string instance_id;
    std::string locator;
    uint64_t byte_size = 0;
    std::vector<uint8_t> sha256;
    std::string plan_hash;
};

struct ActivateCommand {
    std::string operation_id;
    std::string expected_active_revision_id;
    std::string staged_token;
    CutoverMode cutover = CutoverMode::PROGRAM_ONLY;
    std::string plan_hash;
};

/* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001). `instance_id` có mặt từ
 * Rev A (dù luôn "program-main") để không phải đổi wire format khi
 * Multi-Program cho phép nhiều instance — đúng business rule §4 "field
 * phải có sẵn, không chặn implementation hiện tại". */
struct RetainResetCommand {
    std::string operation_id;
    std::string instance_id = "program-main";
    std::string expected_active_revision_id;
};

enum class RetainResetOutcome : uint8_t {
    APPLIED = 0,      /* Đã áp dụng ở boundary VÀ force-flush persisted image thành công. */
    REJECTED,         /* Revision không khớp active, hoặc instance chưa có program loaded. */
    TIMED_OUT,        /* Chờ boundary/flush quá hạn — KHÔNG được coi là thành công (§7). */
};

/* Coordinator duy nhất sở hữu thứ tự journal → arm → safe-boundary → first
 * output commit. Filesystem chỉ chạy trong method IPC/non-RT; hai hook scan
 * chỉ đọc/ghi atomic và gọi swap O(1) đã prepare. */
class ProgrammingRuntimeCoordinator {
public:
    ProgrammingRuntimeCoordinator(StScheduler* scheduler, ProgrammingCutover* cutover,
                                  std::string journal_path, std::string staging_root);

    bool recover(std::string* error);
    bool stage(const StageCommand& command, std::string* detail_code, std::string* error);
    bool activate(const ActivateCommand& command, std::string* detail_code,
                  std::string* error);
    bool restore(const StageCommand& command, std::string* detail_code, std::string* error);

    /* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §3). Gọi non-RT
     * (IPC worker thread) — arm request qua `scheduler_->request_retain_reset`
     * rồi CHỜ CÓ GIỚI HẠN (bounded poll, không chặn RT) tới khi safe boundary
     * áp dụng, sau đó force-flush persisted image (`retain_service()->flush(true)`,
     * bỏ qua cửa sổ autosave 60s) trước khi trả về. Không giả định thành
     * công khi timeout — trả `TIMED_OUT` riêng biệt (§7). */
    RetainResetOutcome reset_retain(const RetainResetCommand& command, std::string* detail_code,
                                    std::string* error);

    void on_safe_boundary() noexcept;
    void on_output_commit(bool committed) noexcept;
    void capture_priority_overrides(const PriorityResolver& resolver) noexcept;

    /* Flush các phase mà scan đã xác nhận vào journal; chỉ gọi non-RT trước
     * khi trả STATUS/OPERATION_STATUS hoặc ở worker maintenance. */
    bool flush_progress(std::string* error);
    RuntimeOperationSnapshot snapshot() const;

private:
    struct ActiveCheckpoint {
        uint64_t byte_size = 0;
        std::string operation_id;
        std::string revision_id;
        std::string artifact_sha256;
        std::string plan_hash;
    };

    bool stage_impl(const StageCommand& command, bool restore,
                    std::string* detail_code, std::string* error);
    bool ensure_instance(std::string* error);
    bool append_phase(StJournalPhase phase, std::string* error);
    bool read_staged_artifact(const StageCommand& command, std::vector<uint8_t>* bytes,
                              std::string* detail_code, std::string* error) const;
    bool write_active_checkpoint(std::string* error) const;
    bool read_active_checkpoint(ActiveCheckpoint* checkpoint, std::string* error) const;
    bool load_active_checkpoint(const ActiveCheckpoint& checkpoint, std::string* error);

    StScheduler* scheduler_ = nullptr;
    ProgrammingCutover* cutover_ = nullptr;
    StJournal journal_;
    std::string staging_root_;
    std::string checkpoint_path_;
    std::atomic<LifecycleState> state_{LifecycleState::IDLE};
    std::atomic<bool> boundary_applied_{false};
    std::atomic<bool> first_output_committed_{false};
    std::atomic<bool> boundary_journaled_{false};
    std::atomic<bool> first_cycle_journaled_{false};
    std::atomic<uint64_t> ao_override_levels_{0};
    std::atomic<uint64_t> do_override_levels_{0};
    std::atomic<bool> impact_snapshot_valid_{false};

    /* Chỉ IPC worker đọc/ghi; scan không chạm các string/vector này. */
    std::string operation_id_;
    std::string revision_id_;
    std::string previous_revision_id_;
    std::string lkg_revision_id_;
    std::string artifact_hash_;
    std::string previous_artifact_hash_;
    std::string plan_hash_;
    std::string instance_id_ = "program-main";
    std::string detail_code_;
    uint64_t artifact_byte_size_ = 0;
    bool staged_restore_ = false;
};

} // namespace core::programming

#endif
