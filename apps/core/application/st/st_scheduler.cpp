#include "st/st_scheduler.hpp"

#include <algorithm>
#include <new>
#include <utility>

#include <ctime>

#include "st/st_diagnostic.hpp"

namespace core {

uint64_t default_monotonic_wall_clock_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

void StScheduler::log_trace(StTraceEventKind kind, uint64_t now_ns, bool ok, const char* task_id,
                            const char* instance_id, const char* code)
{
    if (!trace_) return;
    StRuntimeTraceEvent event;
    event.kind = kind;
    event.timestamp_ns = now_ns;
    event.ok = ok;
    event.task_id = task_id;
    event.instance_id = instance_id;
    event.code = code;
    trace_->push(event);
}

const char* st_program_state_name(StProgramState s)
{
    switch (s) {
    case StProgramState::EMPTY:       return "EMPTY";
    case StProgramState::STAGED:      return "STAGED";
    case StProgramState::VALIDATED:   return "VALIDATED";
    case StProgramState::READY:       return "READY";
    case StProgramState::ACTIVE:      return "ACTIVE";
    case StProgramState::RUNNING:     return "RUNNING";
    case StProgramState::STOPPED:     return "STOPPED";
    case StProgramState::DISABLED:    return "DISABLED";
    case StProgramState::FAULTED:     return "FAULTED";
    case StProgramState::ROLLED_BACK: return "ROLLED_BACK";
    case StProgramState::REJECTED:    return "REJECTED";
    }
    return "?";
}

const char* st_scheduler_profile_name(StSchedulerProfile profile)
{
    switch (profile) {
    case StSchedulerProfile::SUPPORTING_AS_BUILT: return "supporting-as-built";
    case StSchedulerProfile::REV_A: return st_profile_generated::kProfileId;
    }
    return "?";
}

/* ---- StTask ---- */

void StTask::set_enabled(bool e)
{
    if (cfg_.enabled == e) return;
    cfg_.enabled = e;
    if (!e) {
        /* Reset bộ đếm overrun khi disable: mang số đếm cũ sang lần chạy sau
         * sẽ khiến task vừa bật lại đã bị coi là hỏng. */
        monitor_.reset();
        started_ = false;
    }
}

bool StTask::due(uint64_t now_ns) const
{
    if (!cfg_.enabled) return false;
    if (!started_) return true;   /* lần đầu: chạy ngay tick đầu tiên */
    const uint64_t period_ns = static_cast<uint64_t>(cfg_.period_ms) * 1000000ull;
    return now_ns >= last_run_ns_ + period_ns;
}

void StTask::mark_ran(uint64_t now_ns)
{
    const uint64_t period_ns = static_cast<uint64_t>(cfg_.period_ms) * 1000000ull;
    if (!started_) {
        started_ = true;
        last_run_ns_ = now_ns;
        return;
    }
    /* Bù trôi: cộng theo mốc LÝ THUYẾT, không theo thời điểm chạy thật, để
     * task 100 ms chạy đúng 10 lần mỗi giây kể cả khi có tick bị trễ. */
    const uint64_t releases_due = (now_ns - last_run_ns_) / period_ns;
    if (releases_due > 1) {
        const uint64_t missed = releases_due - 1;
        const uint64_t room = UINT32_MAX - stats_.missed_release_count;
        stats_.missed_release_count += static_cast<uint32_t>(std::min(missed, room));
    }
    last_run_ns_ += period_ns;
    /* Nhưng nếu đã lỡ nhiều chu kỳ thì BỎ, không chạy bù (SPEC §4): chạy bù
     * làm timer nhảy và làm tình trạng quá tải nặng thêm. */
    if (last_run_ns_ + period_ns <= now_ns) last_run_ns_ = now_ns;
}

/* ---- StScheduler: cấu hình ---- */

bool StScheduler::add_task(const StTaskConfig& cfg, std::string* error)
{
    auto fail = [&](const std::string& m) { if (error) *error = m; return false; };

    const std::size_t max_tasks = profile_ == StSchedulerProfile::REV_A
                                      ? st_profile_generated::kMaxTasks
                                      : st_sched_limits::kMaxTasks;
    if (tasks_.size() >= max_tasks)
        return fail("too many tasks for profile '" +
                    std::string(st_scheduler_profile_name(profile_)) + "' (limit " +
                    std::to_string(max_tasks) + ")");
    if (cfg.id.empty() || cfg.id.size() > 16) return fail("task id must be 1..16 characters");
    if (cfg.priority > 7) return fail("task priority must be 0..7");
    if (profile_ == StSchedulerProfile::REV_A) {
        if (!st_limits::RevAAllowsPeriod(cfg.period_ms))
            return fail("task period_ms is not allowed by profile '" +
                        std::string(st_profile_generated::kProfileId) + "'");
        /* OD-PROG-012: budget phải NHỎ HƠN 20%, không phải <=20%.
         * Nhân trên uint64 để tránh overflow nếu input đối kháng. */
        if (cfg.budget_ms == 0 ||
            static_cast<uint64_t>(cfg.budget_ms) * 100ull >=
                static_cast<uint64_t>(cfg.period_ms) *
                    st_base_step::kMaxTaskBudgetPercent)
            return fail("task budget_ms must be >0 and <20% of period_ms for Rev A");
    } else {
        if (cfg.period_ms < st_sched_limits::kMinPeriodMs ||
            cfg.period_ms > st_sched_limits::kMaxPeriodMs)
            return fail("task period_ms out of range");
        /* Chu kỳ supporting phải là bội số tick vật lý cũ. Đây không phải
         * base step sản phẩm Rev A. */
        if (cfg.period_ms % st_sched_limits::kBaseTickMs != 0)
            return fail("task period_ms must be a multiple of base tick " +
                        std::to_string(st_sched_limits::kBaseTickMs) + " ms");
        if (cfg.budget_ms == 0 || cfg.budget_ms > cfg.period_ms)
            return fail("task budget_ms must be in 1..period_ms");
    }
    if (cfg.overrun_threshold < 1 || cfg.overrun_threshold > 100)
        return fail("overrun_threshold must be 1..100");

    for (const auto& t : tasks_) {
        if (t->config().id == cfg.id) return fail("duplicate task id '" + cfg.id + "'");
        if (t->config().priority == cfg.priority)
            return fail("duplicate task priority " + std::to_string(cfg.priority));
    }

    tasks_.push_back(std::make_unique<StTask>(cfg));
    /* Giữ bảng task sắp theo ưu tiên TĂNG DẦN (0 = cao nhất) ngay khi thêm,
     * để tick() không phải sắp lại mỗi lần chạy. */
    std::sort(tasks_.begin(), tasks_.end(),
              [](const std::unique_ptr<StTask>& a, const std::unique_ptr<StTask>& b) {
                  return a->config().priority < b->config().priority;
              });
    return true;
}

bool StScheduler::add_program(const std::string& task_id, const std::string& instance_id,
                              uint16_t order, std::string* error)
{
    auto fail = [&](const std::string& m) { if (error) *error = m; return false; };

    StTask* task = find_task(task_id);
    if (!task) return fail("unknown task '" + task_id + "'");
    const std::size_t max_per_task = profile_ == StSchedulerProfile::REV_A
                                         ? st_profile_generated::kMaxProgramsPerTask
                                         : st_sched_limits::kMaxProgramsPerTask;
    if (task->programs().size() >= max_per_task)
        return fail("too many programs in task '" + task_id + "'");
    if (instance_id.empty() || instance_id.size() > 64)
        return fail("instance id must be 1..64 characters");
    if (find_program(instance_id)) return fail("duplicate instance id '" + instance_id + "'");

    std::size_t total = 0;
    for (const auto& t : tasks_) total += t->programs().size();
    const std::size_t max_total = profile_ == StSchedulerProfile::REV_A
                                      ? st_profile_generated::kMaxProgramsTotal
                                      : st_sched_limits::kMaxProgramsTotal;
    if (total >= max_total)
        return fail("too many program instances in resource");

    for (const auto& p : task->programs())
        if (p->order == order)
            return fail("duplicate order " + std::to_string(order) + " in task '" + task_id + "'");

    auto inst = std::make_unique<StProgramInstance>();
    inst->instance_id = instance_id;
    inst->order = order;
    if (retain_service_) {
        inst->retain_mailbox = retain_service_->register_instance(instance_id);
        if (!inst->retain_mailbox)
            return fail("cannot register RETAIN identity for instance '" + instance_id + "'");
    }
    task->programs().push_back(std::move(inst));
    std::sort(task->programs().begin(), task->programs().end(),
              [](const std::unique_ptr<StProgramInstance>& a,
                 const std::unique_ptr<StProgramInstance>& b) { return a->order < b->order; });
    return true;
}

StTask* StScheduler::find_task(const std::string& id)
{
    for (auto& t : tasks_)
        if (t->config().id == id) return t.get();
    return nullptr;
}

StProgramInstance* StScheduler::find_program(const std::string& instance_id)
{
    for (auto& t : tasks_)
        for (auto& p : t->programs())
            if (p->instance_id == instance_id) return p.get();
    return nullptr;
}

/* ---- Vòng đời ---- */

bool StScheduler::request_activation(const std::string& instance_id,
                                     const std::vector<uint8_t>& artifact, std::string* error,
                                     bool is_rollback)
{
    if (!stage_activation(instance_id, artifact, error, is_rollback)) return false;
    return commit_staged_activation(instance_id, false, error);
}

bool StScheduler::stage_activation(const std::string& instance_id,
                                   const std::vector<uint8_t>& artifact, std::string* error,
                                   bool is_rollback)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance '" + instance_id + "'"; return false; }
    if (p->has_pending) {
        if (error) *error = "an activation is already pending for '" + instance_id + "'";
        return false;
    }

