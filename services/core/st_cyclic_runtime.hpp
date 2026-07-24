/**
 * @file  st_cyclic_runtime.hpp
 * @brief FW SOM IEC programming foundation: wrapper cyclic quanh
 *        StProgramRuntime, cùng pattern với `scan_loop.hpp`'s reload_flag_
 *        (COR-008): activation request được LƯU LẠI, chỉ áp dụng tại RANH
 *        GIỚI đầu cycle kế tiếp — không bao giờ giữa lúc execute() đang chạy.
 *
 *        run_cycle() nhận thời gian từ caller (không tự gọi clock_gettime)
 *        để host test dùng fake clock — không cần sleep thật, không flaky.
 *        Vòng lặp thật (clock_nanosleep tuyệt đối) là việc của caller khi
 *        tích hợp vào 1 service thật sau này (ngoài phạm vi FW SOM hiện tại).
 */
#ifndef CORE_ST_CYCLIC_RUNTIME_HPP
#define CORE_ST_CYCLIC_RUNTIME_HPP

#include <cstdint>
#include <string>

#include "st_diagnostic.hpp"
#include "st_runtime.hpp"
#include "st_trace.hpp"

namespace core {

struct StCycleMetrics {
    uint32_t cycle_count = 0;
    uint32_t overrun_count = 0;
    uint32_t exec_fault_count = 0;   /* StExecResult.ok == false, kể cả no_active_program */
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
};

class StCyclicRuntime {
public:
    /* Ghi lại request — KHÔNG parse/apply ngay. true = ghi nhận (chờ cycle
     * kế); false = đã có 1 request khác đang chờ áp dụng (request cũ chưa xử
     * lý bị giữ nguyên, không bị ghi đè âm thầm — caller phải đợi cycle kế
     * xử lý xong request trước rồi mới gọi lại). */
    bool request_activation(const std::string& source);

    bool has_pending_activation() const { return has_pending_; }

    /* Không sở hữu — caller giữ vòng đời StTraceLog. nullptr = không log. */
    void set_trace_log(StTraceLog* trace) { trace_ = trace; }

    /* 1 cycle:
     *   1) nếu có pending activation: parse+typecheck+atomic-swap NGAY tại
     *      đây (đầu cycle, trước khi đọc input/execute) — fail thì package
     *      cũ tiếp tục, *activation_diag (nếu !nullptr) nhận lỗi.
     *   2) execute(inputs, outputs) bằng package đang active (cũ hoặc mới).
     *   3) metrics: exec_ns = now_ns - cycle_start_ns; overrun nếu
     *      exec_ns > budget_ns (strict, giống CoreMetrics::end_scan). */
    StExecResult run_cycle(uint64_t cycle_start_ns, uint64_t now_ns, uint64_t budget_ns,
                           const StIoImage& inputs, StIoImage* outputs,
                           StDiagnostic* activation_diag = nullptr);

    bool loaded() const { return runtime_.loaded(); }
    const StProgram* active_program_for_test() const { return runtime_.active_program_for_test(); }
    const StCycleMetrics& metrics() const { return metrics_; }
    uint32_t activation_count() const { return runtime_.activation_count(); }
    uint32_t activation_fail_count() const { return runtime_.activation_fail_count(); }

private:
    StProgramRuntime runtime_;
    StCycleMetrics   metrics_;
    bool             has_pending_ = false;
    std::string      pending_source_;
    StTraceLog*      trace_ = nullptr;
};

} // namespace core

#endif /* CORE_ST_CYCLIC_RUNTIME_HPP */
