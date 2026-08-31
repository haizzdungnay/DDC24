/**
 * @file  test_st_multi_diagnostic.cpp
 * @brief `ISS-STED-01` — compiler trả NHIỀU diagnostic theo hợp đồng
 *        `DDD-LANG-PROG-001` §7: trần 64, sort `program/order/location/code`,
 *        chạm trần thì thêm đúng một `ST-LIM-006`.
 *
 *        Mỗi test bám một tiêu chí chấp nhận của issue, ghi rõ trong tên.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <string>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_parser.hpp"
#include "st/st_program.hpp"
#include "st/st_semantic.hpp"

namespace core {
namespace {

/* Parse + typecheck một PROGRAM, thu mọi diagnostic vào túi ĐÃ `finalize()` —
 * đúng trạng thái mà CLI phát ra JSON. */
StDiagnosticBag check_all(const std::string& source)
{
    StDiagnosticBag bag;
    StDiagnostic diagnostic;
    StProgram program;
    if (parse_st_program(source, &program, &diagnostic, &bag))
        typecheck_st_program(&program, &diagnostic, &bag);
    bag.finalize();
    return bag;
}

std::vector<std::string> codes_of(const StDiagnosticBag& bag)
{
    std::vector<std::string> codes;
    for (const StDiagnostic& diagnostic : bag.items()) codes.push_back(diagnostic.code);
    return codes;
}

std::vector<int> lines_of(const StDiagnosticBag& bag)
{
    std::vector<int> lines;
    for (const StDiagnostic& diagnostic : bag.items()) lines.push_back(diagnostic.line);
    return lines;
}

} // namespace

/* ---- AC1: 5 lỗi độc lập -> 5 diagnostic, đúng thứ tự sort ---- */

TEST(StMultiDiagnostic, FiveIndependentSemanticErrorsYieldFiveDiagnostics)
{
    /* Năm câu lệnh, mỗi câu một lỗi ngữ nghĩa độc lập, không câu nào là hệ quả
     * của câu trước. */
    const std::string source =
        "PROGRAM t\n"
        "VAR_INPUT ro : INT; END_VAR\n"
        "VAR b : BOOL; r : REAL; i : INT; t1 : TON; END_VAR\n"
        "  b := r;\n"          /* 1: REAL -> BOOL           ST-SEM-002 */
        "  nope := 1;\n"       /* 2: biến chưa khai báo     ST-SEM-001 */
        "  ro := 1;\n"         /* 3: ghi vào VAR_INPUT      ST-SEM-003 */
        "  t1(NOPARAM := b);\n"/* 4: tham số lạ của FB      ST-SEM-013 */
        "  r := b;\n"          /* 5: BOOL -> REAL           ST-SEM-002 */
        "END_PROGRAM\n";

    const StDiagnosticBag bag = check_all(source);
    ASSERT_EQ(bag.size(), 5u) << "thu thiếu lỗi: " << bag.size();
    EXPECT_FALSE(bag.truncated());

    const std::vector<std::string> expected = {
        st_diag_code::kTypeMismatch,      /* dòng 4 */
        st_diag_code::kUnboundVariable,   /* dòng 5 */
        st_diag_code::kReadonlyInput,     /* dòng 6 */
        st_diag_code::kBadFbParam,        /* dòng 7 */
        st_diag_code::kTypeMismatch,      /* dòng 8 */
    };
    EXPECT_EQ(codes_of(bag), expected);

    const std::vector<int> lines = lines_of(bag);
    EXPECT_TRUE(std::is_sorted(lines.begin(), lines.end()))
        << "diagnostic không sort theo location";
}

TEST(StMultiDiagnostic, IndependentDeclarationErrorsAreAllReported)
{
    /* Ba kiểu lạ trong cùng khối VAR — phục hồi ở ranh giới KHAI BÁO phải bắt
     * cả ba, không phải chỉ khai báo đầu. */
    const std::string source =
        "PROGRAM t\n"
        "VAR\n"
        "  a : NOSUCH1;\n"
        "  b : NOSUCH2;\n"
        "  c : NOSUCH3;\n"
        "END_VAR\n"
        "END_PROGRAM\n";

    const StDiagnosticBag bag = check_all(source);
    ASSERT_EQ(bag.size(), 3u);
    for (const StDiagnostic& diagnostic : bag.items())
        EXPECT_EQ(diagnostic.code, st_diag_code::kUnknownType);
    EXPECT_EQ(lines_of(bag), (std::vector<int>{3, 4, 5}));
}

TEST(StMultiDiagnostic, DuplicateDeclarationsAreAllReported)
{
    /* Trùng tên là lỗi PHA SEMANTIC (bảng ký hiệu), khác kiểu lạ vốn bị parser
     * chặn. Hai lần trùng phải ra hai diagnostic. */
    const std::string source =
        "PROGRAM t\n"
        "VAR\n"
        "  a : INT;\n"
        "  b : INT;\n"
        "  a : INT;\n"
        "  b : REAL;\n"
        "END_VAR\n"
        "END_PROGRAM\n";

    const StDiagnosticBag bag = check_all(source);
    ASSERT_EQ(bag.size(), 2u);
    for (const StDiagnostic& diagnostic : bag.items())
        EXPECT_EQ(diagnostic.code, st_diag_code::kDuplicateVar);
}

