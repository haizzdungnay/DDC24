#ifndef CORE_APPLICATION_PROGRAMMING_PROGRAMMING_RUNTIME_COORDINATOR_HPP
#define CORE_APPLICATION_PROGRAMMING_PROGRAMMING_RUNTIME_COORDINATOR_HPP

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#include "programming/programming_cutover.hpp"
#include "priority/priority_resolver.hpp"
#include "st/st_journal.hpp"
#include "programming/program_candidate_registry.hpp"
#include "st/st_package_v2.hpp"
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
/* T59-702 — lệnh operator bỏ một giao dịch không thể phục hồi.
 *
 * `RECOVERY_REQUIRED` là ngõ cụt có chủ ý: Core không đoán, không tự chọn gói
 * nào cả. Nhưng trước bản này nó cũng không có LỐI RA — mọi action IPC trả
 * `Unavailable`, nên bo chỉ thoát được bằng cách xoá journal bằng tay, tức là
 * xoá sổ vận hành để thoát một trạng thái vận hành.
 *
 * Lệnh này là lối ra tường minh: chỉ nhận khi đang `RECOVERY_REQUIRED`, ghi
 * thêm một bản ghi journal (không xoá gì), rồi về `IDLE` **không có Active** và
 * giữ safe-state. Sau đó phải Commission lại; không có gói nào tự sống lại. */
struct RecoveryResetCommand {
    std::string operation_id;
    /* Ai ra lệnh — đi vào journal/audit. Rỗng là lỗi: một quyết định bỏ giao
     * dịch mà không có chủ thì không truy được về sau. */
    std::string actor_id;
};

enum class RecoveryResetOutcome : uint8_t {
    APPLIED = 0,
    /* Không ở `RECOVERY_REQUIRED`: từ chối, vì reset ngoài ngữ cảnh đó sẽ là
     * một cách bỏ Active đang chạy mà không đi qua Disable/Restore. */
    NOT_IN_RECOVERY = 1,
    REJECTED = 2,
};

struct RetainResetCommand {
    std::string operation_id;
    std::string instance_id = "program-main";
    std::string expected_active_revision_id;
};

/* T59-405 — intent Enable/Disable cho một Program. `enabled` là Ý ĐỊNH; trạng
 * thái thật (`STARTING`/`RUNNING`/`STOPPING`/`DISABLED`/`FAULTED`) là thứ Core
 * báo ngược về. Gộp hai thứ vào một trường sẽ làm một Program đã bật nhưng đang
 * FAULTED trông y hệt một Program chưa ai bật. */
struct ProgramEnableCommand {
    std::string operation_id;
    std::string instance_id;
    bool        enabled = false;
};

/* Kết quả của một lệnh `SET_PROGRAM_ENABLED`. Tách `TIMED_OUT` khỏi
 * `REJECTED` vì hai thứ đòi hai hành động khác nhau ở phía gọi: timeout là
 * "chưa biết", gọi lại được (lệnh idempotent); rejected là "đã trả lời không". */
enum class ProgramEnableOutcome : uint8_t {
    APPLIED = 0,
    REJECTED,
    TIMED_OUT,
};

enum class RetainResetOutcome : uint8_t {
    APPLIED = 0,      /* Đã áp dụng ở boundary VÀ force-flush persisted image thành công. */
    REJECTED,         /* Revision không khớp active, hoặc instance chưa có program loaded. */
    TIMED_OUT,        /* Chờ boundary/flush quá hạn — KHÔNG được coi là thành công (§7). */
};

/* Coordinator duy nhất sở hữu thứ tự journal → arm → safe-boundary → first
 * output commit. Filesystem chỉ chạy trong method IPC/non-RT; hai hook scan
 * chỉ đọc/ghi atomic và gọi swap O(1) đã prepare. */
/* Một Program đã tách ra khỏi package, đủ để stage: identity, mã, và chu kỳ
 * release. Gộp ba thứ vào một struct thay vì ba vector song song vì chúng luôn
 * đi cùng nhau — vector song song là chỗ để lệch độ dài. */
struct PackageProgramSlice {
    std::string instance_id;
    std::vector<uint8_t> ir_blob;
    uint32_t period_ms = 0;
};

