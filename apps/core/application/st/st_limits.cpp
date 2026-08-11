#include "st/st_limits.hpp"

#include <algorithm>

namespace core::st_limits {
namespace {

bool reject(RevAProfileError* error, const char* field, std::size_t actual,
            const std::string& constraint)
{
    if (error) {
        error->field = field;
        error->actual = actual;
        error->constraint = constraint;
    }
    return false;
}

bool max_ok(std::size_t actual, std::size_t limit, const char* field,
            RevAProfileError* error)
{
    return actual <= limit || reject(error, field, actual, "max=" + std::to_string(limit));
}

} // namespace

bool RevAAllowsPeriod(uint32_t period_ms)
{
    const auto& periods = st_profile_generated::kAllowedPeriodMs;
    return std::find(periods.begin(), periods.end(), period_ms) != periods.end();
}

bool ValidateRevAProfile(const RevAProfileUsage& u, RevAProfileError* error)
{
    if (error) *error = RevAProfileError{};
    if (u.profile_code != st_profile_generated::kProfileCode)
        return reject(error, "profileCode", u.profile_code,
                      "exact=" + std::to_string(st_profile_generated::kProfileCode));
    if (u.target_abi != 0x00000F01u)
        return reject(error, "targetAbi", u.target_abi, "exact=3841");
    if (u.task_count == 0 || u.task_count > st_profile_generated::kMaxTasks)
        return reject(error, "taskCount", u.task_count, "range=1..1");
    if (!RevAAllowsPeriod(u.task_period_ms))
        return reject(error, "taskPeriodMs", u.task_period_ms, "enum=1000,5000,30000");
    if (u.programs_per_task == 0 ||
        u.programs_per_task > st_profile_generated::kMaxProgramsPerTask)
        return reject(error, "programsPerTask", u.programs_per_task, "range=1..1");
    if (u.programs_total == 0 || u.programs_total > st_profile_generated::kMaxProgramsTotal)
        return reject(error, "programsTotal", u.programs_total, "range=1..1");

    return max_ok(u.source_bytes, st_profile_generated::kMaxSourceBytes, "sourceBytes", error) &&
           max_ok(u.variables, st_profile_generated::kMaxVariables, "variables", error) &&
           max_ok(u.statements, st_profile_generated::kMaxStatements, "statements", error) &&
           max_ok(u.fbd_blocks, st_profile_generated::kMaxFbdBlocks, "fbdBlocks", error) &&
           max_ok(u.fbd_connections, st_profile_generated::kMaxFbdConnections,
                  "fbdConnections", error) &&
           max_ok(u.artifact_bytes, st_profile_generated::kMaxArtifactBytes,
                  "artifactBytes", error) &&
           max_ok(u.instructions, st_profile_generated::kMaxInstructions, "instructions", error) &&
           max_ok(u.slots, st_profile_generated::kMaxSlots, "slots", error) &&
           max_ok(u.writable_slots, st_profile_generated::kMaxWritableSlots,
                  "writableSlots", error) &&
           max_ok(u.constants, st_profile_generated::kMaxConstants, "constants", error) &&
           max_ok(u.function_blocks, st_profile_generated::kMaxFunctionBlocks,
                  "functionBlocks", error) &&
           max_ok(u.bindings, st_profile_generated::kMaxBindings, "bindings", error) &&
           max_ok(u.retain_variables, st_profile_generated::kMaxRetainVariables,
                  "retainVariables", error) &&
           max_ok(u.retain_bytes, st_profile_generated::kMaxRetainBytes, "retainBytes", error) &&
           max_ok(u.sections, st_profile_generated::kMaxSections, "sections", error);
}

} // namespace core::st_limits
