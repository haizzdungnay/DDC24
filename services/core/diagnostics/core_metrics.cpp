#include "diagnostics/core_metrics.hpp"

#include <cstdio>

namespace core {

void CoreMetrics::end_scan(uint64_t exec_ns, uint64_t budget_ns)
{
    scan_count_++;
    last_exec_ns_ = exec_ns;
    if (exec_ns > max_exec_ns_) max_exec_ns_ = exec_ns;
    if (exec_ns > budget_ns) {
        scan_overrun_++;
        std::fprintf(stderr, "WARN  scan.overrun exec_ms=%.2f budget_ms=%.2f count=%u\n",
                     exec_ns / 1e6, budget_ns / 1e6, scan_overrun_);
    }
}

} // namespace core
