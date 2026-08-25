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

#include <algorithm>
#include <cstddef>
#include <cstring>
#include <fstream>
#include <iterator>
#include <limits>
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
    input.programs.push_back({"Main", fake_ir_blob(0xA1), 1000u, 0u});
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
    ASSERT_EQ(view.program_periods_ms.size(), 1U);
    EXPECT_EQ(view.program_periods_ms[0], 1000U);
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
    input.programs.push_back({"Aux", fake_ir_blob(0xB2), 5000u, 0u});
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

TEST(StPackageV2, FullPouSignatureAndLinkedBodyRoundTrip)
{
    StPackageInput input = minimal_input();
    StPouSignature function;
    function.name = "Blend";
    function.kind = StPouKind::FUNCTION;
    function.input_names = {"a", "b"};
    function.input_types = {StType::REAL, StType::REAL};
    function.has_return_type = true;
    function.return_type = StType::REAL;
    function.has_linked_body = true;
    function.body_sha256.fill(0x5Au);
    function.instruction_count = 7;
    input.pou_signatures.push_back(function);

    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    EXPECT_NE(view.header.flags & st_pkg::kFlagPouTableFull, 0u);
    ASSERT_EQ(view.pou_signatures.size(), 2U);
    const StPouSignature& decoded = view.pou_signatures[1];
    EXPECT_EQ(decoded.name, "Blend");
    EXPECT_EQ(decoded.library_origin, "PROJECT");
    EXPECT_EQ(decoded.input_names, function.input_names);
    EXPECT_EQ(decoded.input_types, function.input_types);
    EXPECT_EQ(decoded.return_type, StType::REAL);
    EXPECT_EQ(decoded.body_sha256, function.body_sha256);
    EXPECT_EQ(decoded.instruction_count, 7U);
}

TEST(StPackageV2, LibraryPouRequiresPinnedLibraryLock)
{
    StPackageInput input = minimal_input();
    StPouSignature function;
    function.name = "SystemScale";
    function.kind = StPouKind::FUNCTION;
    function.from_library = true;
    function.library_entry_id = "sys-scale";
    function.version = "1.0.0";
    function.library_origin = "SYSTEM";
    function.has_linked_body = true;
    function.body_sha256.fill(0x6Cu);
    function.has_return_type = true;
    function.return_type = StType::REAL;
    input.pou_signatures.push_back(function);
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_FALSE(WritePackageV2(input, &bytes, &error));
    EXPECT_NE(error.find("LIBRARY_LOCK"), std::string::npos) << error;

    input.library_lock.system_version = "1.0.0";
    input.library_lock.system_sha256.fill(0xA5u);
    ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    ASSERT_EQ(view.pou_signatures.size(), 2U);
    EXPECT_TRUE(view.pou_signatures[1].from_library);
    EXPECT_EQ(view.pou_signatures[1].library_origin, "SYSTEM");
    EXPECT_EQ(view.library_system_version, "1.0.0");
}

