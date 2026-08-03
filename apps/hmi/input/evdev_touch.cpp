#include "input/evdev_touch.hpp"
#include "ui/screen_saver.hpp"

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>

#include <fcntl.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <linux/input.h>

namespace hmi {

lv_point_t EvdevTouch::map_portrait_point(int32_t raw_x, int32_t raw_y,
                                          int32_t x_min, int32_t x_max,
                                          int32_t y_min, int32_t y_max,
                                          int32_t display_w, int32_t display_h)
{
    const int32_t x_range = std::max(1, x_max - x_min);
    const int32_t y_range = std::max(1, y_max - y_min);
    const int32_t x = std::clamp(raw_x, x_min, x_max) - x_min;
    const int32_t y = std::clamp(raw_y, y_min, y_max) - y_min;
    return {y * (display_w - 1) / y_range,
            (x_range - x) * (display_h - 1) / x_range};
}

bool EvdevTouch::open(const char* dev)
{
    fd_ = ::open(dev, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd_ < 0) {
        std::fprintf(stderr, "WARN  hmi.evdev open(%s) failed: %s\n", dev, strerror(errno));
        return false;
    }
    struct input_absinfo abs{};
    if (::ioctl(fd_, EVIOCGABS(ABS_MT_POSITION_X), &abs) == 0 ||
        ::ioctl(fd_, EVIOCGABS(ABS_X), &abs) == 0) {
        raw_x_min_ = abs.minimum;
        raw_x_max_ = abs.maximum;
    }
    if (::ioctl(fd_, EVIOCGABS(ABS_MT_POSITION_Y), &abs) == 0 ||
        ::ioctl(fd_, EVIOCGABS(ABS_Y), &abs) == 0) {
        raw_y_min_ = abs.minimum;
        raw_y_max_ = abs.maximum;
    }
    std::fprintf(stderr, "INFO  hmi.evdev opened %s\n", dev);
    return true;
}

void EvdevTouch::close_dev()
{
    if (fd_ >= 0) { ::close(fd_); fd_ = -1; }
}

void EvdevTouch::read(lv_indev_data_t* data)
{
    struct input_event ev{};
    /* drain all pending events */
    while (::read(fd_, &ev, sizeof(ev)) == static_cast<ssize_t>(sizeof(ev))) {
        if (ev.type == EV_ABS) {
            if (ev.code == ABS_MT_POSITION_X || ev.code == ABS_X)
                raw_x_ = ev.value;
            else if (ev.code == ABS_MT_POSITION_Y || ev.code == ABS_Y)
                raw_y_ = ev.value;
        } else if (ev.type == EV_KEY && ev.code == BTN_TOUCH) {
            pressed_ = (ev.value != 0);
        } else if (ev.type == EV_SYN && ev.code == SYN_REPORT) {
            if (pressed_ && ss_ && ss_->active()) {
                suppress_until_release_ = true;
                ss_->wake();
            }
        }
    }

    /* Transform portrait panel coordinates to the same landscape rotation used
     * by the DRM flush path. EVIOCGABS handles controllers using non-pixel ranges. */
    data->point = map_portrait_point(raw_x_, raw_y_, raw_x_min_, raw_x_max_,
                                     raw_y_min_, raw_y_max_, disp_w_, disp_h_);
    if (suppress_until_release_) {
        data->state = LV_INDEV_STATE_RELEASED;
        if (!pressed_) suppress_until_release_ = false;
    } else {
        data->state = pressed_ ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
    }
}

static void evdev_read_cb(lv_indev_t* indev, lv_indev_data_t* data)
{
    auto* ctx = static_cast<EvdevTouch*>(lv_indev_get_user_data(indev));
    if (ctx->is_open())
        ctx->read(data);
    else
        data->state = LV_INDEV_STATE_RELEASED;
}

lv_indev_t* lvgl_touch_indev_create(EvdevTouch* ctx, lv_display_t* display)
{
    lv_indev_t* indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(indev, evdev_read_cb);
    lv_indev_set_user_data(indev, ctx);
    lv_indev_set_display(indev, display);
    return indev;
}

} // namespace hmi
