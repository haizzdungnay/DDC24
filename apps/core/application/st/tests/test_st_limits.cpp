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

#include <algorithm>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>
#include <sodium.h>

#include "st/st_diagnostic.hpp"
#include "st/st_limits.hpp"
#include "st/st_parser.hpp"
#include "st/st_profile_generated.hpp"
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

std::string read_contract(const char* name)
{
    std::ifstream input(std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) + "/" + name,
                        std::ios::binary);
    std::ostringstream content;
    content << input.rdbuf();
    return content.str();
}

std::string sha256_hex(const std::string& value)
{
    uint8_t digest[crypto_hash_sha256_BYTES];
    crypto_hash_sha256(digest, reinterpret_cast<const uint8_t*>(value.data()), value.size());
    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (uint8_t byte : digest) out << std::setw(2) << static_cast<unsigned>(byte);
    return out.str();
}

TEST(StProfile, MachineReadableContractMatchesGeneratedConstants)
{
    const std::string raw = read_contract("product_profile_v2.json");
    ASSERT_FALSE(raw.empty());
    const nlohmann::json profile = nlohmann::json::parse(raw);
    EXPECT_EQ(profile.at("profileId"), st_profile_generated::kProfileId);
    EXPECT_EQ(profile.at("profileCode"), st_profile_generated::kProfileCode);
    EXPECT_EQ(profile.at("targetAbi"), st_profile_generated::kTargetAbi);
    EXPECT_EQ(profile.at("version").at("major"), st_profile_generated::kProfileMajor);
    EXPECT_EQ(profile.at("version").at("minor"), st_profile_generated::kProfileMinor);
    EXPECT_EQ(profile.at("coreLibrary").at("version"),
              st_profile_generated::kLibraryVersion);
    EXPECT_EQ(profile.at("integrityMode"), "SIGNATURE_REQUIRED");
    EXPECT_STREQ(st_profile_generated::kIntegrityMode, "SIGNATURE_REQUIRED");
    EXPECT_EQ(sha256_hex(raw), st_profile_generated::kProfileSha256);

    struct TypeLock { const char* name; uint8_t code; uint8_t bits; };
    const TypeLock type_locks[] = {
        {"BOOL", st_profile_generated::kBoolWireCode, st_profile_generated::kBoolWidthBits},
        {"INT", st_profile_generated::kIntWireCode, st_profile_generated::kIntWidthBits},
        {"DINT", st_profile_generated::kDintWireCode, st_profile_generated::kDintWidthBits},
        {"UINT", st_profile_generated::kUintWireCode, st_profile_generated::kUintWidthBits},
        {"REAL", st_profile_generated::kRealWireCode, st_profile_generated::kRealWidthBits},
        {"TIME", st_profile_generated::kTimeWireCode, st_profile_generated::kTimeWidthBits},
    };
    for (const TypeLock& lock : type_locks) {
        const auto match = std::find_if(profile.at("types").begin(), profile.at("types").end(),
                                        [&](const nlohmann::json& item) {
                                            return item.at("name") == lock.name;
                                        });
        ASSERT_NE(match, profile.at("types").end()) << lock.name;
        EXPECT_EQ(match->at("wireCode"), lock.code);
        EXPECT_EQ(match->at("widthBits"), lock.bits);
        EXPECT_EQ(match->at("conversion"), "EXPLICIT_FAIL_CLOSED");
    }

    const auto& scheduler = profile.at("scheduler");
    const auto periods = scheduler.at("allowedPeriodMs");
    ASSERT_EQ(periods.size(), st_profile_generated::kAllowedPeriodMs.size());
    for (std::size_t i = 0; i < periods.size(); ++i)
        EXPECT_EQ(periods.at(i), st_profile_generated::kAllowedPeriodMs[i]);
    EXPECT_EQ(scheduler.at("maxTasks"), st_profile_generated::kMaxTasks);
    EXPECT_EQ(scheduler.at("maxProgramsPerTask"), st_profile_generated::kMaxProgramsPerTask);
    EXPECT_EQ(scheduler.at("maxProgramsTotal"), st_profile_generated::kMaxProgramsTotal);
    EXPECT_EQ(scheduler.at("maxTaskBudgetPercent"),
              st_profile_generated::kMaxTaskBudgetPercent);

    /* Capacity cấp package: đây là phần Product v2 nâng từ một Program lên 32/16.
     * Kiểm ở đây để contract và hằng sinh không thể trôi khỏi nhau. */
    const auto& capacity = profile.at("capacity");
    EXPECT_EQ(capacity.at("maxObjects"), st_profile_generated::kMaxObjects);
    EXPECT_EQ(capacity.at("maxProgramsTotal"), st_profile_generated::kMaxProgramsTotal);
    EXPECT_EQ(capacity.at("maxProgramsEnabled"), st_profile_generated::kMaxProgramsEnabled);
    EXPECT_EQ(capacity.at("maxUserPou"), st_profile_generated::kMaxUserPou);
    EXPECT_EQ(capacity.at("maxFunctionBlockInstances"),
              st_profile_generated::kMaxFunctionBlockInstances);
    EXPECT_EQ(capacity.at("maxSignals"), st_profile_generated::kMaxSignals);
    EXPECT_EQ(capacity.at("maxBindings"), st_profile_generated::kMaxPackageBindings);
}

