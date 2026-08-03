#ifndef HMI_GPIO_BUTTONS_HPP
#define HMI_GPIO_BUTTONS_HPP

#include <atomic>
#include <cstdint>
#include <cstddef>
#include <functional>
#include <poll.h>
#include <pthread.h>

#include <lvgl.h>

namespace hmi {

class ScreenSaver;

struct KeyEvent {
    lv_key_t         key;
    lv_indev_state_t state;
};

/* Lock-free SPSC ring for GPIO→LVGL key events.
 * GPIO thread pushes; LVGL main thread pops. */
class KeyQueue {
public:
    static constexpr size_t CAP = 16;

    bool push(KeyEvent ev);     /* GPIO thread */
    bool pop(KeyEvent* out);    /* LVGL thread */
    bool empty() const;

private:
    std::atomic<uint32_t> head_{0};
    std::atomic<uint32_t> tail_{0};
    KeyEvent buf_[CAP]{};
};

struct BtnDesc {
    int      gpio_num;
    lv_key_t lv_key;
    bool     pressed    = false;
    uint32_t last_ev_ms = 0;
    bool     suppressed = false;
};

/* 6-GPIO sysfs button driver with 20ms debounce.
 * Poll thread runs in background; LVGL reads via pop_key(). */
class GpioButtons {
public:
    static constexpr int N = 6;
    ~GpioButtons() { stop(); }

    /* GPIO numbers: UP=32, DOWN=33, LEFT=34, RIGHT=35, ENTER=36, ESC=37 */
    bool init();
    bool start();
    void stop();

    bool pop_key(KeyEvent* out) { return queue_.pop(out); }
    bool key_empty() const      { return queue_.empty(); }

    void set_screensaver(ScreenSaver* ss) { ss_ = ss; }
    void set_key_callback(std::function<void(uint32_t, lv_indev_state_t)> cb) { key_cb_ = std::move(cb); }
    void dispatch_key(uint32_t key, lv_indev_state_t state) { if (key_cb_) key_cb_(key, state); }

    /* pthread entry */
    static void* thread_fn(void* self);

private:
    void poll_once();

    BtnDesc btns_[N] = {
        {32, LV_KEY_UP},
        {33, LV_KEY_DOWN},
        {34, LV_KEY_LEFT},
        {35, LV_KEY_RIGHT},
        {36, LV_KEY_ENTER},
        {37, LV_KEY_ESC},
    };

    struct pollfd fds_[N]{};
    KeyQueue queue_;
    std::atomic<bool> running_{false};
    pthread_t thread_{};
    bool thread_started_ = false;
    ScreenSaver* ss_ = nullptr;
    std::function<void(uint32_t, lv_indev_state_t)> key_cb_;
};

lv_indev_t* lvgl_btn_indev_create(GpioButtons* ctx);

} // namespace hmi

#endif
