#ifndef HMI_SCREEN_BASE_HPP
#define HMI_SCREEN_BASE_HPP

#include <cstdint>
#include <atomic>
#include <mutex>
#include <array>
#include <string>
#include <cinttypes>
#include <cstdio>
#include <future>

#include <lvgl.h>

#include "data/shm_reader.hpp"
#include "data/point_db.hpp"
#include "i18n/locale.hpp"
#include "api/hmi_api_client.hpp"

namespace hmi {

inline const lv_font_t*& hmi_font_slot()
{
    static const lv_font_t* font = &lv_font_montserrat_14;
    return font;
}

inline void set_hmi_font(const lv_font_t* font)
{
    if (font) hmi_font_slot() = font;
}

inline const lv_font_t* hmi_font() { return hmi_font_slot(); }

/* Abstract base for the five limited-operator HMI surfaces. */
class ScreenBase {
public:
    virtual ~ScreenBase() = default;

    /* Create all LVGL objects as children of root_ (called once). */
    virtual void build(lv_obj_t* root, const Locale& l, const PointDb& db) = 0;

    /* Called from 1s lv_timer with fresh SHM data. */
    virtual void on_data_update(const DataCache& c, const PointDb& db,
                                const Locale& l) = 0;

    /* Called from 5s lv_timer with system/network data. */
    virtual void on_sys_update(const SysSnapshot& /*s*/, const Locale& /*l*/) {}

    /* Called on SIGHUP locale reload — re-set all static label texts. */
    virtual void rebuild_labels(const Locale& /*l*/) {}
    virtual void on_key(uint32_t /*key*/, lv_indev_state_t /*state*/) {}

    lv_obj_t* root() const { return root_; }

protected:
    lv_obj_t* root_ = nullptr;

    /* Helper: uptime seconds → "Xd Yh Zm" string */
    static void fmt_uptime(char* buf, size_t n, uint32_t uptime_s)
    {
        uint32_t d = uptime_s / 86400u;
        uint32_t h = (uptime_s % 86400u) / 3600u;
        uint32_t m = (uptime_s % 3600u) / 60u;
        if (d > 0)
            snprintf(buf, n, "%ud %uh %um", d, h, m);
        else if (h > 0)
            snprintf(buf, n, "%uh %um", h, m);
        else
            snprintf(buf, n, "%um", m);
    }

    /* Helper: age_ns → "120ms" or "2.3s" string */
    static void fmt_age(char* buf, size_t n, uint64_t age_ns)
    {
        if (age_ns == UINT64_MAX)  { snprintf(buf, n, "---");       return; }
        if (age_ns < 1000000000ull){ snprintf(buf, n, "%" PRIu64 "ms", static_cast<uint64_t>(age_ns / 1000000ull)); return; }
        double s = static_cast<double>(age_ns) / 1e9;
        snprintf(buf, n, "%.1fs", s);
    }
};

/* ---- Alarm model (4-state ring, shared between screen and tests) ---- */

enum class AlarmSeverity : uint8_t { INFO=0, WARN=1, FAULT=2 };
enum class AlarmState    : uint8_t {
    ACTIVE_UNACK  = 0,
    ACTIVE_ACK    = 1,
    CLEARED_UNACK = 2,
    CLEARED_ACK   = 3,
};

struct AlarmEntry {
    char          ts[24]     = {};
    char          code[32]   = {};
    char          source[16] = {};
    char          msg[80]    = {};
    AlarmSeverity severity   = AlarmSeverity::INFO;
    AlarmState    state      = AlarmState::CLEARED_ACK;
    bool          used       = false;
};

class AlarmModel {
public:
    static constexpr int RING = 10;

    explicit AlarmModel(HmiApiClient* api = nullptr) : api_(api) {}
    ~AlarmModel();

    /* Existing system alarm bus subscriber; non-blocking and polled by LVGL thread. */
    bool open_socket(const std::string& path = "/run/mkddc/alarm.sock");
    void close_socket();
    void drain_socket();
    void refresh_async();
    void poll_api();

    /* Parse JSON datagram from alarm.sock and add/update entry. */
    void on_alarm_json(const char* buf, size_t len);
    void update_condition(const char* code, bool active, AlarmSeverity severity,
                          const char* source, const char* message, const char* ts = "");

    /* ACK luôn gửi broker/Core; không thay đổi state cục bộ trước response. */
    void ack(int idx);
    bool can_ack(int idx) const;

    /* Locked snapshot for render. Returns count of used entries. */
    std::array<AlarmEntry, RING> snapshot(int* count) const;

    /* Summary counts. */
    int active_count()   const;   /* ACTIVE_UNACK + ACTIVE_ACK */
    int unacked_count()  const;   /* ACTIVE_UNACK + CLEARED_UNACK */
    int critical_count() const;   /* FAULT severity + ACTIVE_* */

    /* Số khung alarm bị loại: JSON không parse được, hoặc parse được nhưng
     * thiếu "code". Mỗi khung bị loại cũng ghi một dòng ERR ra stderr. */
    uint64_t dropped_frame_count() const;

private:
    mutable std::mutex mtx_;
    AlarmEntry ring_[RING]{};
    int head_  = 0;
    int count_ = 0;
    int socket_fd_ = -1;
    std::string socket_path_;
    HmiApiClient* api_ = nullptr;
    std::future<ApiReply> api_pending_;
    bool ack_pending_ = false;
    bool hydrated_ = false;
    std::atomic<uint64_t> dropped_frames_{0};

    int find_code(const char* code);   /* returns idx or -1 */

    /* Ghi một dòng ERR ra stderr và tăng bộ đếm khung bị loại. */
    void drop_frame(const char* reason);
};

} // namespace hmi

#endif
