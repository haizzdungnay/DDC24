/**
 * @file  test_ext_cache.cpp
 * @brief MOD-009: ext cache set/get + mark_slave_offline.
 */
#include <gtest/gtest.h>
#include "device_profile.hpp"
#include "ext_cache.hpp"

using namespace iobus::fieldbus;

TEST(ExtCache, SetAndGetPoint)
{
    ExtCache cache;
    cache.set_point(0, "EXT-1.DI[0]", 1.0f, KX_Q_GOOD, 10, true, false);
    EXPECT_FLOAT_EQ(cache.point(0).value, 1.0f);
    EXPECT_EQ(cache.point(0).quality, static_cast<uint8_t>(KX_Q_GOOD));
    EXPECT_EQ(cache.point(0).online, 1u);
    EXPECT_EQ(cache.point(0).slave_addr, 10u);
    EXPECT_EQ(std::string(cache.point(0).name), "EXT-1.DI[0]");
}

TEST(ExtCache, InitQualityBad)
{
    ExtCache cache;
    EXPECT_EQ(cache.point(5).quality, static_cast<uint8_t>(KX_Q_BAD));
}

TEST(ExtCache, SetpointDirtyPreserved)
{
    ExtCache cache;
    cache.point_rw(2).setpoint = 42.0f;
    cache.point_rw(2).dirty    = 1;
    /* set_point không được xóa setpoint/dirty */
    cache.set_point(2, "EXT-1.AO[0]", 10.0f, KX_Q_GOOD, 10, true, true);
    EXPECT_FLOAT_EQ(cache.point(2).setpoint, 42.0f);
    EXPECT_EQ(cache.point(2).dirty, 1u);
}

TEST(ExtCache, MarkSlaveOffline)
{
    ExtCache cache;
    cache.set_point(0, "EXT-1.DI[0]", 1.0f, KX_Q_GOOD, 10, true, false);
    cache.set_point(1, "EXT-1.DI[1]", 0.0f, KX_Q_GOOD, 10, true, false);
    cache.mark_slave_offline(0, 2, 10);
    EXPECT_EQ(cache.point(0).online, 0u);
    EXPECT_EQ(cache.point(0).quality, static_cast<uint8_t>(KX_Q_BAD));
    EXPECT_EQ(cache.point(1).online, 0u);
}

TEST(ExtCache, MarkSlaveStaleKeepsLastValueOnlineDuringRetryWindow)
{
    ExtCache cache;
    cache.set_point(0, "MB-SAT", 21.5f, KX_Q_GOOD, 10, true, false);
    cache.mark_slave_stale(0, 1, 10);
    EXPECT_FLOAT_EQ(cache.point(0).value, 21.5f);
    EXPECT_EQ(cache.point(0).online, 1u);
    EXPECT_EQ(cache.point(0).quality, static_cast<uint8_t>(KX_Q_UNCERTAIN));
}

TEST(ExtCache, OutOfBoundsIgnored)
{
    ExtCache cache;
    /* KX_N_EXT = 64; index >= 64 bị bỏ qua */
    cache.set_point(KX_N_EXT, "too-big", 99.0f, KX_Q_GOOD, 1, true, false);
    EXPECT_EQ(cache.count(), 0u);
}

TEST(ExtCache, CountTracking)
{
    ExtCache cache;
    EXPECT_EQ(cache.count(), 0u);
    cache.set_point(0, "p0", 1.0f, KX_Q_GOOD, 1, true, false);
    EXPECT_EQ(cache.count(), 1u);
    cache.set_point(3, "p3", 1.0f, KX_Q_GOOD, 1, true, false);
    EXPECT_EQ(cache.count(), 4u);
}

/* F-17: bố cục slot phải LIỀN MẠCH.
 *
 * count_ được nâng tới index cao nhất từng ghi, và push_snapshot gửi TOÀN BỘ
 * [0, count) sang core. Một slot được đặt trước nhưng không bao giờ set_point sẽ
 * giữ name="" + quality=BAD và hiện lên bảng điểm web/HMI thành một dòng vô danh
 * — đúng triệu chứng cũ khi open() đếm slot theo số register: điểm float32
 * count=2 đặt trước 2 slot nhưng chỉ dùng 1, để lại slot rỗng ở giữa. */
TEST(ExtCache, NoEmptySlotWhenBasesComeFromLogicalPointCount)
{
    DeviceProfile meter;                 /* float32 count=2 → 1 điểm luận lý */
    ProfilePoint kwh;
    kwh.name = "kWh"; kwh.fc = 4; kwh.addr = 0; kwh.count = 2;
    kwh.type = PointType::Float32; kwh.byte_order = ByteOrder::ABCD;
    meter.points.push_back(kwh);

    const uint16_t base_meter = 0;
    const uint16_t base_plc   = ext_slots_for_profile(meter);
    ASSERT_EQ(base_plc, 1u);             /* lỗi cũ: 2 → slot 1 bỏ trống */

    ExtCache cache;
    cache.set_point(base_meter, "meter.kWh[0]", 12.5f, KX_Q_GOOD, 1, true, false);
    for (uint16_t i = 0; i < 3; i++) {
        char name[24];
        std::snprintf(name, sizeof(name), "plc.reg[%u]", i);
        cache.set_point(static_cast<uint16_t>(base_plc + i), name,
                        static_cast<float>(i), KX_Q_GOOD, 2, true, false);
    }

    ASSERT_EQ(cache.count(), 4u);
    for (uint16_t i = 0; i < cache.count(); i++) {
        EXPECT_STRNE(cache.point(i).name, "") << "slot " << i << " rỗng";
        EXPECT_EQ(cache.point(i).quality, static_cast<uint8_t>(KX_Q_GOOD))
            << "slot " << i;
    }
}
