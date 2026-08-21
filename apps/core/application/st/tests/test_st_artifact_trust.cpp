/**
 * @file  test_st_artifact_trust.cpp
 * @brief T59-602 — tin cậy artifact: chữ ký, tập khoá, rotation và rollback.
 *
 *        `DDD-ARTIFACT-TRUST-PROG-001` §4/§5 nêu đúng cái bẫy mà bộ test này
 *        khoá lại: rotate khoá theo kiểu "đổi tức thời" làm MỌI artifact ký bằng
 *        khoá cũ bị từ chối ngay lúc đổi — kể cả bản LKG đang là đường lùi duy
 *        nhất. Khi đó cơ chế bảo vệ tự chặn chính đường rollback mà nó tồn tại
 *        để bảo vệ, và sự cố xảy ra đúng lúc người vận hành cần lùi nhất.
 *
 *        Vì thế verify nhận một TẬP khoá tin cậy, và test đi trọn vòng đời:
 *        ký hợp lệ → sửa một byte → ký bằng khoá lạ → rotate có overlap →
 *        rollback về artifact ký bằng khoá cũ → hết overlap thì khoá cũ bị loại.
 */
#include <gtest/gtest.h>

#include <sodium.h>

#include <cstring>
#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_loader.hpp"
#include "st/st_public_key.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

const char* kSource = R"ST(
PROGRAM trust
VAR_INPUT  a : REAL; END_VAR
VAR_OUTPUT b : REAL; END_VAR
    b := a * 2.0;
END_PROGRAM
)ST";

std::vector<uint8_t> compile_unsigned()
{
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(kSource, &module, &diagnostic))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    return bytes;
}

/* Cặp khoá Ed25519 mới, đóng vai "khoá phát hành sau khi rotate". */
struct KeyPair {
    uint8_t public_key[crypto_sign_PUBLICKEYBYTES] = {0};
    uint8_t secret_key[crypto_sign_SECRETKEYBYTES] = {0};
};

KeyPair make_key_pair()
{
    KeyPair pair;
    EXPECT_EQ(crypto_sign_keypair(pair.public_key, pair.secret_key), 0);
    return pair;
}

StLoaderOptions required_with(const uint8_t* first, const uint8_t* second = nullptr)
{
    StLoaderOptions options;
    options.integrity_mode = StIntegrityMode::SIGNATURE_REQUIRED;
    options.trusted_keys[0] = first;
    options.trusted_key_count = 1;
    if (second != nullptr) {
        options.trusted_keys[1] = second;
        options.trusted_key_count = 2;
    }
    return options;
}

bool loads_with(const std::vector<uint8_t>& artifact, const StLoaderOptions& options,
                StLoadError* error)
{
    StLoadedProgram program;
    return LoadArtifact(artifact.data(), artifact.size(), options, &program, error);
}

} // namespace

TEST(StArtifactTrust, SignedArtifactLoadsUnderSignatureRequired)
{
    std::vector<uint8_t> artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&artifact, st_test_secret_key()));

    StLoadedProgram program;
    StLoadError error;
    ASSERT_TRUE(LoadArtifact(artifact.data(), artifact.size(),
                             required_with(st_builtin_public_key()), &program, &error))
        << error.code << ": " << error.message;
    /* Audit phải biết artifact được tin bằng khoá NÀO: trong cửa sổ overlap có
     * nhiều hơn một khoá hợp lệ, và "verify PASS" không trả lời được câu hỏi
     * "còn bao nhiêu artifact đang sống nhờ khoá cũ". */
    EXPECT_EQ(std::memcmp(program.verified_public_key, st_builtin_public_key(), 32), 0);
}

TEST(StArtifactTrust, UnsignedArtifactIsRejectedWhenSignatureRequired)
{
    const std::vector<uint8_t> artifact = compile_unsigned();
    StLoadError error;
    EXPECT_FALSE(loads_with(artifact, required_with(st_builtin_public_key()), &error));
    EXPECT_EQ(error.code, std::string(st_ir_error::kMissingSignature));

    /* Cùng artifact đó vẫn nạp được ở HASH_ONLY — đây chính là as-built hôm nay,
     * và là lý do `SIGNATURE_REQUIRED` phải đọc từ cấu hình phía server chứ
     * không từ artifact tự khai (chống downgrade, §1 của DDD trust). */
    StLoaderOptions hash_only;
    EXPECT_TRUE(loads_with(artifact, hash_only, &error)) << error.code;
}

