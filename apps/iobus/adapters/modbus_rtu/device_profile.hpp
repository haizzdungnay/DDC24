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

/* `ISS-PIO-22`/`F-PIO-021` — NHÓM POLL THEO ĐIỂM (đề bài §22).
 *
 * Trước bản vá `poll_ms` chỉ có ở cấp Device, nên một điểm cấu hình (đọc một
 * lần mỗi phút là đủ) bị poll CÙNG NHỊP với tần số VFD (500 ms) và tiêu băng
 * thông RS-485 vô ích. Dây RS-485 là tài nguyên chia sẻ: mỗi khung thừa đẩy
 * lượt poll của điểm khác ra sau.
 *
 * `Normal` là mặc định và mang đúng `poll_ms` của Device, nên cấu hình đang
 * chạy KHÔNG đổi hành vi khi nâng cấp firmware. */
enum class PollGroup : uint8_t { Fast = 0, Normal = 1, Slow = 2 };

PollGroup   poll_group_from_string(const char* s);
const char* poll_group_name(PollGroup g);
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

    /* `ISS-PIO-22` — nhóm poll của điểm. Chu kỳ thật của mỗi nhóm do Device
     * khai (`poll_fast_ms`/`poll_ms`/`poll_slow_ms`). */
    PollGroup   poll_group = PollGroup::Normal;
    /* Ngưỡng tự hạ STALE riêng cho điểm, tính từ mẫu ĐỌC THÀNH CÔNG gần nhất.
     *
     * `0` = suy từ chu kỳ poll hiệu lực của điểm (xem `effective_stale_after_ms`),
     * chứ KHÔNG phải "tắt": một điểm không bao giờ hạ stale là một điểm nói dối
     * êm ái khi thiết bị ngừng trả lời đúng nó mà slave vẫn online. */
    uint32_t    stale_after_ms = 0;

    /* 2026-08-20 — `expose_bacnet` / `bacnet_object_type` / `bacnet_instance`
     * ĐÃ BỊ GỠ khỏi ProfilePoint (OD-MBRTU-014, quyết định sản phẩm).
     *
     * Ba trường này từng được parse vào đây nhưng KHÔNG có một consumer nào
     * trong toàn bộ apps/ — grep runtime trả về rỗng. Đồng thời BE Go
     * (`BuildProfile`) chưa bao giờ sinh chúng, nên cũng không có đường cấu
     * hình nào chạm tới. Kết quả là một tính năng chỉ tồn tại ở lớp parser:
     * nhận cấu hình, báo lỗi khi thiếu `bacnet_object_type`, rồi không làm gì
     * cả — đúng thứ tệ nhất, vì nó khiến người vận hành tin rằng đã bật được
     * BACnet exposure cho Point Modbus RTU.
     *
     * Đưa Modbus RTU Point ra BACnet là phạm vi Rev B và phải implement
     * end-to-end (BE sinh field → iobus map sang object → core publish) TRƯỚC
     * khi mở lại field. `parse_point()` vẫn ĐỌC khoá cũ để cảnh báo
     * deprecated/ignored, phục vụ migration cấu hình cũ. */
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
