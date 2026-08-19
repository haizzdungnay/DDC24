/**
 * @file  test_priority_resolver.cpp
 * @brief Bảng test 07 §4: safety thắng web; release rơi mức dưới; default cuối.
 */
#include <gtest/gtest.h>

#include <limits>
#include <string>

#include "priority/priority_resolver.hpp"

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

/**
 * `F-PRIO-001` (2026-08-19) — cảnh báo `priority.conflict` phải nói đúng
 * chuyện xung đột.
 *
 * Slot giữ `active` qua nhiều scan (đúng thiết kế: nguồn phải `release` mới
 * nhả), nên điều kiện cũ "đã active và giá trị khác" biến MỌI thay đổi giá trị
 * bình thường của một nguồn duy nhất thành "xung đột". Trên board Foxlinx,
 * chương trình AHU ghi AO-01/02/03 mỗi scan nên Core đổ 97.410 dòng WARN trong
 * ~11,5 giờ (~2,3 dòng/giây) — nhiễu log lấp mất xung đột thật và mỗi dòng là
 * một lần ghi stderr đồng bộ ngay trong vòng quét realtime.
 *
 * Hai mệnh đề đối lập được khoá cùng lúc: nguồn đơn ghi qua nhiều chu kỳ thì
 * IM LẶNG, còn hai lần ghi trong CÙNG một chu kỳ thì VẪN cảnh báo.
 */
namespace {

/* Đếm dòng "priority.conflict" mà một đoạn code đẩy ra stderr. */
template <typename Fn>
int count_conflict_warnings(Fn&& body)
{
    ::testing::internal::CaptureStderr();
    body();
    const std::string log = ::testing::internal::GetCapturedStderr();
    int count = 0;
    for (std::string::size_type pos = log.find("priority.conflict");
         pos != std::string::npos;
         pos = log.find("priority.conflict", pos + 1))
        count++;
    return count;
}

}  // namespace

TEST(PriorityResolver, SingleSourceChangingValueAcrossCyclesIsNotAConflict)
{
    PriorityResolver r;
    const int warnings = count_conflict_warnings([&] {
        for (int scan = 0; scan < 50; scan++) {
            r.begin_cycle();
            /* Một nguồn duy nhất (Local logic) ghi giá trị biến thiên mỗi scan
             * — đúng hành vi của chương trình AHU trên board. */
            r.set_ao(PRIO_LOCAL_LOGIC, 0, 6.0f + 0.01f * static_cast<float>(scan));
            r.set_do(PRIO_LOCAL_LOGIC, 0, scan % 2 == 0);
            (void)r.resolve();
        }
    });
    EXPECT_EQ(warnings, 0) << "một nguồn đổi giá trị qua từng scan không phải xung đột";
    EXPECT_FLOAT_EQ(r.resolve().ao[0], 6.0f + 0.01f * 49.0f) << "giá trị mới nhất vẫn thắng";
}

TEST(PriorityResolver, TwoWritesInSameCycleStillWarn)
{
    PriorityResolver r;
    const int warnings = count_conflict_warnings([&] {
        r.begin_cycle();
        r.set_ao(PRIO_BACNET, 1, 3.0f);
        r.set_ao(PRIO_BACNET, 1, 5.5f);   /* cùng chu kỳ, cùng mức → xung đột thật */
        r.set_do(PRIO_BACNET, 1, false);
        r.set_do(PRIO_BACNET, 1, true);
    });
    EXPECT_EQ(warnings, 2) << "hai nguồn cùng mức tranh nhau trong một scan phải được báo";
    EXPECT_FLOAT_EQ(r.resolve().ao[1], 5.5f) << "nguồn sau vẫn thắng";
}

TEST(PriorityResolver, SameValueRewrittenNeverWarns)
{
    PriorityResolver r;
    const int warnings = count_conflict_warnings([&] {
        r.begin_cycle();
        r.set_ao(PRIO_LOCAL_LOGIC, 2, 4.0f);
        r.set_ao(PRIO_LOCAL_LOGIC, 2, 4.0f);
    });
    EXPECT_EQ(warnings, 0) << "ghi lại đúng giá trị cũ không phải xung đột";
}
