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
    hash_only.integrity_mode = StIntegrityMode::HASH_ONLY;
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

/* ---- ADR-052: khoá THIẾT BỊ ---- */

TEST(StArtifactTrust, DeviceKeySignedArtifactVerifiesWhenDeviceKeyIsTrusted)
{
    /* Đây là đường đi thật của sản phẩm: người dùng soạn Program trên bo, bo
     * biên dịch tại chỗ rồi tự ký bằng khoá của CHÍNH nó. Không có khoá hãng nào
     * tham gia — khoá hãng theo định nghĩa không nằm trên bo. */
    uint8_t device_public[crypto_sign_PUBLICKEYBYTES] = {0};
    uint8_t device_secret[crypto_sign_SECRETKEYBYTES] = {0};
    ASSERT_TRUE(generate_signing_keypair(device_public, device_secret));

    std::vector<uint8_t> artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&artifact, device_secret));

    StLoadError error;
    EXPECT_TRUE(loads_with(artifact, required_with(device_public), &error))
        << "artifact do bo tự ký phải nạp được khi khoá thiết bị nằm trong tập tin cậy";
}

TEST(StArtifactTrust, DeviceKeyOfAnotherBoardIsNotTrusted)
{
    /* Bất biến quan trọng nhất của mô hình khoá thiết bị: một bo bị chiếm KHÔNG
     * ký được artifact cho bo bên cạnh. Nếu phép kiểm này đỏ thì "khoá thiết bị"
     * chỉ là một khoá dùng chung được đặt tên khác. */
    uint8_t this_board_public[crypto_sign_PUBLICKEYBYTES] = {0};
    uint8_t this_board_secret[crypto_sign_SECRETKEYBYTES] = {0};
    ASSERT_TRUE(generate_signing_keypair(this_board_public, this_board_secret));

    uint8_t other_board_public[crypto_sign_PUBLICKEYBYTES] = {0};
    uint8_t other_board_secret[crypto_sign_SECRETKEYBYTES] = {0};
    ASSERT_TRUE(generate_signing_keypair(other_board_public, other_board_secret));

    std::vector<uint8_t> artifact = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&artifact, other_board_secret));

    StLoadError error;
    EXPECT_FALSE(loads_with(artifact, required_with(this_board_public), &error))
        << "artifact ký bằng khoá của bo khác KHÔNG được nạp";
    EXPECT_EQ(error.code, st_ir_error::kBadSignature);
}

TEST(StArtifactTrust, VendorKeyAndDeviceKeyCoexistInTheSameTrustSet)
{
    /* Hai nguồn gốc, hai khoá, một tập tin cậy: thư viện hãng phát hành và
     * chương trình người dùng viết phải cùng nạp được trên một bo — nếu không,
     * bật SIGNATURE_REQUIRED sẽ chặn đúng một trong hai. */
    KeyPair vendor = make_key_pair();
    uint8_t device_public[crypto_sign_PUBLICKEYBYTES] = {0};
    uint8_t device_secret[crypto_sign_SECRETKEYBYTES] = {0};
    ASSERT_TRUE(generate_signing_keypair(device_public, device_secret));

    std::vector<uint8_t> from_vendor = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&from_vendor, vendor.secret_key));
    std::vector<uint8_t> from_device = compile_unsigned();
    ASSERT_TRUE(sign_st_artifact(&from_device, device_secret));

    const StLoaderOptions options = required_with(vendor.public_key, device_public);
    StLoadError error;
    EXPECT_TRUE(loads_with(from_vendor, options, &error)) << "artifact hãng phải nạp được";
    EXPECT_TRUE(loads_with(from_device, options, &error)) << "artifact bo tự ký phải nạp được";
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
