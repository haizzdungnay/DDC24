/**
 * @file  overrun_monitor.hpp
 * @brief Đánh giá sức khoẻ thời gian của một Task và quyết định KHI NÀO cần
 *        chuyển safe-state, theo PROGRAM_TASK_SCHEDULER_SPEC §6.
 *
 *        VÌ SAO KHÔNG ĐẶT TRONG CoreMetrics:
 *        `CoreMetrics` là observability thuần tuý — thứ có thể tắt, lấy mẫu
 *        thưa, hoặc hỏng mà hệ vẫn phải điều khiển đúng. Đặt ngưỡng an toàn
 *        vào đó khiến một thành phần KHÔNG thiết yếu nắm quyền THIẾT YẾU, và
 *        làm chính sách an toàn không test được độc lập với bộ đếm.
 *        Vì vậy: `CoreMetrics` chỉ đếm/đo; `OverrunMonitor` (file này) đánh
 *        giá; `SafetyManager` quyết định; `AlarmRuntime` báo.
 *
 *        Component này KHÔNG tự ép output — nó chỉ trả lời "có nên vào safe
 *        không". Quyền ép output thuộc SafetyManager/SafeState.
 */
#ifndef CORE_OVERRUN_MONITOR_HPP
#define CORE_OVERRUN_MONITOR_HPP

#include <cstdint>

namespace core {

struct OverrunStats {
    uint32_t total = 0;          /* tổng số lần overrun từ khi khởi động */
    uint32_t consecutive = 0;    /* số lần overrun liên tiếp hiện tại */
    uint32_t recovery_streak = 0;/* số lần chạy trong budget liên tiếp khi đang safe */
    uint64_t last_exec_ns = 0;
    uint64_t max_exec_ns = 0;
};

class OverrunMonitor {
public:
    /* threshold: số lần overrun LIÊN TIẾP để chuyển safe. Ngưỡng < 1 bị kẹp
     * về 1 — ngưỡng 0 nghĩa là "safe ngay cả khi không overrun", vô nghĩa. */
    explicit OverrunMonitor(uint32_t threshold = 3)
        : threshold_(threshold < 1 ? 1 : threshold) {}

    /* Ghi nhận kết quả thời gian của một lần chạy Task. */
    void record(uint64_t exec_ns, uint64_t budget_ns);

    /* Reset khi Task bị disable/stop — tránh mang số đếm cũ sang lần chạy sau. */
    void reset();

    /* true = đã đủ điều kiện chuyển safe-state và CHƯA hồi phục đủ để ra. */
    bool should_force_safe() const { return forcing_safe_; }

    /* true ngay lần overrun đầu tiên — dùng để raise alarm mức warning. */
    bool overrun_active() const { return stats_.consecutive > 0; }

    uint32_t threshold() const { return threshold_; }
    const OverrunStats& stats() const { return stats_; }

private:
    uint32_t     threshold_;
    bool         forcing_safe_ = false;
    OverrunStats stats_;
};

} // namespace core

#endif /* CORE_OVERRUN_MONITOR_HPP */
