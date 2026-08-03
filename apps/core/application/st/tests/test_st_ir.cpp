/**
 * @file  test_st_ir.cpp
 * @brief TYPED_IR_GATE — compile -> serialize -> ký -> load.
 *
 *        Trọng tâm là NHÓM REJECT: theo TYPED_IR_ARTIFACT_SPEC §6.1, sau khi
 *        load thành công executor không kiểm biên nữa, nên một lỗi lọt qua
 *        loader là lỗi an toàn bộ nhớ. Vì vậy có test cho TỪNG mã IR-E-*,
 *        cộng hai lớp quét toàn diện: cắt xén tại mọi offset và lật từng bit.
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

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
    const std::vector<uint8_t> a = build_signed();
    const std::vector<uint8_t> b = build_signed();
    EXPECT_EQ(a, b) << "cùng source phải cho cùng byte artifact";
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

TEST(StIr, RejectUnsignedByDefault)
{
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));
    /* Không ký */
    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kMissingSignature);
}

TEST(StIr, UnsignedAcceptedOnlyWhenExplicitlyAllowed)
{
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));

    StLoadedProgram p;
    StLoaderOptions o;
    o.allow_unsigned = true;
    StLoadError err;
    EXPECT_TRUE(load_st_artifact(a.data(), a.size(), o, &p, &err)) << err.code;
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

TEST(StIrSecurity, AllowUnsignedDoesNotBypassHashCheck)
{
    /* allow_unsigned chỉ bỏ qua CHỮ KÝ, không được bỏ qua toàn vẹn. Nếu nó
     * bỏ qua cả hai thì cờ phát triển này thành lỗ hổng thật. */
    StIrModule mod;
    StDiagnostic d;
    ASSERT_TRUE(compile_st_source(kSimple, &mod, &d));
    std::vector<uint8_t> a;
    std::string err_s;
    ASSERT_TRUE(serialize_st_ir(mod, &a, &err_s));
    a[a.size() - 1] ^= 0xFF;   /* hỏng payload */

    StLoadedProgram p;
    StLoaderOptions o;
    o.allow_unsigned = true;
    StLoadError err;
    EXPECT_FALSE(load_st_artifact(a.data(), a.size(), o, &p, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHash);
}

TEST(StIrSecurity, SignedFlagCannotBeClearedToBypassSignature)
{
    /* Tấn công hiển nhiên: xoá cờ kSigned để loader coi như gói chưa ký, rồi
     * hy vọng allow_unsigned. Cờ nằm trong vùng SHA-256 nên phải hỏng hash. */
    std::vector<uint8_t> a = build_signed();
    a[26] &= static_cast<uint8_t>(~st_ir::kFlagSigned);

    StLoadError err;
    EXPECT_FALSE(try_load(a, &err));
    EXPECT_EQ(err.code, st_ir_error::kBadHash)
        << "cờ chữ ký phải nằm trong vùng được hash";
}

} // namespace core
