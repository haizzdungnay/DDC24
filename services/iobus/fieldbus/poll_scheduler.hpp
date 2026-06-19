/**
 * @file  poll_scheduler.hpp
 * @brief MOD-005: per-slave due-time, retry, offline detect.
 *        Timeout: 300ms/retry (MODBUS_REGISTER_MAP §2). Retry 2 lần → offline.
 */
#ifndef IOBUS_POLL_SCHEDULER_HPP
#define IOBUS_POLL_SCHEDULER_HPP

#include <cstdint>

namespace iobus::fieldbus {

struct SlaveState {
    uint64_t last_poll_ms    = 0;     /* monotonic ms của lần poll gần nhất */
    uint32_t poll_interval_ms = 1000;
    uint8_t  retry_count     = 0;
    bool     online          = false;
    /* metrics */
    uint32_t total_polls    = 0;
    uint32_t total_errors   = 0;
};

/* Trả true nếu slave này đến hạn poll (now_ms - last >= interval). */
bool is_due(const SlaveState& s, uint64_t now_ms);

/* Báo cáo poll thành công → reset retry, đánh online, cập nhật last_poll. */
void on_poll_ok(SlaveState* s, uint64_t now_ms);

/* Báo cáo poll lỗi → tăng retry.
 * Trả true nếu vừa chuyển sang offline (retry >= 2 → offline). */
bool on_poll_error(SlaveState* s);

/* Error rate trong khoảng [0..1] = total_errors / total_polls (0 khi total=0). */
float error_rate(const SlaveState& s);

/* Tính sleep_ms tới lần poll kế (min 0, max interval_ms). */
uint32_t next_due_ms(const SlaveState& s, uint64_t now_ms);

} // namespace iobus::fieldbus

#endif /* IOBUS_POLL_SCHEDULER_HPP */
