/**
 * @file  poll_scheduler.cpp
 * @brief MOD-005: poll timing + retry + offline logic.
 */
#include "poll_scheduler.hpp"

namespace iobus::fieldbus {

static constexpr uint8_t MAX_RETRY = 2;

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

bool on_poll_error(SlaveState* s)
{
    s->retry_count++;
    s->total_polls++;
    s->total_errors++;
    if (s->retry_count >= MAX_RETRY && s->online) {
        s->online = false;
        return true;   /* vừa chuyển offline */
    }
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
