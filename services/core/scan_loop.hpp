
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

#include "alarm_runtime.hpp"
#include "bacnet_objtable.hpp"
#include "core_metrics.hpp"
#include "graph_runtime.hpp"
#include "iobus_reader.hpp"
#include "output_writer.hpp"
#include "point_quality.hpp"
#include "point_table.hpp"
#include "priority_resolver.hpp"
#include "runtime_point_snapshot.hpp"
#include "safe_state.hpp"
#include "schedule_runtime.hpp"
#include "web_ipc.hpp"

namespace core {

struct ScanDeps {
    IobusReader*      reader;
    PointTable*       table;
    PointQuality*     quality;
    WebIpc*           web;
    GraphRuntime*     graph;
    PriorityResolver* resolver;
    SafeState*        safe;
    OutputWriter*     writer;
    BacnetObjTable*   bacnet;
    CoreMetrics*      metrics;
    /* MOD-009: fd của fieldbus.sock SOCK_DGRAM (bind bởi core); -1 = chưa open */
    int               fieldbus_sockfd = -1;
    AlarmRuntime*     alarms = nullptr;
    ScheduleRuntime*  schedules = nullptr;
};

class ScanLoop {
public:
    explicit ScanLoop(ScanDeps deps) : d_(deps) {}

    /* 1 chu kỳ scan (step 1-10 của 07 §2) — public để test không cần timer. */
    void step();

    /* Chạy tới khi *shutdown = true. period_ns mặc định 1s (Rev A).
     * on_first_scan: callback sau scan đầu (sd_notify READY). */
    void run(const std::atomic<bool>& shutdown, uint64_t period_ns,
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
    std::array<uint64_t, KX_N_AO> manual_ao_expiry_ns_{};
    std::array<uint64_t, KX_N_DO> manual_do_expiry_ns_{};
    std::array<uint64_t, KX_N_AO> manual_ao_request_id_{};
    std::array<uint64_t, KX_N_DO> manual_do_request_id_{};
    std::array<std::string, KX_N_AO> manual_ao_user_{};
    std::array<std::string, KX_N_DO> manual_do_user_{};
};

} // namespace core

#endif /* CORE_SCAN_LOOP_HPP */
