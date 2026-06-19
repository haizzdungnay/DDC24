/**
 * @file  test_ext_cache.cpp
 * @brief MOD-009: ext cache set/get + mark_slave_offline.
 */
#include <gtest/gtest.h>
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
