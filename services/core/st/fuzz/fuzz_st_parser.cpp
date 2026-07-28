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

#include "st/st_limits.hpp"
#include "st/st_parser.hpp"
#include "st/st_program.hpp"
#include "st/st_semantic.hpp"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size)
{
    /* Cắt theo đúng giới hạn hợp đồng: input lớn hơn đã bị caller (CLI/BE)
     * từ chối trước khi tới parser, nên fuzz vùng đó không phản ánh thực tế. */
    if (size > core::st_limits::kMaxSourceBytes) size = core::st_limits::kMaxSourceBytes;

    const std::string source(reinterpret_cast<const char*>(data), size);

    core::StProgram prog;
    core::StDiagnostic diag;
    if (core::parse_st_program(source, &prog, &diag)) {
        /* Parse thành công thì semantic PHẢI chạy được trên AST đó mà không
         * crash — kể cả khi AST đến từ input ngẫu nhiên. */
        core::typecheck_st_program(&prog, &diag);
    } else {
        /* Thất bại thì phải luôn có mã chẩn đoán ổn định. Đây là hợp đồng với
         * BE: không có đường thoát nào trả false mà không nói vì sao. */
        if (diag.code.empty()) __builtin_trap();
    }
    return 0;
}
