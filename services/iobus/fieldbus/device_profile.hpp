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
enum class ByteOrder { AB, BA, ABCD, BADC, CDAB, DCBA };

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

/* ---- Ext slot accounting — NGUỒN CHÂN LÝ DUY NHẤT (finding F-17) ----
 *
 * Trước bản sửa 2026-07-30, luật "32-bit tiêu 2 register cho 1 điểm luận lý"
 * được viết lại ở BỐN chỗ (modbus_master.cpp x3, modbus_tcp.cpp x2) và chúng
 * lệch nhau: open() đếm slot theo SỐ REGISTER (pts += pp.count) trong khi vòng
 * đọc tiêu 1 slot cho mỗi 2 register. Hệ quả: profile thiên về 32-bit đặt trước
 * gấp đôi số slot cần → mất nửa dung lượng KX_N_EXT và sinh slot rỗng
 * (name="" , quality=BAD) lọt vào push_snapshot.
 *
 * Mọi chỗ cần biết "một điểm/profile tiêu bao nhiêu ext slot" PHẢI gọi hai hàm
 * dưới đây. Chúng là hàm thuần nên test được mà không cần libmodbus. */

bool point_type_is_32bit(PointType t);

/**
 * Số ext slot mà một điểm profile tiêu thụ:
 *  - FC ghi (5/6/15/16) → 0. Chỉ FC đọc mới chiếm slot; read_slave/read_conn
 *    bỏ qua FC ghi, nên đặt trước slot cho chúng chính là sinh slot rỗng.
 *  - FC 1/2 (coil / discrete input) → count (1 bit = 1 điểm luận lý)
 *  - FC 3/4 với type 32-bit → count / 2 (2 register = 1 điểm luận lý)
 *  - FC 3/4 với type 16-bit → count
 *
 * count lẻ cho 32-bit bị load_device_profile() từ chối, nên phép chia là chính
 * xác. Với ProfilePoint dựng thủ công (test) thì register lẻ ở cuối bị vòng đọc
 * log + bỏ và KHÔNG tiêu slot — khớp đúng phép chia làm tròn xuống ở đây.
 */
uint16_t ext_slots_for_point(const ProfilePoint& pt);

/** Tổng số ext slot của cả profile = tổng ext_slots_for_point() từng điểm. */
uint16_t ext_slots_for_profile(const DeviceProfile& prof);

/**
 * Parse profile JSON từ file path.
 * Validate fail-fast per-point (plan 25 §4):
 *  - fc không thuộc 1/2/3/4/5/6/15/16 → skip point + ERROR
 *  - addr/count ngoài 0..65535 hoặc block > 125 reg / 2000 coil → skip
 *  - type 32-bit (int32/uint32/float32) trên FC 3/4 cần count là BỘI SỐ CỦA 2
 *    (mỗi điểm luận lý = 2 register); count lẻ → skip
 *  - byte_order thiếu cho 32-bit → skip
 *  - writable=true chỉ hợp lệ với FC01 (Coil) hoặc FC03 (Holding Register);
 *    FC02/04 là read-only, FC05/06/15/16 là lệnh ghi và không tạo Point đọc
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
