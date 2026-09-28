#include "st/st_value_trace.hpp"

#include <cstring>
#include <thread>

#include "st/st_process_image.hpp"
#include "st/st_scheduler.hpp"

namespace core {

void StValueTrace::SpinGuard::lock() const noexcept
{
    /* Chỉ luồng KHÔNG RT gọi. Luồng quét giữ khoá tối đa một lần lấy mẫu
     * (≤ 32 ô), nên quay vài vòng rồi nhường CPU là đủ. */
    while (!try_lock()) std::this_thread::yield();
}

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

uint32_t st_trace_effective_sample_period_ms(uint32_t requested_ms, uint64_t base_step_ns)
{
    const uint64_t step_ms = (base_step_ns + 999999ull) / 1000000ull;
    if (step_ms > requested_ms) return step_ms > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(step_ms);
    return requested_ms;
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
    /* Kiểm tham số TRƯỚC khi lấy khoá: không giữ khoá lâu hơn cần thiết. */
    if (session_id.empty() || session_id.size() > 64) return fail("session id không hợp lệ");
    if (variables == nullptr || variable_count == 0 || variable_count > kMaxTraceVariables)
        return fail("số biến ngoài dải 1..32");
    if (sample_period_ms < kMinTraceSamplePeriodMs || sample_period_ms > kMaxTraceSamplePeriodMs)
        return fail("chu kỳ lấy mẫu ngoài dải");
    if (duration_ms == 0 || duration_ms > kMaxTraceDurationMs)
        return fail("thời lượng ngoài dải 1..600000 ms");
    const uint32_t effective_period_ms =
        st_trace_effective_sample_period_ms(sample_period_ms, scheduler.base_step_ns());

    guard_.lock();
    if (state_ == StTraceState::RUNNING) {
        /* Một phiên tại một thời điểm. Nhận phiên thứ hai sẽ hoặc âm thầm huỷ
         * phiên đang chạy của người khác, hoặc nhân ngân sách RAM lên — cả hai
         * đều là quyết định không nên nằm ở đây. */
        guard_.unlock();
        return fail("đã có phiên trace đang chạy");
    }

    reset_locked();
    session_id_ = session_id;
    for (std::size_t index = 0; index < variable_count; ++index) {
        StTraceVariable pending = variables[index];
        pending.resolved = false;
        pending.slot = 0;
        variables_[index] = std::move(pending);
    }
    variable_count_ = variable_count;
    /* Phân giải ở boundary kế trên luồng quét — chỉ luồng đó được đọc Program
     * đang chạy (activation cũng đổi nó tại boundary). */
    resolve_pending_ = true;
    requested_sample_period_ms_ = sample_period_ms;
    sample_period_ms_ = effective_period_ms;
    started_at_ns_ = now_ns;
    ends_at_ns_ = now_ns + static_cast<uint64_t>(duration_ms) * 1000000ull;
    /* Mẫu ĐẦU TIÊN lấy ngay tại boundary kế tiếp, không chờ hết một chu kỳ:
     * người chẩn đoán cần thấy trạng thái lúc bấm nút, không phải trạng thái một
     * chu kỳ sau đó. */
    next_sample_ns_ = now_ns;
    state_ = StTraceState::RUNNING;
    guard_.unlock();
    return true;
}

bool StValueTrace::stop(const std::string& session_id, std::string* error)
{
    guard_.lock();
    if (state_ != StTraceState::RUNNING) {
        guard_.unlock();
        if (error) *error = "không có phiên trace đang chạy";
        return false;
    }
    if (session_id != session_id_) {
        guard_.unlock();
        /* Dừng nhầm phiên của người khác là mất dữ liệu chẩn đoán của họ, và
         * mất một cách im lặng. */
        if (error) *error = "session id không khớp phiên đang chạy";
        return false;
    }
    state_ = StTraceState::STOPPED;
    guard_.unlock();
    return true;
}

void StValueTrace::resolve_locked(const StScheduler& scheduler)
{
    for (std::size_t index = 0; index < variable_count_; ++index) {
        StTraceVariable& variable = variables_[index];
        variable.resolved = false;
        variable.slot = 0;
        variable.output_binding = -1;
        const StProgramInstance* instance =
            const_cast<StScheduler&>(scheduler).find_program(variable.instance_id);
        if (instance == nullptr || !instance->runtime.loaded()) continue;
        const StLoadedProgram* program = instance->runtime.program();
        if (program == nullptr) continue;
        for (const StIrVariable& declared : program->variables) {
            if (declared.name != variable.variable_name) continue;
            variable.slot = declared.slot;
            variable.resolved = true;
            break;
        }
        if (!variable.resolved) continue;
        for (std::size_t binding = 0; binding < program->io_bindings.size(); ++binding) {
            if (!program->io_bindings[binding].is_output ||
                program->io_bindings[binding].slot != variable.slot)
                continue;
            variable.output_binding = static_cast<int16_t>(binding);
            break;
        }
    }
    resolve_pending_ = false;
}

void StValueTrace::on_boundary(const StScheduler& scheduler, uint64_t now_ns,
                               const PointTable* table)
{
    if (!guard_.try_lock()) {
        /* Luồng IPC đang giữ trace (start/stop/đọc). KHÔNG chờ: bỏ lượt, mẫu
         * tới hạn sẽ lấy ở boundary kế với mốc thời gian thật của boundary đó. */
        contended_boundaries_.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    sample_locked(scheduler, now_ns, table);
    guard_.unlock();
}

namespace {

/* Program có đang ở trạng thái được dispatch (sẽ còn release) không. */
bool releases(const StProgramInstance& instance)
{
    return instance.runtime.loaded() && (instance.state == StProgramState::RUNNING ||
                                         instance.state == StProgramState::WAITING);
}

} // namespace

void StValueTrace::sample_locked(const StScheduler& scheduler, uint64_t now_ns,
                                 const PointTable* table)
{
    if (state_ != StTraceState::RUNNING) return;
    if (resolve_pending_) resolve_locked(scheduler);
    if (now_ns >= ends_at_ns_) {
        state_ = StTraceState::COMPLETED;
        return;
    }
    if (now_ns < next_sample_ns_) return;

    /* Issue #798 — lấy mẫu TẠI RELEASE. Ở boundary mà Program không chạy, slot
     * của nó mang đầu vào vừa nạp cho lần chạy SAU cạnh đầu ra của lần chạy
     * TRƯỚC; hoãn mẫu tới boundary có Program được theo dõi vừa chạy thì mọi cặp
     * (vào, ra) trong mẫu đến từ đúng một lần chạy. Không Program nào còn được
     * dispatch (FAULTED, STOPPED, không phân giải được) thì lấy mẫu ngay — chờ
     * một release không bao giờ đến là để phiên đứng im không dấu vết. */
    const uint64_t base_step = scheduler.base_step_count();
    bool any_released = false;
    bool any_live = false;
    for (std::size_t index = 0; index < variable_count_; ++index) {
        const StTraceVariable& variable = variables_[index];
        if (!variable.resolved) continue;
        const StProgramInstance* instance =
            const_cast<StScheduler&>(scheduler).find_program(variable.instance_id);
        if (instance == nullptr || !releases(*instance)) continue;
        any_live = true;
        if (instance->last_release_base_step == base_step && instance->run_count > 0) {
            any_released = true;
            break;
        }
    }
    if (!any_released && any_live && now_ns - next_sample_ns_ < kMaxTraceReleaseDeferNs) return;
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
    ++total_written_;
    const std::size_t base = write_index * variable_count_;
    for (std::size_t index = 0; index < variable_count_; ++index) {
        const StTraceVariable& variable = variables_[index];
        const std::size_t cell = base + index;
        cells_[cell] = StCell{};
        valid_[cell] = static_cast<uint8_t>(StTraceCellReason::UNRESOLVED);
        release_seq_[cell] = 0;
        readback_[cell] = StCell{};
        readback_age_ms_[cell] = 0;
        if (!variable.resolved) continue;
        const StProgramInstance* instance =
            const_cast<StScheduler&>(scheduler).find_program(variable.instance_id);
        if (instance == nullptr || !instance->runtime.loaded()) continue;
        const StLoadedProgram* program = instance->runtime.program();
        if (program == nullptr || variable.slot >= program->slots.size()) continue;
        release_seq_[cell] = instance->run_count;
        StTraceReadback readback = StTraceReadback::NONE;
        if (variable.output_binding >= 0 &&
            static_cast<std::size_t>(variable.output_binding) < program->io_bindings.size()) {
            readback = StTraceReadback::UNAVAILABLE;
            if (table != nullptr &&
                st_output_readback(program->io_bindings[static_cast<std::size_t>(variable.output_binding)],
                                   *table, now_ns, &readback_[cell], &readback_age_ms_[cell]))
                readback = StTraceReadback::VALID;
        }
        const bool released =
            instance->last_release_base_step == base_step && instance->run_count > 0;
        const StTraceCellReason reason =
            released ? StTraceCellReason::OK : StTraceCellReason::NOT_RELEASED;
        if (released) cells_[cell] = program->slots[variable.slot];
        valid_[cell] = static_cast<uint8_t>(static_cast<uint8_t>(reason) |
                                            (static_cast<uint8_t>(readback) << 2));
    }
}

StTraceSample StValueTrace::sample_locked_at(std::size_t index) const
{
    StTraceSample out;
    const std::size_t slots = capacity();
    if (slots == 0 || index >= sample_count_) return out;
    const std::size_t ring_index = (head_ + index) % slots;
    out.timestamp_ns = timestamps_[ring_index];
    const std::size_t base = ring_index * variable_count_;
    for (std::size_t variable = 0; variable < variable_count_; ++variable) {
        const std::size_t cell = base + variable;
        out.values[variable] = cells_[cell];
        out.reason[variable] = static_cast<StTraceCellReason>(valid_[cell] & 0x3u);
        out.valid[variable] = out.reason[variable] == StTraceCellReason::OK;
        out.release_seq[variable] = release_seq_[cell];
        out.readback_state[variable] = static_cast<StTraceReadback>((valid_[cell] >> 2) & 0x3u);
        out.readback[variable] = readback_[cell];
        out.readback_age_ms[variable] = readback_age_ms_[cell];
    }
    return out;
}

StTraceStatus StValueTrace::status_locked() const
{
    StTraceStatus out;
    out.state = state_;
    out.session_id = session_id_;
    out.variable_count = static_cast<uint32_t>(variable_count_);
    out.sample_count = static_cast<uint32_t>(sample_count_);
    out.dropped_count = dropped_;
    out.started_at_ns = started_at_ns_;
    out.requested_sample_period_ms = requested_sample_period_ms_;
    out.effective_sample_period_ms = sample_period_ms_;
    out.contended_boundary_count = contended_boundaries_.load(std::memory_order_relaxed);
    return out;
}

StTraceStatus StValueTrace::status() const
{
    guard_.lock();
    StTraceStatus out = status_locked();
    guard_.unlock();
    return out;
}

std::size_t StValueTrace::sample_count() const
{
    guard_.lock();
    const std::size_t count = sample_count_;
    guard_.unlock();
    return count;
}

StTraceSample StValueTrace::sample(std::size_t index) const
{
    guard_.lock();
    StTraceSample out = sample_locked_at(index);
    guard_.unlock();
    return out;
}

StTraceVariable StValueTrace::variable(std::size_t index) const
{
    guard_.lock();
    StTraceVariable out = index < variables_.size() ? variables_[index] : StTraceVariable{};
    guard_.unlock();
    return out;
}

std::size_t StValueTrace::variable_count() const
{
    guard_.lock();
    const std::size_t count = variable_count_;
    guard_.unlock();
    return count;
}

uint32_t StValueTrace::dropped_count() const
{
    guard_.lock();
    const uint32_t dropped = dropped_;
    guard_.unlock();
    return dropped;
}

uint64_t StValueTrace::next_sequence() const
{
    guard_.lock();
    const uint64_t next = total_written_ + 1;
    guard_.unlock();
    return next;
}

uint64_t StValueTrace::first_sequence() const
{
    guard_.lock();
    const uint64_t first = total_written_ + 1 - sample_count_;
    guard_.unlock();
    return first;
}

StValueTrace::ConsistentRead::ConsistentRead(const StValueTrace& trace) : trace_(trace)
{
    trace_.guard_.lock();
}

StValueTrace::ConsistentRead::~ConsistentRead()
{
    trace_.guard_.unlock();
}

StTraceStatus StValueTrace::ConsistentRead::status() const { return trace_.status_locked(); }
std::size_t StValueTrace::ConsistentRead::sample_count() const { return trace_.sample_count_; }
StTraceSample StValueTrace::ConsistentRead::sample(std::size_t index) const
{
    return trace_.sample_locked_at(index);
}
std::size_t StValueTrace::ConsistentRead::variable_count() const { return trace_.variable_count_; }
uint64_t StValueTrace::ConsistentRead::next_sequence() const { return trace_.total_written_ + 1; }
uint64_t StValueTrace::ConsistentRead::first_sequence() const
{
    return trace_.total_written_ + 1 - trace_.sample_count_;
}

void StValueTrace::reset()
{
    guard_.lock();
    reset_locked();
    guard_.unlock();
}

void StValueTrace::reset_locked()
{
    session_id_.clear();
    state_ = StTraceState::IDLE;
    variable_count_ = 0;
    head_ = 0;
    sample_count_ = 0;
    dropped_ = 0;
    total_written_ = 0;
    sample_period_ms_ = 0;
    requested_sample_period_ms_ = 0;
    started_at_ns_ = 0;
    ends_at_ns_ = 0;
    next_sample_ns_ = 0;
    resolve_pending_ = false;
    contended_boundaries_.store(0, std::memory_order_relaxed);
}

} // namespace core
