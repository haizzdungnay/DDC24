/**
 * @file  test_bacnet_reliability.cpp
 * @brief BAC-008 unit tests — fault/quality → Reliability + Status_Flags.
 */
#include <gtest/gtest.h>
#include "bacnet_reliability.hpp"

using namespace iobus::bacnet;

TEST(BacnetReliability, GoodQualityNoFault)
{
    const auto rel = compute_reliability(KX_Q_GOOD, 0, 0);
    EXPECT_EQ(rel, BacnetReliability::NO_FAULT_DETECTED);
}

TEST(BacnetReliability, UncertainQuality)
{
    const auto rel = compute_reliability(KX_Q_UNCERTAIN, 0, 0);
    EXPECT_EQ(rel, BacnetReliability::COMMUNICATION_FAILURE);
}

TEST(BacnetReliability, BadQuality)
{
    const auto rel = compute_reliability(KX_Q_BAD, 0, 0);
    EXPECT_EQ(rel, BacnetReliability::COMMUNICATION_FAILURE);
}

TEST(BacnetReliability, AdcFaultOverridesGood)
{
    /* IOP_FAULT_ADC1 set → COMM_FAILURE regardless of quality */
    const auto rel = compute_reliability(KX_Q_GOOD, IOP_FAULT_ADC1, 0);
    EXPECT_EQ(rel, BacnetReliability::COMMUNICATION_FAILURE);
}

TEST(BacnetReliability, UIOverRangeOnChannel0)
{
    /* IOP v2 (ADR-010): IOP_FAULT_UI_OV is aggregate — applies to all 16 channels */
    const auto rel = compute_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 0);
    EXPECT_EQ(rel, BacnetReliability::OVER_RANGE);
}

TEST(BacnetReliability, UIOverRangeOnChannel3)
{
    const auto rel = compute_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 3);
    EXPECT_EQ(rel, BacnetReliability::OVER_RANGE);
}

TEST(BacnetReliability, UIOverRangeOnChannel9)
{
    /* IOP v2: ch8-15 (second ADS131M08) must also trigger OVER_RANGE */
    const auto rel = compute_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 9);
    EXPECT_EQ(rel, BacnetReliability::OVER_RANGE);
}

TEST(BacnetReliability, UIOverRangeOnChannel15)
{
    const auto rel = compute_reliability(KX_Q_GOOD, IOP_FAULT_UI_OV, 15);
    EXPECT_EQ(rel, BacnetReliability::OVER_RANGE);
}

TEST(BacnetReliability, NoOverRangeWithoutFlag)
{
    /* IOP_FAULT_UI_OV not set → NO_FAULT_DETECTED for any channel */
    const auto rel = compute_reliability(KX_Q_GOOD, 0, 5);
    EXPECT_EQ(rel, BacnetReliability::NO_FAULT_DETECTED);
}

TEST(BacnetReliability, AdcFaultBeatsOverRange)
{
    /* Both ADC fault and OV → ADC wins (checked first) */
    const uint16_t fault = IOP_FAULT_ADC1 | IOP_FAULT_UI_OV;
    const auto rel = compute_reliability(KX_Q_GOOD, fault, 0);
    EXPECT_EQ(rel, BacnetReliability::COMMUNICATION_FAILURE);
}

TEST(BacnetStatusFlags, FaultBitSet)
{
    const auto sf = compute_status_flags(BacnetReliability::COMMUNICATION_FAILURE,
                                          false, false, false);
    EXPECT_TRUE(sf.fault);
    EXPECT_FALSE(sf.in_alarm);
    EXPECT_FALSE(sf.overridden);
    EXPECT_EQ(sf.to_bits(), 0x02u);
}

TEST(BacnetStatusFlags, NoFault)
{
    const auto sf = compute_status_flags(BacnetReliability::NO_FAULT_DETECTED,
                                          false, false, false);
    EXPECT_FALSE(sf.fault);
    EXPECT_EQ(sf.to_bits(), 0x00u);
}

TEST(BacnetStatusFlags, OverriddenAndAlarm)
{
    const auto sf = compute_status_flags(BacnetReliability::NO_FAULT_DETECTED,
                                          true, true, false);
    EXPECT_EQ(sf.to_bits(), 0x05u);   /* in_alarm(0x01) | overridden(0x04) */
}

TEST(BacnetStatusFlags, OOSBit)
{
    const auto sf = compute_status_flags(BacnetReliability::NO_FAULT_DETECTED,
                                          false, false, true);
    EXPECT_EQ(sf.to_bits(), 0x08u);
}
