/**
 * @file  core_bridge.hpp
 * @brief Ranh giới shm với core: đọc field core ghi (ao_setpoint[]/do_cmd[]) — READ-ONLY.
 */
#ifndef IOBUS_CORE_BRIDGE_HPP
#define IOBUS_CORE_BRIDGE_HPP

#include "io/io_types.hpp"

namespace iobus {

class CoreBridge {
public:
    explicit CoreBridge(const kx_io_shm_t* shm) : shm_(shm) {}

    /* Atomic load 2 field core sở hữu — không cần seqlock (core ghi atomic per-field). */
    void read_outputs(float ao_sp[KX_N_AO], uint8_t do_cmd[KX_N_DO]) const;

private:
    const kx_io_shm_t* shm_;
};

} // namespace iobus

#endif /* IOBUS_CORE_BRIDGE_HPP */
