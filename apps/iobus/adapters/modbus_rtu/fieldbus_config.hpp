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
    /* MBR-B101: bus vật lý mà slave này nằm trên. 1-based để `0` giữ nghĩa
     * "chưa xác định" trong snapshot (kx_ext_sample_v2_t.bus_id).
     * Cấu hình một-bus cũ không có trường này ⇒ mặc định 1, hành vi không đổi. */
    uint8_t     bus_id = 1;
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

/* MBR-B101 / OD-MBRTU-001 (CLOSED 2026-08-05: hai bus RS485 vật lý).
 *
 * Một `BusConfig` mô tả MỘT SỢI DÂY. Tham số serial thuộc về dây chứ không
 * thuộc thiết bị (OD-MBRTU-002): hai thiết bị trên cùng dây không thể chạy hai
 * baud khác nhau, nên để baud ở Device là mời người dùng lưu một cấu hình
 * không thể thực thi. */
/* Cơ chế điều khiển hướng truyền half-duplex trên RS-485 (G-D / OD-MBRTU-EXT-04).
 *
 * Phần cứng Foxlinx SOM-DDC-24 xác nhận 2026-08-06 (Hardware owner): **chỉ có
 * TX và RX, KHÔNG có DE/RE** ⇒ transceiver tự đảo hướng (auto-direction, đúng
 * lớp MAX13487E mà HW-DES-03-RS485 §1 nêu làm baseline).
 *
 * Vì sao vẫn phải có enum thay vì hardcode: trước bản này source KHÔNG gọi
 * `modbus_rtu_set_serial_mode()` và device tree không có `rs485-*`, nên hệ
 * thống chạy trên một GIẢ ĐỊNH KHÔNG AI PHÁT BIỂU. Giả định im lặng thì không
 * kiểm chứng được và không đổi được khi lắp bo khác. Nay nó là một lựa chọn
 * tường minh, ghi trong config, in ra log lúc khởi động. */
enum class Rs485Direction : uint8_t {
    Auto = 0,   /* transceiver tự đảo hướng — KHÔNG đụng TIOCSRS485 */
    Rts  = 1,   /* driver kéo RTS làm DE (bo có DE/RE nối vào RTS)   */
};

struct BusConfig {
    uint8_t     id = 1;           /* 1-based, khớp SlaveConfig::bus_id */
    std::string name;             /* nhãn hiển thị, ví dụ "RS485-1" */
    std::string device;           /* /dev/rs485-1 … bắt buộc khi enabled */
    uint32_t    baud   = 19200;
    char        parity = 'N';
    uint8_t     stop   = 1;
    /* D-04: chu kỳ thử lại slave đang OFFLINE, dùng chung cho cả bus.
     * Thuộc bus chứ không thuộc device: nó bảo vệ băng thông của SỢI DÂY. */
    uint32_t    offline_probe_ms = 5000;
    bool        enabled = true;
    /* Mặc định Auto: khớp phần cứng đã xác nhận. Đổi sang Rts CHỈ khi bo thật
     * sự có chân DE/RE nối vào RTS — bật nhầm trên bo auto-direction làm driver
     * giữ RTS và có thể chặn đường truyền. */
    Rs485Direction direction = Rs485Direction::Auto;
    uint32_t    rts_delay_before_us = 0;
    uint32_t    rts_delay_after_us  = 0;
};

struct FieldbusConfig {
    /* Giữ lại cho đường cấu hình một-bus cũ; loader chép sang buses[0]. */
    Rs485Config              rs485;
    std::vector<BusConfig>   buses;
    uint32_t                 poll_default_ms = 1000;
    std::vector<SlaveConfig>    slaves;
    std::vector<TcpSlaveConfig> tcp_slaves;   /* MOD-013 */
    /* Provenance: BE ghi vào fieldbus.conf khi apply; iobus chở nguyên vẹn ra
     * snapshot v2 để FE nói được "iobus đang chạy revision N" (MBR-B104). */
    uint64_t    revision = 0;
    std::string checksum;
    bool loaded = false;

    /* Bus theo id 1-based; nullptr nếu không có. */
    const BusConfig* bus(uint8_t id) const
    {
        for (const auto& b : buses)
            if (b.id == id) return &b;
        return nullptr;
    }
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

/**
 * Dựng `buses[]` từ `rs485{}` khi cấu hình chưa khai báo bus tường minh, và
 * kẹp `bus_id` của slave vào bus đầu tiên nếu id không tồn tại.
 *
 * Gọi ở CẢ hai đường vào — loader và `ModbusMaster::open` — vì cấu hình có thể
 * được dựng trực tiếp trong bộ nhớ (test, và đường reload). Nếu chỉ chuẩn hoá ở
 * loader thì một FieldbusConfig hợp lệ dựng bằng tay sẽ không có bus nào và
 * master im lặng không poll gì cả.
 */
void normalize_buses(FieldbusConfig* cfg);

} // namespace iobus::fieldbus

#endif /* IOBUS_FIELDBUS_CONFIG_HPP */
