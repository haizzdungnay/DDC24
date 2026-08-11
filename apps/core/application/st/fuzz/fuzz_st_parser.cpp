/**
 * @file  fuzz_st_parser.cpp
 * @brief Fuzz harness cho đường source ST: lexer -> parser -> semantic.
 *
 *        Đây là bề mặt nhận input từ ngoài của FW SOM (BE gửi source lên).
 *        Bất biến kiểm ở đây: với BẤT KỲ chuỗi byte nào, `parse_st_program`
 *        và `typecheck_st_program` phải kết thúc có kiểm soát — không crash,
 *        không tràn stack, không đọc ngoài biên, không treo.
 *
 *        Lỗi F-01 (tràn stack với biểu thức lồng sâu) đúng là loại lỗi mà
 *        harness này sinh ra để bắt.
 */
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_loader.hpp"
#include "st/st_limits.hpp"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size)
{
    const std::string source(reinterpret_cast<const char*>(data), size);

    core::StIrModule module;
    core::StDiagnostic diag;
    if (core::compile_st_source(source, &module, &diag)) {
        std::vector<uint8_t> artifact;
        std::string error;
        if (core::serialize_st_ir(module, &artifact, &error)) {
            core::StLoadedProgram loaded;
            core::StLoaderOptions options;
            core::StLoadError load_error;
            if (!core::load_st_artifact(artifact.data(), artifact.size(), options, &loaded,
                                        &load_error))
                __builtin_trap();
        } else if (error.empty()) {
            __builtin_trap();
        }
    } else {
        /* Thất bại thì phải luôn có mã chẩn đoán ổn định. Đây là hợp đồng với
         * BE: không có đường thoát nào trả false mà không nói vì sao. */
        if (diag.code.empty()) __builtin_trap();
    }
    return 0;
}
