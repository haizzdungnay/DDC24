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
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cerrno>
#include <fstream>
#include <filesystem>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#ifdef __linux__
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#endif

#include <fcntl.h>
#include <sodium.h>
#include <sys/stat.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

#include "st/st_control_api.hpp"
#include "st/st_artifact.hpp"
#include "st/st_artifact_manifest.hpp"
#include "st/st_compile.hpp"
#include "st/st_fb_instance_layout.hpp"
#include "st/st_fbd_compile.hpp"
#include "st/st_io_map.hpp"
#include "st/st_ir.hpp"
#include "st/st_loader.hpp"
#include "st/st_limits.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_parser.hpp"
#include "st/st_pou_registry.hpp"
#include "st/st_review_gate.hpp"
#include "st/st_semantic.hpp"

namespace {

/* F-PROG-ASBUILT-013/D-07 — parse ngược `st_type_name()`. Chuỗi lạ trả false,
 * KHÔNG đoán về REAL — io_map là input từ BE, phải fail-closed như mọi input
 * biên khác của CLI này. */
bool parse_st_type(const std::string& text, core::StType* out)
{
    if (text == "BOOL") { *out = core::StType::BOOL; return true; }
    if (text == "INT")  { *out = core::StType::INT;  return true; }
    if (text == "DINT") { *out = core::StType::DINT; return true; }
    if (text == "UINT") { *out = core::StType::UINT; return true; }
    if (text == "REAL") { *out = core::StType::REAL; return true; }
    if (text == "TIME") { *out = core::StType::TIME; return true; }
    return false;
}

/* Đọc `--io-map-in <path>` — mảng JSON entry khớp `core::StIoMapEntry`.
 * Field không hợp lệ (thiếu, sai kiểu JSON, type/direction/category không
 * nhận diện được) làm toàn bộ CLI fail ngay tại đây — KHÔNG âm thầm bỏ qua
 * entry lỗi rồi compile thiếu binding (đúng bug F-PROG-ASBUILT-013 vừa vá,
 * không tái tạo dạng khác). Trả false + `*error_out` khi input sai hình dạng;
 * nội dung binding sai logic (unknown var, type mismatch...) được
 * `resolve_io_bindings()` bắt sau, có mã lỗi ST-IOMAP-* ổn định. */
bool read_io_map(const std::string& path, std::vector<core::StIoMapEntry>* out,
                 std::string* error_out)
{
    std::ifstream f(path, std::ios::binary);
    if (!f) { *error_out = "cannot open --io-map-in file"; return false; }
    nlohmann::json doc;
    try {
        f >> doc;
    } catch (const std::exception& e) {
        *error_out = std::string("--io-map-in is not valid JSON: ") + e.what();
        return false;
    }
    if (!doc.is_object() || !doc.contains("entries") || !doc["entries"].is_array()) {
        *error_out = "--io-map-in must be an object with an \"entries\" array";
        return false;
    }
    out->clear();
    for (const nlohmann::json& item : doc["entries"]) {
        if (!item.is_object()) { *error_out = "io_map entry must be an object"; return false; }
        core::StIoMapEntry entry;
        try {
            entry.variable = item.at("variable").get<std::string>();
            entry.direction = item.at("direction").get<std::string>();
            entry.point_id = item.at("pointId").get<std::string>();
            const std::string type_text = item.at("type").get<std::string>();
            if (!parse_st_type(type_text, &entry.type)) {
                *error_out = "io_map entry for '" + entry.variable + "' has unknown type '" +
                             type_text + "'";
                return false;
            }
            entry.unit = item.value("unit", std::string());
            entry.has_range = item.value("hasRange", false);
            entry.range_min = item.value("rangeMin", 0.0f);
            entry.range_max = item.value("rangeMax", 0.0f);
            entry.category = item.value("category", std::string("LOCAL"));
            entry.device_id = item.value("deviceId", std::string());
            /* T59-303: slot EXT do Point Catalog cấp. Mặc định 0 nghĩa là "chưa
             * phân giải" và `validate_point_contract` sẽ từ chối — không đoán. */
            entry.ext_index = static_cast<uint16_t>(item.value("extIndex", 0));
            entry.writable = item.value("writable", true);
        } catch (const std::exception& e) {
            *error_out = std::string("io_map entry missing/malformed field: ") + e.what();
            return false;
        }
        out->push_back(std::move(entry));
    }
    return true;
}

int emit(const nlohmann::json& j, int code)
{
    std::fputs(j.dump().c_str(), stdout);
    std::fputc('\n', stdout);
    return code;
}

const char* severity_text(core::StSeverity severity)
{
    return severity == core::StSeverity::WARNING ? "warning" : "error";
}

nlohmann::json diagnostic_json(const core::StDiagnostic& diagnostic,
                               const std::string& fallback_source_id)
{
    return nlohmann::json{
        {"severity", severity_text(diagnostic.severity)},
        {"code", diagnostic.code},
        {"message", diagnostic.message},
        {"sourceId", diagnostic.source_id.empty() ? fallback_source_id : diagnostic.source_id},
        {"line", diagnostic.line},
        {"column", diagnostic.column},
        {"length", diagnostic.length}};
}

/* Túi diagnostic của lần chạy hiện tại.
 *
 * Biến file-scope thay vì tham số vì `fail()` được gọi từ ~40 chỗ, trong đó
 * nhiều chỗ (đọc file, sandbox, tham số CLI) không dính gì tới compiler và
 * không có túi để truyền. Đường nào có túi thì `fail()` phát cả mảng; đường
 * nào không thì mảng một phần tử y như trước. */
core::StDiagnosticBag* g_bag = nullptr;

int fail(const char* code, const std::string& message, int exit_code,
         const std::string& source_id = {}, uint32_t line = 0,
         uint32_t column = 0, uint32_t length = 1)
{
    nlohmann::json j;
    j["ok"] = false;
    nlohmann::json diagnostics = nlohmann::json::array();
    if (g_bag != nullptr && !g_bag->empty()) {
        /* `finalize()` ở ĐÚNG một chỗ, ngay trước khi phát: sort + trần 64 +
         * `ST-LIM-006` là hợp đồng với BE/FE, không phải chuyện của từng pha. */
        g_bag->finalize();
        for (const core::StDiagnostic& diagnostic : g_bag->items())
            diagnostics.push_back(diagnostic_json(diagnostic, source_id));
    } else {
        diagnostics.push_back(
            nlohmann::json{{"severity", "error"}, {"code", code}, {"message", message},
                           {"sourceId", source_id}, {"line", line}, {"column", column},
                           {"length", length}});
    }
    j["diagnostics"] = diagnostics;
    j["artifact"] = nullptr;
    j["artifactSha256"] = nullptr;
    j["artifactFileSha256"] = nullptr;
    j["artifactIntegritySha256"] = nullptr;
    j["sourceSha256"] = nullptr;
    j["buildKeySha256"] = nullptr;
    j["manifest"] = nullptr;
    j["linkedPous"] = nlohmann::json::array();
    j["signalRefs"] = nlohmann::json::array();
    j["compilerVersion"] = core::st_ir::kCompilerVersion;
    j["artifactSchemaVersion"] = core::st_ir::kSchemaVersion;
    j["targetAbi"] = core::st_ir::kTargetAbi;
    return emit(j, exit_code);
}

bool read_file(const std::string& path, std::string* out, std::size_t max_bytes)
{
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    f.seekg(0, std::ios::end);
    const std::streamoff size = f.tellg();
    if (size < 0 || static_cast<uint64_t>(size) > max_bytes) return false;
    f.seekg(0, std::ios::beg);
    out->resize(static_cast<std::size_t>(size));
    if (size > 0) f.read(out->data(), size);
    return static_cast<bool>(f);
}

constexpr std::size_t kMaxBundleMetadataBytes = 4u * 1024u * 1024u;

struct PouManifestEntry {
    core::StPouTextSource text;
    std::string expected_name;
    core::StPouKind expected_kind = core::StPouKind::FUNCTION;
    std::string content_sha256;
};

bool read_library_requirements(const nlohmann::json& value,
                               std::vector<core::StLibraryRequirement>* out,
                               std::string* error)
{
    if (!value.is_array()) {
        *error = "library requirements must be an array";
        return false;
    }
    if (value.size() > core::st_profile_generated::kMaxObjects) {
        *error = "library requirements exceed profile object limit";
        return false;
    }
    try {
        for (const nlohmann::json& item : value) {
            if (!item.is_object()) {
                *error = "library requirement must be an object";
                return false;
            }
            core::StLibraryRequirement requirement{
                item.at("name").get<std::string>(),
                item.at("version").get<std::string>(),
                item.value("origin", std::string())};
            if (requirement.name.empty() || requirement.version.empty() ||
                (!requirement.library_origin.empty() &&
                 requirement.library_origin != "PROJECT" &&
                 requirement.library_origin != "SYSTEM")) {
                *error = "library requirement needs non-empty name/version and optional "
                         "origin PROJECT or SYSTEM";
                return false;
            }
            out->push_back(std::move(requirement));
        }
    } catch (const std::exception& exception) {
        *error = std::string("library requirement malformed: ") + exception.what();
        return false;
    }
    return true;
}

bool read_pou_manifest(const std::string& path, std::vector<PouManifestEntry>* out,
                       std::vector<core::StLibraryRequirement>* root_requirements,
                       std::string* error)
{
    namespace fs = std::filesystem;
    std::string manifest_text;
    if (!read_file(path, &manifest_text, kMaxBundleMetadataBytes)) {
        *error = "cannot read --pou-manifest or file exceeds metadata limit";
        return false;
    }
    nlohmann::json document;
    try {
        document = nlohmann::json::parse(manifest_text);
    } catch (const std::exception& exception) {
        *error = std::string("--pou-manifest is not valid JSON: ") + exception.what();
        return false;
    }
    if (!document.is_object() || document.value("schemaVersion", 0) != 1 ||
        !document.contains("pous") || !document["pous"].is_array()) {
        *error = "--pou-manifest must have schemaVersion=1 and a pous array";
        return false;
    }
    if (document["pous"].size() > core::st_profile_generated::kMaxObjects) {
        *error = "--pou-manifest exceeds profile POU limit";
        return false;
    }
    std::error_code ec;
    const fs::path manifest_path = fs::canonical(fs::path(path), ec);
    if (ec) { *error = "cannot canonicalize --pou-manifest"; return false; }
    const fs::path job_dir = manifest_path.parent_path();
    root_requirements->clear();
    if (document.contains("rootRequiresLibrary") &&
        !read_library_requirements(document.at("rootRequiresLibrary"),
                                   root_requirements, error))
        return false;
    std::set<std::string> names;
    out->clear();
    for (const nlohmann::json& item : document["pous"]) {
        if (!item.is_object()) { *error = "pou manifest entry must be an object"; return false; }
        PouManifestEntry entry;
        std::string relative_text;
        std::string kind;
        std::string language;
        std::string origin;
        try {
            entry.expected_name = item.at("name").get<std::string>();
            kind = item.at("kind").get<std::string>();
            language = item.at("language").get<std::string>();
            relative_text = item.at("path").get<std::string>();
            entry.content_sha256 = item.at("contentSha256").get<std::string>();
            origin = item.value("origin", std::string("PROJECT"));
        } catch (const std::exception& exception) {
            *error = std::string("pou manifest entry missing/malformed field: ") + exception.what();
            return false;
        }
        if (kind == "FUNCTION") entry.expected_kind = core::StPouKind::FUNCTION;
        else if (kind == "FUNCTION_BLOCK")
            entry.expected_kind = core::StPouKind::FUNCTION_BLOCK;
        else { *error = "pou manifest kind must be FUNCTION or FUNCTION_BLOCK"; return false; }
        if (language == "ST")
            entry.text.language = core::StPouTextSource::Language::ST;
        else if (language == "FBD")
            entry.text.language = core::StPouTextSource::Language::FBD;
        else { *error = "linked POU language must be ST or FBD"; return false; }
        const bool from_library = item.value("fromLibrary", origin == "SYSTEM");
        if (origin != "PROJECT" && origin != "SYSTEM") {
            *error = "linked POU origin must be PROJECT or SYSTEM";
            return false;
        }
        if (origin == "SYSTEM" && !from_library) {
            *error = "SYSTEM POU must set fromLibrary=true";
            return false;
        }
        entry.text.from_library = from_library;
        if (from_library) {
            entry.text.library_origin = origin;
            try {
                entry.text.library_entry_id = item.at("entryId").get<std::string>();
                entry.text.version = item.at("version").get<std::string>();
            } catch (const std::exception& exception) {
                *error = std::string("library-backed POU requires entryId/version: ") +
                         exception.what();
                return false;
            }
            if (entry.text.library_entry_id.empty() || entry.text.version.empty()) {
                *error = "library-backed POU requires non-empty entryId/version";
                return false;
            }
        } else if ((item.contains("entryId") && !item.at("entryId").is_null()) ||
                   (item.contains("version") && !item.at("version").is_null())) {
            *error = "local PROJECT POU must not carry library entryId/version";
            return false;
        }
        if (item.contains("requiresLibrary")) {
            if (!read_library_requirements(item.at("requiresLibrary"),
                                           &entry.text.requires_library, error))
                return false;
        }
        const fs::path relative(relative_text);
        /* Contract cố ý chỉ cho file cùng thư mục job: không absolute, không
         * subdirectory, không symlink. Siết chặt hơn `..` làm path traversal
         * không có bề mặt để diễn giải khác nhau giữa host/target. */
        if (relative.empty() || relative.is_absolute() || relative.has_parent_path() ||
            relative.filename() != relative ||
            fs::is_symlink(job_dir / relative, ec) || ec) {
            *error = "ST-CLI-POU-PATH: linked POU path must be a regular file in the job directory";
            return false;
        }
        const fs::path source_path = job_dir / relative;
        if (!fs::is_regular_file(source_path, ec) || ec) {
            *error = "ST-CLI-POU-PATH: linked POU is not a regular file";
            return false;
        }
        entry.text.source_id = entry.expected_name;
        entry.text.pou_name = entry.expected_name;
        entry.text.declared_kind = entry.expected_kind;
        if (!read_file(source_path.string(), &entry.text.source,
                       core::st_limits::kMaxSourceBytes)) {
            *error = "cannot read linked POU or source exceeds size limit";
            return false;
        }
        if (entry.content_sha256.size() != 64 ||
            core::compute_source_sha256(entry.text.source) != entry.content_sha256) {
            *error = "linked POU contentSha256 mismatch for '" + entry.expected_name + "'";
            return false;
        }
        core::StProgram parsed;
        core::StDiagnostic diagnostic;
        std::string canonical;
        if (!core::parse_st_pou_text_source(entry.text, &parsed, &canonical, &diagnostic)) {
            *error = diagnostic.code + ": " + diagnostic.message;
            return false;
        }
        if (parsed.name != entry.expected_name || parsed.kind != entry.expected_kind) {
            *error = "linked POU manifest name/kind does not match source for '" +
                     entry.expected_name + "'";
            return false;
        }
        std::string folded = entry.expected_name;
        std::transform(folded.begin(), folded.end(), folded.begin(), [](unsigned char ch) {
            return static_cast<char>(std::toupper(ch));
        });
        if (!names.insert(folded).second) {
            *error = "duplicate linked POU name '" + entry.expected_name + "'";
            return false;
        }
        out->push_back(std::move(entry));
    }
    return true;
}

bool read_library_lock(const std::string& path,
                       std::vector<core::StLibraryEntry>* entries,
                       std::string* system_version,
                       std::string* project_revision_id,
                       std::string* error)
{
    std::string lock_text;
    if (!read_file(path, &lock_text, kMaxBundleMetadataBytes)) {
        *error = "cannot read --library-lock or file exceeds metadata limit";
        return false;
    }
    nlohmann::json document;
    try {
        document = nlohmann::json::parse(lock_text);
    } catch (const std::exception& exception) {
        *error = std::string("--library-lock is not valid JSON: ") + exception.what();
        return false;
    }
    if (!document.is_object() || document.value("schemaVersion", 0) != 1 ||
        !document.contains("entries") || !document["entries"].is_array()) {
        *error = "--library-lock must have schemaVersion=1 and an entries array";
        return false;
    }
    if (document["entries"].size() > core::st_profile_generated::kMaxObjects) {
        *error = "--library-lock exceeds profile entry limit";
        return false;
    }
    try {
        *system_version = document.at("systemVersion").get<std::string>();
        *project_revision_id = document.at("projectRevisionId").get<std::string>();
        if (system_version->empty()) {
            *error = "library lock systemVersion must be non-empty";
            return false;
        }
        entries->clear();
        std::set<std::string> names;
        for (const nlohmann::json& item : document["entries"]) {
            core::StLibraryEntry entry;
            entry.name = item.at("name").get<std::string>();
            entry.entry_id = item.at("entryId").get<std::string>();
            entry.origin = item.value("origin", std::string("SYSTEM"));
            const std::string kind = item.at("kind").get<std::string>();
            entry.version = item.at("version").get<std::string>();
            if (entry.entry_id.empty() || entry.version.empty()) {
                *error = "library lock entryId/version must be non-empty";
                return false;
            }
            if (entry.origin != "PROJECT" && entry.origin != "SYSTEM") {
                *error = "library lock origin must be PROJECT or SYSTEM";
                return false;
            }
            if (kind == "FUNCTION") entry.kind = core::StPouKind::FUNCTION;
            else if (kind == "FUNCTION_BLOCK") entry.kind = core::StPouKind::FUNCTION_BLOCK;
            else { *error = "library lock kind must be FUNCTION or FUNCTION_BLOCK"; return false; }
            std::string folded = entry.name;
            std::transform(folded.begin(), folded.end(), folded.begin(), [](unsigned char ch) {
                return static_cast<char>(std::toupper(ch));
            });
            if (!names.insert(folded).second) {
                *error = "duplicate library lock entry '" + entry.name + "'";
                return false;
            }
            entries->push_back(std::move(entry));
        }
        const bool has_project_entry = std::any_of(
            entries->begin(), entries->end(), [](const core::StLibraryEntry& entry) {
                return entry.origin == "PROJECT";
            });
        if (has_project_entry && project_revision_id->empty()) {
            *error = "library lock with PROJECT entries requires projectRevisionId";
            return false;
        }
    } catch (const std::exception& exception) {
        *error = std::string("library lock field malformed: ") + exception.what();
        return false;
    }
    return true;
}

bool read_signal_manifest(const std::string& path, core::StCompileOptions* options,
                          std::string* error)
{
    std::string manifest_text;
    if (!read_file(path, &manifest_text, kMaxBundleMetadataBytes)) {
        *error = "cannot read --signal-manifest or file exceeds metadata limit";
        return false;
    }
    nlohmann::json document;
    try {
        document = nlohmann::json::parse(manifest_text);
    } catch (const std::exception& exception) {
        *error = std::string("--signal-manifest is not valid JSON: ") + exception.what();
        return false;
    }
    if (!document.is_object() || document.value("schemaVersion", 0) != 1 ||
        !document.contains("signals") || !document["signals"].is_array()) {
        *error = "--signal-manifest must have schemaVersion=1 and a signals array";
        return false;
    }
    if (document["signals"].size() > core::st_profile_generated::kMaxSignals) {
        *error = "--signal-manifest exceeds profile signal limit";
        return false;
    }
    try {
        options->program_identity = document.at("programId").get<std::string>();
    } catch (const std::exception& exception) {
        *error = std::string("--signal-manifest programId malformed: ") + exception.what();
        return false;
    }
    if (options->program_identity.empty() || options->program_identity.size() > 64) {
        *error = "--signal-manifest programId must be 1..64 characters";
        return false;
    }
    options->published_signals.clear();
    std::set<std::string> names;
    for (const nlohmann::json& item : document["signals"]) {
        core::StPublishedSignalContract signal;
        std::string type_text;
        try {
            signal.name = item.at("name").get<std::string>();
            type_text = item.at("type").get<std::string>();
            signal.producer_program = item.at("publisherProgramId").get<std::string>();
        } catch (const std::exception& exception) {
            *error = std::string("signal manifest entry missing/malformed field: ") +
                     exception.what();
            return false;
        }
        if (signal.name.empty() || signal.name.size() > 64 ||
            signal.producer_program.empty() || signal.producer_program.size() > 64 ||
            !parse_st_type(type_text, &signal.type)) {
            *error = "signal manifest entry has invalid name/type/publisherProgramId";
            return false;
        }
        std::string folded = signal.name;
        std::transform(folded.begin(), folded.end(), folded.begin(), [](unsigned char ch) {
            return static_cast<char>(std::toupper(ch));
        });
        if (!names.insert(folded).second) {
            *error = "duplicate Published Signal '" + signal.name + "'";
            return false;
        }
        options->published_signals.push_back(std::move(signal));
    }
    return true;
}

bool build_linked_artifact(const std::string& source_id, const std::string& language,
                           const std::string& source,
                           const std::vector<PouManifestEntry>& dependencies,
                           const std::vector<core::StLibraryRequirement>& root_requirements,
                           const std::vector<core::StLibraryEntry>& library,
                           const std::vector<core::StIoMapEntry>& io_map,
                           core::StArtifactBuildResult* out,
                           std::vector<core::StLinkedPouInfo>* linked_pous,
                           core::StManifestError* error,
                           const core::StCompileOptions& options,
                           core::StDiagnosticBag* bag)
{
    auto fail_build = [&](const std::string& code, const std::string& message,
                          uint32_t line = 0, uint32_t column = 0,
                          uint32_t length = 1) {
        error->code = code;
        error->message = message;
        error->line = line;
        error->column = column;
        error->length = length;
        return false;
    };

    std::vector<std::unique_ptr<core::StProgram>> owned;
    std::vector<std::string> dependency_canonical;
    std::vector<core::StPouSource> sources;
    core::StProgram root_program;
    std::string canonical_source;
    std::vector<core::FbdSourceAnchor> anchors;
    if (language == "ST") {
        core::StDiagnostic diagnostic;
        if (!core::parse_st_pou(source, &root_program, &diagnostic, bag))
            return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                              diagnostic.column, diagnostic.length);
        if (root_program.kind != core::StPouKind::PROGRAM)
            return fail_build(core::st_diag_code::kPouSignatureInvalid,
                              "--source must declare PROGRAM when linking POU",
                              root_program.line, root_program.column, root_program.length);
        canonical_source = source;
        out->language = core::StSourceLanguage::ST;
    } else {
        core::FbdLowerResult lowered = core::lower_fbd_source_to_program(source);
        if (!lowered.ok) {
            if (lowered.issues.empty())
                return fail_build("FBD-SEM-LOWER-001", "FBD lower failed");
            const core::FbdIssue& issue = lowered.issues.front();
            return fail_build(issue.code, issue.path);
        }
        root_program = std::move(lowered.program);
        canonical_source = std::move(lowered.canonical_source);
        anchors = std::move(lowered.source_anchors);
        out->language = core::StSourceLanguage::FBD;
    }
    sources.push_back({&root_program, root_requirements});
    /* Parse mọi POU phụ thuộc rồi mới dừng — xem `compile_st_pou_bundle`. */
    bool deps_ok = true;
    core::StDiagnostic first_dep_error;
    for (const PouManifestEntry& dependency : dependencies) {
        auto pou = std::make_unique<core::StProgram>();
        core::StDiagnostic diagnostic;
        std::string canonical;
        if (!core::parse_st_pou_text_source(dependency.text, pou.get(), &canonical,
                                            &diagnostic, bag)) {
            if (bag == nullptr)
                return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                                  diagnostic.column, diagnostic.length);
            if (deps_ok) { first_dep_error = diagnostic; deps_ok = false; }
            continue;
        }
        sources.push_back({pou.get(), dependency.text.requires_library,
                           dependency.text.from_library,
                           dependency.text.library_entry_id,
                           dependency.text.version,
                           dependency.text.library_origin});
        owned.push_back(std::move(pou));
        dependency_canonical.push_back(std::move(canonical));
    }
    if (!deps_ok)
        return fail_build(first_dep_error.code, first_dep_error.message,
                          first_dep_error.line, first_dep_error.column,
                          first_dep_error.length);

    core::StPouRegistryResult registry;
    core::StDiagnostic diagnostic;
    if (!core::st_build_pou_registry(sources, library, &registry, &diagnostic)) {
        if (bag != nullptr) bag->add(diagnostic);
        return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                          diagnostic.column, diagnostic.length);
    }
    if (!core::typecheck_st_pou_set(sources, registry, &diagnostic,
                                    options.published_signals,
                                    options.program_identity, bag))
        return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                          diagnostic.column, diagnostic.length);
    if (!core::st_review_gate_check(root_program, &diagnostic)) {
        if (bag != nullptr) bag->add(diagnostic);
        return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                          diagnostic.column, diagnostic.length);
    }
    for (const auto& pou : owned) {
        if (!core::st_review_gate_check(*pou, &diagnostic)) {
            if (bag != nullptr) bag->add(diagnostic);
            return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                              diagnostic.column, diagnostic.length);
        }
    }
    core::StFbLayoutResult layout;
    if (!core::st_plan_fb_instance_layout(sources, library, &layout, &diagnostic)) {
        if (bag != nullptr) bag->add(diagnostic);
        return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                          diagnostic.column, diagnostic.length);
    }

    std::vector<std::size_t> order(dependencies.size());
    for (std::size_t index = 0; index < order.size(); ++index) order[index] = index;
    std::sort(order.begin(), order.end(), [&](std::size_t lhs, std::size_t rhs) {
        return dependencies[lhs].expected_name < dependencies[rhs].expected_name;
    });
    std::string bundle_source = "MKDDC-POU-BUNDLE:1\nROOT:" +
                                std::to_string(canonical_source.size()) + "\n" +
                                canonical_source + "\n";
    for (std::size_t index : order) {
        bundle_source += dependencies[index].expected_name + ":" +
                         std::to_string(dependency_canonical[index].size()) + "\n" +
                         dependency_canonical[index] + "\n";
    }
    if (!core::compile_st_to_ir_linked(root_program, bundle_source, sources, registry,
                                       &out->module, linked_pous, &diagnostic, options)) {
        if (bag != nullptr) bag->add(diagnostic);
        return fail_build(diagnostic.code, diagnostic.message, diagnostic.line,
                          diagnostic.column, diagnostic.length);
    }
    for (core::StLinkedPouInfo& info : *linked_pous) {
        for (const PouManifestEntry& dependency : dependencies) {
            if (dependency.expected_name != info.name) continue;
            crypto_hash_sha256(info.content_sha256.data(),
                reinterpret_cast<const unsigned char*>(dependency.text.source.data()),
                dependency.text.source.size());
            const std::size_t dependency_index =
                static_cast<std::size_t>(&dependency - dependencies.data());
            crypto_hash_sha256(
                info.body_sha256.data(),
                reinterpret_cast<const unsigned char*>(
                    dependency_canonical[dependency_index].data()),
                dependency_canonical[dependency_index].size());
            break;
        }
    }
    if (!io_map.empty()) {
        std::vector<core::StDiagnostic> binding_diagnostics;
        if (!core::resolve_io_bindings(&out->module, io_map, &binding_diagnostics)) {
            /* ISS-STED-01: giữ TOÀN BỘ, không `.front()` — xem ghi chú cùng
             * nội dung ở `st_artifact_manifest.cpp`. */
            if (bag != nullptr)
                for (const core::StDiagnostic& item : binding_diagnostics) bag->add(item);
            const core::StDiagnostic first = binding_diagnostics.empty()
                                                 ? core::StDiagnostic{}
                                                 : binding_diagnostics.front();
            return fail_build(first.code.empty() ? "COMP-MANIFEST-COMPILE-001" : first.code,
                              first.message.empty() ? "io_map validation failed" : first.message,
                              first.line, first.column, first.length);
        }
    }
    std::string encode_error;
    if (!core::EncodeArtifactDeterministic(out->module, &out->artifact, &encode_error))
        return fail_build(core::st_manifest_error::kEncode, encode_error);
    out->canonical_source = canonical_source;
    out->fbd_source_anchors = std::move(anchors);
    if (!core::CreateArtifactManifest(source_id, out->language, out->canonical_source,
                                      out->module, out->fbd_source_anchors,
                                      out->artifact.data(), out->artifact.size(),
                                      &out->manifest_json, error))
        return false;
    const nlohmann::json manifest = nlohmann::json::parse(out->manifest_json);
    out->canonical_source_sha256 = manifest.at("source").at("canonicalSha256");
    out->artifact_file_sha256 = manifest.at("artifact").at("fileSha256");
    out->artifact_integrity_sha256 = manifest.at("artifact").at("integritySha256");
    out->build_key_sha256 = manifest.at("buildKeySha256");
    return true;
}

