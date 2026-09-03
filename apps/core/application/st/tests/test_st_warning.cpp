/**
 * @file  test_st_warning.cpp
 * @brief `ISS-STED-02` — kênh WARNING của compiler ST (`ST_SUBSET_SPEC` §12.6,
 *        `DDD-LANG-PROG-001` §4.3).
 *
 *        Bất biến xuyên suốt tệp này: **cảnh báo không bao giờ làm Check FAILED
 *        và không bao giờ chặn sinh artifact**. Mọi test đều khẳng định lại
 *        điều đó bên cạnh phần nội dung riêng — một cảnh báo phát đúng mã
 *        nhưng làm chương trình hợp lệ trượt Check là hồi quy nặng hơn hẳn
 *        việc thiếu cảnh báo.
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "st/st_diagnostic.hpp"
#include "st/st_parser.hpp"
#include "st/st_program.hpp"
#include "st/st_semantic.hpp"

namespace core {
namespace {

struct CheckOutcome {
    bool            ok = false;
    StDiagnosticBag bag;
    StDiagnostic    diagnostic;
};

/* Parse + typecheck qua đường CÓ túi — đúng đường mà CLI dùng. Túi đã
 * `finalize()` nên trạng thái khớp hệt cái được serialize ra JSON. */
CheckOutcome check_all(const std::string& source)
{
    CheckOutcome outcome;
    StProgram program;
    if (parse_st_program(source, &program, &outcome.diagnostic, &outcome.bag))
        outcome.ok = typecheck_st_program(&program, &outcome.diagnostic, &outcome.bag);
    outcome.bag.finalize();
    return outcome;
}

std::vector<const StDiagnostic*> with_severity(const StDiagnosticBag& bag, StSeverity severity)
{
    std::vector<const StDiagnostic*> picked;
    for (const StDiagnostic& diagnostic : bag.items())
        if (diagnostic.severity == severity) picked.push_back(&diagnostic);
    return picked;
}

} // namespace

/* ---- ST-WARN-002: biến khai báo nhưng không dùng ---- */

TEST(StWarning, UnusedVariableWarnsButProgramStaysValid)
{
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR\n"
        "  unused_var : INT;\n"
        "  used_var : INT;\n"
        "END_VAR\n"
        "  used_var := 1;\n"
        "END_PROGRAM\n");

    /* Tiêu chí chấp nhận #351: Check PASSED + đúng 1 diagnostic WARNING. */
    EXPECT_TRUE(outcome.ok);
    EXPECT_FALSE(outcome.bag.has_error());
    EXPECT_EQ(outcome.bag.first_error(), nullptr);

    const std::vector<const StDiagnostic*> warnings =
        with_severity(outcome.bag, StSeverity::WARNING);
    ASSERT_EQ(warnings.size(), 1u);
    EXPECT_EQ(warnings[0]->code, st_diag_code::kWarnUnusedVariable);
    EXPECT_EQ(warnings[0]->severity, StSeverity::WARNING);
    /* Vị trí phải trỏ dòng KHAI BÁO (dòng 3), không phải chỗ nào khác — đó là
     * chỗ duy nhất sửa được. */
    EXPECT_EQ(warnings[0]->line, 3);
    EXPECT_GT(warnings[0]->column, 0);
}

TEST(StWarning, VariableOnlyWrittenIsNotReportedUnused)
{
    /* Ghi mà không đọc vẫn là "có dùng": biến ghi ra để tầng khác đọc (io_map,
     * retain) là mẫu hợp lệ, cảnh báo ở đây sẽ là nhiễu. */
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR write_only : INT; END_VAR\n"
        "  write_only := 5;\n"
        "END_PROGRAM\n");

    EXPECT_TRUE(outcome.ok);
    EXPECT_TRUE(with_severity(outcome.bag, StSeverity::WARNING).empty());
}

