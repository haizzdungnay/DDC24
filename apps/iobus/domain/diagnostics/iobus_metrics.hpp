/**
 * @file  iobus_metrics.hpp
 * @brief Counters IOP (06 §8). Atomic — poll thread tăng, web/diag đọc snapshot.
 */
#ifndef IOBUS_IOBUS_METRICS_HPP
#define IOBUS_IOBUS_METRICS_HPP

#include <atomic>
#include <cstdint>

namespace iobus {

/* T63-003 (PERF-API-04): counter IOP là uint64 trong tiến trình.
 *
 * uint32 ở nhịp 500 Hz (GET_IO 2 ms) tràn sau ~99 ngày: `rx` tụt về 0 trong khi
 * `producer_boot_id` KHÔNG đổi, nên consumer không phân biệt được "tràn" với
 * "reset" hay "giảm" — đúng lỗi epoch mà T63-003 phải đóng. Bản 64 bit đi ra
 * qua op `status` của kênh điều khiển; SHM `iop_rx…` vẫn uint32 theo hợp đồng
 * (cắt 32 bit thấp khi ghi, như hành vi cũ). Luồng poll RT tăng các counter này
 * bằng `fetch_add` relaxed: phải lock-free trên target, không được thành khoá. */
static_assert(std::atomic<uint64_t>::is_always_lock_free,
              "counter IOP 64 bit phải lock-free — luồng poll RT không được khoá");

class IobusMetrics {
public:
    std::atomic<uint64_t> rx_count{0};
    std::atomic<uint64_t> tx_count{0};
    std::atomic<uint64_t> crc_error_count{0};
    std::atomic<uint64_t> seq_error_count{0};
    std::atomic<uint64_t> timeout_count{0};
    std::atomic<uint64_t> retry_count{0};
    std::atomic<uint64_t> nack_count{0};
    std::atomic<uint16_t> last_valid_sample_cnt{0};

    /* T59-702: chỉ IopClient gọi sau một IO_RESP đã parse hợp lệ. Metric này
     * không phải jitter vòng lặp hay tuổi HTTP; nó đo đúng gap producer IOP. */
    void record_valid_io_response(uint64_t response_ns);
    uint32_t max_iop_poll_gap_us() const
    {
        return max_iop_poll_gap_us_.load(std::memory_order_relaxed);
    }

    struct Snapshot {
        uint64_t rx, tx, crc_err, seq_err, timeout, retry, nack;
        uint16_t last_sample_cnt;
    };
    Snapshot snapshot() const;

private:
    std::atomic<uint64_t> previous_io_response_ns_{0};
    std::atomic<uint32_t> max_iop_poll_gap_us_{0};
};

} // namespace iobus

#endif /* IOBUS_IOBUS_METRICS_HPP */
