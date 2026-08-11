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

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "safety/overrun_monitor.hpp"
#include "st/st_runtime.hpp"

namespace core {

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
constexpr std::size_t kMaxTasks = 8;
constexpr std::size_t kMaxProgramsPerTask = 16;
constexpr std::size_t kMaxProgramsTotal = 32;
constexpr uint32_t    kBaseTickMs = 50;
constexpr uint32_t    kMinPeriodMs = 50;
constexpr uint32_t    kMaxPeriodMs = 60000;
} // namespace st_sched_limits

struct StProgramInstance {
    std::string instance_id;
    uint16_t    order = 0;
    bool        enabled = true;

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
    bool        has_pending = false;
    bool        pending_is_rollback = false;

    const char* last_fault_code = nullptr;
    uint32_t    last_fault_pc = 0;
    int         last_fault_line = 0;
    uint32_t    fault_count = 0;
    uint32_t    run_count = 0;
};

struct StTaskConfig {
    std::string id;
    uint8_t     priority = 0;       /* 0 = cao nhất */
    uint32_t    period_ms = 1000;
    uint32_t    budget_ms = 200;
    bool        enabled = true;
    uint32_t    overrun_threshold = 3;
};

struct StTaskStats {
    uint32_t run_count = 0;
    uint32_t skip_count = 0;       /* đến hạn nhưng bị bỏ vì disabled */
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

    friend class StScheduler;
};

struct StSchedulerTickResult {
    uint32_t tasks_run = 0;
    uint32_t programs_run = 0;
    uint32_t faults = 0;
    bool     any_force_safe = false;
};

class StScheduler {
public:
    /* Trả false + *error nếu cấu hình vi phạm ràng buộc SPEC §3. Fail-fast:
     * cấu hình sai không được chạy với "phần hợp lệ", vì như vậy hệ chạy khác
     * điều engineer nghĩ mà không ai biết. */
    bool add_task(const StTaskConfig& cfg, std::string* error);

    /* Thêm instance vào task. `order` phải duy nhất trong task. */
    bool add_program(const std::string& task_id, const std::string& instance_id, uint16_t order,
                     std::string* error);

    StTask* find_task(const std::string& id);
    StProgramInstance* find_program(const std::string& instance_id);

    /* Xếp hàng artifact; áp dụng tại RANH GIỚI tick kế tiếp (SPEC §7.2). */
    bool request_activation(const std::string& instance_id, const std::vector<uint8_t>& artifact,
                            std::string* error);

    /* Lệnh vòng đời (SPEC §7.3). Trả false nếu chuyển trạng thái không hợp lệ. */
    bool start(const std::string& instance_id, std::string* error);
    bool stop(const std::string& instance_id, std::string* error);
    bool enable(const std::string& instance_id, std::string* error);
    bool disable(const std::string& instance_id, std::string* error);
    bool reset_fault(const std::string& instance_id, std::string* error);
    bool rollback(const std::string& instance_id, std::string* error);

    /* Một tick. `now_ns` chụp MỘT LẦN bởi caller và dùng chung cho mọi Task. */
    StSchedulerTickResult tick(uint64_t now_ns);

    /* true nếu BẤT KỲ task nào đang yêu cầu safe-state do overrun. */
    bool any_force_safe() const;

    const std::vector<std::unique_ptr<StTask>>& tasks() const { return tasks_; }
    void set_loader_options(const StLoaderOptions& o) { loader_opts_ = o; }

private:
    std::vector<std::unique_ptr<StTask>> tasks_;
    StLoaderOptions loader_opts_;

    void run_task(StTask& task, uint64_t now_ns, StSchedulerTickResult* out);
    void apply_pending_activations(StTask& task);
};

} // namespace core

#endif /* CORE_ST_SCHEDULER_HPP */
