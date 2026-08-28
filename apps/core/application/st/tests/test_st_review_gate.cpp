/**
 * @file  test_st_review_gate.cpp
 * @brief T59-205 — PID chỉ qua được Check khi profile mang approval token.
 *
 *        DDD §9 nói rõ: "Check blocks Commission unless profile includes
 *        Controls/Safety approval token generated from controlled contract —
 *        not a UI checkbox". Bộ test này khoá cả hai chiều: feature bị gate thì
 *        Check TỪ CHỐI, và feature không bị gate thì Check vẫn CHẤP NHẬN —
 *        một guard chặn tất cả cũng là guard sai.
 */
#include <gtest/gtest.h>

#include <fstream>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_parser.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_review_gate.hpp"
#include "st/st_semantic.hpp"

namespace core {
namespace {

namespace profile = st_profile_generated;

nlohmann::json read_profile_contract()
{
    std::ifstream input(std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) + "/product_profile_v2.json",
                        std::ios::binary);
    std::ostringstream content;
    content << input.rdbuf();
    return nlohmann::json::parse(content.str());
}

/* Gate là CHÍNH SÁCH SẢN PHẨM ở biên Check, không phải luật ngôn ngữ: typecheck
 * vẫn phải chấp nhận PID (bộ conformance của chính PID cần điều đó), còn Check
 * mới là nơi từ chối. Helper này đi đúng thứ tự đó để test khoá được cả hai. */
StDiagnostic analyze(const std::string& source, bool* ok, bool* typechecked)
{
    StProgram program;
    StDiagnostic diagnostic;
    if (!parse_st_program(source, &program, &diagnostic)) {
        *ok = false;
        *typechecked = false;
        return diagnostic;
    }
    *typechecked = typecheck_st_program(&program, &diagnostic);
    if (!*typechecked) {
        *ok = false;
        return diagnostic;
    }
    *ok = st_review_gate_check(program, &diagnostic);
    return diagnostic;
}

} // namespace

/* Hằng sinh phải khớp contract, không phải một bảng thứ hai chép tay. */
TEST(StReviewGate, GeneratedTableMatchesProfileContract)
{
    const nlohmann::json contract = read_profile_contract();
    const auto& declared = contract.at("reviewGatedFeatures");
    ASSERT_EQ(declared.size(), profile::kReviewGatedFeatures.size());
    for (std::size_t index = 0; index < declared.size(); ++index) {
        EXPECT_EQ(declared[index].at("featureId").get<std::string>(),
                  std::string(profile::kReviewGatedFeatures[index].feature_id));
        const bool approved = !declared[index].at("approvalToken").is_null();
        EXPECT_EQ(approved, profile::kReviewGatedFeatures[index].approved);
    }
}

/* Trạng thái hiện tại là SỰ THẬT được khoá: PID chưa có evidence Controls/Safety
 * (`VS-PROG-U12` chưa chạy) nên nó PHẢI đang bị chặn. Nếu ai đó "mở" PID mà
 * không kèm evidence thì test này đỏ ngay, chứ không lặng lẽ cho qua. */
TEST(StReviewGate, PidIsBlockedUntilControlsSafetyEvidenceExists)
{
    EXPECT_TRUE(profile::review_gate_blocks("PID"));
    EXPECT_FALSE(profile::review_gate_blocks("TON"));
    EXPECT_FALSE(profile::review_gate_blocks("KHONG_CO_TRONG_BANG"));
}

