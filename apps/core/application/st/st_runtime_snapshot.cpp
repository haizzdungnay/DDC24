#include "st/st_runtime_snapshot.hpp"

#include <algorithm>
#include <cstring>

#include "st/st_scheduler.hpp"

namespace core {
namespace {

template <std::size_t N>
void copy_bounded(std::array<char, N>* target, const std::string& value) noexcept
{
    static_assert(N > 0, "buffer chuỗi phải có chỗ cho NUL");
    const std::size_t count = std::min(value.size(), N - 1);
    std::memcpy(target->data(), value.data(), count);
}

template <std::size_t N>
void copy_bounded(std::array<char, N>* target, const char* value) noexcept
{
    if (value == nullptr) return;
    const std::size_t count = std::min(std::strlen(value), N - 1);
    std::memcpy(target->data(), value, count);
}

} // namespace

void st_populate_runtime_snapshot(const StScheduler* scheduler, bool program_owner,
                                  RuntimePointSnapshot* snapshot) noexcept
{
    if (snapshot == nullptr) return;
    snapshot->task = RuntimeTaskSnapshot{};
    snapshot->program_count = 0;
    snapshot->programs_truncated = false;
    for (RuntimeProgramSnapshot& program : snapshot->programs)
        program = RuntimeProgramSnapshot{};
    if (scheduler == nullptr || scheduler->tasks().empty()) return;

    const StTask& first_task = *scheduler->tasks().front();
    RuntimeTaskSnapshot& task = snapshot->task;
    task.present = true;
    copy_bounded(&task.id, first_task.config().id);
    task.period_ms = first_task.config().period_ms;
    task.budget_ms = first_task.config().budget_ms;
    const char* task_state = first_task.monitor().should_force_safe()
                                 ? "FAULT"
                                 : (program_owner && first_task.enabled() ? "RUNNING"
                                                                          : "STOPPED");
    copy_bounded(&task.state, task_state);
    task.run_count = first_task.stats().run_count;
    task.missed_release_count = first_task.stats().missed_release_count;
    task.last_exec_ns = first_task.stats().last_exec_ns;
    task.max_exec_ns = first_task.stats().max_exec_ns;
    task.overrun_count = first_task.monitor().stats().total;
    task.consecutive_overruns = first_task.monitor().stats().consecutive;

    static_assert(KX_POINT_SNAPSHOT_MAX_PROGRAMS >= st_sched_limits::kMaxProgramsTotal,
                  "trần programs[] phải phủ hết Program toàn hệ thống");
    std::size_t filled = 0;
    for (const auto& scheduler_task : scheduler->tasks()) {
        if (snapshot->programs_truncated) break;
        for (const auto& program : scheduler_task->programs()) {
            if (filled >= snapshot->programs.size()) {
                snapshot->programs_truncated = true;
                break;
            }
            RuntimeProgramSnapshot& target = snapshot->programs[filled++];
            copy_bounded(&target.instance_id, program->instance_id);
            copy_bounded(&target.state, st_program_state_name(program->state));
            target.enabled = program->enabled;
            target.period_ms = program->period_ms != 0
                                   ? program->period_ms
                                   : scheduler_task->config().period_ms;
            target.last_exec_ns = program->last_exec_ns;
            target.max_exec_ns = program->max_exec_ns;
            target.missed_release_count = program->missed_release_count;
            target.consecutive_missed_release = program->consecutive_missed_release;
            target.last_run_mono_ns = program->last_run_mono_ns;
            target.lane = program->lane;
        }
    }
    snapshot->program_count = filled;
}

} // namespace core
