#include "safety/safe_state.hpp"

#include <cstdio>

namespace core {

void SafeState::apply(const IoSnapshot& io, const PointTable& table, OutputCmd* inout,
                      bool graph_is_active_producer)
{
    /* T1/T2: IOP fault/safe */
    const bool fault = (io.iop_status == KX_IOP_FAULT || io.iop_status == KX_IOP_SAFE);
    /* T3: shm stale */
    const bool stale = quality_.is_stale();

    /* T6: chỉ graph đang SỞ HỮU Local logic mới có quyền làm input graph kích
     * hoạt SafeState. PROGRAM_ONLY vẫn giữ graph đã load để rollback, nhưng
     * graph đó không còn chạy và không được chi phối output của Program. */
    bool graph_input_bad = false;
    if (graph_is_active_producer && graph_ && graph_->loaded()) {
        for (const int ch : graph_->used_ai_channels()) {
            if (table.get({PointKind::AI, ch}).quality == KX_Q_BAD) {
                graph_input_bad = true;
                break;
            }
        }
    }

    /* T7: chưa có graph hợp lệ VÀ không có lệnh manual/BMS active —
     * không ai đang điều khiển → về safe thay vì để default mức 6 tự chạy.
     * (Default mức 6 chỉ có hiệu lực khi hệ có ít nhất 1 nguồn điều khiển.) */
    const bool no_controller = (graph_ && resolver_)
                             ? ((!graph_is_active_producer || !graph_->loaded()) &&
                                !resolver_->any_active_above_default())
                             : false;

    /* T8: Task overrun lặp quá ngưỡng. Ngang hàng với các trigger khác —
     * không phải đường riêng, để mọi nguồn nguy hiểm hội tụ về cùng một hành
     * động an toàn. */
    const bool overrun = overrun_ && overrun_->should_force_safe();

    const bool trigger = fault || stale || graph_input_bad || no_controller || overrun;

    triggers_ = Triggers{fault, stale, graph_input_bad, no_controller, overrun};

    if (trigger != active_) {
        if (trigger)
            std::fprintf(stderr,
                         "ERROR safe_state.enter fault=%d stale=%d graph_bad=%d no_ctrl=%d"
                         " overrun=%d (AO->safe, DO->open)\n",
                         fault, stale, graph_input_bad, no_controller, overrun);
        else
            std::fprintf(stderr, "INFO  safe_state.exit (trả quyền cho priority resolver)\n");
        active_ = trigger;   /* log 1 lần/transition (§5.3) */
    }
    if (!trigger)
        return;

    for (int ch = 0; ch < KX_N_AO; ch++) {
        /* safe theo mode ĐÃ áp dụng: 0-10V → 0V; 4-20mA → 4mA (§5.3 cố định) */
        inout->ao[ch] = (io.ao_mode[ch] == 1) ? 4.0f : 0.0f;
        inout->ao_valid[ch] = true;
    }
    for (int ch = 0; ch < KX_N_DO; ch++) {
        inout->dout[ch] = 0;   /* open */
        inout->do_valid[ch] = true;
    }
}

} // namespace core
