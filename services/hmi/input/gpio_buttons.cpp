#include "input/gpio_buttons.hpp"
#include "ui/screen_saver.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>

#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

namespace hmi {

/* ---- KeyQueue ---- */

bool KeyQueue::push(KeyEvent ev)
{
    uint32_t h = head_.load(std::memory_order_relaxed);
    uint32_t t = tail_.load(std::memory_order_acquire);
    if (h - t >= CAP) return false;   /* full */
    buf_[h % CAP] = ev;
    head_.store(h + 1, std::memory_order_release);
    return true;
}

bool KeyQueue::pop(KeyEvent* out)
{
    uint32_t t = tail_.load(std::memory_order_relaxed);
    uint32_t h = head_.load(std::memory_order_acquire);
    if (t == h) return false;          /* empty */
    *out = buf_[t % CAP];
    tail_.store(t + 1, std::memory_order_release);
    return true;
}

bool KeyQueue::empty() const
{
    return head_.load(std::memory_order_acquire) ==
           tail_.load(std::memory_order_acquire);
}

/* ---- GPIO sysfs helpers ---- */

static uint32_t monotonic_ms()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint32_t>(ts.tv_sec * 1000u + ts.tv_nsec / 1000000u);
}

static bool sysfs_write(int fd, const char* data, size_t len)
{
    ssize_t written;
    do {
        written = write(fd, data, len);
    } while (written < 0 && errno == EINTR);
    return written == static_cast<ssize_t>(len);
}

static bool gpio_export(int gpio)
{
    char path[64];
    snprintf(path, sizeof(path), "/sys/class/gpio/gpio%d", gpio);
    if (access(path, F_OK) == 0) return true;   /* already exported */
    int fd = open("/sys/class/gpio/export", O_WRONLY);
    if (fd < 0) return false;
    char buf[8];
    int n = snprintf(buf, sizeof(buf), "%d", gpio);
    const bool ok = sysfs_write(fd, buf, static_cast<size_t>(n));
    close(fd);
    return ok;
}

static void gpio_set_direction(int gpio, const char* dir)
{
    char path[64];
    snprintf(path, sizeof(path), "/sys/class/gpio/gpio%d/direction", gpio);
    int fd = open(path, O_WRONLY);
    if (fd < 0) return;
    sysfs_write(fd, dir, strlen(dir));
    close(fd);
}

static void gpio_set_edge(int gpio, const char* edge)
{
    char path[64];
    snprintf(path, sizeof(path), "/sys/class/gpio/gpio%d/edge", gpio);
    int fd = open(path, O_WRONLY);
    if (fd < 0) return;
    sysfs_write(fd, edge, strlen(edge));
    close(fd);
}

/* ---- GpioButtons ---- */

bool GpioButtons::init()
{
    int opened = 0;
    for (int i = 0; i < N; i++) {
        gpio_export(btns_[i].gpio_num);
        gpio_set_direction(btns_[i].gpio_num, "in");
        gpio_set_edge(btns_[i].gpio_num, "both");

        char path[64];
        snprintf(path, sizeof(path),
                 "/sys/class/gpio/gpio%d/value", btns_[i].gpio_num);
        fds_[i].fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
        fds_[i].events = POLLPRI | POLLERR;
        if (fds_[i].fd < 0)
            std::fprintf(stderr, "WARN  hmi.gpio open gpio%d failed: %s\n",
                         btns_[i].gpio_num, strerror(errno));
        else
            opened++;
    }
    running_.store(true);
    return opened == N;
}

bool GpioButtons::start()
{
    const bool all_open = init();
    if (pthread_create(&thread_, nullptr, thread_fn, this) != 0) {
        running_.store(false);
        return false;
    }
    thread_started_ = true;
    return all_open;
}

void GpioButtons::stop()
{
    if (!running_.exchange(false) && !thread_started_) return;
    if (thread_started_) {
        pthread_join(thread_, nullptr);
        thread_started_ = false;
    }
    for (int i = 0; i < N; i++) {
        if (fds_[i].fd >= 0) { close(fds_[i].fd); fds_[i].fd = -1; }
    }
}

void GpioButtons::poll_once()
{
    poll(fds_, N, 50);   /* 50ms timeout */
    uint32_t now = monotonic_ms();
    char val[4];
    for (int i = 0; i < N; i++) {
        if (!(fds_[i].revents & POLLPRI)) continue;
        lseek(fds_[i].fd, 0, SEEK_SET);
        ssize_t r = ::read(fds_[i].fd, val, sizeof(val));
        if (r <= 0) continue;
        bool is_pressed = (val[0] == '0');   /* active-LOW */
        if (is_pressed == btns_[i].pressed) continue;
        if (now - btns_[i].last_ev_ms < 20u) continue;   /* debounce 20ms */
        btns_[i].pressed     = is_pressed;
        btns_[i].last_ev_ms  = now;
        if (is_pressed && ss_ && ss_->active()) {
            btns_[i].suppressed = true;
            ss_->request_wake();
            continue;
        }
        if (!is_pressed && btns_[i].suppressed) {
            btns_[i].suppressed = false;
            continue;
        }
        KeyEvent ev{btns_[i].lv_key,
                    is_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED};
        queue_.push(ev);
    }
}

void* GpioButtons::thread_fn(void* arg)
{
    auto* self = static_cast<GpioButtons*>(arg);
    while (self->running_.load()) self->poll_once();
    return nullptr;
}

/* ---- LVGL indev registration ---- */

static void gpio_btn_read_cb(lv_indev_t* indev, lv_indev_data_t* data)
{
    auto* ctx = static_cast<GpioButtons*>(lv_indev_get_user_data(indev));
    KeyEvent ev{};
    if (ctx->pop_key(&ev)) {
        data->key   = ev.key;
        data->state = ev.state;
        ctx->dispatch_key(ev.key, ev.state);
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

lv_indev_t* lvgl_btn_indev_create(GpioButtons* ctx)
{
    lv_indev_t* indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_KEYPAD);
    lv_indev_set_read_cb(indev, gpio_btn_read_cb);
    lv_indev_set_user_data(indev, ctx);
    return indev;
}

} // namespace hmi
