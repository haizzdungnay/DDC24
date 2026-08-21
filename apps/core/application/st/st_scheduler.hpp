/**
 * @file  st_scheduler.hpp
 * @brief Task scheduler cho Program Runtime, theo
 *        docs/02_design/software/PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md.
 *
 *        Mô hình: FIXED-PRIORITY, NON-PREEMPTIVE tại task boundary.
 *
 *        Không preempt làm cho "process image không đổi trong một lần thực thi
 *        Program" thành bất biến CẤU TRÚC chứ không phải quy ước cần kỷ luật,
 *        và loại bỏ hoàn toàn khoá khỏi đường điều khiển — nên không có
 *        priority inversion và không có biến động thời gian do khoá.
 *
 *        Đồng hồ do CALLER truyền vào và chụp MỘT LẦN cho cả tick. Nếu mỗi
 *        Task/FB tự đọc đồng hồ thì kết quả phụ thuộc thứ tự thực thi và thời
 *        gian chạy của các Program trước nó — hành vi không tất định, không
 *        tái lập được khi điều tra sự cố.
 */
#ifndef CORE_ST_SCHEDULER_HPP
#define CORE_ST_SCHEDULER_HPP

#include <array>
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "graph/point_table.hpp"
#include "safety/overrun_monitor.hpp"
#include "st/st_limits.hpp"
#include "st/st_retain.hpp"
#include "st/st_runtime.hpp"
#include "st/st_trace.hpp"

namespace core {

/* Đồng hồ monotonic thật, dùng mặc định để đo WCET/overrun (§5 SPEC). Tách
 * riêng khỏi header để test thay bằng giả không cần sleep thật. */
uint64_t default_monotonic_wall_clock_ns();

/* Trạng thái vòng đời của một Program Instance (SPEC §7.1). */
enum class StProgramState : uint8_t {
    EMPTY = 0,
    STAGED,
    VALIDATED,
    READY,
    ACTIVE,
    RUNNING,
    STOPPED,
    DISABLED,
    FAULTED,
    ROLLED_BACK,
    REJECTED,
};

const char* st_program_state_name(StProgramState s);

/* Giới hạn theo SPEC §2. */
namespace st_sched_limits {
/* Backstop vật lý của container supporting As-Built. Profile sản phẩm Rev A
 * siết xuống bằng st_profile_generated; không dùng các trần này để quảng bá
 * capability sản phẩm. */
constexpr std::size_t kMaxTasks = 8;
constexpr std::size_t kMaxProgramsPerTask = 16;
constexpr std::size_t kMaxProgramsTotal = 32;
constexpr uint32_t    kBaseTickMs = 50;
constexpr uint32_t    kMinPeriodMs = 50;
constexpr uint32_t    kMaxPeriodMs = 60000;
} // namespace st_sched_limits

/* Base step thuộc nền tảng, KHÔNG thuộc Task. Các giá trị này là quyết định
 * ADR-027/028; Task period vẫn chỉ do profile machine-readable quy định. */
namespace st_base_step {
constexpr uint32_t kDefaultMs = 1000;
constexpr uint32_t kMinMs = 500;
constexpr uint32_t kMaxMs = 2000;
/* Trần budget là quyết định profile, không phải hằng riêng của base step:
 * giữ hai bản sao thì mỗi lần profile đổi lại có một phía nói số cũ. */
constexpr uint32_t kMaxTaskBudgetPercent = st_profile_generated::kMaxTaskBudgetPercent;
} // namespace st_base_step

enum class StSchedulerProfile : uint8_t {
    SUPPORTING_AS_BUILT = 0,
    REV_A,
};

const char* st_scheduler_profile_name(StSchedulerProfile profile);

/* Ảnh input cố định của một Program cho đúng một base-step. `cell` là value
 * typed đã convert nhưng chưa ghi vào runtime slot; metadata giữ identity,
 * quality, producer timestamp và source để Task 305 có thể publish health mà
 * không đọc ngược PointTable giữa cycle. */
struct StProcessInputSlot {
    StCell      cell{};
    uint16_t    slot = 0;
    StPointKind point_kind = StPointKind::UI;
    uint16_t    point_index = 0;
    uint8_t     quality = KX_Q_BAD;
    uint8_t     source = static_cast<uint8_t>(PointSource::DEFAULT);
    uint64_t    observed_at_ns = 0;
};

struct StProgramInstance {
    std::string instance_id;
    uint16_t    order = 0;
    bool        enabled = true;

