/**
 * @file  register_codec.cpp
 * @brief MOD-004: register decode/encode với endian + scale.
 */
#include "register_codec.hpp"

#include <cstring>

namespace iobus::fieldbus {

/* libmodbus trả về registers ở host byte order (đã swap từ Modbus big-endian).
 * regs[0] = register đầu tiên, regs[1] = register thứ hai, v.v.
 * Byte_order dùng để ghép 2 register 16-bit thành 1 giá trị 32-bit:
 *   AB   = regs[0] high word  (default Modbus: AB = big-endian word order)
 *   BA   = regs[1] high word  (little-endian word order)
 *   ABCD = AB, từng byte big-endian
 *   CDAB = BA, từng byte little-endian ("mid-big" endian)
 */

static uint32_t regs_to_u32(const uint16_t* regs, ByteOrder bo)
{
    const uint16_t hi = (bo == ByteOrder::AB || bo == ByteOrder::ABCD) ? regs[0] : regs[1];
    const uint16_t lo = (bo == ByteOrder::AB || bo == ByteOrder::ABCD) ? regs[1] : regs[0];
    return (static_cast<uint32_t>(hi) << 16) | lo;
}

static void u32_to_regs(uint32_t u, ByteOrder bo, uint16_t* regs)
{
    const uint16_t hi = static_cast<uint16_t>(u >> 16);
    const uint16_t lo = static_cast<uint16_t>(u & 0xFFFFu);
    if (bo == ByteOrder::AB || bo == ByteOrder::ABCD) { regs[0] = hi; regs[1] = lo; }
    else                                               { regs[0] = lo; regs[1] = hi; }
}

float decode_register(const uint16_t* regs, uint16_t count,
                      PointType type, ByteOrder byte_order,
                      float scale, float offset)
{
    float raw = 0.0f;
    switch (type) {
        case PointType::Bool:
            if (count < 1) return 0.0f;
            raw = (regs[0] != 0) ? 1.0f : 0.0f;
            break;
        case PointType::Int16:
            if (count < 1) return 0.0f;
            raw = static_cast<float>(static_cast<int16_t>(regs[0]));
            break;
        case PointType::Uint16:
            if (count < 1) return 0.0f;
            raw = static_cast<float>(regs[0]);
            break;
        case PointType::Int32: {
            if (count < 2) return 0.0f;
            const uint32_t u = regs_to_u32(regs, byte_order);
            raw = static_cast<float>(static_cast<int32_t>(u));
            break;
        }
        case PointType::Uint32: {
            if (count < 2) return 0.0f;
            raw = static_cast<float>(regs_to_u32(regs, byte_order));
            break;
        }
        case PointType::Float32: {
            if (count < 2) return 0.0f;
            const uint32_t u = regs_to_u32(regs, byte_order);
            float f;
            std::memcpy(&f, &u, 4);
            raw = f;
            break;
        }
    }
    return raw * scale + offset;
}

bool encode_register(float eng_value, uint16_t* regs, uint16_t count,
                     PointType type, ByteOrder byte_order,
                     float scale, float offset)
{
    const float raw = (scale != 0.0f) ? (eng_value - offset) / scale : 0.0f;
    switch (type) {
        case PointType::Bool:
            if (count < 1) return false;
            regs[0] = (raw != 0.0f) ? 1u : 0u;
            return true;
        case PointType::Int16:
            if (count < 1) return false;
            regs[0] = static_cast<uint16_t>(static_cast<int16_t>(raw));
            return true;
        case PointType::Uint16:
            if (count < 1) return false;
            regs[0] = static_cast<uint16_t>(static_cast<uint32_t>(raw) & 0xFFFFu);
            return true;
        case PointType::Int32: {
            if (count < 2) return false;
            const uint32_t u = static_cast<uint32_t>(static_cast<int32_t>(raw));
            u32_to_regs(u, byte_order, regs);
            return true;
        }
        case PointType::Uint32: {
            if (count < 2) return false;
            u32_to_regs(static_cast<uint32_t>(raw), byte_order, regs);
            return true;
        }
        case PointType::Float32: {
            if (count < 2) return false;
            uint32_t u;
            std::memcpy(&u, &raw, 4);
            u32_to_regs(u, byte_order, regs);
            return true;
        }
    }
    return false;
}

} // namespace iobus::fieldbus
