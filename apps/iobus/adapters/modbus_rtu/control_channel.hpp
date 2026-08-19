/**
 * @file  control_channel.hpp
 * @brief MBR-B105/B106/B108: kênh điều khiển UDS SOCK_STREAM của fieldbus.
 *
 * Vì sao SOCK_STREAM chứ không phải datagram như đường snapshot: ApplyConfig
 * cần **biết chắc** iobus đã nhận và đã áp dụng (ACK), còn datagram thì mất gói
 * là im lặng. Một lệnh apply mất gói mà BE tưởng thành công sẽ để BE và iobus
 * chạy hai cấu hình khác nhau — đúng loại lỗi mà OD-MBRTU-015/Đ-03 bắt phải
 * loại bỏ.
 *
 * Giao thức: JSON một dòng (`\n` phân cách), request → response 1-1.
 * Bảo vệ bắt buộc:
 *   - **Peer credential** (SO_PEERCRED): chỉ root hoặc chính uid của tiến trình
 *     iobus được nói chuyện. Socket nằm trong filesystem nên quyền file không
 *     đủ: một tiến trình cùng máy vẫn có thể connect nếu mode quá rộng.
 *   - **Frame có trần** (`kMaxFrameBytes`): một client lỗi gửi dòng không kết
 *     thúc sẽ làm iobus nuốt RAM tới khi OOM, kéo theo cả IOP.
 */
#ifndef IOBUS_CONTROL_CHANNEL_HPP
#define IOBUS_CONTROL_CHANNEL_HPP

#include <atomic>
#include <cstdint>
#include <functional>
#include <string>
#include <thread>

namespace iobus::fieldbus {

/* 64 KiB: dư cho mọi lệnh điều khiển hiện có (lệnh dài nhất là ApplyConfig và
 * nó chỉ chở revision + checksum + đường dẫn file, không chở payload cấu hình). */
constexpr size_t kMaxFrameBytes = 64u * 1024u;

struct ControlWriteRequest {
    std::string request_id;
    uint8_t  slave_addr = 0;
    uint8_t  bus_id     = 0;    /* 0 = tự tra theo slave_addr */
    uint8_t  fc         = 6;
    uint16_t reg_addr   = 0;
    double   value      = 0.0;
    uint32_t deadline_ms = 0;
    bool     readback   = false;
};

struct ControlProbeResult {
    bool        ok = false;
    std::string reason;
    double      value = 0.0;
    uint8_t     exception_code = 0;
    uint32_t    elapsed_us = 0;
};

struct ControlHandlers {
    /* Trả JSON object (không có dấu ngoặc ngoài) mô tả trạng thái hiện tại. */
    std::function<std::string()> status_fields;
    /* `T57-3.9`: trả JSON mảng khung gần nhất. `bus_filter = 0` là mọi bus.
       CHỈ-ĐỌC — không phát gì ra dây (`ADR-046` điều 1). */
    std::function<std::string(uint8_t /*bus_filter*/, int /*limit*/)> frames_json;
    /* Nạp lại cấu hình tại ranh giới giữa hai transaction. Trả false ⇒ REJECT
     * và iobus GIỮ generation cũ đang chạy (FW_SOM_DESIGN §9). */
    std::function<bool(uint64_t /*revision*/, const std::string& /*checksum*/,
                       const std::string& /*path*/, std::string* /*reason*/,
                       uint64_t* /*applied_revision*/, uint64_t* /*generation*/)> apply_config;
    std::function<bool(const ControlWriteRequest&, std::string* /*reason*/)> submit_write;
    std::function<ControlProbeResult(uint8_t /*bus_id*/, uint8_t /*slave*/, uint8_t /*fc*/,
                                     uint16_t /*addr*/, uint16_t /*count*/,
                                     uint32_t /*timeout_ms*/)> probe_read;
};

class ControlChannel {
public:
    ~ControlChannel();

    bool start(const std::string& sock_path, ControlHandlers handlers);
    void stop();
    bool running() const { return listen_fd_ >= 0; }

    /* Xử lý MỘT dòng request — tách ra để test được mà không cần socket. */
    std::string handle_line(const std::string& line) const;

private:
    void serve();

    int               listen_fd_ = -1;
    std::string       sock_path_;
    std::thread       thread_;
    std::atomic<bool> stop_{false};
    ControlHandlers   handlers_;
};

/* Trích giá trị từ JSON phẳng — dùng chung với control channel và test. */
bool json_get_string(const std::string& s, const char* key, std::string* out);
bool json_get_number(const std::string& s, const char* key, double* out);
bool json_get_bool(const std::string& s, const char* key, bool* out);
/* Escape chuỗi cho JSON output (quote, backslash, ký tự điều khiển). */
std::string json_escape(const std::string& in);

} // namespace iobus::fieldbus

#endif /* IOBUS_CONTROL_CHANNEL_HPP */
