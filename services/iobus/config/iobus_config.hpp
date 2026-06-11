/**
 * @file  iobus_config.hpp
 * @brief Config struct + default (06 §4). Thứ tự ưu tiên: CLI --config >
 *        /data/config/iobus.conf > default built-in.
 *        Fallback: thiếu file/field → default + WARN; JSON sai cú pháp → fail-fast.
 */
#ifndef IOBUS_IOBUS_CONFIG_HPP
#define IOBUS_IOBUS_CONFIG_HPP

#include <string>

#include "io/io_types.hpp"

namespace iobus {

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
    SensorType ui_sensor[KX_N_UI] = {SensorType::V0_10, SensorType::V0_10, SensorType::V0_10,
                                     SensorType::V0_10, SensorType::V0_10, SensorType::V0_10,
                                     SensorType::V0_10, SensorType::V0_10};
    AoMode     ao_mode[KX_N_AO]   = {AoMode::V0_10, AoMode::V0_10, AoMode::V0_10, AoMode::V0_10};

    std::string log_level = "info";
    int rt_priority = 70;
};

/* Load từ file JSON. Trả về:
 *   true  — config hợp lệ (kể cả thiếu file → default + WARN khi must_exist=false)
 *   false — JSON sai cú pháp / không đọc được khi must_exist=true → caller fail-fast exit(1)
 */
bool load_config(const std::string& path, bool must_exist, IobusConfig* out);

} // namespace iobus

#endif /* IOBUS_IOBUS_CONFIG_HPP */