TEST(StReviewGate, DeclaringPidInstanceFailsCheck)
{
    bool ok = false;
    bool typechecked = false;
    const StDiagnostic diagnostic = analyze(
        "PROGRAM Main\n"
        "VAR\n"
        "  Loop : PID;\n"
        "END_VAR\n"
        "END_PROGRAM\n",
        &ok, &typechecked);
    /* Ngôn ngữ vẫn hiểu PID — chính sách mới là thứ từ chối. Nếu typecheck cũng
     * từ chối thì bộ conformance của PID không compile được, và evidence
     * Controls/Safety vốn là thứ mở khoá gate sẽ không bao giờ dựng được. */
    EXPECT_TRUE(typechecked);
    EXPECT_FALSE(ok);
    EXPECT_EQ(diagnostic.code, st_diag_code::kPidApprovalMissing);
    /* Vị trí phải trỏ đúng dòng khai báo, không phải đầu chương trình: người
     * dùng cần biết instance NÀO bị chặn khi có nhiều FB trong cùng khối VAR. */
    EXPECT_EQ(diagnostic.line, 3);
}

/* RETAIN không phải đường vòng. Trước khi có guard, một FB được khai trong
 * `VAR RETAIN` đi qua đúng nhánh khác của cùng vòng lặp. */
TEST(StReviewGate, RetainedPidInstanceAlsoFailsCheck)
{
    bool ok = false;
    bool typechecked = false;
    const StDiagnostic diagnostic = analyze(
        "PROGRAM Main\n"
        "VAR RETAIN\n"
        "  Loop : PID;\n"
        "END_VAR\n"
        "END_PROGRAM\n",
        &ok, &typechecked);
    EXPECT_TRUE(typechecked);
    EXPECT_FALSE(ok);
    EXPECT_EQ(diagnostic.code, st_diag_code::kPidApprovalMissing);
}

/* Chiều khẳng định: FB không bị gate vẫn phải qua được. Guard chặn tất cả sẽ
 * làm mọi FB dựng sẵn ngừng hoạt động mà vẫn "xanh" ở test phủ định. */
TEST(StReviewGate, UngatedFunctionBlocksStillPassCheck)
{
    bool ok = false;
    bool typechecked = false;
    const StDiagnostic diagnostic = analyze(
        "PROGRAM Main\n"
        "VAR\n"
        "  Delay : TON;\n"
        "  Edge : R_TRIG;\n"
        "END_VAR\n"
        "END_PROGRAM\n",
        &ok, &typechecked);
    EXPECT_TRUE(typechecked);
    EXPECT_TRUE(ok) << diagnostic.code << ": " << diagnostic.message;
}

/* Compile đầy đủ cũng phải chặn, không chỉ lớp semantic gọi trực tiếp: đây là
 * đường mà Check thật đi qua. */
TEST(StReviewGate, FullCompilePipelineRejectsPid)
{
    StIrModule module;
    StDiagnostic diagnostic;
    const bool ok = compile_st_source(
        "PROGRAM Main\n"
        "VAR\n"
        "  Loop : PID;\n"
        "END_VAR\n"
        "END_PROGRAM\n",
        &module, &diagnostic);
    EXPECT_FALSE(ok);
    EXPECT_EQ(diagnostic.code, st_diag_code::kPidApprovalMissing);
}

/* Gate phải độc lập với PRODUCER: AST dựng thẳng tay — không qua parser ST —
 * vẫn bị chặn. Đây là lý do `compile_fbd_source` chỉ cần gọi đúng hàm này thay
 * vì cài lại luật; nếu gate bám vào parser thì vẽ PID bằng FBD sẽ là đường vòng
 * hợp lệ. */
TEST(StReviewGate, GateIsProducerIndependent)
{
    StProgram program;
    program.name = "FromFbdLowering";
    StFbDecl decl;
    decl.name = "Loop";
    decl.fb_type = StFbType::PID;
    decl.line = 7;
    decl.column = 3;
    decl.length = 4;
    program.fbs.push_back(decl);

    StDiagnostic diagnostic;
    EXPECT_FALSE(st_review_gate_check(program, &diagnostic));
    EXPECT_EQ(diagnostic.code, st_diag_code::kPidApprovalMissing);
    EXPECT_EQ(diagnostic.line, 7);

    /* Cùng AST nhưng FB không bị gate thì phải qua. */
    program.fbs[0].fb_type = StFbType::TON;
    EXPECT_TRUE(st_review_gate_check(program, &diagnostic));
}

} // namespace core