    /* Guard "candidate hiện tại chưa qua clean tick" tồn tại để không xếp
     * chồng một candidate CHƯA được xác nhận lên trên một candidate khác
     * cũng chưa được xác nhận (forward path). Nhưng rollback tồn tại CHÍNH
     * XÁC để thoát khỏi trạng thái "candidate kẹt, chưa clean tick" đó — áp
     * guard này cho cả rollback biến nó thành deadlock: candidate lỗi chặn
     * cả stage mới LẪN đường an toàn duy nhất để thoát khỏi chính nó, buộc
     * phải restart Core thủ công (phát hiện thật, board Foxlinx 2026-08-17,
     * commission AHU_MasterSequence — activated_artifact còn nguyên vì
     * output-commit chu kỳ đầu fail, on_output_commit() gọi rollback() nhưng
     * rollback() tự gọi lại đúng hàm này nên cũng bị chính guard trên chặn). */
    if (!is_rollback && !p->activated_artifact.empty()) {
        if (error) *error = "current package has not completed a clean tick";
        return false;
    }

    /* Toàn bộ loader + heap nằm ở command/non-RT path. Ảnh active cũ và bytes
     * LKG bị giữ lại ở vùng retired trong scan, rồi mới được thu hồi ở đây. */
    p->runtime.reclaim_retired();
    std::vector<uint8_t>().swap(p->retired_artifact);

