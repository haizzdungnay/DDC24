/**
 * @file  st_semantic.hpp
 * @brief FW SOM IEC programming foundation: type/binding check tối thiểu cho
 *        StProgram AST. Reject: unbound variable, type mismatch (assign/so
 *        sánh/boolean/call), ghi vào VAR_INPUT (input là read-only theo ngữ
 *        nghĩa IEC), gọi function không có trong registry, sai số lượng
 *        tham số. Điền result_type cho mọi StExpr khi pass. Lỗi trả về
 *        StDiagnostic có line/column (ST-SEM-*).
 */
#ifndef CORE_ST_SEMANTIC_HPP
#define CORE_ST_SEMANTIC_HPP

#include "st_diagnostic.hpp"
#include "st_program.hpp"

namespace core {

/* true = hợp lệ (prog->body's StExpr::result_type đã điền đầy đủ).
 * false = *diag mô tả lỗi đầu tiên gặp. */
bool typecheck_st_program(StProgram* prog, StDiagnostic* diag);

} // namespace core

#endif /* CORE_ST_SEMANTIC_HPP */
