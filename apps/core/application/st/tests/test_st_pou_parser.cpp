/**
 * @file  test_st_pou_parser.cpp
 * @brief T59-101 — parser/AST cho FUNCTION và FUNCTION_BLOCK.
 *
 *        Ba loại POU dùng chung AST, nên rủi ro thật không phải "parse được
 *        không" mà là "có phân biệt đúng chữ ký và quyền hạn không". Bộ test này
 *        đi theo đúng rủi ro đó: positive cho từng loại, rồi negative cho từng
 *        quy tắc kind/name/signature, mỗi case khoá cả MÃ LỖI lẫn VỊ TRÍ.
 */
#include <gtest/gtest.h>

#include <string>

#include "st/st_diagnostic.hpp"
#include "st/st_parser.hpp"
#include "st/st_program.hpp"

namespace core {
namespace {

struct ParseResult {
    bool ok = false;
    StProgram pou;
    StDiagnostic diag;
};

ParseResult parse(const std::string& source)
{
    ParseResult result;
    result.ok = parse_st_pou(source, &result.pou, &result.diag);
    return result;
}

std::string function_source(const std::string& header = "FUNCTION Clamp : REAL",
                            const std::string& extra_vars = "")
{
    return header + "\n" +
           "VAR_INPUT value : REAL; END_VAR\n" + extra_vars +
           "Clamp := value;\n"
           "END_FUNCTION\n";
}

std::string function_block_source(const std::string& extra_vars = "")
{
    return "FUNCTION_BLOCK Hysteresis\n"
           "VAR_INPUT pv : REAL; END_VAR\n"
           "VAR_OUTPUT q : BOOL; END_VAR\n" + extra_vars +
           "q := pv > 10.0;\n"
           "END_FUNCTION_BLOCK\n";
}

} // namespace

TEST(StPouParser, ParsesFunctionWithReturnTypeAndSourcePosition)
{
    const ParseResult result = parse(function_source());
    ASSERT_TRUE(result.ok) << result.diag.code << ": " << result.diag.message;
    EXPECT_EQ(result.pou.kind, StPouKind::FUNCTION);
    EXPECT_EQ(result.pou.name, "Clamp");
    EXPECT_TRUE(result.pou.has_return_type);
    EXPECT_EQ(result.pou.return_type, StType::REAL);
    /* Source map: vị trí tên POU phải trỏ đúng token tên, không phải đầu dòng. */
    EXPECT_EQ(result.pou.line, 1);
    EXPECT_EQ(result.pou.column, 10);
    EXPECT_EQ(result.pou.length, 5);
    EXPECT_EQ(result.pou.vars.size(), 1U);
    EXPECT_FALSE(result.pou.body.empty());
}

TEST(StPouParser, ParsesFunctionBlockWithInputAndOutput)
{
    const ParseResult result = parse(function_block_source());
    ASSERT_TRUE(result.ok) << result.diag.code << ": " << result.diag.message;
    EXPECT_EQ(result.pou.kind, StPouKind::FUNCTION_BLOCK);
    EXPECT_EQ(result.pou.name, "Hysteresis");
    /* FUNCTION_BLOCK KHÔNG có kiểu trả về — nó trả qua VAR_OUTPUT. */
    EXPECT_FALSE(result.pou.has_return_type);
    EXPECT_EQ(result.pou.by_storage(StStorage::VAR_INPUT).size(), 1U);
    EXPECT_EQ(result.pou.by_storage(StStorage::VAR_OUTPUT).size(), 1U);
}

TEST(StPouParser, FunctionBlockKeepsStateDeclarations)
{
    /* Đây chính là điểm phân biệt FB với FUNCTION: FB ĐƯỢC phép giữ state. */
    const ParseResult result = parse(function_block_source(
        "VAR RETAIN last : REAL; END_VAR\nVAR delay : TON; END_VAR\n"));
    ASSERT_TRUE(result.ok) << result.diag.code << ": " << result.diag.message;
    EXPECT_EQ(result.pou.by_storage(StStorage::VAR_RETAIN).size(), 1U);
    ASSERT_EQ(result.pou.fbs.size(), 1U);
    EXPECT_TRUE(result.pou.fbs.front().retained == false);
}

TEST(StPouParser, ProgramStillParsesAndKeepsDefaultKind)
{
    const ParseResult result = parse(
        "PROGRAM Main\nVAR_INPUT a : REAL; END_VAR\nVAR_OUTPUT b : REAL; END_VAR\n"
        "b := a;\nEND_PROGRAM\n");
    ASSERT_TRUE(result.ok) << result.diag.code << ": " << result.diag.message;
    EXPECT_EQ(result.pou.kind, StPouKind::PROGRAM);
    EXPECT_FALSE(result.pou.has_return_type);
}

/* ---- Negative: chữ ký ---- */

TEST(StPouParser, FunctionWithoutReturnTypeIsRejectedWithKindCode)
{
    const ParseResult result = parse(
        "FUNCTION Clamp\nVAR_INPUT value : REAL; END_VAR\nClamp := value;\nEND_FUNCTION\n");
    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.diag.code, st_diag_code::kPouSignatureInvalid);
    EXPECT_GT(result.diag.line, 0);
    EXPECT_GT(result.diag.column, 0);
}

