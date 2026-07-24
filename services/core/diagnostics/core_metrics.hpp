/**
 * @file  core_metrics.hpp
 * @brief scan_count / scan_overrun / exec time (07 §0 #8).
 */
#ifndef CORE_CORE_METRICS_HPP
#define CORE_CORE_METRICS_HPP

#include <cstdint>

namespace core {

class CoreMetrics {
public:
    void end_scan(uint64_t exec_ns, uint64_t budget_ns);

    uint32_t scan_count() const { return scan_count_; }
    uint32_t scan_overrun() const { return scan_overrun_; }
    uint64_t last_exec_ns() const { return last_exec_ns_; }
    uint64_t max_exec_ns() const { return max_exec_ns_; }
    uint32_t seqlock_fail() const { return seqlock_fail_; }
    void inc_seqlock_fail() { seqlock_fail_++; }

private:
    uint32_t scan_count_ = 0;
    uint32_t scan_overrun_ = 0;
    uint64_t last_exec_ns_ = 0;
    uint64_t max_exec_ns_ = 0;
    uint32_t seqlock_fail_ = 0;
};

} // namespace core

#endif /* CORE_CORE_METRICS_HPP */
