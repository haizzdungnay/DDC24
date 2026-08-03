/**
 * @file  register_codec.hpp
 * @brief MOD-004: decode Modbus register buffer → float engineering value.
 *        Hỗ trợ: bool/int16/uint16/int32/uint32/float32; endian AB/BA/ABCD/CDAB.
 *        scale/offset: eng = raw * scale + offset.
 */
#ifndef IOBUS_REGISTER_CODEC_HPP
#define IOBUS_REGISTER_CODEC_HPP

#include <cstdint>
#include "device_profile.hpp"

namespace iobus::fieldbus {

/**
 * Decode registers[] theo type + byte_order → float engineering.
 * regs: mảng uint16_t đọc từ Modbus (network byte order đã được libmodbus swap về host).
 * count: số register thực tế trong regs[].
 * Trả 0.0f nếu count không đủ cho type.
 */
float decode_register(const uint16_t* regs, uint16_t count,
                      PointType type, ByteOrder byte_order,
                      float scale, float offset);

/**
 * Encode float engineering → register buffer (cho FC05/06/15/16).
 * regs: output buffer, count: số register cần điền.
 * Trả false nếu type không hỗ trợ ghi hoặc count không đủ.
 */
bool encode_register(float eng_value, uint16_t* regs, uint16_t count,
                     PointType type, ByteOrder byte_order,
                     float scale, float offset);

} // namespace iobus::fieldbus

#endif /* IOBUS_REGISTER_CODEC_HPP */
