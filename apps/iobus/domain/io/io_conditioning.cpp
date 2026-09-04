/**
 * @file io_conditioning.cpp
 * @brief Cưỡng chế deadband/clamp/failure-value cho UI — xem io_conditioning.hpp.
 */
#include "io/io_conditioning.hpp"

#include <cmath>
#include <cstring>

namespace iobus {

UiFailureMode ui_failure_mode_from_string(const char* s)
{
    if (s == nullptr) return UiFailureMode::INVALID;
    if (std::strcmp(s, "hold") == 0)  return UiFailureMode::HOLD;
    if (std::strcmp(s, "fixed") == 0) return UiFailureMode::FIXED;
    return UiFailureMode::INVALID;
}

const char* ui_failure_mode_name(UiFailureMode m)
{
    switch (m) {
    case UiFailureMode::HOLD:  return "hold";
    case UiFailureMode::FIXED: return "fixed";
    default:                   return "invalid";
    }
}

void apply_fault_mask(const UiScaleConfig& cfg, kx_quality_t* q, kx_reliability_t* r)
{
    if (q == nullptr || r == nullptr) return;
    if (*q == KX_Q_GOOD) return;

    const bool is_range = (*r == KX_REL_OVER_RANGE || *r == KX_REL_UNDER_RANGE);
    const bool is_loop  = (*r == KX_REL_OPEN_LOOP  || *r == KX_REL_SHORTED_LOOP);
    if ((is_range && !cfg.range_fault_enabled) || (is_loop && !cfg.loop_fault_enabled)) {
        *q = KX_Q_GOOD;
        *r = KX_REL_RELIABLE;
    }
}

float apply_clamp(const UiScaleConfig& cfg, float value)
{
    if (!cfg.clamp_enabled) return value;
    if (!(cfg.clamp_min < cfg.clamp_max)) return value; /* dải hỏng ⇒ không kẹp */
    if (value < cfg.clamp_min) return cfg.clamp_min;
    if (value > cfg.clamp_max) return cfg.clamp_max;
    return value;
}

float apply_deadband(const UiScaleConfig& cfg, const UiConditioningState& st, float value)
{
    if (!(cfg.deadband > 0.0f)) return value;
    if (!st.has_published) return value;
    if (std::fabs(value - st.last_published) < cfg.deadband) return st.last_published;
    return value;
}

float apply_failure_value(const UiScaleConfig& cfg, const UiConditioningState& st,
                          kx_quality_t q, float value)
{
    if (q == KX_Q_GOOD) return value;
    switch (cfg.failure_mode) {
    case UiFailureMode::HOLD:
        /* Chưa từng có mẫu GOOD nào thì không có gì để giữ — trả giá trị vừa
         * tính, quality BAD vẫn nói đúng sự thật cho tầng trên. */
        return st.has_good ? st.last_good : value;
    case UiFailureMode::FIXED:
        return cfg.failure_value;
    default:
        return value;
    }
}

float condition_ui_sample(const UiScaleConfig& cfg, UiConditioningState* st,
                          kx_quality_t* q, kx_reliability_t* r, float value)
{
    apply_fault_mask(cfg, q, r);
    const kx_quality_t quality = (q != nullptr) ? *q : KX_Q_BAD;

    if (quality == KX_Q_GOOD) {
        value = apply_clamp(cfg, value);
        if (st != nullptr) {
            value = apply_deadband(cfg, *st, value);
            st->last_good = value;
            st->has_good = true;
        }
    } else if (st != nullptr) {
        value = apply_failure_value(cfg, *st, quality, value);
    }

    if (st != nullptr) {
        st->last_published = value;
        st->has_published = true;
    }
    return value;
}

} // namespace iobus
