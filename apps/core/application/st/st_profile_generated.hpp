// GENERATED bởi scripts/generate_programming_profile.py; không sửa tay.
#ifndef CORE_ST_PROFILE_GENERATED_HPP
#define CORE_ST_PROFILE_GENERATED_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace core::st_profile_generated {
inline constexpr const char* kProfileId = "revA-1t-1-5-30";
inline constexpr uint16_t kProfileCode = 1u;
inline constexpr uint32_t kTargetAbi = 3841u;
inline constexpr uint16_t kProfileMajor = 2u;
inline constexpr uint16_t kProfileMinor = 1u;
inline constexpr const char* kProfileSha256 = "d2866c41065e2a51fba88460068df453d63b6e95b30879eba292f4b667b49ede";
inline constexpr const char* kLibraryVersion = "rev-a.4";
inline constexpr const char* kIntegrityMode = "SIGNATURE_REQUIRED";
inline constexpr uint8_t kBoolWireCode = 1u;
inline constexpr uint8_t kIntWireCode = 5u;
inline constexpr uint8_t kDintWireCode = 2u;
inline constexpr uint8_t kUintWireCode = 6u;
inline constexpr uint8_t kRealWireCode = 3u;
inline constexpr uint8_t kTimeWireCode = 4u;
inline constexpr uint8_t kBoolWidthBits = 1u;
inline constexpr uint8_t kIntWidthBits = 16u;
inline constexpr uint8_t kDintWidthBits = 32u;
inline constexpr uint8_t kUintWidthBits = 16u;
inline constexpr uint8_t kRealWidthBits = 32u;
inline constexpr uint8_t kTimeWidthBits = 64u;
inline constexpr std::size_t kMaxTasks = 3u;
inline constexpr std::size_t kMaxProgramsPerTask = 32u;
inline constexpr std::size_t kMaxProgramsTotal = 32u;
inline constexpr uint32_t kMaxTaskBudgetPercent = 20u;
inline constexpr std::array<uint32_t, 3> kAllowedPeriodMs = {1000u, 5000u, 30000u};
inline constexpr std::size_t kMaxObjects = 1312u;
inline constexpr std::size_t kMaxProgramsEnabled = 16u;
inline constexpr std::size_t kMaxUserPou = 256u;
inline constexpr std::size_t kMaxFunctionBlockInstances = 1024u;
inline constexpr std::size_t kMaxSignals = 512u;
inline constexpr std::size_t kMaxPackageBindings = 512u;
inline constexpr std::size_t kMaxSourceBytes = 65536u;
inline constexpr std::size_t kMaxVariables = 512u;
inline constexpr std::size_t kMaxStatements = 4096u;
inline constexpr std::size_t kMaxFbdBlocks = 256u;
inline constexpr std::size_t kMaxFbdConnections = 512u;
inline constexpr std::size_t kMaxArtifactBytes = 1048576u;
inline constexpr std::size_t kMaxInstructions = 4096u;
inline constexpr std::size_t kMaxSlots = 1024u;
inline constexpr std::size_t kMaxWritableSlots = 512u;
inline constexpr std::size_t kMaxConstants = 512u;
inline constexpr std::size_t kMaxFunctionBlocks = 64u;
inline constexpr std::size_t kMaxBindings = 256u;
inline constexpr std::size_t kMaxRetainVariables = 128u;
inline constexpr std::size_t kMaxRetainBytes = 4096u;
inline constexpr std::size_t kMaxSections = 16u;

/* Feature giữ nhãn REVIEW_REQUIRED trong registry POU/Control Library.
 * `approved=false` nghĩa là Check PHẢI từ chối mọi Program dùng feature này.
 * Token không đến từ payload hay UI: nó suy ra từ chính contract profile và
 * generator từ chối mọi token không suy ra đúng. */
struct ReviewGatedFeature {
    std::string_view feature_id;
    bool approved;
    std::string_view approval_token;
};
inline constexpr std::array<ReviewGatedFeature, 1> kReviewGatedFeatures = {{
    ReviewGatedFeature{"PID", false, ""},
}};

/* Trả true khi feature bị chặn Check. Tên không có trong bảng là feature không
 * bị gate — mặc định KHÔNG chặn, vì chặn một thứ chưa ai khai là chặn mù. */
inline constexpr bool review_gate_blocks(std::string_view feature_id)
{
    for (const ReviewGatedFeature& item : kReviewGatedFeatures)
        if (item.feature_id == feature_id) return !item.approved;
    return false;
}
} // namespace core::st_profile_generated

#endif // CORE_ST_PROFILE_GENERATED_HPP
