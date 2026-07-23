#ifndef HMI_SCREEN_CONTROL_HPP
#define HMI_SCREEN_CONTROL_HPP

#include "api/hmi_api_client.hpp"
#include "screens/screen_base.hpp"

#include <future>

namespace hmi {

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

    std::string point_id() const;
    double effective_value() const;
    void adjust(double delta);
    void cycle_point();
    void cycle_reason();
    void launch(const std::string& action, const std::string& mode = {});
    void query();
    void poll();
    void render();
};

} // namespace hmi

#endif
