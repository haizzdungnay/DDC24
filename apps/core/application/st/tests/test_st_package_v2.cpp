/**
 * @file  test_st_package_v2.cpp
 * @brief T59-106 — writer/loader package v2, dual-reader v1/v2, và các phép kiểm
 *        biên/tamper mà một loader chạy trên thiết bị điều khiển phải có.
 *
 *        Loader là ranh giới tin cậy cuối cùng trước khi mã lạ được nạp vào một
 *        bộ điều khiển đang chạy. Mọi trường độ dài, offset và số đếm trong file
 *        đều là dữ liệu do bên ngoài kiểm soát, nên bộ test này tấn công đúng
 *        những chỗ đó thay vì chỉ kiểm đường đi đúng.
 */
#include <gtest/gtest.h>

#include <cstring>
#include <fstream>
#include <iterator>
#include <string>

#include <sodium.h>
#include <vector>

#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"

namespace core {
namespace {

std::vector<uint8_t> fake_ir_blob(uint8_t seed, std::size_t size = 64)
{
    std::vector<uint8_t> blob(size, seed);
    /* Container KHÔNG diễn giải blob; nó chỉ mang nguyên vẹn. Dùng byte giả ở đây
     * là hợp lệ và cố ý: test này kiểm VỎ CHỨA, không kiểm codegen. */
    return blob;
}

StPackageInput minimal_input()
{
    StPackageInput input;
    input.compiler_profile = st_profile_generated::kProfileCode;
    input.target_abi = st_profile_generated::kTargetAbi;
    input.programs.push_back({"Main", fake_ir_blob(0xA1)});
    StPouSignature signature;
    signature.name = "Main";
    signature.kind = StPouKind::PROGRAM;
    input.pou_signatures.push_back(signature);
    return input;
}

bool load(const std::vector<uint8_t>& bytes, StPackageView* view, const char** code)
{
    return LoadPackageV2(bytes.data(), bytes.size(), st_profile_generated::kProfileCode,
                         st_profile_generated::kTargetAbi, view, code);
}

void rehash(std::vector<uint8_t>* bytes);

} // namespace

TEST(StPackageV2, WriterAndLoaderRoundTripMinimalPackage)
{
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;

    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    EXPECT_EQ(view.header.schema_version, st_pkg::kSchemaVersion);
    EXPECT_EQ(view.header.layout_version, st_pkg::kLayoutVersion);
    ASSERT_EQ(view.program_names.size(), 1U);
    EXPECT_EQ(view.program_names[0], "Main");
    EXPECT_EQ(view.pou_names.size(), 1U);
}

TEST(StPackageV2, ByteOutputIsStableForTheSameInput)
{
    /* Golden byte-stable là điều kiện để hash artifact có nghĩa. Nếu writer chèn
     * thứ tự bảng hoặc padding không xác định thì mọi provenance đều vô giá trị. */
    std::vector<uint8_t> first, second;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &first, &error)) << error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &second, &error)) << error;
    EXPECT_EQ(first, second);
}

TEST(StPackageV2, MultiProgramPackageKeepsProgramOrderAndFlags)
{
    StPackageInput input = minimal_input();
    input.programs.push_back({"Aux", fake_ir_blob(0xB2)});
    StPouSignature aux;
    aux.name = "Aux";
    aux.kind = StPouKind::PROGRAM;
    input.pou_signatures.push_back(aux);

    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    ASSERT_EQ(view.program_names.size(), 2U);
    /* Thứ tự Program phải theo đúng thứ tự đưa vào, vì CODE_IR đi song song. */
    EXPECT_EQ(view.program_names[0], "Main");
    EXPECT_EQ(view.program_names[1], "Aux");
    EXPECT_TRUE((view.header.flags & st_pkg::kFlagHasMultiProgram) != 0);
}

TEST(StPackageV2, WriterRefusesInputBeyondProfileCaps)
{
    StPackageInput input = minimal_input();
    input.programs.clear();
    std::string error;
    std::vector<uint8_t> bytes;
    EXPECT_FALSE(WritePackageV2(input, &bytes, &error));
    EXPECT_TRUE(bytes.empty());

    input = minimal_input();
    for (std::size_t index = 0; index < st_profile_generated::kMaxProgramsTotal; ++index)
        input.programs.push_back({"P" + std::to_string(index), fake_ir_blob(0xC3)});
    EXPECT_FALSE(WritePackageV2(input, &bytes, &error));
    EXPECT_NE(error.find("Program"), std::string::npos) << error;
}

TEST(StPackageV2, WriterRefusesProgramWithoutIr)
{
    /* Gói thiếu thân chương trình mà vẫn ghi ra được là cách tạo artifact "hợp lệ"
     * nhưng không chạy được — phải chết ở writer. */
    StPackageInput input = minimal_input();
    input.programs[0].ir_blob.clear();
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_FALSE(WritePackageV2(input, &bytes, &error));
    EXPECT_TRUE(bytes.empty());
}

/* ---- Ranh giới tin cậy: mọi trường trong file là dữ liệu bên ngoài ---- */