TEST(StPackageV2, ProjectLibraryOriginRoundTripsWithoutBecomingLocal)
{
    StPackageInput input = minimal_input();
    StPouSignature function;
    function.name = "ProjectScale";
    function.kind = StPouKind::FUNCTION;
    function.from_library = true;
    function.library_entry_id = "project-entry-scale";
    function.version = "2.0.0";
    function.library_origin = "PROJECT";
    function.has_linked_body = true;
    function.body_sha256.fill(0x4Bu);
    function.has_return_type = true;
    function.return_type = StType::REAL;
    input.pou_signatures.push_back(function);
    input.library_lock.system_version = "system-1";

    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_FALSE(WritePackageV2(input, &bytes, &error));
    EXPECT_NE(error.find("projectRevisionId"), std::string::npos) << error;
    input.library_lock.project_revision_id = "project-revision-42";
    ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    ASSERT_EQ(view.pou_signatures.size(), 2U);
    EXPECT_TRUE(view.pou_signatures[1].from_library);
    EXPECT_EQ(view.pou_signatures[1].library_origin, "PROJECT");
    EXPECT_EQ(view.pou_signatures[1].library_entry_id, "project-entry-scale");
    EXPECT_EQ(view.pou_signatures[1].version, "2.0.0");
    EXPECT_EQ(view.library_project_revision_id, "project-revision-42");
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
        input.programs.push_back({"P" + std::to_string(index), fake_ir_blob(0xC3),
                                  1000u, 0u});
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

TEST(StPackageV2, WriterRefusesProgramWithoutScheduleAndWritesNoOutput)
{
    StPackageInput input = minimal_input();
    input.programs[0].period_ms = 0;
    std::vector<uint8_t> bytes = {0xAAu, 0x55u};
    std::string error;
    EXPECT_FALSE(WritePackageV2(input, &bytes, &error));
    EXPECT_TRUE(bytes.empty());
    EXPECT_NE(error.find("chu kỳ"), std::string::npos) << error;
}

TEST(StPackageV2, WriterAndLoaderKeepSingleProgramSchedule)
{
    for (uint32_t period_ms : {5000u, 30000u}) {
        StPackageInput input = minimal_input();
        input.programs[0].period_ms = period_ms;
        std::vector<uint8_t> bytes;
        std::string error;
        ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
        StPackageView view;
        const char* code = nullptr;
        ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
        EXPECT_EQ(view.header.schema_version, 2U);
        ASSERT_EQ(view.program_periods_ms.size(), 1U);
        EXPECT_EQ(view.program_periods_ms[0], period_ms);
    }
}

TEST(StPackageV2, ReaderStillAcceptsLegacyZeroProgramSchedule)
{
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(minimal_input(), &bytes, &error)) << error;

    /* Writer sắp section canonical nên PROGRAM_TABLE là entry thứ hai. Sửa đúng
     * trường periodMs của record đầu, rồi băm lại để phép thử đi qua lớp hash và
     * chứng minh reader tương thích package v2 legacy có period=0. */
    const std::size_t entry = st_pkg::kHeaderSize + st_pkg::kSectionEntrySize;
    ASSERT_LT(entry + st_pkg::kSectionEntrySize, bytes.size());
    const uint16_t type = static_cast<uint16_t>(bytes[entry]) |
                          (static_cast<uint16_t>(bytes[entry + 1]) << 8);
    ASSERT_EQ(type, st_pkg::SEC_PROGRAM_TABLE);
    const uint32_t payload = static_cast<uint32_t>(bytes[entry + 4]) |
                             (static_cast<uint32_t>(bytes[entry + 5]) << 8) |
                             (static_cast<uint32_t>(bytes[entry + 6]) << 16) |
                             (static_cast<uint32_t>(bytes[entry + 7]) << 24);
    ASSERT_LT(static_cast<std::size_t>(payload) + 2U, bytes.size());
    const uint16_t name_bytes = static_cast<uint16_t>(bytes[payload]) |
                                (static_cast<uint16_t>(bytes[payload + 1]) << 8);
    const std::size_t period = static_cast<std::size_t>(payload) + 2U + name_bytes;
    ASSERT_LE(period + 4U, bytes.size());
    std::fill(bytes.begin() + static_cast<std::ptrdiff_t>(period),
              bytes.begin() + static_cast<std::ptrdiff_t>(period + 4U), 0u);
    rehash(&bytes);

    StPackageView view;
    const char* code = nullptr;
    ASSERT_TRUE(load(bytes, &view, &code)) << (code ? code : "");
    ASSERT_EQ(view.program_periods_ms.size(), 1U);
    EXPECT_EQ(view.program_periods_ms[0], 0U);
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
    owner_conflict.programs.push_back({"Aux", fake_ir_blob(0xD4), 5000u, 0u});
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
    EXPECT_FALSE(WritePackageV2(publisher_conflict, &bytes, &error));

    /* Loader vẫn tự bảo vệ khi package đến từ writer khác. Dựng package hợp lệ,
     * đổi Feedback thành SETPOINT (cùng 8 byte), rồi băm lại để tấn công đi qua
     * đúng lớp semantic chứ không dừng ở hash. */
    StPackageInput tampered_publisher = minimal_input();
    tampered_publisher.signals.push_back({"Setpoint", "Main", 3, 1000});
    tampered_publisher.signals.push_back({"Feedback", "Main", 3, 1000});
    ASSERT_TRUE(WritePackageV2(tampered_publisher, &bytes, &error)) << error;
    const std::string needle = "Feedback";
    const std::string replacement = "SETPOINT";
    auto found = std::search(bytes.begin(), bytes.end(), needle.begin(), needle.end());
    ASSERT_NE(found, bytes.end());
    std::copy(replacement.begin(), replacement.end(), found);
    rehash(&bytes);
    EXPECT_FALSE(load(bytes, &view, &code));
    EXPECT_STREQ(code, st_pkg_error::kSignalPublisher);
}

