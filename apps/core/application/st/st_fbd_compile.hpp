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

/* Neo vị trí FBD deterministic. `line/column` là khóa compact được ghi trong
 * MKDDCIR1 DEBUG_SOURCEMAP; manifest provenance ánh xạ khóa này về UUID gốc.
 * Đây không phải tọa độ canvas và không phụ thuộc whitespace/thứ tự key JSON. */
struct FbdSourceAnchor {
    uint16_t line = 0;
    uint16_t column = 0;
    std::string network_id;
    std::string node_id;
    std::string port_id;
    std::string unit;
    bool has_unit = false;
};

struct FbdCompileResult {
    bool ok = false;
    StIrModule module;
    std::string canonical_source;
    std::vector<FbdSourceAnchor> source_anchors;
    std::vector<FbdIssue> issues;
};

// Parse + validate + lower + typecheck + compile. Khi lỗi, module trả về luôn
// rỗng; consumer không được stage partial IR.
FbdCompileResult compile_fbd_source(std::string_view source);

// T59-105: chỉ parse + validate + lower, DỪNG trước typecheck và codegen.
//
// Vì sao cần đường riêng: node FBD gọi POU người dùng lower thành `USER_CALL` —
// đúng cùng nút AST mà ST sinh ra — nhưng codegen chưa liên kết được lời gọi đó
// (T59-106 mới làm). Trả `StProgram` ở đây cho phép CHỨNG MINH hai ngôn ngữ dùng
// chung một typed IR mà không phải giả vờ rằng codegen đã chạy được.
struct FbdLowerResult {
    bool ok = false;
    StProgram program;
    std::vector<FbdIssue> issues;
};

FbdLowerResult lower_fbd_source_to_program(std::string_view source);

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
