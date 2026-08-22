/**
 * @file  st_package_golden_main.cpp
 * @brief T59-106 — sinh golden package v2 bằng CHÍNH writer production.
 *
 *        Golden phải do một writer thật sinh ra. Viết tay một file rồi gọi nó là
 *        golden chỉ chứng minh rằng ai đó biết định dạng, không chứng minh writer
 *        sinh ra đúng định dạng đó. Công cụ này dùng đúng `WritePackageV2()` mà
 *        sản phẩm dùng, nên golden và writer không thể trôi khỏi nhau.
 *
 *        Nội dung golden cố ý cố định và tự chứa: không đọc file ngoài, không phụ
 *        thuộc đồng hồ hay đường dẫn host, để hash tái lập được ở mọi máy.
 */
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

#include "st/st_package_v2.hpp"
#include "st/st_profile_generated.hpp"

namespace {

std::vector<uint8_t> deterministic_ir(uint8_t seed, std::size_t size)
{
    std::vector<uint8_t> blob(size, 0u);
    for (std::size_t index = 0; index < size; ++index)
        blob[index] = static_cast<uint8_t>((seed + index * 7u) & 0xFFu);
    return blob;
}

core::StPackageInput golden_input()
{
    core::StPackageInput input;
    input.compiler_profile = core::st_profile_generated::kProfileCode;
    input.target_abi = core::st_profile_generated::kTargetAbi;

    /* Hai chu kỳ KHÁC nhau trong cùng một golden: golden mà mọi Program cùng
     * chu kỳ sẽ không phân biệt được "đọc đúng trường" với "đọc trúng may". */
    input.programs.push_back({"AhuMain", deterministic_ir(0x11, 96), 1000u, 12000u});
    input.programs.push_back({"AhuAux", deterministic_ir(0x29, 64), 5000u, 3000u});

    core::StPouSignature main_program;
    main_program.name = "AhuMain";
    main_program.kind = core::StPouKind::PROGRAM;
    input.pou_signatures.push_back(main_program);

    core::StPouSignature aux_program;
    aux_program.name = "AhuAux";
    aux_program.kind = core::StPouKind::PROGRAM;
    input.pou_signatures.push_back(aux_program);

    core::StPouSignature blend;
    blend.name = "Blend";
    blend.kind = core::StPouKind::FUNCTION;
    blend.has_return_type = true;
    blend.return_type = core::StType::REAL;
    blend.input_types = {core::StType::REAL, core::StType::REAL};
    input.pou_signatures.push_back(blend);

    core::StFbInstanceNode timer;
    timer.path = "AhuMain.startDelay";
    timer.owner_program = "AhuMain";
    timer.type_name = "TON";
    timer.state_offset = 0;
    timer.state_size = 10;
    timer.retained = true;
    input.fb_instances.push_back(timer);

    /* Hai signal với hai chính sách stale KHÁC nhau: golden mà mọi signal cùng
     * chính sách không phân biệt được "đọc đúng trường" với "đọc trúng may". */
    core::StPackageSignal setpoint;
    setpoint.name = "SupplySetpoint";
    setpoint.producer_program = "AhuMain";
    setpoint.data_type = 3;
    setpoint.freshness_ms = 5000;
    setpoint.stale_policy = 0; /* HOLD_LAST */
    input.signals.push_back(setpoint);

    core::StPackageSignal reset;
    reset.name = "ResetDemand";
    reset.producer_program = "AhuAux";
    reset.data_type = 3;
    reset.freshness_ms = 30000;
    reset.stale_policy = 1; /* USE_FALLBACK */
    reset.fallback_bits = 0x40A00000ull; /* 5.0f dạng bit */
    reset.has_fallback = true;
    input.signals.push_back(reset);
    input.bindings.push_back({"AhuMain", 1, "AO-1", true});
    input.bindings.push_back({"AhuAux", 1, "AO-2", true});
    input.bindings.push_back({"AhuMain", 1, "AI-1", false});

    input.library_lock.system_version = core::st_profile_generated::kLibraryVersion;
    input.library_lock.system_sha256.fill(0x5A);
    input.library_lock.project_revision_id = "";
    input.retain_bytes = 10;
    return input;
}

} // namespace

int main(int argc, char** argv)
{
    if (argc != 2) {
        std::fprintf(stderr, "dùng: mkddc-st-package-golden <đường-dẫn-ra>\n");
        return 2;
    }
    std::vector<uint8_t> bytes;
    std::string error;
    if (!core::WritePackageV2(golden_input(), &bytes, &error)) {
        std::fprintf(stderr, "không ghi được golden: %s\n", error.c_str());
        return 1;
    }
    /* Đọc lại bằng chính loader trước khi ghi ra đĩa: golden mà loader từ chối là
     * golden vô nghĩa, và phát hiện muộn hơn thì tốn hơn nhiều. */
    core::StPackageView view;
    const char* code = nullptr;
    if (!core::LoadPackageV2(bytes.data(), bytes.size(),
                             core::st_profile_generated::kProfileCode,
                             core::st_profile_generated::kTargetAbi, &view, &code)) {
        std::fprintf(stderr, "loader từ chối golden vừa sinh: %s\n", code ? code : "?");
        return 1;
    }
    std::ofstream output(argv[1], std::ios::binary | std::ios::trunc);
    if (!output) {
        std::fprintf(stderr, "không mở được %s\n", argv[1]);
        return 1;
    }
    output.write(reinterpret_cast<const char*>(bytes.data()),
                 static_cast<std::streamsize>(bytes.size()));
    if (!output) {
        std::fprintf(stderr, "ghi %s thất bại\n", argv[1]);
        return 1;
    }
    std::printf("%zu byte, %zu Program, %zu POU\n", bytes.size(), view.program_names.size(),
                view.pou_names.size());
    return 0;
}