TEST(StPackageV2, WriterRejectsInvalidSignalContractAndFallbackEncoding)
{
    auto rejected = [](const StPackageSignal& signal) {
        StPackageInput input = minimal_input();
        input.signals.push_back(signal);
        std::vector<uint8_t> bytes;
        std::string error;
        EXPECT_FALSE(WritePackageV2(input, &bytes, &error)) << signal.name;
        EXPECT_FALSE(error.empty());
    };

    rejected({"bad-name", "Main", 3, 1000});
    rejected({"VALID_NAME", "Missing", 3, 1000});
    rejected({"VALID_NAME", "Main", 0, 1000});
    rejected({"VALID_NAME", "Main", 3, 999});
    rejected({"VALID_NAME", "Main", 1, 1000, 1, 2, true});
    rejected({"VALID_NAME", "Main", 3, 1000, 0, 1, false});
    rejected({"VALID_NAME", "Main", 3, 1000, 1, 0x7f800000u, true});
    rejected({"VALID_NAME", "Main", 4, 1000, 1,
              std::numeric_limits<uint64_t>::max(), true});
}

TEST(StPackageV2, AllSignalFallbackTypesRoundTripCanonicalBits)
{
    StPackageInput input = minimal_input();
    input.signals = {
        {"F_BOOL", "Main", 1, 1000, 1, 1, true},
        {"F_DINT", "Main", 2, 1000, 1, 0x80000000u, true},
        {"F_REAL", "Main", 3, 1000, 1, 0x40b00000u, true},
        {"F_TIME", "Main", 4, 1000, 1, 2500000000ull, true},
        {"F_INT", "Main", 5, 1000, 1, 0xfffffffeu, true},
        {"F_UINT", "Main", 6, 1000, 1, 65535u, true},
    };
    std::vector<uint8_t> bytes;
    std::string error;
    ASSERT_TRUE(WritePackageV2(input, &bytes, &error)) << error;
    StPackageContents contents;
    const char* code = nullptr;
    ASSERT_TRUE(UnpackPackageV2(bytes.data(), bytes.size(),
                               st_profile_generated::kProfileCode,
                               st_profile_generated::kTargetAbi, &contents, &code))
        << (code ? code : "");
    ASSERT_EQ(contents.signals.size(), input.signals.size());
    for (std::size_t index = 0; index < input.signals.size(); ++index) {
        EXPECT_EQ(contents.signals[index].data_type, input.signals[index].data_type);
        EXPECT_EQ(contents.signals[index].fallback_bits,
                  input.signals[index].fallback_bits);
        EXPECT_TRUE(contents.signals[index].has_fallback);
    }
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
    EXPECT_EQ(view.signal_names.size(), 2U);
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
