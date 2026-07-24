/**
 * @file  st_semantic.hpp
 * @brief FW-SOM-ST-001: type/binding check tối thiểu cho StProgram AST.
 *        Reject: unbound variable, type mismatch (assign/so sánh), ghi vào
 *        VAR_INPUT (input là read-only theo ngữ nghĩa IEC). Điền result_type
 *        cho mọi StExpr khi pass.
 */
#ifndef CORE_ST_SEMANTIC_HPP
#define CORE_ST_SEMANTIC_HPP

#include <string>

#include "st_program.hpp"

namespace core {

/* true = hợp lệ (prog->body's StExpr::result_type đã điền đầy đủ).
 * false = *error mô tả lỗi đầu tiên gặp (unbound_variable|type_mismatch|...). */
bool typecheck_st_program(StProgram* prog, std::string* error);

} // namespace core

#endif /* CORE_ST_SEMANTIC_HPP */
