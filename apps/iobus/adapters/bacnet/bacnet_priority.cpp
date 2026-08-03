/**
 * @file  bacnet_priority.cpp
 * @brief BAC-006: Priority_Array[16] per commandable object.
 *        Không depend on bacnet-stack — pure logic.
 */
#include "bacnet_priority.hpp"
#include <cstring>

namespace iobus::bacnet {

BacnetPriority::BacnetPriority()
{
    for (int i = 0; i < N_AO;  i++) ao_applied_[i]  = 0.0f;
    for (int i = 0; i < N_BO;  i++) bo_applied_[i]  = 0.0f;
    for (int i = 0; i < N_AV;  i++) av_applied_[i]  = 0.0f;
    for (int i = 0; i < N_BV;  i++) bv_applied_[i]  = 0.0f;
    for (int i = 0; i < N_MSV; i++) msv_applied_[i] = 0.0f;
}

int BacnetPriority::max_count(CmdObjectType type) const
{
    switch (type) {
        case CmdObjectType::AO:  return N_AO;
        case CmdObjectType::BO:  return N_BO;
        case CmdObjectType::AV:  return N_AV;
        case CmdObjectType::BV:  return N_BV;
        case CmdObjectType::MSV: return N_MSV;
    }
    return 0;
}

PriorityArray* BacnetPriority::get_array_rw(CmdObjectType type, uint32_t instance)
{
    /* instance 1-based */
    if (instance < 1) return nullptr;
    const int idx = static_cast<int>(instance) - 1;
    switch (type) {
        case CmdObjectType::AO:  return idx < N_AO  ? &ao_[idx]  : nullptr;
        case CmdObjectType::BO:  return idx < N_BO  ? &bo_[idx]  : nullptr;
        case CmdObjectType::AV:  return idx < N_AV  ? &av_[idx]  : nullptr;
        case CmdObjectType::BV:  return idx < N_BV  ? &bv_[idx]  : nullptr;
        case CmdObjectType::MSV: return idx < N_MSV ? &msv_[idx] : nullptr;
    }
    return nullptr;
}

const PriorityArray* BacnetPriority::get_array(CmdObjectType type, uint32_t instance) const
{
    return const_cast<BacnetPriority*>(this)->get_array_rw(type, instance);
}

float* BacnetPriority::get_applied(CmdObjectType type, uint32_t instance)
{
    if (instance < 1) return nullptr;
    const int idx = static_cast<int>(instance) - 1;
    switch (type) {
        case CmdObjectType::AO:  return idx < N_AO  ? &ao_applied_[idx]  : nullptr;
        case CmdObjectType::BO:  return idx < N_BO  ? &bo_applied_[idx]  : nullptr;
        case CmdObjectType::AV:  return idx < N_AV  ? &av_applied_[idx]  : nullptr;
        case CmdObjectType::BV:  return idx < N_BV  ? &bv_applied_[idx]  : nullptr;
        case CmdObjectType::MSV: return idx < N_MSV ? &msv_applied_[idx] : nullptr;
    }
    return nullptr;
}

bool BacnetPriority::write(CmdObjectType type, uint32_t instance, uint8_t prio, float value)
{
    PriorityArray* arr = get_array_rw(type, instance);
    float* appl = get_applied(type, instance);
    if (!arr || !appl) return false;

    const float prev_winner = arr->winner();
    arr->set(prio, value);
    const float new_winner = arr->winner();

    /* Winner thay đổi hoặc là lần đầu → caller cần gửi lên core.sock */
    const bool changed = (prev_winner != new_winner) || prio_is_null(prev_winner);
    if (changed) *appl = new_winner;
    return changed;
}

bool BacnetPriority::relinquish(CmdObjectType type, uint32_t instance, uint8_t prio)
{
    PriorityArray* arr = get_array_rw(type, instance);
    float* appl = get_applied(type, instance);
    if (!arr || !appl) return false;

    const float prev_winner = arr->winner();
    arr->clear(prio);
    const float new_winner = arr->winner();

    const bool changed = (prev_winner != new_winner);
    if (changed) *appl = new_winner;
    return changed;
}

void BacnetPriority::set_relinquish_default(CmdObjectType type, uint32_t instance, float v)
{
    PriorityArray* arr = get_array_rw(type, instance);
    if (arr) arr->relinquish_default = v;
}

void BacnetPriority::on_overridden(CmdObjectType type, uint32_t instance, float applied_value)
{
    /* Core rejected our winner (safety/manual > BACnet prio 3).
     * Keep Priority_Array intact — BACnet spec says array is maintained regardless.
     * Only update applied_value to reflect what core actually applied. */
    float* appl = get_applied(type, instance);
    if (appl) *appl = applied_value;
}

float BacnetPriority::applied_value(CmdObjectType type, uint32_t instance) const
{
    const float* appl = const_cast<BacnetPriority*>(this)->get_applied(type, instance);
    if (!appl) return 0.0f;
    return *appl;
}

} // namespace iobus::bacnet