/* T59-404 — bus signal mà coordinator dựng lại mỗi lần nạp package. Đặt ở đây
 * chứ không ở scheduler vì signal là dữ liệu của PACKAGE: đổi package là đổi tập
 * signal, và giữ lại khai báo cũ nghĩa là chạy gói mới với hợp đồng gói cũ. */

class ProgrammingRuntimeCoordinator {
public:
    ProgrammingRuntimeCoordinator(StScheduler* scheduler, ProgrammingCutover* cutover,
                                  std::string journal_path, std::string staging_root);

    bool recover(std::string* error);

    /* Danh sách instance của package đang được coordinator quản lý. STATUS đọc
     * nó để read-back đúng thứ đã nạp thay vì đoán theo một tên cố định. */
    std::vector<std::string> instance_ids() const;
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
    /* T59-406 — sổ candidate output. Coordinator XOÁ SẠCH sổ mỗi lần nạp gói
     * mới: giữ claim của gói cũ nghĩa là trả lời sai câu "ai đang giữ điểm này",
     * và câu đó là câu đầu tiên người vận hành hỏi khi một van không nghe lệnh.
     * nullptr = không ghi sổ. */
    void set_candidate_registry(ProgramCandidateRegistry* registry) { candidates_ = registry; }
    ProgramCandidateRegistry* candidate_registry() const { return candidates_; }

    /* Áp intent Enable/Disable lên đúng một Program. Chạy trên IPC worker
     * thread (non-RT): ARM yêu cầu rồi CHỜ CÓ GIỚI HẠN tới khi safe boundary
     * áp dụng, giống hệt `reset_retain()` — xem F-P59-ENABLE-BOUNDARY-001 tại
     * `StProgramInstance`. `REJECTED` + `*detail_code` khi instance không có,
     * trạng thái không cho phép, hoặc vượt trần Program chạy đồng thời;
     * `TIMED_OUT` khi boundary chưa tới trong hạn (không được coi là thành
     * công, và cũng không được coi là đã từ chối). */
    ProgramEnableOutcome set_program_enabled(const ProgramEnableCommand& command,
                                             std::string* detail_code, std::string* error);

    RetainResetOutcome reset_retain(const RetainResetCommand& command, std::string* detail_code,
                                    std::string* error);

    RecoveryResetOutcome recovery_reset(const RecoveryResetCommand& command,
                                        std::string* detail_code, std::string* error);

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
    /* Chuẩn bị topology cho đúng tập Program của package: thêm instance còn
     * thiếu vào scheduler và áp chu kỳ release của từng Program. Bootstrap không
     * còn phải biết trước tên Program — đó là dữ liệu của package, không phải
     * của bootstrap. */
    bool ensure_topology(const std::vector<PackageProgramSlice>& slices, std::string* error);

    /* Dựng hợp đồng signal của gói mới vào một BANK RỜI của bus. `*prepared`
     * true nghĩa là có một bank đang chờ và caller phải activate hoặc discard.
     * Khác `rebuild_signal_bus()`: hàm này KHÔNG chạm bank đang live. */
    bool prepare_signal_replacement(const std::vector<StPackageSignal>& signals, bool* prepared,
                                    std::string* detail_code, std::string* error);

