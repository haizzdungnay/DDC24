/**
 * @file  io_types.hpp
 * @brief Kiểu dữ liệu nội bộ mkddc-iobus — khớp byte layout IOP v2 (ADR-010).
 *        Nguồn-chuẩn: shared/iop_protocol.h + shared/mkddc_shm.h.
 */
#ifndef IOBUS_IO_TYPES_HPP
#define IOBUS_IO_TYPES_HPP

#include <cstdint>

#include "iop_protocol.h"
#include "mkddc_shm.h"

namespace iobus {

/* Parse từ IO_RESP 74B (IOP v2, ADR-010) */
struct IopIoResp {
    int32_t  ui_raw[KX_N_UI];   /* s24 sign-extended to int32, từ iop_be32s() */
    uint8_t  adc1_stat;         /* IOP_ADC_STAT_* cho ADS131M08 #1 (ch1-8)   */
    uint8_t  adc2_stat;         /* IOP_ADC_STAT_* cho ADS131M08 #2 (ch9-16)  */
    uint8_t  do_fb_mask;        /* bit0..3 = DO1..DO4 relay feedback           */
    int16_t  mcu_temp_x10;      /* 0.1°C */
    uint16_t fault_flags;       /* IOP_FAULT_* v2 */
    uint16_t sample_cnt;
};

/* Parse từ DIAG_RESP 20B */
struct IopDiagResp {
    uint16_t fw_version;
    uint16_t uptime_s;
    uint16_t rx_count;
    uint16_t crc_error_count;
    uint16_t seq_error_count;
    uint16_t watchdog_reset_count;
    uint16_t adc_sample_rate;
    int16_t  mcu_temp_max_x10;
    uint16_t vdd_mv;
};

/* Kết quả mọi lệnh gửi-nhận */
struct IopResult {
    enum Code { OK, TIMEOUT, CRC_FAIL, SEQ_FAIL, NACK, NOT_OPEN } code = NOT_OPEN;
    uint8_t nack_err = 0;
    uint8_t retries  = 0;

    bool ok() const { return code == OK; }
};

/* State machine master */
enum class IopStatus { INIT, OPEN_UART, HANDSHAKE, CONFIG_AO, NORMAL_POLL, FAULT, SAFE_STATE, RECONNECT };

/* Map IopStatus → kx_iop_status_t */
inline kx_iop_status_t to_kx_status(IopStatus s)
{
    switch (s) {
    case IopStatus::NORMAL_POLL: return KX_IOP_NORMAL;
    case IopStatus::SAFE_STATE:  return KX_IOP_SAFE;
    default:                     return KX_IOP_FAULT;
    }
}

/* Loại cảm biến UI.
 * PT100/PT1000: Rev A hardware không lắp mạch — quality luôn BAD nếu configure.
 * NTC10K/NTC20K/DRY_CONTACT: vẫn hỗ trợ qua front-end Rev A. */
enum class SensorType { V0_10, MA4_20, PT100, PT1000, NTC10K, NTC20K, DRY_CONTACT, UNKNOWN };

/* Mode AO (0=0-10V, 1=4-20mA — khớp SET_AO_CFG bit) */
enum class AoMode : uint8_t { V0_10 = 0, MA4_20 = 1 };

/* Snapshot đã scale, đầu vào của io_cache.write_io() */
struct IoSnapshot {
    uint64_t ts_ns = 0;
    float    ui_value[KX_N_UI]   = {};
    uint8_t  ui_quality[KX_N_UI] = {KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD};
    uint8_t  di_state[KX_N_DI]   = {};   /* base SKU: always 0; reserved for DI SKU */
    uint8_t  do_feedback[KX_N_DO]= {};
    uint16_t fault_flags = 0;
    uint8_t  iop_status  = KX_IOP_FAULT;
    int16_t  mcu_temp_x10 = 0;
};

} // namespace iobus

#endif /* IOBUS_IO_TYPES_HPP */
