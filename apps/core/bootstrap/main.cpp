/**
 * @file  main.cpp (mkddc-core)
 * @brief Entry: init → SCHED_FIFO 80 → attach shm (retry) → scan loop 1s →
 *        sd_notify → signal. Core KHÔNG mở UART, KHÔNG tạo io_shm (07 §0).
 */
#include <array>
#include <atomic>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <memory>
#include <string>
#include <filesystem>
#include <fstream>
#include <vector>
#include <thread>

#include <pthread.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

#include <sched.h>

#include "bacnet/bacnet_objtable.hpp"
#include "ipc/config_reload.hpp"
#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "config/safe_state_config.hpp"
#include "schedule/schedule_runtime.hpp"
#include "runtime/scan_loop.hpp"
#include "runtime/thread_policy.hpp"
#include "persistence/state_snapshot.hpp"
#include "ipc/program_ipc_unix.hpp"
#include "programming/programming_cutover.hpp"
#include "st/st_public_key.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "build_info.h"

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

/* hex -> byte cho khoá công khai đọc từ file (ADR-052). Trả false khi gặp ký tự
 * không phải hex: một khoá đọc sai còn tệ hơn không có khoá, vì nó vẫn là "một
 * khoá tin cậy" trong mắt phần còn lại của hệ. */