TEST(StProfile, ProductCapacityIsThirtyTwoProgramsAndSixteenEnabled)
{
    /* Khoá đúng con số Product v2 (`DDD-SW-PROG-UNIFIED-001` §0). Nếu ai đó hạ
     * capacity xuống một Program như As-Built cũ thì test này đỏ, chứ không
     * lặng lẽ thu hẹp sản phẩm. */
    EXPECT_EQ(st_profile_generated::kMaxProgramsTotal, 32u);
    EXPECT_EQ(st_profile_generated::kMaxProgramsEnabled, 16u);
    EXPECT_EQ(st_profile_generated::kMaxUserPou, 256u);
    EXPECT_EQ(st_profile_generated::kMaxFunctionBlockInstances, 1024u);
    EXPECT_EQ(st_profile_generated::kMaxSignals, 512u);
    EXPECT_EQ(st_profile_generated::kMaxPackageBindings, 512u);
    EXPECT_LE(st_profile_generated::kMaxProgramsEnabled,
              st_profile_generated::kMaxProgramsTotal);
    EXPECT_LE(st_profile_generated::kMaxBindings,
              st_profile_generated::kMaxPackageBindings);
}

TEST(StProfile, EveryResourceAcceptsLimitMinusOneAndLimitAndRejectsLimitPlusOne)
{
    struct Boundary {
        const char* name;
        std::size_t st_limits::RevAProfileUsage::*field;
        std::size_t limit;
    };
    const Boundary boundaries[] = {
        {"sourceBytes", &st_limits::RevAProfileUsage::source_bytes,
         st_profile_generated::kMaxSourceBytes},
        {"variables", &st_limits::RevAProfileUsage::variables,
         st_profile_generated::kMaxVariables},
        {"statements", &st_limits::RevAProfileUsage::statements,
         st_profile_generated::kMaxStatements},
        {"fbdBlocks", &st_limits::RevAProfileUsage::fbd_blocks,
         st_profile_generated::kMaxFbdBlocks},
        {"fbdConnections", &st_limits::RevAProfileUsage::fbd_connections,
         st_profile_generated::kMaxFbdConnections},
        {"artifactBytes", &st_limits::RevAProfileUsage::artifact_bytes,
         st_profile_generated::kMaxArtifactBytes},
        {"instructions", &st_limits::RevAProfileUsage::instructions,
         st_profile_generated::kMaxInstructions},
        {"slots", &st_limits::RevAProfileUsage::slots,
         st_profile_generated::kMaxSlots},
        {"writableSlots", &st_limits::RevAProfileUsage::writable_slots,
         st_profile_generated::kMaxWritableSlots},
        {"constants", &st_limits::RevAProfileUsage::constants,
         st_profile_generated::kMaxConstants},
        {"functionBlocks", &st_limits::RevAProfileUsage::function_blocks,
         st_profile_generated::kMaxFunctionBlocks},
        {"bindings", &st_limits::RevAProfileUsage::bindings,
         st_profile_generated::kMaxBindings},
        {"retainVariables", &st_limits::RevAProfileUsage::retain_variables,
         st_profile_generated::kMaxRetainVariables},
        {"retainBytes", &st_limits::RevAProfileUsage::retain_bytes,
         st_profile_generated::kMaxRetainBytes},
        {"sections", &st_limits::RevAProfileUsage::sections,
         st_profile_generated::kMaxSections},
    };

    for (const Boundary& boundary : boundaries) {
        st_limits::RevAProfileUsage usage;
        st_limits::RevAProfileError error;
        usage.*(boundary.field) = boundary.limit - 1;
        EXPECT_TRUE(st_limits::ValidateRevAProfile(usage, &error)) << boundary.name;
        usage.*(boundary.field) = boundary.limit;
        EXPECT_TRUE(st_limits::ValidateRevAProfile(usage, &error)) << boundary.name;
        usage.*(boundary.field) = boundary.limit + 1;
        EXPECT_FALSE(st_limits::ValidateRevAProfile(usage, &error)) << boundary.name;
        EXPECT_EQ(error.field, boundary.name);
    }
}

