/**
 * @file  base_step_pacer.hpp
 * @brief ADR-061 C4 / 4.9 — nhịp base step theo lưới tuyệt đối và metric lệch
 *        nhịp đánh thức.
 *
 *        Lưới: mốc thứ k = t0 + k × base_step. Vòng quét ngủ `TIMER_ABSTIME`
 *        tới mốc kế tiếp, nên không trôi.
 *
 *        Ba bộ đếm công bố qua `task` của `point_snapshot`:
 *          - `jitterMaxUs`: lệch đánh thức lớn nhất trong 60 s gần nhất (µs, làm
 *            tròn LÊN để 100,4 µs không hiện thành "100" trong khi đã tính là
 *            vi phạm).
 *          - `jitterViolationCount`: số lần thức dậy lệch > 100 µs so với mốc
 *            tuyệt đối (tích luỹ).
 *          - `missedBaseStepCount`: số mốc lưới đã trôi qua mà KHÔNG có step nào
 *            chạy cho nó (tích luỹ) — tick bị trễ >= 1 base step.
 *
 *        Chính sách trễ (SPEC §4, "lỡ thì BỎ, không chạy bù"): khi đã trễ >= 1
 *        base step, mọi mốc đã qua bị BỎ và vòng quét nhảy tới mốc lưới kế tiếp
 *        trong TƯƠNG LAI. Chạy dồn các tick đã lỡ làm vòng quét chạy liên tiếp
 *        không nghỉ đúng lúc nó đang quá tải, và làm "10 ms" của Program co lại
 *        thành vài trăm µs.
 *
 *        Không cấp phát, không khoá: mọi trạng thái là mảng tĩnh; gọi từ luồng
 *        RT mỗi base step.
 */
#ifndef CORE_BASE_STEP_PACER_HPP
#define CORE_BASE_STEP_PACER_HPP

#include <array>
#include <cstddef>
#include <cstdint>

namespace core {

struct BaseStepTimingSnapshot {
    uint64_t base_step_ns = 0;
    uint32_t jitter_max_us = 0;
    uint64_t jitter_violation_count = 0;
    uint64_t missed_base_step_count = 0;
    uint64_t wake_count = 0;
};

/* Thống kê giữa hai lần log phút `core.jitter` — tách khỏi metric tích luỹ vì
 * log reset mỗi phút còn metric thì không. */
struct BaseStepJitterMinute {
    uint64_t count = 0;
    uint64_t min_ns = 0;
    uint64_t max_ns = 0;
    uint64_t sum_ns = 0;
};

class BaseStepPacer {
public:
    /* C4: lệch nhịp đánh thức <= 100 µs ở mọi base step. */
    static constexpr uint64_t kJitterLimitNs = 100000ull;
    static constexpr uint64_t kSecondNs = 1000000000ull;
    static constexpr std::size_t kWindowSeconds = 60;

    explicit BaseStepPacer(uint64_t base_step_ns = 10000000ull) : base_step_ns_(base_step_ns) {}

    /* Neo lưới tại `now_ns`: mốc đầu tiên chính là thời điểm bắt đầu. */
    void start(uint64_t base_step_ns, uint64_t now_ns)
    {
        base_step_ns_ = base_step_ns != 0 ? base_step_ns : 1ull;
        deadline_ns_ = now_ns;
        started_ = true;
    }

    uint64_t base_step_ns() const { return base_step_ns_; }
    uint64_t deadline_ns() const { return deadline_ns_; }
    bool started() const { return started_; }

    /* Gọi NGAY khi thức dậy cho mốc `deadline_ns()`, trước step(). Ghi lệch và
     * đếm vi phạm. Nếu trễ >= 1 base step, các mốc đã qua bị bỏ: tick này chạy
     * cho mốc lưới gần nhất <= now, số mốc bị bỏ cộng vào `missed`. */
    void on_wake(uint64_t now_ns)
    {
        if (!started_) start(base_step_ns_, now_ns);
        const uint64_t jitter_ns =
            now_ns >= deadline_ns_ ? now_ns - deadline_ns_ : deadline_ns_ - now_ns;
        record_jitter(now_ns, jitter_ns);
        if (now_ns >= deadline_ns_) {
            const uint64_t skipped = (now_ns - deadline_ns_) / base_step_ns_;
            if (skipped > 0) {
                missed_base_step_count_ += skipped;
                deadline_ns_ += skipped * base_step_ns_;
            }
        }
    }