TEST(StWarning, VariableUsedWithWrongTypeIsNotAlsoReportedUnused)
{
    /* Chống cảnh báo giả: `x` ĐƯỢC dùng, chỉ là dùng sai kiểu. Nếu vết sử dụng
     * bị đánh dấu sau phán quyết kiểu thì người dùng sẽ thấy thêm một
     * `ST-WARN-002` vô nghĩa và đi sửa nhầm chỗ. */
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR x : BOOL; y : INT; END_VAR\n"
        "  y := x;\n"
        "END_PROGRAM\n");

    EXPECT_FALSE(outcome.ok);
    EXPECT_TRUE(outcome.bag.has_error());
    for (const StDiagnostic* warning : with_severity(outcome.bag, StSeverity::WARNING))
        EXPECT_NE(warning->code, st_diag_code::kWarnUnusedVariable);
}

TEST(StWarning, InputNeverReadIsNotWarned)
{
    /* VAR_INPUT là giao diện của POU: bên gọi vẫn phải cấp dù thân chưa dùng. */
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR_INPUT cfg : INT; END_VAR\n"
        "VAR out_v : INT; END_VAR\n"
        "  out_v := 1;\n"
        "END_PROGRAM\n");

    EXPECT_TRUE(outcome.ok);
    EXPECT_TRUE(with_severity(outcome.bag, StSeverity::WARNING).empty());
}

/* ---- ST-WARN-003: VAR_OUTPUT không bao giờ được gán ---- */

TEST(StWarning, OutputNeverAssignedWarnsAndArtifactStillValid)
{
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR_OUTPUT cmd : BOOL; END_VAR\n"
        "VAR tick : INT; END_VAR\n"
        "  tick := 1;\n"
        "END_PROGRAM\n");

    EXPECT_TRUE(outcome.ok);
    EXPECT_FALSE(outcome.bag.has_error());

    const std::vector<const StDiagnostic*> warnings =
        with_severity(outcome.bag, StSeverity::WARNING);
    ASSERT_EQ(warnings.size(), 1u);
    EXPECT_EQ(warnings[0]->code, st_diag_code::kWarnOutputNeverWritten);
    EXPECT_EQ(warnings[0]->line, 2);
}

TEST(StWarning, OutputNeverAssignedYieldsOnlyTheSpecificWarning)
{
    /* `ST-WARN-003` cụ thể hơn `ST-WARN-002` cho cùng một ô. Phát cả hai là nói
     * cùng một việc hai lần với hai cách sửa khác nhau. */
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR_OUTPUT cmd : BOOL; END_VAR\n"
        "END_PROGRAM\n");

    const std::vector<const StDiagnostic*> warnings =
        with_severity(outcome.bag, StSeverity::WARNING);
    ASSERT_EQ(warnings.size(), 1u);
    EXPECT_EQ(warnings[0]->code, st_diag_code::kWarnOutputNeverWritten);
}

TEST(StWarning, OutputAssignedIsNotWarned)
{
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR_OUTPUT cmd : BOOL; END_VAR\n"
        "  cmd := TRUE;\n"
        "END_PROGRAM\n");

    EXPECT_TRUE(outcome.ok);
    EXPECT_TRUE(with_severity(outcome.bag, StSeverity::WARNING).empty());
}

/* ---- ST-WARN-004: đọc output FB trước lời gọi (DDD §4.3) ---- */

TEST(StWarning, FbOutputReadBeforeCallWarns)
{
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR_OUTPUT running : BOOL; END_VAR\n"
        "VAR timer : TON; go : BOOL; END_VAR\n"
        "  running := timer.Q;\n"
        "  timer(IN := go, PT := T#1s);\n"
        "END_PROGRAM\n");

    EXPECT_TRUE(outcome.ok);
    EXPECT_FALSE(outcome.bag.has_error());

    const std::vector<const StDiagnostic*> warnings =
        with_severity(outcome.bag, StSeverity::WARNING);
    ASSERT_EQ(warnings.size(), 1u);
    EXPECT_EQ(warnings[0]->code, st_diag_code::kWarnFbOutputReadBeforeCall);
    EXPECT_EQ(warnings[0]->line, 4);
}

TEST(StWarning, FbOutputReadAfterCallIsNotWarned)
{
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR_OUTPUT running : BOOL; END_VAR\n"
        "VAR timer : TON; go : BOOL; END_VAR\n"
        "  timer(IN := go, PT := T#1s);\n"
        "  running := timer.Q;\n"
        "END_PROGRAM\n");

    EXPECT_TRUE(outcome.ok);
    EXPECT_TRUE(with_severity(outcome.bag, StSeverity::WARNING).empty());
}

