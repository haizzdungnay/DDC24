#include "st/st_cyclic_runtime.hpp"

#include <utility>

namespace core {

bool StCyclicRuntime::request_activation(const std::vector<uint8_t>& artifact,
                                         StLoadError* error)
{
    if (pending_) return false;
    /* API này chạy ngoài scan. Thu hồi ảnh cũ tại đây để safe boundary kế tiếp
     * chỉ move handle, không gọi delete/free. */
    runtime_.reclaim_retired();
    StPreparedProgramHandle candidate;
    StLoadError local_error;
    StLoadError* load_error = error ? error : &local_error;
    if (!runtime_.prepare(artifact.data(), artifact.size(), &candidate, load_error, &opts_)) {
        if (trace_) {
            StTraceEvent ev;
            ev.kind = StTraceEventKind::ACTIVATION_RESULT;
            ev.ok = false;
            ev.code = load_error->code;
            ev.message = load_error->message;
            trace_->push(std::move(ev));
            if (runtime_.loaded()) {
                StTraceEvent rb;
                rb.kind = StTraceEventKind::ROLLBACK;
                rb.ok = true;
                rb.message = "staging failed, last-known-good package retained";
                trace_->push(std::move(rb));
            }
        }
        return false;
    }
    pending_ = std::move(candidate);
    return true;
}

StExecResult StCyclicRuntime::run_cycle(uint64_t cycle_start_ns, uint64_t now_ns,
                                        uint64_t budget_ns, StLoadError* activation_err)
{
    if (pending_) {
        /* candidate đã verify + preallocate ngoài RT. Ở đây chỉ swap ownership
         * O(1); không còn parser/loader/heap trên safe boundary. */
        const bool activated = runtime_.activate_prepared(std::move(pending_));
        if (activation_err && !activated) {
            activation_err->code = st_ir_error::kOutOfMemory;
            activation_err->message = "prepared runtime slot unavailable";
        }

        if (trace_) {
            StTraceEvent ev;
            ev.kind = StTraceEventKind::ACTIVATION_RESULT;
            ev.timestamp_ns = cycle_start_ns;
            ev.ok = activated;
            if (!activated) {
                ev.code = st_ir_error::kOutOfMemory;
                ev.message = "prepared runtime slot unavailable";
            }
            trace_->push(ev);
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
            ev.message = r.error ? r.error : "runtime_fault";
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
