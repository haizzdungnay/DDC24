/**
 * @file  test_st_review_gate.cpp
 * @brief T59-205 — feature REVIEW_REQUIRED chỉ qua được Check khi profile mang
 *        approval token; Issue #802 — `PID` đã được ký token.
 *
 *        DDD §9 nói rõ: "Check blocks Commission unless profile includes
 *        Controls/Safety approval token generated from controlled contract —
 *        not a UI checkbox". Bộ test này khoá hai thứ tách bạch:
 *
 *        1. CƠ CHẾ cổng: với một bảng chặn PID (bảng giả, truyền qua overload
 *           `st_review_gate_check(program, diag, blocks)` hoặc
 *           `StCompileOptions::review_gate_blocks`), Check TỪ CHỐI đúng mã và
 *           đúng vị trí; feature không bị gate vẫn được CHẤP NHẬN — guard chặn
 *           tất cả cũng là guard sai.
 *        2. TRẠNG THÁI production: bảng sinh từ profile khớp contract, token
 *           của PID suy ra đúng công thức, và PID qua Check trên đường thật.
 *
 *        Trước #802 hai thứ này dính nhau: test cơ chế dựa vào việc profile
 *        tình cờ còn chặn PID, nên ký token là cơ chế mất test. Nay cơ chế dùng
 *        bảng giả, còn trạng thái đọc từ contract.
 */
#include <gtest/gtest.h>

#include <fstream>
#include <sstream>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

#include "st/st_artifact.hpp"
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

/* Bảng giả: PID còn chờ duyệt, mọi feature khác không bị gate — đúng hình dạng
 * bảng production trước #802. */
bool fake_table_blocks_pid(std::string_view feature_id) { return feature_id == "PID"; }

const char* kPidProgram =
    "PROGRAM Main\n"
    "VAR\n"
    "  Loop : PID;\n"
    "END_VAR\n"
    "END_PROGRAM\n";

/* Gate là CHÍNH SÁCH SẢN PHẨM ở biên Check, không phải luật ngôn ngữ: typecheck
 * vẫn phải chấp nhận PID (bộ conformance của chính PID cần điều đó), còn Check
 * mới là nơi từ chối. Helper này đi đúng thứ tự đó để test khoá được cả hai.
 * `blocks == nullptr` = bảng sinh từ profile (đường production). */
StDiagnostic analyze(const std::string& source, bool* ok, bool* typechecked,
                     StReviewGateBlocks blocks)
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
    *ok = blocks == nullptr ? st_review_gate_check(program, &diagnostic)
                            : st_review_gate_check(program, &diagnostic, blocks);
    return diagnostic;
}

} // namespace

/* ---- Trạng thái production (đọc từ contract) ---- */

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
        const std::string token = approved ? declared[index].at("approvalToken").get<std::string>()
                                           : std::string();
        EXPECT_EQ(token, std::string(profile::kReviewGatedFeatures[index].approval_token));
    }
}

/* Issue #802: token của PID phải suy ra ĐÚNG công thức của generator từ chính
 * contract — `sha256("mkddc-controls-safety-approval:v1:PID:<libraryVersion>:
 * <evidenceRef>")` — và gắn đúng libraryVersion hiện hành. Token chép tay hay
 * ký cho bản thư viện cũ thì test này đỏ. */
TEST(StReviewGate, PidApprovalTokenIsDerivedFromContract)
{
    const nlohmann::json contract = read_profile_contract();
    const nlohmann::json* pid = nullptr;
    for (const auto& item : contract.at("reviewGatedFeatures"))
        if (item.at("featureId") == "PID") pid = &item;
    ASSERT_NE(pid, nullptr);
    ASSERT_FALSE(pid->at("approvalToken").is_null()) << "PID phải mang token sau #802";
    const std::string evidence = pid->at("approvalEvidenceRef").get<std::string>();
    EXPECT_EQ(evidence, "EV-PROG-PID-APPROVAL-20260928");

    const std::string library_version = contract.at("coreLibrary").at("version").get<std::string>();
    EXPECT_EQ(library_version, std::string(profile::kLibraryVersion));
    const std::string payload =
        "mkddc-controls-safety-approval:v1:PID:" + library_version + ":" + evidence;
    const std::string expected = compute_file_sha256(
        reinterpret_cast<const uint8_t*>(payload.data()), payload.size());
    EXPECT_EQ(pid->at("approvalToken").get<std::string>(), expected);

    const std::string stale_payload = "mkddc-controls-safety-approval:v1:PID:rev-a.5:" + evidence;
    EXPECT_NE(compute_file_sha256(reinterpret_cast<const uint8_t*>(stale_payload.data()),
                                  stale_payload.size()),
              expected)
        << "token phải gắn libraryVersion — duyệt bản cũ không tự áp cho bản mới";
}

/* Bảng production sau #802: PID đã duyệt nên KHÔNG bị chặn; feature lạ cũng
 * không bị chặn (chặn một thứ chưa ai khai là chặn mù). */