TEST(StArtifactTrust, TamperedByteAfterSigningIsRejected)
{
    std::vector<uint8_t> artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&artifact, st_test_secret_key()));
    /* Sửa một byte trong THÂN artifact: hash đổi ⇒ hỏng trước cả chữ ký. Đây là
     * kịch bản corrupt/chỉnh sửa thô. */
    artifact[artifact.size() - 1] ^= 0x01;

    StLoadError error;
    EXPECT_FALSE(loads_with(artifact, required_with(st_builtin_public_key()), &error));
    EXPECT_EQ(error.code, std::string(st_ir_error::kBadHash));
}

TEST(StArtifactTrust, ReSignedWithForeignKeyIsRejectedEvenThoughHashMatches)
{
    /* Kịch bản supply-chain thật (§1 threat table): kẻ tấn công sửa artifact RỒI
     * TÍNH LẠI hash và ký bằng khoá của chính nó. SHA-256 khi đó khớp hoàn hảo —
     * chỉ chữ ký mới phân biệt được. Đây là mối đe doạ mà `HASH_ONLY` KHÔNG chặn. */
    const KeyPair attacker = make_key_pair();
    std::vector<uint8_t> artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&artifact, attacker.secret_key));

    StLoadError error;
    EXPECT_FALSE(loads_with(artifact, required_with(st_builtin_public_key()), &error));
    EXPECT_EQ(error.code, std::string(st_ir_error::kBadSignature));

    /* Cùng bytes đó, nếu khoá tấn công nằm trong tập tin cậy thì nạp được — nói
     * cách khác: giá trị của cơ chế nằm TRỌN ở việc ai được vào tập khoá. */
    EXPECT_TRUE(loads_with(artifact, required_with(attacker.public_key), &error)) << error.code;
}

TEST(StArtifactTrust, RotationOverlapKeepsOldAndNewArtifactsLoadable)
{
    const KeyPair rotated = make_key_pair();

    std::vector<uint8_t> old_artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&old_artifact, st_test_secret_key()));
    std::vector<uint8_t> new_artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&new_artifact, rotated.secret_key));

    /* Cửa sổ overlap: khoá mới đứng trước, khoá cũ vẫn còn trong tập. */
    const StLoaderOptions overlap = required_with(rotated.public_key, st_builtin_public_key());
    StLoadError error;
    EXPECT_TRUE(loads_with(new_artifact, overlap, &error)) << error.code;
    EXPECT_TRUE(loads_with(old_artifact, overlap, &error))
        << "artifact ký bằng khoá cũ phải còn nạp được trong overlap: " << error.code;

    /* Đường lùi phải sống: LKG là bản ký bằng khoá CŨ, và rollback xảy ra đúng
     * lúc bản mới hỏng — nếu rotate chặn nó thì cơ chế bảo vệ tự khoá đường thoát. */
    StLoadedProgram lkg;
    ASSERT_TRUE(LoadArtifact(old_artifact.data(), old_artifact.size(), overlap, &lkg, &error));
    EXPECT_EQ(std::memcmp(lkg.verified_public_key, st_builtin_public_key(), 32), 0)
        << "audit phải chỉ ra bản lùi này đang sống nhờ khoá CŨ";
}

TEST(StArtifactTrust, AfterOverlapWindowClosesOldKeyNoLongerVerifies)
{
    const KeyPair rotated = make_key_pair();
    std::vector<uint8_t> old_artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&old_artifact, st_test_secret_key()));

    /* Hết cửa sổ: gỡ khoá cũ khỏi tập. Từ đây artifact cũ KHÔNG còn tin được —
     * đó là điểm của rotation, và nó phải xảy ra bằng một hành động tường minh
     * (gỡ khỏi tập) chứ không phải bằng thời gian trôi qua âm thầm. */
    StLoadError error;
    EXPECT_FALSE(loads_with(old_artifact, required_with(rotated.public_key), &error));
    EXPECT_EQ(error.code, std::string(st_ir_error::kBadSignature));
}

TEST(StArtifactTrust, BuildEmbedsTestKeyAndTheGateCanSeeIt)
{
    /* Trước T59-602, `st_public_key_is_test_key()` không có call site nào ngoài
     * test — nghĩa là "release phải dùng khoá thật" chỉ là một câu trong tài
     * liệu. Nay bootstrap log nó ở mức CRITICAL và `build-release.sh` đọc
     * `--st-key-info` để chặn. Test này khoá đúng cái ĐẦU VÀO của cổng đó. */
    EXPECT_TRUE(st_public_key_is_test_key())
        << "build test phải dùng khoá TEST; nếu đỏ ở đây thì build đã nhúng khoá khác";

    char fingerprint[17] = {0};
    st_public_key_fingerprint(st_builtin_public_key(), fingerprint, sizeof(fingerprint));
    EXPECT_EQ(std::string(fingerprint).size(), 16u);
    EXPECT_EQ(std::string(fingerprint), "99354613db15918a");
}

} // namespace core
