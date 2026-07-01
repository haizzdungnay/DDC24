/**
 * @file  iobus_config.hpp
 * @brief Config struct + default (06 §4). Thứ tự ưu tiên: CLI --config >
 *        /data/config/io_config.conf > default built-in.
 *        Fallback: thiếu file/field → default + WARN; JSON sai cú pháp → fail-fast.
 */
#ifndef IOBUS_IOBUS_CONFIG_HPP
#define IOBUS_IOBUS_CONFIG_HPP

#include <string>

#include "io/io_types.hpp"

namespace iobus {

/* ADR-012: per-channel AO config — tên, đơn vị engineering, phạm vi BACnet PV.
 * Dùng để set BACnet AO Object_Name / Units / Min_Pres_Value / Max_Pres_Value.
 * Engineering conversion: norm = (pv - min_pv)/(max_pv - min_pv) → DAC raw. */
struct AoChannelConfig {
    std::string name;          /* BACnet Object_Name; default "AO{n}" */
    std::string units_str;     /* "percent","volt","milliampere","degC","Pa","RPM","ppm" */
    float       min_pv = 0.0f; /* BACnet Min_Pres_Value (engineering units) */
    float       max_pv = 10.0f;/* BACnet Max_Pres_Value; default 10 (volts 0-10V) */
};

struct IobusConfig {
    /* iop */
    std::string uart_device = "/dev/ttyS2";
    int      baud                  = IOP_BAUD;
    uint32_t poll_period_ms        = IOP_GET_IO_PERIOD_MS;
    uint32_t response_timeout_ms   = IOP_RESP_TIMEOUT_MS;
    uint32_t max_retry             = IOP_MAX_RETRY;
    uint32_t reconnect_interval_ms = IOP_RECONNECT_PERIOD_MS;
    uint32_t handshake_timeout_ms  = IOP_HANDSHAKE_TIMEOUT_MS;

    /* io */
    UiScaleConfig    ui[KX_N_UI]          = {};
    AoMode           ao_mode[KX_N_AO]     = {AoMode::V0_10, AoMode::V0_10, AoMode::V0_10, AoMode::V0_10};
    AoChannelConfig  ao_channels[KX_N_AO] = {};  /* ADR-012: name/units/min_pv/max_pv per channel */

    std::string log_level = "info";
    int rt_priority = 70;
};

/* Load từ file JSON. Trả về:
 *   true  — config hợp lệ (kể cả thiếu file → default + WARN khi must_exist=false)
 *   false — JSON sai cú pháp / không đọc được khi must_exist=true → caller fail-fast exit(1)
 */
bool load_config(const std::string& path, bool must_exist, IobusConfig* out);

bool reload_config_safe(const std::string& path, bool must_exist, IobusConfig& current_cfg, const std::string& uart_override, const std::string& log_level_override);

} // namespace iobus

#endif /* IOBUS_IOBUS_CONFIG_HPP */
