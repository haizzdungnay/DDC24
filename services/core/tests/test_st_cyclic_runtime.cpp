/**
 * @file  test_st_cyclic_runtime.cpp
 * @brief FW SOM IEC programming foundation, item 5+7: cyclic runtime +
 *        activation boundary + overrun/fault metrics + trace events. Toàn
 *        bộ test dùng fake clock (uint64_t cố định do test truyền vào) —
 *        KHÔNG sleep thật, không flaky.
 */
#include <gtest/gtest.h>

#include <limits>

#include "st_cyclic_runtime.hpp"

using namespace core;

namespace {

const char* kHvacCtrl = R"ST(
PROGRAM HVAC_CTRL
VAR_INPUT
    SupplyTemp : REAL;
    Setpoint : REAL;
END_VAR
VAR_OUTPUT
    FanEnable : BOOL;
END_VAR
IF SupplyTemp > Setpoint THEN
    FanEnable := TRUE;
ELSE
    FanEnable := FALSE;
END_IF;
END_PROGRAM
)ST";

constexpr uint64_t kBudgetNs = 1000000000ull;   /* 1s, giống Rev A scan period */

StIoImage inputs(float supply_temp, float setpoint)
{
    StIoImage io;
    io["SupplyTemp"] = {StType::REAL, supply_temp, false};
    io["Setpoint"] = {StType::REAL, setpoint, false};
    return io;
}

} // namespace

TEST(StCyclicRuntime, ActivationAppliedOnlyAtNextCycleBoundary)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(kHvacCtrl));
    EXPECT_TRUE(rt.has_pending_activation());
    EXPECT_FALSE(rt.loaded()) << "activation CHƯA áp dụng — chỉ mới request";

    StIoImage out;
    rt.run_cycle(0, 500000, kBudgetNs, inputs(28.0f, 24.0f), &out);

    EXPECT_FALSE(rt.has_pending_activation()) << "request đã được tiêu thụ ở cycle vừa rồi";
    ASSERT_TRUE(rt.loaded());
    EXPECT_EQ(rt.active_program_for_test()->name, "HVAC_CTRL");
    EXPECT_TRUE(out["FanEnable"].bool_value) << "cycle áp dụng activation cũng phải execute luôn trong cùng cycle đó";
}

TEST(StCyclicRuntime, InvalidActivationRejectedKeepsOldPackageAcrossCycles)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(kHvacCtrl));
    StIoImage out;
    rt.run_cycle(0, 100000, kBudgetNs, inputs(30.0f, 20.0f), &out);
    ASSERT_TRUE(rt.loaded());
    EXPECT_EQ(rt.activation_count(), 1u);

    const char* broken = "PROGRAM P VAR_INPUT A : REAL; END_VAR";
    ASSERT_TRUE(rt.request_activation(broken));
    StDiagnostic diag;
    rt.run_cycle(1000000000, 1100000, kBudgetNs, inputs(30.0f, 20.0f), &out, &diag);

    EXPECT_FALSE(diag.message.empty());
    EXPECT_EQ(rt.activation_fail_count(), 1u);
    EXPECT_TRUE(rt.loaded()) << "package cũ (HVAC_CTRL) vẫn phải còn active";
    EXPECT_EQ(rt.active_program_for_test()->name, "HVAC_CTRL");
    EXPECT_TRUE(out["FanEnable"].bool_value) << "cycle vẫn chạy đúng theo package CŨ, không bị gián đoạn";

    /* Nhiều cycle tiếp theo vẫn dùng package cũ, không tự retry request đã fail */
    for (int i = 0; i < 5; i++)
        rt.run_cycle(2000000000ull, 2000100000ull, kBudgetNs, inputs(10.0f, 20.0f), &out);
    EXPECT_EQ(rt.activation_count(), 1u) << "không có activation mới nào xảy ra ngầm";
    EXPECT_FALSE(out["FanEnable"].bool_value) << "vẫn logic HVAC_CTRL cũ: 10 < 20 -> FALSE";
}

TEST(StCyclicRuntime, RequestActivationRejectsWhenOneAlreadyPending)
{
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(kHvacCtrl));
    EXPECT_FALSE(rt.request_activation(kHvacCtrl)) << "đã có 1 request đang chờ, không được ghi đè âm thầm";
}

TEST(StCyclicRuntime, NoOverrunWhenExecUnderBudget)
{
    StCyclicRuntime rt;
    rt.request_activation(kHvacCtrl);
    StIoImage out;
    rt.run_cycle(0, 500000000ull /* 0.5s */, kBudgetNs, inputs(1.0f, 0.0f), &out);
    EXPECT_EQ(rt.metrics().overrun_count, 0u);
    EXPECT_EQ(rt.metrics().cycle_count, 1u);
    EXPECT_EQ(rt.metrics().last_exec_ns, 500000000ull);
}

