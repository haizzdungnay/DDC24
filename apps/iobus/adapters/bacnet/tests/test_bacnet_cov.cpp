/**
 * @file  test_bacnet_cov.cpp
 * @brief BAC-007 unit tests — subscription, increment-based and state-change COV.
 */
#include <gtest/gtest.h>
#include "bacnet_cov.hpp"

using namespace iobus::bacnet;

static CovSubscription make_sub(uint32_t pid, BacnetObjectType t, uint32_t inst)
{
    CovSubscription s;
    s.subscriber_process_id = pid;
    s.obj_type   = t;
    s.obj_instance = inst;
    s.active     = true;
    return s;
}

TEST(BacnetCov, SubscribeAndUnsubscribe)
{
    BacnetCov cov;
    EXPECT_TRUE(cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1)));
    EXPECT_EQ(cov.sub_count(), 1u);
    EXPECT_TRUE(cov.unsubscribe(1, BacnetObjectType::ANALOG_INPUT, 1));
    cov.expire_subs(0);
    EXPECT_EQ(cov.sub_count(), 0u);
}

TEST(BacnetCov, AnalogTriggerOnIncrement)
{
    BacnetCov cov;
    cov.set_cov_increment(BacnetObjectType::ANALOG_INPUT, 1, 0.5f);
    cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1));

    /* First check: always triggers (NaN → first) */
    auto subs = cov.check_and_update(BacnetObjectType::ANALOG_INPUT, 1, 10.0f, 0);
    EXPECT_EQ(subs.size(), 1u);

    /* Small change (< increment 0.5): no trigger */
    subs = cov.check_and_update(BacnetObjectType::ANALOG_INPUT, 1, 10.3f, 0);
    EXPECT_EQ(subs.size(), 0u);

    /* Large change (>= 0.5): trigger */
    subs = cov.check_and_update(BacnetObjectType::ANALOG_INPUT, 1, 10.6f, 0);
    EXPECT_EQ(subs.size(), 1u);
}

TEST(BacnetCov, AnalogNoTriggerBelowIncrement)
{
    BacnetCov cov;
    cov.set_cov_increment(BacnetObjectType::ANALOG_VALUE, 5, 1.0f);
    cov.subscribe(make_sub(2, BacnetObjectType::ANALOG_VALUE, 5));

    cov.check_and_update(BacnetObjectType::ANALOG_VALUE, 5, 20.0f, 0);
    auto subs = cov.check_and_update(BacnetObjectType::ANALOG_VALUE, 5, 20.9f, 0);
    EXPECT_EQ(subs.size(), 0u);
}

TEST(BacnetCov, DigitalTriggerOnStateChange)
{
    BacnetCov cov;
    cov.subscribe(make_sub(3, BacnetObjectType::BINARY_INPUT, 2));

    /* First */
    auto subs = cov.check_and_update(BacnetObjectType::BINARY_INPUT, 2, 0.0f, 0);
    EXPECT_EQ(subs.size(), 1u);

    /* Same state: no trigger */
    subs = cov.check_and_update(BacnetObjectType::BINARY_INPUT, 2, 0.0f, 0);
    EXPECT_EQ(subs.size(), 0u);

    /* State change: trigger */
    subs = cov.check_and_update(BacnetObjectType::BINARY_INPUT, 2, 1.0f, 0);
    EXPECT_EQ(subs.size(), 1u);
}

TEST(BacnetCov, StatusFlagsChangeTriggers)
{
    BacnetCov cov;
    cov.subscribe(make_sub(4, BacnetObjectType::BINARY_VALUE, 1));

    cov.check_and_update(BacnetObjectType::BINARY_VALUE, 1, 0.0f, 0x00);
    /* Same value, different status → trigger */
    auto subs = cov.check_and_update(BacnetObjectType::BINARY_VALUE, 1, 0.0f, 0x02);
    EXPECT_EQ(subs.size(), 1u);
}

TEST(BacnetCov, MaxSubsEnforced)
{
    BacnetCov cov;
    for (int i = 0; i < BacnetCov::MAX_SUBS; i++)
        EXPECT_TRUE(cov.subscribe(make_sub(i, BacnetObjectType::ANALOG_INPUT, 1)));
    EXPECT_FALSE(cov.subscribe(make_sub(9999, BacnetObjectType::ANALOG_INPUT, 1)));
}

TEST(BacnetCov, ExpireRemovesOldSubs)
{
    BacnetCov cov;
    CovSubscription s = make_sub(10, BacnetObjectType::ANALOG_INPUT, 1);
    s.expiry_ms = 1000;
    cov.subscribe(s);
    EXPECT_EQ(cov.sub_count(), 1u);

    cov.expire_subs(500);
    EXPECT_EQ(cov.sub_count(), 1u);

    cov.expire_subs(1001);
    EXPECT_EQ(cov.sub_count(), 0u);
}

TEST(BacnetCov, UpdateExistingSub)
{
    BacnetCov cov;
    cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1));
    EXPECT_EQ(cov.sub_count(), 1u);
    /* Subscribe again with same pid+obj → update, not add */
    cov.subscribe(make_sub(1, BacnetObjectType::ANALOG_INPUT, 1));
    EXPECT_EQ(cov.sub_count(), 1u);
}

TEST(BacnetCov, AnalogTriggerOnIncrement_HigherAiInstancesCovered)
{
    /* Issue #635: AI9..AI16 must receive and trigger COV notifications correctly */
    BacnetCov cov;
    for (uint32_t inst = 9; inst <= 16; inst++) {
        cov.set_cov_increment(BacnetObjectType::ANALOG_INPUT, inst, 0.2f);
        EXPECT_TRUE(cov.subscribe(make_sub(inst, BacnetObjectType::ANALOG_INPUT, inst)));
        auto subs = cov.check_and_update(BacnetObjectType::ANALOG_INPUT, inst, 25.0f, 0);
        EXPECT_EQ(subs.size(), 1u);
    }
}

