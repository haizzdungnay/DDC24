/**
 * @file  st_compile_main.cpp
 * @brief `mkddc-st-compile` — CLI compile ST/FBD thành artifact Rev A.
 *
 *        Đây là công cụ CHÍNH THỨC để BE sinh artifact. Cùng contract với
 *        `mkddc-st-validate`: argv cố định, source luôn qua file path (không
 *        bao giờ nằm trong argv), đúng một dòng JSON ra stdout với shape ổn
 *        định dù thành công hay thất bại.
 *
 *        Exit code: 0 = compile thành công; 1 = lỗi ST thật (syntax/semantic/
 *        vượt giới hạn); 2 = lỗi usage/IO phía CLI.
 *
 *        Mặc định Rev A là HASH_ONLY, không dùng khoá test. `--key` chỉ là
 *        đường tương thích có kiểm soát cho profile SIGNATURE_REQUIRED sau
 *        này; khi dùng, chữ ký vẫn được verify chặt bởi loader.
 */
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_control_api.hpp"
#include "st/st_artifact_manifest.hpp"
#include "st/st_ir.hpp"
#include "st/st_limits.hpp"
#include "st/st_profile_generated.hpp"

namespace {

int emit(const nlohmann::json& j, int code)
{
    std::fputs(j.dump().c_str(), stdout);
    std::fputc('\n', stdout);
    return code;
}

int fail(const char* code, const std::string& message, int exit_code,
         const std::string& source_id = {}, uint32_t line = 0,
         uint32_t column = 0, uint32_t length = 1)
{
    nlohmann::json j;
    j["ok"] = false;
    j["diagnostics"] = nlohmann::json::array({
        nlohmann::json{{"severity", "error"}, {"code", code}, {"message", message},
                       {"sourceId", source_id}, {"line", line}, {"column", column},
                       {"length", length}}});
    j["artifact"] = nullptr;
    j["artifactSha256"] = nullptr;
    j["artifactFileSha256"] = nullptr;
    j["artifactIntegritySha256"] = nullptr;
    j["sourceSha256"] = nullptr;
    j["buildKeySha256"] = nullptr;
    j["manifest"] = nullptr;
    j["compilerVersion"] = core::st_ir::kCompilerVersion;
    j["artifactSchemaVersion"] = core::st_ir::kSchemaVersion;
    j["targetAbi"] = core::st_ir::kTargetAbi;
    return emit(j, exit_code);
}

bool read_file(const std::string& path, std::string* out, std::size_t max_bytes)
{
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::ostringstream ss;
    ss << f.rdbuf();
    if (f.bad()) return false;
    *out = ss.str();
    return out->size() <= max_bytes;
}

/* Khoá riêng dạng 128 ký tự hex (64 byte). */
bool parse_secret_key(const std::string& text, uint8_t out[64])
{
    std::string hex;
    for (char c : text)
        if (!std::isspace(static_cast<unsigned char>(c))) hex += c;
    if (hex.size() != 128) return false;
    auto val = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (int i = 0; i < 64; i++) {
        const int hi = val(hex[i * 2]);
        const int lo = val(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

} // namespace

int main(int argc, char** argv)
{
    std::string source_path;
    std::string source_id = "main";
    std::string language = "ST";
    std::string key_path;
    std::string out_path;
    std::string manifest_out_path;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--source" && i + 1 < argc) source_path = argv[++i];
        else if (a == "--source-id" && i + 1 < argc) source_id = argv[++i];
        else if (a == "--language" && i + 1 < argc) language = argv[++i];
        else if (a == "--key" && i + 1 < argc) key_path = argv[++i];
        else if (a == "--out" && i + 1 < argc) out_path = argv[++i];
        else if (a == "--manifest-out" && i + 1 < argc) manifest_out_path = argv[++i];
        else if (a == "--help") {
            std::printf("usage: mkddc-st-compile --source <path> [--language ST|FBD] "
                        "[--source-id <opaque>] [--key <hexfile>] [--out <artifact>] "
                        "[--manifest-out <json>]\n");
            return 0;
        } else {
            return fail("ST-CLI-ARGS", "unknown argument '" + a + "'", 2);
        }
    }
    if (source_path.empty())
        return fail("ST-CLI-ARGS", "usage: mkddc-st-compile --source <path>", 2);
    if (language != "ST" && language != "FBD")
        return fail("ST-CLI-ARGS", "--language must be ST or FBD", 2);

    std::string source;
    if (!read_file(source_path, &source, core::st_limits::kMaxSourceBytes))
        return fail("ST-CLI-IO", "cannot read source or source exceeds size limit", 2);

    uint8_t secret[64] = {0};
    if (!key_path.empty()) {
        std::string key_text;
        if (!read_file(key_path, &key_text, 4096))
            return fail("ST-CLI-IO", "cannot read key file", 2);
        if (!parse_secret_key(key_text, secret))
            return fail("ST-CLI-KEY", "key file must contain 128 hex characters (64 bytes)", 2);
    }

    core::StArtifactBuildResult build;
    core::StManifestError build_error;
    const bool built = language == "ST"
                           ? core::BuildStArtifact(source_id, source, &build, &build_error)
                           : core::BuildFbdArtifact(source_id, source, &build, &build_error);
    if (!built)
        return fail(build_error.code.c_str(), build_error.message, 1, source_id,
                    build_error.line, build_error.column, build_error.length);

    if (!key_path.empty() && !core::sign_st_artifact(&build.artifact, secret))
        return fail("ST-CLI-KEY", "failed to sign artifact", 2);
    if (!key_path.empty() &&
        !core::CreateArtifactManifest(source_id, build.language, build.canonical_source,
                                      build.module, build.fbd_source_anchors,
                                      build.artifact.data(), build.artifact.size(),
                                      &build.manifest_json, &build_error, secret + 32)) {
        return fail(build_error.code.c_str(), build_error.message, 2);
    }

    const nlohmann::json manifest = nlohmann::json::parse(build.manifest_json);
    build.canonical_source_sha256 = manifest.at("source").at("canonicalSha256");
    build.artifact_file_sha256 = manifest.at("artifact").at("fileSha256");
    build.artifact_integrity_sha256 = manifest.at("artifact").at("integritySha256");
    build.build_key_sha256 = manifest.at("buildKeySha256");

    if (!out_path.empty()) {
        std::ofstream f(out_path, std::ios::binary);
        if (!f) return fail("ST-CLI-IO", "cannot write artifact to '" + out_path + "'", 2);
        f.write(reinterpret_cast<const char*>(build.artifact.data()),
                static_cast<std::streamsize>(build.artifact.size()));
        if (!f) return fail("ST-CLI-IO", "write error on '" + out_path + "'", 2);
    }
    if (!manifest_out_path.empty()) {
        std::ofstream f(manifest_out_path, std::ios::binary);
        if (!f)
            return fail("ST-CLI-IO", "cannot write manifest to '" + manifest_out_path + "'", 2);
        f << build.manifest_json << '\n';
        if (!f)
            return fail("ST-CLI-IO", "write error on '" + manifest_out_path + "'", 2);
    }

    uint8_t digest[32] = {0};
    core::compute_artifact_sha256(build.artifact.data(), build.artifact.size(), digest);

    nlohmann::json symbols = nlohmann::json::array();
    for (const core::StIrVariable& v : build.module.variables) {
        const char* dir = nullptr;
        if (v.storage == core::StStorage::VAR_INPUT) dir = "input";
        else if (v.storage == core::StStorage::VAR_OUTPUT) dir = "output";
        if (!dir) continue;
        symbols.push_back({{"name", v.name}, {"direction", dir},
                           {"type", core::st_type_name(v.type)}, {"slot", v.slot}});
    }

    nlohmann::json j;
    j["ok"] = true;
    j["diagnostics"] = nlohmann::json::array();
    j["programName"] = build.module.program_name;
    j["sourceId"] = source_id;
    j["language"] = language;
    j["symbols"] = symbols;
    /* Artifact trả kèm dạng base64 để BE dùng thẳng cho `program_stage` mà
     * không cần đọc lại file — bớt một bước là bớt một chỗ sai. */
    j["artifact"] = core::st_base64_encode(build.artifact.data(), build.artifact.size());
    j["artifactBytes"] = build.artifact.size();
    j["artifactSha256"] = core::st_base64_encode(digest, 32);
    j["artifactFileSha256"] = build.artifact_file_sha256;
    j["artifactIntegritySha256"] = build.artifact_integrity_sha256;
    j["sourceSha256"] = build.canonical_source_sha256;
    j["buildKeySha256"] = build.build_key_sha256;
    j["manifest"] = manifest;
    j["instructionCount"] = build.module.code.size();
    j["slotCount"] = build.module.slot_count;
    j["hasRetain"] = build.module.has_retain();
    j["compilerVersion"] = core::st_ir::kCompilerVersion;
    j["artifactSchemaVersion"] = core::st_ir::kSchemaVersion;
    j["compilerProfile"] = core::st_ir::kCompilerProfile;
    j["profileId"] = core::st_profile_generated::kProfileId;
    j["profileSha256"] = core::st_profile_generated::kProfileSha256;
    j["libraryVersion"] = core::st_profile_generated::kLibraryVersion;
    j["integrityMode"] = "HASH_ONLY";
    j["signaturePresent"] = !key_path.empty();
    j["targetAbi"] = core::st_ir::kTargetAbi;
    return emit(j, 0);
}
