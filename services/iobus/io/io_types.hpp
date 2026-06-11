/**
 * @file  io_types.hpp
 * @brief Kiểu dữ liệu nội bộ mkddc-iobus (struct theo 05 §12.1 — khớp byte layout 05 §6).
 *        Nguồn-chuẩn: shared/iop_protocol.h + shared/mkddc_shm.h.
 */
#ifndef IOBUS_IO_TYPES_HPP
#define IOBUS_IO_TYPES_HPP

#include <cstdint>

#include "iop_protocol.h"
#include "mkddc_shm.h"

namespace iobus {

/* Parse từ IO_RESP 34B (05 §6.1) */
struct IopIoResp {
    uint32_t ui_raw[KX_N_UI];   /* uint24 thực, lưu trong uint32 (0..0xFFFFFF) */
    uint8_t  di_mask;
    uint8_t  do_fb_mask;
    int16_t  mcu_temp_x10;      /* 0.1°C */
    uint16_t fault_flags;       /* IOP_FAULT_* */
    uint16_t sample_cnt;
};

/* Parse từ DIAG_RESP 20B (05 §6.6) */
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

/* Kết quả mọi lệnh gửi-nhận (05 §12.1) */
struct IopResult {
    enum Code { OK, TIMEOUT, CRC_FAIL, SEQ_FAIL, NACK, NOT_OPEN } code = NOT_OPEN;
    uint8_t nack_err = 0;       /* hợp lệ khi code==NACK (ERR_*) */
    uint8_t retries  = 0;       /* số lần đã retry */

    bool ok() const { return code == OK; }
};

/* State machine master (05 §13) */
enum class IopStatus { INIT, OPEN_UART, HANDSHAKE, CONFIG_AO, NORMAL_POLL, FAULT, SAFE_STATE, RECONNECT };

/* Map IopStatus → kx_iop_status_t (06 §5) */
inline kx_iop_status_t to_kx_status(IopStatus s)
{
    switch (s) {
    case IopStatus::NORMAL_POLL: return KX_IOP_NORMAL;
    case IopStatus::SAFE_STATE:  return KX_IOP_SAFE;
    default:                     return KX_IOP_FAULT;
    }
}

/* Loại cảm biến UI (bảng scaling 06 §3.6) */
enum class SensorType { V0_10, MA4_20, PT100, PT1000, NTC10K, NTC20K, DRY_CONTACT, UNKNOWN };

/* Mode AO (0=0-10V, 1=4-20mA — khớp SET_AO_CFG bit) */
enum class AoMode : uint8_t { V0_10 = 0, MA4_20 = 1 };

/* Snapshot đã scale, đầu vào của io_cache.write_io() */
struct IoSnapshot {
    uint64_t ts_ns = 0;
    float    ui_value[KX_N_UI]   = {};
    uint8_t  ui_quality[KX_N_UI] = {KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD,
                                    KX_Q_BAD, KX_Q_BAD, KX_Q_BAD, KX_Q_BAD};
    uint8_t  di_state[KX_N_DI]   = {};
    uint8_t  do_feedback[KX_N_DO]= {};
    uint16_t fault_flags = 0;
    uint8_t  iop_status  = KX_IOP_FAULT;
    int16_t  mcu_temp_x10 = 0;
};

} // namespace iobus

#endif /* IOBUS_IO_TYPES_HPP */
