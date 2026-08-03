/**
 * @file io_snapshot.hpp
 * @brief Port dữ liệu I/O nhất quán mà domain tiêu thụ, độc lập SHM adapter.
 */
#ifndef CORE_PORTS_IO_SNAPSHOT_HPP
#define CORE_PORTS_IO_SNAPSHOT_HPP

#include <cstdint>

#include "mkddc_shm.h"

namespace core {

struct IoSnapshot {
    uint64_t ts_ns = 0;
    float    ui_value[KX_N_UI] = {};
    uint8_t  ui_quality[KX_N_UI] = {KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD};
    uint8_t  ui_reliability[KX_N_UI] = {KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE,
                                        KX_REL_COMMUNICATION_FAILURE, KX_REL_COMMUNICATION_FAILURE};
    char     ui_unit[KX_N_UI][8] = {};
    uint8_t  di_state[KX_N_DI] = {};
    uint32_t di_counter[KX_N_DI] = {};
    uint8_t  do_feedback[KX_N_DO] = {};
    float    ao_setpoint[KX_N_AO] = {};
    uint8_t  ao_mode[KX_N_AO] = {};
    uint16_t fault_flags = 0;
    uint8_t  iop_status = KX_IOP_FAULT;
    int16_t  mcu_temp_x10 = 0;
    bool     valid = false;
};

} // namespace core

#endif
