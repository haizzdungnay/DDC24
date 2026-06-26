/**
 * @file  fieldbus_config.hpp
 * @brief MOD-002: fieldbus.conf loader — rs485 + slaves (CONFIG_SCHEMA D-5 §5b).
 *        rs485.device bắt buộc. Fail-fast khi JSON hỏng; thiếu field → default + WARN.
 */
#ifndef IOBUS_FIELDBUS_CONFIG_HPP
#define IOBUS_FIELDBUS_CONFIG_HPP

#include <cstdint>
#include <string>
#include <vector>

namespace iobus::fieldbus {

struct SlaveConfig {
    uint8_t     addr = 0;         /* Modbus slave address 1..247 */
    std::string profile;          /* profile ID (tìm trong /usr/share hoặc /data/config) */
    std::string name;             /* tên slave, dùng làm prefix ext point name */
    uint32_t    poll_ms = 1000;
};

struct TcpSlaveConfig {
    std::string host;             /* IP hoặc hostname bắt buộc */
    uint16_t    port        = 502;
    uint8_t     unit        = 1;  /* Modbus unit ID */
    std::string profile;          /* device profile ID */
    std::string name;             /* prefix ext point name */
    uint32_t    poll_ms     = 1000;
    uint32_t    reconnect_s = 5;
    uint32_t    timeout_ms  = 500;
};

struct Rs485Config {
    std::string device;           /* bắt buộc khi có RTU slaves */
    uint32_t    baud   = 19200;
    char        parity = 'N';     /* N / E / O */
    uint8_t     stop   = 1;
};

struct FieldbusConfig {
    Rs485Config              rs485;
    uint32_t                 poll_default_ms = 1000;
    std::vector<SlaveConfig>    slaves;
    std::vector<TcpSlaveConfig> tcp_slaves;   /* MOD-013 */
    bool loaded = false;
};

/**
 * Load fieldbus.conf.
 * Thiếu file → default built-in + WARN (bình thường khi chưa provision).
 * JSON hỏng cú pháp → fail-fast (return false, caller exit).
 * Field sai kiểu/ngoài range → clamp/skip + WARN + continue.
 * rs485.device rỗng → skip service + ERROR (bắt buộc theo CONFIG_SCHEMA §5b).
 */
bool load_fieldbus_config(const std::string& path, bool path_from_cli,
                           FieldbusConfig* out);

} // namespace iobus::fieldbus

#endif /* IOBUS_FIELDBUS_CONFIG_HPP */
