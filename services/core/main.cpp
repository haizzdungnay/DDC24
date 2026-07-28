/**
 * @file  main.cpp (mkddc-core)
 * @brief Entry: init → SCHED_FIFO 80 → attach shm (retry) → scan loop 1s →
 *        sd_notify → signal. Core KHÔNG mở UART, KHÔNG tạo io_shm (07 §0).
 */
#include <atomic>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <string>

#include <pthread.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "ipc/config_reload.hpp"
#include "safety/safe_state_config.hpp"
#include "schedule/schedule_runtime.hpp"
#include "graph/scan_loop.hpp"
#include "graph/state_snapshot.hpp"

namespace {

std::atomic<bool> g_shutdown{false};
std::atomic<bool> g_reload{false};

void on_signal(int)
{
    g_shutdown.store(true);
}

void on_sighup(int)
{
    g_reload.store(true);   /* xử lý thật ở ranh giới scan (COR-008) */
}

} // namespace

/* gửi NOTIFY_SOCKET trực tiếp (copy pattern iobus platform/systemd_notify) */
#include <sys/socket.h>
#include <sys/un.h>
static void notify_systemd(const char* state)
{
    const char* sock = std::getenv("NOTIFY_SOCKET");
    if (!sock || !sock[0]) return;
    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, sock, sizeof(addr.sun_path) - 1);
    if (addr.sun_path[0] == '@') addr.sun_path[0] = '\0';
    const int fd = ::socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return;
    (void)!::sendto(fd, state, std::strlen(state), MSG_NOSIGNAL,
                    reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr));
    ::close(fd);
}