/* ADR-052 — provisioning khoá thiết bị.
 *
 * Ghi `device.key` (khoá riêng, 0600) và `device.pub` (khoá công khai, 0644).
 * TỪ CHỐI ghi đè khi đã có khoá: sinh lại khoá thiết bị làm mọi artifact đang
 * chạy trên bo mất hiệu lực cùng lúc — gồm cả LKG, tức đúng bản dùng để lùi khi
 * bản mới hỏng. Một lệnh provisioning chạy nhầm lần thứ hai không được phép có
 * hậu quả đó, nên nó phải dừng chứ không phải ghi đè.
 */
int generate_device_key(const std::string& dir)
{
    const std::string secret_path = dir + "/device.key";
    const std::string public_path = dir + "/device.pub";

    for (const std::string& path : {secret_path, public_path}) {
        struct stat st{};
        if (::stat(path.c_str(), &st) == 0)
            return fail("ST-CLI-KEY-EXISTS",
                        "da co khoa thiet bi tai " + path +
                            " — sinh lai se vo hieu hoa moi artifact dang chay, gom ca LKG",
                        2);
    }

    uint8_t public_key[32];
    uint8_t secret_key[64];
    if (!core::generate_signing_keypair(public_key, secret_key))
        return fail("ST-CLI-KEY", "khong sinh duoc cap khoa Ed25519", 2);

    auto to_hex = [](const uint8_t* bytes, std::size_t count) {
        static const char* kDigits = "0123456789abcdef";
        std::string hex;
        hex.reserve(count * 2);
        for (std::size_t i = 0; i < count; i++) {
            hex += kDigits[bytes[i] >> 4];
            hex += kDigits[bytes[i] & 0x0F];
        }
        return hex;
    };

    /* Khoá riêng ghi bằng open() với mode 0600 NGAY từ lúc tạo file. Ghi rồi
     * chmod sau để lại một khe thời gian mà file khoá đọc được bởi mọi tiến
     * trình — khe đó nhỏ nhưng không có lý do gì để tồn tại. */
    const int fd = ::open(secret_path.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0) return fail("ST-CLI-IO", "khong tao duoc " + secret_path, 2);
    const std::string secret_hex = to_hex(secret_key, 64) + "\n";
    const ssize_t written = ::write(fd, secret_hex.data(), secret_hex.size());
    ::close(fd);
    sodium_memzero(secret_key, sizeof(secret_key));
    if (written != static_cast<ssize_t>(secret_hex.size()))
        return fail("ST-CLI-IO", "ghi khoa rieng that bai", 2);

    std::ofstream pub(public_path, std::ios::trunc);
    if (!pub) return fail("ST-CLI-IO", "khong tao duoc " + public_path, 2);
    pub << to_hex(public_key, 32) << "\n";
    if (!pub) return fail("ST-CLI-IO", "ghi khoa cong khai that bai", 2);
    pub.close();

    nlohmann::json j;
    j["ok"] = true;
    j["secretKeyPath"] = secret_path;
    j["publicKeyPath"] = public_path;
    j["publicKeyHex"] = to_hex(public_key, 32);
    j["fingerprint"] = to_hex(public_key, 8);
    std::fputs(j.dump().c_str(), stdout);
    std::fputc('\n', stdout);
    return 0;
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

bool apply_worker_sandbox(std::string* error)
{
#ifndef __linux__
    *error = "compiler sandbox is only supported on Linux";
    return false;
#else
    auto limit = [error](int resource, rlim_t value, const char* name) {
        const rlimit bounds{value, value};
        if (::setrlimit(resource, &bounds) == 0) return true;
        *error = std::string("setrlimit ") + name + " failed";
        return false;
    };
    if (!limit(RLIMIT_CORE, 0, "CORE") ||
        !limit(RLIMIT_FSIZE, 2u * 1024u * 1024u, "FSIZE") ||
        !limit(RLIMIT_NOFILE, 32, "NOFILE") ||
        !limit(RLIMIT_NPROC, 1, "NPROC") ||
        !limit(RLIMIT_AS, 256u * 1024u * 1024u, "AS") ||
        !limit(RLIMIT_CPU, 5, "CPU"))
        return false;
    if (::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        *error = "PR_SET_NO_NEW_PRIVS failed";
        return false;
    }

    /* Source, artifact và manifest đã được mở bằng path do worker tạo trước
     * cổng này. Từ đây compiler không thể mở config/device/path khác, tạo
     * socket, spawn/exec process hoặc mount/ptrace. Input ST/FBD không bao giờ
     * trở thành code native; filter là lớp fail-closed bổ sung cho parser. */
#define MKDDC_DENY_SYSCALL(number) \
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (number), 0, 1), \
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA))
    sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, nr)),
