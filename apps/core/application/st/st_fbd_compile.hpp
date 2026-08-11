/**
 * @file st_fbd_compile.hpp
 * @brief Hạ FBD canonical Rev A về chính typed IR đang dùng cho ST.
 *
 * Lowerer này chỉ thuộc st_compiler_lib (non-RT). Nó không tạo VM, opcode hay
 * semantic authority thứ hai: FBD được chuyển thành StProgram đã typed, chạy
 * lại semantic checker chung rồi đi qua compile_st_to_ir().
 */
#ifndef CORE_ST_FBD_COMPILE_HPP
#define CORE_ST_FBD_COMPILE_HPP

#include <string>
#include <string_view>
#include <vector>

#include "st/st_fbd_model.hpp"
#include "st/st_ir.hpp"

namespace core {

constexpr const char* kFbdLowererVersion = "fwsom-fbd-1.0.0";

struct FbdCompileResult {
    bool ok = false;
    StIrModule module;
    std::vector<FbdIssue> issues;
};

// Parse + validate + lower + typecheck + compile. Khi lỗi, module trả về luôn
// rỗng; consumer không được stage partial IR.
FbdCompileResult compile_fbd_source(std::string_view source);

// So sánh phần executable semantic của hai module. Provenance riêng của ngôn
// ngữ nguồn (source_hash và source_map) bị loại có chủ ý trước khi serialize;
// phần còn lại phải byte-identical. `reason` chỉ nhận mã ổn định, không chứa
// source hoặc path host.
bool fbd_ir_semantically_equivalent(const StIrModule& lhs, const StIrModule& rhs,
                                    std::string* reason = nullptr);

// Công khai để test/golden có thể tạo executable artifact canonical. Không dùng
// kết quả đã normalize làm artifact production vì nó bỏ provenance source map.
void normalize_ir_for_semantic_equivalence(StIrModule* module);

} // namespace core

#endif // CORE_ST_FBD_COMPILE_HPP
