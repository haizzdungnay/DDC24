/**
 * @file  st_package_main.cpp
 * @brief T59-302/T59-305 — lắp package v2 từ các artifact `.mkir` đã biên dịch.
 *
 *        Vì sao là CLI chứ không phải cài lại writer bằng Go: `WritePackageV2()`
 *        đã là writer production và đã có golden + fuzz canh nó. Viết bản thứ hai
 *        ở BE nghĩa là hai bộ ngữ nghĩa cho cùng một định dạng, và bản thứ hai
 *        luôn là bản quên cập nhật.
 *
 *        Công cụ KHÔNG biên dịch lại gì cả: nó nhận đúng các blob IR v1 mà Check
 *        vừa tạo và bọc chúng vào container. Trộn thêm một bước biên dịch ở đây
 *        sẽ làm hash package không còn suy được từ hash các artifact thành phần.
 */
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include <sodium.h>

#include "st/st_artifact.hpp"
#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"

namespace {

int fail(const char* code, const std::string& message)
{
    std::fprintf(stderr, "{\"ok\":false,\"code\":\"%s\",\"message\":\"%s\"}\n", code, message.c_str());
    return 1;
}

bool read_file(const std::string& path, std::vector<uint8_t>* out)
{
    std::ifstream input(path, std::ios::binary);
    if (!input) return false;
    input.seekg(0, std::ios::end);
    const std::streamoff size = input.tellg();
    if (size < 0 || size > static_cast<std::streamoff>(core::st_pkg::kMaxArtifactBytes)) return false;
    input.seekg(0, std::ios::beg);
    out->resize(static_cast<std::size_t>(size));
    if (size > 0) input.read(reinterpret_cast<char*>(out->data()), size);
    return static_cast<bool>(input);
}

/* Khai báo signal đi bằng FILE JSON chứ không bằng cờ `name=value`: tên signal
 * là chuỗi người dùng đặt, nên mọi dấu phân cách ta chọn đều có thể xuất hiện
 * trong chính dữ liệu. Một định dạng có escape sẵn thì không có lớp lỗi đó. */
bool read_signals(const std::string& path, std::vector<core::StPackageSignal>* out,
                  std::string* error)
{
    std::ifstream input(path);
    if (!input) {
        *error = "khong doc duoc " + path;
        return false;
    }
    nlohmann::json document = nlohmann::json::parse(input, nullptr, false);
    if (document.is_discarded() || !document.is_array()) {
        *error = "signals phai la mang JSON";
        return false;
    }
    for (const nlohmann::json& item : document) {
        if (!item.is_object()) {
            *error = "moi signal phai la object";
            return false;
        }
        core::StPackageSignal signal;
        signal.name = item.value("name", std::string());
        signal.producer_program = item.value("publisher", std::string());
        signal.data_type = static_cast<uint8_t>(item.value("type", 0));
        signal.freshness_ms = item.value("freshnessMs", 0u);
        signal.stale_policy = static_cast<uint8_t>(item.value("stalePolicy", 0));
        if (item.contains("fallbackBits") && !item.at("fallbackBits").is_null()) {
            signal.fallback_bits = item.at("fallbackBits").get<uint64_t>();
            signal.has_fallback = true;
        }
        if (signal.name.empty() || signal.producer_program.empty()) {
            *error = "signal thieu name hoac publisher";
            return false;
        }
        out->push_back(std::move(signal));
    }
    return true;
}

bool parse_type(const std::string& name, core::StType* out)
{
    if (name == "BOOL") { *out = core::StType::BOOL; return true; }
    if (name == "INT") { *out = core::StType::INT; return true; }
    if (name == "DINT") { *out = core::StType::DINT; return true; }
    if (name == "UINT") { *out = core::StType::UINT; return true; }
    if (name == "REAL") { *out = core::StType::REAL; return true; }
    if (name == "TIME") { *out = core::StType::TIME; return true; }
    return false;
}

bool decode_sha256(const std::string& text, std::array<uint8_t, 32>* out)
{
    if (text.size() != 64) return false;
    auto nibble = [](char ch) -> int {
        if (ch >= '0' && ch <= '9') return ch - '0';
        if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
        if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
        return -1;
    };
    for (std::size_t index = 0; index < out->size(); ++index) {
        const int high = nibble(text[index * 2]);
        const int low = nibble(text[index * 2 + 1]);
        if (high < 0 || low < 0) return false;
        (*out)[index] = static_cast<uint8_t>((high << 4) | low);
    }
    return true;
}

bool read_pou_table(const std::string& path, std::vector<core::StPouSignature>* out,
                    std::string* error)
{
    std::ifstream input(path);
    if (!input) { *error = "khong doc duoc " + path; return false; }
    const nlohmann::json document = nlohmann::json::parse(input, nullptr, false);
    if (document.is_discarded() || !document.is_object() ||
        document.value("schemaVersion", 0) != 1 ||
        !document.contains("pous") || !document.at("pous").is_array()) {
        *error = "pou-table phai la schemaVersion=1 voi mang pous";
        return false;
    }
    if (document.at("pous").size() > core::st_profile_generated::kMaxObjects) {
        *error = "pou-table vuot tran POU cua profile";
        return false;
    }
    out->clear();
    try {
        for (const nlohmann::json& item : document.at("pous")) {
            core::StPouSignature signature;
            signature.name = item.at("name").get<std::string>();
            const std::string kind = item.at("kind").get<std::string>();
            if (kind == "FUNCTION") signature.kind = core::StPouKind::FUNCTION;
            else if (kind == "FUNCTION_BLOCK")
                signature.kind = core::StPouKind::FUNCTION_BLOCK;
            else { *error = "pou-table chi nhan FUNCTION/FUNCTION_BLOCK"; return false; }
            signature.from_library = item.value("fromLibrary", false);
            signature.library_origin = item.value("origin", std::string("PROJECT"));
            if (item.contains("libraryEntryId") && !item.at("libraryEntryId").is_null())
                signature.library_entry_id = item.at("libraryEntryId").get<std::string>();
            if (item.contains("version") && !item.at("version").is_null())
                signature.version = item.at("version").get<std::string>();
            if (signature.from_library &&
                (signature.library_entry_id.empty() || signature.version.empty() ||
                 (signature.library_origin != "PROJECT" &&
                  signature.library_origin != "SYSTEM"))) {
                *error = "POU library can libraryEntryId/version/origin hop le";
                return false;
            }
            if (!signature.from_library && signature.library_origin != "PROJECT") {
                *error = "POU local phai co origin PROJECT";
                return false;
            }
            signature.has_return_type = item.value("hasReturnType", false);
            if (signature.has_return_type) {
                const std::string type = item.at("returnType").get<std::string>();
                if (!parse_type(type, &signature.return_type)) {
                    *error = "returnType POU khong hop le";
                    return false;
                }
            }
            signature.input_names = item.value("inputNames", std::vector<std::string>{});
            signature.output_names = item.value("outputNames", std::vector<std::string>{});
            if (signature.input_names.size() >
                    core::st_profile_generated::kMaxVariables ||
                signature.output_names.size() >
                    core::st_profile_generated::kMaxVariables) {
                *error = "chu ky POU vuot tran cong cua profile";
                return false;
            }
            for (const std::string& type :
                 item.value("inputTypes", std::vector<std::string>{})) {
                core::StType parsed;
                if (!parse_type(type, &parsed)) { *error = "inputType POU khong hop le"; return false; }
                signature.input_types.push_back(parsed);
            }
            for (const std::string& type :
                 item.value("outputTypes", std::vector<std::string>{})) {
                core::StType parsed;
                if (!parse_type(type, &parsed)) { *error = "outputType POU khong hop le"; return false; }
                signature.output_types.push_back(parsed);
            }
            if (!decode_sha256(item.at("bodySha256").get<std::string>(),
                               &signature.body_sha256)) {
                *error = "bodySha256 POU khong hop le";
                return false;
            }
            signature.instruction_count = item.at("instructionCount").get<uint32_t>();
            signature.has_linked_body = true;
            out->push_back(std::move(signature));
        }
    } catch (const std::exception& exception) {
        *error = std::string("pou-table thieu/sai field: ") + exception.what();
        return false;
    }
    return true;
}

bool read_package_library_lock(const std::string& path,
                               core::StPackageLibraryLock* out,
                               std::string* error)
{
    std::ifstream input(path);
    if (!input) { *error = "khong doc duoc " + path; return false; }
    const nlohmann::json document = nlohmann::json::parse(input, nullptr, false);
    if (document.is_discarded() || !document.is_object() ||
        document.value("schemaVersion", 0) != 1) {
        *error = "library-lock phai co schemaVersion=1";
        return false;
    }
    try {
        out->system_version = document.at("systemVersion").get<std::string>();
        out->project_revision_id = document.at("projectRevisionId").get<std::string>();
    } catch (const std::exception& exception) {
        *error = std::string("library-lock thieu/sai field: ") + exception.what();
        return false;
    }
    const std::string canonical = document.dump();
    crypto_hash_sha256(out->system_sha256.data(),
                       reinterpret_cast<const unsigned char*>(canonical.data()),
                       canonical.size());
    return !out->system_version.empty();
}

} // namespace