    /* T59-402 — chu kỳ RIÊNG của từng Program (DDD §7.1: mỗi Program tự release
     * theo deadline của nó, Task không còn là đơn vị chạy chung).
     *
     * `0` nghĩa là "theo chu kỳ Task", giữ nguyên hành vi cho mọi Program chưa
     * khai chu kỳ — đổi mặc định sẽ làm mọi cấu hình cũ chạy khác đi mà không ai
     * yêu cầu. */
    uint32_t period_ms = 0;
    /* Mốc release LÝ THUYẾT kế tiếp. Bù trôi theo mốc lý thuyết chứ không theo
     * thời điểm chạy thật — nếu bám thời điểm thật, một tick trễ sẽ đẩy mọi
     * deadline sau đó trôi theo và Program 1 s không còn chạy 1 lần/giây. */
    uint64_t next_release_ns = 0;
    bool     release_started = false;
    /* Metrics theo Program. Task-level không thay được: với chu kỳ khác nhau,
     * một con số gộp không trả lời được "Program nào lỡ deadline". */
    uint32_t missed_release_count = 0;
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;

    StProgramState   state = StProgramState::EMPTY;
    StProgramRuntime runtime;
    /* Last-known-good: artifact cuối cùng đã chạy >= 1 tick không fault.
     * Giữ bytes chứ không giữ StLoadedProgram để rollback luôn đi lại đúng
     * đường verify — rollback không được là cửa sau bỏ qua kiểm tra. */
    std::vector<uint8_t> last_known_good;
    std::vector<uint8_t> pending_artifact;
    /* Bytes của package vừa activate, chờ đủ 1 tick sạch để thành LKG. */
    std::vector<uint8_t> activated_artifact;
    /* Vùng giữ allocation cũ để safe boundary chỉ swap vector; giải phóng ở
     * request_activation() ngoài RT. */
    std::vector<uint8_t> retired_artifact;
    StPreparedProgramHandle pending_program;
    std::atomic<bool> has_pending{false};
    std::atomic<bool> pending_commit_requested{false};
    bool        pending_is_rollback = false;
    bool        pending_changed_state = false;
    StProgramState state_before_stage = StProgramState::EMPTY;

    const char* last_fault_code = nullptr;
    uint32_t    last_fault_pc = 0;
    int         last_fault_line = 0;
    uint32_t    fault_count = 0;
    uint32_t    run_count = 0;

    /* ProgramProcessImage: cấp phát tĩnh theo profile, không heap trong scan. */
    std::array<StProcessInputSlot, st_ir::kMaxIoBindings> process_inputs{};
    uint16_t    process_input_count = 0;
    uint64_t    input_snapshot_generation = 0;
    bool        input_snapshot_valid = true;
    uint64_t    last_successful_base_step = 0;
    uint64_t    output_commit_generation = 0;
    /* TASK-PROG-401, DDD-CTRL-PROG-001 §6: true sau khi proposal mức
     * PRIO_LOCAL_LOGIC của instance đã được rút (release_ao/release_do) —
     * tránh gọi release lặp mỗi tick và phân biệt "còn hold-last" với
     * "đã nhả quyền". Reset về false khi instance publish thành công
     * (st_apply_all_outputs) hoặc khi activate artifact mới. */
    bool        outputs_withdrawn = false;

