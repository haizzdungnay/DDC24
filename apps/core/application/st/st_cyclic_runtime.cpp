#include "st/st_cyclic_runtime.hpp"

namespace core {

bool StCyclicRuntime::request_activation(const std::vector<uint8_t>& artifact)
{
    if (has_pending_) return false;
    pending_artifact_ = artifact;
    has_pending_ = true;
    return true;
}

StExecResult StCyclicRuntime::run_cycle(uint64_t cycle_start_ns, uint64_t now_ns,
                                        uint64_t budget_ns, StLoadError* activation_err)
{
    if (has_pending_) {
        const bool had_previous = runtime_.loaded();
        StLoadError local_err;
        StLoadError* err = activation_err ? activation_err : &local_err;
        const bool activated =
            runtime_.activate(pending_artifact_.data(), pending_artifact_.size(), err, &opts_);
        /* Thành công hay thất bại đều TIÊU THỤ request: thất bại thì package
         * cũ tiếp tục chạy, không retry ngầm ở chu kỳ sau với cùng artifact lỗi. */
        has_pending_ = false;
        pending_artifact_.clear();

        if (trace_) {
            StTraceEvent ev;
            ev.kind = StTraceEventKind::ACTIVATION_RESULT;
            ev.timestamp_ns = cycle_start_ns;
            ev.ok = activated;
            if (!activated) { ev.code = err->code; ev.message = err->message; }
            trace_->push(ev);

            if (!activated && had_previous) {
                StTraceEvent rb;
                rb.kind = StTraceEventKind::ROLLBACK;
                rb.timestamp_ns = cycle_start_ns;
                rb.ok = true;
                rb.message = "activation failed, last-known-good package retained";
                trace_->push(rb);
            }
        }
    }

    const StExecResult r = runtime_.execute(static_cast<int64_t>(now_ns));

    metrics_.cycle_count++;
    if (!r.ok) {
        metrics_.exec_fault_count++;
        if (trace_) {
            StTraceEvent ev;
            ev.kind = StTraceEventKind::RUNTIME_FAULT;
            ev.timestamp_ns = now_ns;
            ev.ok = false;
            ev.code = r.fault_code ? r.fault_code : "";
            ev.message = r.error;
            trace_->push(ev);
        }
    }

    const uint64_t exec_ns = now_ns - cycle_start_ns;
    metrics_.last_exec_ns = exec_ns;
    if (exec_ns > metrics_.max_exec_ns) metrics_.max_exec_ns = exec_ns;
    if (exec_ns > budget_ns) {
        metrics_.overrun_count++;
        if (trace_) {
            StTraceEvent ev;
            ev.kind = StTraceEventKind::OVERRUN;
            ev.timestamp_ns = now_ns;
            ev.ok = false;
            ev.message = "cycle exec_ns=" + std::to_string(exec_ns) +
                         " budget_ns=" + std::to_string(budget_ns);
            trace_->push(ev);
        }
    }
    return r;
}

} // namespace core