TEST(StPouParser, ProgramAndFunctionBlockMustNotDeclareReturnType)
{
    for (const char* source : {
             "PROGRAM Main : REAL\nEND_PROGRAM\n",
             "FUNCTION_BLOCK Fb : REAL\nEND_FUNCTION_BLOCK\n",
         }) {
        const ParseResult result = parse(source);
        EXPECT_FALSE(result.ok) << source;
        EXPECT_EQ(result.diag.code, st_diag_code::kPouSignatureInvalid) << source;
    }
}

TEST(StPouParser, UnknownReturnTypeUsesTypeCodeNotKindCode)
{
    /* Kiểu lạ là lỗi KIỂU, không phải lỗi kind — hai thứ này dẫn tới hai hành
     * động sửa khác nhau nên không được gộp mã. */
    const ParseResult result = parse(function_source("FUNCTION Clamp : STRING"));
    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.diag.code, st_diag_code::kUnknownType);
}

/* ---- Negative: quyền hạn theo kind ---- */

TEST(StPouParser, FunctionMustNotDeclareOutputRetainOrFbInstance)
{
    struct Case { const char* label; const char* extra; };
    const Case cases[] = {
        {"VAR_OUTPUT", "VAR_OUTPUT extra : REAL; END_VAR\n"},
        {"VAR RETAIN", "VAR RETAIN keep : REAL; END_VAR\n"},
        {"FB instance", "VAR timer : TON; END_VAR\n"},
    };
    for (const Case& item : cases) {
        const ParseResult result = parse(function_source("FUNCTION Clamp : REAL", item.extra));
        EXPECT_FALSE(result.ok) << item.label;
        EXPECT_EQ(result.diag.code, st_diag_code::kPouSignatureInvalid) << item.label;
        /* Vị trí phải trỏ đúng khai báo vi phạm, không phải token cuối nguồn. */
        EXPECT_EQ(result.diag.line, 3) << item.label;
    }
}

/* ---- Negative: tên ---- */

TEST(StPouParser, PouNameMustNotBeKeywordAndRespectsLengthBoundary)
{
    const ParseResult keyword = parse("FUNCTION IF : REAL\nEND_FUNCTION\n");
    EXPECT_FALSE(keyword.ok);
    EXPECT_EQ(keyword.diag.code, st_diag_code::kPouSignatureInvalid);

    const std::string at_limit(kMaxPouNameLength, 'a');
    const ParseResult ok = parse("FUNCTION " + at_limit +
                                 " : REAL\n" + at_limit + " := 1.0;\nEND_FUNCTION\n");
    EXPECT_TRUE(ok.ok) << ok.diag.code << ": " << ok.diag.message;

    /* Một-trên-trần bị chặn bởi LEXER với `ST-LIM-005`, không phải bởi lớp kind.
     * Điều quan trọng là nó bị chặn và mã nói đúng lý do ("identifier quá dài"),
     * chứ không phải nó bị chặn ở lớp nào. Nếu khẳng định mã kind ở đây thì phải
     * thêm một nhánh kiểm trùng lặp trong parser — nhánh đó sẽ không bao giờ
     * chạy vì lexer luôn tới trước. */
    const std::string over_limit(kMaxPouNameLength + 1, 'a');
    const ParseResult over = parse("FUNCTION " + over_limit +
                                   " : REAL\n" + over_limit + " := 1.0;\nEND_FUNCTION\n");
    EXPECT_FALSE(over.ok);
    EXPECT_EQ(over.diag.code, st_diag_code::kIdentifierTooLong);
}

/* ---- Negative: kết thúc khối phải khớp loại ---- */

TEST(StPouParser, TerminatorMustMatchDeclaredKind)
{
    for (const char* source : {
             "FUNCTION Clamp : REAL\nClamp := 1.0;\nEND_PROGRAM\n",
             "FUNCTION_BLOCK Fb\nEND_FUNCTION\n",
             "PROGRAM Main\nEND_FUNCTION_BLOCK\n",
         }) {
        const ParseResult result = parse(source);
        EXPECT_FALSE(result.ok) << source;
        EXPECT_FALSE(result.diag.code.empty()) << source;
    }
}

TEST(StPouParser, UnknownPouKeywordIsRejected)
{
    const ParseResult result = parse("PROCEDURE Foo\nEND_PROCEDURE\n");
    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.diag.code, st_diag_code::kSyntaxUnexpected);
}

/* ---- Hợp đồng cũ của parse_st_program giữ nguyên ---- */

TEST(StPouParser, ParseStProgramStillRejectsNonProgramPou)
{
    StProgram out;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(function_source(), &out, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kPouSignatureInvalid);
    /* Thông điệp phải nói ĐÚNG loại đã gặp, để người sửa không phải đoán. */
    EXPECT_NE(diag.message.find("FUNCTION"), std::string::npos) << diag.message;

    EXPECT_TRUE(parse_st_program("PROGRAM Main\nEND_PROGRAM\n", &out, &diag))
        << diag.code << ": " << diag.message;
    EXPECT_EQ(out.kind, StPouKind::PROGRAM);
}

} // namespace core
