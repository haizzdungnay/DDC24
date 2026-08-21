#include "st/st_value_trace.hpp"

#include <cstring>

#include "st/st_scheduler.hpp"

namespace core {

const char* st_trace_state_name(StTraceState state)
{
    switch (state) {
    case StTraceState::IDLE: return "IDLE";
    case StTraceState::RUNNING: return "RUNNING";
    case StTraceState::COMPLETED: return "COMPLETED";
    case StTraceState::STOPPED: return "STOPPED";
    }
    return "?";
}

std::size_t StValueTrace::capacity() const
{
    if (variable_count_ == 0) return 0;
    return kMaxTraceCells / variable_count_;
}

bool StValueTrace::start(const std::string& session_id, const StScheduler& scheduler,
                         const StTraceVariable* variables, std::size_t variable_count,
                         uint32_t sample_period_ms, uint32_t duration_ms, uint64_t now_ns,
                         std::string* error)
{
    auto fail = [&](const char* message) {
        if (error) *error = message;
        return false;
    };
    if (state_ == StTraceState::RUNNING) {
        /* Một phiên tại một thời điểm. Nhận phiên thứ hai sẽ hoặc âm thầm huỷ
         * phiên đang chạy của người khác, hoặc nhân ngân sách RAM lên — cả hai
         * đều là quyết định không nên nằm ở đây. */
        return fail("đã có phiên trace đang chạy");
    }
    if (session_id.empty() || session_id.size() > 64) return fail("session id không hợp lệ");
    if (variables == nullptr || variable_count == 0 || variable_count > kMaxTraceVariables)
        return fail("số biến ngoài dải 1..32");
    if (sample_period_ms < kMinTraceSamplePeriodMs || sample_period_ms > kMaxTraceSamplePeriodMs)
        return fail("chu kỳ lấy mẫu ngoài dải");
    if (duration_ms == 0 || duration_ms > kMaxTraceDurationMs)
        return fail("thời lượng ngoài dải 1..600000 ms");

    reset();
    session_id_ = session_id;
    for (std::size_t index = 0; index < variable_count; ++index) {
        StTraceVariable resolved = variables[index];
        resolved.resolved = false;
        resolved.slot = 0;
        const StProgramInstance* instance =
            const_cast<StScheduler&>(scheduler).find_program(resolved.instance_id);
        if (instance != nullptr && instance->runtime.loaded()) {
            const StLoadedProgram* program = instance->runtime.program();
            if (program != nullptr) {
                for (const StIrVariable& variable : program->variables) {
                    if (variable.name != resolved.variable_name) continue;
                    resolved.slot = variable.slot;
                    resolved.resolved = true;
                    break;
                }
            }
        }
        variables_[index] = std::move(resolved);
    }
    variable_count_ = variable_count;
    sample_period_ms_ = sample_period_ms;
    started_at_ns_ = now_ns;
    ends_at_ns_ = now_ns + static_cast<uint64_t>(duration_ms) * 1000000ull;
    /* Mẫu ĐẦU TIÊN lấy ngay tại boundary kế tiếp, không chờ hết một chu kỳ:
     * người chẩn đoán cần thấy trạng thái lúc bấm nút, không phải trạng thái một
     * chu kỳ sau đó. */
    next_sample_ns_ = now_ns;
    state_ = StTraceState::RUNNING;
    return true;
}

bool StValueTrace::stop(const std::string& session_id, std::string* error)
{
    if (state_ != StTraceState::RUNNING) {
        if (error) *error = "không có phiên trace đang chạy";
        return false;
    }
    if (session_id != session_id_) {
        /* Dừng nhầm phiên của người khác là mất dữ liệu chẩn đoán của họ, và
         * mất một cách im lặng. */
        if (error) *error = "session id không khớp phiên đang chạy";
        return false;
    }
    state_ = StTraceState::STOPPED;
    return true;
}

void StValueTrace::on_boundary(const StScheduler& scheduler, uint64_t now_ns)
{
    if (state_ != StTraceState::RUNNING) return;
    if (now_ns >= ends_at_ns_) {
        state_ = StTraceState::COMPLETED;
        return;
    }
    if (now_ns < next_sample_ns_) return;
    /* Bù trôi theo mốc LÝ THUYẾT, cùng lý do với `st_program_due`: bám thời điểm
     * thật sẽ làm chu kỳ lấy mẫu trôi dần và trục thời gian của đồ thị sai. */
    const uint64_t period_ns = static_cast<uint64_t>(sample_period_ms_) * 1000000ull;
    do {
        next_sample_ns_ += period_ns;
    } while (next_sample_ns_ <= now_ns);

    const std::size_t slots = capacity();
    if (slots == 0) {
        state_ = StTraceState::COMPLETED;
        return;
    }
    std::size_t write_index = 0;
    if (sample_count_ < slots) {
        write_index = (head_ + sample_count_) % slots;
        ++sample_count_;
    } else {
        /* Hết chỗ: ghi đè mẫu cũ nhất và ĐẾM. Bounded nghĩa là có thể rơi, và
         * giấu con số đó sẽ làm người đọc đồ thị tưởng mình thấy toàn bộ. */
        write_index = head_;
        head_ = (head_ + 1) % slots;
        ++dropped_;
    }
    timestamps_[write_index] = now_ns;
    const std::size_t base = write_index * variable_count_;
    for (std::size_t index = 0; index < variable_count_; ++index) {
        const StTraceVariable& variable = variables_[index];
        cells_[base + index] = StCell{};
        valid_[base + index] = 0u;
        if (!variable.resolved) continue;
        const StProgramInstance* instance =
            const_cast<StScheduler&>(scheduler).find_program(variable.instance_id);
        if (instance == nullptr || !instance->runtime.loaded()) continue;
        const StLoadedProgram* program = instance->runtime.program();
        if (program == nullptr || variable.slot >= program->slots.size()) continue;
        cells_[base + index] = program->slots[variable.slot];
        valid_[base + index] = 1u;
    }
}

StTraceSample StValueTrace::sample(std::size_t index) const
{
    StTraceSample out;
    const std::size_t slots = capacity();
    if (slots == 0 || index >= sample_count_) return out;
    const std::size_t ring_index = (head_ + index) % slots;
    out.timestamp_ns = timestamps_[ring_index];
    const std::size_t base = ring_index * variable_count_;
    for (std::size_t variable = 0; variable < variable_count_; ++variable) {
        out.values[variable] = cells_[base + variable];
        out.valid[variable] = valid_[base + variable] != 0u;
    }
    return out;
}

StTraceStatus StValueTrace::status() const
{
    StTraceStatus out;
    out.state = state_;
    out.session_id = session_id_;
    out.variable_count = static_cast<uint32_t>(variable_count_);
    out.sample_count = static_cast<uint32_t>(sample_count_);
    out.dropped_count = dropped_;
    out.started_at_ns = started_at_ns_;
    return out;
}

void StValueTrace::reset()
{
    session_id_.clear();
    state_ = StTraceState::IDLE;
    variable_count_ = 0;
    head_ = 0;
    sample_count_ = 0;
    dropped_ = 0;
    sample_period_ms_ = 0;
    started_at_ns_ = 0;
    ends_at_ns_ = 0;
    next_sample_ns_ = 0;
}

} // namespace core
