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

    /* T59-702: chỉ IopClient gọi sau một IO_RESP đã parse hợp lệ. Metric này
     * không phải jitter vòng lặp hay tuổi HTTP; nó đo đúng gap producer IOP. */
    void record_valid_io_response(uint64_t response_ns);
    uint32_t max_iop_poll_gap_us() const
    {
        return max_iop_poll_gap_us_.load(std::memory_order_relaxed);
    }

    struct Snapshot {
        uint32_t rx, tx, crc_err, seq_err, timeout, retry, nack;
        uint16_t last_sample_cnt;
    };
    Snapshot snapshot() const;

private:
    std::atomic<uint64_t> previous_io_response_ns_{0};
    std::atomic<uint32_t> max_iop_poll_gap_us_{0};
};

} // namespace iobus

#endif /* IOBUS_IOBUS_METRICS_HPP */