TEST(StMultiDiagnostic, IndependentSyntaxErrorsAreAllReported)
{
    /* Ba câu lệnh thiếu `;`. Phục hồi ở ranh giới câu lệnh phải bắt cả ba,
     * không phải chỉ câu đầu. */
    const std::string source =
        "PROGRAM t\n"
        "VAR a : INT; b : INT; c : INT; END_VAR\n"
        "  a := 1\n"
        "  b := 2\n"
        "  c := 3\n"
        "END_PROGRAM\n";

    const StDiagnosticBag bag = check_all(source);
    EXPECT_GE(bag.size(), 2u) << "parser dừng ở lỗi cú pháp đầu tiên";
    for (const StDiagnostic& diagnostic : bag.items())
        EXPECT_EQ(diagnostic.code, st_diag_code::kSyntaxUnexpected);
}

/* ---- AC2: > 64 lỗi -> 64 + đúng một ST-LIM-006 ---- */

TEST(StMultiDiagnostic, OverflowTruncatesAtSixtyFourPlusOneLimitCode)
{
    std::string body;
    for (int index = 0; index < 200; ++index)
        body += "  undeclared_" + std::to_string(index) + " := 1;\n";
    const StDiagnosticBag bag = check_all("PROGRAM t\n" + body + "END_PROGRAM\n");

    ASSERT_TRUE(bag.truncated());
    EXPECT_EQ(bag.size(), StDiagnosticBag::kMaxDiagnostics + 1);
    EXPECT_EQ(bag.items().back().code, st_diag_code::kDiagnosticsTruncated)
        << "ST-LIM-006 phải là phần tử CUỐI";
    const std::vector<std::string> codes = codes_of(bag);
    EXPECT_EQ(std::count(codes.begin(), codes.end(), st_diag_code::kDiagnosticsTruncated), 1)
        << "chỉ được đúng MỘT ST-LIM-006";
}

TEST(StMultiDiagnostic, ExactlySixtyFourErrorsDoesNotAddLimitCode)
{
    /* Ranh giới: đúng trần thì KHÔNG có ST-LIM-006 — nếu không, mọi chương
     * trình vừa chạm trần đều bị báo sai là "còn lỗi chưa hiển thị". */
    std::string body;
    for (std::size_t index = 0; index < StDiagnosticBag::kMaxDiagnostics; ++index)
        body += "  undeclared_" + std::to_string(index) + " := 1;\n";
    const StDiagnosticBag bag = check_all("PROGRAM t\n" + body + "END_PROGRAM\n");

    EXPECT_FALSE(bag.truncated());
    EXPECT_EQ(bag.size(), StDiagnosticBag::kMaxDiagnostics);
}

/* ---- AC3: phục hồi không sinh diagnostic giả ---- */

TEST(StMultiDiagnostic, SyntaxErrorMidPouStillAnalysesTheRest)
{
    /* Một lỗi cú pháp GIỮA POU. Phần sau vẫn phải được phân tích: lỗi thứ hai
     * ở dòng cuối chứng minh parser đi tiếp chứ không dừng. */
    const std::string source =
        "PROGRAM t\n"
        "VAR a : INT; b : INT; END_VAR\n"
        "  a := ;\n"      /* lỗi cú pháp giữa POU */
        "  b := 2;\n"     /* hợp lệ — không được sinh lỗi giả */
        "  b := ;\n"      /* lỗi thứ hai: bằng chứng phần sau vẫn được đọc */
        "END_PROGRAM\n";

    const StDiagnosticBag bag = check_all(source);
    ASSERT_EQ(bag.size(), 2u) << "phần sau lỗi cú pháp không được phân tích";
    EXPECT_EQ(bag.items()[0].line, 3);
    EXPECT_EQ(bag.items()[1].line, 5);
}

TEST(StMultiDiagnostic, BadDeclarationDoesNotCascadeIntoUnboundVariable)
{
    /* Biến khai kiểu lạ vẫn được đăng ký vào bảng ký hiệu, nên chỗ DÙNG nó
     * không sinh thêm `ST-SEM-001` — đúng một lỗi cho đúng một nguyên nhân. */
    const std::string source =
        "PROGRAM t\n"
        "VAR a : NOSUCH; END_VAR\n"
        "  a := 1;\n"
        "  a := 2;\n"
        "  a := 3;\n"
        "END_PROGRAM\n";

    const StDiagnosticBag bag = check_all(source);
    ASSERT_EQ(bag.size(), 1u) << "khai báo hỏng sinh lỗi dây chuyền ở chỗ dùng";
    EXPECT_EQ(bag.items()[0].code, st_diag_code::kUnknownType);
}

