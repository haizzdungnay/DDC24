#include "api/hmi_api_client.hpp"
#include "data/point_db.hpp"
#include "data/shm_reader.hpp"
#include "drm/drm_init.hpp"
#include "drm/lv_drm_display.hpp"
#include "i18n/locale.hpp"
#include "input/evdev_touch.hpp"
#include "input/gpio_buttons.hpp"
#include "platform/systemd_notify.hpp"
#include "screens/screen_alarm.hpp"
#include "screens/screen_control.hpp"
#include "screens/screen_home.hpp"
#include "screens/screen_io.hpp"
#include "screens/screen_service.hpp"
#include "ui/fault_banner.hpp"
#include "ui/nav_controller.hpp"
#include "ui/screen_saver.hpp"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <string>
#include <thread>

#include <csignal>
#include <unistd.h>

namespace {

std::atomic<bool> g_shutdown{false};
std::atomic<bool> g_reload{false};

void signal_handler(int sig)
{
    if (sig == SIGHUP) g_reload.store(true);
    else g_shutdown.store(true);
}

struct RuntimeConfig {
    std::string font_path = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf";
    std::string hmi_socket = "/run/mkddc/hmi-api.sock";
};

std::string trim(std::string value)
{
    const size_t first = value.find_first_not_of(" \t\r");
    if (first == std::string::npos) return {};
    const size_t last = value.find_last_not_of(" \t\r");
    return value.substr(first, last - first + 1);
}

RuntimeConfig load_runtime_config(const std::string& path)
{
    RuntimeConfig cfg;
    std::ifstream f(path);
    std::string line;
    while (std::getline(f, line)) {
        const size_t eq = line.find('=');
        if (eq == std::string::npos) continue;
        const std::string key = trim(line.substr(0, eq));
        const std::string value = trim(line.substr(eq + 1));
        if (key == "font_path") cfg.font_path = value;
        else if (key == "hmi_socket") cfg.hmi_socket = value;
    }
    return cfg;
}

uint64_t monotonic_ms()
{
    using namespace std::chrono;
    return static_cast<uint64_t>(duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count());
}

} // namespace

