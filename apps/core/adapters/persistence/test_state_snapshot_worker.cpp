/**
 * @file  test_state_snapshot_worker.cpp
 * @brief T63-203 (F-PRG-PERF-002): ghi `state.snap` rời khỏi luồng quét.
 *        Luồng gọi `publish_from` (đóng vai luồng quét) KHÔNG bao giờ gọi
 *        `save`; worker chậm/treo không chặn nó; bản mới thay bản chưa ghi;
 *        bàn giao không cấp phát sau khi làm ấm; dừng thì ghi nốt bản đang chờ.
 */
#include <gtest/gtest.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <filesystem>
#include <mutex>
#include <thread>
#include <vector>

#include <unistd.h>

#include "graph/graph_runtime.hpp"
#include "persistence/state_snapshot.hpp"
#include "persistence/state_snapshot_worker.hpp"
#include "tests/allocation_probe.hpp"

using namespace core;

namespace {

/* Id dài hơn SSO của libstdc++ (15 ký tự) để chuỗi phải nằm trên heap: làm ấm
 * mới là thứ giữ cho lần bàn giao không cấp phát. */
constexpr const char* kLongPulseId = "pulse_counter_kwh_main_building";

void load_counter_graph(GraphRuntime* graph)
{
    const std::string src = std::string(R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"run_sp", "type":"Setpoint","params":{"default":1}},
        {"id":"rst_sp", "type":"Setpoint","params":{"default":0}},
        {"id":"fan_runtime_hours_ahu1", "type":"RuntimeCounter","params":{}},
        {"id":")") + kLongPulseId + R"(", "type":"PulseCounter","params":{"scale":1.0}}
      ],
      "links": [
        {"from":"run_sp.out", "to":"fan_runtime_hours_ahu1.run"},
        {"from":"rst_sp.out", "to":"fan_runtime_hours_ahu1.reset"}
      ]
    })";
    ASSERT_TRUE(graph->load_string(src));
}

void set_pulse(GraphRuntime* graph, uint64_t count)
{
    graph->restore_persist_state({{kLongPulseId, "PulseCounter", 0.0, count}});
}

uint64_t pulse_of(const std::vector<PersistEntry>& entries)
{
    for (const PersistEntry& e : entries)
        if (e.id == kLongPulseId) return e.count_raw;
    return UINT64_MAX;
}

/* Ghi lại mọi lần `save`: luồng gọi và nội dung; có thể chặn lần gọi đầu. */
struct RecordingSink {
    std::mutex mu;
    std::condition_variable cv;
    std::vector<std::thread::id> threads;
    std::vector<uint64_t> pulses;
    bool block_first = false;
    bool released = false;
    bool first_entered = false;

    bool save(const std::vector<PersistEntry>& entries)
    {
        std::unique_lock<std::mutex> lock(mu);
        const bool first = threads.empty() && !first_entered;
        if (first) first_entered = true;
        cv.notify_all();
        if (first && block_first) cv.wait(lock, [this] { return released; });
        threads.push_back(std::this_thread::get_id());
        pulses.push_back(pulse_of(entries));
        cv.notify_all();
        return true;
    }
    bool wait_saves(std::size_t n, std::chrono::milliseconds timeout)
    {
        std::unique_lock<std::mutex> lock(mu);
        return cv.wait_for(lock, timeout, [&] { return threads.size() >= n; });
    }
    bool wait_first_entered(std::chrono::milliseconds timeout)
    {
        std::unique_lock<std::mutex> lock(mu);
        return cv.wait_for(lock, timeout, [&] { return first_entered; });
    }
    void release()
    {
        std::lock_guard<std::mutex> lock(mu);
        released = true;
        cv.notify_all();
    }
};

} // namespace

/* AC: luồng quét chỉ bàn giao; `save` (open/write/fsync/rename) chạy trên worker. */
TEST(StateSnapshotWorkerT63203, SaveRunsOnWorkerThreadNeverOnPublishingThread)
{
    GraphRuntime graph;
    load_counter_graph(&graph);
    set_pulse(&graph, 42);
    RecordingSink sink;
    StateSnapshotWorker worker([&](const std::vector<PersistEntry>& e) { return sink.save(e); });
    worker.prewarm(graph);
    ASSERT_TRUE(worker.start("snap-test"));

    worker.publish_from(graph);
    ASSERT_TRUE(sink.wait_saves(1, std::chrono::seconds(3)));
    worker.stop_and_flush();

    std::lock_guard<std::mutex> lock(sink.mu);
    ASSERT_EQ(sink.threads.size(), 1u);
    EXPECT_NE(sink.threads[0], std::this_thread::get_id()) << "save không được chạy trên luồng quét";
    EXPECT_EQ(sink.pulses[0], 42u);
    EXPECT_EQ(worker.stats().saved, 1u);
}

