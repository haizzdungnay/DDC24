#include <gtest/gtest.h>

#include "programming/program_error_generated.hpp"

namespace core::programming {
namespace {

TEST(ProgramErrorCatalog, PublicCodesAndMetadataAreStable)
{
    /* T59-006: 26 -> 30 public code. T59-004 đặt sáu mã gộp tự chọn; DDD §5.2 đã
     * khóa đúng mười mã, nên chúng được thay bằng bộ tên chuẩn. Con số là ảnh chụp có chủ ý để thay đổi catalog luôn đi qua
     * mắt người review. */
    static_assert(kProgramErrorMetadata.size() == 30);
    static_assert(kProgramErrorCatalogSha256.size() == 64);
    EXPECT_EQ(ProgramErrorMetadataFor(ProgramPublicError::Artifact).public_code,
              "PRG-ERR-ARTIFACT-001");
    EXPECT_EQ(MessageKeyFor(ProgramPublicError::ImpactStale),
              "programming.error.impactStale");
    EXPECT_TRUE(IsRetryable(ProgramPublicError::Unavailable));
    EXPECT_FALSE(ProgramErrorMetadataFor(ProgramPublicError::Unavailable)
                     .keeps_running_revision);
    EXPECT_FALSE(IsRetryable(ProgramPublicError::Commission));
}

TEST(ProgramErrorCatalog, ComponentDetailsMapExactlyAndUnknownFailsSafe)
{
    EXPECT_EQ(MapComponentError("artifact-loader", "IR-E-001"),
              ProgramPublicError::Artifact);
    EXPECT_EQ(MapComponentError("artifact-loader", "IR-E-004"),
              ProgramPublicError::Target);
    EXPECT_EQ(MapComponentError("compiler", "ST-IOMAP-003"),
              ProgramPublicError::MapType);
    EXPECT_EQ(MapComponentError("core-ipc", "IPC-REQUEST-ID-CONFLICT"),
              ProgramPublicError::Operation);
    EXPECT_EQ(MapComponentError("core-ipc", "IPC-NOT-IN-CATALOG"),
              ProgramPublicError::Unavailable);
    EXPECT_EQ(MapComponentError("unknown-component", "IR-E-001"),
              ProgramPublicError::Unavailable);
}

TEST(ProgramErrorCatalog, NewDomainDetailCodesMapToTheirOwnPublicCode)
{
    /* Sáu miền mới không được gộp vào một mã chung: người vận hành phải phân biệt
     * được "sai quy tắc POU" với "thiếu thư viện" hay "trùng chủ sở hữu đầu ra". */
    EXPECT_EQ(MapComponentError("compiler", "ST-POU-002"), ProgramPublicError::PouKind);
    EXPECT_EQ(MapComponentError("compiler", "ST-POU-003"), ProgramPublicError::PouRecursion);
    /* Vòng phụ thuộc thư viện CHÍNH LÀ đệ quy, nên nó không có mã version riêng. */
    EXPECT_EQ(MapComponentError("compiler", "ST-LIB-003"), ProgramPublicError::PouRecursion);
    EXPECT_EQ(MapComponentError("compiler", "ST-LIB-002"), ProgramPublicError::LibVersion);
    EXPECT_EQ(MapComponentError("compiler", "ST-SIG-001"), ProgramPublicError::SignalPublisher);
    EXPECT_EQ(MapComponentError("compiler", "ST-SIG-003"), ProgramPublicError::SignalFreshness);
    /* Type/unit dùng lại mã sẵn có thay vì mở nhánh công khai thứ hai. */
    EXPECT_EQ(MapComponentError("compiler", "ST-SIG-002"), ProgramPublicError::MapType);
    EXPECT_EQ(MapComponentError("compiler", "ST-LIM-009"), ProgramPublicError::ProgramLimit);
    EXPECT_EQ(MapComponentError("compiler", "ST-OWN-001"), ProgramPublicError::OutputOwner);
    EXPECT_EQ(MapComponentError("compiler", "ST-PID-001"), ProgramPublicError::PidReview);
    EXPECT_EQ(MapComponentError("st-control-api", "API-E-008"),
              ProgramPublicError::EnableNotCommissioned);
    EXPECT_EQ(MapComponentError("st-control-api", "API-E-009"),
              ProgramPublicError::ProgramState);

    /* Mã cùng họ nhưng chưa khai vẫn phải fail-safe, không đoán sang miền khác. */
    EXPECT_EQ(MapComponentError("compiler", "ST-POU-099"), ProgramPublicError::Unavailable);
    EXPECT_EQ(MapComponentError("st-control-api", "API-E-099"), ProgramPublicError::Unavailable);
}

} // namespace
} // namespace core::programming
