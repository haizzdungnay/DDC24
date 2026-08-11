/**
 * @file  test_st_ir.cpp
 * @brief TYPED_IR_GATE — compile -> serialize canonical -> verify -> load.
 *
 *        Trọng tâm là NHÓM REJECT: theo TYPED_IR_ARTIFACT_SPEC §6.1, sau khi
 *        load thành công executor không kiểm biên nữa, nên một lỗi lọt qua
 *        loader là lỗi an toàn bộ nhớ. Vì vậy có test cho TỪNG mã IR-E-*,
 *        cộng hai lớp quét toàn diện: cắt xén tại mọi offset và lật từng bit.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_artifact.hpp"
#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_loader.hpp"
#include <sodium.h>

#include "st/st_public_key.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

const char* kSimple = R"ST(
PROGRAM t
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := a * 2.0;
END_PROGRAM
)ST";

std::vector<uint8_t> build_signed(const char* src = kSimple)
{
    StIrModule mod;
    StDiagnostic diag;
    EXPECT_TRUE(compile_st_source(src, &mod, &diag)) << diag.code << ": " << diag.message;
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

std::vector<uint8_t> build_hash_only(const char* src = kSimple)
{
    StIrModule mod;
    StDiagnostic diag;
    EXPECT_TRUE(compile_st_source(src, &mod, &diag)) << diag.code << ": " << diag.message;
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    return bytes;
}

bool try_load(const std::vector<uint8_t>& a, StLoadError* err)
{
    StLoadedProgram p;
    StLoaderOptions o;
    return load_st_artifact(a.data(), a.size(), o, &p, err);
}

void put_u32(std::vector<uint8_t>* v, std::size_t off, uint32_t x)
{
    for (int i = 0; i < 4; i++) (*v)[off + i] = static_cast<uint8_t>((x >> (8 * i)) & 0xFF);
}

void put_u16(std::vector<uint8_t>* v, std::size_t off, uint16_t x)
{
    (*v)[off] = static_cast<uint8_t>(x & 0xFF);
    (*v)[off + 1] = static_cast<uint8_t>((x >> 8) & 0xFF);
}

std::vector<uint8_t> read_bytes(const std::string& path)
{
    std::ifstream input(path, std::ios::binary);
    return std::vector<uint8_t>(std::istreambuf_iterator<char>(input),
                                std::istreambuf_iterator<char>());
}

std::string read_text(const std::string& path)
{
    std::ifstream input(path, std::ios::binary);
    std::ostringstream content;
    content << input.rdbuf();
    return content.str();
}

std::string file_sha256_hex(const std::vector<uint8_t>& bytes)
{
    uint8_t digest[crypto_hash_sha256_BYTES];
    crypto_hash_sha256(digest, bytes.data(), bytes.size());
    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (uint8_t byte : digest) out << std::setw(2) << static_cast<unsigned>(byte);
    return out.str();
}

void refresh_artifact_hash(std::vector<uint8_t>* artifact)
{
    uint8_t digest[32];
    ASSERT_TRUE(compute_artifact_sha256(artifact->data(), artifact->size(), digest));
    std::copy(digest, digest + sizeof(digest), artifact->begin() + 32);
}

} // namespace

/* ---- Đường đi đúng ---- */

TEST(StIr, SignedArtifactLoads)
{
    const std::vector<uint8_t> a = build_signed();
    StLoadError err;
    EXPECT_TRUE(try_load(a, &err)) << err.code << ": " << err.message;
}

TEST(StIr, LoadedProgramHasExpectedShape)
{
    const std::vector<uint8_t> a = build_signed();
    StLoadedProgram p;
    StLoaderOptions o;
    StLoadError err;
    ASSERT_TRUE(load_st_artifact(a.data(), a.size(), o, &p, &err)) << err.code;
    EXPECT_EQ(p.program_name, "t");
    EXPECT_EQ(p.variables.size(), 2u);
    EXPECT_GT(p.code.size(), 0u);
    EXPECT_EQ(p.slots.size(), p.var_slot_count + 1u);   /* 1 hằng: 2.0 */
}

TEST(StIr, DeterministicBuildSameSourceSameBytes)
{
    const std::vector<uint8_t> expected = build_hash_only();
    for (int i = 0; i < 100; ++i)
        EXPECT_EQ(build_hash_only(), expected)
            << "lần build " << i << " làm artifact thay đổi";
}

TEST(StIr, ConstantPoolDeduplicates)
{
    /* 2.0 xuất hiện 3 lần trong source nhưng chỉ được cấp MỘT slot hằng. */
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(
        "PROGRAM t\nVAR r : REAL; END_VAR\nr := 2.0 + 2.0 + 2.0;\nEND_PROGRAM\n", &mod, &d));
    int count_two = 0;
    for (const StValue& c : mod.constants)
        if (c.type == StType::REAL && c.r == 2.0f) count_two++;
    EXPECT_EQ(count_two, 1);
}

