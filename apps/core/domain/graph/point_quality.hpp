/**
 * @file  point_quality.hpp
 * @brief Quality propagation (07 §6): fault/stale → GOOD/UNCERTAIN/BAD.
 *
 *        ADR-061 4.7 — stale tính theo THỜI GIAN, không theo số scan:
 *          - `ts_ns` của io_shm không đổi quá max(3 base step, 250 ms)
 *            → UNCERTAIN (`is_stale()`).
 *          - quá max(5 base step, 500 ms) → BAD và safe-state T3
 *            (`is_stale_bad()`).
 *
 *        Vì sao đổi: ngưỡng "3 scan" chỉ đúng nghĩa khi base step là 1 s. Ở base
 *        step 10 ms nó co còn 30 ms, ngắn hơn cả một vòng IOP của iobus, nên một
 *        nhịp poll chậm bình thường cũng kéo toàn bộ I/O về UNCERTAIN và đẩy đầu
 *        ra về safe (X18). Sàn thời gian giữ ngưỡng ở mức vật lý có nghĩa; hệ số
 *        theo base step giữ đúng hành vi cũ khi base step dài (1 s → 3 s/5 s).
 */
#ifndef CORE_POINT_QUALITY_HPP
#define CORE_POINT_QUALITY_HPP

#include "ports/io_snapshot.hpp"
#include "graph/point_table.hpp"

namespace core {

class PointQuality {
public:
    /* Base step thật của vòng quét (ns). ScanLoop::run đặt đúng một lần trước
     * scan đầu; mặc định 10 ms (ADR-061 C1) cho caller gọi step() trực tiếp. */
    void set_base_step_ns(uint64_t base_step_ns);
    uint64_t base_step_ns() const { return base_step_ns_; }

    /* Gọi mỗi scan SAU update_inputs. `now_ns` là đồng hồ monotonic chụp một
     * lần cho cả scan (cùng đồng hồ với `ClockSnapshot::monotonic_ns`). */
    void evaluate(PointTable& table, const IoSnapshot& io, uint64_t now_ns);

    bool is_stale() const { return stale_uncertain_; }
    bool is_stale_bad() const { return stale_bad_; }
    /* Số scan liên tiếp io_shm không đổi — giữ cho chẩn đoán/log, KHÔNG còn là
     * cơ sở của ngưỡng. */
    uint32_t stale_scans() const { return stale_scans_; }
    /* Tuổi của mẫu io_shm tại lần evaluate gần nhất (ns). */
    uint64_t stale_age_ns() const { return stale_age_ns_; }

    uint64_t uncertain_after_ns() const { return uncertain_after_ns_; }
    uint64_t bad_after_ns() const { return bad_after_ns_; }

    static constexpr uint32_t STALE_UNCERTAIN_STEPS = 3;
    static constexpr uint32_t STALE_BAD_STEPS = 5;
    static constexpr uint64_t STALE_UNCERTAIN_FLOOR_NS = 250ull * 1000000ull;
    static constexpr uint64_t STALE_BAD_FLOOR_NS = 500ull * 1000000ull;
    static constexpr uint64_t DEFAULT_BASE_STEP_NS = 10ull * 1000000ull;

    /* Ngưỡng cho một base step — tách thành hàm thuần để test và tài liệu dùng
     * đúng một công thức. */
    static constexpr uint64_t uncertain_threshold_ns(uint64_t base_step_ns)
    {
        const uint64_t by_steps = STALE_UNCERTAIN_STEPS * base_step_ns;
        return by_steps > STALE_UNCERTAIN_FLOOR_NS ? by_steps : STALE_UNCERTAIN_FLOOR_NS;
    }
    static constexpr uint64_t bad_threshold_ns(uint64_t base_step_ns)
    {
        const uint64_t by_steps = STALE_BAD_STEPS * base_step_ns;
        return by_steps > STALE_BAD_FLOOR_NS ? by_steps : STALE_BAD_FLOOR_NS;
    }

private:
    uint64_t last_ts_ns_ = 0;
    /* Mốc đồng hồ monotonic lần cuối thấy `ts_ns` đổi. 0 = chưa quan sát lần
     * nào; evaluate đầu tiên neo mốc tại đó, nên bo khởi động mà iobus chưa lên
     * vẫn thành stale sau đúng ngưỡng thời gian, không đứng GOOD mãi. */
    uint64_t last_change_ns_ = 0;
    bool     observed_ = false;
    uint32_t stale_scans_ = 0;
    uint64_t stale_age_ns_ = 0;
    bool     stale_uncertain_ = false;
    bool     stale_bad_ = false;
    uint64_t base_step_ns_ = DEFAULT_BASE_STEP_NS;
    uint64_t uncertain_after_ns_ = uncertain_threshold_ns(DEFAULT_BASE_STEP_NS);
    uint64_t bad_after_ns_ = bad_threshold_ns(DEFAULT_BASE_STEP_NS);
};

static_assert(PointQuality::uncertain_threshold_ns(10ull * 1000000ull) == 250ull * 1000000ull,
              "ADR-061 4.7: base 10 ms → stale sau 250 ms");
static_assert(PointQuality::bad_threshold_ns(10ull * 1000000ull) == 500ull * 1000000ull,
              "ADR-061 4.7: base 10 ms → T3 sau 500 ms");
static_assert(PointQuality::uncertain_threshold_ns(1000ull * 1000000ull) == 3000ull * 1000000ull,
              "base 1 s giữ đúng ngưỡng 3 step cũ");

} // namespace core

#endif /* CORE_POINT_QUALITY_HPP */
