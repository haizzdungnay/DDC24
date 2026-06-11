#include "safe_state.hpp"

#include <cstdio>

namespace core {

void SafeState::apply(const IoSnapshot& io, const PointTable& table, OutputCmd* inout)
{
    (void)table;   /* Rev A.1: thêm trigger ui_quality=BAD trên kênh graph đang dùng */

    const bool fault = (io.iop_status == KX_IOP_FAULT || io.iop_status == KX_IOP_SAFE);
    const bool stale = quality_.is_stale();
    const bool trigger = fault || stale;

    if (trigger != active_) {
        if (trigger)
            std::fprintf(stderr, "ERROR safe_state.enter fault=%d stale=%d (AO->safe, DO->open)\n",
                         fault, stale);
        else
            std::fprintf(stderr, "INFO  safe_state.exit (trả quyền cho priority resolver)\n");
        active_ = trigger;   /* log 1 lần/transition */
    }
    if (!trigger)
        return;

    for (int ch = 0; ch < KX_N_AO; ch++) {
        /* safe theo mode ĐÃ áp dụng: 0-10V → 0V; 4-20mA → 4mA */
        inout->ao[ch] = (io.ao_mode[ch] == 1) ? 4.0f : 0.0f;
        inout->ao_valid[ch] = true;
    }
    for (int ch = 0; ch < KX_N_DO; ch++) {
        inout->dout[ch] = 0;   /* open */
        inout->do_valid[ch] = true;
    }
}

} // namespace core
