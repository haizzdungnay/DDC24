/**
 * @file  bacnet_reliability.cpp
 * @brief BAC-008 implementation.
 */
#include "bacnet_reliability.hpp"

namespace iobus::bacnet {

BacnetReliability compute_reliability(kx_quality_t q, uint16_t fault_flags, int ch_idx)
{
    /* Channel UI over-range uses per-channel bit at fault_flags[8+ch_idx]. */
    if ((fault_flags & IOP_FAULT_ADC) != 0)
        return BacnetReliability::COMMUNICATION_FAILURE;

    const uint16_t ch_ov_bit = (ch_idx >= 0 && ch_idx < 8)
                                ? static_cast<uint16_t>(1u << (8 + ch_idx))
                                : 0u;
    if (ch_ov_bit && (fault_flags & ch_ov_bit) && (fault_flags & IOP_FAULT_UI_OV))
        return BacnetReliability::OVER_RANGE;

    switch (q) {
        case KX_Q_GOOD:      return BacnetReliability::NO_FAULT_DETECTED;
        case KX_Q_UNCERTAIN: return BacnetReliability::COMMUNICATION_FAILURE;
        case KX_Q_BAD:       return BacnetReliability::COMMUNICATION_FAILURE;
        default:             return BacnetReliability::NO_FAULT_DETECTED;
    }
}

BacnetStatusFlags compute_status_flags(BacnetReliability rel,
                                        bool in_alarm,
                                        bool overridden,
                                        bool out_of_service)
{
    BacnetStatusFlags f;
    f.fault         = (rel != BacnetReliability::NO_FAULT_DETECTED);
    f.in_alarm      = in_alarm;
    f.overridden    = overridden;
    f.out_of_service = out_of_service;
    return f;
}

} // namespace iobus::bacnet
