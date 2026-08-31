#include "st/st_artifact_manifest.hpp"

#include <algorithm>
#include <cctype>
#include <map>
#include <set>
#include <string>
#include <utility>

#include <nlohmann/json.hpp>

#include "st/st_artifact.hpp"
#include "st/st_compile.hpp"
#include "st/st_loader.hpp"
#include "st/st_profile_generated.hpp"

namespace core {
namespace {

using json = nlohmann::json;

constexpr const char* kManifestSchema =
    "https://mekong-hcm.local/contracts/programming/artifact_build_manifest_v1.schema.json";
constexpr const char* kCompilerId = "mkddc-programming-compiler";

bool fail(StManifestError* error, const char* code, const std::string& message,
          uint32_t line = 0, uint32_t column = 0, uint32_t length = 1)
{
    if (error) {
        error->code = code;
        error->message = message;
        error->line = line;
        error->column = column;
        error->length = length;
    }
    return false;
}

const char* language_name(StSourceLanguage language)
{
    return language == StSourceLanguage::ST ? "ST" : "FBD";
}

bool parse_language(const json& value, StSourceLanguage* language)
{
    if (!value.is_string()) return false;
    if (value == "ST") {
        *language = StSourceLanguage::ST;
        return true;
    }
    if (value == "FBD") {
        *language = StSourceLanguage::FBD;
        return true;
    }
    return false;
}

bool valid_source_id(std::string_view source_id)
{
    if (source_id.empty() || source_id.size() > 128) return false;
    return std::all_of(source_id.begin(), source_id.end(), [](char raw) {
        const unsigned char ch = static_cast<unsigned char>(raw);
        return std::isalnum(ch) || raw == '-' || raw == '_' || raw == '.' || raw == ':';
    });
}

bool exact_keys(const json& value, std::initializer_list<const char*> required)
{
    if (!value.is_object() || value.size() != required.size()) return false;
    return std::all_of(required.begin(), required.end(),
                       [&](const char* key) { return value.contains(key); });
}

bool same_source_map(const std::vector<StIrSourceMap>& lhs,
                     const std::vector<StIrSourceMap>& rhs)
{
    if (lhs.size() != rhs.size()) return false;
    for (std::size_t index = 0; index < lhs.size(); ++index) {
        if (lhs[index].pc != rhs[index].pc || lhs[index].line != rhs[index].line ||
            lhs[index].column != rhs[index].column) {
            return false;
        }
    }
    return true;
}

std::string build_key_sha256(const json& source, const json& compiler,
                             const json& profile, const json& target)
{
    const json key = {{"schemaVersion", 1}, {"source", source}, {"compiler", compiler},
                      {"profile", profile}, {"target", target}};
    return compute_source_sha256(key.dump());
}

json source_map_json(StSourceLanguage language, std::string_view source_id,
                     const StIrModule& module,
                     const std::vector<FbdSourceAnchor>& fbd_anchors,
                     StManifestError* error)
{
    std::map<std::pair<uint16_t, uint16_t>, const FbdSourceAnchor*> anchors;
    if (language == StSourceLanguage::FBD) {
        for (const FbdSourceAnchor& anchor : fbd_anchors) {
            if (anchor.line == 0 || anchor.column == 0 ||
                !anchors.emplace(std::pair{anchor.line, anchor.column}, &anchor).second) {
                fail(error, st_manifest_error::kSourceMap,
                     "neo FBD trùng hoặc có vị trí zero");
                return {};
            }
        }
    }

    json entries = json::array();
    for (const StIrSourceMap& location : module.source_map) {
        json entry = {{"pc", location.pc},
                      {"encodedLine", location.line},
                      {"encodedColumn", location.column},
                      {"sourceId", std::string(source_id)},
                      {"textLocation", nullptr},
                      {"fbdLocation", nullptr},
                      {"unit", nullptr}};
        if (language == StSourceLanguage::ST) {
            entry["textLocation"] =
                {{"line", location.line}, {"column", location.column}, {"length", 1}};
        } else {
            const auto found = anchors.find({location.line, location.column});
            if (found == anchors.end()) {
                fail(error, st_manifest_error::kSourceMap,
                     "source map FBD không giải được về UUID canonical");
                return {};
            }
            const FbdSourceAnchor& anchor = *found->second;
            entry["fbdLocation"] = {{"networkId", anchor.network_id},
                                    {"nodeId", anchor.node_id},
                                    {"portId", anchor.port_id}};
            if (anchor.has_unit) entry["unit"] = anchor.unit;
        }
        entries.push_back(std::move(entry));
    }
    return entries;
}

bool compile_reference(StSourceLanguage language, std::string_view source,
                       StIrModule* module, std::string* canonical_source,
                       std::vector<FbdSourceAnchor>* anchors, StManifestError* error,
                       StDiagnosticBag* bag = nullptr)
{
    if (language == StSourceLanguage::ST) {
        StDiagnostic diagnostic;
        const std::string owned(source);
        if (!compile_st_source(owned, module, &diagnostic, StCompileOptions{}, bag)) {
            return fail(error, diagnostic.code.c_str(),
                        diagnostic.code + ": " + diagnostic.message,
                        diagnostic.line, diagnostic.column, diagnostic.length);
        }
        *canonical_source = owned;
        anchors->clear();
        return true;
    }

    FbdCompileResult result = compile_fbd_source(source);
    if (!result.ok) {
        const std::string detail = result.issues.empty()
                                       ? "FBD compile thất bại không có diagnostic"
                                       : result.issues.front().code + ": " +
                                             result.issues.front().path;
        const char* code = result.issues.empty() ? st_manifest_error::kCompile
                                                  : result.issues.front().code.c_str();
        return fail(error, code, detail);
    }
    *module = std::move(result.module);
    *canonical_source = std::move(result.canonical_source);
    *anchors = std::move(result.source_anchors);
    return true;
}

bool build(std::string_view source_id, StSourceLanguage language, std::string_view source,
           StArtifactBuildResult* out, StManifestError* error,
           const std::vector<StIoMapEntry>& io_map, StDiagnosticBag* bag)
{
    if (!out || !valid_source_id(source_id))
        return fail(error, st_manifest_error::kRequest, "sourceId không hợp lệ");

    StArtifactBuildResult candidate;
    candidate.language = language;
    std::vector<FbdSourceAnchor> anchors;
    if (!compile_reference(language, source, &candidate.module, &candidate.canonical_source,
                           &anchors, error, bag)) {
        return false;
    }

    /* F-PROG-ASBUILT-013/D-07: bake io_map đã validate vào IR TRƯỚC khi
     * encode — sau điểm này artifact bytes bất biến, không có chỗ "vá thêm
     * binding sau". `candidate.module.variables[].slot` đã được gán xong bởi
     * compile_reference() ở trên nên resolve_io_bindings() tra được slot
     * đúng theo TÊN biến (io_map không cần/không biết slot). */
    if (!io_map.empty()) {
        std::vector<StDiagnostic> binding_diags;
        if (!resolve_io_bindings(&candidate.module, io_map, &binding_diags)) {
            /* ISS-STED-01: `resolve_io_bindings` là nơi DUY NHẤT trong pipeline
             * vốn đã tính ra nhiều diagnostic; trước đây `.front()` vứt phần
             * còn lại. Một io_map sai 6 binding phải hiện đủ 6 dòng. */
            if (bag != nullptr)
                for (const StDiagnostic& diagnostic : binding_diags) bag->add(diagnostic);
            const StDiagnostic& first = binding_diags.empty() ? StDiagnostic{} : binding_diags.front();
            return fail(error, first.code.empty() ? st_manifest_error::kCompile : first.code.c_str(),
                        first.message.empty() ? "io_map binding validation failed" : first.message,
                        static_cast<uint32_t>(first.line), static_cast<uint32_t>(first.column),
                        static_cast<uint32_t>(first.length));
        }
    }

    std::string encode_error;
    if (!EncodeArtifactDeterministic(candidate.module, &candidate.artifact, &encode_error))
        return fail(error, st_manifest_error::kEncode, encode_error);
    if (!CreateArtifactManifest(source_id, language, candidate.canonical_source,
                                candidate.module, anchors, candidate.artifact.data(),
                                candidate.artifact.size(), &candidate.manifest_json, error)) {
        return false;
    }
    candidate.fbd_source_anchors = std::move(anchors);

    const json manifest = json::parse(candidate.manifest_json);
    candidate.canonical_source_sha256 = manifest.at("source").at("canonicalSha256");
    candidate.artifact_file_sha256 = manifest.at("artifact").at("fileSha256");
    candidate.artifact_integrity_sha256 =
        manifest.at("artifact").at("integritySha256");
    candidate.build_key_sha256 = manifest.at("buildKeySha256");
    *out = std::move(candidate);
    if (error) *error = {};
    return true;
}

} // namespace

bool BuildStArtifact(std::string_view source_id, std::string_view source,
                     StArtifactBuildResult* out, StManifestError* error,
                     const std::vector<StIoMapEntry>& io_map)
{
    return build(source_id, StSourceLanguage::ST, source, out, error, io_map, nullptr);
}

bool BuildStArtifact(std::string_view source_id, std::string_view source,
                     StArtifactBuildResult* out, StManifestError* error,
                     const std::vector<StIoMapEntry>& io_map, StDiagnosticBag* bag)
{
    return build(source_id, StSourceLanguage::ST, source, out, error, io_map, bag);
}

bool BuildFbdArtifact(std::string_view source_id, std::string_view source,
                      StArtifactBuildResult* out, StManifestError* error,
                      const std::vector<StIoMapEntry>& io_map)
{
    return build(source_id, StSourceLanguage::FBD, source, out, error, io_map, nullptr);
}

bool BuildFbdArtifact(std::string_view source_id, std::string_view source,
                      StArtifactBuildResult* out, StManifestError* error,
                      const std::vector<StIoMapEntry>& io_map, StDiagnosticBag* bag)
{
    return build(source_id, StSourceLanguage::FBD, source, out, error, io_map, bag);
}

bool CreateArtifactManifest(std::string_view source_id, StSourceLanguage language,
                            std::string_view canonical_source, const StIrModule& module,
                            const std::vector<FbdSourceAnchor>& fbd_anchors,
                            const uint8_t* artifact, std::size_t artifact_size,
                            std::string* manifest_json, StManifestError* error,
                            const uint8_t* public_key)
{
    if (!manifest_json || !valid_source_id(source_id) || !artifact || artifact_size == 0)
        return fail(error, st_manifest_error::kRequest, "đầu vào manifest không hợp lệ");

    StArtifactSummary artifact_summary;
    StLoadError load_error;
    StLoaderOptions options;
    /* T59-607 — manifest builder là công cụ CẤU TRÚC, không phải điểm thực thi
     * chính sách toàn vẹn. Nó được gọi hai lần trong một lần biên dịch: lần đầu
     * trên artifact CHƯA ký (chữ ký chỉ đặt được sau khi thân artifact đã cố
     * định), lần sau trên artifact đã ký. Nếu nó đi theo mặc định
     * `SIGNATURE_REQUIRED` của profile thì lần gọi đầu luôn hỏng, và thông báo
     * "artifact is not signed" chỉ vào đúng chỗ sai — bước dựng manifest — thay
     * vì vào cấu hình khoá.
     *
     * Hạ xuống `HASH_ONLY` ở đây KHÔNG nới bảo vệ: SHA-256 vẫn bắt buộc, và
     * artifact đã đặt cờ signed vẫn bị loader verify chữ ký đầy đủ. Chính sách
     * "phải có chữ ký" được thực thi ở loader runtime của Core, nơi artifact
     * thật sự được nạp để chạy. */
    options.integrity_mode = StIntegrityMode::HASH_ONLY;
    options.public_key = public_key;
    if (!VerifyArtifact(artifact, artifact_size, options, &artifact_summary, &load_error)) {
        return fail(error, st_manifest_error::kArtifact,
                    load_error.code + ": " + load_error.message);
    }
    StLoadedProgram loaded;
    if (!LoadArtifact(artifact, artifact_size, options, &loaded, &load_error) ||
        !same_source_map(module.source_map, loaded.source_map) ||
        module.program_name != loaded.program_name ||
        module.compiler_version != st_ir::kCompilerVersion) {
        return fail(error, st_manifest_error::kArtifact,
                    "module/source-map/compiler không khớp artifact đã verify");
    }

    json source = {{"sourceId", std::string(source_id)},
                   {"language", language_name(language)},
                   {"canonicalBytes", canonical_source.size()},
                   {"canonicalSha256", compute_source_sha256(canonical_source)}};
    json compiler = {{"id", kCompilerId},
                     {"version", st_ir::kCompilerVersion},
                     {"lowererVersion", language == StSourceLanguage::FBD
                                              ? json(kFbdLowererVersion)
                                              : json(nullptr)}};
    json profile = {{"id", st_profile_generated::kProfileId},
                    {"code", st_profile_generated::kProfileCode},
                    {"sha256", st_profile_generated::kProfileSha256},
                    {"libraryVersion", st_profile_generated::kLibraryVersion}};
    json target = {{"abi", st_ir::kTargetAbi}};
    json entries = source_map_json(language, source_id, module, fbd_anchors, error);
    if (module.source_map.size() != entries.size()) return false;

    json manifest = {
        {"$schema", kManifestSchema},
        {"manifestVersion", 1},
        {"source", source},
        {"compiler", compiler},
        {"profile", profile},
        {"target", target},
        {"artifact",
         {{"magic", "MKDDCIR1"},
          {"schemaVersion", artifact_summary.schema_version},
          {"bytes", artifact_size},
          {"fileSha256", compute_file_sha256(artifact, artifact_size)},
          {"integritySha256", compute_artifact_integrity_sha256(artifact, artifact_size)},
          /* T59-607 — manifest mô tả CHÍNH artifact này, nên `integrityMode` ở
           * đây là chế độ của nó: có chữ ký thì `SIGNED`, chưa ký thì
           * `HASH_ONLY` — cùng bộ tên với `artifact_v2.schema.json` và cột
           * `integrity_mode` của store. `SIGNATURE_REQUIRED` là tên của CHÍNH
           * SÁCH ở profile, không phải tên trạng thái của một artifact. Viết cứng `HASH_ONLY` như trước làm manifest
           * của một artifact ĐÃ ký vẫn tự khai là chưa ký — provenance nói sai
           * về chính vật nó mô tả. */
          {"integrityMode", artifact_summary.signature_present ? "SIGNED" : "HASH_ONLY"},
          {"signaturePresent", artifact_summary.signature_present}}},
        {"buildKeySha256", build_key_sha256(source, compiler, profile, target)},
        {"sourceMap", {{"version", 1}, {"entries", std::move(entries)}}},
    };
    *manifest_json = manifest.dump();
    if (error) *error = {};
    return true;
}

bool VerifyArtifactManifest(std::string_view manifest_text,
                            std::string_view canonical_source,
                            const uint8_t* artifact, std::size_t artifact_size,
                            StManifestVerificationSummary* out,
                            StManifestError* error)
{
    if (!out || !artifact || artifact_size == 0 || manifest_text.empty())
        return fail(error, st_manifest_error::kRequest, "đầu vào verify không hợp lệ");
    try {
    const json manifest = json::parse(manifest_text, nullptr, false);
    if (manifest.is_discarded() ||
        !exact_keys(manifest, {"$schema", "manifestVersion", "source", "compiler",
                               "profile", "target", "artifact", "buildKeySha256",
                               "sourceMap"})) {
        return fail(error, st_manifest_error::kJson, "manifest JSON/field không hợp lệ");
    }
    if (manifest.at("$schema") != kManifestSchema || !manifest.at("manifestVersion").is_number_unsigned() ||
        manifest.at("manifestVersion") != 1) {
        return fail(error, st_manifest_error::kVersion, "manifest version không được hỗ trợ");
    }

    const json& source = manifest.at("source");
    const json& compiler = manifest.at("compiler");
    const json& profile = manifest.at("profile");
    const json& target = manifest.at("target");
    const json& artifact_value = manifest.at("artifact");
    const json& source_map = manifest.at("sourceMap");
    if (!exact_keys(source, {"sourceId", "language", "canonicalBytes", "canonicalSha256"}) ||
        !exact_keys(compiler, {"id", "version", "lowererVersion"}) ||
        !exact_keys(profile, {"id", "code", "sha256", "libraryVersion"}) ||
        !exact_keys(target, {"abi"}) ||
        !exact_keys(artifact_value, {"magic", "schemaVersion", "bytes", "fileSha256",
                                     "integritySha256", "integrityMode",
                                     "signaturePresent"}) ||
        !exact_keys(source_map, {"version", "entries"})) {
        return fail(error, st_manifest_error::kJson, "manifest nested field không hợp lệ");
    }

    StSourceLanguage language;
    if (!source.at("sourceId").is_string() ||
        !valid_source_id(source.at("sourceId").get_ref<const std::string&>()) ||
        !parse_language(source.at("language"), &language)) {
        return fail(error, st_manifest_error::kSource, "source identity/language không hợp lệ");
    }
    if (!source.at("canonicalBytes").is_number_unsigned() ||
        source.at("canonicalBytes") != canonical_source.size() ||
        source.at("canonicalSha256") != compute_source_sha256(canonical_source)) {
        return fail(error, st_manifest_error::kSource, "canonical source hash/size không khớp");
    }
    if (compiler.at("id") != kCompilerId || compiler.at("version") != st_ir::kCompilerVersion ||
        (language == StSourceLanguage::ST && !compiler.at("lowererVersion").is_null()) ||
        (language == StSourceLanguage::FBD && compiler.at("lowererVersion") != kFbdLowererVersion) ||
        profile.at("id") != st_profile_generated::kProfileId ||
        profile.at("code") != st_profile_generated::kProfileCode ||
        profile.at("sha256") != st_profile_generated::kProfileSha256 ||
        profile.at("libraryVersion") != st_profile_generated::kLibraryVersion ||
        target.at("abi") != st_ir::kTargetAbi) {
        return fail(error, st_manifest_error::kProfile, "compiler/profile/library/ABI không khớp");
    }
    if (manifest.at("buildKeySha256") != build_key_sha256(source, compiler, profile, target))
        return fail(error, st_manifest_error::kHash, "build key không khớp");

    StLoadedProgram loaded;
    StLoadError load_error;
    StLoaderOptions options;
    /* Cùng lý do như `CreateArtifactManifest`: đây là phép kiểm CẤU TRÚC của
     * manifest, không phải cổng chính sách. Artifact đã ký vẫn bị verify chữ ký. */
    options.integrity_mode = StIntegrityMode::HASH_ONLY;
    if (!LoadArtifact(artifact, artifact_size, options, &loaded, &load_error)) {
        return fail(error, st_manifest_error::kArtifact,
                    load_error.code + ": " + load_error.message);
    }
    if (artifact_value.at("magic") != "MKDDCIR1" ||
        artifact_value.at("schemaVersion") != st_ir::kSchemaVersion ||
        artifact_value.at("bytes") != artifact_size ||
        artifact_value.at("fileSha256") != compute_file_sha256(artifact, artifact_size) ||
        artifact_value.at("integritySha256") !=
            compute_artifact_integrity_sha256(artifact, artifact_size) ||
        !artifact_value.at("signaturePresent").is_boolean() ||
        artifact_value.at("integrityMode") !=
            (artifact_value.at("signaturePresent").get<bool>() ? "SIGNED" : "HASH_ONLY")) {
        return fail(error, st_manifest_error::kHash, "artifact hash/metadata không khớp");
    }
    const bool signed_flag = (artifact[26] & st_ir::kFlagSigned) != 0;
    if (artifact_value.at("signaturePresent").get<bool>() != signed_flag)
        return fail(error, st_manifest_error::kHash, "signature flag không khớp");

    StIrModule reference;
    std::string rebuilt_source;
    std::vector<FbdSourceAnchor> anchors;
    if (!compile_reference(language, canonical_source, &reference, &rebuilt_source, &anchors,
                           error)) {
        return false;
    }
    if (rebuilt_source != canonical_source ||
        !same_source_map(reference.source_map, loaded.source_map))
        return fail(error, st_manifest_error::kSourceMap,
                    "source map không khớp source canonical/artifact");

    if (!source_map.at("version").is_number_unsigned() || source_map.at("version") != 1 ||
        !source_map.at("entries").is_array() ||
        source_map.at("entries").size() != loaded.source_map.size()) {
        return fail(error, st_manifest_error::kSourceMap, "source map version/count không khớp");
    }
    StManifestError expected_error;
    const json expected_entries = source_map_json(
        language, source.at("sourceId").get_ref<const std::string&>(), reference, anchors,
        &expected_error);
    if (!expected_error.code.empty() || expected_entries != source_map.at("entries"))
        return fail(error, st_manifest_error::kSourceMap, "source map location không khớp");

    StManifestVerificationSummary summary;
    summary.language = language;
    summary.source_id = source.at("sourceId");
    summary.canonical_source_sha256 = source.at("canonicalSha256");
    summary.artifact_file_sha256 = artifact_value.at("fileSha256");
    summary.build_key_sha256 = manifest.at("buildKeySha256");
    summary.artifact_bytes = static_cast<uint32_t>(artifact_size);
    summary.instruction_count = static_cast<uint32_t>(loaded.code.size());
    summary.source_map_entries = static_cast<uint32_t>(loaded.source_map.size());
    *out = std::move(summary);
    if (error) *error = {};
    return true;
    } catch (const json::exception&) {
        return fail(error, st_manifest_error::kJson,
                    "manifest chứa kiểu hoặc cấu trúc JSON không hợp lệ");
    }
}

} // namespace core