    StPreparedProgramHandle prepared;
    StLoadError load_error;
    if (!p->runtime.prepare(artifact.data(), artifact.size(), &prepared, &load_error,
                            &loader_opts_)) {
        if (error) *error = "artifact rejected: " + load_error.code + " " + load_error.message;
        if (!p->runtime.loaded()) p->state = StProgramState::REJECTED;
        return false;
    }

    StRetainResult retain_result;
    if (prepared->program.has_retain()) {
        if (retain_service_ && p->retain_mailbox) {
            retain_result = retain_service_->restore(instance_id, &prepared->program,
                                                      wall_clock_());
        } else {
            retain_result.state = StRetainRestoreState::COLD_INIT_MISSING;
            retain_result.message = "RETAIN service is not configured; cold initialization";
        }
    }

    try {
        std::vector<uint8_t> bytes(artifact);
        p->pending_artifact.swap(bytes);
    } catch (const std::bad_alloc&) {
        if (error) *error = "artifact staging allocation failed";
        return false;
    }
    p->pending_program = std::move(prepared);
    p->pending_retain_restore_state = retain_result.state;
    p->pending_retain_reject_code = retain_result.reject_code;
    p->pending_retain_generation = retain_result.generation;
    p->pending_changed_state = !p->runtime.loaded();
    if (p->pending_changed_state) p->state_before_stage = p->state;
    p->pending_commit_requested.store(false, std::memory_order_relaxed);
    p->pending_is_rollback = false;
    if (p->pending_changed_state) p->state = StProgramState::STAGED;
    p->has_pending.store(true, std::memory_order_release);
    return true;
}

