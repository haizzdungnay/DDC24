/**
 * @file  test_st_lang.cpp
 * @brief Tập con ngôn ngữ ST theo ST_SUBSET_SPEC — parser + semantic.
 *        Mỗi test bám một mục cụ thể của SPEC, ghi rõ trong tên.
 */
#include <gtest/gtest.h>

#include <string>

#include "st/st_parser.hpp"
#include "st/st_program.hpp"
#include "st/st_semantic.hpp"

namespace core {
namespace {

bool check(const std::string& src, StDiagnostic* diag)
{
    StProgram p;
    if (!parse_st_program(src, &p, diag)) return false;
    return typecheck_st_program(&p, diag);
}

bool parse_only(const std::string& src, StProgram* p, StDiagnostic* diag)
{
    if (!parse_st_program(src, p, diag)) return false;
    return typecheck_st_program(p, diag);
}

std::string prog(const std::string& decls, const std::string& body)
{
    return "PROGRAM t\n" + decls + body + "END_PROGRAM\n";
}

} // namespace

/* ---- §3.1 kiểu cơ sở ---- */

TEST(StLang, AllFourBaseTypesAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR a : BOOL; b : INT; c : REAL; e : TIME; END_VAR\n",
                           "a := TRUE;\nb := 1;\nc := 1.0;\ne := T#1s;\n"), &d))
        << d.code << ": " << d.message;
}

/* ---- §3.2 literal TIME ---- */

TEST(StLang, TimeLiteralCompoundParsed)
{
    StProgram p;
    StDiagnostic d;
    ASSERT_TRUE(parse_only(prog("VAR_OUTPUT e : TIME; END_VAR\n", "e := T#1m30s;\n"), &p, &d))
        << d.code << ": " << d.message;
    ASSERT_EQ(p.body.size(), 1u);
    EXPECT_EQ(p.body[0].assign_expr->literal.t, 90ll * 1000000000ll);
}

TEST(StLang, TimeLiteralMillisecondsNotConfusedWithMinutes)
{
    StProgram p;
    StDiagnostic d;
    ASSERT_TRUE(parse_only(prog("VAR_OUTPUT e : TIME; END_VAR\n", "e := T#500ms;\n"), &p, &d));
    EXPECT_EQ(p.body[0].assign_expr->literal.t, 500ll * 1000000ll);
}

TEST(StLang, TimeLiteralWrongUnitOrderRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_OUTPUT e : TIME; END_VAR\n", "e := T#30s1m;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kBadTimeLiteral);
}

TEST(StLang, TimeLiteralRepeatedUnitRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_OUTPUT e : TIME; END_VAR\n", "e := T#1m1m;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kBadTimeLiteral);
}

/* ---- §3.3 / §3.4 kiểu chặt và literal đa hình ---- */

TEST(StLang, IntLiteralAdaptsToRealContext)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR r : REAL; END_VAR\n", "r := r + 1;\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, IntLiteralAdaptsToIntContext)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR i : INT; END_VAR\n", "i := i + 1;\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, RealLiteralInIntContextRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR i : INT; END_VAR\n", "i := i + 1.0;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kTypeMismatch);
}

TEST(StLang, MixingIntAndRealVariablesRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR i : INT; r : REAL; END_VAR\n", "r := i;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kTypeMismatch);
}

TEST(StLang, ExplicitConversionAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR i : INT; r : REAL; END_VAR\n", "r := INT_TO_REAL(i);\n"), &d))
        << d.code << ": " << d.message;
}

/* ---- §4 toán tử ---- */

TEST(StLang, ArithmeticOperatorsAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR i : INT; END_VAR\n", "i := (1 + 2) * 3 - 4 / 2 MOD 3;\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, PrecedenceMulBeforeAdd)
{
    /* 2 + 3 * 4 phải phân tích thành 2 + (3*4), tức node gốc là ADD. */
    StProgram p;
    StDiagnostic d;
    ASSERT_TRUE(parse_only(prog("VAR i : INT; END_VAR\n", "i := 2 + 3 * 4;\n"), &p, &d));
    const StExpr& root = *p.body[0].assign_expr;
    ASSERT_EQ(root.kind, StExpr::Kind::BINOP);
    EXPECT_EQ(root.bin_op, StBinOp::ADD);
    EXPECT_EQ(root.rhs->bin_op, StBinOp::MUL);
}

TEST(StLang, PrecedenceComparisonBelowArithmetic)
{
    StProgram p;
    StDiagnostic d;
    ASSERT_TRUE(parse_only(prog("VAR i : INT; b : BOOL; END_VAR\n", "b := i + 1 > 2;\n"), &p, &d));
    const StExpr& root = *p.body[0].assign_expr;
    EXPECT_EQ(root.bin_op, StBinOp::GT);
    EXPECT_EQ(root.lhs->bin_op, StBinOp::ADD);
}

