#include "st/st_cyclic_runtime.hpp"

#include "st/st_artifact.hpp"

namespace core {

bool StCyclicRuntime::request_activation(const std::string& source)
{
    if (has_pending_) return false;
    pending_source_ = source;
    has_pending_ = true;
    return true;
}

StExecResult StCyclicRuntime::run_cycle(uint64_t cycle_start_ns, uint64_t now_ns, uint64_t budget_ns,
                                        const StIoImage& inputs, StIoImage* outputs,
                                        StDiagnostic* activation_diag)
{
    if (has_pending_) {
        const bool had_previous = runtime_.loaded();
        const std::string attempted_hash = compute_artifact_hash(pending_source_);
        StDiagnostic local_diag;
        StDiagnostic* diag = activation_diag ? activation_diag : &local_diag;
        const bool activated = runtime_.activate(pending_source_, diag);
        /* Kết quả (thành công hay fail) đều "tiêu thụ" request — fail thì
         * package cũ tiếp tục (StProgramRuntime::activate() đã đảm bảo),
         * không retry ngầm ở cycle sau với cùng source lỗi. */
        has_pending_ = false;
        pending_source_.clear();

        if (trace_) {
            StTraceEvent ev;
            ev.kind = StTraceEventKind::ACTIVATION_RESULT;
            ev.timestamp_ns = cycle_start_ns;
            ev.ok = activated;
            ev.artifact_hash = attempted_hash;
            if (!activated) { ev.code = diag->code; ev.message = diag->message; }
            trace_->push(ev);

            if (!activated && had_previous) {
                StTraceEvent rb;
                rb.kind = StTraceEventKind::ROLLBACK;
                rb.timestamp_ns = cycle_start_ns;
                rb.ok = true;   /* rollback thành công = package cũ tiếp tục chạy */
                rb.message = "activation failed, last-known-good package retained";
                trace_->push(rb);
            }
        }
    }

    const StExecResult r = runtime_.execute(inputs, outputs);

    metrics_.cycle_count++;
    if (!r.ok) {
        metrics_.exec_fault_count++;
        if (trace_) {
            StTraceEvent ev;
            ev.kind = StTraceEventKind::RUNTIME_FAULT;
            ev.timestamp_ns = now_ns;
            ev.ok = false;
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
            ev.message = "cycle exec_ns=" + std::to_string(exec_ns) + " budget_ns=" + std::to_string(budget_ns);
            trace_->push(ev);
        }
    }

    return r;
}

} // namespace core
