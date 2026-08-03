#include "iop/iop_crc.hpp"

#include "iop_protocol.h"

namespace iobus {

uint16_t crc16(const uint8_t* d, size_t n)
{
    return iop_crc16(d, static_cast<uint16_t>(n));
}

} // namespace iobus
