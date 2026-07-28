/**
 * @file  test_st_cyclic_runtime.cpp
 * @brief Wrapper cyclic: activation chỉ áp tại RANH GIỚI chu kỳ, thất bại
 *        giữ package cũ, metrics và trace ghi đúng sự kiện.
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_cyclic_runtime.hpp"
#include "st/st_ir.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

std::vector<uint8_t> build(const std::string& src)
{
    StIrModule mod;
    StDiagnostic d;
    EXPECT_TRUE(compile_st_source(src, &mod, &d)) << d.code << ": " << d.message;
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

const char* kAddOne = R"ST(
PROGRAM p1
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := a + 1.0;
END_PROGRAM
)ST";

const char* kAddTen = R"ST(
PROGRAM p2
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := a + 10.0;
END_PROGRAM
)ST";

float out_b(StCyclicRuntime& rt)
{
    StValue v;
    EXPECT_TRUE(rt.runtime().get_variable("b", &v));
    return v.r;
}

constexpr uint64_t kSec = 1000000000ull;
constexpr uint64_t kBudget = 100ull * 1000000ull;

} // namespace

TEST(StCyclicRuntime, NoProgramYieldsFaultNotCrash)
{
    StCyclicRuntime rt;
    const StExecResult r = rt.run_cycle(0, 1000, kBudget);
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "no_active_program");
    EXPECT_EQ(rt.metrics().exec_fault_count, 1u);
}

TEST(StCyclicRuntime, ActivationAppliedAtCycleBoundary)
{
    StCyclicRuntime rt;
    EXPECT_TRUE(rt.request_activation(build(kAddOne)));
    EXPECT_TRUE(rt.has_pending_activation());
    EXPECT_FALSE(rt.loaded()) << "chưa chạy chu kỳ nào thì chưa được nạp";

    const StExecResult r = rt.run_cycle(0, kSec, kBudget);
    EXPECT_TRUE(r.ok);
    EXPECT_TRUE(rt.loaded());
    EXPECT_FALSE(rt.has_pending_activation());
    EXPECT_EQ(rt.activation_count(), 1u);
}

TEST(StCyclicRuntime, SecondRequestRejectedWhileFirstPending)
{
    StCyclicRuntime rt;
    EXPECT_TRUE(rt.request_activation(build(kAddOne)));
    EXPECT_FALSE(rt.request_activation(build(kAddTen)))
        << "request đầu KHÔNG được bị ghi đè âm thầm";

    rt.run_cycle(0, kSec, kBudget);
    rt.runtime().set_variable("a", StValue::make_real(1.0f));
    rt.run_cycle(kSec, 2 * kSec, kBudget);
    EXPECT_FLOAT_EQ(out_b(rt), 2.0f) << "phải là chương trình +1, không phải +10";
}

TEST(StCyclicRuntime, FailedActivationKeepsPreviousPackage)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(build(kAddOne)));
    ASSERT_TRUE(rt.run_cycle(0, kSec, kBudget).ok);
    rt.runtime().set_variable("a", StValue::make_real(1.0f));
    ASSERT_TRUE(rt.run_cycle(kSec, 2 * kSec, kBudget).ok);
    ASSERT_FLOAT_EQ(out_b(rt), 2.0f);

    std::vector<uint8_t> broken = build(kAddTen);
    broken[broken.size() - 1] ^= 0xFF;
    ASSERT_TRUE(rt.request_activation(broken));

    StLoadError err;
    const StExecResult r = rt.run_cycle(2 * kSec, 3 * kSec, kBudget, &err);
    EXPECT_TRUE(r.ok) << "package cũ phải tiếp tục chạy được";
    EXPECT_EQ(err.code, st_ir_error::kBadHash);
    EXPECT_FLOAT_EQ(out_b(rt), 2.0f) << "vẫn là chương trình +1";
    EXPECT_EQ(rt.activation_fail_count(), 1u);
}

TEST(StCyclicRuntime, FailedActivationDoesNotRetrySilently)
{
    StCyclicRuntime rt;
    std::vector<uint8_t> broken = build(kAddOne);
    broken[broken.size() - 1] ^= 0xFF;
    ASSERT_TRUE(rt.request_activation(broken));

    rt.run_cycle(0, kSec, kBudget);
    EXPECT_EQ(rt.activation_fail_count(), 1u);
    EXPECT_FALSE(rt.has_pending_activation()) << "request lỗi phải bị TIÊU THỤ";

    rt.run_cycle(kSec, 2 * kSec, kBudget);
    EXPECT_EQ(rt.activation_fail_count(), 1u) << "không được thử lại ngầm";
}

TEST(StCyclicRuntime, ReplacingProgramSwitchesBehaviour)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(build(kAddOne)));
    ASSERT_TRUE(rt.run_cycle(0, kSec, kBudget).ok);
    rt.runtime().set_variable("a", StValue::make_real(5.0f));
    ASSERT_TRUE(rt.run_cycle(kSec, 2 * kSec, kBudget).ok);
    EXPECT_FLOAT_EQ(out_b(rt), 6.0f);

    ASSERT_TRUE(rt.request_activation(build(kAddTen)));
    ASSERT_TRUE(rt.run_cycle(2 * kSec, 3 * kSec, kBudget).ok);
    rt.runtime().set_variable("a", StValue::make_real(5.0f));
    ASSERT_TRUE(rt.run_cycle(3 * kSec, 4 * kSec, kBudget).ok);
    EXPECT_FLOAT_EQ(out_b(rt), 15.0f);
    EXPECT_EQ(rt.activation_count(), 2u);
}

TEST(StCyclicRuntime, OverrunCountedWhenExecExceedsBudget)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(build(kAddOne)));
    rt.run_cycle(0, kSec, kBudget);
    EXPECT_EQ(rt.metrics().overrun_count, 1u) << "1s > budget 100ms";

    rt.run_cycle(2 * kSec, 2 * kSec + 1000, kBudget);
    EXPECT_EQ(rt.metrics().overrun_count, 1u) << "1us trong budget, không tăng";
}

TEST(StCyclicRuntime, MetricsTrackExecTimes)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(build(kAddOne)));
    rt.run_cycle(0, 5000, kBudget);
    rt.run_cycle(kSec, kSec + 9000, kBudget);
    EXPECT_EQ(rt.metrics().cycle_count, 2u);
    EXPECT_EQ(rt.metrics().last_exec_ns, 9000u);
    EXPECT_EQ(rt.metrics().max_exec_ns, 9000u);
}

TEST(StCyclicRuntime, TraceRecordsActivationRollbackAndOverrun)
{
    StTraceLog log;
    StCyclicRuntime rt;
    rt.set_trace_log(&log);

    ASSERT_TRUE(rt.request_activation(build(kAddOne)));
    rt.run_cycle(0, kSec, kBudget);                     /* activation ok + overrun */

    std::vector<uint8_t> broken = build(kAddTen);
    broken[broken.size() - 1] ^= 0xFF;
    ASSERT_TRUE(rt.request_activation(broken));
    rt.run_cycle(2 * kSec, 2 * kSec + 1000, kBudget);   /* activation fail + rollback */

    bool act_ok = false, act_fail = false, rollback = false, overrun = false;
    for (const StTraceEvent& e : log.events()) {
        if (e.kind == StTraceEventKind::ACTIVATION_RESULT && e.ok) act_ok = true;
        if (e.kind == StTraceEventKind::ACTIVATION_RESULT && !e.ok) act_fail = true;
        if (e.kind == StTraceEventKind::ROLLBACK) rollback = true;
        if (e.kind == StTraceEventKind::OVERRUN) overrun = true;
    }
    EXPECT_TRUE(act_ok);
    EXPECT_TRUE(act_fail);
    EXPECT_TRUE(rollback);
    EXPECT_TRUE(overrun);
}

TEST(StCyclicRuntime, TraceNotTouchedWhenNoLogAttached)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(build(kAddOne)));
    EXPECT_NO_FATAL_FAILURE(rt.run_cycle(0, kSec, kBudget));
}

} // namespace core
