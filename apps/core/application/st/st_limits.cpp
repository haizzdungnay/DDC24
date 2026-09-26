#include "st/st_limits.hpp"

#include <algorithm>
#include <iterator>
#include <string>

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

/* Constraint text phải suy từ profile machine-readable. Trước đây các chuỗi
 * "range=1..1" và "enum=1000,5000,30000" được viết cứng, nên khi profile nâng
 * capacity thì thông điệp lỗi vẫn nói giới hạn cũ và người đọc log bị dẫn sai. */
std::string range_text(std::size_t limit)
{
    return "range=1.." + std::to_string(limit);
}

std::string allowed_period_text()
{
    std::string out = "enum=";
    bool first = true;
    for (uint32_t period : st_profile_generated::kAllowedPeriodMs) {
        if (!first) out += ",";
        out += std::to_string(period);
        first = false;
    }
    return out;
}

bool range_ok(std::size_t actual, std::size_t limit, const char* field,
              RevAProfileError* error)
{
    return (actual != 0 && actual <= limit) || reject(error, field, actual, range_text(limit));
}

} // namespace

bool RevAAllowsPeriod(uint32_t period_ms)
{
    const auto& periods = st_profile_generated::kAllowedPeriodMs;
    return std::find(periods.begin(), periods.end(), period_ms) != periods.end();
}

bool RevAIsLegacyPeriod(uint32_t period_ms)
{
    if (RevAAllowsPeriod(period_ms)) return false;
    return std::find(std::begin(kRevAV21PeriodsMs), std::end(kRevAV21PeriodsMs), period_ms) !=
           std::end(kRevAV21PeriodsMs);
}

bool RevALoaderAllowsPeriod(uint32_t period_ms)
{
    return RevAAllowsPeriod(period_ms) || RevAIsLegacyPeriod(period_ms);
}

bool ValidateRevAProfile(const RevAProfileUsage& u, RevAProfileError* error)
{
    if (error) *error = RevAProfileError{};
    if (u.profile_code != st_profile_generated::kProfileCode)
        return reject(error, "profileCode", u.profile_code,
                      "exact=" + std::to_string(st_profile_generated::kProfileCode));
    if (u.target_abi != st_profile_generated::kTargetAbi)
        return reject(error, "targetAbi", u.target_abi,
                      "exact=" + std::to_string(st_profile_generated::kTargetAbi));
    if (!range_ok(u.task_count, st_profile_generated::kMaxTasks, "taskCount", error))
        return false;
    if (!RevAAllowsPeriod(u.task_period_ms))
        return reject(error, "taskPeriodMs", u.task_period_ms, allowed_period_text());
    if (!range_ok(u.programs_per_task, st_profile_generated::kMaxProgramsPerTask,
                  "programsPerTask", error))
        return false;
    if (!range_ok(u.programs_total, st_profile_generated::kMaxProgramsTotal,
                  "programsTotal", error))
        return false;

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
