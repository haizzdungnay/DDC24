#ifndef HMI_SCREEN_SERVICE_HPP
#define HMI_SCREEN_SERVICE_HPP

#include "api/hmi_api_client.hpp"
#include "screens/screen_base.hpp"

#include <future>
#include <string>

namespace hmi {

class ScreenService final : public ScreenBase {
public:
    explicit ScreenService(HmiApiClient* api) : api_(api) {}
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void on_sys_update(const SysSnapshot& s, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;
    void on_key(uint32_t key, lv_indev_state_t state) override;

private:
    HmiApiClient* api_ = nullptr;
    const Locale* locale_ = nullptr;
    std::future<ApiReply> pending_;
    std::string status_ = "Login required for operator actions";
    std::string diagnostics_ = "Core: unknown";

    lv_obj_t* title_ = nullptr;
    lv_obj_t* session_ = nullptr;
    lv_obj_t* username_ = nullptr;
    lv_obj_t* password_ = nullptr;
    lv_obj_t* auth_btn_ = nullptr;
    lv_obj_t* auth_label_ = nullptr;
    lv_obj_t* status_label_ = nullptr;
    lv_obj_t* diagnostics_label_ = nullptr;
    lv_obj_t* keyboard_ = nullptr;

    void authenticate();
    void poll();
    void render();
    static void auth_cb(lv_event_t* e);
    static void focus_cb(lv_event_t* e);
    static void keyboard_cb(lv_event_t* e);
};

} // namespace hmi

#endif
