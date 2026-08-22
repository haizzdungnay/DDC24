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
#include <cerrno>
#include <fstream>
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

#include <nlohmann/json.hpp>

#include "st/st_control_api.hpp"
#include "st/st_artifact_manifest.hpp"
#include "st/st_io_map.hpp"
#include "st/st_ir.hpp"
#include "st/st_limits.hpp"
#include "st/st_profile_generated.hpp"

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
    bool sandbox = false;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--source" && i + 1 < argc) source_path = argv[++i];
        else if (a == "--source-id" && i + 1 < argc) source_id = argv[++i];
        else if (a == "--language" && i + 1 < argc) language = argv[++i];
        else if (a == "--key" && i + 1 < argc) key_path = argv[++i];
        else if (a == "--out" && i + 1 < argc) out_path = argv[++i];
        else if (a == "--manifest-out" && i + 1 < argc) manifest_out_path = argv[++i];
        else if (a == "--io-map-in" && i + 1 < argc) io_map_path = argv[++i];
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
                        "[--source-id <opaque>] [--key <hexfile>] [--out <artifact>] "
                        "[--manifest-out <json>] [--io-map-in <json>] [--sandbox] "
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
    if (sandbox && !key_path.empty())
        return fail("ST-CLI-SANDBOX", "sandbox worker does not accept signing keys", 2);

    /* F-PROG-ASBUILT-013/D-07: đọc io_map TRƯỚC sandbox (nếu bật) vì sandbox
     * cấm mọi open/openat sau điểm này — cùng lý do out/manifest đã mở file
     * trước dòng apply_worker_sandbox() bên dưới. */
    std::vector<core::StIoMapEntry> io_map;
    if (!io_map_path.empty()) {
        std::string io_map_error;
        if (!read_io_map(io_map_path, &io_map, &io_map_error))
            return fail("ST-CLI-IO", io_map_error, 2);
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
    const bool built = language == "ST"
                           ? core::BuildStArtifact(source_id, source, &build, &build_error, io_map)
                           : core::BuildFbdArtifact(source_id, source, &build, &build_error, io_map);
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
    j["integrityMode"] = "HASH_ONLY";
    j["signaturePresent"] = !key_path.empty();
    j["targetAbi"] = core::st_ir::kTargetAbi;
    return emit(j, 0);
}