int main(int argc, char** argv)
{
    std::string drm_path = "/dev/dri/card0";
    std::string touch_path = "/dev/input/touchscreen0";
    std::string point_db_path = "/data/config/point_db.json";
    std::string hmi_conf_path = "/etc/mkddc/hmi.conf";
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--drm" && i + 1 < argc) drm_path = argv[++i];
        else if (a == "--touch" && i + 1 < argc) touch_path = argv[++i];
        else if (a == "--point-db" && i + 1 < argc) point_db_path = argv[++i];
        else if (a == "--config" && i + 1 < argc) hmi_conf_path = argv[++i];
        else if (a == "--help") {
            std::printf("usage: mkddc-hmi [--drm PATH] [--touch PATH] [--point-db FILE] "
                        "[--config FILE]\n");
            return 0;
        }
    }

    struct sigaction sa{};
    sa.sa_handler = signal_handler;
    sigaction(SIGTERM, &sa, nullptr);
    sigaction(SIGINT, &sa, nullptr);
    sigaction(SIGHUP, &sa, nullptr);

    lv_init();
    lv_font_t* noto = nullptr;
    RuntimeConfig runtime_cfg = load_runtime_config(hmi_conf_path);
    if (lv_freetype_init(256) == LV_RESULT_OK) {
        noto = lv_freetype_font_create(runtime_cfg.font_path.c_str(),
                    LV_FREETYPE_FONT_RENDER_MODE_BITMAP, 14,
                    LV_FREETYPE_FONT_STYLE_NORMAL);
        if (noto) hmi::set_hmi_font(noto);
    }

    hmi::DrmContext drm;
    if (!hmi::drm_init(&drm, drm_path.c_str())) {
        std::fprintf(stderr, "ERROR hmi.start drm_init_failed\n");
        return 1;
    }
    lv_display_t* display = hmi::lvgl_drm_display_create(&drm);
    hmi::ScreenSaver saver(display);

    hmi::Locale locale;
    locale.load(hmi_conf_path);
    hmi::PointDb point_db;
    point_db.load(point_db_path);
    hmi::ShmReader shm;
    shm.attach();
    hmi::HmiApiClient hmi_api(runtime_cfg.hmi_socket);
    hmi::AlarmModel alarms(&hmi_api);
    alarms.open_socket();

    hmi::FaultBanner fault_banner;
    hmi::NavController nav(&saver, &fault_banner);
    std::array<std::unique_ptr<hmi::ScreenBase>, 5> screens;
    screens[0] = std::make_unique<hmi::ScreenHome>(&alarms);
    screens[1] = std::make_unique<hmi::ScreenIo>();
    screens[2] = std::make_unique<hmi::ScreenControl>(&hmi_api);
    screens[3] = std::make_unique<hmi::ScreenAlarm>(&alarms);
    screens[4] = std::make_unique<hmi::ScreenService>(&hmi_api);
    nav.build(locale, point_db, std::move(screens));
    fault_banner.create(&saver, locale);

    hmi::EvdevTouch touch;
    touch.set_screensaver(&saver);
    touch.set_display_size(lv_display_get_horizontal_resolution(display),
                           lv_display_get_vertical_resolution(display));
    touch.open(touch_path.c_str());
    hmi::lvgl_touch_indev_create(&touch, display);

    hmi::GpioButtons buttons;
    buttons.set_screensaver(&saver);
    buttons.set_key_callback([&](uint32_t key, lv_indev_state_t state) {
        nav.on_key(key, state);
    });
    buttons.start();
    hmi::lvgl_btn_indev_create(&buttons);

    hmi::SystemdNotify notify;
    notify.ready();
    uint64_t last_loop = monotonic_ms();
    uint64_t next_fast = last_loop;
    uint64_t next_slow = last_loop;
    uint64_t next_alarm = last_loop;
    hmi::DataCache data;
    hmi::SysSnapshot sys;
    bool io_fault_was_active = false;
    bool mcu_fault_was_active = false;

    while (!g_shutdown.load()) {
        const uint64_t now = monotonic_ms();
        const uint32_t delta = static_cast<uint32_t>(now - last_loop);
        if (delta) { lv_tick_inc(delta); last_loop = now; }

        if (g_reload.exchange(false)) {
            const std::string previous_socket = runtime_cfg.hmi_socket;
            runtime_cfg = load_runtime_config(hmi_conf_path);
            if (runtime_cfg.hmi_socket != previous_socket)
                hmi_api.set_socket_path(runtime_cfg.hmi_socket);
            locale.reload();
            point_db.reload(point_db_path);
            nav.rebuild_labels(locale);
            fault_banner.rebuild_label(locale);
        }
        if (now >= next_fast) {
            if (!shm.attached_io() || !shm.attached_plc()) shm.attach();
            shm.read_all(&data);
            const bool io_fault = data.iop_status == KX_IOP_FAULT;
            if (io_fault || io_fault_was_active)
                alarms.update_condition("E001", io_fault, hmi::AlarmSeverity::FAULT,
                                        "IOP", "I/O communication fault");
            io_fault_was_active = io_fault;
            const bool mcu_fault = data.fault_flags != 0;
            if (mcu_fault || mcu_fault_was_active)
                alarms.update_condition("E002", mcu_fault, hmi::AlarmSeverity::FAULT,
                                        "MCU", "MCU fault flags active");
            mcu_fault_was_active = mcu_fault;
            nav.on_data_update(data, point_db, locale);
            nav.tick_clock();
            fault_banner.update(data.iop_status);
            notify.watchdog_kick();
            next_fast = now + 1000u;
        }
        if (now >= next_alarm) {
            alarms.drain_socket();
            alarms.poll_api();
            alarms.refresh_async();
            next_alarm = now + 1000u;
        }
        if (now >= next_slow) {
            hmi::sys_snapshot_update(&sys);
            nav.on_sys_update(sys, locale);
            next_slow = now + 5000u;
        }
        saver.process_pending_wake();
        saver.check();
        lv_timer_handler();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    buttons.stop();
    touch.close_dev();
    hmi::drm_destroy(&drm);
    if (noto) lv_freetype_font_delete(noto);
    lv_freetype_uninit();
    return 0;
}