static bool hex_to_bytes(const std::string& hex, uint8_t* out, std::size_t out_size)
{
    if (hex.size() != out_size * 2) return false;
    auto value = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (std::size_t i = 0; i < out_size; i++) {
        const int hi = value(hex[i * 2]);
        const int lo = value(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
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
    uint64_t base_step_ns = 1000000000ull; /* base step 1s Rev A */
    int rt_prio = 80;
    /* Mặc định GRAPH_ONLY — runtime IPC có thể bật độc lập để Commission đổi
     * owner tại safe boundary; không có operation thì graph giữ nguyên. */
    CutoverMode programming_mode = CutoverMode::GRAPH_ONLY;
    bool programming_runtime_enabled = false;
    std::string programming_sock_path = "/run/mkddc/programming-v1.sock";
    /* ADR-051: TTL hold-last đã ký là 60 s. CLI chỉ để commissioning/HIL đo hai
     * biên mà không phải build lại; không set thì dùng đúng số đã ký. */
    uint32_t program_hold_ttl_ms = st_hold_ttl::kSignedTtlMs;
    /* ADR-052 — khoá công khai của CHÍNH bo này, nạp vào tập khoá tin cậy bên
     * cạnh khoá hãng nhúng trong build. Artifact do bo tự biên dịch được ký
     * bằng khoá thiết bị; khoá hãng ký thứ hãng phát hành. Bo không tin khoá
     * thiết bị của bo khác, nên một bo bị chiếm không ký được cho bo bên cạnh. */
    std::vector<std::string> trusted_key_paths;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--version") { std::printf("version=%s git_commit=%s build_time=%s toolchain=%s\n", MKDDC_BUILD_VERSION, MKDDC_GIT_COMMIT, MKDDC_BUILD_TIME, MKDDC_TOOLCHAIN); return 0; }
        /* T59-602: gate đóng gói phát hành đọc đúng dòng này để biết binary đang
         * nhúng khoá TEST hay khoá phát hành. Trước đó `st_public_key_is_test_key()`
         * có sẵn nhưng KHÔNG nơi nào gọi, nên "build release phải truyền
         * -DMKDDC_ST_PUBLIC_KEY_HEX" chỉ là một câu trong tài liệu. */
        else if (a == "--st-key-info") {
            char fingerprint[17] = {0};
            st_public_key_fingerprint(st_builtin_public_key(), fingerprint, sizeof(fingerprint));
            std::printf("st_public_key fingerprint=%s mode=%s\n", fingerprint,
                        st_public_key_is_test_key() ? "TEST" : "RELEASE");
            return 0;
        }
        else if (a == "--st-trusted-key" && i + 1 < argc) trusted_key_paths.push_back(argv[++i]);
        else if (a == "--log-level" && i + 1 < argc) { ++i; /* Rev A: log level cố định */ }
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
            base_step_ns = static_cast<uint64_t>(ms) * 1000000ull;
            scan_ms_from_cli = true;
        }
        else if (a == "--programming-mode" && i + 1 < argc) {
            const std::string m = argv[++i];
            if (m == "graph_only") programming_mode = CutoverMode::GRAPH_ONLY;
            else if (m == "program_only") programming_mode = CutoverMode::PROGRAM_ONLY;
            else {
                std::fprintf(stderr,
                             "ERROR core.bad_programming_mode '%s' (cần graph_only|program_only)\n",
                             m.c_str());
                return 1;
            }
        }
        else if (a == "--programming-runtime") programming_runtime_enabled = true;
        else if (a == "--program-hold-ttl-ms" && i + 1 < argc) {
            const long long ms = std::atoll(argv[++i]);
            /* 0 KHÔNG được chấp nhận ở đường sản phẩm: 0 nghĩa là giữ đầu ra vô
             * hạn khi chương trình chết — đúng hành vi ADR-051 đóng lại. Muốn
             * tắt TTL thì phải sửa quyết định, không phải truyền một cờ. */
            if (ms <= 0 || ms > static_cast<long long>(st_hold_ttl::kMaxConfigurableMs)) {
                std::fprintf(stderr,
                             "ERROR core.bad_program_hold_ttl_ms '%s' (cần 1..%u ms; 0/vô hạn"
                             " bị cấm bởi ADR-051)\n",
                             argv[i], st_hold_ttl::kMaxConfigurableMs);
                return 1;
            }
            program_hold_ttl_ms = static_cast<uint32_t>(ms);
        }
        else if (a == "--programming-sock" && i + 1 < argc)
            programming_sock_path = argv[++i];
        else if (a == "--help") {
            std::printf("usage: mkddc-core [--sock PATH] [--fieldbus-sock PATH] [--graph FILE]"
                        " [--safe-state-conf FILE] [--io-conf FILE] [--alarm-conf FILE]"
                        " [--schedule-conf FILE] [--scan-ms N]"
                        " [--programming-mode graph_only|program_only] [--programming-runtime]"
                        " [--program-hold-ttl-ms N] [--st-key-info] [--st-trusted-key FILE]"
                        " [--programming-sock PATH]"
                        " [--log-level LVL]\n");
            return 0;
        }
        else {
            std::fprintf(stderr, "ERROR core.invalid_argument '%s' (tham số không được hỗ trợ hoặc thiếu giá trị; xem --help)\n",
                         a.c_str());
            return 1;
        }
    }
    programming_runtime_enabled = programming_runtime_enabled ||
                                  programming_mode == CutoverMode::PROGRAM_ONLY;

    /* scan_ms log SAU khi chốt với graph.json (tránh log giá trị không dùng) */
    std::fprintf(stderr, "INFO  core.start version=%s git_commit=%s build_time=%s toolchain=%s pid=%d\n",
                 MKDDC_BUILD_VERSION, MKDDC_GIT_COMMIT, MKDDC_BUILD_TIME, MKDDC_TOOLCHAIN, getpid());

    /* T59-602, DDD-ARTIFACT-TRUST-PROG-001 §1: khoá TEST được cam kết vào repo
     * CÓ CHỦ Ý để CI ký/verify được. Rủi ro đi kèm là nó lặng lẽ theo binary ra
     * hiện trường: mọi người đều có khoá riêng tương ứng, nên "artifact có chữ
     * ký" khi đó không chứng minh điều gì. Log ở mức CRITICAL để dòng này không
     * lẫn vào INFO khi ai đó đọc log board. */
    {
        char fingerprint[17] = {0};
        st_public_key_fingerprint(st_builtin_public_key(), fingerprint, sizeof(fingerprint));
        if (st_public_key_is_test_key()) {
            std::fprintf(stderr,
                         "CRITICAL core.st_public_key=TEST fingerprint=%s"
                         " — build này KHÔNG dùng được cho phát hành (T59-602)\n",
                         fingerprint);
        } else {
            std::fprintf(stderr, "INFO  core.st_public_key=RELEASE fingerprint=%s\n",
                         fingerprint);
        }
    }

    /* ADR-052 — nạp khoá thiết bị vào tập khoá tin cậy.
     *
     * Đọc ở đây, một lần lúc khởi động, chứ không đọc lại giữa đường quét: tập
     * khoá tin cậy là chính sách, và một chính sách đổi được trong lúc chạy thì
     * kẻ tấn công ghi được file cũng đổi được nó. Khoá hỏng/thiếu là lỗi CẤU
     * HÌNH và phải nói ra, không được lặng lẽ chạy tiếp với ít khoá hơn — đó là
     * cách một bo tự hạ mức bảo vệ mà không ai biết. */
    std::vector<std::array<uint8_t, 32>> trusted_keys;
    for (const std::string& path : trusted_key_paths) {
        if (trusted_keys.size() >= kMaxTrustedKeys) {
            std::fprintf(stderr, "ERROR core.st_trusted_key_overflow max=%zu\n",
                         static_cast<std::size_t>(kMaxTrustedKeys));
            return 1;
        }
        std::ifstream file(path);
        if (!file) {
            std::fprintf(stderr, "ERROR core.st_trusted_key_missing path=%s\n", path.c_str());
            return 1;
        }
        std::string hex;
        file >> hex;
        std::array<uint8_t, 32> key{};
        if (hex.size() != 64 || !hex_to_bytes(hex, key.data(), key.size())) {
            std::fprintf(stderr, "ERROR core.st_trusted_key_malformed path=%s (can 64 ky tu hex)\n",
                         path.c_str());
            return 1;
        }
        char fingerprint[17] = {0};
        st_public_key_fingerprint(key.data(), fingerprint, sizeof(fingerprint));
        std::fprintf(stderr, "INFO  core.st_trusted_key=%s fingerprint=%s\n",
                     path.c_str(), fingerprint);
        trusted_keys.push_back(key);
    }

    /* RT + mlockall. Đo lại trạng thái THẬT sau khi cố đặt, thay vì tin vào
     * mã trả về: trên hệ có CONFIG_RT_GROUP_SCHED + cgroup v2, systemd có thể
     * đã ép policy về SCHED_OTHER trước khi process chạy, nên gọi thành công
     * hay thất bại đều không nói lên trạng thái cuối cùng. */
    BacnetObjTable::RtHealth rt_health;
    {
        struct sched_param sp {};
        sp.sched_priority = rt_prio;
        if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) != 0)
            std::fprintf(stderr, "WARN  rt.sched_fifo_fail prio=%d\n", rt_prio);
        /* MCL_FUTURE chỉ an toàn khi RLIMIT_MEMLOCK vô hạn.
         *
         * Với trần hữu hạn, `mlockall(MCL_CURRENT|MCL_FUTURE)` VẪN trả về 0 —
         * phần đang map vừa trong trần. Bẫy nằm ở MCL_FUTURE: mọi mapping sau đó
         * đều phải khoá được, nên `pthread_create` (stack 8 MB) hỏng EAGAIN,
         * `std::thread` ném `std::system_error`, và tiến trình abort ở một chỗ
         * cách đây rất xa với thông điệp không nhắc gì tới memlock. Đó đúng là
         * cách `mkddc-core` chết lúc khởi động ở lane E2E real-backend trên CI.
         *
         * Unit systemd bản thật đặt `LimitMEMLOCK=infinity` + `CAP_IPC_LOCK` nên
         * bo thật đi nhánh đầy đủ. Nơi không có trần đó phải degrade thật, chứ
         * không chết: khoá MCL_CURRENT và để `rt_health.mlock_ok=false` — dòng
         * `rt.degraded` phía dưới và plc_shm sẽ nói rõ jitter không được bảo đảm.
         */
        struct rlimit memlock_limit {};
        const bool memlock_unlimited =
            (getrlimit(RLIMIT_MEMLOCK, &memlock_limit) == 0) &&
            (memlock_limit.rlim_cur == RLIM_INFINITY);
        if (memlock_unlimited) {
            rt_health.mlock_ok = (mlockall(MCL_CURRENT | MCL_FUTURE) == 0);
            if (!rt_health.mlock_ok)
                std::fprintf(stderr, "WARN  rt.mlockall_fail\n");
        } else {
            rt_health.mlock_ok = false;
            std::fprintf(stderr,
                         "WARN  rt.mlockall_partial RLIMIT_MEMLOCK hữu hạn — chỉ khoá"
                         " MCL_CURRENT, KHÔNG bật MCL_FUTURE (cần LimitMEMLOCK=infinity"
                         " + CAP_IPC_LOCK)\n");
            if (mlockall(MCL_CURRENT) != 0)
                std::fprintf(stderr, "WARN  rt.mlockall_fail errno=%d (%s) — trần memlock=%llu byte\n",
                             errno, std::strerror(errno),
                             static_cast<unsigned long long>(memlock_limit.rlim_cur));
        }

        const int policy = sched_getscheduler(0);
        struct sched_param actual {};
        sched_getparam(0, &actual);
        rt_health.sched_policy = static_cast<uint8_t>(policy < 0 ? 0 : policy);
        rt_health.sched_priority = static_cast<uint8_t>(actual.sched_priority);
        rt_health.degraded = (policy != SCHED_FIFO) || (actual.sched_priority != rt_prio) ||
                             !rt_health.mlock_ok;

        /* ERROR chứ không WARN, và nêu rõ hệ quả: chạy không RT là sai lệch so
         * với thiết kế đã duyệt, không phải một ghi chú thông tin. Trạng thái
         * này còn được publish vào plc_shm để Web/BE thấy liên tục — log một
         * dòng lúc khởi động rồi cuộn mất là lý do suy giảm từng tồn tại nhiều
         * ngày mà không ai biết. */
        if (rt_health.degraded)
            std::fprintf(stderr,
                         "ERROR rt.degraded policy=%d prio=%d mlock=%d"
                         " (mong đợi SCHED_FIFO=%d prio=%d) — jitter KHÔNG được bảo đảm\n",
                         policy, actual.sched_priority, rt_health.mlock_ok ? 1 : 0,
                         SCHED_FIFO, rt_prio);
        else
            std::fprintf(stderr, "INFO  rt.ok policy=SCHED_FIFO prio=%d mlock=1\n", rt_prio);
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

    /* Đường GRAPH_ONLY chuyển tiếp vẫn ánh xạ scan_ms cũ vào base step để
     * không đổi hành vi trước TASK-PROG-306. Task period Programming không đi
     * qua biến này và không bao giờ được dùng làm sleep của ScanLoop. */
    /* Đồng bộ base step — 1 nguồn sự thật:
     * - có graph + KHÔNG --scan-ms → chu kỳ scan core LẤY TỪ graph.json (ý đồ engineer)
     * - có graph + --scan-ms khác  → WARN rõ + dùng --scan-ms (dev override);
     *   ScanLoop sync dt của graph về đúng chu kỳ thật nên không bao giờ lệch */
    if (graph.loaded()) {
        const uint64_t graph_ns = static_cast<uint64_t>(graph.declared_scan_ms()) * 1000000ull;
        if (!scan_ms_from_cli) {
            base_step_ns = graph_ns;
            std::fprintf(stderr, "INFO  core.scan_ms=%u (theo graph.json)\n",
                         graph.declared_scan_ms());
        } else if (base_step_ns != graph_ns) {
            std::fprintf(stderr,
                         "WARN  core.scan_ms_override cli=%llu ms != graph=%u ms"
                         " -> dùng CLI, PID dt theo CLI\n",
                         static_cast<unsigned long long>(base_step_ns / 1000000ull),
                         graph.declared_scan_ms());
        }
    }
    std::fprintf(stderr, "INFO  core.base_step_ms=%llu programming_mode=%s\n",
                 static_cast<unsigned long long>(base_step_ns / 1000000ull),
                 programming_mode == CutoverMode::PROGRAM_ONLY ? "program_only" : "graph_only");

    /* ADR-051 — TTL hold-last đo bằng đồng hồ, nên nó độc lập với base step.
     * Chốt SAU khi base step đã thống nhất với graph.json chỉ để một lần log nói
     * đủ hai con số cạnh nhau: TTL ngắn hơn một base step thì không lần publish
     * nào kịp gia hạn, hold-last biến thành rút-ngay. */
    const uint32_t base_step_ms = static_cast<uint32_t>(base_step_ns / 1000000ull);
    if (program_hold_ttl_ms < base_step_ms) {
        std::fprintf(stderr,
                     "WARN  core.program_hold_ttl_ms=%u < base_step_ms=%u -> nâng lên 1 base step\n",
                     program_hold_ttl_ms, base_step_ms);
        program_hold_ttl_ms = base_step_ms;
    }
    const uint64_t program_hold_ttl_ns = st_hold_ttl::ns_from_ms(program_hold_ttl_ms);
    std::fprintf(stderr, "INFO  core.program_hold_ttl_ms=%u signed_ms=%u base_step_ms=%u\n",
                 program_hold_ttl_ms, st_hold_ttl::kSignedTtlMs, base_step_ms);

    PriorityResolver resolver;

    /* TASK-PROG-403/404: runtime có thể khởi động cùng GRAPH_ONLY; UDS worker
     * stage artifact ngoài RT, coordinator mới arm pointer/owner swap tại
     * safe boundary. graph.json luôn còn nguyên làm rollback owner. */
    StScheduler programming_scheduler(programming_runtime_enabled
                                          ? StSchedulerProfile::REV_A
                                          : StSchedulerProfile::SUPPORTING_AS_BUILT);
    /* T59-504 — bus phải tồn tại ở binary production, không chỉ trong unit
     * test. Trước đây coordinator nhận package có Published Signal rồi từ chối
     * ở `rebuild_signal_bus()` vì scheduler bootstrap chưa hề được gắn bus. */
    StSignalBus programming_signal_bus;
    programming_scheduler.set_signal_bus(&programming_signal_bus);
    /* F01 (EV-PROG-FBD-ST-MB-20260925): dung sai so hạn của Task không được
     * vượt nửa base step thật của ScanLoop. */
    programming_scheduler.set_base_step_ns(base_step_ns);
    /* ADR-052: tập khoá tin cậy phải được đặt TRƯỚC khi bất kỳ artifact nào được
     * nạp — đặt sau nghĩa là gói đầu tiên (thường là gói đang chạy, phục hồi sau
     * reboot) đi qua bằng chính sách cũ. */
    if (!trusted_keys.empty()) {
        StLoaderOptions loader_options;
        for (const std::array<uint8_t, 32>& key : trusted_keys)
            loader_options.trusted_keys[loader_options.trusted_key_count++] = key.data();
        programming_scheduler.set_loader_options(loader_options);
        std::fprintf(stderr, "INFO  core.st_trusted_key_count=%zu\n", trusted_keys.size());
    }

    ProgrammingCutover programming_cutover(programming_mode);
    std::unique_ptr<StRetainService> retain_service;
    std::unique_ptr<programming::ProgrammingRuntimeCoordinator> programming_coordinator;
    std::unique_ptr<programming::ProgramIpcServer> programming_ipc_server;
    /* T59-406/T59-408: sổ candidate và trace giá trị. Cấp phát tĩnh, cùng tuổi
     * thọ với scan loop — cả hai đều bị đọc từ đường quét nên không được huỷ
     * trước nó. */
    programming::ProgramCandidateRegistry programming_candidates;
    StValueTrace programming_value_trace;
    std::unique_ptr<programming::ProgramIpcUnixEndpoint> programming_ipc_endpoint;
    std::thread programming_ipc_thread;
    if (programming_runtime_enabled) {
        StTaskConfig runtime_task;
        runtime_task.id = "main";
        runtime_task.priority = 0;
        runtime_task.period_ms = 1000;
        runtime_task.budget_ms = 199;
        runtime_task.overrun_threshold = 3;
        std::string topology_error;
        if (!programming_scheduler.add_task(runtime_task, &topology_error) ||
            !programming_scheduler.add_program("main", "program-main", 0, &topology_error)) {
            std::fprintf(stderr, "ERROR programming.topology_fail error=%s\n",
                         topology_error.c_str());
            return 1;
        }
        const char* configured_state = std::getenv("PROGRAMMING_STATE_DIR");
        const char* shared_state = std::getenv("STATE_DIR");
        const char* configured_target = std::getenv("PROGRAMMING_TARGET_ID");
        const std::string programming_state = configured_state && configured_state[0]
            ? configured_state
            : (shared_state && shared_state[0]
                   ? std::string(shared_state) + "/programming"
                   : "/data/mkddc/programming");
        const std::string target_identity = configured_target && configured_target[0]
            ? configured_target : "controller-local";
        retain_service = std::make_unique<StRetainService>(
            programming_state + "/retain", target_identity, true);
        if (!retain_service->ready()) {
            std::fprintf(stderr, "ERROR programming.retain_init_fail path=%s error=%s\n",
                         (programming_state + "/retain").c_str(),
                         retain_service->error().c_str());
            return 1;
        }
        programming_scheduler.set_retain_service(retain_service.get());
        std::fprintf(stderr, "INFO  programming.retain_ready path=%s target=%s\n",
                     (programming_state + "/retain").c_str(), target_identity.c_str());
        const auto ensure_state_directory = [](const std::string& path,
                                               std::string* error) {
            std::error_code directory_error;
            std::filesystem::create_directories(path, directory_error);
            if (directory_error || ::chmod(path.c_str(), 0750) != 0) {
                if (error) *error = directory_error
                    ? directory_error.message() : std::strerror(errno);
                return false;
            }
            return true;
        };
        std::string state_error;
        if (!ensure_state_directory(programming_state + "/journal", &state_error) ||
            !ensure_state_directory(programming_state + "/staging", &state_error)) {
            std::fprintf(stderr, "ERROR programming.state_dir_fail error=%s\n",
                         state_error.c_str());
            return 1;
        }
        programming_coordinator = std::make_unique<programming::ProgrammingRuntimeCoordinator>(
            &programming_scheduler, &programming_cutover,
            programming_state + "/journal/lifecycle.bin", programming_state + "/staging");
        std::string recovery_error;
        if (!programming_coordinator->recover(&recovery_error))
            std::fprintf(stderr, "ERROR programming.recovery_required error=%s\n",
                         recovery_error.c_str());
        programming_coordinator->set_candidate_registry(&programming_candidates);
        programming_ipc_server = std::make_unique<programming::ProgramIpcServer>(
            static_cast<uint32_t>(::getuid()), programming_coordinator.get());
        programming_ipc_server->set_value_trace(&programming_value_trace, &programming_scheduler);
        programming_ipc_endpoint = std::make_unique<programming::ProgramIpcUnixEndpoint>();
        std::string ipc_error;
        if (!programming_ipc_endpoint->open(programming_sock_path, &ipc_error)) {
            std::fprintf(stderr, "ERROR programming.ipc_open_fail path=%s error=%s\n",
                         programming_sock_path.c_str(), ipc_error.c_str());
            return 1;
        }
        programming_ipc_thread = std::thread([&] {
            /* `MBA-FW-01`: IPC Programming phục vụ web (Check/Commission/Simulate)
             * — hạ khỏi SCHED_FIFO 80 thừa hưởng từ vòng scan. */
            core::demote_to_normal_sched("prog-ipc");
            programming_ipc_endpoint->run(programming_ipc_server.get(), &g_shutdown);
        });
        std::fprintf(stderr, "INFO  programming.ipc_ready path=%s\n",
                     programming_sock_path.c_str());
    }

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
    bacnet.set_rt_health(rt_health);
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

    ScanDeps scan_deps{&reader, &table, &quality, &web, &graph, &resolver,
                       &safe, &writer, &bacnet, &metrics, fieldbus_sockfd, &alarms, &schedules};
    scan_deps.st_sched = programming_runtime_enabled ? &programming_scheduler : nullptr;
    scan_deps.mode = programming_mode;
    scan_deps.cutover = programming_runtime_enabled ? &programming_cutover : nullptr;
    scan_deps.programming_coordinator = programming_coordinator.get();
    scan_deps.candidate_registry = programming_runtime_enabled ? &programming_candidates : nullptr;
    scan_deps.value_trace = programming_runtime_enabled ? &programming_value_trace : nullptr;
    scan_deps.program_hold_ttl_ns = program_hold_ttl_ns;
    ScanLoop loop(scan_deps);

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

    /* LUẬT WATCHDOG (ADR-028) — đọc trước khi sửa:
     *
     *   Kick CHỈ ở đây, tức là SAU KHI ScanLoop::step() trả về trọn vẹn.
     *   TUYỆT ĐỐI KHÔNG kick ở giữa step().
     *
     * Lý do: watchdog phải chứng minh MỘT CHU KỲ ĐIỀU KHIỂN HOÀN TẤT, không
     * phải chứng minh process còn sống. Kick giữa chu kỳ biến nó thành
     * liveness check vô nghĩa — một step() treo vĩnh viễn ở giữa vẫn kick đều
     * và systemd sẽ không bao giờ khởi động lại, đúng loại lỗi mà watchdog
     * sinh ra để bắt. Task period 30 s chỉ là cadence dispatch, không đi vào
     * công thức watchdog và không được làm chậm callback này.
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

    loop.run(g_shutdown, base_step_ns, after_scan, &nctx);

    if (programming_ipc_thread.joinable()) programming_ipc_thread.join();
    if (programming_ipc_endpoint) programming_ipc_endpoint->close();

    /* Flush latest committed generation trước khi process rời đi. Filesystem
     * vẫn thuộc worker/non-RT; scan đã dừng nên không có snapshot mới. */
    if (retain_service) retain_service->shutdown_and_flush();

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
