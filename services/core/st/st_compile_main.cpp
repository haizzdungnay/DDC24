/**
 * @file  st_compile_main.cpp
 * @brief `mkddc-st-compile` — CLI compile ST source thành artifact đã ký.
 *
 *        Đây là công cụ CHÍNH THỨC để BE sinh artifact. Cùng contract với
 *        `mkddc-st-validate`: argv cố định, source luôn qua file path (không
 *        bao giờ nằm trong argv), đúng một dòng JSON ra stdout với shape ổn
 *        định dù thành công hay thất bại.
 *
 *        Exit code: 0 = compile thành công; 1 = lỗi ST thật (syntax/semantic/
 *        vượt giới hạn); 2 = lỗi usage/IO phía CLI.
 *
 *        Khoá ký: mặc định dùng khoá TEST cam kết trong repo (đủ cho CI và
 *        phát triển). Release truyền `--key <file>` chứa 64 byte khoá riêng
 *        Ed25519 dạng hex — khoá riêng KHÔNG BAO GIỜ nằm trên thiết bị.
 */
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_compile.hpp"
#include "st/st_control_api.hpp"
#include "st/st_ir.hpp"
#include "st/st_limits.hpp"
#include "st/st_test_key.hpp"

namespace {

nlohmann::json diagnostic_to_json(const core::StDiagnostic& d)
{
    return {
        {"severity", d.severity == core::StSeverity::ERROR ? "error" : "warning"},
        {"code", d.code},
        {"message", d.message},
        {"line", d.line},
        {"column", d.column},
        {"length", d.length},
    };
}

int emit(const nlohmann::json& j, int code)
{
    std::fputs(j.dump().c_str(), stdout);
    std::fputc('\n', stdout);
    return code;
}

int fail(const char* code, const std::string& message, int exit_code)
{
    nlohmann::json j;
    j["ok"] = false;
    j["diagnostics"] = nlohmann::json::array({
        nlohmann::json{{"severity", "error"}, {"code", code}, {"message", message},
                       {"line", 0}, {"column", 0}, {"length", 1}}});
    j["artifact"] = nullptr;
    j["artifactSha256"] = nullptr;
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
    std::string key_path;
    std::string out_path;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--source" && i + 1 < argc) source_path = argv[++i];
        else if (a == "--key" && i + 1 < argc) key_path = argv[++i];
        else if (a == "--out" && i + 1 < argc) out_path = argv[++i];
        else if (a == "--help") {
            std::printf("usage: mkddc-st-compile --source <path> [--key <hexfile>] "
                        "[--out <artifact>]\n");
            return 0;
        } else {
            return fail("ST-CLI-ARGS", "unknown argument '" + a + "'", 2);
        }
    }
    if (source_path.empty())
        return fail("ST-CLI-ARGS", "usage: mkddc-st-compile --source <path>", 2);

    std::string source;
    if (!read_file(source_path, &source, core::st_limits::kMaxSourceBytes))
        return fail("ST-CLI-IO", "cannot read source or source exceeds size limit", 2);

    uint8_t secret[64];
    std::memcpy(secret, core::st_test_secret_key(), 64);
    if (!key_path.empty()) {
        std::string key_text;
        if (!read_file(key_path, &key_text, 4096))
            return fail("ST-CLI-IO", "cannot read key file", 2);
        if (!parse_secret_key(key_text, secret))
            return fail("ST-CLI-KEY", "key file must contain 128 hex characters (64 bytes)", 2);
    }

    core::StIrModule mod;
    core::StDiagnostic diag;
    if (!core::compile_st_source(source, &mod, &diag)) {
        nlohmann::json j;
        j["ok"] = false;
        j["diagnostics"] = nlohmann::json::array({diagnostic_to_json(diag)});
        j["artifact"] = nullptr;
        j["artifactSha256"] = nullptr;
        j["compilerVersion"] = core::st_ir::kCompilerVersion;
        j["artifactSchemaVersion"] = core::st_ir::kSchemaVersion;
        j["targetAbi"] = core::st_ir::kTargetAbi;
        return emit(j, 1);
    }

    std::vector<uint8_t> bytes;
    std::string err;
    if (!core::serialize_st_ir(mod, &bytes, &err))
        return fail("ST-CLI-LIMIT", err, 1);
    if (!core::sign_st_artifact(&bytes, secret))
        return fail("ST-CLI-KEY", "failed to sign artifact", 2);

    if (!out_path.empty()) {
        std::ofstream f(out_path, std::ios::binary);
        if (!f) return fail("ST-CLI-IO", "cannot write artifact to '" + out_path + "'", 2);
        f.write(reinterpret_cast<const char*>(bytes.data()),
                static_cast<std::streamsize>(bytes.size()));
        if (!f) return fail("ST-CLI-IO", "write error on '" + out_path + "'", 2);
    }

    uint8_t digest[32] = {0};
    core::compute_artifact_sha256(bytes.data(), bytes.size(), digest);

    nlohmann::json symbols = nlohmann::json::array();
    for (const core::StIrVariable& v : mod.variables) {
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
    j["programName"] = mod.program_name;
    j["symbols"] = symbols;
    /* Artifact trả kèm dạng base64 để BE dùng thẳng cho `program_stage` mà
     * không cần đọc lại file — bớt một bước là bớt một chỗ sai. */
    j["artifact"] = core::st_base64_encode(bytes.data(), bytes.size());
    j["artifactBytes"] = bytes.size();
    j["artifactSha256"] = core::st_base64_encode(digest, 32);
    j["instructionCount"] = mod.code.size();
    j["slotCount"] = mod.slot_count;
    j["hasRetain"] = mod.has_retain();
    j["compilerVersion"] = core::st_ir::kCompilerVersion;
    j["artifactSchemaVersion"] = core::st_ir::kSchemaVersion;
    j["compilerProfile"] = core::st_ir::kCompilerProfile;
    j["targetAbi"] = core::st_ir::kTargetAbi;
    return emit(j, 0);
}
