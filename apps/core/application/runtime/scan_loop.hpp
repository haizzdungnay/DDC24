
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
#include "runtime/base_step_pacer.hpp"
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
#include "programming/programming_cutover.hpp"
#include "programming/program_candidate_registry.hpp"
#include "st/st_value_trace.hpp"
#include "programming/programming_runtime_coordinator.hpp"
#include "ipc/web_ipc.hpp"

namespace core {

/* TASK-PROG-306, DDD-CTRL-PROG-001 §10 / OD-PROG-013: một Point Local logic
 * không được có hai producer. GRAPH_ONLY (mặc định, hành vi trước
 * TASK-PROG-306 giữ nguyên) và PROGRAM_ONLY loại trừ lẫn nhau tại CHÍNH
 * ScanLoop — không phải quy ước cấu hình cần kỷ luật vận hành để không
 * bật nhầm cả hai. Cutover LIVE có rollback (đổi mode khi hệ đang chạy,
 * an toàn nếu package mới lỗi) là phạm vi TASK-PROG-404; đây chỉ là lựa
 * chọn mode tại thời điểm khởi động (bootstrap). */
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
    /* TASK-PROG-306: quyết định GRAPH hay PROGRAM là producer của Local
     * output trong scan này. Mặc định GRAPH_ONLY — không đổi hành vi bootstrap
     * cũ nếu caller không set field này. */
    CutoverMode       mode = CutoverMode::GRAPH_ONLY;
    ProgrammingCutover* cutover = nullptr;
    programming::ProgrammingRuntimeCoordinator* programming_coordinator = nullptr;
    /* TASK-PROG-401 + ADR-051, DDD-CTRL-PROG-001 §6: thời gian tối đa một
     * proposal PRIO_LOCAL_LOGIC được hold-last kể từ lần publish cuối trước khi
     * bị rút (release_ao/release_do), tính bằng ns theo đồng hồ của tick.
     *
     * Mặc định là giá trị ĐÃ KÝ (60 s), không còn là `0`. Mặc định `0` cũ có
     * nghĩa "giữ vô hạn", nên bất kỳ đường nối dây nào quên set field này đều
     * âm thầm quay về đúng hành vi mà ADR-051 đóng lại — mặc định an toàn phải
     * là mặc định đã ký. `0` chỉ còn dùng cho test/chẩn đoán muốn tắt hẳn TTL. */
    uint64_t          program_hold_ttl_ns = st_hold_ttl::kSignedTtlNs;
    /* T59-406: sổ đăng ký candidate output theo Program (kiến trúc §7). Nó chỉ
     * GHI NHẬN quyền sở hữu và lý do rút — trọng tài vẫn là `PriorityResolver`.
     * nullptr = không ghi sổ, hành vi y hệt trước. */
    programming::ProgramCandidateRegistry* candidate_registry = nullptr;
    /* T59-408: trace giá trị lấy tại RANH GIỚI QUÉT. Lấy ở đây chứ không để BE
     * poll vì BE poll ở nhịp riêng của nó — hai biến trong cùng một mẫu có thể
     * đến từ hai chu kỳ khác nhau, và đồ thị sẽ trông hợp lý trong khi quan hệ
     * nhân quả giữa hai biến đã bị xáo. nullptr = không lấy mẫu. */
    StValueTrace* value_trace = nullptr;
};

/* ADR-061 4.10 — các bước của ScanLoop::step() được đo WCET riêng. Thứ tự
 * enum = thứ tự chạy trong step(); log `core.step_wcet` in đúng thứ tự này. */
enum class ScanPhase : uint8_t {
    IO_READ = 0,   /* re-attach, đọc io_shm, quality, đọc ext fieldbus */
    IPC_DRAIN,     /* hết hạn override, drain + áp lệnh web/BACnet */
    SCHEDULES,     /* ScheduleRuntime */
    LOGIC,         /* safe boundary + graph + Program Runtime (ST) */
    ALARMS,        /* AlarmRuntime */
    EXT_WRITES,    /* graph -> plc_shm.ext[].dirty */
    OUTPUT,        /* resolve priority + safe-state + ghi output */
    PUBLISH,       /* point_snapshot, trả lời lệnh, BACnet objtable */
    COUNT
};
constexpr std::size_t kScanPhaseCount = static_cast<std::size_t>(ScanPhase::COUNT);
const char* scan_phase_name(ScanPhase phase);

/* WCET mỗi bước: lần gần nhất và lớn nhất trong phút log hiện tại (ns). */
struct ScanStepWcet {
    std::array<uint64_t, kScanPhaseCount> last_ns{};
    std::array<uint64_t, kScanPhaseCount> minute_max_ns{};
    uint64_t total_last_ns = 0;
    uint64_t total_minute_max_ns = 0;
    uint64_t minute_scans = 0;
};

/* Nguồn thời gian của vòng quét. Mặc định (hai con trỏ nullptr) là
 * CLOCK_MONOTONIC + clock_nanosleep(TIMER_ABSTIME). Test tiêm đồng hồ giả để
 * kiểm chính sách nhịp/trễ/metric mà không phải ngủ thật. Con trỏ hàm, không
 * std::function: không cấp phát, không vtable trên đường RT. */
struct ScanTimeSource {
    uint64_t (*monotonic_ns)(void* ctx) = nullptr;
    void (*sleep_until)(void* ctx, uint64_t deadline_ns) = nullptr;
    void* ctx = nullptr;
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

    /* Chỉ cho test: thay đồng hồ monotonic (dùng cho nhịp, metric C4 và
     * `ClockSnapshot::monotonic_ns` của step) và hàm ngủ. Gọi trước run(). */
    void set_time_source_for_test(const ScanTimeSource& source) { time_ = source; }

    /* Metric C4 hiện hành (ADR-061 4.9) — cùng nguồn với `task` của snapshot. */
    BaseStepTimingSnapshot timing() const { return pacer_.snapshot(); }
    const ScanStepWcet& step_wcet() const { return wcet_; }

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

    uint64_t monotonic_now() const;
    void record_phase(ScanPhase phase, uint64_t* mark);
    void log_minute_stats();

    ScanDeps d_;
    IoSnapshot last_io_;   /* giữ snapshot cũ khi seqlock fail */
    RuntimePointSnapshotPublisher snapshot_publisher_;
    uint64_t next_snapshot_id_ = 1;
    uint64_t budget_ns_ = 10000000ull;   /* = base step; overrun khi exec vượt */
    ScanTimeSource time_{};
    BaseStepPacer pacer_{};
    ScanStepWcet wcet_{};
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
