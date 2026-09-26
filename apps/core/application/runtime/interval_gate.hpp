/**
 * @file  interval_gate.hpp
 * @brief Cổng "tối đa một lần mỗi khoảng" đo bằng ĐỒNG HỒ, không bằng số vòng
 *        quét.
 *
 *        ADR-061 4.8: ở base step 10 ms, những việc trước đây gắn vào "mỗi scan"
 *        (kick watchdog systemd) hoặc "mỗi 60 scan" (ghi snapshot persist của
 *        graph) nhân tốc độ lên 100 lần mà không thêm bảo vệ nào. Cổng này giữ
 *        đúng nhịp thời gian đã thiết kế bất kể base step. Không cấp phát, không
 *        khoá — gọi từ luồng quét.
 */
#ifndef CORE_INTERVAL_GATE_HPP
#define CORE_INTERVAL_GATE_HPP

#include <cstdint>

namespace core {

class IntervalGate {
public:
    explicit IntervalGate(uint64_t interval_ns) : interval_ns_(interval_ns) {}

    /* Neo mốc mà KHÔNG mở cổng: lần mở đầu tiên sau `interval` kể từ `now_ns`
     * (dùng cho việc định kỳ không cần chạy ngay, ví dụ ghi snapshot). */
    void arm(uint64_t now_ns)
    {
        last_ns_ = now_ns;
        armed_ = true;
    }

    /* true (và dời mốc) khi đã qua ít nhất `interval` kể từ lần mở trước. Chưa
     * từng neo thì mở NGAY — watchdog phải được kick ở scan đầu tiên. Đồng hồ
     * lùi (không xảy ra với CLOCK_MONOTONIC) coi như tới hạn thay vì kẹt cổng. */
    bool due(uint64_t now_ns)
    {
        if (armed_ && now_ns >= last_ns_ && now_ns - last_ns_ < interval_ns_) return false;
        last_ns_ = now_ns;
        armed_ = true;
        return true;
    }

    uint64_t interval_ns() const { return interval_ns_; }

private:
    uint64_t interval_ns_;
    uint64_t last_ns_ = 0;
    bool     armed_ = false;
};

} // namespace core

#endif /* CORE_INTERVAL_GATE_HPP */
