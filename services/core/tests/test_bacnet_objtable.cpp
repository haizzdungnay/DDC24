/**
 * @file  test_bacnet_objtable.cpp
 * @brief BAC-004 unit tests — quality_to_reliability mapping + publish behavior.
 */
#include <gtest/gtest.h>
#include "bacnet_objtable.hpp"
#include "mkddc_shm.h"
#include "iop_protocol.h"

using namespace core;

/* ---- quality_to_reliability ---- */

TEST(BacnetObjtable, GoodQualityNoFault)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, 0, 0), 0u);  /* NO_FAULT */
}

TEST(BacnetObjtable, UncertainQuality)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_UNCERTAIN, 0, 0), 5u);  /* COMM_FAILURE */
}

TEST(BacnetObjtable, BadQuality)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_BAD, 0, 0), 5u);  /* COMM_FAILURE */
}

TEST(BacnetObjtable, AdcFaultGivesCommFailure)
{
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, IOP_FAULT_ADC, 0), 5u);
}

TEST(BacnetObjtable, UIOverRangeCh0)
{
    const uint16_t fault = IOP_FAULT_UI_OV | static_cast<uint16_t>(1u << 8);
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, fault, 0), 1u);  /* OVER_RANGE */
}

TEST(BacnetObjtable, UIOverRangeCh3)
{
    const uint16_t fault = IOP_FAULT_UI_OV | static_cast<uint16_t>(1u << 11);
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, fault, 3), 1u);
}

TEST(BacnetObjtable, UIOverRangeWrongChannel)
{
    /* OV for channel 2, checking channel 0 → NO_FAULT */
    const uint16_t fault = IOP_FAULT_UI_OV | static_cast<uint16_t>(1u << 10);
    EXPECT_EQ(quality_to_reliability(KX_Q_GOOD, fault, 0), 0u);
}

/* ---- publish (stub shm via attach) ---- */

TEST(BacnetObjtable, AttachDetach)
{
    BacnetObjTable obj;
    /* attach() requires /dev/shm — may succeed or fail depending on env */
    const bool ok = obj.attach();
    if (ok) {
        EXPECT_TRUE(obj.attached());
        obj.detach();
        EXPECT_FALSE(obj.attached());
    } else {
        EXPECT_FALSE(obj.attached());
        SUCCEED();  /* CI without shm is acceptable */
    }
}

TEST(BacnetObjtable, ReadExtNopWhenSockNeg)
{
    BacnetObjTable obj;
    /* sockfd = -1 → no-op, no crash */
    obj.read_ext(-1);
    SUCCEED();
}
