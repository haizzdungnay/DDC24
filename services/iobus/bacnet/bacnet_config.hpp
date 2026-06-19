/**
 * @file  bacnet_config.hpp
 * @brief BAC-002: device.conf + bacnet.conf loader (CONFIG_SCHEMA D-5 §1, §5).
 *        Không depend on bacnet-stack — parse JSON thuần.
 */
#ifndef IOBUS_BACNET_CONFIG_HPP
#define IOBUS_BACNET_CONFIG_HPP

#include <cstdint>
#include <string>

namespace iobus::bacnet {

struct BacnetBip {
    bool        enabled        = true;
    uint16_t    udp_port       = 47808;
    std::string bind_interface;      /* "" = bind all; khuyến nghị đặt tường minh */
    std::string bbmd_addr;           /* "" = không dùng BBMD */
    uint16_t    bbmd_port      = 47808;
    std::string fd_addr;             /* "" = không đăng ký FD */
    uint16_t    fd_ttl         = 60;
};

struct DeviceConfig {
    uint32_t    device_id      = 1001;
    std::string device_name    = "MK-DDC-24";
    std::string description;
    std::string location;
};

struct BacnetConfig {
    DeviceConfig  device;
    BacnetBip     bip;
    bool          loaded = false;
};

/**
 * Load device.conf + bacnet.conf.
 * Thiếu file → defaults + WARN.
 * JSON hỏng → fail-fast.
 * bind_interface rỗng: log WARN security reminder (không mandatory error).
 * Vendor_Identifier = 9999 (placeholder — PICS §7, chờ ASHRAE cấp số thật).
 */
bool load_bacnet_config(const std::string& device_conf_path,
                         const std::string& bacnet_conf_path,
                         bool from_cli,
                         BacnetConfig* out);

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_CONFIG_HPP */
