/**
 * @file  test_st_runtime.cpp
 * @brief FW-SOM-ST-001 acceptance tests: parse source THẬT (không hard-code
 *        output), typecheck, atomic activation, execute trên input/output
 *        image thật, fault handling (NaN/Inf, unbound, type mismatch),
 *        activation-fail giữ package cũ, output không commit nửa chừng.
 */
#include <gtest/gtest.h>

#include <limits>

#include "st_runtime.hpp"

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

StIoImage inputs(float supply_temp, float setpoint)
{
    StIoImage io;
    io["SupplyTemp"] = {StType::REAL, supply_temp, false};
    io["Setpoint"] = {StType::REAL, setpoint, false};
    return io;
}

} // namespace

TEST(StRuntime, ActivatesRealSourceTextNotHardcoded)
{
    /* Chương trình đọc thật từ string source — parser phải thật sự parse ra
     * đúng tên/kiểu VAR_INPUT/VAR_OUTPUT, không phải kết quả cứng trong test. */
    StProgramRuntime rt;
    std::string error;
    ASSERT_TRUE(rt.activate(kHvacCtrl, &error)) << error;
    ASSERT_TRUE(rt.loaded());
    const StProgram* p = rt.active_program_for_test();
    ASSERT_EQ(p->name, "HVAC_CTRL");
    ASSERT_EQ(p->inputs.size(), 2u);
    EXPECT_EQ(p->inputs[0].name, "SupplyTemp");
    EXPECT_EQ(p->inputs[0].type, StType::REAL);
    EXPECT_EQ(p->inputs[1].name, "Setpoint");
    ASSERT_EQ(p->outputs.size(), 1u);
    EXPECT_EQ(p->outputs[0].name, "FanEnable");
    EXPECT_EQ(p->outputs[0].type, StType::BOOL);
}

TEST(StRuntime, SupplyAboveSetpointEnablesFan)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));
    StIoImage out;
    const StExecResult r = rt.execute(inputs(28.0f, 24.0f), &out);
    ASSERT_TRUE(r.ok) << r.error;
    ASSERT_TRUE(out.count("FanEnable"));
    EXPECT_EQ(out["FanEnable"].type, StType::BOOL);
    EXPECT_TRUE(out["FanEnable"].bool_value) << "SupplyTemp=28 > Setpoint=24 -> FanEnable=TRUE";
}

TEST(StRuntime, SupplyBelowSetpointDisablesFan)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));
    StIoImage out;
    const StExecResult r = rt.execute(inputs(22.0f, 24.0f), &out);
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_FALSE(out["FanEnable"].bool_value) << "SupplyTemp=22 < Setpoint=24 -> FanEnable=FALSE";
}

TEST(StRuntime, RejectsInvalidSyntax)
{
    StProgramRuntime rt;
    std::string error;
    const char* bad = R"ST(
PROGRAM HVAC_CTRL
VAR_INPUT
    SupplyTemp : REAL;
END_VAR
VAR_OUTPUT
    FanEnable : BOOL;
END_VAR
IF SupplyTemp > 1 THEN
    FanEnable := TRUE;
END_PROGRAM
)ST";   /* thiếu END_IF */
    EXPECT_FALSE(rt.activate(bad, &error));
    EXPECT_NE(error.find("syntax_error"), std::string::npos) << error;
    EXPECT_FALSE(rt.loaded());
    EXPECT_EQ(rt.activation_fail_count(), 1u);
}

TEST(StRuntime, RejectsTypeMismatchOnComparison)
{
    StProgramRuntime rt;
    std::string error;
    const char* bad = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
    B : BOOL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
IF A > B THEN
    Out := TRUE;
ELSE
    Out := FALSE;
END_IF;
END_PROGRAM
)ST";   /* '>' giữa REAL và BOOL */
    EXPECT_FALSE(rt.activate(bad, &error));
    EXPECT_NE(error.find("type_mismatch"), std::string::npos) << error;
}

TEST(StRuntime, RejectsTypeMismatchOnAssignment)
{
    StProgramRuntime rt;
    std::string error;
    const char* bad = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
Out := A;
END_PROGRAM
)ST";   /* gán REAL vào BOOL */
    EXPECT_FALSE(rt.activate(bad, &error));
    EXPECT_NE(error.find("type_mismatch"), std::string::npos) << error;
}

TEST(StRuntime, RejectsUnboundVariable)
{
    StProgramRuntime rt;
    std::string error;
    const char* bad = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
IF A > Unknown THEN
    Out := TRUE;
ELSE
    Out := FALSE;
END_IF;
END_PROGRAM
)ST";
    EXPECT_FALSE(rt.activate(bad, &error));
    EXPECT_NE(error.find("unbound_variable"), std::string::npos) << error;
}

TEST(StRuntime, RejectsAssignmentToInputVariable)
{
    /* IEC: VAR_INPUT là read-only trong body. */
    StProgramRuntime rt;
    std::string error;
    const char* bad = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
A := 1;
END_PROGRAM
)ST";
    EXPECT_FALSE(rt.activate(bad, &error));
    EXPECT_NE(error.find("readonly_input_target"), std::string::npos) << error;
}

