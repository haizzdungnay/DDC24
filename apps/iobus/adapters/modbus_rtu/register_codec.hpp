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
 *
 * FAIL-CLOSED (D-01/D-02, sửa 2026-08-04). Trả false — KHÔNG ghi gì vào regs —
 * khi bất kỳ điều kiện nào sau đây đúng:
 *   - count không đủ cho type;
 *   - scale bằng 0 hoặc không hữu hạn (trước đây tính raw=0 rồi trả TRUE, tức
 *     ghi im lặng giá trị 0 xuống thiết bị hiện trường);
 *   - eng_value hoặc raw sau quy đổi là NaN/±Inf;
 *   - raw nằm ngoài dải biểu diễn được của kiểu đích.
 *
 * Vì sao phải kiểm dải: `static_cast<int16_t>(raw)` với raw là float ngoài dải
 * int16 là UNDEFINED BEHAVIOR theo [conv.fpint]/1. Đường vào thực tế là
 * plc_shm.ext[i].setpoint do node graph ghi, không có clamp ở bất kỳ tầng nào,
 * nên một lỗi công thức trong logic điều khiển sẽ ghi giá trị rác xuống
 * VFD/thiết bị thật qua FC06/FC16.
 */
bool encode_register(float eng_value, uint16_t* regs, uint16_t count,
                     PointType type, ByteOrder byte_order,
                     float scale, float offset);

} // namespace iobus::fieldbus

#endif /* IOBUS_REGISTER_CODEC_HPP */
