/**
 * @file  bacnet_cov.cpp
 * @brief BAC-007 implementation.
 */
#include "bacnet_cov.hpp"
#include <cmath>
#include <algorithm>

namespace iobus::bacnet {

bool BacnetCov::subscribe(const CovSubscription& sub)
{
    /* Update nếu đã tồn tại cùng subscriber + object. */
    for (auto& s : subs_) {
        if (s.subscriber_process_id == sub.subscriber_process_id
            && s.obj_type == sub.obj_type
            && s.obj_instance == sub.obj_instance)
        {
            s = sub;
            s.active = true;
            return true;
        }
    }
    if (static_cast<int>(subs_.size()) >= MAX_SUBS) return false;
    subs_.push_back(sub);
    subs_.back().active = true;
    return true;
}

bool BacnetCov::unsubscribe(uint32_t subscriber_process_id,
                             BacnetObjectType obj_type,
                             uint32_t obj_instance)
{
    for (auto& s : subs_) {
        if (s.subscriber_process_id == subscriber_process_id
            && s.obj_type == obj_type
            && s.obj_instance == obj_instance)
        {
            s.active = false;
            return true;
        }
    }
    return false;
}

void BacnetCov::expire_subs(uint64_t now_ms)
{
    subs_.erase(
        std::remove_if(subs_.begin(), subs_.end(),
            [now_ms](const CovSubscription& s) {
                return !s.active || (s.expiry_ms > 0 && now_ms >= s.expiry_ms);
            }),
        subs_.end());
}

ObjectCovState& BacnetCov::get_state(BacnetObjectType obj_type, uint32_t obj_instance)
{
    for (auto& st : states_)
        if (st.obj_type == obj_type && st.obj_instance == obj_instance) return st;
    states_.push_back({obj_type, obj_instance});
    return states_.back();
}

void BacnetCov::set_cov_increment(BacnetObjectType obj_type, uint32_t obj_instance, float increment)
{
    get_state(obj_type, obj_instance).cov_increment = increment;
}

std::vector<const CovSubscription*> BacnetCov::check_and_update(
    BacnetObjectType obj_type,
    uint32_t obj_instance,
    float new_value,
    uint8_t new_status)
{
    ObjectCovState& st = get_state(obj_type, obj_instance);

    bool triggered = false;
    if (is_analog(obj_type)) {
        const float prev = st.last_reported_value;
        const bool first = std::isnan(prev);
        if (first || std::fabs(new_value - prev) >= st.cov_increment)
            triggered = true;
    } else {
        /* Digital/MSV: state change = value OR status changed. */
        const bool first = std::isnan(st.last_reported_value);
        if (first || new_value != st.last_reported_value
                  || new_status != st.last_reported_status)
            triggered = true;
    }

    if (!triggered) return {};

    st.last_reported_value  = new_value;
    st.last_reported_status = new_status;

    std::vector<const CovSubscription*> result;
    for (const auto& s : subs_) {
        if (s.active && s.obj_type == obj_type && s.obj_instance == obj_instance)
            result.push_back(&s);
    }
    return result;
}

} // namespace iobus::bacnet