TEST(StLang, XorAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR a : BOOL; b : BOOL; END_VAR\n", "a := a XOR b;\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, UnaryMinusAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR r : REAL; END_VAR\n", "r := -r;\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, ModOnRealRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR r : REAL; END_VAR\n", "r := r MOD r;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kTypeMismatch);
}

TEST(StLang, TimeMultiplyRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR e : TIME; END_VAR\n", "e := e * e;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kTypeMismatch);
}

TEST(StLang, TimeAddAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR e : TIME; END_VAR\n", "e := e + T#1s;\n"), &d))
        << d.code << ": " << d.message;
}

/* ---- §5.2 ELSIF ---- */

TEST(StLang, ElsifChainParsed)
{
    StProgram p;
    StDiagnostic d;
    ASSERT_TRUE(parse_only(prog("VAR i : INT; r : REAL; END_VAR\n",
                                "IF i > 3 THEN r := 1.0;\n"
                                "ELSIF i > 2 THEN r := 2.0;\n"
                                "ELSIF i > 1 THEN r := 3.0;\n"
                                "ELSE r := 4.0;\n"
                                "END_IF;\n"), &p, &d))
        << d.code << ": " << d.message;
    ASSERT_EQ(p.body.size(), 1u);
    /* 3 nhánh có điều kiện + 1 nhánh ELSE */
    ASSERT_EQ(p.body[0].branches.size(), 4u);
    EXPECT_EQ(p.body[0].branches[3].cond, nullptr);
}

TEST(StLang, IfConditionMustBeBool)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR i : INT; END_VAR\n", "IF i THEN i := 1; END_IF;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kTypeMismatch);
}

/* ---- Chú thích ---- */

TEST(StLang, BlockAndLineCommentsIgnored)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR r : REAL; END_VAR\n",
                           "(* khối *)\nr := 1.0;  // dòng\n(* nhiều\n dòng *)\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, UnterminatedBlockCommentRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR r : REAL; END_VAR\n", "(* không đóng\nr := 1.0;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kUnterminatedComment);
}

TEST(StLang, BlockCommentDoesNotNest)
{
    /* SPEC §10: (* a (* b *) c *) kết thúc ở *) ĐẦU TIÊN, phần còn lại là lỗi. */
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR r : REAL; END_VAR\n", "(* a (* b *) c *)\nr := 1.0;\n"), &d));
}

/* ---- Từ khoá không phân biệt hoa thường ---- */

TEST(StLang, KeywordsAreCaseInsensitive)
{
    StDiagnostic d;
    EXPECT_TRUE(check("program t\nvar r : real; end_var\n"
                      "if TRUE then r := 1.0; end_if;\nend_program\n", &d))
        << d.code << ": " << d.message;
}

TEST(StLang, IdentifiersAreCaseSensitive)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR abc : REAL; END_VAR\n", "ABC := 1.0;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kUnboundVariable);
}

/* ---- §2 khối VAR ---- */

TEST(StLang, VarRetainBlockAccepted)
{
    StProgram p;
    StDiagnostic d;
    ASSERT_TRUE(parse_only(prog("VAR RETAIN n : INT; END_VAR\n", "n := n + 1;\n"), &p, &d))
        << d.code << ": " << d.message;
    ASSERT_EQ(p.vars.size(), 1u);
    EXPECT_EQ(p.vars[0].storage, StStorage::VAR_RETAIN);
}

TEST(StLang, DuplicateVarBlockRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR a : INT; END_VAR\nVAR b : INT; END_VAR\n", "a := 1;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kSyntaxUnexpected);
}

TEST(StLang, AssignToInputRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_INPUT a : INT; END_VAR\n", "a := 1;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kReadonlyInput);
}

TEST(StLang, ProgramWithoutAnyVarBlockAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check("PROGRAM t\nEND_PROGRAM\n", &d)) << d.code << ": " << d.message;
}

/* ---- §6.2 Function Block ---- */

TEST(StLang, TonDeclarationAndCallAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR_INPUT c : BOOL; END_VAR\nVAR_OUTPUT q : BOOL; END_VAR\n"
                           "VAR dly : TON; END_VAR\n",
                           "dly(IN := c, PT := T#30s);\nq := dly.Q;\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, FbCalledTwicePerCycleRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_INPUT c : BOOL; END_VAR\nVAR dly : TON; END_VAR\n",
                            "dly(IN := c, PT := T#1s);\ndly(IN := c, PT := T#2s);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kFbCalledTwice);
}

TEST(StLang, FbUnknownParameterRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_INPUT c : BOOL; END_VAR\nVAR dly : TON; END_VAR\n",
                            "dly(INPUT := c);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kBadFbParam);
}