/* ---- Bất biến chung: không có túi thì hợp đồng cũ không đổi ---- */

TEST(StWarning, LegacySingleDiagnosticApiStaysCleanForWarningOnlyProgram)
{
    /* Overload không nhận túi là hợp đồng "một lỗi". Nhét warning vào `diag`
     * sẽ làm mọi caller kiểm `diag.code.empty()` hiểu nhầm một chương trình
     * hợp lệ là hỏng. */
    StProgram program;
    StDiagnostic diagnostic;
    const std::string source =
        "PROGRAM t\n"
        "VAR unused_var : INT; END_VAR\n"
        "END_PROGRAM\n";

    ASSERT_TRUE(parse_st_program(source, &program, &diagnostic));
    EXPECT_TRUE(typecheck_st_program(&program, &diagnostic));
    EXPECT_TRUE(diagnostic.code.empty());
}

TEST(StWarning, ErrorSuppressesUsageWarningsBecauseTraceIsIncomplete)
{
    /* Có lỗi thì việc soát bỏ dở câu lệnh, vết `read`/`written` không đầy đủ.
     * Phát cảnh báo trên dữ liệu dở dang sẽ báo "không dùng" cho biến thực ra
     * có dùng ở câu lệnh chưa kịp soát. */
    const CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR ghost : INT; END_VAR\n"
        "  undeclared_target := 1;\n"
        "END_PROGRAM\n");

    EXPECT_FALSE(outcome.ok);
    EXPECT_TRUE(outcome.bag.has_error());
    EXPECT_TRUE(with_severity(outcome.bag, StSeverity::WARNING).empty());
}


/* ---- Chính sách target profile: nâng warning thành lỗi ----------------------
 *
 * `ISS-STED-02` yêu cầu chính sách này VẪN KHẢ THI sau khi kênh WARNING sống.
 * Nó áp ở TÚI, không ở chỗ phát: nơi phát biết "đây là chuyện đáng ngờ", còn
 * "đáng ngờ có chặn phát hành không" là câu hỏi của profile. Trộn hai việc lại
 * thì mỗi lần đổi chính sách phải sửa mọi điểm phát warning. */

TEST(StWarning, ProfileCanPromoteWarningsToErrors)
{
    CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR used : INT; unused : INT; END_VAR\n"
        "  used := 1;\n"
        "END_PROGRAM\n");

    ASSERT_TRUE(outcome.ok) << "chương trình chỉ có warning phải hợp lệ";
    ASSERT_FALSE(outcome.bag.has_error());
    ASSERT_TRUE(outcome.bag.has_warning());

    outcome.bag.promote_warnings_to_errors();
    EXPECT_TRUE(outcome.bag.has_error()) << "profile khắt khe không nâng được warning";
    EXPECT_FALSE(outcome.bag.has_warning());
    /* Mã KHÔNG đổi khi nâng cấp: `ST-WARN-002` vẫn là `ST-WARN-002`, chỉ
     * severity đổi. Đổi cả mã sẽ làm hai profile nói hai ngôn ngữ khác nhau về
     * cùng một phát hiện, và bảng tra của FE phải nhân đôi. */
    EXPECT_EQ(outcome.bag.items()[0].code, st_diag_code::kWarnUnusedVariable);
}

TEST(StWarning, PromotionIsANoOpWhenThereAreNoWarnings)
{
    CheckOutcome outcome = check_all(
        "PROGRAM t\n"
        "VAR used : INT; END_VAR\n"
        "  used := 1;\n"
        "  used := used;\n"
        "END_PROGRAM\n");

    ASSERT_TRUE(outcome.ok);
    ASSERT_FALSE(outcome.bag.has_warning());
    outcome.bag.promote_warnings_to_errors();
    EXPECT_FALSE(outcome.bag.has_error())
        << "nâng cấp tự chế ra lỗi trên một chương trình không có cảnh báo nào";
}

} // namespace core
