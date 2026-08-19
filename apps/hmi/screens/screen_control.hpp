#ifndef HMI_SCREEN_CONTROL_HPP
#define HMI_SCREEN_CONTROL_HPP

#include "api/hmi_api_client.hpp"
#include "screens/screen_base.hpp"

#include <future>

namespace hmi {

/** Số giây còn lại của lệnh ép tay để HIỂN THỊ — `T57-3.19`.
 *
 *  Tách thành hàm thuần để khoá được bằng test: quy tắc quan trọng nhất ở đây
 *  là quy tắc AN TOÀN, không phải phép trừ.
 *
 *  @param known    Core có báo `overrideExpiresInS` ở lần poll gần nhất không.
 *  @param ttl_s    Giá trị Core báo.
 *  @param elapsed_ms Thời gian trôi qua kể từ lúc nhận giá trị đó.
 *  @param link_up  Đường tới authority còn sống không.
 *  @return Số giây còn lại, hoặc `-1` nghĩa là **không rõ**.
 *
 *  `-1` khi mất liên lạc hoặc khi số liệu đã quá cũ: một đồng hồ vẫn chạy sau
 *  khi kết nối chết là khẳng định một điều mình không còn biết. Đây là cùng
 *  luật mà `shared/overview/overrides.ts` cưỡng chế ở phía web (PA3-107). */
int override_remaining_seconds(bool known, uint32_t ttl_s, uint32_t elapsed_ms, bool link_up);

/** Ngưỡng coi số liệu TTL là quá cũ: ba nhịp poll 3 s cộng dư cho một lần lỡ nhịp. */
inline constexpr uint32_t kOverrideTtlStaleMs = 10000u;

class ScreenControl final : public ScreenBase {
public:
    explicit ScreenControl(HmiApiClient* api) : api_(api) {}
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;
    void on_key(uint32_t key, lv_indev_state_t state) override;
    static void event_cb(lv_event_t* e);

private:
    HmiApiClient* api_ = nullptr;
    const Locale* locale_ = nullptr;
    DataCache cache_{};
    int selected_ = 0;
    int reason_ = 0;
    double requested_ = 0.0;
    bool dirty_ = false;
    std::string confirm_action_;
    uint32_t confirm_until_ms_ = 0;
    std::future<ApiReply> pending_;
    bool pending_query_ = false;
    uint32_t next_query_ms_ = 0;
    std::string status_ = "READ ONLY";

    /* `T57-3.19` — đếm ngược TTL lệnh ép tay.
     *
     * TTL do CORE cấp (PA3-107). Ở đây chỉ giữ giá trị Core vừa báo cùng mốc
     * `lv_tick` lúc nhận, rồi trừ dần để hiển thị GIỮA HAI LẦN POLL. Đây là
     * trình bày, không phải nguồn chân lý: mỗi lần poll thành công lại đặt lại
     * từ Core.
     *
     * Ràng buộc quan trọng nhất: khi kết nối chết thì **ngừng đếm** và nói là
     * không rõ. Một đồng hồ vẫn chạy khi đã mất liên lạc là khẳng định một điều
     * mình không còn biết — đúng lỗi mà `shared/overview/overrides.ts` cấm ở
     * phía web. */
    bool override_ttl_known_ = false;
    uint32_t override_ttl_s_ = 0;
    uint32_t override_ttl_at_ms_ = 0;

    /* `T57-3.20` — số phiên web đang mở, do broker gắn vào mọi phản hồi đã xác
     * thực. `-1` = chưa biết (chưa có phản hồi nào), khác hẳn `0` = không ai. */
    int web_sessions_ = -1;

    lv_obj_t* title_ = nullptr;
    lv_obj_t* point_btn_ = nullptr;
    lv_obj_t* point_label_ = nullptr;
    lv_obj_t* minus_btn_ = nullptr;
    lv_obj_t* plus_btn_ = nullptr;
    lv_obj_t* reason_btn_ = nullptr;
    lv_obj_t* reason_label_ = nullptr;
    lv_obj_t* auto_btn_ = nullptr;
    lv_obj_t* auto_label_ = nullptr;
    lv_obj_t* manual_btn_ = nullptr;
    lv_obj_t* manual_label_ = nullptr;
    lv_obj_t* override_btn_ = nullptr;
    lv_obj_t* override_label_ = nullptr;
    lv_obj_t* setpoint_btn_ = nullptr;
    lv_obj_t* setpoint_label_ = nullptr;
    lv_obj_t* release_btn_ = nullptr;
    lv_obj_t* release_label_ = nullptr;
    lv_obj_t* status_label_ = nullptr;
    lv_obj_t* override_ttl_label_ = nullptr;

    std::string point_id() const;
    double effective_value() const;
    void adjust(double delta);
    void cycle_point();
    void cycle_reason();
    void launch(const std::string& action, const std::string& mode = {});
    void query();
    /** Số giây còn lại của lệnh ép tay, hoặc `-1` khi không biết. */
    int override_remaining_s() const;
    void poll();
    void render();
};

} // namespace hmi

#endif