TEST(StReviewGate, ProductionTableNoLongerBlocksApprovedPid)
{
    EXPECT_FALSE(profile::review_gate_blocks("PID"));
    EXPECT_FALSE(profile::review_gate_blocks("TON"));
    EXPECT_FALSE(profile::review_gate_blocks("KHONG_CO_TRONG_BANG"));
}

TEST(StReviewGate, ApprovedPidPassesCheckOnProductionPath)
{
    bool ok = false;
    bool typechecked = false;
    const StDiagnostic diagnostic = analyze(kPidProgram, &ok, &typechecked, nullptr);
    EXPECT_TRUE(typechecked);
    EXPECT_TRUE(ok) << diagnostic.code << ": " << diagnostic.message;

    /* Đường compile đầy đủ với tuỳ chọn MẶC ĐỊNH — đúng đường Check thật đi qua. */
    StIrModule module;
    StDiagnostic compile_diagnostic;
    EXPECT_TRUE(compile_st_source(kPidProgram, &module, &compile_diagnostic))
        << compile_diagnostic.code << ": " << compile_diagnostic.message;
}

/* ---- Cơ chế cổng (bảng giả chặn PID) ---- */

TEST(StReviewGate, DeclaringGatedPidInstanceFailsCheck)
{
    bool ok = false;
    bool typechecked = false;
    const StDiagnostic diagnostic =
        analyze(kPidProgram, &ok, &typechecked, fake_table_blocks_pid);
    /* Ngôn ngữ vẫn hiểu PID — chính sách mới là thứ từ chối. Nếu typecheck cũng
     * từ chối thì bộ conformance của một feature đang bị gate không compile
     * được, và evidence để mở gate sẽ không bao giờ dựng được. */
    EXPECT_TRUE(typechecked);
    EXPECT_FALSE(ok);
    EXPECT_EQ(diagnostic.code, st_diag_code::kPidApprovalMissing);
    /* Vị trí phải trỏ đúng dòng khai báo, không phải đầu chương trình: người
     * dùng cần biết instance NÀO bị chặn khi có nhiều FB trong cùng khối VAR. */
    EXPECT_EQ(diagnostic.line, 3);
}

/* RETAIN không phải đường vòng. Trước khi có guard, một FB được khai trong
 * `VAR RETAIN` đi qua đúng nhánh khác của cùng vòng lặp. */
TEST(StReviewGate, RetainedGatedPidInstanceAlsoFailsCheck)
{
    bool ok = false;
    bool typechecked = false;
    const StDiagnostic diagnostic = analyze(
        "PROGRAM Main\n"
        "VAR RETAIN\n"
        "  Loop : PID;\n"
        "END_VAR\n"
        "END_PROGRAM\n",
        &ok, &typechecked, fake_table_blocks_pid);
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
        &ok, &typechecked, fake_table_blocks_pid);
    EXPECT_TRUE(typechecked);
    EXPECT_TRUE(ok) << diagnostic.code << ": " << diagnostic.message;
}

/* Compile đầy đủ cũng phải hỏi cổng, không chỉ lớp semantic gọi trực tiếp: đây
 * là đường mà Check thật đi qua. Bảng giả vào qua `StCompileOptions`. */
TEST(StReviewGate, FullCompilePipelineRejectsGatedPid)
{
    StIrModule module;
    StDiagnostic diagnostic;
    StCompileOptions options;
    options.review_gate_blocks = fake_table_blocks_pid;
    EXPECT_FALSE(compile_st_source(kPidProgram, &module, &diagnostic, options));
    EXPECT_EQ(diagnostic.code, st_diag_code::kPidApprovalMissing);

    /* Cùng bảng giả nhưng TẮT gate (harness conformance): phải compile được. */
    options.enforce_review_gate = false;
    StDiagnostic harness_diagnostic;
    EXPECT_TRUE(compile_st_source(kPidProgram, &module, &harness_diagnostic, options))
        << harness_diagnostic.code << ": " << harness_diagnostic.message;
}

/* Gate phải độc lập với PRODUCER: AST dựng thẳng tay — không qua parser ST —
 * vẫn bị chặn. Đây là lý do `compile_fbd_source` chỉ cần gọi đúng hàm này thay
 * vì cài lại luật; nếu gate bám vào parser thì vẽ khối bị gate bằng FBD sẽ là
 * đường vòng hợp lệ. */
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
    EXPECT_FALSE(st_review_gate_check(program, &diagnostic, fake_table_blocks_pid));
    EXPECT_EQ(diagnostic.code, st_diag_code::kPidApprovalMissing);
    EXPECT_EQ(diagnostic.line, 7);

    /* Cùng AST nhưng FB không bị gate thì phải qua. */
    program.fbs[0].fb_type = StFbType::TON;
    EXPECT_TRUE(st_review_gate_check(program, &diagnostic, fake_table_blocks_pid));

    /* `nullptr` là bảng production — PID đã duyệt nên qua. */
    program.fbs[0].fb_type = StFbType::PID;
    EXPECT_TRUE(st_review_gate_check(program, &diagnostic, nullptr));
}

} // namespace core