    /* Ảnh chụp danh tính một package. `prepared_identity_` không đè lên
     * danh tính live trước safe boundary; `previous_identity_` đi cùng topology
     * cũ để rollback khôi phục đúng một transaction, không ghép nửa cũ/nửa
     * mới. */
    struct CoordinatorIdentity {
        std::string instance_id;
        std::vector<std::string> instance_ids;
        std::string operation_id;
        std::string revision_id;
        std::string artifact_hash;
        std::string plan_hash;
        std::string detail_code;
        uint64_t artifact_byte_size = 0;
        bool staged_restore = false;
    };
    CoordinatorIdentity capture_identity() const;
    /* Đổi ownership identity với các field live bằng swap O(1). Chỉ dùng ở
     * safe boundary; copy string/vector tại đó có thể cấp phát heap và phá
     * giới hạn WCET của scan. */
    void swap_live_identity(CoordinatorIdentity* identity) noexcept;
    bool append_phase(StJournalPhase phase, const CoordinatorIdentity& identity,
                      std::string* error);
    /* Tách artifact thành các lát Program. v1 -> đúng một lát dùng
     * `command.instance_id`; v2 -> N lát lấy tên và chu kỳ từ chính package. */
    bool split_package(const std::vector<uint8_t>& bytes, const std::string& fallback_instance,
                       std::vector<PackageProgramSlice>* out,
                       std::vector<StPackageSignal>* signals_out, std::string* detail_code,
                       std::string* error) const;
    /* Dựng lại bus signal theo đúng khai báo của package. Trả false nếu khai báo
     * mâu thuẫn — một package tới đây có thể do writer khác phiên bản sinh, nên
     * runtime không được tin nó chỉ vì writer của mình đã kiểm. */
    bool rebuild_signal_bus(const std::vector<StPackageSignal>& signals, std::string* detail_code,
                            std::string* error);
    /* Chuyển một khai báo signal của package sang dạng runtime. Tách ra vì cả
     * đường boot lẫn đường Commission đều cần, và hai bản chuyển đổi song song
     * là hai bộ ngữ nghĩa để trôi khỏi nhau. */
    static bool signal_definition_from_package(const StPackageSignal& signal,
                                               StSignalDefinition* out, std::string* detail_code,
                                               std::string* error);

    /* T59-501 — kết luận barrier chu kỳ đầu ở mức GÓI. */
    enum class PackageCycleVerdict : uint8_t {
        /* Còn Program chưa chạy xong chu kỳ đầu (ví dụ Program 30 s trong gói
         * trộn chu kỳ). Chưa kết luận được — chờ tiếp. */
        PENDING = 0,
        /* MỌI Program đang chạy đã publish output thành công ít nhất một lần. */
        PASSED,
        /* Có Program hỏng. Cả gói phải quay về, không có "một nửa thành công". */
        FAILED,
    };
    PackageCycleVerdict package_first_cycle_verdict(bool committed) const;
    /* Quay về LKG cho TOÀN BỘ gói. Trả false nếu bất kỳ instance nào không có
     * LKG để quay về — khi đó không có bản cũ nguyên vẹn nào để khôi phục. */
    bool rollback_package(std::string* error);
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

    /* F-P59-ATOMIC-001: coordinator sở hữu cả hai phía của handoff.
     * `prepared_program_set_` chỉ chứa shadow trước boundary. Sau swap,
     * `previous_program_set_` giữ nguyên topology cũ tới khi COMMITTED bền
     * vững hoặc rollback. Hai bool phân biệt "topology cũ rỗng hợp lệ"
     * với "không có topology để khôi phục". */
    StPreparedProgramSet prepared_program_set_;
    StPreparedProgramSet previous_program_set_;
    /* `prepared_identity_` là carrier O(1) cho handoff; sau forward swap nó
     * chứa identity live cũ. `transaction_identity_` giữ nguyên candidate để
     * OPERATION_STATUS vẫn nhận diện đúng giao dịch nếu sau đó rollback. */
    CoordinatorIdentity prepared_identity_;
    CoordinatorIdentity transaction_identity_;
    CoordinatorIdentity previous_identity_;
    bool prepared_identity_valid_ = false;
    bool previous_program_set_valid_ = false;
    bool signal_replacement_prepared_ = false;
    bool signal_replacement_active_ = false;

    /* Chỉ IPC worker đọc/ghi; scan không chạm các string/vector này. */
    std::string operation_id_;
    std::string revision_id_;
    std::string previous_revision_id_;
    std::string lkg_revision_id_;
    std::string artifact_hash_;
    std::string previous_artifact_hash_;
    std::string plan_hash_;
    /* T59-401: một package có thể mang nhiều Program. `instance_id_` là instance
     * CHÍNH (giữ nguyên nghĩa cho journal và cho artifact v1 một Program);
     * `instance_ids_` là toàn bộ tập instance của package đang stage/active.
     * Giữ cả hai thay vì chỉ vector: journal v1 ghi một instance id, và đổi
     * định dạng journal ở đây sẽ làm mọi bản ghi cũ không đọc được. */
    std::string instance_id_ = "program-main";
    std::vector<std::string> instance_ids_{"program-main"};
    ProgramCandidateRegistry* candidates_ = nullptr;
    std::string detail_code_;
    uint64_t artifact_byte_size_ = 0;
    bool staged_restore_ = false;
};

} // namespace core::programming

#endif