    /* TASK-PROG-402: mailbox thuộc StRetainService, không sở hữu ở instance.
     * Scan chỉ publish fixed snapshot; worker mới ghi đĩa. */
    StRetainMailbox* retain_mailbox = nullptr;
    StRetainRestoreState retain_restore_state = StRetainRestoreState::NOT_APPLICABLE;
    const char* retain_reject_code = nullptr;
    uint64_t retain_generation = 0;
    StRetainRestoreState pending_retain_restore_state =
        StRetainRestoreState::NOT_APPLICABLE;
    const char* pending_retain_reject_code = nullptr;
    uint64_t pending_retain_generation = 0;
    uint64_t last_successful_now_ns = 0;

    /* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §3). Mẫu giống
     * `has_pending`/`pending_commit_requested`: non-RT set `true` (release),
     * RT tiêu thụ tại safe boundary rồi set lại `false` và tăng
     * `retain_reset_ack_generation` (cùng thao tác, cùng boundary — không
     * có cửa sổ race giữa "đã reset" và "đã ack"). Non-RT xác nhận đã áp
     * dụng bằng cách so `retain_reset_ack_generation` với giá trị đọc được
     * TRƯỚC khi set cờ — tăng lên nghĩa là đã qua đúng 1 boundary kể từ lúc
     * yêu cầu, không suy đoán theo thời gian chờ. */
    std::atomic<bool> pending_retain_reset{false};
    std::atomic<uint64_t> retain_reset_ack_generation{0};
};

struct StTaskConfig {
    std::string id;
    uint8_t     priority = 0;       /* 0 = cao nhất */
    uint32_t    period_ms = 1000;
    uint32_t    budget_ms = 200;
    bool        enabled = true;
    uint32_t    overrun_threshold = 3;
};

/* T59-402 — release theo Program. Đặt ở đây (không ẩn trong .cpp) để test khoá
 * được luật deadline mà không phải dựng cả một scan loop. */
bool st_program_due(const StProgramInstance& program, uint32_t task_period_ms, uint64_t now_ns);
void st_program_mark_released(StProgramInstance* program, uint64_t now_ns);

struct StTaskStats {
    uint32_t run_count = 0;
    uint32_t skip_count = 0;       /* đến hạn nhưng bị bỏ vì disabled */
    uint32_t missed_release_count = 0; /* release lỡ do base step/step bị trễ */
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
};

class StTask {
public:
    explicit StTask(const StTaskConfig& cfg)
        : cfg_(cfg), monitor_(cfg.overrun_threshold) {}

    const StTaskConfig& config() const { return cfg_; }
    const StTaskStats&  stats() const { return stats_; }
    const OverrunMonitor& monitor() const { return monitor_; }
    OverrunMonitor& monitor() { return monitor_; }
    uint64_t last_dispatch_base_step() const { return last_dispatch_base_step_; }
    bool last_dispatch_succeeded() const { return last_dispatch_succeeded_; }

    void set_enabled(bool e);
    bool enabled() const { return cfg_.enabled; }

    /* Chỉ số chương trình theo `order` tăng dần — thứ tự thực thi cố định. */
    std::vector<std::unique_ptr<StProgramInstance>>& programs() { return programs_; }
    const std::vector<std::unique_ptr<StProgramInstance>>& programs() const { return programs_; }

    bool due(uint64_t now_ns) const;
    /* Cập nhật mốc chạy kế tiếp theo mốc LÝ THUYẾT (bù trôi, SPEC §4). */
    void mark_ran(uint64_t now_ns);

private:
    StTaskConfig   cfg_;
    OverrunMonitor monitor_;
    StTaskStats    stats_;
    std::vector<std::unique_ptr<StProgramInstance>> programs_;
    uint64_t last_run_ns_ = 0;
    bool     started_ = false;
    uint64_t last_dispatch_base_step_ = 0;
    bool     last_dispatch_succeeded_ = false;

