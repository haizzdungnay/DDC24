#ifndef HMI_SCREEN_SYSTEM_HPP
#define HMI_SCREEN_SYSTEM_HPP

#include "screens/screen_base.hpp"

namespace hmi {

class ScreenSystem final : public ScreenBase {
public:
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void on_sys_update(const SysSnapshot& s, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;

private:
    lv_obj_t* title_ = nullptr;
    lv_obj_t* firmware_ = nullptr;
    lv_obj_t* runtime_ = nullptr;
    lv_obj_t* resource_ = nullptr;
    lv_obj_t* process_ = nullptr;
    lv_obj_t* watchdog_ = nullptr;
    SysSnapshot sys_{};
    DataCache data_{};
    const PointDb* db_ = nullptr;
    const Locale* locale_ = nullptr;
    void render();
};

} // namespace hmi
#endif
