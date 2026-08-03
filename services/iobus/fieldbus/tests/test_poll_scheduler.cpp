/**
 * @file  test_poll_scheduler.cpp
 * @brief MOD-005: poll timing, retry, offline detect.
 */
#include <gtest/gtest.h>
#include "poll_scheduler.hpp"

using namespace iobus::fieldbus;

TEST(PollScheduler, InitialStateDue)
{
    SlaveState s;
    s.poll_interval_ms = 1000;
    EXPECT_TRUE(is_due(s, 5000));
}

TEST(PollScheduler, NotDueRightAfterPoll)
{
    SlaveState s;
    s.poll_interval_ms = 1000;
    on_poll_ok(&s, 5000);
    EXPECT_FALSE(is_due(s, 5500));   /* 500ms < 1000ms */
    EXPECT_TRUE(is_due(s, 6000));    /* 1000ms = đúng hạn */
    EXPECT_TRUE(is_due(s, 6001));    /* > 1000ms */
}

TEST(PollScheduler, RetryBeforeOffline)
{
    SlaveState s;
    s.poll_interval_ms = 1000;
    s.online = true;

    bool went_offline = on_poll_error(&s);
    EXPECT_FALSE(went_offline);   /* retry 1, chưa offline */
    EXPECT_TRUE(s.online);

    went_offline = on_poll_error(&s);
    EXPECT_TRUE(went_offline);    /* retry 2 → offline */
    EXPECT_FALSE(s.online);
}

TEST(PollScheduler, PerDeviceRetryThreshold)
{
    SlaveState s;
    s.online = true;
    EXPECT_FALSE(on_poll_error(&s, 3));
    EXPECT_FALSE(on_poll_error(&s, 3));
    EXPECT_TRUE(on_poll_error(&s, 3));
    EXPECT_FALSE(s.online);
}

TEST(PollScheduler, RecoveryAfterOffline)
{
    SlaveState s;
    s.online = false;
    on_poll_ok(&s, 10000);
    EXPECT_TRUE(s.online);
    EXPECT_EQ(s.retry_count, 0u);
}

TEST(PollScheduler, ErrorRateCalculation)
{
    SlaveState s;
    /* 3 polls: 2 ok, 1 error → 33% */
    on_poll_ok(&s, 1000);
    on_poll_ok(&s, 2000);
    on_poll_error(&s);
    EXPECT_NEAR(error_rate(s), 1.0f / 3.0f, 0.01f);
}

TEST(PollScheduler, NextDueMsCorrect)
{
    SlaveState s;
    s.poll_interval_ms = 1000;
    on_poll_ok(&s, 5000);
    EXPECT_EQ(next_due_ms(s, 5500), 500u);
    EXPECT_EQ(next_due_ms(s, 6000), 0u);
}
