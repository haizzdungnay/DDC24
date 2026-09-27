/**
 * @file  scan_wcet_bench.cpp
 * @brief ADR-061 4.10 bước 2 — đo WCET từng bước của `ScanLoop::step()` trên
 *        máy dev, dưới tải IPC web giống web-api thật.
 *
 * Không phải test (không vào ctest): số đo thời gian trên máy dev phụ thuộc máy
 * và tải nền, gắn nó vào cổng pass/fail chỉ sinh ra cổng chập chờn. Công cụ này
 * cho số để SO SÁNH trước/sau trên cùng một máy; số quyết định vẫn là
 * `core.step_wcet` trên target.
 *
 * Tải mô phỏng đúng cách `CoreClient` của web-api gọi Core: mỗi yêu cầu một kết
 * nối mới, một dòng JSON, đọc một dòng trả lời rồi đóng.
 *   - `point_snapshot` mỗi 50 ms (historian + monitor + trace dự phòng);
 *   - `write DO1` (manual, đảo giá trị) mỗi 200 ms;
 *   - `alarm_list` mỗi 1 s.
 * Core có Program Runtime thật: 1 Task 10 ms, 8 Program đang chạy, để bảng
 * `programs[]` của snapshot có kích thước như trên bo.
 *
 * Cách chạy:  mkddc-core-scan-bench [--steps N] [--offload | --micro]
 *   --offload  chạy IPC web trên luồng riêng (X19); mặc định là cách cũ, IPC
 *              phục vụ ngay trong `step()`.
 *   --micro    đo riêng từng việc còn lại ở bước PUBLISH (N lần mỗi việc).
 */
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <string>
#include <thread>
#include <vector>

#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "runtime/scan_loop.hpp"
#include "st/st_compile.hpp"
#include "runtime/latest_value_buffer.hpp"
#include "st/st_ir.hpp"
#include "st/st_runtime_snapshot.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

using namespace core;

namespace {

uint64_t mono_ns()
{
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

bool request(const std::string& path, const std::string& line, std::string* response)
{
    const int fd = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return false;
    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path) - 1);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        ::close(fd);
        return false;
    }
    timeval tv{2, 0};
    ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    const std::string framed = line + "\n";
    if (::send(fd, framed.data(), framed.size(), MSG_NOSIGNAL) != static_cast<ssize_t>(framed.size())) {
        ::close(fd);
        return false;
    }
    response->clear();
    char buf[4096];
    for (;;) {
        const ssize_t n = ::recv(fd, buf, sizeof(buf), 0);
        if (n <= 0) break;
        response->append(buf, static_cast<std::size_t>(n));
        if (!response->empty() && response->back() == '\n') break;
    }
    ::close(fd);
    return !response->empty();
}

std::vector<uint8_t> counter_artifact()
{
    StIrModule module;
    StDiagnostic diagnostic;
    if (!compile_st_source(R"ST(
PROGRAM counter
VAR_OUTPUT n : INT; END_VAR
    n := n + 1;
END_PROGRAM
)ST", &module, &diagnostic)) {
        std::fprintf(stderr, "compile fail %s\n", diagnostic.message.c_str());
        std::exit(2);
    }
    std::vector<uint8_t> bytes;
    std::string error;
    if (!serialize_st_ir(module, &bytes, &error) || !sign_st_artifact(&bytes, st_test_secret_key())) {
        std::fprintf(stderr, "artifact fail %s\n", error.c_str());
        std::exit(2);
    }
    return bytes;
}

struct PhaseStats {
    std::vector<uint64_t> samples;
    void add(uint64_t ns) { samples.push_back(ns); }
    uint64_t pct(double p)
    {
        if (samples.empty()) return 0;
        std::vector<uint64_t> sorted = samples;
        std::sort(sorted.begin(), sorted.end());
        const std::size_t index =
            std::min(sorted.size() - 1, static_cast<std::size_t>(p * static_cast<double>(sorted.size())));
        return sorted[index];
    }
};

} // namespace