/* ---- Nhóm reject: một test cho mỗi mã ---- */

TEST(StIr, RejectTooSmall)
{
    std::vector<uint8_t> a(64, 0);
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHeader);
}

TEST(StIr, RejectBadMagic)
{
    std::vector<uint8_t> a = build_signed();
    a[0] = 'X';
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadMagic);
}

TEST(StIr, RejectBadSchemaVersion)
{
    std::vector<uint8_t> a = build_signed();
    a[8] = 99;
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadSchema);
}

TEST(StIr, RejectBadCompilerProfile)
{
    std::vector<uint8_t> a = build_signed();
    a[10] = 0x77;
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadProfile);
}

TEST(StIr, RejectBadTargetAbi)
{
    std::vector<uint8_t> a = build_signed();
    put_u32(&a, 12, 0xDEADBEEF);
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadAbi);
}

TEST(StIr, RejectWrongTotalSize)
{
    std::vector<uint8_t> a = build_signed();
    put_u32(&a, 20, static_cast<uint32_t>(a.size() + 8));
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHeader);
}

TEST(StIr, RejectModifiedPayloadByHash)
{
    std::vector<uint8_t> a = build_signed();
    a[a.size() - 1] ^= 0xFF;
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHash);
}

TEST(StIr, RejectBadSignature)
{
    std::vector<uint8_t> a = build_signed();
    a[70] ^= 0x01;   /* trong vùng chữ ký — KHÔNG nằm trong vùng hash */
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadSignature);
}

TEST(StIr, HashOnlyIsTheRevADefault)
{
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));
    /* Không ký nhưng SHA-256 bắt buộc và hợp lệ. */
    StLoadError err;
    EXPECT_TRUE(try_load(a, &err)) << err.code << ": " << err.message;
}

TEST(StIr, SignatureRequiredRejectsUnsignedArtifact)
{
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));

    StLoadedProgram p;
    StLoaderOptions o;
    o.integrity_mode = StIntegrityMode::SIGNATURE_REQUIRED;
    StLoadError err;
    EXPECT_FALSE(load_st_artifact(a.data(), a.size(), o, &p, &err));
    EXPECT_EQ(err.code, st_ir_error::kMissingSignature);
}

