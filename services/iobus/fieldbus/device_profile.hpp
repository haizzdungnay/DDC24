/**
 * @file  device_profile.hpp
 * @brief MOD-003: JSON device profile parser + validator (MODBUS_REGISTER_MAP §3).
 *        Fail-fast per-point: invalid fc/type/count → skip that point, not crash service.
 */
#ifndef IOBUS_DEVICE_PROFILE_HPP
#define IOBUS_DEVICE_PROFILE_HPP

#include <cstdint>
#include <string>
#include <vector>

namespace iobus::fieldbus {

enum class PointType { Bool, Int16, Uint16, Int32, Uint32, Float32 };
enum class ByteOrder { AB, BA, ABCD, CDAB };

struct ProfilePoint {
    std::string name;
    uint8_t     fc      = 3;        /* function code: 1/2/3/4/5/6/15/16 */
    uint16_t    addr    = 0;
    uint16_t    count   = 1;        /* số registers / coils liên tiếp */
    PointType   type    = PointType::Uint16;
    float       scale   = 1.0f;
    float       offset  = 0.0f;
    ByteOrder   byte_order = ByteOrder::AB;
    bool        writable   = false;
    std::string map_to;

    /* MOD-010: BACnet expose (SW_FIELDBUS_DESIGN §9, FB-Q-002) */
    bool        expose_bacnet      = false;
    std::string bacnet_object_type;   /* "AV" / "BV" / "AI" */
    uint32_t    bacnet_instance    = 0;
};

struct DeviceProfile {
    std::string profile_id;
    std::string vendor;
    std::string description;
    uint32_t    default_baud = 19200;
    std::vector<ProfilePoint> points;
    bool loaded = false;
};

/**
 * Parse profile JSON từ file path.
 * Validate fail-fast per-point (plan 25 §4):
 *  - fc không thuộc 1/2/3/4/5/6/15/16 → skip point + ERROR
 *  - addr/count ngoài 0..65535 hoặc block > 125 reg / 2000 coil → skip
 *  - type không khớp count (32-bit cần count=2) → skip
 *  - byte_order thiếu cho 32-bit → skip
 *  - writable=true nhưng FC không ghi → skip
 * Profile lỗi nặng (không có points sau validate) → warn + continue (service không crash).
 */
bool load_device_profile(const std::string& path, DeviceProfile* out);

/**
 * Tìm profile theo profile_id trong các thư mục chuẩn:
 *  1. /data/config/profiles/<id>.json   (user)
 *  2. /usr/share/kinexus/profiles/<id>.json  (built-in)
 * Trả "" nếu không tìm thấy.
 */
std::string find_profile_path(const std::string& profile_id);

} // namespace iobus::fieldbus

#endif /* IOBUS_DEVICE_PROFILE_HPP */
