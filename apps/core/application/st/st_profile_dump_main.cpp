/**
 * @file  st_profile_dump_main.cpp
 * @brief `ISS-STED-06` — xuất ST Language Profile từ CHÍNH compiler.
 *
 *        Vì sao là một binary chứ không phải script regex quét source: hồ sơ
 *        ngôn ngữ phải là *sự thật đang phát hành*, không phải *thứ đọc được
 *        từ hình dạng văn bản của source*. Bảng cổng FB nằm rải trong nhiều
 *        mảng `FbPort` cục bộ và được ráp lại bởi `fb_spec()`; một regex đọc
 *        các mảng đó sẽ đúng cho tới lần đầu ai đó đổi cách ráp, rồi âm thầm
 *        sinh ra hồ sơ sai mà vẫn xanh. Ở đây ta gọi ĐÚNG những accessor mà
 *        parser và semantic gọi (`st_fb_input_name`, `st_fb_input_type`,
 *        `st_func_arity`, `st_integer_min/max`), nên hồ sơ không thể lệch khỏi
 *        hành vi — nó *là* hành vi.
 *
 *        Đây chính là lỗ hổng đã tạo ra `F-STED-005`: `ST_SUBSET_SPEC` §11 nói
 *        parser phủ 40% grammar và ghim ở một commit từ lâu, trong khi thực tế
 *        khác hẳn. Một bảng đối chiếu sai 100% nguy hiểm hơn không có bảng, vì
 *        nó trông như bằng chứng.
 *
 *        Binary này KHÔNG tự quyết định "cái gì cố ý không có" — phần đó là
 *        phán quyết của con người (ADR-054) và nằm ở tệp curated. Nhiệm vụ ở
 *        đây chỉ là nói thật những gì compiler CHẤP NHẬN; script sinh sẽ đối
 *        chiếu hai phía và làm đỏ khi chúng mâu thuẫn.
 */
#include <cstdio>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_limits.hpp"
#include "st/st_parser.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_program.hpp"

