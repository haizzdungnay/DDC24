/**
 * @file  config_reload.hpp
 * @brief SIGHUP reload (CONFIG_SCHEMA D-5, COR-008): nạp lại io_config.conf +
 *        io_safe_state.conf + graph.json Ở RANH GIỚI scan, KHÔNG restart core.
 *        Khác boot: fail bất kỳ phần nào → GIỮ config cũ + WARN (boot fail-fast).
 *        Manual/priority đang active GIỮ NGUYÊN — chỉ default mức 6 + graph đổi.
 */
#ifndef CORE_CONFIG_RELOAD_HPP
#define CORE_CONFIG_RELOAD_HPP

#include <string>

#include "graph_runtime.hpp"
#include "priority_resolver.hpp"

namespace core {

class AlarmRuntime;
class ScheduleRuntime;

struct ReloadSpec {
    std::string graph_path;
    std::string safe_cfg_path;
    std::string io_cfg_path;
    std::string alarm_cfg_path;
    std::string schedule_cfg_path;
    bool safe_cfg_must_exist = false;   /* giữ semantics --safe-state-conf lúc boot */
    bool io_cfg_must_exist = false;     /* giữ semantics --io-conf lúc boot */
    bool alarm_cfg_must_exist = false;
    bool schedule_cfg_must_exist = false;
};

/* true  = mọi phần áp dụng OK (hoặc không đổi)
 * false = có phần fail — phần đó GIỮ config cũ, các phần pass vẫn áp dụng */
bool reload_configs(const ReloadSpec& spec, PriorityResolver* resolver, GraphRuntime* graph,
                    AlarmRuntime* alarms = nullptr, ScheduleRuntime* schedules = nullptr);

} // namespace core

#endif /* CORE_CONFIG_RELOAD_HPP */