int main(int argc, char** argv)
{
    std::size_t steps = 3000;
    bool offload = false;
    bool micro = false;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--steps" && i + 1 < argc) steps = static_cast<std::size_t>(std::atol(argv[++i]));
        else if (arg == "--offload") offload = true;
        else if (arg == "--micro") micro = true;
    }
    const std::string shm_name = "/mkddc_plc_shm_bench_" + std::to_string(::getpid());
    ::setenv("MKDDC_SHM_PLC_NAME", shm_name.c_str(), 1);
    const std::string sock_path = "/tmp/mkddc-scan-bench-" + std::to_string(::getpid()) + ".sock";

    kx_io_shm_t shm{};
    shm.magic = KX_SHM_MAGIC;
    shm.iop_status = KX_IOP_NORMAL;
    shm.ts_ns = 1;
    IobusReader reader;
    reader.attach_external(&shm);
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe{quality};
    OutputWriter writer{reader};
    BacnetObjTable bacnet;
    if (!bacnet.attach()) return 2;
    CoreMetrics metrics;
    AlarmRuntime alarms;
    {
        AlarmEntityConfig cfg;
        cfg.id = "ALM-1";
        cfg.label = "Supply";
        cfg.enabled = true;
        cfg.alarm_type = 1;
        cfg.sources.push_back({{PointKind::AI, 0}, "UI-01"});
        cfg.priority = "high";
        cfg.params.hh = 32.0;
        cfg.params.h = 28.0;
        cfg.params.l = 16.0;
        cfg.params.ll = 12.0;
        alarms.configure({cfg});
    }
    StScheduler scheduler(StSchedulerProfile::REV_A);
    {
        std::string error;
        StTaskConfig task;
        task.id = "main";
        task.period_ms = 10;
        task.budget_us = 1999;
        if (!scheduler.add_task(task, &error)) {
            std::fprintf(stderr, "task fail %s\n", error.c_str());
            return 2;
        }
        scheduler.set_base_step_ns(10000000ull);
        const std::vector<uint8_t> artifact = counter_artifact();
        for (int p = 0; p < 8; ++p) {
            const std::string id = "program-" + std::to_string(p);
            if (!scheduler.add_program("main", id, static_cast<uint16_t>(p), &error) ||
                !scheduler.request_activation(id, artifact, &error)) {
                std::fprintf(stderr, "program fail %s\n", error.c_str());
                return 2;
            }
        }
        scheduler.tick(0);
        for (int p = 0; p < 8; ++p) {
            const std::string id = "program-" + std::to_string(p);
            if (!scheduler.start(id, &error)) {
                std::fprintf(stderr, "start fail %s\n", error.c_str());
                return 2;
            }
        }
    }
    ScanDeps deps{&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer,
                  &bacnet, &metrics, -1, &alarms, nullptr, &scheduler};
    ScanLoop loop(deps);
    if (micro) {
        /* Tách phần còn lại của bước PUBLISH trên luồng quét thành từng việc, để
         * biết con số còn lại đến từ đâu (trung bình trên N lần, đồng hồ thật). */
        const std::size_t n = steps;
        loop.step();
        IoSnapshot io{};
        io.ts_ns = 1;
        const OutputCmd out = resolver.resolve();
        RuntimePointSnapshotPublisher publisher;
        RuntimePointSnapshot snapshot{};
        LatestValueBuffer<RuntimePointSnapshot> exchange;
        std::string payload(KX_POINT_SNAPSHOT_MAX_PAYLOAD, '\0');
        std::size_t payload_size = 0;
        auto time_avg = [&](const char* name, auto&& fn) {
            const uint64_t start = mono_ns();
            for (std::size_t i = 0; i < n; ++i) fn(i);
            const double avg = static_cast<double>(mono_ns() - start) / static_cast<double>(n) / 1000.0;
            std::printf("%-28s %8.2f us\n", name, avg);
        };
        time_avg("snapshot.build", [&](std::size_t i) {
            snapshot = publisher.build(i + 1, 0, i, table, io, out, resolver, false);
        });
        time_avg("st_populate_runtime_snapshot", [&](std::size_t) {
            st_populate_runtime_snapshot(&scheduler, true, &snapshot);
        });
        time_avg("triple_buffer.publish", [&](std::size_t) { exchange.publish(snapshot); });
        time_avg("bacnet.publish", [&](std::size_t) {
            bacnet.publish(table, 1, 0, 0, 0, shm.ui_reliability);
        });
        time_avg("serialize (web-ipc)", [&](std::size_t) {
            (void)serialize_runtime_point_snapshot(snapshot, payload.data(), payload.size(),
                                                   &payload_size);
        });
        std::printf("payload_bytes=%zu programs=%zu\n", payload_size, snapshot.program_count);
        ::shm_unlink(shm_name.c_str());
        return 0;
    }
    if (!web.open(sock_path)) return 2;
    if (offload && !web.start_service_thread("web-ipc")) return 2;

    std::atomic<bool> stop{false};
    std::atomic<bool> client_done{false};
    /* Client bắt đầu SAU scan đầu tiên: trước đó Core chưa có snapshot nào và trả
     * `snapshot_unavailable` đúng hợp đồng — không phải lỗi của thứ đang đo. */
    std::atomic<bool> first_scan_done{false};
    std::atomic<uint64_t> snapshot_ok{0}, write_ok{0}, alarm_ok{0}, failures{0};
    /* Mọi yêu cầu hỏng phải để lại nội dung trả lời: "failures=1" trần trụi không
     * phân biệt được timeout, busy hay trả lời bị cắt. */
    auto report_failure = [&](const std::string& response) {
        failures++;
        std::fprintf(stderr, "BENCH request_failed response_bytes=%zu head=%.160s\n",
                     response.size(), response.c_str());
    };
    std::thread client([&] {
        while (!first_scan_done.load()) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        uint64_t id = 1;
        uint64_t next_snapshot = mono_ns();
        uint64_t next_write = next_snapshot;
        uint64_t next_alarm = next_snapshot;
        int value = 0;
        std::string response;
        while (!stop.load()) {
            const uint64_t now = mono_ns();
            if (now >= next_snapshot) {
                next_snapshot += 50000000ull;
                if (request(sock_path, "{\"id\":" + std::to_string(id++) +
                                           ",\"op\":\"point_snapshot\",\"user\":\"web\"}",
                            &response) &&
                    response.find("\"accepted\"") != std::string::npos)
                    snapshot_ok++;
                else
                    report_failure(response);
            }
            if (now >= next_write) {
                next_write += 200000000ull;
                value ^= 1;
                if (request(sock_path, "{\"id\":" + std::to_string(id++) +
                                           ",\"op\":\"write\",\"point\":\"DO1\",\"value\":" +
                                           std::to_string(value) +
                                           ",\"source\":\"manual\",\"user\":\"bench\"}",
                            &response) &&
                    response.find("\"result\":\"accepted\"") != std::string::npos)
                    write_ok++;
                else
                    report_failure(response);
            }
            if (now >= next_alarm) {
                next_alarm += 1000000000ull;
                if (request(sock_path, "{\"id\":" + std::to_string(id++) +
                                           ",\"op\":\"alarm_list\",\"user\":\"web\"}",
                            &response) &&
                    response.find("\"accepted\"") != std::string::npos)
                    alarm_ok++;
                else
                    report_failure(response);
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        client_done.store(true);
    });

    std::array<PhaseStats, kScanPhaseCount> phases;
    PhaseStats total;
    const uint64_t period = 10000000ull;
    uint64_t deadline = mono_ns() + period;
    for (std::size_t s = 0; s < steps; ++s) {
        shm.ts_ns += period;
        shm.ui_value[0] = static_cast<float>(20 + (s % 20));
        loop.step();
        first_scan_done.store(true);
        const ScanStepWcet& wcet = loop.step_wcet();
        for (std::size_t p = 0; p < kScanPhaseCount; ++p) phases[p].add(wcet.last_ns[p]);
        total.add(wcet.total_last_ns);
        timespec next{static_cast<time_t>(deadline / 1000000000ull),
                      static_cast<long>(deadline % 1000000000ull)};
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, nullptr);
        deadline += period;
    }
    /* Dừng client TRƯỚC vòng quét: yêu cầu cuối của nó vẫn phải có scan phục vụ,
     * không thì kết thúc đo sinh ra "lỗi" giả do chính công cụ đo. */
    stop.store(true);
    while (!client_done.load()) {
        shm.ts_ns += period;
        loop.step();
        timespec next{static_cast<time_t>(deadline / 1000000000ull),
                      static_cast<long>(deadline % 1000000000ull)};
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, nullptr);
        deadline += period;
    }
    client.join();
    web.close();
    ::shm_unlink(shm_name.c_str());

    std::printf("mode=%s steps=%zu snapshot_ok=%llu write_ok=%llu alarm_ok=%llu failures=%llu\n",
                offload ? "offload" : "inline", steps,
                static_cast<unsigned long long>(snapshot_ok.load()),
                static_cast<unsigned long long>(write_ok.load()),
                static_cast<unsigned long long>(alarm_ok.load()),
                static_cast<unsigned long long>(failures.load()));
    std::printf("%-8s %10s %10s %10s\n", "phase", "p50_us", "p99_us", "max_us");
    for (std::size_t p = 0; p < kScanPhaseCount; ++p) {
        std::printf("%-8s %10.1f %10.1f %10.1f\n", scan_phase_name(static_cast<ScanPhase>(p)),
                    phases[p].pct(0.50) / 1000.0, phases[p].pct(0.99) / 1000.0,
                    phases[p].pct(1.0) / 1000.0);
    }
    std::printf("%-8s %10.1f %10.1f %10.1f\n", "total", total.pct(0.50) / 1000.0,
                total.pct(0.99) / 1000.0, total.pct(1.0) / 1000.0);
    return failures.load() == 0 ? 0 : 1;
}
