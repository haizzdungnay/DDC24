#ifndef HMI_SCREEN_COMM_HPP
#define HMI_SCREEN_COMM_HPP

#include "screens/screen_base.hpp"

namespace hmi {

class ScreenComm final : public ScreenBase {
public:
    void build(lv_obj_t* root, const Locale& l, const PointDb& db) override;
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l) override;
    void on_sys_update(const SysSnapshot& s, const Locale& l) override;
    void rebuild_labels(const Locale& l) override;

private:
    lv_obj_t* title_ = nullptr;
    lv_obj_t* ethernet_ = nullptr;
    lv_obj_t* bacnet_ = nullptr;
    lv_obj_t* modbus_ = nullptr;
    SysSnapshot sys_{};
    const Locale* locale_ = nullptr;
    void render();
};

} // namespace hmi
#endif
