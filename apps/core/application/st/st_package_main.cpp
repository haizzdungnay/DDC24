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
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

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

} // namespace

int main(int argc, char** argv)
{
    std::string out_path;
    std::vector<core::StPackageProgram> programs;

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
        } else if (argument == "--version") {
            std::printf("mkddc-st-package %s\n", core::st_profile_generated::kProfileId);
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
    /* Mỗi Program là một POU kind PROGRAM. Bảng signature đầy đủ (FUNCTION/FB,
     * cổng, kiểu) đến cùng `T59-305`; khai thiếu ở đây tốt hơn khai bừa, vì
     * loader kiểm bảng này và một bản khai sai sẽ được nạp như thật. */
    for (const core::StPackageProgram& program : input.programs) {
        core::StPouSignature signature;
        signature.name = program.program_name;
        signature.kind = core::StPouKind::PROGRAM;
        input.pou_signatures.push_back(signature);
    }

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
