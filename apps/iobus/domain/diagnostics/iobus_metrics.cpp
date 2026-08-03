#include "diagnostics/iobus_metrics.hpp"

namespace iobus {

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
