/**
 * @file command_sink.hpp
 * @brief Port gửi lệnh output; adapter IOP hiện thực transport/UART cụ thể.
 */
#ifndef IOBUS_PORTS_COMMAND_SINK_HPP
#define IOBUS_PORTS_COMMAND_SINK_HPP

#include "io/io_types.hpp"

namespace iobus {

class CommandSink {
public:
    virtual ~CommandSink() = default;
    virtual IopResult send_set_do(uint8_t mask, uint8_t value) = 0;
    virtual IopResult send_set_ao(const uint16_t ao_raw[KX_N_AO]) = 0;
};

} // namespace iobus

#endif /* IOBUS_PORTS_COMMAND_SINK_HPP */
