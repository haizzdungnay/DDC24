/**
 * @file  state_snapshot_worker.cpp
 * @brief T63-203 — xem state_snapshot_worker.hpp.
 */
#include "persistence/state_snapshot_worker.hpp"

#include <chrono>
#include <cstdio>
#include <system_error>

#include "runtime/thread_policy.hpp"

namespace core {

StateSnapshotWorker::StateSnapshotWorker(SaveFn save) : save_(std::move(save)) {}

StateSnapshotWorker::~StateSnapshotWorker()
{
    stop_and_flush();
}

void StateSnapshotWorker::prewarm(const GraphRuntime& graph)
{
    buffer_.prewarm_all([&](std::vector<PersistEntry>& slot) { graph.fill_persist_state(&slot); });
}

bool StateSnapshotWorker::start(const char* thread_name)
{
    if (started_) return true;
    std::snprintf(thread_name_, sizeof(thread_name_), "%s",
                  thread_name && thread_name[0] ? thread_name : "core-snapshot");
    stop_.store(false, std::memory_order_release);
    try {
        thread_ = std::thread(&StateSnapshotWorker::run, this, thread_name_);
    } catch (const std::system_error& error) {
        std::fprintf(stderr,
                     "ERROR state_snapshot.worker_fail err=%s — snapshot ghi trong luong"
                     " quet nhu truoc (T63-203 khong co hieu luc)\n",
                     error.what());
        return false;
    }
    started_ = true;
    std::fprintf(stderr, "INFO  state_snapshot.worker_started thread=%s\n", thread_name_);
    return true;
}

void StateSnapshotWorker::publish_from(const GraphRuntime& graph)
{
    graph.fill_persist_state(&buffer_.write_slot());
    if (buffer_.publish()) superseded_.fetch_add(1, std::memory_order_relaxed);
    if (!started_) {
        /* Đường dự phòng: không có worker thì ghi đồng bộ như trước T63-203. */
        save_latest();
        return;
    }
    /* Không giữ `wake_mu_`: luồng quét không được chờ khoá của worker. Một lần
     * đánh thức lọt (worker vừa kiểm điều kiện xong) chỉ trễ tới nhịp chờ 1 s. */
    wake_cv_.notify_one();
}

void StateSnapshotWorker::save_latest()
{
    if (!buffer_.acquire_latest()) return;
    if (save_(buffer_.read_slot())) saved_.fetch_add(1, std::memory_order_relaxed);
    else save_failed_.fetch_add(1, std::memory_order_relaxed);
}

void StateSnapshotWorker::run(const char* thread_name)
{
    /* Ghi đĩa không phải việc thời gian thực — không được thừa hưởng SCHED_FIFO
     * và CPU của vòng quét (`MBA-FW-01`, ADR-061 4.10). */
    demote_to_normal_sched(thread_name);
    while (!stop_.load(std::memory_order_acquire)) {
        {
            std::unique_lock<std::mutex> lock(wake_mu_);
            wake_cv_.wait_for(lock, std::chrono::seconds(1), [this] {
                return stop_.load(std::memory_order_acquire) || buffer_.has_fresh();
            });
        }
        save_latest();
    }
    save_latest();   /* bản bàn giao ngay trước lúc dừng */
}

void StateSnapshotWorker::stop_and_flush()
{
    if (!started_) return;
    stop_.store(true, std::memory_order_release);
    {
        /* Giữ khoá khi báo dừng để worker không lỡ tín hiệu giữa lúc kiểm điều
         * kiện và lúc ngủ — đây là luồng main lúc tắt, không phải luồng quét. */
        std::lock_guard<std::mutex> lock(wake_mu_);
    }
    wake_cv_.notify_one();
    if (thread_.joinable()) thread_.join();
    started_ = false;
}

StateSnapshotWorker::Stats StateSnapshotWorker::stats() const
{
    Stats out;
    out.published = buffer_.published_count();
    out.superseded = superseded_.load(std::memory_order_relaxed);
    out.saved = saved_.load(std::memory_order_relaxed);
    out.save_failed = save_failed_.load(std::memory_order_relaxed);
    return out;
}

} // namespace core
