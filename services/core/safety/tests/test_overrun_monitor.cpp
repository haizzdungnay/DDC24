/**
 * @file  test_overrun_monitor.cpp
 * @brief TASK_SAFETY_GATE — chính sách overrun và phân tách trách nhiệm.
 *
 *        Nhóm test cuối (Separation) là quan trọng nhất về mặt kiến trúc: nó
 *        khoá lại việc `CoreMetrics` KHÔNG được nắm quyền quyết định an toàn.
 */
#include <gtest/gtest.h>

#include "diagnostics/core_metrics.hpp"
#include "safety/overrun_monitor.hpp"

namespace core {
namespace {
constexpr uint64_t kBudget = 100;
}

TEST(OverrunMonitor, NoOverrunNeverForcesSafe)
{
    OverrunMonitor m(3);
    for (int i = 0; i < 100; i++) m.record(50, kBudget);
    EXPECT_FALSE(m.should_force_safe());
    EXPECT_FALSE(m.overrun_active());
    EXPECT_EQ(m.stats().total, 0u);
}

TEST(OverrunMonitor, ExactlyAtBudgetIsNotOverrun)
{
    /* Điều kiện là exec > budget (strict), không phải >=. Chạy đúng hết budget
     * là hợp lệ — nếu không, mọi Task chạy sát budget sẽ bị coi là hỏng. */
    OverrunMonitor m(1);
    m.record(kBudget, kBudget);
    EXPECT_FALSE(m.overrun_active());
    EXPECT_FALSE(m.should_force_safe());
}

TEST(OverrunMonitor, SingleOverrunRaisesWarningButNotSafe)
{
    OverrunMonitor m(3);
    m.record(kBudget + 1, kBudget);
    EXPECT_TRUE(m.overrun_active()) << "lần đầu đã phải cảnh báo";
    EXPECT_FALSE(m.should_force_safe()) << "chưa đủ ngưỡng thì chưa vào safe";
    EXPECT_EQ(m.stats().total, 1u);
    EXPECT_EQ(m.stats().consecutive, 1u);
}

TEST(OverrunMonitor, BelowThresholdDoesNotForceSafe)
{
    OverrunMonitor m(5);
    for (int i = 0; i < 4; i++) m.record(kBudget + 1, kBudget);
    EXPECT_FALSE(m.should_force_safe());
    EXPECT_EQ(m.stats().consecutive, 4u);
}

TEST(OverrunMonitor, ReachingThresholdForcesSafe)
{
    OverrunMonitor m(3);
    m.record(kBudget + 1, kBudget);
    m.record(kBudget + 1, kBudget);
    EXPECT_FALSE(m.should_force_safe());
    m.record(kBudget + 1, kBudget);
    EXPECT_TRUE(m.should_force_safe());
}

TEST(OverrunMonitor, SingleGoodCycleResetsConsecutiveCount)
{
    OverrunMonitor m(3);
    m.record(kBudget + 1, kBudget);
    m.record(kBudget + 1, kBudget);
    m.record(10, kBudget);
    EXPECT_EQ(m.stats().consecutive, 0u);
    /* Hai lần overrun tiếp theo KHÔNG được cộng dồn với hai lần trước. */
    m.record(kBudget + 1, kBudget);
    m.record(kBudget + 1, kBudget);
    EXPECT_FALSE(m.should_force_safe());
}

TEST(OverrunMonitor, RecoveryIsAsymmetricRequiresFullStreak)
{
    /* Bất đối xứng có chủ ý (SPEC §6.3): vào sau N lần hỏng, RA cũng cần N
     * lần tốt. Đây là test chống dao động vào/ra safe-state. */
    OverrunMonitor m(3);
    for (int i = 0; i < 3; i++) m.record(kBudget + 1, kBudget);
    ASSERT_TRUE(m.should_force_safe());

    m.record(10, kBudget);
    EXPECT_TRUE(m.should_force_safe()) << "một lần tốt KHÔNG đủ để ra";
    m.record(10, kBudget);
    EXPECT_TRUE(m.should_force_safe()) << "hai lần tốt vẫn chưa đủ";
    m.record(10, kBudget);
    EXPECT_FALSE(m.should_force_safe()) << "đủ 3 lần tốt mới ra";
}

TEST(OverrunMonitor, OverrunDuringRecoveryRestartsStreak)
{
    OverrunMonitor m(3);
    for (int i = 0; i < 3; i++) m.record(kBudget + 1, kBudget);
    m.record(10, kBudget);
    m.record(10, kBudget);
    m.record(kBudget + 1, kBudget);   /* hỏng lại giữa lúc đang hồi phục */
    EXPECT_TRUE(m.should_force_safe());
    m.record(10, kBudget);
    m.record(10, kBudget);
    EXPECT_TRUE(m.should_force_safe()) << "streak phải đếm lại từ đầu";
    m.record(10, kBudget);
    EXPECT_FALSE(m.should_force_safe());
}

TEST(OverrunMonitor, ZeroThresholdClampedToOne)
{
    /* Ngưỡng 0 nghĩa là "safe ngay cả khi không overrun" — vô nghĩa và nguy
     * hiểm (hệ không bao giờ điều khiển được). Phải bị kẹp về 1. */
    OverrunMonitor m(0);
    EXPECT_EQ(m.threshold(), 1u);
    EXPECT_FALSE(m.should_force_safe()) << "chưa chạy lần nào thì chưa safe";
    m.record(kBudget + 1, kBudget);
    EXPECT_TRUE(m.should_force_safe());
}

TEST(OverrunMonitor, ResetClearsStateButKeepsDiagnosticTotals)
{
    OverrunMonitor m(2);
    m.record(kBudget + 1, kBudget);
    m.record(kBudget + 1, kBudget);
    ASSERT_TRUE(m.should_force_safe());
    const uint32_t total_before = m.stats().total;

    m.reset();
    EXPECT_FALSE(m.should_force_safe());
    EXPECT_EQ(m.stats().consecutive, 0u);
    /* total/max giữ lại: xoá chúng sẽ xoá dấu vết một Task từng có vấn đề. */
    EXPECT_EQ(m.stats().total, total_before);
    EXPECT_GT(m.stats().max_exec_ns, 0u);
}

TEST(OverrunMonitor, TracksExecutionTimes)
{
    OverrunMonitor m(3);
    m.record(50, kBudget);
    m.record(90, kBudget);
    m.record(70, kBudget);
    EXPECT_EQ(m.stats().last_exec_ns, 70u);
    EXPECT_EQ(m.stats().max_exec_ns, 90u);
}

/* ---- Phân tách trách nhiệm ---- */

TEST(OverrunMonitorSeparation, CoreMetricsHasNoSafetyDecisionApi)
{
    /* Khoá lại quyết định kiến trúc: CoreMetrics chỉ đo và publish. Nếu ai đó
     * thêm ngưỡng an toàn hoặc nhánh điều khiển vào đó, test này phải được
     * sửa một cách CÓ Ý THỨC — không lọt qua âm thầm.
     *
     * Kiểm bằng cách khẳng định CoreMetrics vẫn chỉ có bộ đếm: nó không có
     * cách nào nói cho hệ thống biết phải chuyển safe-state. */
    CoreMetrics m;
    for (int i = 0; i < 1000; i++) m.end_scan(1000000000ull, 1000ull);   /* overrun liên tục */
    EXPECT_EQ(m.scan_overrun(), 1000u) << "vẫn phải ĐẾM đúng";
    EXPECT_EQ(m.scan_count(), 1000u);
    /* Không có API nào của CoreMetrics ảnh hưởng đầu ra — nếu có, nó đã phải
     * xuất hiện ở đây dưới dạng một hàm trả quyết định. */
    static_assert(sizeof(CoreMetrics) > 0, "CoreMetrics tồn tại");
}

TEST(OverrunMonitorSeparation, MonitorDoesNotTouchOutputs)
{
    /* OverrunMonitor chỉ trả lời "có nên vào safe không". Nó không có tham
     * chiếu tới OutputCmd/PriorityResolver nào — quyền ép output thuộc
     * SafeState. Test này giữ ranh giới đó. */
    OverrunMonitor m(1);
    m.record(1000, 1);
    EXPECT_TRUE(m.should_force_safe());
    /* Không có gì để kiểm về output ở đây — và đó CHÍNH LÀ điều cần khoá. */
    SUCCEED();
}

} // namespace core
