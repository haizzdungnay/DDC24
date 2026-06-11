/**
 * @file  iobus_metrics.hpp
 * @brief Counters IOP (06 §8). Atomic — poll thread tăng, web/diag đọc snapshot.
 */
#ifndef IOBUS_IOBUS_METRICS_HPP
#define IOBUS_IOBUS_METRICS_HPP

#include <atomic>
#include <cstdint>

namespace iobus {

class IobusMetrics {
public:
    std::atomic<uint32_t> rx_count{0};
    std::atomic<uint32_t> tx_count{0};
    std::atomic<uint32_t> crc_error_count{0};
    std::atomic<uint32_t> seq_error_count{0};
    std::atomic<uint32_t> timeout_count{0};
    std::atomic<uint32_t> retry_count{0};
    std::atomic<uint32_t> nack_count{0};
    std::atomic<uint16_t> last_valid_sample_cnt{0};

    struct Snapshot {
        uint32_t rx, tx, crc_err, seq_err, timeout, retry, nack;
        uint16_t last_sample_cnt;
    };
    Snapshot snapshot() const;
};

} // namespace iobus

#endif /* IOBUS_IOBUS_METRICS_HPP */
