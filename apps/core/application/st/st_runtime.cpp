#include "st/st_runtime.hpp"

#include <cmath>
#include <cstring>

namespace core {

bool StProgramRuntime::activate(const uint8_t* artifact, std::size_t size, StLoadError* err,
                                const StLoaderOptions* opts)
{
    StLoaderOptions defaults;
    auto candidate = std::make_unique<StLoadedProgram>();
    if (!load_st_artifact(artifact, size, opts ? *opts : defaults, candidate.get(), err)) {
        activation_fail_count_++;
        return false;   /* active_ giữ nguyên — last-known-good tiếp tục chạy */
    }

    /* Cấp phát bộ đệm ảnh chụp NGAY TẠI ĐÂY, không phải trong execute().
     * Đây là điểm cấp phát cuối cùng của vòng đời chương trình. */
    shadow_slots_.assign(candidate->slots.size(), StCell{});
    shadow_fb_.assign(candidate->fb_states.size(), StFbState{});

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
    std::memcpy(shadow_slots_.data(), active_->slots.data(),
                active_->slots.size() * sizeof(StCell));
    if (!shadow_fb_.empty())
        std::memcpy(shadow_fb_.data(), active_->fb_states.data(),
                    active_->fb_states.size() * sizeof(StFbState));

    StExecFault fault;
    if (!execute_st_program(active_.get(), now_ns, &fault)) {
        /* Khôi phục nguyên vẹn: một chu kỳ lỗi KHÔNG để lại trạng thái nửa
         * vời, kể cả biến cục bộ và trạng thái timer. */
        std::memcpy(active_->slots.data(), shadow_slots_.data(),
                    active_->slots.size() * sizeof(StCell));
        if (!shadow_fb_.empty())
            std::memcpy(active_->fb_states.data(), shadow_fb_.data(),
                        active_->fb_states.size() * sizeof(StFbState));
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
    for (const StIrVariable& var : active_->variables) {
        if (var.name != name) continue;
        if (var.type != v.type) return false;
        StCell& c = active_->slots[var.slot];
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
    for (const StIrVariable& var : active_->variables) {
        if (var.name != name) continue;
        const StCell& c = active_->slots[var.slot];
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
