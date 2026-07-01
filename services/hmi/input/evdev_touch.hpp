#ifndef HMI_EVDEV_TOUCH_HPP
#define HMI_EVDEV_TOUCH_HPP

#include <lvgl.h>

namespace hmi {

class ScreenSaver;

/* FT5436 capacitive touch via evdev (/dev/input/touchscreen0).
 * Reports ABS_MT_POSITION_X/Y in portrait coords (240×320) → mapped to landscape. */
class EvdevTouch {
public:
    ~EvdevTouch() { close_dev(); }

    bool open(const char* dev = "/dev/input/touchscreen0");
    void close_dev();
    bool is_open() const { return fd_ >= 0; }

    /* Called from LVGL indev read_cb (main thread only). */
    void read(lv_indev_data_t* data);

    void set_screensaver(ScreenSaver* ss) { ss_ = ss; }

    /* Display resolution for coordinate transform. */
    void set_display_size(int32_t w, int32_t h) { disp_w_ = w; disp_h_ = h; }

    static lv_point_t map_portrait_point(int32_t raw_x, int32_t raw_y,
                                         int32_t x_min, int32_t x_max,
                                         int32_t y_min, int32_t y_max,
                                         int32_t display_w, int32_t display_h);

private:
    int      fd_      = -1;
    int32_t  raw_x_   = 0;   /* current ABS_MT_POSITION_X */
    int32_t  raw_y_   = 0;
    int32_t  raw_x_min_ = 0;
    int32_t  raw_x_max_ = 239;
    int32_t  raw_y_min_ = 0;
    int32_t  raw_y_max_ = 319;
    bool     pressed_ = false;
    bool     suppress_until_release_ = false;
    int32_t  disp_w_  = 320;
    int32_t  disp_h_  = 240;
    ScreenSaver* ss_  = nullptr;
};

lv_indev_t* lvgl_touch_indev_create(EvdevTouch* ctx, lv_display_t* display);

} // namespace hmi

#endif
