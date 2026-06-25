/**
 * @file  bacnet_reliability.cpp
 * @brief BAC-008 implementation.
 */
#include "bacnet_reliability.hpp"

namespace iobus::bacnet {

BacnetReliability compute_reliability(kx_quality_t q, uint16_t fault_flags, int ch_idx)
{
    if ((fault_flags & (IOP_FAULT_ADC1 | IOP_FAULT_ADC2)) != 0)
        return BacnetReliability::COMMUNICATION_FAILURE;

    /* IOP v2 (ADR-010): FAULT_FLAGS bits 8-15 are reserved/always-0.
     * Aggregate IOP_FAULT_UI_OV covers all 16 channels — no per-channel bit lookup. */
    (void)ch_idx;
    if (fault_flags & IOP_FAULT_UI_OV)
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