bool StScheduler::commit_staged_activation(const std::string& instance_id, bool rollback,
                                           std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance '" + instance_id + "'"; return false; }
    if (!p->has_pending || p->pending_commit_requested) {
        if (error) *error = "no staged activation available for '" + instance_id + "'";
        return false;
    }
    p->pending_is_rollback = rollback;
    p->pending_commit_requested.store(true, std::memory_order_release);
    return true;
}

bool StScheduler::abort_staged_activation(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance '" + instance_id + "'"; return false; }
    if (!p->has_pending || p->pending_commit_requested) {
        if (error) *error = "staged activation cannot be aborted";
        return false;
    }
    p->pending_program.reset();
    p->pending_artifact.clear();
    p->pending_is_rollback = false;
    p->pending_retain_restore_state = StRetainRestoreState::NOT_APPLICABLE;
    p->pending_retain_reject_code = nullptr;
    p->pending_retain_generation = 0;
    if (p->pending_changed_state) p->state = p->state_before_stage;
    p->pending_changed_state = false;
    p->pending_commit_requested.store(false, std::memory_order_relaxed);
    p->has_pending.store(false, std::memory_order_release);
    return true;
}

bool StScheduler::start(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    if (p->state != StProgramState::ACTIVE && p->state != StProgramState::STOPPED &&
        p->state != StProgramState::ROLLED_BACK) {
        if (error) *error = std::string("cannot start from state ") +
                            st_program_state_name(p->state);
        return false;
    }
    p->state = StProgramState::RUNNING;
    p->enabled = true;
    return true;
}

bool StScheduler::stop(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    if (p->state != StProgramState::RUNNING) {
        if (error) *error = std::string("cannot stop from state ") +
                            st_program_state_name(p->state);
        return false;
    }
    /* `stop` KHÔNG đưa đầu ra về safe-state (SPEC §7.3): đó là hành động vận
     * hành có chủ ý của người có quyền. Gộp hai ý nghĩa sẽ làm người vận hành
     * không biết mình đang yêu cầu điều gì. "Không ai điều khiển" được xử lý ở
     * tầng Resource qua trigger no_controller. */
    p->state = StProgramState::STOPPED;
    return true;
}

bool StScheduler::enable(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    if (p->state != StProgramState::DISABLED) {
        if (error) *error = "instance is not disabled";
        return false;
    }
    p->enabled = true;
    p->state = StProgramState::STOPPED;
    return true;
}

bool StScheduler::disable(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    p->enabled = false;
    p->state = StProgramState::DISABLED;
    return true;
}

bool StScheduler::reset_fault(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    if (p->state != StProgramState::FAULTED) {
        if (error) *error = "instance is not faulted";
        return false;
    }
    p->last_fault_code = nullptr;
    p->state = StProgramState::STOPPED;
    return true;
}

bool StScheduler::request_retain_reset(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance '" + instance_id + "'"; return false; }
    if (!p->runtime.loaded()) {
        if (error) *error = "no program loaded on '" + instance_id + "' — nothing retained to reset";
        return false;
    }
    if (p->pending_retain_reset.load(std::memory_order_acquire)) {
        if (error) *error = "a RETAIN reset is already pending for '" + instance_id + "'";
        return false;
    }
    p->pending_retain_reset.store(true, std::memory_order_release);
    return true;
}

bool StScheduler::rollback(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    if (p->last_known_good.empty()) {
        if (error) *error = "no last-known-good package to roll back to";
        return false;
    }
    /* Candidate chưa qua output commit còn nằm ở activated_artifact. Tạm lấy
     * nó ra để đường loader có thể prepare LKG; nếu prepare lỗi thì trả lại
     * nguyên trạng candidate. Candidate hỏng được huỷ ở command/non-RT path,
     * không mang qua safe boundary và không thể chiếm nhầm mốc LKG. */
    std::vector<uint8_t> failed_candidate;
    failed_candidate.swap(p->activated_artifact);
    if (!request_activation(instance_id, p->last_known_good, error)) {
        p->activated_artifact.swap(failed_candidate);
        return false;
    }
    p->pending_is_rollback = true;
    p->last_fault_code = nullptr;
    return true;
}

