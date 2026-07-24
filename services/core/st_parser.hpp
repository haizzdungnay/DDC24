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

#include "st_diagnostic.hpp"
#include "st_program.hpp"

namespace core {

/* true  = parse OK, *out điền đầy đủ (chưa type-check — xem st_semantic.hpp).
 * false = syntax/lex error, *diag mô tả vị trí/lý do; *out không xác định. */
bool parse_st_program(const std::string& source, StProgram* out, StDiagnostic* diag);

} // namespace core

#endif /* CORE_ST_PARSER_HPP */
