#ifndef CORE_ALARM_PRIMITIVES_HPP
#define CORE_ALARM_PRIMITIVES_HPP

namespace core {

inline bool alarm_high_step(float pv, float limit, float hysteresis, bool previous)
{
    return previous ? (pv > limit - hysteresis) : (pv > limit);
}

inline bool alarm_low_step(float pv, float limit, float hysteresis, bool previous)
{
    return previous ? (pv < limit + hysteresis) : (pv < limit);
}

inline bool alarm_delay_step(bool input, float dt_s, float on_delay_s, float off_delay_s,
                             bool* state, float* acc_s)
{
    if (input) {
        if (!*state) {
            *acc_s += dt_s;
            if (*acc_s >= on_delay_s) {
                *state = true;
                *acc_s = 0.0f;
            }
        } else {
            *acc_s = 0.0f;
        }
    } else {
        if (*state) {
            *acc_s += dt_s;
            if (*acc_s >= off_delay_s) {
                *state = false;
                *acc_s = 0.0f;
            }
        } else {
            *acc_s = 0.0f;
        }
    }
    return *state;
}

struct RuntimeCounterStep {
    double hours = 0.0;
    bool alarm = false;
    bool dirty = false;
};

inline RuntimeCounterStep runtime_counter_step(bool run, bool reset, float dt_s,
                                               double maint_hours, double* seconds,
                                               bool* prev_reset)
{
    RuntimeCounterStep result;
    if (reset && !*prev_reset) {
        result.dirty = *seconds != 0.0;
        *seconds = 0.0;
    }
    *prev_reset = reset;
    if (run && !reset) {
        *seconds += static_cast<double>(dt_s);
        result.dirty = true;
    }
    result.hours = *seconds / 3600.0;
    result.alarm = maint_hours > 0.0 && result.hours >= maint_hours;
    return result;
}

} // namespace core

#endif /* CORE_ALARM_PRIMITIVES_HPP */
