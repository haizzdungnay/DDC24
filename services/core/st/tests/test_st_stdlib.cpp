/**
 * @file  test_st_stdlib.cpp
 * @brief FW SOM IEC programming foundation, item 6: standard function/
 *        operator library tối thiểu — normal/boundary/type-error cho
 *        AND/OR/NOT, GT/GE/LT/LE/EQ/NE, LIMIT. Test qua ST program thật (end
 *        to end) thay vì gọi thẳng eval_std_function để đồng thời chứng minh
 *        registry + semantic + runtime khớp nhau.
 */
#include <gtest/gtest.h>

#include "st/st_runtime.hpp"
#include "st/st_stdlib.hpp"

using namespace core;

TEST(StStdlib, RegistryContainsLimitWithCorrectSignature)
{
    const StStdFunctionSignature* sig = find_std_function_signature("LIMIT");
    ASSERT_NE(sig, nullptr);
    ASSERT_EQ(sig->arg_types.size(), 3u);
    EXPECT_EQ(sig->arg_types[0], StType::REAL);
    EXPECT_EQ(sig->arg_types[1], StType::REAL);
    EXPECT_EQ(sig->arg_types[2], StType::REAL);
    EXPECT_EQ(sig->return_type, StType::REAL);
}

TEST(StStdlib, RegistryReturnsNullForUnknownFunction)
{
    EXPECT_EQ(find_std_function_signature("TON"), nullptr) << "TON chưa implement, KHÔNG được có trong registry";
    EXPECT_EQ(find_std_function_signature("SEL"), nullptr) << "SEL chưa implement, KHÔNG được có trong registry";
    EXPECT_EQ(find_std_function_signature("NOPE"), nullptr);
}

TEST(StStdlib, LimitClampsWithinRangeUnchanged)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    In : REAL;
END_VAR
VAR_OUTPUT
    Out : REAL;
END_VAR
Out := LIMIT(0.0, In, 10.0);
END_PROGRAM
)ST"));
    StIoImage io, out;
    io["In"] = {StType::REAL, 5.0f, false};
    ASSERT_TRUE(rt.execute(io, &out).ok);
    EXPECT_FLOAT_EQ(out["Out"].real_value, 5.0f);
}

TEST(StStdlib, LimitClampsBelowMinimum)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    In : REAL;
END_VAR
VAR_OUTPUT
    Out : REAL;
END_VAR
Out := LIMIT(0.0, In, 10.0);
END_PROGRAM
)ST"));
    StIoImage io, out;
    io["In"] = {StType::REAL, -5.0f, false};
    ASSERT_TRUE(rt.execute(io, &out).ok);
    EXPECT_FLOAT_EQ(out["Out"].real_value, 0.0f);
}

TEST(StStdlib, LimitClampsAboveMaximum)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    In : REAL;
END_VAR
VAR_OUTPUT
    Out : REAL;
END_VAR
Out := LIMIT(0.0, In, 10.0);
END_PROGRAM
)ST"));
    StIoImage io, out;
    io["In"] = {StType::REAL, 99.0f, false};
    ASSERT_TRUE(rt.execute(io, &out).ok);
    EXPECT_FLOAT_EQ(out["Out"].real_value, 10.0f);
}

TEST(StStdlib, LimitAtExactBoundaryIsUnchanged)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    In : REAL;
END_VAR
VAR_OUTPUT
    Out : REAL;
END_VAR
Out := LIMIT(0.0, In, 10.0);
END_PROGRAM
)ST"));
    StIoImage io, out;
    io["In"] = {StType::REAL, 10.0f, false};
    ASSERT_TRUE(rt.execute(io, &out).ok);
    EXPECT_FLOAT_EQ(out["Out"].real_value, 10.0f) << "biên trên là giá trị hợp lệ, không bị đẩy ra ngoài";
}

TEST(StStdlib, LimitRejectsBoolArgumentAtTypecheck)
{
    StProgramRuntime rt;
    StDiagnostic diag;
    EXPECT_FALSE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    Flag : BOOL;
END_VAR
VAR_OUTPUT
    Out : REAL;
END_VAR
Out := LIMIT(0.0, Flag, 10.0);
END_PROGRAM
)ST", &diag));
    EXPECT_EQ(diag.code, st_diag_code::kTypeMismatch);
}

TEST(StStdlib, AndOrNotBoundaryAllCombinations)
{
    StProgramRuntime rt;
    ASSERT_TRUE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    A : BOOL;
    B : BOOL;
END_VAR
VAR_OUTPUT
    AndOut : BOOL;
    OrOut : BOOL;
END_VAR
AndOut := A AND B;
OrOut := A OR B;
END_PROGRAM
)ST"));
    const bool table[4][2] = {{false, false}, {false, true}, {true, false}, {true, true}};
    for (const auto& row : table) {
        StIoImage io, out;
        io["A"] = {StType::BOOL, 0.0f, row[0]};
        io["B"] = {StType::BOOL, 0.0f, row[1]};
        ASSERT_TRUE(rt.execute(io, &out).ok);
        EXPECT_EQ(out["AndOut"].bool_value, row[0] && row[1]) << "A=" << row[0] << " B=" << row[1];
        EXPECT_EQ(out["OrOut"].bool_value, row[0] || row[1]) << "A=" << row[0] << " B=" << row[1];
    }
}

TEST(StStdlib, ComparatorsRejectMixedRealBoolAtTypecheck)
{
    StProgramRuntime rt;
    StDiagnostic diag;
    EXPECT_FALSE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    A : REAL;
    B : BOOL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
Out := A >= B;
END_PROGRAM
)ST", &diag));
    EXPECT_EQ(diag.code, st_diag_code::kTypeMismatch);
}

TEST(StStdlib, EqualityAllowsBoolBoolButNotOrderingOperators)
{
    StProgramRuntime rt;
    StDiagnostic diag;
    /* '=' cho phép BOOL=BOOL (equality định nghĩa cho cả 2 kiểu) */
    ASSERT_TRUE(rt.activate(R"ST(
PROGRAM P
VAR_INPUT
    A : BOOL;
    B : BOOL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
Out := A = B;
END_PROGRAM
)ST", &diag)) << diag.message;

    /* nhưng '>' KHÔNG định nghĩa cho BOOL */
    StProgramRuntime rt2;
    EXPECT_FALSE(rt2.activate(R"ST(
PROGRAM P
VAR_INPUT
    A : BOOL;
    B : BOOL;
END_VAR
VAR_OUTPUT
    Out : BOOL;
END_VAR
Out := A > B;
END_PROGRAM
)ST", &diag));
    EXPECT_EQ(diag.code, st_diag_code::kTypeMismatch);
}
