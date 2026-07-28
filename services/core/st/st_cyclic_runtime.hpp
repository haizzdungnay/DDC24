/**
 * @file  st_cyclic_runtime.hpp
 * @brief Wrapper cyclic quanh StProgramRuntime: activation request được LƯU
 *        LẠI và chỉ áp dụng tại RANH GIỚI đầu chu kỳ kế tiếp, không bao giờ
 *        giữa lúc execute() đang chạy (PROGRAM_TASK_SCHEDULER_SPEC §7.2).
 *
 *        run_cycle() nhận thời gian từ caller thay vì tự đọc đồng hồ, vì hai
 *        lý do: test dùng được đồng hồ giả (không sleep, không flaky), và
 *        scheduler thật chụp đồng hồ MỘT LẦN cho cả tick rồi truyền xuống —
 *        nhờ vậy hai timer khởi động cùng tick hết hạn cùng tick.
 */
#ifndef CORE_ST_CYCLIC_RUNTIME_HPP
#define CORE_ST_CYCLIC_RUNTIME_HPP

#include <cstdint>
#include <vector>

#include "st/st_runtime.hpp"
#include "st/st_trace.hpp"

namespace core {

struct StCycleMetrics {
    uint32_t cycle_count = 0;
    uint32_t overrun_count = 0;
    uint32_t exec_fault_count = 0;
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
};

class StCyclicRuntime {
public:
    /* Ghi nhận artifact chờ activate. true = đã ghi nhận; false = đang có
     * request khác chờ (request cũ KHÔNG bị ghi đè âm thầm). */
    bool request_activation(const std::vector<uint8_t>& artifact);

    bool has_pending_activation() const { return has_pending_; }

    void set_trace_log(StTraceLog* trace) { trace_ = trace; }
    void set_loader_options(const StLoaderOptions& o) { opts_ = o; }

    /* Một chu kỳ: (1) áp pending activation nếu có, (2) execute, (3) metrics. */
    StExecResult run_cycle(uint64_t cycle_start_ns, uint64_t now_ns, uint64_t budget_ns,
                           StLoadError* activation_err = nullptr);

    bool loaded() const { return runtime_.loaded(); }
    StProgramRuntime& runtime() { return runtime_; }
    const StProgramRuntime& runtime() const { return runtime_; }
    const StCycleMetrics& metrics() const { return metrics_; }
    uint32_t activation_count() const { return runtime_.activation_count(); }
    uint32_t activation_fail_count() const { return runtime_.activation_fail_count(); }

private:
    StProgramRuntime     runtime_;
    StCycleMetrics       metrics_;
    bool                 has_pending_ = false;
    std::vector<uint8_t> pending_artifact_;
    StTraceLog*          trace_ = nullptr;
    StLoaderOptions      opts_;
};

} // namespace core

#endif /* CORE_ST_CYCLIC_RUNTIME_HPP */