    friend class StScheduler;
};

struct StSchedulerTickResult {
    uint64_t base_step_sequence = 0;
    uint32_t tasks_run = 0;
    uint32_t programs_run = 0;
    uint32_t faults = 0;
    bool     any_force_safe = false;
};

class StScheduler {
public:
    /* Supporting giữ nguyên hành vi component cũ cho host/backward tests.
     * Đường production Rev A bắt buộc khởi tạo tường minh REV_A; TASK-PROG-306
     * sẽ là điểm bootstrap duy nhất làm việc đó. */
    explicit StScheduler(StSchedulerProfile profile = StSchedulerProfile::SUPPORTING_AS_BUILT)
        : profile_(profile) {}

    StSchedulerProfile profile() const { return profile_; }
    uint64_t base_step_count() const { return base_step_count_; }

    /* Đồng hồ RIÊNG cho đo WCET/overrun (PROGRAM_TASK_SCHEDULER_SPEC §5:
     * `task_start`/`exec_ns`) — KHÁC với `now_ns` của on_base_step(), vốn
     * chụp một lần cho toàn tick để FB/deadline tất định (§4). Đo overrun
     * không phải logic chương trình nên đọc đồng hồ riêng ở đây không phá
     * bất biến đó; mặc định đồng hồ monotonic thật, test tiêm giả để không
     * cần sleep thật. */
    void set_wall_clock_for_test(std::function<uint64_t()> clock) { wall_clock_ = std::move(clock); }

    /* TASK-PROG-305: log bounded read-only cho RUNTIME_FAULT/OVERRUN/
     * ROLLBACK/ACTIVATION_RESULT — bounded event trace của OD-PROG-011,
     * KHÔNG PHẢI value-sampling historian 10.000 sample/10 phút của cùng
     * quyết định đó (phần đó cần selector/session riêng, còn mở — xem
     * DDD-CTRL-PROG-001 As-Built). nullptr = không log (mặc định), scheduler
     * không tự cấp phát trace log để giữ chủ quyền bounded-capacity ở caller. */
    void set_trace_log(StSchedulerTrace* trace) { trace_ = trace; }
    const StSchedulerTrace* trace_log() const { return trace_; }

    /* Trả false + *error nếu cấu hình vi phạm ràng buộc SPEC §3. Fail-fast:
     * cấu hình sai không được chạy với "phần hợp lệ", vì như vậy hệ chạy khác
     * điều engineer nghĩ mà không ai biết. */
    bool add_task(const StTaskConfig& cfg, std::string* error);

    /* Thêm instance vào task. `order` phải duy nhất trong task. */
    bool add_program(const std::string& task_id, const std::string& instance_id, uint16_t order,
                     std::string* error);

    StTask* find_task(const std::string& id);
    StProgramInstance* find_program(const std::string& instance_id);

    /* Xếp hàng artifact; áp dụng tại RANH GIỚI tick kế tiếp (SPEC §7.2).
     * `is_rollback=true` bỏ qua guard "candidate hiện tại chưa qua clean
     * tick" ở stage_activation() — xem ghi chú tại đó, đây là lối thoát BẮT
     * BUỘC cho chính candidate đang kẹt đó. */
    bool request_activation(const std::string& instance_id, const std::vector<uint8_t>& artifact,
                            std::string* error, bool is_rollback = false);

    /* Hai pha cho Commission: stage verify/preallocate ngoài RT nhưng CHƯA
     * cho safe boundary swap; activate chỉ arming O(1). API cũ phía trên giữ
     * hành vi một bước cho unit/supporting callers. */
    bool stage_activation(const std::string& instance_id, const std::vector<uint8_t>& artifact,
                          std::string* error, bool is_rollback = false);
    bool commit_staged_activation(const std::string& instance_id, bool rollback,
                                  std::string* error);
    bool abort_staged_activation(const std::string& instance_id, std::string* error);

    /* Lệnh vòng đời (SPEC §7.3). Trả false nếu chuyển trạng thái không hợp lệ. */
    bool start(const std::string& instance_id, std::string* error);
    bool stop(const std::string& instance_id, std::string* error);
    bool enable(const std::string& instance_id, std::string* error);
    bool disable(const std::string& instance_id, std::string* error);
    bool reset_fault(const std::string& instance_id, std::string* error);
    bool rollback(const std::string& instance_id, std::string* error);

