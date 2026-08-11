#include <gtest/gtest.h>

#include "programming/program_error_generated.hpp"

namespace core::programming {
namespace {

TEST(ProgramErrorCatalog, PublicCodesAndMetadataAreStable)
{
    static_assert(kProgramErrorMetadata.size() == 19);
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

} // namespace
} // namespace core::programming