TEST(StPackageV2, RejectsTruncatedAndOversizedArtifacts)
{
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;

    StPackageView view;
    const char* code = nullptr;
    const std::vector<std::size_t> sizes = {0U, 8U,
                                           static_cast<std::size_t>(st_pkg::kHeaderSize) - 1,
                                           bytes.size() - 1};
    for (std::size_t size : sizes) {
        EXPECT_FALSE(LoadPackageV2(bytes.data(), size, st_profile_generated::kProfileCode,
                                   st_profile_generated::kTargetAbi, &view, &code))
            << "size=" << size;
    }
    EXPECT_FALSE(LoadPackageV2(nullptr, 128, st_profile_generated::kProfileCode,
                               st_profile_generated::kTargetAbi, &view, &code));
}

TEST(StPackageV2, RejectsWrongProfileAndWrongAbi)
{
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;

    EXPECT_FALSE(LoadPackageV2(bytes.data(), bytes.size(),
                               st_profile_generated::kProfileCode + 1,
                               st_profile_generated::kTargetAbi, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kBadProfile);

    EXPECT_FALSE(LoadPackageV2(bytes.data(), bytes.size(), st_profile_generated::kProfileCode,
                               st_profile_generated::kTargetAbi + 1, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kBadProfile);
}

TEST(StPackageV2, RejectsTamperedContentAndHeader)
{
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;

    /* Đổi một byte nội dung mà không cập nhật hash. */
    std::vector<uint8_t> tampered = bytes;
    tampered[tampered.size() - 1] ^= 0xFFu;
    EXPECT_FALSE(load(tampered, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kBadHash);

    /* Ghi vào vùng chữ ký reserved: artifact chưa ký thì vùng đó phải bằng 0. */
    tampered = bytes;
    tampered[70] = 1;
    EXPECT_FALSE(load(tampered, &view, &code));

    /* Magic sai. */
    tampered = bytes;
    tampered[7] = '9';
    EXPECT_FALSE(load(tampered, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kBadMagic);

    /* schemaVersion tương lai. */
    tampered = bytes;
    tampered[8] = 9;
    rehash(&tampered);
    EXPECT_FALSE(load(tampered, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kBadSchema);
}

TEST(StPackageV2, RejectsSectionTableThatEscapesTheArtifact)
{
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;

    /* Offset + size tràn 32 bit: nếu loader cộng trên 32 bit thì section này
     * "nằm trong file" một cách giả tạo. Đây là lỗi tràn số kinh điển. */
    std::vector<uint8_t> tampered = bytes;
    const std::size_t first_entry = st_pkg::kHeaderSize;
    tampered[first_entry + 4] = 0xF0;
    tampered[first_entry + 5] = 0xFF;
    tampered[first_entry + 6] = 0xFF;
    tampered[first_entry + 7] = 0xFF;
    tampered[first_entry + 8] = 0xFF;
    tampered[first_entry + 9] = 0xFF;
    tampered[first_entry + 10] = 0xFF;
    tampered[first_entry + 11] = 0xFF;
    rehash(&tampered);
    EXPECT_FALSE(load(tampered, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kBadSectionTable);

    /* sectionCount lớn hơn thực tế. */
    tampered = bytes;
    tampered[18] = 0xFF;
    tampered[19] = 0x00;
    rehash(&tampered);
    EXPECT_FALSE(load(tampered, &view, &code));

    /* Loại section lạ không được bỏ qua im lặng. */
    tampered = bytes;
    tampered[first_entry] = 0x7F;
    tampered[first_entry + 1] = 0x7F;
    rehash(&tampered);
    EXPECT_FALSE(load(tampered, &view, &code));
}

TEST(StPackageV2, RejectsDuplicateOutputOwnerAndDuplicatePublisher)
{
    /* Hai bất biến cấp package mà loader phải tự kiểm, vì artifact có thể tới từ
     * nơi khác chứ không chỉ từ writer trong repo này. */
    StPackageInput owner_conflict = minimal_input();
    owner_conflict.programs.push_back({"Aux", fake_ir_blob(0xD4)});
    owner_conflict.bindings.push_back({"Main", 1, "AO-1", true});
    owner_conflict.bindings.push_back({"Aux", 1, "AO-1", true});
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(owner_conflict, &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;
    EXPECT_FALSE(load(bytes, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kOutputOwner);

    StPackageInput publisher_conflict = minimal_input();
    publisher_conflict.signals.push_back({"Setpoint", "Main", 3, 1000});
    publisher_conflict.signals.push_back({"Setpoint", "Main", 3, 1000});
    ASSERT_TRUE(WritePackageV2(publisher_conflict, &bytes, &error)) << error;
    EXPECT_FALSE(load(bytes, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kSignalPublisher);
}

TEST(StPackageV2, AcceptsDistinctOutputsAndSignals)
{
    StPackageInput input = minimal_input();
    input.bindings.push_back({"Main", 1, "AO-1", true});
    input.bindings.push_back({"Main", 1, "AO-2", true});
    input.bindings.push_back({"Main", 1, "AI-1", false});
    input.signals.push_back({"Setpoint", "Main", 3, 1000});
    input.signals.push_back({"Feedback", "Main", 3, 5000});
    input.library_lock.system_version = "rev-a.1";
    input.retain_bytes = 16;

    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    EXPECT_EQ(view.output_point_ids.size(), 2U);
    EXPECT_EQ(view.signal_names.size(), 2U);
    EXPECT_EQ(view.library_system_version, "rev-a.1");
    EXPECT_EQ(view.retain_bytes, 16U);
    EXPECT_TRUE((view.header.flags & st_pkg::kFlagHasSignals) != 0);
    EXPECT_TRUE((view.header.flags & st_pkg::kFlagHasLibraryLock) != 0);
    EXPECT_TRUE((view.header.flags & st_pkg::kFlagHasRetain) != 0);
}

TEST(StPackageV2, DualReaderStillRecognisesV1Artifacts)
{
    /* DDD §12.1: LKG v1 hiện hữu KHÔNG được mất hiệu lực khi nâng cấp. Nếu
     * probe từ chối v1 thì một lần nâng cấp là mất bản chạy được cuối cùng. */
    std::vector<uint8_t> v1 = {'M', 'K', 'D', 'D', 'C', 'I', 'R', '1', 0, 0, 0, 0};
    bool is_v2 = true;
    const char* code = nullptr;
    ASSERT_TRUE(ProbePackageFormat(v1.data(), v1.size(), &is_v2, &code)) << (code ? code : "");
    EXPECT_FALSE(is_v2);

    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;
    ASSERT_TRUE(ProbePackageFormat(bytes.data(), bytes.size(), &is_v2, &code));
    EXPECT_TRUE(is_v2);

    const std::vector<uint8_t> alien = {'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X'};
    EXPECT_FALSE(ProbePackageFormat(alien.data(), alien.size(), &is_v2, &code));
    EXPECT_STREQ(code, st_pkg_error::kBadMagic);
}

TEST(StPackageV2, GoldenOnDiskLoadsAndMatchesPinnedHash)
{
    /* Golden do CHÍNH writer production sinh ra (`mkddc-st-package-golden`). Test
     * này khoá hai điều: loader hiện tại vẫn nạp được nó, và nội dung khớp hash đã
     * ghim. Đổi định dạng mà quên sinh lại golden sẽ đỏ ở đây chứ không đỏ ở
     * board. */
    const std::string path =
        std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) + "/golden/package_v2_ahu.mkpkg";
    std::ifstream input(path, std::ios::binary);
    ASSERT_TRUE(input.good()) << "không đọc được " << path;
    const std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)),
                                     std::istreambuf_iterator<char>());
    ASSERT_FALSE(bytes.empty());

    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    EXPECT_EQ(view.program_names.size(), 2U);
    EXPECT_EQ(view.pou_names.size(), 3U);
    EXPECT_EQ(view.fb_instance_count, 1U);
    EXPECT_EQ(view.signal_names.size(), 1U);
    EXPECT_EQ(view.output_point_ids.size(), 2U);
    EXPECT_EQ(view.library_system_version, st_profile_generated::kLibraryVersion);

    /* Hash nội dung phải khớp trường hash trong chính header — nếu ai đó sửa
     * golden bằng tay mà quên cập nhật hash thì loader đã từ chối ở trên. */
    std::vector<uint8_t> normalized = bytes;
    std::memset(normalized.data() + 32, 0, 32);
    std::vector<uint8_t> digest(32, 0u);
    crypto_hash_sha256(digest.data(), normalized.data(), normalized.size());
    EXPECT_EQ(std::memcmp(digest.data(), bytes.data() + 32, 32), 0);
}

TEST(StPackageV2, SurvivesByteFlipFuzzWithoutCrashOrFalseAccept)
{
    /* Không tìm crash bằng cách đọc code — tấn công thật từng byte. Bất biến duy
     * nhất cần giữ: KHÔNG BAO GIỜ nhận một artifact đã bị sửa mà không cập nhật
     * hash, và không bao giờ đọc ngoài biên. */
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;

    std::size_t rejected = 0;
    for (std::size_t index = 0; index < bytes.size(); ++index) {
        for (uint8_t mask : {uint8_t{0x01}, uint8_t{0x80}}) {
            std::vector<uint8_t> mutated = bytes;
            mutated[index] ^= mask;
            StPackageView view;
            const char* code = nullptr;
            const bool ok = load(mutated, &view, &code);
            EXPECT_FALSE(ok) << "byte " << index << " mask " << static_cast<int>(mask);
            if (!ok) ++rejected;
        }
    }
    EXPECT_EQ(rejected, bytes.size() * 2);
}

namespace {

/* Cập nhật lại hash sau khi sửa nội dung, để test tấn công đúng lớp muốn tấn công
 * (bảng section, header) thay vì luôn dừng ở phép kiểm hash. */
void rehash(std::vector<uint8_t>* bytes)
{
    std::memset(bytes->data() + 32, 0, 32);
    std::vector<uint8_t> digest(32, 0u);
    crypto_hash_sha256(digest.data(), bytes->data(), bytes->size());
    std::memcpy(bytes->data() + 32, digest.data(), digest.size());
}

} // namespace

} // namespace core
