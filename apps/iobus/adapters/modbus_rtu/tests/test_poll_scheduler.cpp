/**
 * @file  test_poll_scheduler.cpp
 * @brief MOD-005: poll timing, retry, offline detect.
 */
#include <gtest/gtest.h>

#include <vector>

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

/* ---- D-04: slave chết không được chiếm dây của slave sống (sửa 2026-08-04) ----
 *
 * Trước bản sửa, on_poll_error() KHÔNG cập nhật last_poll_ms, nên một slave chết
 * luôn thoả is_due() và được read_slave() gọi ở MỌI vòng poll, mỗi lần chiếm dây
 * trọn timeout_ms. Với 8 slave chết ở timeout 300 ms, mỗi vòng tiêu 2,4 giây chỉ
 * để chờ hết giờ, và slave tốt có poll 1000 ms trượt deadline liên tục. */

TEST(PollSchedulerOfflineProbe, ErrorUpdatesLastPollSoDeadSlaveDoesNotSpin)
{
    SlaveState s;
    s.poll_interval_ms = 1000;
    s.offline_probe_ms = 5000;

    /* Lần đầu: chưa từng poll ⇒ tới hạn ngay. */
    EXPECT_TRUE(is_due(s, 1000));
    on_poll_error(&s, 2, 1000);

    /* Ngay sau lỗi, KHÔNG được tới hạn lại lập tức. */
    EXPECT_FALSE(is_due(s, 1001));
    EXPECT_FALSE(is_due(s, 1500));
}

TEST(PollSchedulerOfflineProbe, OfflineSlaveUsesSlowProbeInterval)
{
    SlaveState s;
    s.poll_interval_ms = 1000;
    s.offline_probe_ms = 5000;

    /* Đẩy slave sang OFFLINE (retry limit 2). */
    on_poll_error(&s, 2, 1000);
    on_poll_error(&s, 2, 2000);
    ASSERT_FALSE(s.online);

    EXPECT_EQ(effective_interval_ms(s), 5000u);
    /* Nhịp cũ 1000 ms không còn làm nó tới hạn. */
    EXPECT_FALSE(is_due(s, 3000));
    EXPECT_FALSE(is_due(s, 6000));
    /* Chỉ tới hạn theo nhịp probe. */
    EXPECT_TRUE(is_due(s, 7000));
}

TEST(PollSchedulerOfflineProbe, RecoveryRestoresFastInterval)
{
    SlaveState s;
    s.poll_interval_ms = 1000;
    s.offline_probe_ms = 5000;
    on_poll_error(&s, 2, 1000);
    on_poll_error(&s, 2, 2000);
    ASSERT_FALSE(s.online);

    on_poll_ok(&s, 7000);
    EXPECT_TRUE(s.online);
    EXPECT_EQ(effective_interval_ms(s), 1000u);
    EXPECT_FALSE(is_due(s, 7500));
    EXPECT_TRUE(is_due(s, 8000));
}

/* Kịch bản bỏ đói: 1 slave tốt (poll 1000 ms) cạnh 8 slave chết.
 * Đếm số lượt slave chết được phục vụ trong 10 giây mô phỏng. Với nhịp probe
 * 5000 ms, mỗi slave chết chỉ được thử ~2 lần thay vì mỗi vòng. */
TEST(PollSchedulerOfflineProbe, DeadSlavesDoNotStarveHealthyOne)
{
    constexpr int kDead = 8;
    SlaveState healthy;
    healthy.poll_interval_ms = 1000;
    healthy.offline_probe_ms = 5000;

    std::vector<SlaveState> dead(kDead);
    for (auto& d : dead) {
        d.poll_interval_ms = 1000;
        d.offline_probe_ms = 5000;
    }

    int dead_polls = 0;
    int healthy_polls = 0;
    /* Mô phỏng 10 s, bước 100 ms. */
    for (uint64_t now = 100; now <= 10000; now += 100) {
        if (is_due(healthy, now)) {
            on_poll_ok(&healthy, now);
            healthy_polls++;
        }
        for (auto& d : dead) {
            if (!is_due(d, now)) continue;
            on_poll_error(&d, 2, now);
            dead_polls++;
        }
    }

    /* Slave tốt vẫn đạt xấp xỉ 10 lượt trong 10 giây. */
    EXPECT_GE(healthy_polls, 9);

    /* 8 slave chết: 1 lần đầu + ~2 lần probe mỗi slave. Trước bản sửa, con số
     * này là 8 × 100 = 800 lượt (mỗi slave mỗi bước 100 ms). */
    EXPECT_LE(dead_polls, kDead * 4);
}
