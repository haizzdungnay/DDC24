/**
 * @file  test_st_runtime.cpp
 * @brief FW SOM IEC programming foundation acceptance tests: parse source
 *        THẬT (không hard-code output), typecheck, atomic activation,
 *        execute trên input/output image thật, fault handling (NaN/Inf,
 *        unbound, type mismatch), activation-fail giữ package cũ, output
 *        không commit nửa chừng, diagnostics có line/column đúng, grammar mở
 *        rộng (so sánh đầy đủ, AND/OR/NOT, gọi hàm LIMIT).
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
    StDiagnostic diag;
    ASSERT_TRUE(rt.activate(kHvacCtrl, &diag)) << diag.message;
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
    StDiagnostic diag;
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
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kSyntaxUnexpected);
    EXPECT_TRUE(diag.has_position()) << "diagnostic phải có line/column";
    EXPECT_FALSE(rt.loaded());
    EXPECT_EQ(rt.activation_fail_count(), 1u);
}

TEST(StRuntime, SyntaxErrorDiagnosticHasCorrectLineAndColumn)
{
    StProgramRuntime rt;
    StDiagnostic diag;
    /* Dòng 1: PROGRAM P. Dòng 2-3: VAR_INPUT rỗng. Dòng 4: VAR_OUTPUT thiếu ':' —
     * lỗi phải trỏ đúng dòng 5 cột 5 (chữ "X" — token gặp khi đang mong ':'). */
    const char* bad =
        "PROGRAM P\n"
        "VAR_INPUT\n"
        "END_VAR\n"
        "VAR_OUTPUT\n"
        "    X BOOL;\n"
        "END_VAR\n"
        "END_PROGRAM\n";
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.line, 5);
    EXPECT_EQ(diag.column, 7) << "cột của token 'BOOL' (sau khoảng trắng thụt lề 4 + 'X' + space)";
}

TEST(StRuntime, UnboundVariableDiagnosticPointsAtUsage)
{
    StProgramRuntime rt;
    StDiagnostic diag;
    const char* bad =
        "PROGRAM P\n"
        "VAR_INPUT\n"
        "    A : REAL;\n"
        "END_VAR\n"
        "VAR_OUTPUT\n"
        "    Out : BOOL;\n"
        "END_VAR\n"
        "IF A > Unknown THEN\n"
        "    Out := TRUE;\n"
        "ELSE\n"
        "    Out := FALSE;\n"
        "END_IF;\n"
        "END_PROGRAM\n";
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kUnboundVariable);
    EXPECT_EQ(diag.line, 8);
    EXPECT_EQ(diag.column, 8) << "cột của 'Unknown' trên dòng 8";
}

TEST(StRuntime, RejectsTypeMismatchOnComparison)
{
    StProgramRuntime rt;
    StDiagnostic diag;
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
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kTypeMismatch);
}

TEST(StRuntime, RejectsTypeMismatchOnAssignment)
{
    StProgramRuntime rt;
    StDiagnostic diag;
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
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kTypeMismatch);
}

TEST(StRuntime, RejectsUnboundVariable)
{
    StProgramRuntime rt;
    StDiagnostic diag;
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
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kUnboundVariable);
}

TEST(StRuntime, RejectsAssignmentToInputVariable)
{
    /* IEC: VAR_INPUT là read-only trong body. */
    StProgramRuntime rt;
    StDiagnostic diag;
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
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kReadonlyInput);
}

TEST(StRuntime, ActivationFailureKeepsOldPackageRunning)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(kHvacCtrl));

    StDiagnostic diag;
    const char* broken = "PROGRAM P VAR_INPUT A : REAL; END_VAR";   /* thiếu phần còn lại */
    EXPECT_FALSE(rt.activate(broken, &diag));

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
     * activate() mới làm tăng activation_count_. */
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
    StDiagnostic diag;
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
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kDuplicateVar);
}

/* ---- Grammar mở rộng: so sánh đầy đủ, AND/OR/NOT, ngoặc, gọi hàm LIMIT ---- */

