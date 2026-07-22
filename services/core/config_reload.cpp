#include "config_reload.hpp"

#include <cstdio>

#include "safe_state_config.hpp"

namespace core {

bool reload_configs(const ReloadSpec& spec, PriorityResolver* resolver, GraphRuntime* graph)
{
    bool all_ok = true;

    /* default mức 6: load vào temp, CHỈ apply khi cả io_config + safe_state pass —
     * resolver không bị đụng khi fail (manual/priority đang active luôn giữ nguyên) */
    AoModeConfig modes;
    SafeStateConfig cfg;
    bool mode_unchanged = load_ao_modes(spec.io_cfg_path, spec.io_cfg_must_exist, &modes);
    if (mode_unchanged && resolver) {
        for (int ch = 0; ch < KX_N_AO; ch++) {
            if (modes.mode[ch] != resolver->ao_mode(ch)) {
                std::fprintf(stderr,
                             "WARN  reload.requires_restart field=ao_mode ch=%d applied=%u requested=%u\n",
                             ch + 1, resolver->ao_mode(ch), modes.mode[ch]);
                mode_unchanged = false;
            }
        }
    }
    if (mode_unchanged &&
        load_safe_state_config(spec.safe_cfg_path, spec.safe_cfg_must_exist, modes, &cfg)) {
        apply_safe_state_config(cfg, resolver);
        std::fprintf(stderr, "INFO  reload.safe_state ok (default mức 6 cập nhật)\n");
    } else {
        std::fprintf(stderr, "WARN  reload.safe_state fail — GIỮ config cũ\n");
        all_ok = false;
    }

    /* graph: reload() atomic swap-on-success; nội dung không đổi → giữ state PID */
    if (graph && !graph->reload(spec.graph_path))
        all_ok = false;

    return all_ok;
}

} // namespace core
