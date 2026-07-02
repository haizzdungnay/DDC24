#include "ui/screen_saver.hpp"

#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <unistd.h>

namespace hmi {

void ScreenSaver::backlight_set_pct(int pct)
{
    int max_brightness = 100;
    int max_fd = open("/sys/class/backlight/backlight0/max_brightness", O_RDONLY | O_CLOEXEC);
    if (max_fd >= 0) {
        char max_buf[16]{};
        const ssize_t r = read(max_fd, max_buf, sizeof(max_buf) - 1);
        close(max_fd);
        if (r > 0) {
            const int parsed = std::atoi(max_buf);
            if (parsed > 0) max_brightness = parsed;
        }
    }
    const int value = (max_brightness * pct) / 100;
    char buf[8];
    int n = snprintf(buf, sizeof(buf), "%d\n", value);
    int fd = open("/sys/class/backlight/backlight0/brightness", O_WRONLY | O_CLOEXEC);
    if (fd >= 0) {
        const ssize_t written = write(fd, buf, static_cast<size_t>(n));
        (void)written;
        close(fd);
    }
}

void ScreenSaver::check()
{
    uint32_t idle = lv_display_get_inactive_time(disp_);   /* LVGL v9 API */
    if (!active_.load() && idle >= TIMEOUT_MS) {
        active_.store(true);
        backlight_set_pct(DIM_PCT);
    }
}

void ScreenSaver::wake()
{
    if (!active_.exchange(false)) return;
    backlight_set_pct(NORMAL_PCT);
    /* Reset LVGL's internal activity timer so check() doesn't immediately re-trigger */
    lv_display_trigger_activity(disp_);
}

void ScreenSaver::process_pending_wake()
{
    if (wake_requested_.exchange(false)) wake();
}

void ScreenSaver::force_wake()
{
    active_.store(false);
    backlight_set_pct(FAULT_PCT);
    lv_display_trigger_activity(disp_);
}

void ScreenSaver::clear_fault()
{
    active_.store(false);
    backlight_set_pct(NORMAL_PCT);
    lv_display_trigger_activity(disp_);
}

} // namespace hmi
