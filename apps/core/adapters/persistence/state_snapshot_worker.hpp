/**
 * @file  state_snapshot_worker.hpp
 * @brief T63-203 (F-PRG-PERF-002) — ghi `state.snap` (COR-010) trên một luồng
 *        worker non-RT; luồng quét chỉ BÀN GIAO trạng thái cần lưu.
 *
 * Trước bản này `after_scan` gọi thẳng `StateSnapshot::save` trên luồng quét
 * SCHED_FIFO80: dựng JSON, `open`/`write`, `fsync` file, `rename`, `fsync` thư
 * mục — mỗi 60 s khi có counter đổi, và cả ở đường SIGHUP reload. Một lần
 * `fsync` trên eMMC có thể mất hàng chục ms, tức vài base step 10 ms bị lỡ đúng
 * phút có snapshot.
 *
 * Nay:
 *   - luồng quét gọi `publish_from(graph)`: điền persist state TẠI CHỖ vào vùng
 *     ghi của một `LatestSlotBuffer` (triple buffer), công bố, đánh thức worker.
 *     Không I/O file, không chờ worker; không cấp phát khi các vùng đã được làm
 *     ấm cho graph hiện hành (`prewarm` lúc khởi động);
 *   - worker `core-snapshot` (SCHED_OTHER, rời CPU của vòng quét) lấy BẢN MỚI
 *     NHẤT và gọi `save` — giữ nguyên trình tự `.tmp → fsync → rename → fsync
 *     thư mục` của `StateSnapshot::save`;
 *   - worker chậm/treo không chặn luồng quét: bản chưa ghi bị bản mới thay;
 *   - `stop_and_flush()` (SIGTERM) dừng worker sau khi ghi nốt bản đang chờ;
 *     `main` sau đó vẫn ghi bản cuối cùng đồng bộ như COR-010 (vòng quét đã
 *     dừng, không còn là đường RT).
 *
 * Không tạo được luồng thì `publish_from` ghi đồng bộ như trước (log ERROR) —
 * mất tính năng offload chứ không mất dữ liệu.
 */
#ifndef CORE_STATE_SNAPSHOT_WORKER_HPP
#define CORE_STATE_SNAPSHOT_WORKER_HPP

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

#include "graph/graph_runtime.hpp"
#include "runtime/latest_slot_buffer.hpp"

namespace core {

class StateSnapshotWorker {
public:
    using SaveFn = std::function<bool(const std::vector<PersistEntry>&)>;

    struct Stats {
        uint64_t published = 0;    /* số lần luồng quét bàn giao */
        uint64_t superseded = 0;   /* bản bị bản mới thay trước khi kịp ghi */
        uint64_t saved = 0;        /* lần `save` trả true */
        uint64_t save_failed = 0;  /* lần `save` trả false */
    };

    explicit StateSnapshotWorker(SaveFn save);
    ~StateSnapshotWorker();

    StateSnapshotWorker(const StateSnapshotWorker&) = delete;
    StateSnapshotWorker& operator=(const StateSnapshotWorker&) = delete;

    /* Điền trước cả ba vùng theo graph hiện hành. Gọi TRƯỚC `start()`. */
    void prewarm(const GraphRuntime& graph);

    /* Tạo luồng worker. false = không tạo được (đường dự phòng đồng bộ). */
    bool start(const char* thread_name = "core-snapshot");
    bool running() const { return started_; }

    /* Luồng quét: bàn giao persist state hiện tại cho worker. */
    void publish_from(const GraphRuntime& graph);

    /* Dừng worker sau khi ghi nốt bản đang chờ (SIGTERM, COR-010). */
    void stop_and_flush();

    Stats stats() const;

private:
    void run(const char* thread_name);
    void save_latest();

    SaveFn save_;
    LatestSlotBuffer<std::vector<PersistEntry>> buffer_;
    std::thread thread_;
    std::mutex wake_mu_;
    std::condition_variable wake_cv_;
    std::atomic<bool> stop_{false};
    bool started_ = false;
    char thread_name_[16] = {};
    std::atomic<uint64_t> superseded_{0};
    std::atomic<uint64_t> saved_{0};
    std::atomic<uint64_t> save_failed_{0};
};

} // namespace core

#endif /* CORE_STATE_SNAPSHOT_WORKER_HPP */
