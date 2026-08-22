/**
 * @file programming_core_sim_main.cpp
 * @brief Core simulator hẹp cho E2E Programming trên host.
 *
 * Simulator dùng ĐÚNG scheduler/coordinator/IPC/loader production, nhưng
 * không gắn I/O vật lý. Nó chỉ có thẩm quyền chứng minh lifecycle
 * Draft -> Check -> Commission -> intent -> Restore trên host; không phải
 * bằng chứng target/HIL hay safe-state phần cứng.
 */

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstdio>
#include <vector>
#include <fstream>
#include <array>
#include <filesystem>
#include <string>
#include <thread>

#include <unistd.h>

#include "graph/point_table.hpp"
#include "ipc/program_ipc_unix.hpp"
#include "priority/priority_resolver.hpp"
#include "programming/program_candidate_registry.hpp"
#include "programming/programming_cutover.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_process_image.hpp"
#include "st/st_signal_bus.hpp"
#include "st/st_value_trace.hpp"

namespace {

std::atomic<bool> shutdown_requested{false};

void on_signal(int)
{
    shutdown_requested.store(true, std::memory_order_release);
}

uint64_t monotonic_now_ns()
{
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(now).count());
}

} // namespace

int main(int argc, char** argv)
{
    using namespace core;
    using namespace core::programming;

    std::string socket_path;
    std::string state_dir;
    /* T59-607 — simulator dùng ĐÚNG loader production, nên khi profile đòi chữ
     * ký nó cũng phải biết tin khoá nào. Không có tuỳ chọn này thì lane
     * real-backend đứng ở Check với `ST-CLI-IO`/`IR-E-007` và người đọc log
     * tưởng compiler hỏng. */
    std::vector<std::string> trusted_key_paths;
    uint32_t tick_ms = 20;
    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--socket" && index + 1 < argc) {
            socket_path = argv[++index];
        } else if (argument == "--state-dir" && index + 1 < argc) {
            state_dir = argv[++index];
        } else if (argument == "--tick-ms" && index + 1 < argc) {
            const long parsed = std::strtol(argv[++index], nullptr, 10);
            if (parsed < 1 || parsed > 1000) {
                std::fprintf(stderr, "tick-ms phải trong khoảng 1..1000\n");
                return 2;
            }
            tick_ms = static_cast<uint32_t>(parsed);
        } else if (argument == "--st-trusted-key" && index + 1 < argc) {
            trusted_key_paths.push_back(argv[++index]);
        } else if (argument == "--help") {
            std::printf("usage: mkddc-programming-core-sim --socket PATH --state-dir DIR "
                        "[--tick-ms N] [--st-trusted-key FILE]\n");
            return 0;
        } else {
            std::fprintf(stderr, "tham số không hợp lệ: %s\n", argument.c_str());
            return 2;
        }
    }
    if (socket_path.empty() || state_dir.empty() || socket_path.size() >= 100) {
        std::fprintf(stderr, "thiếu --socket/--state-dir hoặc socket path quá dài\n");
        return 2;
    }

    std::error_code filesystem_error;
    std::filesystem::create_directories(state_dir + "/staging", filesystem_error);
    if (filesystem_error) {
        std::fprintf(stderr, "không tạo được state dir: %s\n", filesystem_error.message().c_str());
        return 1;
    }

    StScheduler scheduler(StSchedulerProfile::REV_A);
    StTaskConfig task;
    task.id = "main";
    task.priority = 0;
    task.period_ms = 1000;
    task.budget_ms = 199;
    task.overrun_threshold = 3;
    std::string error;
    if (!scheduler.add_task(task, &error)) {
        std::fprintf(stderr, "không tạo được task: %s\n", error.c_str());
        return 1;
    }

    /* Nạp tập khoá tin cậy TRƯỚC khi coordinator phục hồi lifecycle: phục hồi
     * có thể nạp lại gói đang active, và nạp nó bằng chính sách cũ thì cửa đã mở
     * trước khi khoá được gắn. */
    std::vector<std::array<uint8_t, 32>> trusted_keys;
    for (const std::string& path : trusted_key_paths) {
        std::ifstream key_file(path);
        std::string hex;
        if (!key_file || !(key_file >> hex) || hex.size() != 64) {
            std::fprintf(stderr, "khoá tin cậy không đọc được hoặc sai độ dài: %s\n", path.c_str());
            return 2;
        }
        std::array<uint8_t, 32> key{};
        for (std::size_t i = 0; i < 32; ++i)
            key[i] = static_cast<uint8_t>(std::stoul(hex.substr(i * 2, 2), nullptr, 16));
        trusted_keys.push_back(key);
    }
    if (!trusted_keys.empty()) {
        StLoaderOptions loader_options;
        for (const std::array<uint8_t, 32>& key : trusted_keys)
            loader_options.trusted_keys[loader_options.trusted_key_count++] = key.data();
        scheduler.set_loader_options(loader_options);
        std::fprintf(stderr, "INFO  sim.st_trusted_key_count=%zu\n", trusted_keys.size());
    }

    StSignalBus signal_bus;
    scheduler.set_signal_bus(&signal_bus);
    ProgrammingCutover cutover(CutoverMode::GRAPH_ONLY);
    ProgrammingRuntimeCoordinator coordinator(
        &scheduler, &cutover, state_dir + "/lifecycle.bin", state_dir + "/staging");
    if (!coordinator.recover(&error)) {
        std::fprintf(stderr, "không phục hồi được lifecycle: %s\n", error.c_str());
        return 1;
    }
    ProgramCandidateRegistry candidates;
    coordinator.set_candidate_registry(&candidates);
    PriorityResolver priority_resolver;
    PointTable point_table;
    /* T59-505: một INPUT tổng hợp duy nhất để journey real-backend chứng minh
     * Binding đi trọn qua compiler -> package -> process-image -> first-cycle
     * barrier. Đây là dữ liệu HOST-ONLY, không đến từ I/O process/SHM và tuyệt
     * đối không phải bằng chứng physical/HIL. Regular monitor socket vẫn không
     * tồn tại, nên Web API/UI tiếp tục fail-closed 503 thay vì trình bày mẫu này
     * như telemetry phần cứng. */
    IoSnapshot host_input;
    host_input.ts_ns = monotonic_now_ns();
    host_input.ui_value[0] = 21.5f;
    host_input.ui_quality[0] = KX_Q_GOOD;
    point_table.update_inputs(host_input);
    /* Simulator không có I/O/override, nhưng STATUS vẫn phải có một snapshot
     * impact có thẩm quyền. Không gọi đường production này sẽ làm BE trả
     * activeOverrides/cutover=UNAVAILABLE và chặn mọi Commission trước khi E2E
     * kịp chạm Core. */
    coordinator.capture_priority_overrides(priority_resolver);
    StValueTrace trace;
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()), &coordinator);
    server.set_value_trace(&trace, &scheduler);
    ProgramIpcUnixEndpoint endpoint;
    if (!endpoint.open(socket_path, &error)) {
        std::fprintf(stderr, "không mở được Programming IPC: %s\n", error.c_str());
        return 1;
    }

    struct sigaction action {};
    action.sa_handler = on_signal;
    ::sigaction(SIGINT, &action, nullptr);
    ::sigaction(SIGTERM, &action, nullptr);

    std::thread ipc_thread([&] { endpoint.run(&server, &shutdown_requested); });
    std::fprintf(stderr,
                 "INFO programming_core_sim.ready socket=%s synthetic_point=LOCAL:UI-01 "
                 "value=21.5 quality=GOOD host_only=1\n",
                 socket_path.c_str());

    const auto interval = std::chrono::milliseconds(tick_ms);
    auto next = std::chrono::steady_clock::now();
    while (!shutdown_requested.load(std::memory_order_acquire)) {
        const uint64_t now_ns = monotonic_now_ns();
        priority_resolver.begin_cycle();
        coordinator.capture_priority_overrides(priority_resolver);
        coordinator.on_safe_boundary();
        if (cutover.current() == CutoverMode::PROGRAM_ONLY) {
            StIoBridgeStats bridge_stats;
            (void)st_capture_due_inputs(&scheduler, point_table, now_ns, &bridge_stats);
            (void)scheduler.on_base_step(now_ns);
            /* Đi qua đúng process-image production để cập nhật generation và
             * tư cách LKG. Ngoài LOCAL:UI-01 tổng hợp ở trên, mọi binding không
             * có point trong host simulator vẫn fail closed như production. */
            const bool outputs_committed = st_apply_all_outputs(
                &scheduler, &priority_resolver, &point_table, &bridge_stats);
            coordinator.on_output_commit(outputs_committed);
            trace.on_boundary(scheduler, now_ns);
        }
        next += interval;
        std::this_thread::sleep_until(next);
    }

    endpoint.close();
    if (ipc_thread.joinable()) ipc_thread.join();
    std::fprintf(stderr, "INFO programming_core_sim.stopped\n");
    return 0;
}
