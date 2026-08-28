#include "diagnostics/iobus_metrics.hpp"

namespace iobus {

void IobusMetrics::record_valid_io_response(uint64_t response_ns)
{
    const uint64_t previous = previous_io_response_ns_.exchange(response_ns,
                                                                 std::memory_order_relaxed);
    if (previous == 0 || response_ns <= previous) return;
    const uint64_t gap_us_64 = (response_ns - previous) / 1000u;
    const uint32_t gap_us = gap_us_64 > UINT32_MAX
        ? UINT32_MAX : static_cast<uint32_t>(gap_us_64);
    uint32_t current = max_iop_poll_gap_us_.load(std::memory_order_relaxed);
    while (current < gap_us &&
           !max_iop_poll_gap_us_.compare_exchange_weak(current, gap_us,
                                                        std::memory_order_relaxed,
                                                        std::memory_order_relaxed)) {
    }
}

IobusMetrics::Snapshot IobusMetrics::snapshot() const
{
    Snapshot s;
    s.rx              = rx_count.load(std::memory_order_relaxed);
    s.tx              = tx_count.load(std::memory_order_relaxed);
    s.crc_err         = crc_error_count.load(std::memory_order_relaxed);
    s.seq_err         = seq_error_count.load(std::memory_order_relaxed);
    s.timeout         = timeout_count.load(std::memory_order_relaxed);
    s.retry           = retry_count.load(std::memory_order_relaxed);
    s.nack            = nack_count.load(std::memory_order_relaxed);
    s.last_sample_cnt = last_valid_sample_cnt.load(std::memory_order_relaxed);
    return s;
}

} // namespace iobus