/* ---- Tick ---- */

void StScheduler::apply_pending_activations(StTask& task)
{
    for (auto& p : task.programs()) {
        if (!p->has_pending.load(std::memory_order_acquire) ||
            !p->pending_commit_requested.load(std::memory_order_acquire)) continue;
        const bool had_previous = p->runtime.loaded();
        const bool ok = p->runtime.activate_prepared(std::move(p->pending_program));
        if (ok) {
            p->state = p->pending_is_rollback ? StProgramState::ROLLED_BACK
                                              : StProgramState::ACTIVE;
            p->process_input_count = 0;
            p->input_snapshot_generation = 0;
            p->input_snapshot_valid = true;
            p->last_successful_base_step = 0;
            p->output_commit_generation = 0;
            p->outputs_withdrawn = false;
            p->retain_restore_state = p->pending_retain_restore_state;
            p->retain_reject_code = p->pending_retain_reject_code;
            p->retain_generation = p->pending_retain_generation;
            p->last_successful_now_ns = 0;
            /* Giữ lại bytes để promote thành last-known-good SAU KHI chạy được
             * >= 1 tick không fault — package chưa chạy lần nào không đủ tư
             * cách làm mốc rollback. */
            p->retired_artifact.swap(p->activated_artifact);
            p->activated_artifact.swap(p->pending_artifact);
        } else {
            /* Thất bại GIỮ NGUYÊN package đang chạy — không có mã lỗi nào dẫn
             * tới trạng thái "không có chương trình nào chạy" nếu trước đó đã
             * có (TYPED_IR_ARTIFACT_SPEC §8). */
            p->state = had_previous ? StProgramState::RUNNING : StProgramState::REJECTED;
        }
        {
            const uint64_t event_ns = wall_clock_();
            log_trace(StTraceEventKind::ACTIVATION_RESULT, event_ns, ok,
                     task.config().id.c_str(), p->instance_id.c_str(), ok ? nullptr : "rejected");
            if (!ok && had_previous)
                log_trace(StTraceEventKind::ROLLBACK, event_ns, true, task.config().id.c_str(),
                         p->instance_id.c_str(), nullptr);
        }
        /* Tiêu thụ request dù thành hay bại: không retry ngầm ở tick sau với
         * cùng artifact lỗi. */
        p->pending_is_rollback = false;
        p->pending_changed_state = false;
        p->pending_retain_restore_state = StRetainRestoreState::NOT_APPLICABLE;
        p->pending_retain_reject_code = nullptr;
        p->pending_retain_generation = 0;
        p->pending_commit_requested.store(false, std::memory_order_relaxed);
        /* Publish slot rỗng SAU mọi cleanup; worker thấy false bằng acquire
         * thì scan không còn được phép chạm pending fields của request cũ. */
        p->has_pending.store(false, std::memory_order_release);
    }
}

void StScheduler::apply_pending_activations_at_boundary()
{
    for (auto& task : tasks_) apply_pending_activations(*task);
}

/* WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001 §1/§3). Đặt lại slot/FB
 * state retained NGAY tại boundary — publish snapshot kế tiếp
 * (`publish_committed_retain_snapshots()`, gọi từ `st_process_image.cpp`
 * sau cycle) tự nhiên phản ánh giá trị đã reset vì mailbox chỉ đọc lại
 * `program.slots`/`fb_states` hiện tại, không có "giá trị cũ" nào để ghi
 * đè lên — đúng nguyên tắc "reset ở slots trước, worker chỉ đọc state hiện
 * tại" đã ghi trong design §1. Không cấp phát, không throw. */
void StScheduler::apply_pending_retain_resets(StTask& task)
{
    for (auto& p : task.programs()) {
        if (!p->pending_retain_reset.load(std::memory_order_acquire)) continue;
        p->runtime.reset_retained_state();
        p->pending_retain_reset.store(false, std::memory_order_relaxed);
        /* release: non-RT polling generation này phải thấy đúng slots đã
         * ghi ở dòng trên trước khi thấy generation tăng. */
        p->retain_reset_ack_generation.fetch_add(1, std::memory_order_release);
    }
}