int main(int argc, char** argv)
{
    using namespace core;

    std::string sock_path = "/run/mkddc/core.sock";
    std::string fieldbus_sock_path = "/run/mkddc/fieldbus.sock";
    std::string graph_path = "/data/config/graph.json";
    std::string safe_cfg_path = "/data/config/io_safe_state.conf";
    std::string io_cfg_path = "/data/config/io_config.conf";
    std::string alarm_cfg_path = "/data/config/alarm_settings.conf";
    std::string schedule_cfg_path = "/data/config/schedule.conf";
    bool safe_cfg_from_cli = false;
    bool io_cfg_from_cli = false;
    bool scan_ms_from_cli = false;
    uint64_t period_ns = 1000000000ull;   /* scan 1s Rev A */
    int rt_prio = 80;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--log-level" && i + 1 < argc) { ++i; /* Rev A: log level cố định */ }
        else if (a == "--sock" && i + 1 < argc) sock_path = argv[++i];
        else if (a == "--fieldbus-sock" && i + 1 < argc) fieldbus_sock_path = argv[++i];
        else if (a == "--graph" && i + 1 < argc) graph_path = argv[++i];
        else if (a == "--safe-state-conf" && i + 1 < argc) { safe_cfg_path = argv[++i]; safe_cfg_from_cli = true; }
        else if (a == "--io-conf" && i + 1 < argc) { io_cfg_path = argv[++i]; io_cfg_from_cli = true; }
        else if (a == "--alarm-conf" && i + 1 < argc) alarm_cfg_path = argv[++i];
        else if (a == "--schedule-conf" && i + 1 < argc) schedule_cfg_path = argv[++i];
        else if (a == "--scan-ms" && i + 1 < argc) {
            const long long ms = std::atoll(argv[++i]);
            if (ms <= 0) {   /* 0/âm/không phải số → busy-spin SCHED_FIFO, fail-fast */
                std::fprintf(stderr, "ERROR core.bad_scan_ms '%s' (cần số nguyên ≥1)\n", argv[i]);
                return 1;
            }
            period_ns = static_cast<uint64_t>(ms) * 1000000ull;
            scan_ms_from_cli = true;
        }
        else if (a == "--help") {
            std::printf("usage: mkddc-core [--sock PATH] [--fieldbus-sock PATH] [--graph FILE]"
                        " [--safe-state-conf FILE] [--io-conf FILE] [--alarm-conf FILE]"
                        " [--schedule-conf FILE] [--scan-ms N]"
                        " [--log-level LVL]\n");
            return 0;
        }
    }

    /* scan_ms log SAU khi chốt với graph.json (tránh log giá trị không dùng) */
    std::fprintf(stderr, "INFO  core.start version=1.0.0 pid=%d\n", getpid());

    /* RT + mlockall — thiếu cap → degraded WARN */
    {
        struct sched_param sp {};
        sp.sched_priority = rt_prio;
        if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) != 0)
            std::fprintf(stderr, "WARN  rt.sched_fifo_fail prio=%d (degraded)\n", rt_prio);
        if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0)
            std::fprintf(stderr, "WARN  rt.mlockall_fail (degraded)\n");
    }

    struct sigaction sa {};
    sa.sa_handler = on_signal;
    sigaction(SIGTERM, &sa, nullptr);
    sigaction(SIGINT, &sa, nullptr);
    struct sigaction sa_hup {};
    sa_hup.sa_handler = on_sighup;
    sigaction(SIGHUP, &sa_hup, nullptr);   /* reload config — CONFIG_SCHEMA D-5 */

    /* Attach io_shm: retry 1s, WARN mỗi 10s; sau 30s vẫn chạy scan với quality=BAD
     * (safe-state áp) — 07 §7.1. ScanLoop sẽ tự re-attach mỗi scan nếu iobus lên muộn. */
    IobusReader reader;
    {
        int waited_s = 0;
        while (!g_shutdown.load() && !reader.attach()) {
            if (waited_s % 10 == 0)
                std::fprintf(stderr, "WARN  iobus_reader.waiting shm=%s (%ds)\n",
                             KX_SHM_IO_PATH, waited_s);
            if (waited_s >= 30) {
                std::fprintf(stderr, "WARN  iobus_reader.degraded chạy với quality=BAD"
                                     " (scan loop sẽ tự re-attach)\n");
                break;
            }
            sleep(1);
            waited_s++;
        }
        if (g_shutdown.load()) return 0;
    }

    PointTable table;
    PointQuality quality;
    WebIpc web;
    web.open(sock_path);
    GraphRuntime graph;
    StateSnapshot snap;
    graph.load(graph_path);
    /* COR-010: restore persist state ngay sau load boot */
    graph.restore_persist_state(snap.load());

    /* Đồng bộ scan period — 1 nguồn sự thật:
     * - có graph + KHÔNG --scan-ms → chu kỳ scan core LẤY TỪ graph.json (ý đồ engineer)
     * - có graph + --scan-ms khác  → WARN rõ + dùng --scan-ms (dev override);
     *   ScanLoop sync dt của graph về đúng chu kỳ thật nên không bao giờ lệch */
    if (graph.loaded()) {
        const uint64_t graph_ns = static_cast<uint64_t>(graph.declared_scan_ms()) * 1000000ull;
        if (!scan_ms_from_cli) {
            period_ns = graph_ns;
            std::fprintf(stderr, "INFO  core.scan_ms=%u (theo graph.json)\n",
                         graph.declared_scan_ms());
        } else if (period_ns != graph_ns) {
            std::fprintf(stderr,
                         "WARN  core.scan_ms_override cli=%llu ms != graph=%u ms"
                         " -> dùng CLI, PID dt theo CLI\n",
                         static_cast<unsigned long long>(period_ns / 1000000ull),
                         graph.declared_scan_ms());
        }
    }
    std::fprintf(stderr, "INFO  core.scan_ms=%llu (chốt)\n",
                 static_cast<unsigned long long>(period_ns / 1000000ull));

    PriorityResolver resolver;

    /* io_safe_state.conf → relinquish default MỨC 6 (quan hệ chốt: safe_state
     * override luôn là 0V/4mA/open cố định — xem safe_state_config.hpp).
     * Validate AO theo MODE THẬT từ io_config.conf — sai mode/dải → fail-fast. */
    AoModeConfig ao_modes;
    if (!load_ao_modes(io_cfg_path, io_cfg_from_cli, &ao_modes))
        return 1;
    SafeStateConfig safe_cfg;
    if (!load_safe_state_config(safe_cfg_path, safe_cfg_from_cli, ao_modes, &safe_cfg))
        return 1;   /* config an toàn hỏng → fail-fast */
    apply_safe_state_config(safe_cfg, &resolver);

    AlarmRuntime alarms;
    if (!alarms.load(alarm_cfg_path, false))
        std::fprintf(stderr, "WARN  alarm_cfg.boot_fail path=%s (alarms disabled)\n",
                     alarm_cfg_path.c_str());
    ScheduleRuntime schedules;
    if (!schedules.load(schedule_cfg_path, false))
        std::fprintf(stderr, "WARN  schedule_cfg.boot_fail path=%s (schedules disabled)\n",
                     schedule_cfg_path.c_str());

    SafeState safe(quality, &graph, &resolver);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    if (!bacnet.attach())
        return 1;   /* core là creator plc_shm — không có thì web/BACnet mù */
    CoreMetrics metrics;

    /* MOD-009: mở fieldbus.sock SOCK_DGRAM — core là server (bind+recv).
     * iobus fieldbus gửi kx_ext_snapshot_msg_t datagram vào đây mỗi vòng poll.
     * Fail → degraded (core chạy không có ext data, ext quality=BAD). */
    int fieldbus_sockfd = -1;
    {
        fieldbus_sockfd = ::socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        if (fieldbus_sockfd < 0) {
            std::fprintf(stderr, "WARN  fieldbus_sock.open_fail errno=%d (ext data disabled)\n",
                         errno);
        } else {
            ::unlink(fieldbus_sock_path.c_str());
            struct sockaddr_un fba {};
            fba.sun_family = AF_UNIX;
            std::strncpy(fba.sun_path, fieldbus_sock_path.c_str(), sizeof(fba.sun_path) - 1);
            if (::bind(fieldbus_sockfd, reinterpret_cast<struct sockaddr*>(&fba),
                       sizeof(fba)) != 0) {
                std::fprintf(stderr, "WARN  fieldbus_sock.bind_fail path=%s errno=%d"
                             " (ext data disabled)\n", fieldbus_sock_path.c_str(), errno);
                ::close(fieldbus_sockfd);
                fieldbus_sockfd = -1;
            } else {
                ::chmod(fieldbus_sock_path.c_str(), 0660);
                std::fprintf(stderr, "INFO  fieldbus_sock.bound path=%s\n",
                             fieldbus_sock_path.c_str());
            }
        }
    }

    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver,
                   &safe, &writer, &bacnet, &metrics, fieldbus_sockfd, &alarms, &schedules});

    /* SIGHUP → reload io_config + io_safe_state + graph ở ranh giới scan;
     * fail → giữ config cũ (khác boot fail-fast); manual đang giữ không mất */
    struct ReloadCtx {
        ReloadSpec spec;
        PriorityResolver* resolver;
        GraphRuntime* graph;
        AlarmRuntime* alarms;
        ScheduleRuntime* schedules;
        StateSnapshot* snap;
    } rctx{};
    rctx.spec.graph_path = graph_path;
    rctx.spec.safe_cfg_path = safe_cfg_path;
    rctx.spec.io_cfg_path = io_cfg_path;
    rctx.spec.alarm_cfg_path = alarm_cfg_path;
    rctx.spec.schedule_cfg_path = schedule_cfg_path;
    rctx.spec.safe_cfg_must_exist = safe_cfg_from_cli;
    rctx.spec.io_cfg_must_exist = io_cfg_from_cli;
    rctx.resolver = &resolver;
    rctx.graph = &graph;
    rctx.alarms = &alarms;
    rctx.schedules = &schedules;
    rctx.snap = &snap;
    auto on_reload = [](void* p) {
        ReloadCtx* c = static_cast<ReloadCtx*>(p);
        std::fprintf(stderr, "INFO  core.reload SIGHUP (ranh giới scan)\n");
        /* GAP-07: lưu persist state trước swap, restore sau */
        if (c->graph->dirty() || c->graph->loaded())
            c->snap->save(c->graph->get_persist_state());
        if (!reload_configs(c->spec, c->resolver, c->graph, c->alarms, c->schedules))
            std::fprintf(stderr, "WARN  core.reload co phan fail — phan do giu config cu\n");
        c->graph->restore_persist_state(c->snap->load());
        c->graph->clear_dirty();
    };
    loop.set_reload_hook(&g_reload, on_reload, &rctx);

    /* LUẬT WATCHDOG (PROGRAM_TASK_SCHEDULER_SPEC §9) — đọc trước khi sửa:
     *
     *   Kick CHỈ ở đây, tức là SAU KHI ScanLoop::step() trả về trọn vẹn.
     *   TUYỆT ĐỐI KHÔNG kick ở giữa step().
     *
     * Lý do: watchdog phải chứng minh MỘT CHU KỲ ĐIỀU KHIỂN HOÀN TẤT, không
     * phải chứng minh process còn sống. Kick giữa chu kỳ biến nó thành
     * liveness check vô nghĩa — một step() treo vĩnh viễn ở giữa vẫn kick đều
     * và systemd sẽ không bao giờ khởi động lại, đúng loại lỗi mà watchdog
     * sinh ra để bắt. Xem thêm PROGRAM_SOM_FW_DRAFT_DESIGN §9.2 (diag_wdg).
     *
     * Trong khoảng core chưa chạy (đang restart), MCU tự ép AO/DO về an toàn
     * sau IOP_SAFE_TIMEOUT_MS = 200 ms — lớp bảo vệ ĐỘC LẬP với SOM, và là lý
     * do việc systemd restart core chấp nhận được.
     *
     * sd_notify READY=1 sau scan đầu; snapshot 60s dirty (COR-010). */
    struct NotifyCtx {
        bool ready_sent = false;
        int snap_ticks  = 0;
        GraphRuntime*  graph;
        StateSnapshot* snap;
    } nctx{false, 0, &graph, &snap};
    auto after_scan = [](void* p) {
        NotifyCtx* c = static_cast<NotifyCtx*>(p);
        if (!c->ready_sent) {
            notify_systemd("READY=1");
            c->ready_sent = true;
            std::fprintf(stderr, "INFO  core.ready first scan done\n");
        }
        notify_systemd("WATCHDOG=1");
        /* GAP-08: ghi snapshot mỗi 60 scan NẾU dirty */
        if (++c->snap_ticks >= 60) {
            c->snap_ticks = 0;
            if (c->graph->dirty()) {
                c->snap->save(c->graph->get_persist_state());
                c->graph->clear_dirty();
            }
        }
    };

    loop.run(g_shutdown, period_ns, after_scan, &nctx);

    /* COR-010: ghi snapshot khi shutdown sạch (SIGTERM) */
    if (graph.loaded())
        snap.save(graph.get_persist_state());

    if (fieldbus_sockfd >= 0) {
        ::close(fieldbus_sockfd);
        ::unlink(fieldbus_sock_path.c_str());
    }

    std::fprintf(stderr, "INFO  core.shutdown scans=%u overrun=%u\n",
                 metrics.scan_count(), metrics.scan_overrun());
    return 0;
}
