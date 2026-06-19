/**
 * @file  test_bacnet_priority.cpp
 * @brief BAC-006 unit tests — Priority_Array[16] + winner resolution + on_overridden.
 */
#include <gtest/gtest.h>
#include "bacnet_priority.hpp"

using namespace iobus::bacnet;

TEST(BacnetPriority, WriteSingleSlotWins)
{
    BacnetPriority p;
    const bool changed = p.write(CmdObjectType::AO, 1, 8, 5.0f);
    EXPECT_TRUE(changed);
    const PriorityArray* arr = p.get_array(CmdObjectType::AO, 1);
    ASSERT_NE(arr, nullptr);
    EXPECT_FLOAT_EQ(arr->winner(), 5.0f);
    EXPECT_EQ(arr->winning_slot(), 7);   /* slot index 7 = priority 8 */
}

TEST(BacnetPriority, HigherPriorityOverridesLower)
{
    BacnetPriority p;
    p.write(CmdObjectType::AO, 1, 8, 5.0f);
    p.write(CmdObjectType::AO, 1, 3, 99.0f);
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::AO, 1)->winner(), 99.0f);
    EXPECT_EQ(p.get_array(CmdObjectType::AO, 1)->winning_slot(), 2);
}

TEST(BacnetPriority, RelinquishLeavesFallback)
{
    BacnetPriority p;
    p.write(CmdObjectType::AO, 1, 3, 99.0f);
    p.write(CmdObjectType::AO, 1, 8, 5.0f);
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::AO, 1)->winner(), 99.0f);

    p.relinquish(CmdObjectType::AO, 1, 3);
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::AO, 1)->winner(), 5.0f);
}

TEST(BacnetPriority, RelinquishAllToDefault)
{
    BacnetPriority p;
    p.set_relinquish_default(CmdObjectType::AO, 1, 2.0f);
    p.write(CmdObjectType::AO, 1, 8, 5.0f);
    p.relinquish(CmdObjectType::AO, 1, 8);
    EXPECT_TRUE(p.get_array(CmdObjectType::AO, 1)->is_empty());
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::AO, 1)->winner(), 2.0f);
}

TEST(BacnetPriority, OnOverriddenKeepsArray)
{
    BacnetPriority p;
    p.write(CmdObjectType::AO, 1, 8, 7.0f);
    /* core returned overridden with applied=10.0 (safety holds 10.0) */
    p.on_overridden(CmdObjectType::AO, 1, 10.0f);
    /* BACnet array still has slot 8 = 7.0 */
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::AO, 1)->slots[7], 7.0f);
    /* applied_value reflects core */
    EXPECT_FLOAT_EQ(p.applied_value(CmdObjectType::AO, 1), 10.0f);
}

TEST(BacnetPriority, OutOfRangeInstanceReturnsNull)
{
    BacnetPriority p;
    EXPECT_EQ(p.get_array(CmdObjectType::AO, 5), nullptr);  /* max AO = 4 */
    EXPECT_EQ(p.get_array(CmdObjectType::AV, 33), nullptr); /* max AV = 32 */
}

TEST(BacnetPriority, AllObjectTypes)
{
    BacnetPriority p;
    EXPECT_TRUE(p.write(CmdObjectType::BO,  1, 1, 1.0f));
    EXPECT_TRUE(p.write(CmdObjectType::AV,  1, 1, 3.14f));
    EXPECT_TRUE(p.write(CmdObjectType::BV,  1, 1, 1.0f));
    EXPECT_TRUE(p.write(CmdObjectType::MSV, 1, 1, 2.0f));
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::BO,  1)->winner(), 1.0f);
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::AV,  1)->winner(), 3.14f);
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::BV,  1)->winner(), 1.0f);
    EXPECT_FLOAT_EQ(p.get_array(CmdObjectType::MSV, 1)->winner(), 2.0f);
}

TEST(BacnetPriority, RelinquishNoChangeReturnsFalse)
{
    BacnetPriority p;
    /* slot 8 empty → relinquish returns false (no change) */
    const bool changed = p.relinquish(CmdObjectType::AO, 1, 8);
    EXPECT_FALSE(changed);
}

TEST(PriorityArray, IsEmpty)
{
    PriorityArray arr;
    EXPECT_TRUE(arr.is_empty());
    arr.set(5, 1.0f);
    EXPECT_FALSE(arr.is_empty());
    arr.clear(5);
    EXPECT_TRUE(arr.is_empty());
}
