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
    uint32_t    timeout_ms = 300;  /* response timeout riêng từng thiết bị */
    /* D-05: SỐ LẦN PHÁT LẠI một giao dịch Modbus bị lỗi, trong cùng lượt poll.
     *
     * Trước bản sửa 2026-08-04 trường này mang nghĩa "số lỗi liên tiếp trước khi
     * OFFLINE" trong khi UI/API vẫn gọi nó là "Retry", và thực tế KHÔNG có một
     * lần phát lại nào — read_slave() gặp lỗi là break luôn, libmodbus cũng
     * không tự retry. Người vận hành đặt retry=3 tin rằng hệ thống chịu được
     * nhiễu thoáng qua, nhưng mọi lỗi đơn lẻ đều làm điểm dữ liệu rơi STALE.
     * Quyết định Đ-05 (PM/CTO 2026-08-04): làm đúng như nhãn. */
    uint8_t     retry = 2;
    /* Ngưỡng OFFLINE, tách khỏi retry (D-05). Đếm theo LƯỢT POLL thất bại liên
     * tiếp — mỗi lượt đã bao gồm đủ số lần phát lại ở trên. */
    uint8_t     offline_after_errors = 2;
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
    /* D-04: chu kỳ thử lại slave đang OFFLINE, dùng chung cho cả bus.
     * Thuộc bus chứ không thuộc device: nó bảo vệ băng thông của SỢI DÂY. */
    uint32_t    offline_probe_ms = 5000;
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
