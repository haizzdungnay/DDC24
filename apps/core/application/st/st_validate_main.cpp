/**
 * @file  st_validate_main.cpp
 * @brief FW SOM IEC programming foundation: validate gateway CLI (item 2).
 *        Fixed executable + fixed argv (`mkddc-st-validate --source <path>`),
 *        KHÔNG shell-eval source text — source luôn đọc từ file path, không
 *        bao giờ nằm trong argv. BE gọi qua execve() với argv cố định (bind
 *        đúng path làm tham số) + set timeout riêng phía BE (CLI không tự
 *        chờ vô hạn — input đọc có giới hạn, không block trên network/stdin).
 *
 *        Output: 1 dòng JSON DUY NHẤT ra stdout, luôn có shape ổn định dù
 *        ok=true/false (kể cả lỗi usage/IO) — BE parse JSON, không parse
 *        text log. Log chẩn đoán phụ (nếu có) ra stderr, không lẫn vào stdout.
 *
 *        Exit code: 0 = ok=true (source hợp lệ); 1 = ok=false vì lỗi ST thật
 *        (syntax/semantic — CLI chạy đúng, chỉ là source sai); 2 = lỗi
 *        usage/IO phía CLI (thiếu argv, không đọc được file, file quá lớn).
 */
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>

#include "st/st_artifact.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_limits.hpp"
#include "st/st_parser.hpp"
#include "st/st_semantic.hpp"

namespace {

/* MỘT nguồn sự thật: giới hạn source lấy từ st_limits.hpp, không hard-code
 * lại ở đây. CLI kiểm trước khi parse để trả exit 2 (lỗi phía caller/IO);
 * parser cũng tự kiểm và trả ST-LIM-001 (exit 1) cho caller không qua CLI. */
constexpr std::size_t kMaxSourceBytes = core::st_limits::kMaxSourceBytes;

nlohmann::json diagnostic_to_json(const core::StDiagnostic& d)
{
    return {
        {"severity", d.severity == core::StSeverity::ERROR ? "error" : "warning"},
        {"code", d.code},
        {"message", d.message},
        {"sourceId", d.source_id},
        {"line", d.line},
        {"column", d.column},
        {"length", d.length},
    };
}

nlohmann::json make_result(bool ok, const std::vector<core::StDiagnostic>& diags,
                           const core::StProgram* prog, const std::string& artifact_hash)
{
    nlohmann::json diagnostics = nlohmann::json::array();
    for (const core::StDiagnostic& d : diags) diagnostics.push_back(diagnostic_to_json(d));

    nlohmann::json symbols = nlohmann::json::array();
    if (prog) {
        /* Chỉ công bố VAR_INPUT/VAR_OUTPUT — đó là bề mặt BE cần để bind
         * io_map. VAR/VAR RETAIN là trạng thái nội bộ, không phải giao diện. */
        for (const core::StVarDecl& v : prog->vars) {
            const char* dir = nullptr;
            if (v.storage == core::StStorage::VAR_INPUT) dir = "input";
            else if (v.storage == core::StStorage::VAR_OUTPUT) dir = "output";
            if (!dir) continue;
            symbols.push_back({{"name", v.name}, {"direction", dir},
                               {"type", core::st_type_name(v.type)}});
        }
    }

    return {
        {"ok", ok},
        {"diagnostics", diagnostics},
        {"symbols", symbols},
        {"artifactHash", artifact_hash},
        {"compilerVersion", core::kStCompilerVersion},
        {"irSchemaVersion", core::kStIrSchemaVersion},
    };
}

int emit_and_exit(const nlohmann::json& result, int exit_code)
{
    /* dump(-1): compact, deterministic key order (nlohmann::json giữ thứ tự
     * insertion mặc định — không cần sort thêm vì BE parse theo key, không
     * theo vị trí text). 1 dòng duy nhất ra stdout. */
    std::fputs(result.dump().c_str(), stdout);
    std::fputc('\n', stdout);
    return exit_code;
}

int usage_error(const char* code, const std::string& message)
{
    core::StDiagnostic d;
    d.severity = core::StSeverity::ERROR;
    d.code = code;
    d.message = message;
    return emit_and_exit(make_result(false, {d}, nullptr, ""), 2);
}

} // namespace

int main(int argc, char** argv)
{
    if (argc != 3 || std::string(argv[1]) != "--source")
        return usage_error("ST-CLI-ARGS", "usage: mkddc-st-validate --source <path>");

    const std::string path = argv[2];
    std::ifstream file(path, std::ios::binary);
    if (!file)
        return usage_error("ST-CLI-IO", "cannot open source file '" + path + "'");

    std::ostringstream buf;
    buf << file.rdbuf();
    if (file.bad())
        return usage_error("ST-CLI-IO", "read error on source file '" + path + "'");
    const std::string source = buf.str();
    if (source.size() > kMaxSourceBytes)
        return usage_error("ST-CLI-TOOLARGE",
                           "source exceeds " + std::to_string(kMaxSourceBytes) + " bytes");

    const std::string artifact_hash = core::compute_artifact_hash(source);

    core::StProgram program;
    core::StDiagnostic diag;
    if (!core::parse_st_program(source, &program, &diag))
        return emit_and_exit(make_result(false, {diag}, nullptr, artifact_hash), 1);

    if (!core::typecheck_st_program(&program, &diag))
        return emit_and_exit(make_result(false, {diag}, &program, artifact_hash), 1);

    return emit_and_exit(make_result(true, {}, &program, artifact_hash), 0);
}
