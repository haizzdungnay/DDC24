#include "config_reload.hpp"

#include <cstdio>

#include "alarm_runtime.hpp"
#include "safe_state_config.hpp"

namespace core {

bool reload_configs(const ReloadSpec& spec, PriorityResolver* resolver, GraphRuntime* graph,
                    AlarmRuntime* alarms)
{
    bool all_ok = true;

    /* default mức 6: load vào temp, CHỈ apply khi cả io_config + safe_state pass —
     * resolver không bị đụng khi fail (manual/priority đang active luôn giữ nguyên) */
    AoModeConfig modes;
    SafeStateConfig cfg;
    if (load_ao_modes(spec.io_cfg_path, spec.io_cfg_must_exist, &modes) &&
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

    if (alarms && !spec.alarm_cfg_path.empty() &&
        !alarms->reload(spec.alarm_cfg_path, spec.alarm_cfg_must_exist))
        all_ok = false;

    return all_ok;
}

} // namespace core
