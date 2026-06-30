#ifndef HMI_SCREEN_SAVER_HPP
#define HMI_SCREEN_SAVER_HPP

#include <cstdint>
#include <atomic>

#include <lvgl.h>

namespace hmi {

/* Screen saver: dim backlight after 5 min idle.
 * First touch/keypress when active wakes the display but does NOT navigate. */
class ScreenSaver {
public:
    explicit ScreenSaver(lv_display_t* disp) : disp_(disp) {}

    /* Called from 100ms lv_timer (main thread). */
    void check();

    /* Wake from active saver state. Called by input drivers. */
    void wake();
    void request_wake() { wake_requested_.store(true); }
    void process_pending_wake();

    /* Force wake (e.g., FAULT banner). */
    void force_wake();

    bool active() const { return active_.load(); }
    void clear_fault();

    static constexpr uint32_t TIMEOUT_MS = 5u * 60u * 1000u;
    static constexpr int NORMAL_PCT = 80;
    static constexpr int DIM_PCT    = 10;
    static constexpr int FAULT_PCT  = 100;

private:
    lv_display_t* disp_;
    std::atomic<bool> active_{false};
    std::atomic<bool> wake_requested_{false};

    static void backlight_set_pct(int pct);
};

} // namespace hmi

#endif
