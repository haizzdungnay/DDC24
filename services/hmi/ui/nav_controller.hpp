#ifndef HMI_NAV_CONTROLLER_HPP
#define HMI_NAV_CONTROLLER_HPP

#include <array>
#include <memory>
#include <cstdint>

#include <lvgl.h>

#include "data/shm_reader.hpp"
#include "data/point_db.hpp"
#include "i18n/locale.hpp"
#include "screens/screen_base.hpp"
#include "ui/screen_saver.hpp"
#include "ui/fault_banner.hpp"

namespace hmi {

enum class ScreenId : int {
    SCR_HOME    = 0,
    SCR_POINTS  = 1,
    SCR_CONTROL = 2,
    SCR_ALARM   = 3,
    SCR_SERVICE = 4,
    SCR_COUNT   = 5
};

/* Container for the 5 operator surfaces + tab strip.
 * All LVGL UI lives here; screens are built once at init. */
class NavController {
public:
    NavController(ScreenSaver* ss, FaultBanner* fb);
    ~NavController();

    /* Build all 5 screens (call once after lv_init). */
    void build(const Locale& l, const PointDb& db,
               std::array<std::unique_ptr<ScreenBase>, 5> screens);

    /* Navigate one page left/right. */
    void navigate_left();
    void navigate_right();
    void navigate_to(ScreenId id);

    ScreenId current() const { return cur_; }
    static ScreenId left_of(ScreenId id);
    static ScreenId right_of(ScreenId id);

    /* Dispatch to active screen + update tab/clock. */
    void on_data_update(const DataCache& c, const PointDb& db, const Locale& l);
    void on_sys_update(const SysSnapshot& s, const Locale& l);

    /* SIGHUP: reload all screen labels. */
    void rebuild_labels(const Locale& l);

    /* Called on key event from gpio_buttons. */
    void on_key(uint32_t key, lv_indev_state_t state);

    /* Tick clock (call every second). */
    void tick_clock();

private:
    static constexpr int N = static_cast<int>(ScreenId::SCR_COUNT);

    std::array<std::unique_ptr<ScreenBase>, N> screens_{};
    std::array<lv_obj_t*, N>  lv_screens_   = {};
    std::array<lv_obj_t*, N>  tab_btns_     = {};
    std::array<lv_obj_t*, N>  tab_labels_   = {};

    lv_obj_t* tab_bar_    = nullptr;
    lv_obj_t* clock_lbl_  = nullptr;
    lv_obj_t* hint_lbl_   = nullptr;

    ScreenSaver* ss_      = nullptr;
    FaultBanner* fb_      = nullptr;
    ScreenId     cur_     = ScreenId::SCR_HOME;
    bool         built_   = false;

    void build_tab_bar_(const Locale& l);
    void set_tab_active_(ScreenId id);

    /* Swipe gesture event callback */
    static void gesture_cb_(lv_event_t* e);
    /* Tab button event callback */
    static void tab_btn_cb_(lv_event_t* e);
};

} // namespace hmi

#endif
