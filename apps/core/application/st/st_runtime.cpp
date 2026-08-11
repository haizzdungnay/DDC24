#include "st/st_runtime.hpp"

#include <cmath>
#include <cstring>
#include <new>

namespace core {

bool StProgramRuntime::activate(const uint8_t* artifact, std::size_t size, StLoadError* err,
                                const StLoaderOptions* opts)
{
    reclaim_retired();
    StPreparedProgramHandle candidate;
    if (!prepare(artifact, size, &candidate, err, opts)) return false;
    return activate_prepared(std::move(candidate));
}

bool StProgramRuntime::prepare(const uint8_t* artifact, std::size_t size,
                               StPreparedProgramHandle* out, StLoadError* err,
                               const StLoaderOptions* opts)
{
    if (!out) {
        if (err) {
            err->code = st_ir_error::kBadHeader;
            err->message = "null prepared output";
        }
        activation_fail_count_++;
        return false;
    }

    try {
        StLoaderOptions defaults;
        auto candidate = std::make_unique<StPreparedProgram>();
        if (!load_st_artifact(artifact, size, opts ? *opts : defaults,
                              &candidate->program, err)) {
            activation_fail_count_++;
            return false;
        }
        candidate->shadow_slots.assign(candidate->program.slots.size(), StCell{});
        candidate->shadow_fb.assign(candidate->program.fb_states.size(), StFbState{});
        *out = std::move(candidate);
        return true;
    } catch (const std::bad_alloc&) {
        if (err) {
            err->code = st_ir_error::kOutOfMemory;
            err->message = "runtime image allocation failed";
        }
        activation_fail_count_++;
        return false;
    }
}

bool StProgramRuntime::activate_prepared(StPreparedProgramHandle candidate) noexcept
{
    if (!candidate || retired_) {
        activation_fail_count_++;
        return false;
    }
    retired_ = std::move(active_);
    active_ = std::move(candidate);
    activation_count_++;
    return true;
}

StExecResult StProgramRuntime::execute(int64_t now_ns)
{
    StExecResult r;
    if (!active_) {
        r.error = "no_active_program";
        fault_count_++;
        return r;
    }

    /* Chụp trạng thái đầu chu kỳ. memcpy trên bộ đệm đã cấp — không cấp phát. */
    StLoadedProgram& program = active_->program;
    std::memcpy(active_->shadow_slots.data(), program.slots.data(),
                program.slots.size() * sizeof(StCell));
    if (!active_->shadow_fb.empty())
        std::memcpy(active_->shadow_fb.data(), program.fb_states.data(),
                    program.fb_states.size() * sizeof(StFbState));

    StExecFault fault;
    if (!execute_st_program(&program, now_ns, &fault)) {
        /* Khôi phục nguyên vẹn: một chu kỳ lỗi KHÔNG để lại trạng thái nửa
         * vời, kể cả biến cục bộ và trạng thái timer. */
        std::memcpy(program.slots.data(), active_->shadow_slots.data(),
                    program.slots.size() * sizeof(StCell));
        if (!active_->shadow_fb.empty())
            std::memcpy(program.fb_states.data(), active_->shadow_fb.data(),
                        program.fb_states.size() * sizeof(StFbState));
        fault_count_++;
        cycle_count_++;
        r.fault_code = fault.code;
        r.fault_pc = fault.pc;
        r.fault_line = fault.line;
        r.fault_column = fault.column;
        r.error = fault.code ? fault.code : "runtime_fault";
        return r;
    }

    cycle_count_++;
    r.ok = true;
    return r;
}

bool StProgramRuntime::set_variable(const std::string& name, const StValue& v)
{
    if (!active_) return false;
    if (st_type_is_integer(v.type) &&
        (v.i < st_integer_min(v.type) || v.i > st_integer_max(v.type)))
        return false;
    if (v.type == StType::REAL && !std::isfinite(v.r)) return false;
    if (v.type == StType::TIME && v.t < 0) return false;
    for (const StIrVariable& var : active_->program.variables) {
        if (var.name != name) continue;
        if (var.type != v.type) return false;
        StCell& c = active_->program.slots[var.slot];
        switch (v.type) {
        case StType::BOOL: c.b = v.b; break;
        case StType::DINT:
        case StType::INT:  c.i = v.i; break;
        case StType::UINT: c.i = v.i; break;
        case StType::REAL: c.r = v.r; break;
        case StType::TIME: c.t = v.t; break;
        }
        return true;
    }
    return false;
}

bool StProgramRuntime::get_variable(const std::string& name, StValue* out) const
{
    if (!active_ || !out) return false;
    for (const StIrVariable& var : active_->program.variables) {
        if (var.name != name) continue;
        const StCell& c = active_->program.slots[var.slot];
        switch (var.type) {
        case StType::BOOL: *out = StValue::make_bool(c.b); break;
        case StType::DINT: *out = StValue::make_dint(c.i); break;
        case StType::INT:  *out = StValue::make_int(c.i); break;
        case StType::UINT: *out = StValue::make_uint(static_cast<uint16_t>(c.i)); break;
        case StType::REAL: *out = StValue::make_real(c.r); break;
        case StType::TIME: *out = StValue::make_time(c.t); break;
        }
        return true;
    }
    return false;
}

} // namespace core
