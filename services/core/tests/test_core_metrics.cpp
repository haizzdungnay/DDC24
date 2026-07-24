#include "core_metrics.hpp"

#include <gtest/gtest.h>

namespace core {
namespace {

TEST(CoreMetrics, ScanCountIncrementsEachCall)
{
    CoreMetrics m;
    m.end_scan(1000, 1000000000ull);
    m.end_scan(1000, 1000000000ull);
    EXPECT_EQ(m.scan_count(), 2u);
}

TEST(CoreMetrics, ExecWithinBudgetDoesNotOverrun)
{
    CoreMetrics m;
    m.end_scan(500000000ull /* 500ms */, 1000000000ull /* 1s budget */);
    EXPECT_EQ(m.scan_overrun(), 0u);
}

TEST(CoreMetrics, ExecEqualToBudgetDoesNotOverrun)
{
    /* end_scan dùng exec_ns > budget_ns (strict) — bằng budget KHÔNG tính overrun */
    CoreMetrics m;
    m.end_scan(1000000000ull, 1000000000ull);
    EXPECT_EQ(m.scan_overrun(), 0u);
}

TEST(CoreMetrics, ExecExceedingBudgetTriggersOverrun)
{
    CoreMetrics m;
    m.end_scan(1500000000ull /* 1.5s */, 1000000000ull /* 1s budget */);
    EXPECT_EQ(m.scan_overrun(), 1u);
}

TEST(CoreMetrics, OverrunCounterAccumulatesAcrossScans)
{
    CoreMetrics m;
    m.end_scan(1500000000ull, 1000000000ull);
    m.end_scan(500000000ull, 1000000000ull);   /* not overrun */
    m.end_scan(2000000000ull, 1000000000ull);
    EXPECT_EQ(m.scan_count(), 3u);
    EXPECT_EQ(m.scan_overrun(), 2u);
}

TEST(CoreMetrics, LastExecNsReflectsMostRecentScan)
{
    CoreMetrics m;
    m.end_scan(100, 1000000000ull);
    m.end_scan(200, 1000000000ull);
    EXPECT_EQ(m.last_exec_ns(), 200u);
}

TEST(CoreMetrics, MaxExecNsTracksPeakAcrossScans)
{
    CoreMetrics m;
    m.end_scan(300, 1000000000ull);
    m.end_scan(100, 1000000000ull);
    m.end_scan(200, 1000000000ull);
    EXPECT_EQ(m.max_exec_ns(), 300u);
}

TEST(CoreMetrics, SeqlockFailCounterIncrementsOnly)
{
    CoreMetrics m;
    m.inc_seqlock_fail();
    m.inc_seqlock_fail();
    EXPECT_EQ(m.seqlock_fail(), 2u);
    EXPECT_EQ(m.scan_count(), 0u);
}

} // namespace
} // namespace core