    /* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §3). Non-RT: đặt cờ
     * pending, áp dụng thật tại boundary kế tiếp (không đồng bộ tại đây —
     * xem `apply_pending_retain_resets_at_boundary()`). Trả false nếu
     * instance không tồn tại hoặc chưa có program đang chạy (không có gì
     * retained để reset). Caller (coordinator) đọc
     * `find_program(id)->retain_reset_ack_generation` TRƯỚC khi gọi hàm
     * này để có mốc so sánh xác nhận đã áp dụng. */
    bool request_retain_reset(const std::string& instance_id, std::string* error);

    /* Safe-boundary phase tách riêng để process image chụp input của candidate
     * vừa activate, không chụp artifact cũ rồi execute artifact mới. Gọi lặp
     * lại trong cùng boundary là no-op. */
    void apply_pending_activations_at_boundary();

    /* WP-12: áp dụng RETAIN reset đang chờ (nếu có) cho mọi instance, tại
     * CÙNG safe boundary với activation — không cấp phát, không throw. Gọi
     * cùng chỗ caller gọi `apply_pending_activations_at_boundary()` (xem
     * `ProgrammingRuntimeCoordinator::on_safe_boundary()`). Tách riêng khỏi
     * activation để không trộn hai luồng nghiệp vụ khác nhau vào một hàm. */
    void apply_pending_retain_resets_at_boundary();

    /* Một base step. `now_ns` chụp MỘT LẦN bởi caller và dùng chung cho mọi
     * Task. Task period chỉ quyết định có dispatch hay không; tuyệt đối không
     * được dùng làm thời gian sleep của caller. */
    StSchedulerTickResult on_base_step(uint64_t now_ns);

    /* Alias tương thích cho supporting component cũ. Source production mới
     * phải gọi on_base_step() để ranh giới timing hiện rõ khi review. */
    StSchedulerTickResult tick(uint64_t now_ns) { return on_base_step(now_ns); }

    /* true nếu BẤT KỲ task nào đang yêu cầu safe-state do overrun. */
    bool any_force_safe() const;

    const std::vector<std::unique_ptr<StTask>>& tasks() const { return tasks_; }
    void set_loader_options(const StLoaderOptions& o) { loader_opts_ = o; }

    /* Chỉ cấu hình ngoài RT. Service phải sống lâu hơn scheduler. */
    void set_retain_service(StRetainService* service);
    StRetainService* retain_service() const { return retain_service_; }

    /* Gọi sau khi output batch của base-step hiện tại đã commit. Chỉ copy
     * snapshot bounded vào mailbox, không filesystem I/O/lock/allocation. */
    void publish_committed_retain_snapshots() noexcept;

    /* Chỉ promote artifact vừa activate thành LKG sau khi CHÍNH cycle đó đã
     * execute và publish output batch thành công. Một cycle chỉ execute sạch
     * nhưng bị output preflight/commit từ chối chưa đủ tư cách rollback. */
    void promote_output_committed_artifacts() noexcept;

private:
    StSchedulerProfile profile_ = StSchedulerProfile::SUPPORTING_AS_BUILT;
    uint64_t base_step_count_ = 0;
    std::vector<std::unique_ptr<StTask>> tasks_;
    StLoaderOptions loader_opts_;
    std::function<uint64_t()> wall_clock_ = default_monotonic_wall_clock_ns;
    StSchedulerTrace* trace_ = nullptr;
    StRetainService* retain_service_ = nullptr;

    void run_task(StTask& task, uint64_t now_ns, StSchedulerTickResult* out);
    void apply_pending_activations(StTask& task);
    void apply_pending_retain_resets(StTask& task);
    void log_trace(StTraceEventKind kind, uint64_t now_ns, bool ok, const char* task_id,
                   const char* instance_id, const char* code);
};

} // namespace core

#endif /* CORE_ST_SCHEDULER_HPP */