TEST(StCyclicRuntime, OverrunDetectedAndAccumulates)
{
    StCyclicRuntime rt;
    rt.request_activation(kHvacCtrl);
    StIoImage out;
    rt.run_cycle(0, 1500000000ull /* 1.5s > 1s budget */, kBudgetNs, inputs(1.0f, 0.0f), &out);
    EXPECT_EQ(rt.metrics().overrun_count, 1u);
    rt.run_cycle(2000000000ull, 2300000000ull /* 0.3s, không overrun */, kBudgetNs, inputs(1.0f, 0.0f), &out);
    EXPECT_EQ(rt.metrics().overrun_count, 1u);
    rt.run_cycle(3000000000ull, 4600000000ull /* 1.6s, overrun */, kBudgetNs, inputs(1.0f, 0.0f), &out);
    EXPECT_EQ(rt.metrics().overrun_count, 2u);
    EXPECT_EQ(rt.metrics().cycle_count, 3u);
}

TEST(StCyclicRuntime, ExecFaultCountTracksNonFiniteInputAcrossCycles)
{
    StCyclicRuntime rt;
    rt.request_activation(kHvacCtrl);
    StIoImage out;
    rt.run_cycle(0, 100000, kBudgetNs, inputs(1.0f, 0.0f), &out);
    EXPECT_EQ(rt.metrics().exec_fault_count, 0u);

    StIoImage nan_in = inputs(std::numeric_limits<float>::quiet_NaN(), 0.0f);
    rt.run_cycle(1000000000ull, 1000100000ull, kBudgetNs, nan_in, &out);
    EXPECT_EQ(rt.metrics().exec_fault_count, 1u);
}

TEST(StCyclicRuntime, OutputNotCommittedMidCycleOnExecFault)
{
    StCyclicRuntime rt;
    rt.request_activation(kHvacCtrl);
    StIoImage out;
    out["FanEnable"] = {StType::BOOL, 0.0f, true};   /* sentinel */
    StIoImage nan_in = inputs(std::numeric_limits<float>::quiet_NaN(), 0.0f);
    rt.run_cycle(0, 100000, kBudgetNs, nan_in, &out);
    EXPECT_TRUE(out["FanEnable"].bool_value) << "output giữ nguyên khi cycle fault";
}

TEST(StCyclicRuntime, TraceLogRecordsActivationRollbackFaultAndOverrun)
{
    StTraceLog trace;
    StCyclicRuntime rt;
    rt.set_trace_log(&trace);

    ASSERT_TRUE(rt.request_activation(kHvacCtrl));
    StIoImage out;
    rt.run_cycle(0, 500000000ull, kBudgetNs, inputs(1.0f, 0.0f), &out);   /* activation ok, no overrun */

    ASSERT_TRUE(rt.request_activation("PROGRAM P VAR_INPUT A : REAL; END_VAR"));   /* fail -> rollback event */
    rt.run_cycle(1000000000ull, 2500000000ull /* 1.5s > 1s -> overrun */, kBudgetNs, inputs(1.0f, 0.0f), &out);

    StIoImage nan_in = inputs(std::numeric_limits<float>::quiet_NaN(), 0.0f);
    rt.run_cycle(3000000000ull, 3000100000ull, kBudgetNs, nan_in, &out);   /* runtime fault */

    bool has_activation_ok = false, has_activation_fail = false, has_rollback = false;
    bool has_overrun = false, has_runtime_fault = false;
    for (const StTraceEvent& e : trace.events()) {
        switch (e.kind) {
        case StTraceEventKind::ACTIVATION_RESULT:
            if (e.ok) has_activation_ok = true; else has_activation_fail = true;
            break;
        case StTraceEventKind::ROLLBACK: has_rollback = true; break;
        case StTraceEventKind::OVERRUN: has_overrun = true; break;
        case StTraceEventKind::RUNTIME_FAULT: has_runtime_fault = true; break;
        default: break;
        }
    }
    EXPECT_TRUE(has_activation_ok);
    EXPECT_TRUE(has_activation_fail);
    EXPECT_TRUE(has_rollback);
    EXPECT_TRUE(has_overrun);
    EXPECT_TRUE(has_runtime_fault);
}

TEST(StCyclicRuntime, TraceLogNotTouchedWhenNoLogAttached)
{
    /* set_trace_log() không bắt buộc gọi — hành vi runtime phải giống hệt
     * khi không có trace (không crash, không side effect). */
    StCyclicRuntime rt;
    ASSERT_TRUE(rt.request_activation(kHvacCtrl));
    StIoImage out;
    EXPECT_NO_FATAL_FAILURE(rt.run_cycle(0, 100000, kBudgetNs, inputs(1.0f, 0.0f), &out));
}

TEST(StTraceLogTest, BoundedRingBufferDropsOldestWhenFull)
{
    StTraceLog trace(3);
    for (int i = 0; i < 5; i++) {
        StTraceEvent e;
        e.kind = StTraceEventKind::VALIDATE_RESULT;
        e.timestamp_ns = static_cast<uint64_t>(i);
        e.ok = true;
        trace.push(e);
    }
    EXPECT_EQ(trace.events().size(), 3u);
    EXPECT_EQ(trace.dropped_count(), 2u);
    /* window trượt: phải giữ 3 event GẦN NHẤT (timestamp 2,3,4) */
    EXPECT_EQ(trace.events().front().timestamp_ns, 2u);
    EXPECT_EQ(trace.events().back().timestamp_ns, 4u);
}
