/**
 * @file  test_st_limits.cpp
 * @brief M-01 / PARSER_SAFETY_GATE — test ĐỐI KHÁNG cho parser.
 *
 *        Khác toàn bộ test ST hiện có (đều kiểm đường đi đúng), file này chỉ
 *        đưa input độc hại/bệnh lý và yêu cầu DUY NHẤT một điều: parser phải
 *        từ chối có kiểm soát, trả StDiagnostic đúng code, và KHÔNG BAO GIỜ
 *        segfault/abort. Đây chính là lớp kiểm mà lỗi F-01 (tràn stack, exit
 *        139) đã lọt qua vì trước đây không tồn tại.
 */
#include <gtest/gtest.h>

#include <string>

#include "st/st_diagnostic.hpp"
#include "st/st_limits.hpp"
#include "st/st_parser.hpp"
#include "st/st_program.hpp"

namespace core {
namespace {

std::string wrap(const std::string& body, const std::string& in_decls = "a : REAL;",
                 const std::string& out_decls = "b : REAL;")
{
    return "PROGRAM p\nVAR_INPUT " + in_decls + " END_VAR\nVAR_OUTPUT " + out_decls +
           " END_VAR\n" + body + "END_PROGRAM\n";
}

std::string repeat(const std::string& unit, std::size_t n)
{
    std::string s;
    s.reserve(unit.size() * n);
    for (std::size_t i = 0; i < n; i++) s += unit;
    return s;
}

/* ---- Độ sâu biểu thức: chính là kịch bản repro của F-01 ---- */

TEST(StLimits, DeepParenNesting12000RejectedNotCrash)
{
    /* 12000 ngoặc lồng — trước M-01 đây là SIGSEGV, exit 139, stdout rỗng. */
    const std::string src = wrap("b := " + repeat("(", 12000) + "a" + repeat(")", 12000) + ";\n");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kNestingTooDeep);
    EXPECT_GT(diag.line, 0);
    EXPECT_GT(diag.column, 0);
}

TEST(StLimits, DeepParenNesting20000RejectedNotCrash)
{
    const std::string src = wrap("b := " + repeat("(", 20000) + "a" + repeat(")", 20000) + ";\n");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    /* 20000 ngoặc = 40000 token > kMaxTokens, nên chạm trần token TRƯỚC trần
     * độ sâu. Cả hai đều là từ chối có kiểm soát — chấp nhận một trong hai,
     * điều bắt buộc là KHÔNG crash và code phải thuộc nhóm giới hạn. */
    EXPECT_TRUE(diag.code == st_diag_code::kNestingTooDeep ||
                diag.code == st_diag_code::kTooManyTokens)
        << "actual code: " << diag.code;
}

TEST(StLimits, DeepNotChainRejectedNotCrash)
{
    /* `NOT NOT NOT ...` đệ quy parse_not -> parse_not, KHÔNG đi qua
     * parse_expr — guard riêng ở parse_not phải bắt được. */
    const std::string src = wrap("b := " + repeat("NOT ", 5000) + "a;\n");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kNestingTooDeep);
}

TEST(StLimits, DeepCallArgNestingRejectedNotCrash)
{
    /* Đệ quy qua argument của lời gọi hàm: LIMIT(0.0, LIMIT(0.0, LIMIT(...))) */
    std::string expr = "a";
    for (int i = 0; i < 2000; i++) expr = "LIMIT(0.0, " + expr + ", 100.0)";
    const std::string src = wrap("b := " + expr + ";\n");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_TRUE(diag.code == st_diag_code::kNestingTooDeep ||
                diag.code == st_diag_code::kTooManyTokens)
        << "actual code: " << diag.code;
}

TEST(StLimits, ExprDepthAtLimitAccepted)
{
    /* Sát giới hạn (kMaxExprDepth - 2 cấp ngoặc, chừa chỗ cho expr gốc) phải
     * CHẠY ĐƯỢC — giới hạn không được chặn nhầm chương trình hợp lệ. */
    const int depth = st_limits::kMaxExprDepth - 2;
    const std::string src =
        wrap("b := " + repeat("(", depth) + "a" + repeat(")", depth) + ";\n");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_TRUE(parse_st_program(src, &prog, &diag)) << diag.code << ": " << diag.message;
}

/* ---- Độ sâu statement ---- */

TEST(StLimits, DeepNestedIfRejectedNotCrash)
{
    const int n = 500;
    const std::string src =
        wrap(repeat("IF a > 1.0 THEN\n", n) + "b := 1.0;\n" + repeat("END_IF;\n", n));
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kNestingTooDeep);
}

TEST(StLimits, NestedIfAtLimitAccepted)
{
    /* stmt_depth_ tăng 1 cho stmt_list gốc của body, nên chừa 1 cấp. */
    const int n = st_limits::kMaxStmtDepth - 1;
    const std::string src =
        wrap(repeat("IF a > 1.0 THEN\n", n) + "b := 1.0;\n" + repeat("END_IF;\n", n));
    StProgram prog;
    StDiagnostic diag;
    EXPECT_TRUE(parse_st_program(src, &prog, &diag)) << diag.code << ": " << diag.message;
}