TEST(StProfile, TaskAndPeriodAreLockedToProductProfile)
{
    for (uint32_t period : st_profile_generated::kAllowedPeriodMs) {
        st_limits::RevAProfileUsage usage;
        usage.task_period_ms = period;
        st_limits::RevAProfileError error;
        EXPECT_TRUE(st_limits::ValidateRevAProfile(usage, &error)) << period;
    }
    /* ADR-061 C1: 5 ms (dưới base step) và 30000 ms (tập cũ) nằm ngoài tập mới. */
    for (uint32_t period : {5u, 9u, 11u, 999u, 1001u, 29999u, 30000u, 50001u}) {
        st_limits::RevAProfileUsage usage;
        usage.task_period_ms = period;
        st_limits::RevAProfileError error;
        EXPECT_FALSE(st_limits::ValidateRevAProfile(usage, &error)) << period;
        EXPECT_EQ(error.field, "taskPeriodMs");
        /* Constraint text phải kể đúng enum của profile, không phải chuỗi cũ. */
        EXPECT_NE(error.constraint.find("enum=10,50,100,500,1000,5000,10000,50000"),
                  std::string::npos)
            << error.constraint;
    }
}

TEST(StProfile, LegacyThirtySecondPeriodIsLoadOnlyNotCreatable)
{
    /* ADR-061 — gói đã Commission với tập cũ {1000, 5000, 30000} phải nạp được
     * sau nâng cấp; riêng 30000 là legacy: loader nhận, đường tạo mới từ chối. */
    EXPECT_FALSE(st_limits::RevAAllowsPeriod(30000u));
    EXPECT_TRUE(st_limits::RevAIsLegacyPeriod(30000u));
    EXPECT_TRUE(st_limits::RevALoaderAllowsPeriod(30000u));
    for (uint32_t period : st_profile_generated::kAllowedPeriodMs) {
        EXPECT_FALSE(st_limits::RevAIsLegacyPeriod(period)) << period;
        EXPECT_TRUE(st_limits::RevALoaderAllowsPeriod(period)) << period;
    }
    for (uint32_t period : {5u, 20u, 750u, 60000u}) {
        EXPECT_FALSE(st_limits::RevAIsLegacyPeriod(period)) << period;
        EXPECT_FALSE(st_limits::RevALoaderAllowsPeriod(period)) << period;
    }
}

TEST(StProfile, ProgramAndTaskCountsAcceptLimitAndRejectOneOver)
{
    struct Boundary {
        const char* name;
        std::size_t st_limits::RevAProfileUsage::*field;
        std::size_t limit;
    };
    const Boundary boundaries[] = {
        {"taskCount", &st_limits::RevAProfileUsage::task_count,
         st_profile_generated::kMaxTasks},
        {"programsPerTask", &st_limits::RevAProfileUsage::programs_per_task,
         st_profile_generated::kMaxProgramsPerTask},
        {"programsTotal", &st_limits::RevAProfileUsage::programs_total,
         st_profile_generated::kMaxProgramsTotal},
    };
    for (const Boundary& boundary : boundaries) {
        st_limits::RevAProfileUsage usage;
        st_limits::RevAProfileError error;

        usage.*(boundary.field) = boundary.limit;
        EXPECT_TRUE(st_limits::ValidateRevAProfile(usage, &error))
            << boundary.name << " tại đúng trần";

        usage.*(boundary.field) = boundary.limit + 1;
        EXPECT_FALSE(st_limits::ValidateRevAProfile(usage, &error))
            << boundary.name << " một-trên-trần";
        EXPECT_EQ(error.field, boundary.name);
        EXPECT_EQ(error.constraint, "range=1.." + std::to_string(boundary.limit));

        /* Zero cũng phải bị từ chối: 0 Program không phải package hợp lệ. */
        usage.*(boundary.field) = 0;
        EXPECT_FALSE(st_limits::ValidateRevAProfile(usage, &error)) << boundary.name;
        EXPECT_EQ(error.field, boundary.name);
    }
}

TEST(StProfile, TargetAbiComesFromContractNotLiteral)
{
    st_limits::RevAProfileUsage usage;
    st_limits::RevAProfileError error;
    EXPECT_TRUE(st_limits::ValidateRevAProfile(usage, &error));

    usage.target_abi = st_profile_generated::kTargetAbi + 1u;
    EXPECT_FALSE(st_limits::ValidateRevAProfile(usage, &error));
    EXPECT_EQ(error.field, "targetAbi");
    EXPECT_EQ(error.constraint,
              "exact=" + std::to_string(st_profile_generated::kTargetAbi));
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

TEST(StLimits, InvalidUtf8RejectedAtFirstBadByte)
{
    std::string src = wrap("b := a;\n");
    const std::size_t insert_at = src.find("b :=");
    ASSERT_NE(insert_at, std::string::npos);
    src.insert(insert_at, std::string("\xC0\xAF", 2)); /* encoding overlong bị cấm */
    StProgram prog;
    StDiagnostic diag;
    EXPECT_FALSE(parse_st_program(src, &prog, &diag));
    EXPECT_EQ(diag.code, st_diag_code::kLexUnexpectedChar);
    EXPECT_TRUE(diag.has_position());
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