TEST(StRuntime, ActivationFailureKeepsOldPackageRunning)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));

    std::string error;
    const char* broken = "PROGRAM P VAR_INPUT A : REAL; END_VAR";   /* thiếu phần còn lại */
    EXPECT_FALSE(rt.activate(broken, &error));

    /* Package cũ (HVAC_CTRL) vẫn phải chạy đúng — activation fail không phá active_. */
    ASSERT_TRUE(rt.loaded());
    EXPECT_EQ(rt.active_program_for_test()->name, "HVAC_CTRL");
    StIoImage out;
    const StExecResult r = rt.execute(inputs(30.0f, 20.0f), &out);
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_TRUE(out["FanEnable"].bool_value);
}

TEST(StRuntime, ValidReactivationReplacesOldPackage)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));
    EXPECT_EQ(rt.activation_count(), 1u);

    const char* renamed = R"ST(
PROGRAM HVAC_CTRL_V2
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
    ASSERT_TRUE(rt.activate(renamed));
    EXPECT_EQ(rt.activation_count(), 2u);
    EXPECT_EQ(rt.active_program_for_test()->name, "HVAC_CTRL_V2");
}

TEST(StRuntime, NonFiniteInputRejectedNotSilentlyGood)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));
    StIoImage out;
    out["FanEnable"] = {StType::BOOL, 0.0f, true};   /* sentinel: giá trị cũ */

    StIoImage bad_in = inputs(std::numeric_limits<float>::quiet_NaN(), 24.0f);
    StExecResult r = rt.execute(bad_in, &out);
    EXPECT_FALSE(r.ok);
    EXPECT_NE(r.error.find("nonfinite_input"), std::string::npos) << r.error;
    EXPECT_TRUE(out["FanEnable"].bool_value) << "output KHÔNG bị đụng khi input NaN -> không silent-GOOD";

    bad_in = inputs(std::numeric_limits<float>::infinity(), 24.0f);
    r = rt.execute(bad_in, &out);
    EXPECT_FALSE(r.ok);
    EXPECT_NE(r.error.find("nonfinite_input"), std::string::npos) << r.error;
    EXPECT_TRUE(out["FanEnable"].bool_value);
}

TEST(StRuntime, MissingDeclaredInputRejectedWithoutTouchingOutput)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));
    StIoImage out;
    out["FanEnable"] = {StType::BOOL, 0.0f, false};

    StIoImage incomplete;
    incomplete["SupplyTemp"] = {StType::REAL, 28.0f, false};   /* thiếu Setpoint */
    const StExecResult r = rt.execute(incomplete, &out);
    EXPECT_FALSE(r.ok);
    EXPECT_NE(r.error.find("missing_or_mistyped_input"), std::string::npos) << r.error;
    EXPECT_FALSE(out["FanEnable"].bool_value) << "output giữ nguyên khi input thiếu";
}

TEST(StRuntime, ExecuteBeforeActivationIsRejected)
{
    StProgramRuntime rt;
    StIoImage out;
    const StExecResult r = rt.execute(inputs(1.0f, 0.0f), &out);
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "no_active_program");
    EXPECT_TRUE(out.empty());
}

TEST(StRuntime, FaultCountObservableAcrossFailedExecutions)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));
    EXPECT_EQ(rt.fault_count(), 0u);

    StIoImage out;
    rt.execute(inputs(std::numeric_limits<float>::quiet_NaN(), 1.0f), &out);
    EXPECT_EQ(rt.fault_count(), 1u);
    rt.execute(inputs(std::numeric_limits<float>::quiet_NaN(), 1.0f), &out);
    EXPECT_EQ(rt.fault_count(), 2u);

    /* execute() thành công KHÔNG đụng fault_count */
    rt.execute(inputs(5.0f, 1.0f), &out);
    EXPECT_EQ(rt.fault_count(), 2u);
}

TEST(StRuntime, ExecuteDoesNotReparseOrReactivate)
{
    /* Scan path (execute) không được parse source / re-activate — chỉ
     * activate() mới làm tăng activation_count_. FW SOM group 7/9: no parse
     * trong scan path, execution package đã pre-resolve trước activation. */
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));
    const uint32_t count_after_activate = rt.activation_count();

    StIoImage out;
    for (int i = 0; i < 50; i++) {
        rt.execute(inputs(28.0f, 24.0f), &out);
        rt.execute(inputs(22.0f, 24.0f), &out);
    }
    EXPECT_EQ(rt.activation_count(), count_after_activate)
        << "execute() lặp lại không được kích hoạt lại / parse lại source";
}

TEST(StRuntime, RejectsDuplicateVariableDeclaration)
{
    StProgramRuntime rt;
    std::string error;
    const char* bad = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
    A : REAL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
Out := TRUE;
END_PROGRAM
)ST";
    EXPECT_FALSE(rt.activate(bad, &error));
    EXPECT_NE(error.find("duplicate_variable"), std::string::npos) << error;
}
