/**
 * @file  test_priority_resolver.cpp
 * @brief Bảng test 07 §4: safety thắng web; release rơi mức dưới; default cuối.
 */
#include <gtest/gtest.h>

#include <limits>

#include "ipc/priority_resolver.hpp"

using namespace core;

TEST(PriorityResolver, SafetyBeatsBacnet)
{
    PriorityResolver r;
    r.set_do(PRIO_BACNET, 0, true);        /* web/BACnet mức 3: DO1=1 */
    r.set_do(PRIO_FIRE_SAFETY, 0, false);  /* safety mức 1: DO1=0 */
    OutputCmd out = r.resolve();
    ASSERT_TRUE(out.do_valid[0]);
    EXPECT_EQ(out.dout[0], 0) << "safety thắng";
}

TEST(PriorityResolver, ReleaseFallsToLowerLevel)
{
    PriorityResolver r;
    r.set_do(PRIO_BACNET, 0, true);
    r.set_do(PRIO_FIRE_SAFETY, 0, false);
    r.release_do(PRIO_FIRE_SAFETY, 0);
    OutputCmd out = r.resolve();
    EXPECT_EQ(out.dout[0], 1) << "rơi về mức 3";
}

TEST(PriorityResolver, AllReleasedFallsToDefault)
{
    PriorityResolver r;
    r.set_default_do(0, false);
    r.set_default_ao(0, 0.0f);
    r.set_do(PRIO_BACNET, 0, true);
    r.set_ao(PRIO_BACNET, 0, 7.0f);
    r.release_do(PRIO_BACNET, 0);
    r.release_ao(PRIO_BACNET, 0);
    OutputCmd out = r.resolve();
    ASSERT_TRUE(out.do_valid[0]);
    ASSERT_TRUE(out.ao_valid[0]);
    EXPECT_EQ(out.dout[0], 0);
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f);
}

TEST(PriorityResolver, SameLevelLastWriterWins)
{
    PriorityResolver r;
    r.set_ao(PRIO_BACNET, 1, 3.0f);
    r.set_ao(PRIO_BACNET, 1, 5.5f);   /* nguồn sau thắng + log conflict */
    OutputCmd out = r.resolve();
    EXPECT_FLOAT_EQ(out.ao[1], 5.5f);
}

TEST(PriorityResolver, ManualBeatsScheduleAndLogic)
{
    PriorityResolver r;
    r.set_ao(PRIO_LOCAL_LOGIC, 0, 1.0f);
    r.set_ao(PRIO_SCHEDULE, 0, 2.0f);
    r.set_ao(PRIO_LOCAL_MANUAL, 0, 3.0f);
    EXPECT_FLOAT_EQ(r.resolve().ao[0], 3.0f);
    r.release_ao(PRIO_LOCAL_MANUAL, 0);
    EXPECT_FLOAT_EQ(r.resolve().ao[0], 2.0f);
    r.release_ao(PRIO_SCHEDULE, 0);
    EXPECT_FLOAT_EQ(r.resolve().ao[0], 1.0f);
}

TEST(PriorityResolver, DefaultCannotBeReleased)
{
    PriorityResolver r;
    r.release_do(PRIO_DEFAULT, 0);   /* no-op */
    OutputCmd out = r.resolve();
    EXPECT_TRUE(out.do_valid[0]) << "mức 6 luôn active";
}

TEST(PriorityResolver, ChannelsAreIndependent)
{
    PriorityResolver r;
    r.set_do(PRIO_FIRE_SAFETY, 0, true);
    OutputCmd out = r.resolve();
    EXPECT_EQ(out.dout[0], 1);
    EXPECT_EQ(out.dout[1], 0) << "kênh khác giữ default";
}

TEST(PriorityResolver, RejectsAoOutsideAppliedPhysicalRange)
{
    PriorityResolver r;
    const uint8_t modes[KX_N_AO] = {0, 1, 0, 0};
    r.set_ao_modes(modes);

    EXPECT_TRUE(r.set_ao(PRIO_BACNET, 0, 0.0f));
    EXPECT_TRUE(r.set_ao(PRIO_BACNET, 0, 10.0f));
    EXPECT_FALSE(r.set_ao(PRIO_BACNET, 0, -0.01f));
    EXPECT_FALSE(r.set_ao(PRIO_BACNET, 0, 10.01f));

    EXPECT_TRUE(r.set_ao(PRIO_BACNET, 1, 4.0f));
    EXPECT_TRUE(r.set_ao(PRIO_BACNET, 1, 12.0f));
    EXPECT_TRUE(r.set_ao(PRIO_BACNET, 1, 20.0f));
    EXPECT_FALSE(r.set_ao(PRIO_BACNET, 1, 3.99f));
    EXPECT_FALSE(r.set_ao(PRIO_BACNET, 1, 20.01f));
    EXPECT_FALSE(r.set_ao(PRIO_BACNET, 1, std::numeric_limits<float>::quiet_NaN()));
}