#ifdef __NR_open
        MKDDC_DENY_SYSCALL(__NR_open),
#endif
#ifdef __NR_openat
        MKDDC_DENY_SYSCALL(__NR_openat),
#endif
#ifdef __NR_openat2
        MKDDC_DENY_SYSCALL(__NR_openat2),
#endif
#ifdef __NR_creat
        MKDDC_DENY_SYSCALL(__NR_creat),
#endif
#ifdef __NR_socket
        MKDDC_DENY_SYSCALL(__NR_socket),
#endif
#ifdef __NR_socketpair
        MKDDC_DENY_SYSCALL(__NR_socketpair),
#endif
#ifdef __NR_connect
        MKDDC_DENY_SYSCALL(__NR_connect),
#endif
#ifdef __NR_bind
        MKDDC_DENY_SYSCALL(__NR_bind),
#endif
#ifdef __NR_listen
        MKDDC_DENY_SYSCALL(__NR_listen),
#endif
#ifdef __NR_accept
        MKDDC_DENY_SYSCALL(__NR_accept),
#endif
#ifdef __NR_accept4
        MKDDC_DENY_SYSCALL(__NR_accept4),
#endif
#ifdef __NR_execve
        MKDDC_DENY_SYSCALL(__NR_execve),
#endif
#ifdef __NR_execveat
        MKDDC_DENY_SYSCALL(__NR_execveat),
