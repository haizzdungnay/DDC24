/**
 * @file  st_semantic.hpp
 * @brief Phân tích ngữ nghĩa cho AST ST, theo ST_SUBSET_SPEC §3 (hệ kiểu),
 *        §4.2 (bảng kiểu toán tử), §5 (câu lệnh), §6 (thư viện chuẩn).
 *
 *        Nhiệm vụ:
 *        - dựng bảng ký hiệu (biến + instance FB), bắt trùng tên;
 *        - giải quyết literal nguyên ĐA HÌNH theo ngữ cảnh (SPEC §3.4);
 *        - kiểm kiểu chặt, không ép ngầm giữa biến (SPEC §3.3);
 *        - điền `result_type` cho MỌI StExpr — compiler dựa vào đây để chọn
 *          opcode, nên thiếu một node là sinh mã sai;
 *        - kiểm luật riêng của FB: gọi tối đa 1 lần/chu kỳ, tham số đặt tên
 *          hợp lệ, chỉ đọc đầu ra qua truy cập thành viên.
 *
 *        Fail-fast: dừng ở lỗi đầu tiên, trả 1 StDiagnostic có line/column.
 */
#ifndef CORE_ST_SEMANTIC_HPP
#define CORE_ST_SEMANTIC_HPP

#include "st/st_diagnostic.hpp"
#include "st/st_program.hpp"

namespace core {

/* true  = hợp lệ; mọi StExpr::result_type đã điền, mọi literal đa hình đã
 *         được chốt kiểu thật trong StExpr::literal.
 * false = *diag mô tả lỗi đầu tiên. */
bool typecheck_st_program(StProgram* prog, StDiagnostic* diag);

} // namespace core

#endif /* CORE_ST_SEMANTIC_HPP */