TEST(StIr, SignatureOptionalPolicyIsAlwaysRejected)
{
    const std::vector<uint8_t> a = build_hash_only();
    StLoadedProgram p;
    StLoaderOptions o;
    o.integrity_mode = StIntegrityMode::SIGNATURE_OPTIONAL;
    StLoadError err;
    EXPECT_FALSE(load_st_artifact(a.data(), a.size(), o, &p, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadProfile);
}

TEST(StIr, FailedLoadDoesNotMutateCallerOutput)
{
    std::vector<uint8_t> a = build_hash_only();
    a.back() ^= 0x80;
    StLoadedProgram active;
    active.program_name = "active-before-failure";
    active.var_slot_count = 77;
    StLoaderOptions o;
    StLoadError err;
    EXPECT_FALSE(LoadArtifact(a.data(), a.size(), o, &active, &err));
    EXPECT_EQ(active.program_name, "active-before-failure");
    EXPECT_EQ(active.var_slot_count, 77u);
}

TEST(StIr, VerifyArtifactReturnsBoundedSummary)
{
    const std::vector<uint8_t> a = build_hash_only();
    StArtifactSummary summary;
    StLoaderOptions o;
    StLoadError err;
    ASSERT_TRUE(VerifyArtifact(a.data(), a.size(), o, &summary, &err)) << err.code;
    EXPECT_EQ(summary.schema_version, st_ir::kSchemaVersion);
    EXPECT_EQ(summary.compiler_profile, st_ir::kCompilerProfile);
    EXPECT_EQ(summary.target_abi, st_ir::kTargetAbi);
    EXPECT_EQ(summary.artifact_bytes, a.size());
    EXPECT_FALSE(summary.signature_present);
    EXPECT_EQ(summary.integrity_mode, StIntegrityMode::HASH_ONLY);
}

TEST(StIr, GoldenArtifactIsByteExactAndLoadable)
{
    const std::string contract_dir = PROGRAMMING_PROFILE_CONTRACT_DIR;
    const std::vector<uint8_t> golden =
        read_bytes(contract_dir + "/golden/rev_a_ahu_fan_control.mkir");
    ASSERT_FALSE(golden.empty());
    const nlohmann::json manifest =
        nlohmann::json::parse(read_text(contract_dir + "/golden/manifest.json"));
    EXPECT_EQ(file_sha256_hex(golden), manifest.at("sha256"));
    EXPECT_EQ(golden.size(), manifest.at("artifactBytes"));

    const std::string source = read_text(std::string(ST_SAMPLE_DIR) + "/ahu_fan_control.st");
    StIrModule module;
    StDiagnostic diagnostic;
    ASSERT_TRUE(compile_st_source(source, &module, &diagnostic)) << diagnostic.message;
    std::vector<uint8_t> rebuilt;
    std::string encode_error;
    ASSERT_TRUE(EncodeArtifactDeterministic(module, &rebuilt, &encode_error)) << encode_error;
    EXPECT_EQ(rebuilt, golden);

    StArtifactSummary summary;
    StLoaderOptions options;
    StLoadError load_error;
    EXPECT_TRUE(VerifyArtifact(golden.data(), golden.size(), options, &summary, &load_error))
        << load_error.code << ": " << load_error.message;
}

TEST(StIr, MachineReadableNegativeCorpusIsRejectedWithStableCode)
{
    const std::string contract_dir = PROGRAMMING_PROFILE_CONTRACT_DIR;
    const nlohmann::json corpus =
        nlohmann::json::parse(read_text(contract_dir + "/negative_artifact_v1.json"));
    const std::vector<uint8_t> base = read_bytes(contract_dir + "/" +
                                                  corpus.at("baseFixture").get<std::string>());
    ASSERT_FALSE(base.empty());
    for (const nlohmann::json& item : corpus.at("cases")) {
        std::vector<uint8_t> artifact = base;
        const std::size_t offset = item.at("offset");
        ASSERT_LT(offset, artifact.size()) << item.at("id");
        const std::string kind = item.at("kind");
        if (kind == "byteXor") artifact[offset] ^= item.at("mask").get<uint8_t>();
        else if (kind == "u16") put_u16(&artifact, offset, item.at("value").get<uint16_t>());
        else if (kind == "u32") put_u32(&artifact, offset, item.at("value").get<uint32_t>());
        else FAIL() << "mutation không hỗ trợ: " << kind;
        if (item.at("rehash")) refresh_artifact_hash(&artifact);

        StLoadedProgram output;
        StLoaderOptions options;
        StLoadError error;
        EXPECT_FALSE(LoadArtifact(artifact.data(), artifact.size(), options, &output, &error))
            << item.at("id");
        EXPECT_EQ(error.code, item.at("expected")) << item.at("id");
    }
}

TEST(StIr, RejectBadSectionTableOffset)
{
    std::vector<uint8_t> a = build_signed();
    /* Đẩy offset section đầu tiên ra ngoài file. */
    put_u32(&a, 128 + 4, 0xFFFFFF00u);
    /* Hash sẽ hỏng trước, nên test này chỉ khẳng định BỊ TỪ CHỐI, không
     * khẳng định mã cụ thể — điều bắt buộc là không crash và không nạp. */
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_FALSE(err.code.empty());
}

TEST(StIr, RejectResourceLimitTooManyInstructions)
{
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    mod.code.resize(st_ir::kMaxInstructions + 1, mod.code[0]);
    std::vector<uint8_t> a;
    std::string err_s;
    EXPECT_FALSE(serialize_st_ir(mod, &a, &err_s));
    EXPECT_NE(err_s.find("instruction"), std::string::npos);
}

/* ---- Quét toàn diện ---- */

TEST(StIr, TruncationAtEveryOffsetRejectedNoCrash)
{
    const std::vector<uint8_t> full = build_signed();
    for (std::size_t n = 0; n < full.size(); n++) {
        std::vector<uint8_t> cut(full.begin(), full.begin() + n);
        StLoadError err;
        StLoadedProgram p;
        StLoaderOptions o;
        const bool ok = load_st_artifact(cut.empty() ? full.data() : cut.data(), cut.size(), o,
                                         &p, &err);
        ASSERT_FALSE(ok) << "artifact cắt tại " << n << " byte vẫn được nạp";
        ASSERT_FALSE(err.code.empty()) << "cắt tại " << n << " không có mã lỗi";
    }
}

TEST(StIr, SingleBitFlipAlwaysRejected)
{
    const std::vector<uint8_t> full = build_signed();
    /* Quét thưa để test chạy nhanh nhưng vẫn phủ mọi vùng của file. */
    for (std::size_t byte = 0; byte < full.size(); byte += 7) {
        for (int bit = 0; bit < 8; bit += 3) {
            std::vector<uint8_t> a = full;
            a[byte] ^= static_cast<uint8_t>(1u << bit);
            StLoadError err;
            const bool ok = try_load(a, &err);
            ASSERT_FALSE(ok) << "lật bit " << bit << " của byte " << byte << " vẫn nạp được";
        }
    }
}

TEST(StIr, RandomGarbageNeverLoadsAndNeverCrashes)
{
    uint32_t seed = 12345;
    auto rnd = [&seed]() { seed = seed * 1664525u + 1013904223u; return seed; };
    for (int iter = 0; iter < 200; iter++) {
        std::vector<uint8_t> a(128 + (rnd() % 512));
        for (uint8_t& x : a) x = static_cast<uint8_t>(rnd() & 0xFF);
        if (iter % 2 == 0) {   /* nửa số lần cho magic đúng để đi sâu hơn */
            for (int i = 0; i < 8; i++) a[i] = static_cast<uint8_t>(st_ir::kMagic[i]);
        }
        StLoadError err;
        EXPECT_FALSE(try_load(a, &err));
    }
}

/* ---- ACTION 12: PACKAGE_SECURITY_GATE ----
 * Năm trường hợp reject bắt buộc đã có ở trên (bị sửa / sai chữ ký / thiếu
 * chữ ký / sai target / sai version). Phần dưới bổ sung điều mà các test đó
 * KHÔNG bắt được: chữ ký HỢP LỆ nhưng của khoá KHÁC, và cơ chế thay khoá cho
 * release. */

namespace {

/* Khoá thứ hai, seed khác — mô phỏng kẻ tấn công tự ký gói của mình. */
const uint8_t* other_secret_key()
{
    static uint8_t sk[64];
    static uint8_t pk[32];
    static bool init = false;
    if (!init) {
        uint8_t seed[32];
        for (int i = 0; i < 32; i++) seed[i] = static_cast<uint8_t>(0x5A ^ (i * 11 + 7));
        crypto_sign_seed_keypair(pk, sk, seed);
        init = true;
    }
    return sk;
}

} // namespace

TEST(StIrSecurity, ArtifactSignedWithDifferentKeyIsRejected)
{
    /* Đây mới là kịch bản tấn công thật: gói hoàn toàn hợp lệ về cấu trúc,
     * SHA-256 đúng, chữ ký đúng — nhưng ký bằng khoá không phải của Mekong.
     * Test lật bit chữ ký KHÔNG bắt được trường hợp này. */
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));
    ASSERT_TRUE(sign_st_artifact(&a, other_secret_key()));

    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadSignature);
}

