/**
 * @file st_artifact_manifest.hpp
 * @brief Producer và verifier manifest provenance cho artifact Programming.
 *
 * Manifest nằm ngoài MKDDCIR1 để không phá layout schema 1. Artifact chỉ giữ
 * source map compact `pc -> line/column`; manifest khóa SHA-256 và ánh xạ vị
 * trí FBD về UUID canonical. Mọi API ở đây thuộc compiler non-RT.
 */
#ifndef CORE_ST_ARTIFACT_MANIFEST_HPP
#define CORE_ST_ARTIFACT_MANIFEST_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "st/st_fbd_compile.hpp"
#include "st/st_io_map.hpp"
#include "st/st_ir.hpp"

namespace core {

namespace st_manifest_error {
inline constexpr const char* kRequest = "COMP-MANIFEST-REQ-001";
inline constexpr const char* kCompile = "COMP-MANIFEST-COMPILE-001";
inline constexpr const char* kEncode = "COMP-MANIFEST-ENCODE-001";
inline constexpr const char* kJson = "COMP-MANIFEST-JSON-001";
inline constexpr const char* kVersion = "COMP-MANIFEST-VERSION-001";
inline constexpr const char* kProfile = "COMP-MANIFEST-PROFILE-001";
inline constexpr const char* kHash = "COMP-MANIFEST-HASH-001";
inline constexpr const char* kSource = "COMP-MANIFEST-SOURCE-001";
inline constexpr const char* kSourceMap = "COMP-MANIFEST-SOURCEMAP-001";
inline constexpr const char* kArtifact = "COMP-MANIFEST-ARTIFACT-001";
} // namespace st_manifest_error

enum class StSourceLanguage : uint8_t { ST = 1, FBD = 2 };

struct StManifestError {
    std::string code;
    std::string message;
    uint32_t line = 0;
    uint32_t column = 0;
    uint32_t length = 1;
};

struct StArtifactBuildResult {
    StSourceLanguage language = StSourceLanguage::ST;
    StIrModule module;
    std::vector<FbdSourceAnchor> fbd_source_anchors;
    std::string canonical_source;
    std::vector<uint8_t> artifact;
    std::string manifest_json;
    std::string canonical_source_sha256;
    std::string artifact_file_sha256;
    std::string artifact_integrity_sha256;
    std::string build_key_sha256;
};

struct StManifestVerificationSummary {
    StSourceLanguage language = StSourceLanguage::ST;
    std::string source_id;
    std::string canonical_source_sha256;
    std::string artifact_file_sha256;
    std::string build_key_sha256;
    uint32_t artifact_bytes = 0;
    uint32_t instruction_count = 0;
    uint32_t source_map_entries = 0;
};

/* Cùng input canonical + sourceId + profile sinh cùng artifact và manifest.
 * `io_map` rỗng (mặc định) = hành vi cũ, `io_bindings` rỗng trong artifact
 * (F-PROG-ASBUILT-013 trước khi vá). Khi có entry, mỗi entry được
 * `resolve_io_bindings()` validate rồi bake vào artifact trước khi ký/hash —
 * lỗi binding trả về false + *error, KHÔNG sinh artifact một phần. */
bool BuildStArtifact(std::string_view source_id, std::string_view source,
                     StArtifactBuildResult* out, StManifestError* error,
                     const std::vector<StIoMapEntry>& io_map = {});
bool BuildFbdArtifact(std::string_view source_id, std::string_view source,
                      StArtifactBuildResult* out, StManifestError* error,
                      const std::vector<StIoMapEntry>& io_map = {});

/* Dùng khi bytes đã được ký sau compile. Với Rev A HASH_ONLY, Build* gọi hàm
 * này trực tiếp sau encode. */
bool CreateArtifactManifest(std::string_view source_id, StSourceLanguage language,
                            std::string_view canonical_source, const StIrModule& module,
                            const std::vector<FbdSourceAnchor>& fbd_anchors,
                            const uint8_t* artifact, std::size_t artifact_size,
                            std::string* manifest_json, StManifestError* error,
                            const uint8_t* public_key = nullptr);

/* Verify độc lập toàn bộ profile/hash/source-map trước khi consumer lưu/stage.
 * `out` không đổi khi reject. */
bool VerifyArtifactManifest(std::string_view manifest_json,
                            std::string_view canonical_source,
                            const uint8_t* artifact, std::size_t artifact_size,
                            StManifestVerificationSummary* out,
                            StManifestError* error);

} // namespace core

#endif // CORE_ST_ARTIFACT_MANIFEST_HPP
