/**
 * @file test_poll_group.cpp
 * @brief `ISS-PIO-22`/`F-PIO-021` — nhóm poll theo điểm + ngưỡng stale riêng.
 *
 * Hệ quả thực tế mà issue nêu: một điểm cấu hình (đọc một lần mỗi phút là đủ)
 * bị poll CÙNG NHỊP với tần số VFD (500 ms), tiêu băng thông RS-485 vô ích.
 */
#include <gtest/gtest.h>

#include "modbus_rtu/poll_group.hpp"

using namespace iobus::fieldbus;

/* ---- Chu kỳ theo nhóm ---- */

TEST(PollGroup, NormalKeepsDevicePollMsSoOldConfigsDoNotChange)
{
    // `Normal` là mặc định của mọi điểm; nếu nó lệch `poll_ms` thì nâng cấp
    // firmware sẽ đổi nhịp của MỌI bo đang chạy.
    EXPECT_EQ(group_interval_ms(PollGroup::Normal, 500, 0, 0), 500u);
    EXPECT_EQ(group_interval_ms(PollGroup::Normal, 1000, 200, 60000), 1000u);
}

TEST(PollGroup, SlowDerivesFromPollMsWhenDeviceDoesNotDeclareIt)
{
    // "Chậm" chỉ có nghĩa TƯƠNG ĐỐI với nhịp cơ sở của chính thiết bị.
    EXPECT_EQ(group_interval_ms(PollGroup::Slow, 500, 0, 0), 500u * kSlowPollFactor);
    EXPECT_EQ(group_interval_ms(PollGroup::Fast, 500, 0, 0), 500u);
}

TEST(PollGroup, DeclaredGroupIntervalsWin)
{
    EXPECT_EQ(group_interval_ms(PollGroup::Fast, 1000, 200, 60000), 200u);
    EXPECT_EQ(group_interval_ms(PollGroup::Slow, 1000, 200, 60000), 60000u);
}

TEST(PollGroup, ZeroPollMsIsBrokenConfigNotContinuousPolling)
{
    // Trả 0 sẽ làm mọi block luôn đến hạn và chiếm trọn dây.
    EXPECT_EQ(group_interval_ms(PollGroup::Normal, 0, 0, 0), 1000u);
    EXPECT_GT(group_interval_ms(PollGroup::Slow, 0, 0, 0), 1000u);
}

/* ---- Đến hạn ---- */

TEST(PollGroup, NeverPolledBlockIsDueImmediately)
{
    // Một điểm mới cấu hình phải có mẫu đầu tiên sớm nhất có thể, không phải
    // sau một chu kỳ `slow` dài cả phút.
    EXPECT_TRUE(block_is_due(0, 0, 60000));
    EXPECT_TRUE(block_is_due(0, 10, 60000));
}

TEST(PollGroup, BlockIsDueOnlyAfterItsOwnInterval)
{
    EXPECT_FALSE(block_is_due(1000, 1400, 500));
    EXPECT_TRUE(block_is_due(1000, 1500, 500));
    EXPECT_TRUE(block_is_due(1000, 9999, 500));
}

TEST(PollGroup, ClockGoingBackwardsDoesNotFreezeTheBlock)
{
    // Một mốc tương lai (đồng hồ nhảy lùi) không được làm block treo vĩnh viễn.
    EXPECT_TRUE(block_is_due(5000, 1000, 500));
}

/* Đây là chính con số mà issue nêu: điểm `slow` không còn đi cùng mọi lượt poll
 * của thiết bị. Với poll_ms=500 và slow=60000, trong 60 giây điểm nhanh được
 * đọc 120 lần còn điểm chậm đúng 1 lần. */
TEST(PollGroup, SlowPointStopsRidingEveryFastCycle)
{
    const uint32_t fast_interval = group_interval_ms(PollGroup::Normal, 500, 0, 0);
    const uint32_t slow_interval = group_interval_ms(PollGroup::Slow, 500, 0, 60000);

    uint64_t fast_last = 0, slow_last = 0;
    int fast_polls = 0, slow_polls = 0;
    for (uint64_t now = 0; now <= 60000; now += 100) {
        if (block_is_due(fast_last, now, fast_interval)) { fast_last = now; fast_polls++; }
        if (block_is_due(slow_last, now, slow_interval)) { slow_last = now; slow_polls++; }
    }
    EXPECT_GE(fast_polls, 120);
    EXPECT_EQ(slow_polls, 2) << "lần đầu (chưa từng poll) + đúng một lần ở mốc 60 s";
}

/* ---- Ngưỡng stale ---- */

TEST(PollGroup, DeclaredStaleThresholdIsUsedVerbatim)
{
    // Không kẹp xuống theo chu kỳ: người vận hành có quyền chấp nhận một điểm
    // cũ hơn vài chu kỳ.
    EXPECT_EQ(effective_stale_after_ms(45000, 1000), 45000u);
    EXPECT_EQ(effective_stale_after_ms(100, 60000), 100u);
}

TEST(PollGroup, DerivedStaleThresholdIsAMultipleOfTheInterval)
{
    // Hạ STALE ngay khi trễ một chu kỳ sẽ biến mọi nhiễu RS-485 thoáng qua —
    // thứ `retry` sinh ra để chịu đựng — thành một lần nhấp nháy quality.
    EXPECT_EQ(effective_stale_after_ms(0, 5000), 5000u * kStaleIntervalFactor);
    EXPECT_GT(effective_stale_after_ms(0, 5000), 5000u);
}

TEST(PollGroup, DerivedStaleThresholdHasAFloorAndACeiling)
{
    // Sàn giữ điểm nhịp nhanh không nhấp nháy vì một khung hỏng.
    EXPECT_EQ(effective_stale_after_ms(0, 100), kMinStaleAfterMs);
    // Trần giữ điểm nhịp rất chậm vẫn hạ stale trong đời một ca trực.
    EXPECT_EQ(effective_stale_after_ms(0, 3600000), kMaxStaleAfterMs);
}

/* Ngưỡng suy ra KHÔNG bao giờ là 0: một điểm không bao giờ hạ stale là một điểm
 * nói dối êm ái khi thiết bị ngừng trả lời đúng nó mà slave vẫn online. */
TEST(PollGroup, DerivedStaleThresholdIsNeverZero)
{
    for (uint32_t interval : {1u, 10u, 100u, 1000u, 60000u}) {
        EXPECT_GT(effective_stale_after_ms(0, interval), 0u) << "interval=" << interval;
    }
}

/* ---- Tên nhóm ---- */

TEST(PollGroup, NamesRoundTripAndUnknownFallsBackToNormal)
{
    EXPECT_EQ(poll_group_from_string("fast"), PollGroup::Fast);
    EXPECT_EQ(poll_group_from_string("normal"), PollGroup::Normal);
    EXPECT_EQ(poll_group_from_string("slow"), PollGroup::Slow);
    EXPECT_EQ(poll_group_from_string("khong-ton-tai"), PollGroup::Normal);
    EXPECT_EQ(poll_group_from_string(nullptr), PollGroup::Normal);

    EXPECT_STREQ(poll_group_name(PollGroup::Fast), "fast");
    EXPECT_STREQ(poll_group_name(PollGroup::Normal), "normal");
    EXPECT_STREQ(poll_group_name(PollGroup::Slow), "slow");
}
