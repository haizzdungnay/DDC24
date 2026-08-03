/**
 * @file  poll_scheduler.cpp
 * @brief MOD-005: poll timing + retry + offline logic.
 */
#include "poll_scheduler.hpp"

namespace iobus::fieldbus {

bool is_due(const SlaveState& s, uint64_t now_ms)
{
    if (s.last_poll_ms == 0) return true;   /* belum pernah poll */
    return (now_ms - s.last_poll_ms) >= s.poll_interval_ms;
}

void on_poll_ok(SlaveState* s, uint64_t now_ms)
{
    s->retry_count  = 0;
    s->online       = true;
    s->last_poll_ms = now_ms;
    s->total_polls++;
}

bool on_poll_error(SlaveState* s, uint8_t max_retry)
{
    if (max_retry == 0) max_retry = 1;
    s->retry_count++;
    s->total_polls++;
    s->total_errors++;
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
    const uint64_t elapsed = now_ms - s.last_poll_ms;
    if (elapsed >= s.poll_interval_ms) return 0;
    return static_cast<uint32_t>(s.poll_interval_ms - elapsed);
}

} // namespace iobus::fieldbus
