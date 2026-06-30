#ifndef HMI_SCREEN_SERVICE_HPP
#define HMI_SCREEN_SERVICE_HPP

#include "screens/screen_base.hpp"

#include <functional>

namespace hmi {

struct ServiceActions {
    std::function<bool()> reload_config;
    std::function<bool()> restart_services;
    std::function<bool()> safe_reboot;
    std::function<bool()> backup_config;
    std::function<bool()> restore_config;
};

class ScreenService final : public ScreenBase {
public:
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;
    void on_key(uint32_t key, lv_indev_state_t state) override;

    void set_access_policy(std::string expected_pin, bool service_switch,
                           std::string role);
    void set_actions(ServiceActions actions) { actions_ = std::move(actions); }
    bool try_unlock(const std::string& pin);
    void lock();
    bool unlocked() const { return unlocked_; }
    static bool role_allows_service(const std::string& role);
    static bool held_long_enough(uint32_t start_ms, uint32_t end_ms);

private:
    enum Action { RELOAD=0, RESTART=1, REBOOT=2, BACKUP=3, RESTORE=4, ACTION_COUNT=5 };
    const Locale* locale_ = nullptr;
    const PointDb* db_ = nullptr;
    std::string expected_pin_;
    std::string role_ = "View Only";
    bool service_switch_ = false;
    bool pin_unlocked_ = false;
    bool unlocked_ = false;
    int selected_action_ = 0;
    uint32_t reboot_press_ms_ = 0;
    ServiceActions actions_;

    lv_obj_t* title_ = nullptr;
    lv_obj_t* access_ = nullptr;
    lv_obj_t* project_ = nullptr;
    lv_obj_t* point_db_ = nullptr;
    lv_obj_t* safe_ = nullptr;
    lv_obj_t* status_ = nullptr;
    lv_obj_t* pin_ = nullptr;
    lv_obj_t* unlock_btn_ = nullptr;
    lv_obj_t* unlock_label_ = nullptr;
    lv_obj_t* action_btn_[ACTION_COUNT]{};
    lv_obj_t* action_label_[ACTION_COUNT]{};
    lv_obj_t* keyboard_ = nullptr;

    void render();
    void invoke_action(int action);
    void begin_reboot_hold();
    void finish_reboot_hold();
    static void unlock_cb(lv_event_t* e);
    static void action_cb(lv_event_t* e);
    static void pin_focus_cb(lv_event_t* e);
    static void keyboard_cb(lv_event_t* e);
};

} // namespace hmi
#endif