#endif
#ifdef __NR_fork
        MKDDC_DENY_SYSCALL(__NR_fork),
#endif
#ifdef __NR_vfork
        MKDDC_DENY_SYSCALL(__NR_vfork),
#endif
#ifdef __NR_clone
        MKDDC_DENY_SYSCALL(__NR_clone),
#endif
#ifdef __NR_clone3
        MKDDC_DENY_SYSCALL(__NR_clone3),
#endif
#ifdef __NR_mount
        MKDDC_DENY_SYSCALL(__NR_mount),
#endif
#ifdef __NR_umount2
        MKDDC_DENY_SYSCALL(__NR_umount2),
#endif
#ifdef __NR_ptrace
        MKDDC_DENY_SYSCALL(__NR_ptrace),
#endif
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
#undef MKDDC_DENY_SYSCALL
    const sock_fprog program{static_cast<unsigned short>(sizeof(filter) / sizeof(filter[0])), filter};
    if (::prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) {
        *error = "SECCOMP_MODE_FILTER failed";
        return false;
    }
    return true;
#endif
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
    std::string io_map_path;
    std::string pou_manifest_path;
    std::string library_lock_path;
    std::string signal_manifest_path;
    bool sandbox = false;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--source" && i + 1 < argc) source_path = argv[++i];
        else if (a == "--source-id" && i + 1 < argc) source_id = argv[++i];
        else if (a == "--language" && i + 1 < argc) language = argv[++i];
        else if (a == "--key" && i + 1 < argc) key_path = argv[++i];
        /* ADR-052: provisioning khoá thiết bị. Đứng riêng, không đi cùng đường
         * biên dịch — nó là thao tác một lần của vòng đời bo, không phải một
         * tuỳ chọn của lệnh compile. */
        else if (a == "--gen-device-key" && i + 1 < argc) return generate_device_key(argv[++i]);
        else if (a == "--out" && i + 1 < argc) out_path = argv[++i];
        else if (a == "--manifest-out" && i + 1 < argc) manifest_out_path = argv[++i];
        else if (a == "--io-map-in" && i + 1 < argc) io_map_path = argv[++i];
        else if (a == "--pou-manifest" && i + 1 < argc) pou_manifest_path = argv[++i];
        else if (a == "--library-lock" && i + 1 < argc) library_lock_path = argv[++i];
        else if (a == "--signal-manifest" && i + 1 < argc) signal_manifest_path = argv[++i];
        else if (a == "--sandbox") sandbox = true;
        else if (a == "--version") {
            std::printf("compiler_version=%s profile_id=%s profile_sha256=%s "
                        "artifact_schema=%u target_abi=%u\n",
                        core::st_ir::kCompilerVersion,
                        core::st_profile_generated::kProfileId,
                        core::st_profile_generated::kProfileSha256,
                        core::st_ir::kSchemaVersion, core::st_ir::kTargetAbi);
            return 0;
        }
        else if (a == "--help") {
            std::printf("usage: mkddc-st-compile --source <path> [--language ST|FBD] "
                        "[--source-id <opaque>] [--key <hexfile>] [--gen-device-key <dir>] [--out <artifact>] "
                        "[--manifest-out <json>] [--io-map-in <json>] [--sandbox] "
                        "[--pou-manifest <json>] [--library-lock <json>] "
                        "[--signal-manifest <json>] "
                        "[--version]\n");
            return 0;
        } else {
            return fail("ST-CLI-ARGS", "unknown argument '" + a + "'", 2);
        }
    }
    if (source_path.empty())
        return fail("ST-CLI-ARGS", "usage: mkddc-st-compile --source <path>", 2);
    if (language != "ST" && language != "FBD")
        return fail("ST-CLI-ARGS", "--language must be ST or FBD", 2);
    /* T59-607 — worker sandbox nay ĐƯỢC ký.
     *
     * Ràng buộc cũ "sandbox không nhận khoá" sinh ra ở thời Rev A `HASH_ONLY`,
     * khi ký chỉ là đường tương thích. Với `ADR-052`, artifact do CHÍNH BO biên
     * dịch phải được ký bằng khoá thiết bị — mà đường biên dịch của bo chính là
     * worker sandbox do backend gọi. Giữ ràng buộc cũ nghĩa là không đường nào
     * sinh được artifact hợp lệ.
     *
     * An toàn giữ nguyên nhờ THỨ TỰ: khoá được đọc ở dưới, trước
     * `apply_worker_sandbox()`, nên seccomp vẫn cấm mọi thao tác mở path sau
     * điểm đó. Khoá không bao giờ đi qua stdin/tham số dạng giá trị, chỉ là một
     * đường dẫn file `0600` của chính bo.
     *
     * Fail-closed ở biên: profile đòi chữ ký mà không có khoá thì mọi artifact
     * sinh ra đều bị loader từ chối. Báo tại đây để lỗi chỉ đúng vào cấu hình,
     * thay vì lòi ra ở bước dựng manifest dưới dạng "artifact is not signed". */
    if (core::st_profile_integrity_mode() == core::StIntegrityMode::SIGNATURE_REQUIRED &&
        key_path.empty()) {
        return fail("ST-CLI-KEY-REQUIRED",
                    "profile yeu cau SIGNATURE_REQUIRED: phai truyen --key <hexfile> "
                    "(khoa thiet bi, xem ADR-052)",
                    2);
    }

    /* F-PROG-ASBUILT-013/D-07: đọc io_map TRƯỚC sandbox (nếu bật) vì sandbox
     * cấm mọi open/openat sau điểm này — cùng lý do out/manifest đã mở file
     * trước dòng apply_worker_sandbox() bên dưới. */
    std::vector<core::StIoMapEntry> io_map;
    if (!io_map_path.empty()) {
        std::string io_map_error;
        if (!read_io_map(io_map_path, &io_map, &io_map_error))
            return fail("ST-CLI-IO", io_map_error, 2);
    }

    std::vector<PouManifestEntry> pou_dependencies;
    std::vector<core::StLibraryRequirement> root_library_requirements;
    if (!pou_manifest_path.empty()) {
        std::string manifest_error;
        if (!read_pou_manifest(pou_manifest_path, &pou_dependencies,
                               &root_library_requirements, &manifest_error))
            return fail(manifest_error.rfind("ST-CLI-POU-PATH", 0) == 0
                            ? "ST-CLI-POU-PATH" : "ST-CLI-POU-MANIFEST",
                        manifest_error, 2);
    }
    std::vector<core::StLibraryEntry> library_entries;
    std::string library_system_version;
    std::string library_project_revision;
    if (!library_lock_path.empty()) {
        std::string lock_error;
        if (!read_library_lock(library_lock_path, &library_entries,
                               &library_system_version, &library_project_revision,
                               &lock_error))
            return fail("ST-CLI-LIBRARY-LOCK", lock_error, 2);
    }
    core::StCompileOptions compile_options;
    if (!signal_manifest_path.empty()) {
        std::string signal_error;
        if (!read_signal_manifest(signal_manifest_path, &compile_options, &signal_error))
            return fail("ST-CLI-SIGNAL-MANIFEST", signal_error, 2);
    }

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

    /* Mở duy nhất output do worker chỉ định trước khi seccomp cấm toàn bộ
     * syscall mở path. File dở dang luôn nằm trong scratch riêng và worker xoá. */
    std::ofstream artifact_output;
    std::ofstream manifest_output;
    if (!out_path.empty()) {
        artifact_output.open(out_path, std::ios::binary);
        if (!artifact_output)
            return fail("ST-CLI-IO", "cannot create artifact output", 2);
    }
    if (!manifest_out_path.empty()) {
        manifest_output.open(manifest_out_path, std::ios::binary);
        if (!manifest_output)
            return fail("ST-CLI-IO", "cannot create manifest output", 2);
    }
    if (sandbox) {
        std::string sandbox_error;
        if (!apply_worker_sandbox(&sandbox_error))
            return fail("ST-CLI-SANDBOX", sandbox_error, 2);
    }

    core::StArtifactBuildResult build;
    core::StManifestError build_error;
    std::vector<core::StLinkedPouInfo> linked_pous;
    core::StDiagnosticBag bag;
    g_bag = &bag;
    const bool built = pou_manifest_path.empty() && signal_manifest_path.empty()
                           ? (language == "ST"
                                  ? core::BuildStArtifact(source_id, source, &build,
                                                          &build_error, io_map, &bag)
                                  : core::BuildFbdArtifact(source_id, source, &build,
                                                           &build_error, io_map, &bag))
                           : build_linked_artifact(source_id, language, source,
                                                   pou_dependencies,
                                                   root_library_requirements,
                                                   library_entries,
                                                   io_map, &build, &linked_pous,
                                                   &build_error, compile_options, &bag);
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
        artifact_output.write(reinterpret_cast<const char*>(build.artifact.data()),
                              static_cast<std::streamsize>(build.artifact.size()));
        artifact_output.flush();
        if (!artifact_output) return fail("ST-CLI-IO", "write error on artifact output", 2);
    }
    if (!manifest_out_path.empty()) {
        manifest_output << build.manifest_json << '\n';
        manifest_output.flush();
        if (!manifest_output) return fail("ST-CLI-IO", "write error on manifest output", 2);
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
    nlohmann::json diagnostics = nlohmann::json::array();
    if (g_bag != nullptr && !g_bag->empty()) {
        g_bag->finalize();
        for (const core::StDiagnostic& diagnostic : g_bag->items())
            diagnostics.push_back(diagnostic_json(diagnostic, source_id));
    }
    j["diagnostics"] = diagnostics;
    j["programName"] = build.module.program_name;
    j["sourceId"] = source_id;
    j["language"] = language;
    j["symbols"] = symbols;
    j["linkedPous"] = nlohmann::json::array();
    for (const core::StLinkedPouInfo& linked : linked_pous) {
        static constexpr char kDigits[] = "0123456789abcdef";
        auto hex_digest = [&](const std::array<uint8_t, 32>& digest) {
            std::string text;
            text.reserve(digest.size() * 2);
            for (uint8_t byte : digest) {
                text.push_back(kDigits[byte >> 4]);
                text.push_back(kDigits[byte & 0x0F]);
            }
            return text;
        };
        nlohmann::json input_types = nlohmann::json::array();
        for (core::StType type : linked.input_types)
            input_types.push_back(core::st_type_name(type));
        nlohmann::json output_types = nlohmann::json::array();
        for (core::StType type : linked.output_types)
            output_types.push_back(core::st_type_name(type));
        j["linkedPous"].push_back({{"name", linked.name},
                                    {"kind", core::st_pou_kind_name(linked.kind)},
                                    {"contentSha256", hex_digest(linked.content_sha256)},
                                    {"bodySha256", hex_digest(linked.body_sha256)},
                                    {"instructionCount", linked.instruction_count},
                                    {"fromLibrary", linked.from_library},
                                    {"origin", linked.from_library
                                                   ? nlohmann::json(linked.library_origin)
                                                   : nlohmann::json("PROJECT")},
                                    {"libraryEntryId", linked.library_entry_id.empty()
                                                           ? nlohmann::json(nullptr)
                                                           : nlohmann::json(linked.library_entry_id)},
                                    {"version", linked.version.empty()
                                                    ? nlohmann::json(nullptr)
                                                    : nlohmann::json(linked.version)},
                                    {"inputNames", linked.input_names},
                                    {"inputTypes", std::move(input_types)},
                                    {"outputNames", linked.output_names},
                                    {"outputTypes", std::move(output_types)},
                                    {"hasReturnType", linked.has_return_type},
                                    {"returnType", linked.has_return_type
                                                       ? nlohmann::json(core::st_type_name(
                                                             linked.return_type))
                                                       : nlohmann::json(nullptr)}});
    }
    j["signalRefs"] = nlohmann::json::array();
    for (const core::StIrSignalRef& ref : build.module.signal_refs) {
        j["signalRefs"].push_back({{"name", ref.name},
                                     {"type", core::st_type_name(ref.type)},
                                     {"read", ref.read},
                                     {"publish", ref.publish}});
    }
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
    /* F-PROG-ASBUILT-013/D-07: BE/target evidence xác nhận artifact THẬT SỰ
     * mang binding thay vì chỉ tin request đã gửi --io-map-in — 0 dù đã gửi
     * io_map nghĩa là mọi entry đều rỗng (io_map_path rỗng), không phải lỗi. */
    j["ioBindingCount"] = build.module.io_bindings.size();
    j["hasRetain"] = build.module.has_retain();
    j["compilerVersion"] = core::st_ir::kCompilerVersion;
    j["artifactSchemaVersion"] = core::st_ir::kSchemaVersion;
    j["compilerProfile"] = core::st_ir::kCompilerProfile;
    j["profileId"] = core::st_profile_generated::kProfileId;
    j["profileSha256"] = core::st_profile_generated::kProfileSha256;
    j["libraryVersion"] = core::st_profile_generated::kLibraryVersion;
    /* T59-607 — output mô tả ARTIFACT vừa dựng, nên giá trị ở đây là trạng thái
     * của nó (`SIGNED`/`HASH_ONLY`), không phải tên chính sách của profile
     * (`SIGNATURE_REQUIRED`). Viết cứng `HASH_ONLY` như trước làm một artifact
     * đã ký vẫn tự khai chưa ký. */
    j["integrityMode"] = key_path.empty() ? "HASH_ONLY" : "SIGNED";
    j["signaturePresent"] = !key_path.empty();
    j["targetAbi"] = core::st_ir::kTargetAbi;
    return emit(j, 0);
}