TEST(StRuntime, FullComparatorSetEvaluatesCorrectly)
{
    const char* src = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
    B : REAL;
END_VAR
VAR_OUTPUT
    Ge : BOOL;
    Lt : BOOL;
    Le : BOOL;
    Eq : BOOL;
    Ne : BOOL;
END_VAR
Ge := A >= B;
Lt := A < B;
Le := A <= B;
Eq := A = B;
Ne := A <> B;
END_PROGRAM
)ST";
    StProgramRuntime rt;
    StDiagnostic diag;
    ASSERT_TRUE(rt.activate(src, &diag)) << diag.message;

    StIoImage io;
    io["A"] = {StType::REAL, 5.0f, false};
    io["B"] = {StType::REAL, 5.0f, false};
    StIoImage out;
    ASSERT_TRUE(rt.execute(io, &out).ok);
    EXPECT_TRUE(out["Ge"].bool_value);
    EXPECT_FALSE(out["Lt"].bool_value);
    EXPECT_TRUE(out["Le"].bool_value);
    EXPECT_TRUE(out["Eq"].bool_value);
    EXPECT_FALSE(out["Ne"].bool_value);
}

TEST(StRuntime, BooleanAndOrNotEvaluateCorrectly)
{
    const char* src = R"ST(
PROGRAM P
VAR_INPUT
    A : BOOL;
    B : BOOL;
END_VAR
VAR_OUTPUT
    AndOut : BOOL;
    OrOut : BOOL;
    NotOut : BOOL;
END_VAR
AndOut := A AND B;
OrOut := A OR B;
NotOut := NOT A;
END_PROGRAM
)ST";
    StProgramRuntime rt;
    StDiagnostic diag;
    ASSERT_TRUE(rt.activate(src, &diag)) << diag.message;

    StIoImage io;
    io["A"] = {StType::BOOL, 0.0f, true};
    io["B"] = {StType::BOOL, 0.0f, false};
    StIoImage out;
    ASSERT_TRUE(rt.execute(io, &out).ok);
    EXPECT_FALSE(out["AndOut"].bool_value) << "TRUE AND FALSE = FALSE";
    EXPECT_TRUE(out["OrOut"].bool_value) << "TRUE OR FALSE = TRUE";
    EXPECT_FALSE(out["NotOut"].bool_value) << "NOT TRUE = FALSE";
}

TEST(StRuntime, ParenthesesGroupExpressionsCorrectly)
{
    const char* src = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
    B : REAL;
    C : REAL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
IF (A > B) AND (C > 0) THEN
    Out := TRUE;
ELSE
    Out := FALSE;
END_IF;
END_PROGRAM
)ST";
    StProgramRuntime rt;
    StDiagnostic diag;
    ASSERT_TRUE(rt.activate(src, &diag)) << diag.message;

    StIoImage io;
    io["A"] = {StType::REAL, 10.0f, false};
    io["B"] = {StType::REAL, 5.0f, false};
    io["C"] = {StType::REAL, 1.0f, false};
    StIoImage out;
    ASSERT_TRUE(rt.execute(io, &out).ok);
    EXPECT_TRUE(out["Out"].bool_value);
}

TEST(StRuntime, RejectsUnknownFunction)
{
    StProgramRuntime rt;
    StDiagnostic diag;
    const char* bad = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
END_VAR
VAR_OUTPUT
    Out : REAL;
END_VAR
Out := NOPE(A);
END_PROGRAM
)ST";
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kUnknownFunction);
}

TEST(StRuntime, RejectsFunctionArgCountMismatch)
{
    StProgramRuntime rt;
    StDiagnostic diag;
    const char* bad = R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
END_VAR
VAR_OUTPUT
    Out : REAL;
END_VAR
Out := LIMIT(A, A);
END_PROGRAM
)ST";
    EXPECT_FALSE(rt.activate(bad, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kArgCountMismatch);
}