void StScheduler::apply_pending_retain_resets_at_boundary()
{
    for (auto& task : tasks_) apply_pending_retain_resets(*task);
}

void StScheduler::run_task(StTask& task, uint64_t now_ns, StSchedulerTickResult* out)
{
    /* task_start là đồng hồ RIÊNG cho WCET (SPEC §5) — KHÁC now_ns (mốc
     * logic chung của tick, dùng cho FB/deadline). Đọc chung một mốc ở đây
     * luôn cho exec_ns=0, không bao giờ phát hiện được overrun dù Task chạy
     * chậm tới đâu; đây là lỗi đã có trước TASK-PROG-304, không phải hành vi
     * định trước. */
    const uint64_t task_start = wall_clock_();
    uint32_t ran = 0;
    task.last_dispatch_base_step_ = base_step_count_;
    task.last_dispatch_succeeded_ = true;

    for (auto& p : task.programs()) {
        if (!p->enabled) continue;
        /* CHỈ RUNNING mới được thực thi. ACTIVE nghĩa là "đã là package hiện
         * hành" chứ chưa phải "đang được chạy mỗi chu kỳ" — chuyển sang RUNNING
         * là việc của lệnh `start`. Gộp hai trạng thái sẽ làm `start` trở nên
         * vô nghĩa và người vận hành mất quyền quyết định khi nào chương trình
         * bắt đầu tác động lên đầu ra (SPEC §7.1, §7.3). */
        if (p->state != StProgramState::RUNNING) continue;
        if (!p->runtime.loaded()) continue;

        bool has_input_binding = false;
        for (const StIrIoBinding& binding : p->runtime.program()->io_bindings) {
            if (!binding.is_output) {
                has_input_binding = true;
                break;
            }
        }
        if (has_input_binding &&
            (p->input_snapshot_generation != base_step_count_ ||
             !p->input_snapshot_valid)) {
            p->fault_count++;
            p->last_fault_code = st_diag_code::kRtNonFiniteInput;
            p->last_fault_pc = 0;
            p->last_fault_line = 0;
            p->state = StProgramState::FAULTED;
            p->last_successful_base_step = 0;
            task.last_dispatch_succeeded_ = false;
            out->faults++;
            log_trace(StTraceEventKind::RUNTIME_FAULT, now_ns, false, task.config().id.c_str(),
                     p->instance_id.c_str(), p->last_fault_code);
            /* Required input không GOOD/mapped/coercible làm hủy cả cycle.
             * Không execute bằng slot cũ vì như vậy stale/bad sẽ bị trình bày
             * như dữ liệu live và output mới vẫn có thể được publish. */
            break;
        }

        const StExecResult r = p->runtime.execute(static_cast<int64_t>(now_ns));
        p->run_count++;
        if (!r.ok) {
            p->fault_count++;
            p->last_fault_code = r.fault_code;
            p->last_fault_pc = r.fault_pc;
            p->last_fault_line = r.fault_line;
            p->state = StProgramState::FAULTED;
            p->last_successful_base_step = 0;
            task.last_dispatch_succeeded_ = false;
            out->faults++;
            log_trace(StTraceEventKind::RUNTIME_FAULT, now_ns, false, task.config().id.c_str(),
                     p->instance_id.c_str(), p->last_fault_code);
            /* Fault của MỘT Program dừng cả Task: các Program trong một Task
             * thường phối hợp (Program 0 tính setpoint, Program 1 dùng nó), nên
             * chạy tiếp sẽ đẩy đầu ra vào tổ hợp chưa từng được thiết kế
             * (SPEC §5). Staging của từng Program đã được StProgramRuntime huỷ. */
            break;
        }
        p->last_successful_base_step = base_step_count_;
        p->last_successful_now_ns = now_ns;
        ran++;
    }

    const uint64_t exec_ns = wall_clock_() - task_start;
    task.stats_.run_count++;
    task.stats_.last_exec_ns = exec_ns;
    if (exec_ns > task.stats_.max_exec_ns) task.stats_.max_exec_ns = exec_ns;
    task.monitor_.record(exec_ns, static_cast<uint64_t>(task.config().budget_ms) * 1000000ull);

    /* OD-PROG-012 / DDD-CTRL-PROG-001 §9: 3 overrun liên tiếp làm ĐÚNG Task
     * đó FAULT, không phải lỗi riêng một Program và KHÔNG plant-wide safe —
     * bất biến đó thuộc cấu trúc (StScheduler không có tham chiếu tới
     * SafetyManager/SafeState để phá được dù có muốn). PROGRAM_TASK_
     * SCHEDULER_SPEC §6.1 cũ gắn overrun vào SafetyManager đã bị supersede
     * bởi DDD-CTRL-PROG-001, xem thông báo đầu file đó. */
    if (task.monitor_.should_force_safe()) {
        log_trace(StTraceEventKind::OVERRUN, wall_clock_(), false, task.config().id.c_str(),
                 nullptr, st_diag_code::kRtTaskOverrun);
        for (auto& p : task.programs()) {
            if (p->state != StProgramState::RUNNING) continue;
            p->fault_count++;
            p->last_fault_code = st_diag_code::kRtTaskOverrun;
            p->last_fault_pc = 0;
            p->last_fault_line = 0;
            p->state = StProgramState::FAULTED;
            p->last_successful_base_step = 0;
            out->faults++;
        }
        task.last_dispatch_succeeded_ = false;
    }

    out->programs_run += ran;
    out->tasks_run++;
}