TEST(StLang, FbPositionalArgumentRejected)
{
    /* SPEC §5.3: chỉ tham số đặt tên. Tham số theo vị trí phải bị từ chối
     * TƯỜNG MINH, không được im lặng hiểu sai thứ tự. */
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_INPUT c : BOOL; END_VAR\nVAR dly : TON; END_VAR\n",
                            "dly(c, T#1s);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kBadFbParam);
}

TEST(StLang, FbWrongParameterTypeRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_INPUT c : BOOL; END_VAR\nVAR dly : TON; END_VAR\n",
                            "dly(IN := c, PT := 5);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kTypeMismatch);
}

TEST(StLang, FbUnknownOutputRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_OUTPUT q : BOOL; END_VAR\nVAR dly : TON; END_VAR\n",
                            "q := dly.ZZZ;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kBadFbParam);
}

TEST(StLang, AssignToFbInstanceRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR dly : TON; END_VAR\n", "dly := 1;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kAssignToFbInstance);
}

TEST(StLang, WriteToFbOutputRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR dly : TON; END_VAR\n", "dly.Q := TRUE;\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kWriteToFbOutput);
}

TEST(StLang, FbInVarInputRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR_INPUT dly : TON; END_VAR\n", "\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kSyntaxUnexpected);
}

TEST(StLang, StandardFunctionUsedAsStatementRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR r : REAL; END_VAR\n", "ABS(r);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kFbFunctionConfusion);
}

TEST(StLang, RTrigAccepted)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR_INPUT c : BOOL; END_VAR\nVAR_OUTPUT q : BOOL; END_VAR\n"
                           "VAR tr : R_TRIG; END_VAR\n",
                           "tr(CLK := c);\nq := tr.Q;\n"), &d))
        << d.code << ": " << d.message;
}

/* ---- §6.1 hàm chuẩn ---- */

TEST(StLang, AllStandardFunctionsTypecheck)
{
    StDiagnostic d;
    EXPECT_TRUE(check(prog("VAR i : INT; r : REAL; b : BOOL; e : TIME; END_VAR\n",
                           "i := ABS(i);\n"
                           "r := ABS(r);\n"
                           "i := MIN(i, 2);\n"
                           "r := MAX(r, 1.0);\n"
                           "r := LIMIT(0.0, r, 100.0);\n"
                           "r := SEL(b, 1.0, 2.0);\n"
                           "r := SQRT(r);\n"
                           "r := INT_TO_REAL(i);\n"
                           "i := REAL_TO_INT(r);\n"
                           "r := TIME_TO_REAL(e);\n"
                           "e := REAL_TO_TIME(r);\n"), &d))
        << d.code << ": " << d.message;
}

TEST(StLang, WrongArgCountRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR r : REAL; END_VAR\n", "r := LIMIT(0.0, r);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kArgCountMismatch);
}

TEST(StLang, UnknownFunctionRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR r : REAL; END_VAR\n", "r := FOO(r);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kUnknownFunction);
}

TEST(StLang, SelWithMismatchedBranchTypesRejected)
{
    StDiagnostic d;
    EXPECT_FALSE(check(prog("VAR b : BOOL; r : REAL; i : INT; END_VAR\n",
                            "r := SEL(b, r, i);\n"), &d));
    EXPECT_EQ(d.code, st_diag_code::kTypeMismatch);
}

/* ---- Chương trình tham chiếu của SPEC §13 ---- */

TEST(StLang, SpecReferenceProgramCompiles)
{
    const char* src = R"ST(
PROGRAM AHU_FanControl
VAR_INPUT
    SupplyTemp  : REAL;
    Setpoint    : REAL;
    Occupied    : BOOL;
END_VAR
VAR_OUTPUT
    FanEnable   : BOOL;
    FanSpeed    : REAL;
    AlarmHigh   : BOOL;
END_VAR
VAR
    StartDelay  : TON;
    HighTrig    : R_TRIG;
    Deviation   : REAL;
END_VAR
VAR RETAIN
    StartCount  : INT;
END_VAR
    Deviation := SupplyTemp - Setpoint;
    StartDelay(IN := Occupied AND (Deviation > 1.0), PT := T#30s);
    FanEnable := StartDelay.Q;
    // Tốc độ tỉ lệ độ lệch
    FanSpeed := LIMIT(0.0, Deviation * 20.0, 100.0);
    AlarmHigh := Deviation > 5.0;
    (* Đếm số lần khởi động *)
    HighTrig(CLK := FanEnable);
    IF HighTrig.Q THEN
        StartCount := StartCount + 1;
    END_IF;
END_PROGRAM
)ST";
    StDiagnostic d;
    EXPECT_TRUE(check(src, &d)) << d.code << ": " << d.message << " @" << d.line << ":" << d.column;
}

} // namespace core
