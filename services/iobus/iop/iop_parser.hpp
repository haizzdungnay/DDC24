/**
 * @file  iop_parser.hpp
 * @brief Parse payload IO_RESP (34B) / DIAG_RESP (20B) → struct (chưa scale).
 *        Byte offset theo 05 §6 — big-endian, dùng helper iop_be16/iop_be24.
 */
#ifndef IOBUS_IOP_PARSER_HPP
#define IOBUS_IOP_PARSER_HPP

#include "io/io_types.hpp"

namespace iobus {

/* p trỏ vào payload, len = LEN field. Trả false nếu len sai (≠34/≠20). */
bool parse_io(const uint8_t* p, uint8_t len, IopIoResp* out);
bool parse_diag(const uint8_t* p, uint8_t len, IopDiagResp* out);

} // namespace iobus

#endif /* IOBUS_IOP_PARSER_HPP */
