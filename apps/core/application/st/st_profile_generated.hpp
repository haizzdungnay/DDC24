// GENERATED bởi scripts/generate_programming_profile.py; không sửa tay.
#ifndef CORE_ST_PROFILE_GENERATED_HPP
#define CORE_ST_PROFILE_GENERATED_HPP

#include <array>
#include <cstddef>
#include <cstdint>

namespace core::st_profile_generated {
inline constexpr const char* kProfileId = "revA-1t-1-5-30";
inline constexpr uint16_t kProfileCode = 1u;
inline constexpr uint32_t kTargetAbi = 3841u;
inline constexpr uint16_t kProfileMajor = 2u;
inline constexpr uint16_t kProfileMinor = 0u;
inline constexpr const char* kProfileSha256 = "9b33db01a150816fc8b67f84e0aafa8750a29d20e9481a9ed8f1d67bbc9e6484";
inline constexpr const char* kLibraryVersion = "rev-a.1";
inline constexpr const char* kIntegrityMode = "HASH_ONLY";
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
} // namespace core::st_profile_generated

#endif // CORE_ST_PROFILE_GENERATED_HPP