StSchedulerTickResult StScheduler::on_base_step(uint64_t now_ns)
{
    StSchedulerTickResult result;
    result.base_step_sequence = ++base_step_count_;

    /* tasks_ đã sắp theo ưu tiên tăng dần từ lúc add_task. Non-preemptive:
     * task ưu tiên cao chạy TRỌN VẸN rồi mới tới task kế. */
    /* Bước 3 của tick (SPEC §4): áp MỌI activation đang chờ, cho MỌI task —
     * không chỉ task đến hạn. Nếu chỉ áp cho task đến hạn thì activation của
     * một task chu kỳ dài phải đợi trọn một chu kỳ mới có hiệu lực, trong khi
     * BE đã báo "đã activate". Áp ở đây cũng bảo đảm không bao giờ swap package
     * giữa lúc execute() đang chạy. */
    apply_pending_activations_at_boundary();

    for (auto& t : tasks_) {
        if (!t->enabled()) { t->stats_.skip_count++; continue; }
        if (!t->due(now_ns)) continue;
        run_task(*t, now_ns, &result);
        t->mark_ran(now_ns);
    }

    result.any_force_safe = any_force_safe();
    return result;
}

bool StScheduler::any_force_safe() const
{
    for (const auto& t : tasks_)
        if (t->enabled() && t->monitor().should_force_safe()) return true;
    return false;
}

void StScheduler::set_retain_service(StRetainService* service)
{
    retain_service_ = service;
    for (auto& task : tasks_)
        for (auto& program : task->programs())
            program->retain_mailbox = service
                ? service->register_instance(program->instance_id)
                : nullptr;
}

void StScheduler::publish_committed_retain_snapshots() noexcept
{
    if (!retain_service_) return;
    for (auto& task : tasks_) {
        for (auto& program : task->programs()) {
            if (!program->retain_mailbox || !program->runtime.loaded() ||
                program->last_successful_base_step != base_step_count_ ||
                program->output_commit_generation != base_step_count_)
                continue;
            const StLoadedProgram* loaded = program->runtime.program();
            if (loaded && loaded->has_retain())
                (void)st_publish_retain_snapshot(program->retain_mailbox, *loaded,
                                                 program->last_successful_now_ns);
        }
    }
}

void StScheduler::promote_output_committed_artifacts() noexcept
{
    for (auto& task : tasks_) {
        for (auto& program : task->programs()) {
            if (program->activated_artifact.empty() ||
                program->last_successful_base_step != base_step_count_ ||
                program->output_commit_generation != base_step_count_)
                continue;
            program->retired_artifact.swap(program->last_known_good);
            program->last_known_good.swap(program->activated_artifact);
        }
    }
}

} // namespace core
