/**
 * @file  st_parser.hpp
 * @brief FW-SOM-ST-001: parser tối thiểu — đọc source ST THẬT (string), không
 *        hard-code output test. Lower trực tiếp sang StProgram AST/IR
 *        (st_program.hpp). Không execute source — chỉ parse.
 */
#ifndef CORE_ST_PARSER_HPP
#define CORE_ST_PARSER_HPP

#include <string>

#include "st_program.hpp"

namespace core {

/* true  = parse OK, *out điền đầy đủ (chưa type-check — xem st_semantic.hpp).
 * false = syntax error, *error mô tả vị trí/lý do; *out không xác định. */
bool parse_st_program(const std::string& source, StProgram* out, std::string* error);

} // namespace core

#endif /* CORE_ST_PARSER_HPP */
