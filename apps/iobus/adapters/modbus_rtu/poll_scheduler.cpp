/**
 * @file  poll_scheduler.cpp
 * @brief MOD-005: poll timing + retry + offline logic.
 */
#include "poll_scheduler.hpp"

namespace iobus::fieldbus {

uint32_t effective_interval_ms(const SlaveState& s)
{
    /* D-04: slave OFFLINE chuyển sang nhịp probe chậm. Chỉ áp dụng khi đã từng
     * poll (last_poll_ms != 0) — lần đầu vẫn phải thử ngay để thiết bị lên sớm. */
    if (!s.online && s.last_poll_ms != 0 && s.offline_probe_ms > s.poll_interval_ms)
        return s.offline_probe_ms;
    return s.poll_interval_ms;
}

bool is_due(const SlaveState& s, uint64_t now_ms)
{
    if (s.last_poll_ms == 0) return true;   /* chưa từng poll */
    if (now_ms < s.last_poll_ms) return true;  /* clock nhảy lùi: thử ngay */
    return (now_ms - s.last_poll_ms) >= effective_interval_ms(s);
}

void on_poll_ok(SlaveState* s, uint64_t now_ms)
{
    s->retry_count  = 0;
    s->online       = true;
    s->last_poll_ms = now_ms;
    s->total_polls++;
}

bool on_poll_error(SlaveState* s, uint8_t max_retry, uint64_t now_ms)
{
    if (max_retry == 0) max_retry = 1;
    s->retry_count++;
    s->total_polls++;
    s->total_errors++;
    /* D-04: đánh dấu đã dùng lượt của mình trên dây, kể cả khi lượt đó thất bại.
     * Không làm việc này thì slave chết sẽ được thử lại ngay ở vòng kế. */
    if (now_ms != 0) s->last_poll_ms = now_ms;
    if (s->retry_count >= max_retry && s->online) {
        s->online = false;
        return true;   /* vừa chuyển offline */
    }
    if (s->retry_count >= max_retry) s->online = false;
    return false;
}

float error_rate(const SlaveState& s)
{
    if (s.total_polls == 0) return 0.0f;
    return static_cast<float>(s.total_errors) / static_cast<float>(s.total_polls);
}

uint32_t next_due_ms(const SlaveState& s, uint64_t now_ms)
{
    if (s.last_poll_ms == 0) return 0;
    if (now_ms < s.last_poll_ms) return 0;
    const uint32_t interval = effective_interval_ms(s);
    const uint64_t elapsed = now_ms - s.last_poll_ms;
    if (elapsed >= interval) return 0;
    return static_cast<uint32_t>(interval - elapsed);
}

} // namespace iobus::fieldbus