/* ---- Kích thước source ---- */

TEST(StLimits, SourceOverSizeLimitRejected)
{
    std::string src = wrap("b := a;\n");
    src += "(* padding *)";
    src += std::string(st_limits::kMaxSourceBytes + 1, ' ');
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kSourceTooLarge);
}

TEST(StLimits, SourceJustUnderSizeLimitNotRejectedForSize)
{
    /* Sát dưới giới hạn: không được từ chối vì LÝ DO kích thước. */
    std::string src = wrap("b := a;\n");
    const std::size_t pad = st_limits::kMaxSourceBytes - src.size() - 1;
    src.insert(src.size() - std::string("END_PROGRAM\n").size(), std::string(pad, '\n'));
    ASSERT_LE(src.size(), st_limits::kMaxSourceBytes);
    StProgram prog;
    StDiagnostic diag;
    const bool ok = parse_st_program(src, &prog, &diag);
    if (!ok) {
        EXPECT_NE(diag.code, st_diag_code::kSourceTooLarge) << diag.message;
    }
}

/* ---- Số token ---- */

TEST(StLimits, TokenCountOverLimitRejected)
{
    /* Nhiều statement hợp lệ nhưng tổng token vượt trần. */
    const std::string src = wrap(repeat("b := a;\n", 8000));
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_TRUE(diag.code == st_diag_code::kTooManyTokens ||
                diag.code == st_diag_code::kTooManyStatements ||
                diag.code == st_diag_code::kSourceTooLarge)
        << "actual code: " << diag.code;
}

/* ---- Độ dài identifier ---- */

TEST(StLimits, IdentifierTooLongRejected)
{
    const std::string long_name = "V" + std::string(st_limits::kMaxIdentifierLength, 'x');
    const std::string src = wrap("b := a;\n", long_name + " : REAL;");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kIdentifierTooLong);
}

TEST(StLimits, IdentifierAtLimitAccepted)
{
    const std::string name = "V" + std::string(st_limits::kMaxIdentifierLength - 1, 'x');
    ASSERT_EQ(name.size(), st_limits::kMaxIdentifierLength);
    const std::string src = wrap("b := " + name + ";\n", name + " : REAL;");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_TRUE(parse_st_program(src, &prog, &diag)) << diag.code << ": " << diag.message;
}

/* ---- Số biến ---- */

TEST(StLimits, VariableCountOverLimitRejected)
{
    std::string decls;
    for (std::size_t i = 0; i <= st_limits::kMaxVariables; i++)
        decls += "v" + std::to_string(i) + " : REAL; ";
    const std::string src = wrap("b := a;\n", decls + " a : REAL;");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_TRUE(diag.code == st_diag_code::kTooManyVariables ||
                diag.code == st_diag_code::kTooManyTokens)
        << "actual code: " << diag.code;
}

/* ---- Input sai định dạng (không phải ST) ---- */

TEST(StLimits, BinaryGarbageRejectedNotCrash)
{
    std::string src;
    for (int i = 0; i < 4096; i++) src += static_cast<char>(i % 251 + 1);
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_FALSE(diag.code.empty());
}

TEST(StLimits, EmptySourceRejectedNotCrash)
{
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program("", &prog, &diag));
    EXPECT_FALSE(diag.code.empty());
}

TEST(StLimits, UnterminatedProgramRejectedNotCrash)
{
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program("PROGRAM p\nVAR_INPUT a : REAL;", &prog, &diag));
    EXPECT_FALSE(diag.code.empty());
}

TEST(StLimits, OnlyOpenParensRejectedNotCrash)
{
    /* Không có token đóng nào — phải chạm trần rồi dừng, không lặp vô hạn. */
    const std::string src = wrap("b := " + repeat("(", 30000) + ";\n");
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_FALSE(diag.code.empty());
}

TEST(StLimits, NullBytesInSourceRejectedNotCrash)
{
    std::string src = wrap("b := a;\n");
    src.insert(src.size() / 2, std::string(4, '\0'));
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_FALSE(diag.code.empty());
}

/* ---- Diagnostic luôn dùng được cho BE ---- */

TEST(StLimits, EveryRejectionCarriesStableCode)
{
    const std::string cases[] = {
        wrap("b := " + repeat("(", 12000) + "a" + repeat(")", 12000) + ";\n"),
        wrap("b := " + repeat("NOT ", 5000) + "a;\n"),
        wrap(repeat("IF a > 1.0 THEN\n", 500) + "b := 1.0;\n" + repeat("END_IF;\n", 500)),
        "",
        "PROGRAM p\nVAR_INPUT a : REAL;",
        wrap("b := @@@;\n"),
    };
    for (const std::string& src : cases) {
        StProgram prog;
        StDiagnostic diag;
        ASSERT_FALSE(parse_st_program(src, &prog, &diag));
        EXPECT_FALSE(diag.code.empty()) << "diagnostic without code";
        EXPECT_FALSE(diag.message.empty()) << "diagnostic without message";
        EXPECT_EQ(diag.severity, StSeverity::ERROR);
    }
}

} // namespace
} // namespace core
