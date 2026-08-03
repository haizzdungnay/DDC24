#include "bridge/core_bridge.hpp"

namespace iobus {

void CoreBridge::read_outputs(float ao_sp[KX_N_AO], uint8_t do_cmd[KX_N_DO]) const
{
    for (int i = 0; i < KX_N_AO; i++)
        __atomic_load(&shm_->ao_setpoint[i], &ao_sp[i], __ATOMIC_ACQUIRE);
    for (int i = 0; i < KX_N_DO; i++)
        do_cmd[i] = __atomic_load_n(&shm_->do_cmd[i], __ATOMIC_ACQUIRE);
}

} // namespace iobus
