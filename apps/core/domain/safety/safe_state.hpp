/**
 * @file  safe_state.hpp
 * @brief Ghi đè output an toàn khi IO không tin cậy (07 §5 SAFETY SPEC).
 *        Trigger matrix §5.2 (phía core):
 *          T1/T2: iop_status FAULT/SAFE          — implemented
 *          T3:    shm stale >3 scan               — implemented
 *          T6:    ui_quality=BAD trên kênh graph đang dùng — implemented
 *          T7:    chưa có graph hợp lệ VÀ không có manual/BMS active — implemented
 *        Action §5.3 CỐ ĐỊNH: AO → 0V/4mA theo ao_mode, DO → open — KHÔNG theo
 *        io_safe_state.conf (file đó chỉ cấu hình default mức 6, xem safe_state_config.hpp).
 */
#ifndef CORE_SAFE_STATE_HPP
#define CORE_SAFE_STATE_HPP

#include "graph/graph_runtime.hpp"
#include "ports/io_snapshot.hpp"
#include "graph/point_quality.hpp"
#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "safety/overrun_monitor.hpp"

namespace core {

class SafeState {
public:
    /* graph/resolver có thể nullptr (unit test các trigger T1-T3 độc lập):
     * nullptr → T6/T7 không đánh giá. */
    SafeState(const PointQuality& quality,
              const GraphRuntime* graph = nullptr,
              const PriorityResolver* resolver = nullptr)
        : quality_(quality), graph_(graph), resolver_(resolver) {}

    /* T8: Task overrun vượt ngưỡng liên tiếp (PROGRAM_TASK_SCHEDULER_SPEC §6.4).
     * OverrunMonitor chỉ ĐÁNH GIÁ; quyền ép output nằm ở đây — đúng phân tách
     * trách nhiệm ở §6.1. nullptr = không đánh giá T8. */
    void set_overrun_monitor(const OverrunMonitor* m) { overrun_ = m; }

    /* Lý do vào safe của lần transition gần nhất — cho alarm và chẩn đoán. */
    struct Triggers {
        bool iop_fault = false;
        bool stale = false;
        bool graph_input_bad = false;
        bool no_controller = false;
        bool overrun = false;
    };
    const Triggers& triggers() const { return triggers_; }

    /* Có thể ghi đè *inout — gọi SAU priority_resolver.resolve() (scan step 7).
     * `graph_is_active_producer=false` khi Program đã sở hữu Local logic: graph
     * cũ vẫn được giữ để rollback nhưng không còn là authority cho T6/T7. */
    void apply(const IoSnapshot& io, const PointTable& table, OutputCmd* inout,
               bool graph_is_active_producer = true);

    bool active() const { return active_; }

private:
    const PointQuality& quality_;
    const GraphRuntime* graph_;
    const PriorityResolver* resolver_;
    const OverrunMonitor*   overrun_ = nullptr;
    Triggers triggers_;
    bool active_ = false;
};

} // namespace core

#endif /* CORE_SAFE_STATE_HPP */
