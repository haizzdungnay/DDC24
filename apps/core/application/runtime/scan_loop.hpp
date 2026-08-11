
/**
 * @file  scan_loop.hpp
 * @brief Vòng quét tuyệt-đối-thời-gian (07 §2): clock_nanosleep(ABSTIME), không drift.
 *        Thứ tự bước cố định: read IO → quality → web cmd → graph → priority →
 *        safe-state → write output → publish BACnet → metrics → sleep.
 */
#ifndef CORE_SCAN_LOOP_HPP
#define CORE_SCAN_LOOP_HPP

#include <atomic>
#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "alarm/alarm_runtime.hpp"
#include "bacnet/bacnet_objtable.hpp"
#include "diagnostics/core_metrics.hpp"
#include "graph/graph_runtime.hpp"
#include "ports/io_snapshot_reader.hpp"
#include "ports/output_command.hpp"
#include "graph/point_quality.hpp"
#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "graph/runtime_point_snapshot.hpp"
#include "safety/safe_state.hpp"
#include "schedule/schedule_runtime.hpp"
#include "st/st_process_image.hpp"
#include "st/st_scheduler.hpp"
#include "ipc/web_ipc.hpp"

namespace core {

struct ScanDeps {
    IoSnapshotReaderPort* reader;
    PointTable*       table;
    PointQuality*     quality;
    WebIpc*           web;
    GraphRuntime*     graph;
    PriorityResolver* resolver;
    SafeState*        safe;
    OutputCommandPort* writer;
    BacnetObjTable*   bacnet;
    CoreMetrics*      metrics;
    /* MOD-009: fd của fieldbus.sock SOCK_DGRAM (bind bởi core); -1 = chưa open */
    int               fieldbus_sockfd = -1;
    AlarmRuntime*     alarms = nullptr;
    ScheduleRuntime*  schedules = nullptr;
    /* ACTION 10: Program Runtime. nullptr = không có chương trình ST nào được
     * cấu hình — scan loop chạy y như trước, không thêm chi phí nào. */
    StScheduler*      st_sched = nullptr;
};

class ScanLoop {
public:
    explicit ScanLoop(ScanDeps deps) : d_(deps) {}

    /* 1 chu kỳ scan (step 1-10 của 07 §2) — public để test không cần timer. */
    void step();

    /* Chạy tới khi *shutdown = true. `base_step_ns` là nhịp nền tảng, KHÔNG
     * phải chu kỳ Task Programming. Task 30 s không được làm vòng này ngủ 30 s.
     * on_first_scan: callback sau scan đầu (sd_notify READY). */
    void run(const std::atomic<bool>& shutdown, uint64_t base_step_ns,
             void (*after_scan)(void*) = nullptr, void* ctx = nullptr);

    /* SIGHUP reload hook (COR-008): flag do signal handler set; fn chạy Ở RANH GIỚI
     * scan (trước step kế — không nuốt config giữa lúc đang resolve). Sau fn,
     * dt của graph được re-sync về chu kỳ scan thật (reload reset về declared). */
    void set_reload_hook(std::atomic<bool>* flag, void (*fn)(void*), void* ctx);

#ifdef CORE_BUILD_TESTS
    /* CR-007: pending_/pending_alarm_ là member pre-allocated, .clear() mỗi scan
     * (KHÔNG giải phóng capacity) để tránh heap alloc lặp lại trong scan hot path.
     * Test dùng capacity để verify capacity không tăng lại sau khi đã ổn định. */
    std::size_t pending_capacity_for_test() const { return pending_.capacity(); }
    std::size_t pending_alarm_capacity_for_test() const { return pending_alarm_.capacity(); }
    const StIoBridgeStats& st_io_stats_for_test() const { return st_io_stats_; }
    const StSchedulerTickResult& st_tick_for_test() const { return st_tick_; }
#endif

private:
    struct PendingResp { WebCommand cmd; bool ok; };

    ScanDeps d_;
    IoSnapshot last_io_;   /* giữ snapshot cũ khi seqlock fail */
    RuntimePointSnapshotPublisher snapshot_publisher_;
    uint64_t next_snapshot_id_ = 1;
    uint64_t budget_ns_ = 1000000000ull;   /* = period; overrun khi exec vượt */
    std::atomic<bool>* reload_flag_ = nullptr;
    void (*reload_fn_)(void*) = nullptr;
    void* reload_ctx_ = nullptr;
    /* pre-allocated: tránh heap alloc mỗi scan trong SCHED_FIFO (CR-007) */
    std::vector<PendingResp> pending_;
    std::vector<WebCommand> pending_alarm_;
    StIoBridgeStats       st_io_stats_{};
    StSchedulerTickResult st_tick_{};
    std::array<uint64_t, KX_N_AO> manual_ao_expiry_ns_{};
    std::array<uint64_t, KX_N_DO> manual_do_expiry_ns_{};
    std::array<uint64_t, KX_N_AO> manual_ao_request_id_{};
    std::array<uint64_t, KX_N_DO> manual_do_request_id_{};
    std::array<std::string, KX_N_AO> manual_ao_user_{};
    std::array<std::string, KX_N_DO> manual_do_user_{};
};

} // namespace core

#endif /* CORE_SCAN_LOOP_HPP */
