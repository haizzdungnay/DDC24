/**
 * @file  st_parser.hpp
 * @brief FW SOM IEC programming foundation: parser tối thiểu — đọc source ST
 *        THẬT (string), không hard-code output test. Lower trực tiếp sang
 *        StProgram AST/IR (st_program.hpp). Không execute source — chỉ parse.
 *        Lỗi trả về StDiagnostic có line/column (mã ST-LEX-xxx hoặc ST-SYN-xxx).
 */
#ifndef CORE_ST_PARSER_HPP
#define CORE_ST_PARSER_HPP

#include <string>

#include "st/st_diagnostic.hpp"
#include "st/st_program.hpp"

namespace core {

/* Parse một POU bất kỳ: PROGRAM, FUNCTION hoặc FUNCTION_BLOCK (T59-101).
 * `out->kind` cho biết loại đã đọc; `out->has_return_type` chỉ true với FUNCTION.
 * true  = parse OK, *out điền đầy đủ (chưa type-check — xem st_semantic.hpp).
 * false = lex/syntax/kind error, *diag mô tả vị trí/lý do; *out không xác định. */
bool parse_st_pou(const std::string& source, StProgram* out, StDiagnostic* diag);

/* Như trên nhưng CHỈ nhận PROGRAM. Giữ nguyên hợp đồng cho call site hiện có;
 * nguồn khai FUNCTION/FUNCTION_BLOCK bị từ chối bằng mã kind `ST-POU-001`. */
bool parse_st_program(const std::string& source, StProgram* out, StDiagnostic* diag);

} // namespace core

#endif /* CORE_ST_PARSER_HPP */
