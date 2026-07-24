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
#include "st/st_parser.hpp"
#include "st/st_semantic.hpp"
#include "st/st_stdlib.hpp"

namespace {

/* Cùng convention 64 KiB đã dùng cho bounded read khác trong core (xem
 * web_ipc.cpp max_read_bytes) — chương trình ST tối thiểu không cần lớn hơn. */
constexpr std::size_t kMaxSourceBytes = 64u * 1024u;

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
        for (const core::StVarDecl& v : prog->inputs)
            symbols.push_back({{"name", v.name}, {"direction", "input"},
                               {"type", v.type == core::StType::REAL ? "REAL" : "BOOL"}});
        for (const core::StVarDecl& v : prog->outputs)
            symbols.push_back({{"name", v.name}, {"direction", "output"},
                               {"type", v.type == core::StType::REAL ? "REAL" : "BOOL"}});
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