/* AC: worker chậm/treo không chặn luồng quét; bản mới thay bản chưa ghi. */
TEST(StateSnapshotWorkerT63203, StuckWorkerDoesNotBlockScanAndLatestWins)
{
    GraphRuntime graph;
    load_counter_graph(&graph);
    RecordingSink sink;
    sink.block_first = true;
    StateSnapshotWorker worker([&](const std::vector<PersistEntry>& e) { return sink.save(e); });
    worker.prewarm(graph);
    ASSERT_TRUE(worker.start("snap-test"));

    set_pulse(&graph, 1);
    worker.publish_from(graph);
    ASSERT_TRUE(sink.wait_first_entered(std::chrono::seconds(3))) << "worker phải đang kẹt trong save v1";

    auto worst = std::chrono::nanoseconds(0);
    for (uint64_t v = 2; v <= 6; ++v) {
        set_pulse(&graph, v);
        const auto t0 = std::chrono::steady_clock::now();
        worker.publish_from(graph);
        const auto spent = std::chrono::steady_clock::now() - t0;
        if (spent > worst) worst = spent;
    }
    /* Trần rộng cho lịch máy CI; điều khẳng định là KHÔNG chờ worker (đang kẹt
     * vô thời hạn — chờ thì test treo ở đây). */
    EXPECT_LT(worst, std::chrono::milliseconds(50));

    sink.release();
    ASSERT_TRUE(sink.wait_saves(2, std::chrono::seconds(3)));
    worker.stop_and_flush();

    std::lock_guard<std::mutex> lock(sink.mu);
    ASSERT_EQ(sink.pulses.size(), 2u) << "v2..v5 bị thay, không ghi từng bản";
    EXPECT_EQ(sink.pulses[0], 1u);
    EXPECT_EQ(sink.pulses[1], 6u) << "sau khi hết kẹt, worker ghi BẢN MỚI NHẤT";
    const StateSnapshotWorker::Stats stats = worker.stats();
    EXPECT_EQ(stats.published, 6u);
    EXPECT_EQ(stats.superseded, 4u);
    EXPECT_EQ(stats.saved, 2u);
}

/* AC: không cấp phát trên đường bàn giao (luồng quét) sau khi làm ấm. Bộ đếm
 * cấp phát là thread_local: cấp phát của worker (dựng JSON) không bị tính. */
TEST(StateSnapshotWorkerT63203, PublishDoesNotAllocateAfterPrewarm)
{
    GraphRuntime graph;
    load_counter_graph(&graph);
    RecordingSink sink;
    StateSnapshotWorker worker([&](const std::vector<PersistEntry>& e) { return sink.save(e); });
    worker.prewarm(graph);
    ASSERT_TRUE(worker.start("snap-test"));

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (int i = 0; i < 1000; ++i) worker.publish_from(graph);
        allocations = counter.allocations();
    }
    worker.stop_and_flush();
    EXPECT_EQ(allocations, 0u);
    EXPECT_EQ(worker.stats().published, 1000u);
}

/* Đối chứng: KHÔNG làm ấm thì lần bàn giao đầu có cấp phát (id dài nằm trên
 * heap) — chứng minh test ở trên đo đúng thứ nó định đo. */
TEST(StateSnapshotWorkerT63203, WithoutPrewarmFirstPublishAllocates)
{
    GraphRuntime graph;
    load_counter_graph(&graph);
    StateSnapshotWorker worker([](const std::vector<PersistEntry>&) { return true; });
    ASSERT_TRUE(worker.start("snap-test"));
    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        worker.publish_from(graph);
        allocations = counter.allocations();
    }
    worker.stop_and_flush();
    EXPECT_GT(allocations, 0u);
}

/* AC COR-010: dừng (SIGTERM) thì ghi nốt bản đã bàn giao, bằng đúng
 * `StateSnapshot::save` (.tmp → fsync → rename → fsync thư mục). */
TEST(StateSnapshotWorkerT63203, StopFlushesPendingHandoffToRealFile)
{
    const std::string path = (std::filesystem::temp_directory_path() /
                              ("mkddc_t63203_" + std::to_string(::getpid()) + ".snap")).string();
    std::remove(path.c_str());
    std::remove((path + ".tmp").c_str());
    GraphRuntime graph;
    load_counter_graph(&graph);
    set_pulse(&graph, 884213);
    StateSnapshot snap(path);
    StateSnapshotWorker worker(
        [&snap](const std::vector<PersistEntry>& e) { return snap.save(e); });
    worker.prewarm(graph);
    ASSERT_TRUE(worker.start("snap-test"));
    worker.publish_from(graph);
    worker.stop_and_flush();

    const std::vector<PersistEntry> loaded = snap.load();
    EXPECT_EQ(pulse_of(loaded), 884213u);
    EXPECT_FALSE(std::filesystem::exists(path + ".tmp")) << "rename đã thay .tmp";
    EXPECT_GE(worker.stats().saved, 1u);
    std::remove(path.c_str());
}

/* Không tạo được worker (hoặc chưa start): ghi đồng bộ như trước T63-203 —
 * mất offload, không mất dữ liệu. */
TEST(StateSnapshotWorkerT63203, NotStartedFallsBackToSynchronousSave)
{
    GraphRuntime graph;
    load_counter_graph(&graph);
    set_pulse(&graph, 7);
    std::vector<std::thread::id> threads;
    StateSnapshotWorker worker([&](const std::vector<PersistEntry>&) {
        threads.push_back(std::this_thread::get_id());
        return true;
    });
    worker.publish_from(graph);
    ASSERT_EQ(threads.size(), 1u);
    EXPECT_EQ(threads[0], std::this_thread::get_id());
}

/* `fill_persist_state` cho cùng nội dung với `get_persist_state` (đường cũ). */
TEST(StateSnapshotWorkerT63203, FillMatchesGetPersistState)
{
    GraphRuntime graph;
    load_counter_graph(&graph);
    set_pulse(&graph, 99);
    std::vector<PersistEntry> filled(5);   /* thừa phần tử: phải co về đúng số node */
    graph.fill_persist_state(&filled);
    const std::vector<PersistEntry> got = graph.get_persist_state();
    ASSERT_EQ(filled.size(), got.size());
    ASSERT_EQ(got.size(), 2u);
    for (std::size_t i = 0; i < got.size(); ++i) {
        EXPECT_EQ(filled[i].id, got[i].id);
        EXPECT_EQ(filled[i].type, got[i].type);
        EXPECT_EQ(filled[i].count_raw, got[i].count_raw);
        EXPECT_DOUBLE_EQ(filled[i].run_seconds, got[i].run_seconds);
    }
}