int main(int argc, char** argv)
{
    std::string out_path;
    std::vector<core::StPackageProgram> programs;
    std::vector<core::StPackageSignal> signals;
    std::vector<core::StPouSignature> linked_pous;
    core::StPackageLibraryLock library_lock;

    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--out" && index + 1 < argc) {
            out_path = argv[++index];
        } else if (argument == "--program" && index + 1 < argc) {
            /* Dạng `<TÊN>=<đường dẫn .mkir>`. Tên Program là identity trong
             * package; đường dẫn chỉ là nơi lấy blob. */
            const std::string spec = argv[++index];
            const std::size_t separator = spec.find('=');
            if (separator == std::string::npos || separator == 0 || separator + 1 >= spec.size())
                return fail("ST-CLI-ARGS", "--program can dang <name>=<path>");
            core::StPackageProgram program;
            program.program_name = spec.substr(0, separator);
            if (!read_file(spec.substr(separator + 1), &program.ir_blob))
                return fail("ST-CLI-IO", "khong doc duoc IR: " + spec.substr(separator + 1));
            if (program.ir_blob.empty())
                return fail("ST-CLI-IO", "IR rong: " + program.program_name);
            programs.push_back(std::move(program));
        } else if ((argument == "--period" || argument == "--budget") && index + 1 < argc) {
            /* Chu kỳ và ngân sách đi bằng cờ RIÊNG, không nhồi thêm dấu phân cách
             * vào `--program`: đường dẫn file có thể chứa gần như mọi ký tự, nên
             * mọi dấu phân cách thứ hai đều là một cách phân tích sai chờ xảy ra. */
            const bool is_period = argument == "--period";
            const std::string spec = argv[++index];
            const std::size_t separator = spec.find('=');
            if (separator == std::string::npos || separator == 0 || separator + 1 >= spec.size())
                return fail("ST-CLI-ARGS", argument + " can dang <name>=<so>");
            const std::string name = spec.substr(0, separator);
            const std::string value_text = spec.substr(separator + 1);
            if (value_text.find_first_not_of("0123456789") != std::string::npos ||
                value_text.size() > 9)
                return fail("ST-CLI-ARGS", argument + " can gia tri nguyen khong dau");
            const auto target = std::find_if(
                programs.begin(), programs.end(),
                [&name](const core::StPackageProgram& p) { return p.program_name == name; });
            if (target == programs.end())
                return fail("ST-CLI-ARGS", argument + " tro toi Program chua khai: " + name);
            const uint32_t value = static_cast<uint32_t>(std::strtoul(value_text.c_str(), nullptr, 10));
            if (is_period)
                target->period_ms = value;
            else
                target->budget_us = value;
        } else if (argument == "--signals" && index + 1 < argc) {
            std::string signal_error;
            if (!read_signals(argv[++index], &signals, &signal_error))
                return fail("ST-CLI-IO", signal_error);
        } else if (argument == "--pou-table" && index + 1 < argc) {
            std::string pou_error;
            if (!read_pou_table(argv[++index], &linked_pous, &pou_error))
                return fail("ST-CLI-POU-TABLE", pou_error);
        } else if (argument == "--library-lock" && index + 1 < argc) {
            std::string lock_error;
            if (!read_package_library_lock(argv[++index], &library_lock, &lock_error))
                return fail("ST-CLI-LIBRARY-LOCK", lock_error);
        } else if (argument == "--version") {
            std::printf("packager_version=2 profile_id=%s profile_sha256=%s "
                        "artifact_schema=%u target_abi=%u\n",
                        core::st_profile_generated::kProfileId,
                        core::st_profile_generated::kProfileSha256,
                        static_cast<unsigned>(core::st_pkg::kSchemaVersion),
                        static_cast<unsigned>(core::st_profile_generated::kTargetAbi));
            return 0;
        } else {
            return fail("ST-CLI-ARGS", "tham so khong hop le: " + argument);
        }
    }
    if (out_path.empty() || programs.empty())
        return fail("ST-CLI-ARGS", "can --out va it nhat mot --program");

    core::StPackageInput input;
    input.compiler_profile = core::st_profile_generated::kProfileCode;
    input.target_abi = core::st_profile_generated::kTargetAbi;
    input.programs = programs;
    input.signals = signals;
    input.library_lock = library_lock;
    /* Mỗi Program là một POU kind PROGRAM. Bảng signature đầy đủ (FUNCTION/FB,
     * cổng, kiểu) đến cùng `T59-305`; khai thiếu ở đây tốt hơn khai bừa, vì
     * loader kiểm bảng này và một bản khai sai sẽ được nạp như thật. */
    for (const core::StPackageProgram& program : input.programs) {
        core::StPouSignature signature;
        signature.name = program.program_name;
        signature.kind = core::StPouKind::PROGRAM;
        input.pou_signatures.push_back(signature);
    }
    input.pou_signatures.insert(input.pou_signatures.end(), linked_pous.begin(),
                                linked_pous.end());

    std::vector<uint8_t> package;
    std::string error;
    if (!core::WritePackageV2(input, &package, &error))
        return fail("ST-CLI-LIMIT", error);

    /* Đọc lại bằng CHÍNH loader trước khi ghi ra đĩa: một package mà loader từ
     * chối là một package vô nghĩa, và phát hiện muộn hơn thì tốn hơn nhiều. */
    core::StPackageView view;
    const char* load_error = nullptr;
    if (!core::LoadPackageV2(package.data(), package.size(), input.compiler_profile, input.target_abi,
                             &view, &load_error))
        return fail(load_error != nullptr ? load_error : "PKG-E-001", "loader tu choi package vua ghi");

    std::ofstream output(out_path, std::ios::binary | std::ios::trunc);
    if (!output) return fail("ST-CLI-IO", "khong ghi duoc: " + out_path);
    output.write(reinterpret_cast<const char*>(package.data()), static_cast<std::streamsize>(package.size()));
    if (!output) return fail("ST-CLI-IO", "ghi package that bai");
    output.close();

    std::printf("{\"ok\":true,\"bytes\":%zu,\"programCount\":%zu,\"schemaVersion\":%u,\"targetAbi\":%u,\"sha256\":\"%s\"}\n",
                package.size(), view.program_names.size(),
                static_cast<unsigned>(view.header.schema_version),
                static_cast<unsigned>(view.header.target_abi),
                core::compute_file_sha256(package.data(), package.size()).c_str());
    return 0;
}
