/**
 * @file  bacnet_reliability.hpp
 * @brief BAC-008: fault/quality → BACnet Reliability enum + Status_Flags.
 *        Maps kx_quality_t + IOP fault flags to BACnet values per SW_BACNET_DESIGN §6.
 *        Pure logic — no bacnet-stack dependency.
 */
#ifndef IOBUS_BACNET_RELIABILITY_HPP
#define IOBUS_BACNET_RELIABILITY_HPP

#include <cstdint>
#include "mkddc_shm.h"
#include "iop_protocol.h"

namespace iobus::bacnet {

/**
 * BACnet Reliability property values — ASHRAE 135-2020 Table 12-4 integer encoding.
 * Values MUST match the BACnet enumeration integers sent in APDU (cast directly to uint8).
 * ADR-011: fixed OVER_RANGE..SHORTED_LOOP from wrong sequential 1-4 to ASHRAE 2-5.
 */
enum class BacnetReliability : uint8_t {
    NO_FAULT_DETECTED     = 0,
    NO_SENSOR             = 1,
    OVER_RANGE            = 2,   /* ASHRAE 2 (was 1 — BUG fixed ADR-011) */
    UNDER_RANGE           = 3,   /* ASHRAE 3 (was 2 — BUG fixed ADR-011) */
    OPEN_LOOP             = 4,   /* ASHRAE 4 (was 3 — BUG fixed ADR-011) */
    SHORTED_LOOP          = 5,   /* ASHRAE 5 (was 4 — BUG fixed ADR-011) */
    NO_OUTPUT             = 6,
    UNRELIABLE_OTHER      = 7,
    PROCESS_ERROR         = 8,
    MULTI_STATE_FAULT     = 9,
    CONFIGURATION_ERROR   = 10,
    MEMBER_FAULT          = 11,
    COMMUNICATION_FAILURE = 12,
    MONITORED_OBJECT_FAULT = 13,
};

/**
 * BACnet Status_Flags bit positions (lowest 4 bits).
 * Per §12.2 of ANSI/ASHRAE 135.
 */
struct BacnetStatusFlags {
    bool in_alarm     = false;  /* bit 0 */
    bool fault        = false;  /* bit 1 */
    bool overridden   = false;  /* bit 2 */
    bool out_of_service = false;/* bit 3 */

    uint8_t to_bits() const
    {
        return (in_alarm     ? 0x01u : 0u)
             | (fault        ? 0x02u : 0u)
             | (overridden   ? 0x04u : 0u)
             | (out_of_service ? 0x08u : 0u);
    }
};

/**
 * Compute BACnet Reliability from kx_quality_t + IOP fault flags.
 * ch_idx: channel index (0-based); reserved for future per-channel diagnostics.
 *         IOP v2 (ADR-010) FAULT_FLAGS bits 8-15 are reserved/always-0,
 *         so IOP_FAULT_UI_OV is treated as aggregate covering all 16 channels.
 *
 * Map (SW_BACNET_DESIGN §6):
 *   KX_Q_GOOD   + no fault              → NO_FAULT_DETECTED
 *   KX_Q_GOOD   + IOP_FAULT_ADC1/ADC2  → COMMUNICATION_FAILURE
 *   KX_Q_GOOD   + IOP_FAULT_UI_OV      → OVER_RANGE (any channel, aggregate)
 *   KX_Q_UNCERTAIN                      → COMMUNICATION_FAILURE
 *   KX_Q_BAD                            → COMMUNICATION_FAILURE
 */
BacnetReliability compute_reliability(kx_quality_t q, uint16_t fault_flags, int ch_idx);

/**
 * ADR-011: map kx_reliability_t (sequential 0-7) to BacnetReliability (ASHRAE integers).
 * Used by read_ai() to directly convert per-channel reliability from plc_shm.
 */
BacnetReliability kx_reliability_to_bacnet(kx_reliability_t r);

/**
 * Compute Status_Flags:
 *   fault bit = reliability != NO_FAULT_DETECTED
 *   in_alarm bit = caller supplies (from alarm manager)
 *   overridden bit = caller supplies (core returned overridden)
 *   out_of_service bit = explicit OOS set by operator
 */
BacnetStatusFlags compute_status_flags(BacnetReliability rel,
                                        bool in_alarm,
                                        bool overridden,
                                        bool out_of_service);

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_RELIABILITY_HPP */