TEST(StMultiDiagnostic, NestedIfBodyErrorIsReportedExactlyOnce)
{
    /* Lỗi trong thân IF lồng nhau không được nhân bản theo số tầng lồng. */
    const std::string source =
        "PROGRAM t\n"
        "VAR g : BOOL; r : REAL; b : BOOL; END_VAR\n"
        "  IF g THEN\n"
        "    IF g THEN\n"
        "      b := r;\n"
        "    END_IF;\n"
        "  END_IF;\n"
        "END_PROGRAM\n";

    const StDiagnosticBag bag = check_all(source);
    ASSERT_EQ(bag.size(), 1u);
    EXPECT_EQ(bag.items()[0].code, st_diag_code::kTypeMismatch);
    EXPECT_EQ(bag.items()[0].line, 5);
}

/* ---- AC4: thứ tự tất định giữa hai lần chạy ---- */

TEST(StMultiDiagnostic, DiagnosticOrderIsDeterministicAcrossRuns)
{
    std::string body;
    for (int index = 0; index < 40; ++index)
        body += "  zz_" + std::to_string(index) + " := 1;\n";
    const std::string source = "PROGRAM t\n" + body + "END_PROGRAM\n";

    const std::vector<std::string> first = codes_of(check_all(source));
    const std::vector<int> first_lines = lines_of(check_all(source));
    for (int run = 0; run < 5; ++run) {
        const StDiagnosticBag bag = check_all(source);
        EXPECT_EQ(codes_of(bag), first);
        EXPECT_EQ(lines_of(bag), first_lines);
    }
}

TEST(StMultiDiagnostic, SortKeyPrefersOrderThenLocationThenCode)
{
    /* Kiểm trực tiếp luật sort của túi, không qua compiler: `order` thắng
     * `line`, `line` thắng `column`, `code` là khoá cuối. */
    StDiagnosticBag bag;
    auto make = [](int order, int line, int column, const char* code) {
        StDiagnostic diagnostic;
        diagnostic.order = order;
        diagnostic.line = line;
        diagnostic.column = column;
        diagnostic.code = code;
        return diagnostic;
    };
    bag.add(make(1, 1, 1, "ST-SEM-002"));
    bag.add(make(0, 9, 1, "ST-SEM-001"));
    bag.add(make(0, 2, 5, "ST-SEM-004"));
    bag.add(make(0, 2, 5, "ST-SEM-003"));
    bag.finalize();

    const std::vector<std::string> expected = {"ST-SEM-003", "ST-SEM-004",
                                               "ST-SEM-001", "ST-SEM-002"};
    EXPECT_EQ(codes_of(bag), expected);
}

/* ---- AC5: hợp đồng cũ không đổi ---- */

TEST(StMultiDiagnostic, LegacySingleDiagnosticApiStillReportsFirstError)
{
    /* Call site chưa dùng túi phải thấy đúng lỗi ĐẦU TIÊN theo thứ tự nguồn —
     * không phải lỗi cuối cùng mà đường phục hồi vừa ghi đè. */
    const std::string source =
        "PROGRAM t\n"
        "VAR b : BOOL; r : REAL; END_VAR\n"
        "  nope := 1;\n"
        "  b := r;\n"
        "END_PROGRAM\n";

    StProgram program;
    StDiagnostic diagnostic;
    ASSERT_TRUE(parse_st_program(source, &program, &diagnostic));
    EXPECT_FALSE(typecheck_st_program(&program, &diagnostic));
    EXPECT_EQ(diagnostic.code, st_diag_code::kUnboundVariable);
    EXPECT_EQ(diagnostic.line, 3);
}

TEST(StMultiDiagnostic, BagAwareApiKeepsFirstErrorInDiagnosticOut)
{
    const std::string source =
        "PROGRAM t\n"
        "VAR b : BOOL; r : REAL; END_VAR\n"
        "  nope := 1;\n"
        "  b := r;\n"
        "END_PROGRAM\n";

    StDiagnosticBag bag;
    StProgram program;
    StDiagnostic diagnostic;
    ASSERT_TRUE(parse_st_program(source, &program, &diagnostic, &bag));
    EXPECT_FALSE(typecheck_st_program(&program, &diagnostic, &bag));
    EXPECT_EQ(diagnostic.code, st_diag_code::kUnboundVariable);
    EXPECT_EQ(bag.size(), 2u);
}

TEST(StMultiDiagnostic, ValidProgramProducesNoDiagnostics)
{
    const StDiagnosticBag bag = check_all(
        "PROGRAM t\n"
        "VAR a : INT; END_VAR\n"
        "  a := 1;\n"
        "END_PROGRAM\n");
    EXPECT_TRUE(bag.empty());
    EXPECT_FALSE(bag.truncated());
}

} // namespace core
