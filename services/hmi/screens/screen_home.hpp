#ifndef HMI_SCREEN_HOME_HPP
#define HMI_SCREEN_HOME_HPP

#include "screens/screen_base.hpp"

namespace hmi {

class ScreenHome final : public ScreenBase {
public:
    explicit ScreenHome(AlarmModel* alarms) : alarms_(alarms) {}
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void on_sys_update(const SysSnapshot& s, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;

private:
    AlarmModel* alarms_ = nullptr;
    lv_obj_t* title_ = nullptr;
    lv_obj_t* alarm_ = nullptr;
    lv_obj_t* health_ = nullptr;
    lv_obj_t* io_ = nullptr;
    lv_obj_t* comm_ = nullptr;
    lv_obj_t* config_ = nullptr;
    DataCache last_data_{};
    SysSnapshot last_sys_{};
    const PointDb* db_ = nullptr;
    const Locale* locale_ = nullptr;

    void render_data();
    void render_sys();
};

} // namespace hmi
#endif