namespace {

/* Kiểu vô hướng + miền giá trị. Miền lấy từ `st_integer_min/max` chứ không
 * chép hằng số: hai nguồn số sẽ trôi khỏi nhau, một nguồn thì không. */
nlohmann::json scalar_types()
{
    static const core::StType kAll[] = {
        core::StType::BOOL, core::StType::INT,  core::StType::DINT,
        core::StType::UINT, core::StType::REAL, core::StType::TIME,
    };
    nlohmann::json types = nlohmann::json::array();
    for (core::StType type : kAll) {
        nlohmann::json entry;
        entry["name"] = core::st_type_name(type);
        entry["wireCode"] = static_cast<int>(type);
        entry["isInteger"] = core::st_type_is_integer(type);
        if (core::st_type_is_integer(type)) {
            entry["isSigned"] = core::st_type_is_signed_integer(type);
            entry["min"] = core::st_integer_min(type);
            entry["max"] = core::st_integer_max(type);
        }
        types.push_back(std::move(entry));
    }
    return types;
}

nlohmann::json storage_classes()
{
    /* Không có accessor tên cho `StStorage`, nên tên hiển thị nằm ở đây; giá
     * trị wire thì lấy từ enum để không chép sai. */
    nlohmann::json list = nlohmann::json::array();
    list.push_back({{"name", "VAR_INPUT"},
                    {"wireCode", static_cast<int>(core::StStorage::VAR_INPUT)}});
    list.push_back({{"name", "VAR_OUTPUT"},
                    {"wireCode", static_cast<int>(core::StStorage::VAR_OUTPUT)}});
    list.push_back({{"name", "VAR"},
                    {"wireCode", static_cast<int>(core::StStorage::VAR_LOCAL)}});
    list.push_back({{"name", "VAR RETAIN"},
                    {"wireCode", static_cast<int>(core::StStorage::VAR_RETAIN)}});
    return list;
}

nlohmann::json pou_kinds()
{
    static const core::StPouKind kAll[] = {
        core::StPouKind::PROGRAM, core::StPouKind::FUNCTION,
        core::StPouKind::FUNCTION_BLOCK,
    };
    nlohmann::json list = nlohmann::json::array();
    for (core::StPouKind kind : kAll)
        list.push_back({{"name", core::st_pou_kind_name(kind)},
                        {"wireCode", static_cast<int>(kind)}});
    return list;
}

/* Hàm chuẩn: tên lấy từ bảng thật qua `st_func_from_name`, arity từ
 * `st_func_arity`. Danh sách tên phải quét được — không có iterator công khai
 * cho `kFuncs[]`, nên ta thử phân giải mọi tên trong bảng từ khoá ứng viên và
 * chỉ giữ tên nào compiler THỰC SỰ nhận. */
nlohmann::json standard_functions(const std::vector<std::string>& candidates)
{
    nlohmann::json list = nlohmann::json::array();
    for (const std::string& name : candidates) {
        core::StFunc func = core::StFunc::ABS;
        if (!core::st_func_from_name(name, &func)) continue;
        list.push_back({{"name", core::st_func_name(func)},
                        {"arity", core::st_func_arity(func)}});
    }
    return list;
}

nlohmann::json standard_function_blocks()
{
    static const core::StFbType kAll[] = {
        core::StFbType::TON, core::StFbType::TOF, core::StFbType::R_TRIG,
        core::StFbType::F_TRIG, core::StFbType::PID, core::StFbType::TP,
        core::StFbType::CTU, core::StFbType::CTD, core::StFbType::HYSTERESIS,
    };
    nlohmann::json list = nlohmann::json::array();
    for (core::StFbType fb : kAll) {
        nlohmann::json entry;
        entry["name"] = core::st_fb_type_name(fb);
        entry["wireCode"] = static_cast<int>(fb);
        nlohmann::json inputs = nlohmann::json::array();
        for (int index = 0; index < core::st_fb_input_count(fb); ++index) {
            const char* port = core::st_fb_input_name(fb, index);
            inputs.push_back({{"name", port ? port : ""},
                              {"type", core::st_type_name(core::st_fb_input_type(fb, index))}});
        }
        nlohmann::json outputs = nlohmann::json::array();
        for (int index = 0; index < core::st_fb_output_count(fb); ++index) {
            const char* port = core::st_fb_output_name(fb, index);
            outputs.push_back({{"name", port ? port : ""},
                               {"type", core::st_type_name(core::st_fb_output_type(fb, index))}});
        }
        entry["inputs"] = std::move(inputs);
        entry["outputs"] = std::move(outputs);
        list.push_back(std::move(entry));
    }
    return list;
}

nlohmann::json limits()
{
    nlohmann::json entry;
    entry["maxSourceBytes"] = core::st_limits::kMaxSourceBytes;
    entry["maxTokens"] = core::st_limits::kMaxTokens;
    entry["maxExpressionDepth"] = core::st_limits::kMaxExprDepth;
    entry["maxStatementDepth"] = core::st_limits::kMaxStmtDepth;
    entry["maxTimeLiteralNs"] = core::st_limits::kMaxTimeLiteralNs;
    entry["maxVariables"] = core::st_limits::kMaxVariables;
    entry["maxStatements"] = core::st_limits::kMaxStatements;
    entry["maxIdentifierLength"] = core::st_limits::kMaxIdentifierLength;
    entry["maxFunctionBlockInstances"] = core::st_limits::kMaxFbInstances;
    entry["maxRetainVariables"] = core::st_limits::kMaxRetainVars;
    entry["maxDiagnostics"] = core::st_limits::kMaxDiagnostics;
    entry["maxPouNameLength"] = core::kMaxPouNameLength;
    return entry;
}

/* Câu lệnh nào compiler CHẤP NHẬN — xác định bằng cách parse thật một mẫu tối
 * thiểu cho mỗi dạng, không bằng cách đọc tên hàm `parse_*`.
 *
 * Đây là điểm cốt lõi của issue: `DDD-LANG-PROG-001` §4.1 từng tuyên bố
 * "parser reject rõ `CASE`" trong khi `parse_case()` chấp nhận đầy đủ. Chỉ có
 * phép thử thật mới phân biệt được "tài liệu nói gì" với "code làm gì". */
nlohmann::json statement_support()
{
    struct Probe { const char* name; const char* body; };
    static const Probe kProbes[] = {
        {"ASSIGN", "  a := 1;\n"},
        {"IF", "  IF a > 0 THEN\n    a := 1;\n  END_IF;\n"},
        {"ELSIF", "  IF a > 0 THEN\n    a := 1;\n  ELSIF a < 0 THEN\n    a := 2;\n  END_IF;\n"},
        {"ELSE", "  IF a > 0 THEN\n    a := 1;\n  ELSE\n    a := 2;\n  END_IF;\n"},
        {"CASE", "  CASE a OF\n  1: a := 1;\n  ELSE\n    a := 2;\n  END_CASE;\n"},
        {"FB_CALL", "  t1(IN := TRUE, PT := T#1s);\n"},
        {"FOR", "  FOR i := 1 TO 3 DO\n    a := 1;\n  END_FOR;\n"},
        {"WHILE", "  WHILE a > 0 DO\n    a := 1;\n  END_WHILE;\n"},
        {"REPEAT", "  REPEAT\n    a := 1;\n  UNTIL a > 0\n  END_REPEAT;\n"},
        {"EXIT", "  EXIT;\n"},
        {"RETURN", "  RETURN;\n"},
    };
    nlohmann::json list = nlohmann::json::array();
    for (const Probe& probe : kProbes) {
        const std::string source = std::string("PROGRAM probe\n") +
                                   "VAR a : DINT; i : DINT; t1 : TON; END_VAR\n" +
                                   probe.body + "END_PROGRAM\n";
        core::StProgram program;
        core::StDiagnostic diagnostic;
        const bool accepted = core::parse_st_program(source, &program, &diagnostic);
        nlohmann::json entry;
        entry["name"] = probe.name;
        entry["accepted"] = accepted;
        if (!accepted) entry["rejectedWith"] = diagnostic.code;
        list.push_back(std::move(entry));
    }
    return list;
}

/* Toán tử — cũng xác định bằng phép thử thật, cùng lý do như câu lệnh. */
nlohmann::json operator_support()
{
    struct Probe { const char* name; const char* expr; const char* decl; };
    static const Probe kProbes[] = {
        {"+", "a + a", "a"},      {"-", "a - a", "a"},
        {"*", "a * a", "a"},      {"/", "a / a", "a"},
        {"<", "b1 := a < a", nullptr},  {"<=", "b1 := a <= a", nullptr},
        {">", "b1 := a > a", nullptr},  {">=", "b1 := a >= a", nullptr},
        {"=", "b1 := a = a", nullptr},  {"<>", "b1 := a <> a", nullptr},
        {"AND", "b1 := b1 AND b1", nullptr}, {"OR", "b1 := b1 OR b1", nullptr},
        {"XOR", "b1 := b1 XOR b1", nullptr}, {"NOT", "b1 := NOT b1", nullptr},
        {"MOD", "a := a MOD a", nullptr},
        {"**", "a := a ** a", nullptr},
    };
    nlohmann::json list = nlohmann::json::array();
    for (const Probe& probe : kProbes) {
        const std::string statement =
            probe.decl != nullptr ? std::string("  a := ") + probe.expr + ";\n"
                                  : std::string("  ") + probe.expr + ";\n";
        const std::string source = std::string("PROGRAM probe\n") +
                                   "VAR a : DINT; b1 : BOOL; END_VAR\n" +
                                   statement + "END_PROGRAM\n";
        core::StProgram program;
        core::StDiagnostic diagnostic;
        const bool accepted = core::parse_st_program(source, &program, &diagnostic);
        nlohmann::json entry;
        entry["symbol"] = probe.name;
        entry["accepted"] = accepted;
        if (!accepted) entry["rejectedWith"] = diagnostic.code;
        list.push_back(std::move(entry));
    }
    return list;
}

} // namespace

