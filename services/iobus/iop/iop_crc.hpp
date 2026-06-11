/**
 * @file  iop_crc.hpp
 * @brief CRC-16/Modbus — wrapper quanh iop_crc16() trong shared/iop_protocol.h.
 *        KHÔNG tự viết thuật toán khác (15_CONTRACT_FREEZE §5).
 */
#ifndef IOBUS_IOP_CRC_HPP
#define IOBUS_IOP_CRC_HPP

#include <cstddef>
#include <cstdint>

namespace iobus {

uint16_t crc16(const uint8_t* d, size_t n);

} // namespace iobus

#endif /* IOBUS_IOP_CRC_HPP */
