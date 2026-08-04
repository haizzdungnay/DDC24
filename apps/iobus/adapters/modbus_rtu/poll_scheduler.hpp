/**
 * @file  poll_scheduler.hpp
 * @brief MOD-005: per-slave due-time, retry, offline detect.
 *        Timeout: 300ms/retry (MODBUS_REGISTER_MAP §2). Retry 2 lần → offline.
 */
#ifndef IOBUS_POLL_SCHEDULER_HPP
#define IOBUS_POLL_SCHEDULER_HPP

#include <cstdint>

namespace iobus::fieldbus {

/* Chu kỳ thử lại một slave đang OFFLINE (D-04).
 * 5 s: đủ thưa để không chiếm dây, đủ dày để phát hiện thiết bị hồi phục trong
 * thời gian người vận hành còn đứng cạnh tủ. */
constexpr uint32_t kDefaultOfflineProbeMs = 5000;

struct SlaveState {
    uint64_t last_poll_ms    = 0;     /* monotonic ms của lần poll gần nhất */
    uint32_t poll_interval_ms = 1000;
    /* D-04: nhịp thử lại khi slave OFFLINE. Tách khỏi poll_interval_ms để một
     * thiết bị chết không chiếm dây theo nhịp của thiết bị sống. */
    uint32_t offline_probe_ms = kDefaultOfflineProbeMs;
    uint8_t  retry_count     = 0;
    bool     online          = false;
    /* metrics */
    uint32_t total_polls    = 0;
    uint32_t total_errors   = 0;
};

/* Chu kỳ hiệu lực: poll_interval_ms khi ONLINE, offline_probe_ms khi OFFLINE. */
uint32_t effective_interval_ms(const SlaveState& s);

/* Trả true nếu slave này đến hạn poll (now_ms - last >= chu kỳ hiệu lực). */
bool is_due(const SlaveState& s, uint64_t now_ms);

/* Báo cáo poll thành công → reset retry, đánh online, cập nhật last_poll. */
void on_poll_ok(SlaveState* s, uint64_t now_ms);

/* Báo cáo poll lỗi → tăng retry và CẬP NHẬT last_poll_ms (D-04).
 *
 * Vì sao phải cập nhật last_poll_ms ở đường lỗi: trước bản sửa 2026-08-04 hàm
 * này không đụng tới last_poll_ms, nên một slave chết luôn thoả is_due() và
 * được read_slave() gọi ở MỌI vòng poll, mỗi lần chiếm dây trọn timeout_ms. Với
 * 8 slave chết ở timeout 300 ms, mỗi vòng tiêu 2,4 giây chỉ để chờ hết giờ và
 * slave tốt có poll 1000 ms trượt deadline liên tục. Đó là một cơ chế bỏ đói
 * đang hoạt động, không phải chỉ là thiếu tính năng probe chậm.
 *
 * Trả true nếu vừa chuyển sang offline. */
bool on_poll_error(SlaveState* s, uint8_t max_retry = 2, uint64_t now_ms = 0);

/* Error rate trong khoảng [0..1] = total_errors / total_polls (0 khi total=0). */
float error_rate(const SlaveState& s);

/* Tính sleep_ms tới lần poll kế (min 0, max interval_ms). */
uint32_t next_due_ms(const SlaveState& s, uint64_t now_ms);

} // namespace iobus::fieldbus

#endif /* IOBUS_POLL_SCHEDULER_HPP */