TEST(StIrSecurity, ExplicitPublicKeyOptionIsHonoured)
{
    /* Cơ chế thay khoá cho release: loader phải dùng khoá được truyền vào chứ
     * không cứng nhắc dùng khoá nhúng. */
    uint8_t pk[32], sk[64], seed[32];
    for (int i = 0; i < 32; i++) seed[i] = static_cast<uint8_t>(0x33 ^ (i * 5 + 1));
    crypto_sign_seed_keypair(pk, sk, seed);

    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));
    ASSERT_TRUE(sign_st_artifact(&a, sk));

    /* Khoá nhúng (test key) phải TỪ CHỐI gói này. */
    StLoadError err1;
    EXPECT_FALSE(try_load(a, &err1));
    EXPECT_EQ(err1.code, st_ir_error::kBadSignature);

    /* Nhưng truyền đúng public key thì phải chấp nhận. */
    StLoadedProgram p;
    StLoaderOptions o;
    o.public_key = pk;
    StLoadError err2;
    EXPECT_TRUE(load_st_artifact(a.data(), a.size(), o, &p, &err2)) << err2.code;
}

TEST(StIrSecurity, BuildReportsWhetherItUsesTheTestKey)
{
    /* Quy trình release phải chặn được việc ship binary dùng khoá test. Điều
     * đó chỉ làm được nếu binary tự khai báo nó đang dùng khoá nào. */
    EXPECT_TRUE(st_public_key_is_test_key())
        << "build test PHẢI dùng khoá test; nếu false nghĩa là "
           "MKDDC_ST_PUBLIC_KEY_HEX đã được set trong build test";
}

TEST(StIrSecurity, HashOnlyDoesNotBypassHashCheck)
{
    /* HASH_ONLY bỏ yêu cầu chữ ký, không bao giờ bỏ kiểm SHA-256. */
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));
    a[a.size() - 1] ^= 0xFF;   /* hỏng payload */

    StLoadedProgram p;
    StLoaderOptions o;
    StLoadError err;
    EXPECT_FALSE(load_st_artifact(a.data(), a.size(), o, &p, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHash);
}

TEST(StIrSecurity, SignedFlagCannotBeClearedToBypassSignature)
{
    /* Tấn công hiển nhiên: xoá cờ kSigned để loader coi như HASH_ONLY. Cờ
     * nằm trong vùng SHA-256 nên phải hỏng hash. */
    std::vector<uint8_t> a = build_signed();
    a[26] &= static_cast<uint8_t>(~st_ir::kFlagSigned);

    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHash)
        << "cờ chữ ký phải nằm trong vùng được hash";
}

} // namespace core
