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
#include <unistd.h>

#include "scan_loop.hpp"

namespace {

std::atomic<bool> g_shutdown{false};

void on_signal(int)
{
    g_shutdown.store(true);
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
    uint64_t period_ns = 1000000000ull;   /* scan 1s Rev A */
    int rt_prio = 80;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--log-level" && i + 1 < argc) { ++i; /* Rev A: log level cố định */ }
        else if (a == "--sock" && i + 1 < argc) sock_path = argv[++i];
        else if (a == "--scan-ms" && i + 1 < argc)
            period_ns = static_cast<uint64_t>(std::atoll(argv[++i])) * 1000000ull;
        else if (a == "--help") {
            std::printf("usage: mkddc-core [--sock PATH] [--scan-ms N] [--log-level LVL]\n");
            return 0;
        }
    }

    std::fprintf(stderr, "INFO  core.start version=1.0.0 pid=%d scan_ms=%llu\n",
                 getpid(), static_cast<unsigned long long>(period_ns / 1000000ull));

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

    /* Attach io_shm: retry 1s, WARN mỗi 10s; sau 30s vẫn chạy scan với quality=BAD
     * (safe-state áp) — 07 §7.1 */
    IobusReader reader;
    {
        int waited_s = 0;
        while (!g_shutdown.load() && !reader.attach()) {
            if (waited_s % 10 == 0)
                std::fprintf(stderr, "WARN  iobus_reader.waiting shm=%s (%ds)\n",
                             KX_SHM_IO_PATH, waited_s);
            if (waited_s >= 30) {
                std::fprintf(stderr, "WARN  iobus_reader.degraded chạy với quality=BAD\n");
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
    graph.load("/data/config/graph.json");
    PriorityResolver resolver;
    SafeState safe(quality);
    OutputWriter writer(reader.shm());
    BacnetObjTable bacnet;
    if (!bacnet.attach())
        return 1;   /* core là creator plc_shm — không có thì web/BACnet mù */
    CoreMetrics metrics;

    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver,
                   &safe, &writer, &bacnet, &metrics});

    /* sd_notify READY=1 sau scan đầu + WATCHDOG=1 mỗi scan (WatchdogSec=3) */
    struct NotifyCtx { bool ready_sent = false; } nctx;
    auto after_scan = [](void* p) {
        NotifyCtx* c = static_cast<NotifyCtx*>(p);
        if (!c->ready_sent) {
            notify_systemd("READY=1");
            c->ready_sent = true;
            std::fprintf(stderr, "INFO  core.ready first scan done\n");
        }
        notify_systemd("WATCHDOG=1");
    };

    loop.run(g_shutdown, period_ns, after_scan, &nctx);

    std::fprintf(stderr, "INFO  core.shutdown scans=%u overrun=%u\n",
                 metrics.scan_count(), metrics.scan_overrun());
    return 0;
}