int main(int argc, char** argv)
{
    /* Danh sách tên ứng viên do caller truyền (script sinh đọc từ bảng
     * `kFuncs[]`), rồi lọc lại bằng `st_func_from_name` ở đây. Hai chiều cùng
     * kiểm: tên script đọc được mà compiler không nhận thì bị loại; tên
     * compiler nhận mà script không đưa vào thì `--check` sẽ thấy thiếu. */
    std::vector<std::string> candidates;
    for (int index = 1; index < argc; ++index) candidates.emplace_back(argv[index]);

    nlohmann::json profile;
    profile["compilerVersion"] = core::st_ir::kCompilerVersion;
    profile["targetProfileId"] = core::st_profile_generated::kProfileId;
    profile["targetAbi"] = core::st_profile_generated::kTargetAbi;
    profile["scalarTypes"] = scalar_types();
    profile["storageClasses"] = storage_classes();
    profile["pouKinds"] = pou_kinds();
    profile["statements"] = statement_support();
    profile["operators"] = operator_support();
    profile["standardFunctions"] = standard_functions(candidates);
    profile["standardFunctionBlocks"] = standard_function_blocks();
    profile["limits"] = limits();

    std::fputs(profile.dump(2).c_str(), stdout);
    std::fputc('\n', stdout);
    return 0;
}