    /* Gọi sau step() (và mọi việc sau step): trả mốc để ngủ tới. Mốc kế tiếp
     * mà đã ở quá khứ (step chạy quá một base step) thì BỎ mọi mốc đã qua và
     * nhảy tới mốc lưới đầu tiên trong tương lai. */
    uint64_t advance(uint64_t now_ns)
    {
        uint64_t next = deadline_ns_ + base_step_ns_;
        if (now_ns >= next) {
            const uint64_t skipped = (now_ns - next) / base_step_ns_ + 1u;
            missed_base_step_count_ += skipped;
            next += skipped * base_step_ns_;
        }
        deadline_ns_ = next;
        return next;
    }

    BaseStepTimingSnapshot snapshot() const
    {
        BaseStepTimingSnapshot out;
        out.base_step_ns = base_step_ns_;
        out.jitter_max_us = jitter_window_max_us();
        out.jitter_violation_count = jitter_violation_count_;
        out.missed_base_step_count = missed_base_step_count_;
        out.wake_count = wake_count_;
        return out;
    }

    /* Lệch lớn nhất trong 60 s tính tới lần thức dậy gần nhất, µs làm tròn lên. */
    uint32_t jitter_window_max_us() const
    {
        if (wake_count_ == 0) return 0;
        const uint64_t now_second = last_wake_ns_ / kSecondNs;
        uint64_t worst = 0;
        for (std::size_t index = 0; index < kWindowSeconds; ++index) {
            if (!bucket_used_[index]) continue;
            if (now_second - bucket_second_[index] >= kWindowSeconds) continue;
            if (bucket_max_ns_[index] > worst) worst = bucket_max_ns_[index];
        }
        const uint64_t us = (worst + 999ull) / 1000ull;
        return us > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(us);
    }

    const BaseStepJitterMinute& minute() const { return minute_; }
    void reset_minute() { minute_ = BaseStepJitterMinute{}; }

private:
    void record_jitter(uint64_t now_ns, uint64_t jitter_ns)
    {
        ++wake_count_;
        last_wake_ns_ = now_ns;
        if (jitter_ns > kJitterLimitNs) ++jitter_violation_count_;

        const uint64_t second = now_ns / kSecondNs;
        const std::size_t index = static_cast<std::size_t>(second % kWindowSeconds);
        if (!bucket_used_[index] || bucket_second_[index] != second) {
            bucket_used_[index] = true;
            bucket_second_[index] = second;
            bucket_max_ns_[index] = 0;
        }
        if (jitter_ns > bucket_max_ns_[index]) bucket_max_ns_[index] = jitter_ns;

        if (minute_.count == 0 || jitter_ns < minute_.min_ns) minute_.min_ns = jitter_ns;
        if (jitter_ns > minute_.max_ns) minute_.max_ns = jitter_ns;
        minute_.sum_ns += jitter_ns;
        ++minute_.count;
    }

    uint64_t base_step_ns_;
    uint64_t deadline_ns_ = 0;
    bool     started_ = false;
    uint64_t last_wake_ns_ = 0;
    uint64_t wake_count_ = 0;
    uint64_t jitter_violation_count_ = 0;
    uint64_t missed_base_step_count_ = 0;
    /* Cửa sổ 60 s = 60 ô một giây; ô được tái dùng khi giây của nó đã rời cửa sổ. */
    std::array<uint64_t, kWindowSeconds> bucket_second_{};
    std::array<uint64_t, kWindowSeconds> bucket_max_ns_{};
    std::array<bool, kWindowSeconds> bucket_used_{};
    BaseStepJitterMinute minute_{};
};

} // namespace core

#endif /* CORE_BASE_STEP_PACER_HPP */
