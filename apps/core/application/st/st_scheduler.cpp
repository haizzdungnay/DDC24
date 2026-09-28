#include "st/st_scheduler.hpp"

#include <algorithm>
#include <cstdio>
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
    case StProgramState::WAITING:     return "WAITING";
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

uint64_t StTask::release_tolerance_ns() const
{
    const uint64_t period_ns = static_cast<uint64_t>(cfg_.period_ms) * 1000000ull;
    const uint64_t tick_ns = base_step_ns_ != 0 && base_step_ns_ < period_ns ? base_step_ns_ : period_ns;
    return st_release_tolerance_ns(tick_ns);
}

bool StTask::due(uint64_t now_ns) const
{
    if (!cfg_.enabled) return false;
    if (!started_) return true;   /* lần đầu: chạy ngay tick đầu tiên */
    const uint64_t period_ns = static_cast<uint64_t>(cfg_.period_ms) * 1000000ull;
    /* F01: Task bật lại (ví dụ sau Restore) neo `last_run_ns_` vào một tick có
     * jitter; so chặt thì tick sau có jitter nhỏ hơn bị bỏ trọn một chu kỳ. */
    return now_ns + release_tolerance_ns() >= last_run_ns_ + period_ns;
}

uint64_t st_release_tolerance_ns(uint64_t tick_period_ns)
{
    return tick_period_ns / 2u;
}

void st_program_reset_release(StProgramInstance* program)
{
    program->release_started = false;
    program->next_release_ns = 0;
    program->consecutive_missed_release = 0;
}

/* T59-402 — release theo Program. `period_ms == 0` nghĩa là "theo chu kỳ Task":
 * giữ nguyên hành vi cho mọi cấu hình chưa khai chu kỳ riêng. */
bool st_program_due(const StProgramInstance& program, uint32_t task_period_ms, uint64_t now_ns)
{
    if (program.period_ms == 0) return true; /* Task đã quyết định thời điểm. */
    if (!program.release_started) return true;
    /* F01 (EV-PROG-FBD-ST-MB-20260925): Program chỉ được xét tại tick của Task,
     * nên dung sai là nửa chu kỳ Task. So chặt từng làm hai Program 1 s trên
     * base 1 s mất 16,7–22,2% release trên bo Foxlinx. */
    const uint64_t tolerance_ns =
        st_release_tolerance_ns(static_cast<uint64_t>(task_period_ms) * 1000000ull);
    return now_ns + tolerance_ns >= program.next_release_ns;
}

void st_program_mark_released(StProgramInstance* program, uint64_t now_ns, uint64_t tolerance_ns)
{
    if (program->period_ms == 0) return;
    const uint64_t period_ns = static_cast<uint64_t>(program->period_ms) * 1000000ull;
    if (!program->release_started) {
        program->release_started = true;
        program->next_release_ns = now_ns + period_ns;
        program->consecutive_missed_release = 0;
        return;
    }
    /* Bù trôi theo mốc LÝ THUYẾT. Bám thời điểm chạy thật sẽ làm một tick trễ
     * đẩy mọi deadline sau đó trôi theo, và Program 1 s không còn chạy đúng
     * một lần mỗi giây. Tick tới SỚM hơn mốc trong biên dung sai (jitter nhỏ
     * hơn tick neo) là release ĐÚNG HẠN, không phải "gọi trước hạn". */
    if (now_ns + tolerance_ns >= program->next_release_ns) {
        const uint64_t late = now_ns + tolerance_ns - program->next_release_ns;
        const uint64_t missed = late / period_ns;
        if (missed > 0) {
            const uint64_t room = UINT32_MAX - program->missed_release_count;
            program->missed_release_count +=
                static_cast<uint32_t>(std::min(missed, room));
            /* T60-002 — cùng sự kiện, hai bộ đếm khác họ: `missed_release_count`
             * trả lời "từ đầu tới giờ lỡ bao nhiêu", còn bộ đếm liên tiếp trả
             * lời "ngay lúc này có đang lỡ nhịp không". Công thức `health` của
             * Plan 60 §4.2 chỉ được đọc cái thứ hai. */
            const uint64_t consecutive_room =
                UINT32_MAX - program->consecutive_missed_release;
            program->consecutive_missed_release +=
                static_cast<uint32_t>(std::min(missed, consecutive_room));
        } else {
            /* Release đúng hạn (trễ chưa tới trọn một chu kỳ = jitter, đúng
             * cùng ngưỡng mà `missed_release_count` đang dùng) ⇒ chuỗi lỡ nhịp
             * kết thúc tại đây. */
            program->consecutive_missed_release = 0;
        }
        program->next_release_ns += period_ns * (missed + 1);
        /* Lỡ quá nhiều thì BỎ, không chạy bù: chạy bù làm timer nhảy và làm
         * tình trạng quá tải nặng thêm (SPEC §4). */
        if (program->next_release_ns <= now_ns) program->next_release_ns = now_ns + period_ns;
    } else {
        /* Gọi trước hạn (không xảy ra qua `st_program_due`, nhưng hàm này là
         * API công khai): sớm hơn hạn thì chắc chắn không lỡ nhịp. */
        program->consecutive_missed_release = 0;
    }
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
    const uint64_t releases_due = (now_ns + release_tolerance_ns() - last_run_ns_) / period_ns;
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

void StScheduler::set_base_step_ns(uint64_t ns)
{
    base_step_ns_ = ns;
    for (auto& task : tasks_) task->set_base_step_ns(ns);
}

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
        /* Task là cấu hình MỚI: chỉ tập của profile hiện hành, không nhận chu kỳ
         * legacy (legacy chỉ dành cho đường nạp gói đã Commission). */
        if (!st_limits::RevAAllowsPeriod(cfg.period_ms))
            return fail(std::string(st_diag_code::kSchedulePeriodNotAllowed) +
                        " task period_ms " + std::to_string(cfg.period_ms) +
                        " is not allowed by profile '" +
                        std::string(st_profile_generated::kProfileId) + "'");
        /* OD-PROG-012: budget phải NHỎ HƠN 20%, không phải <=20% — giữ nguyên
         * luật, chỉ đổi đơn vị sang µs (ADR-061 4.3). Ở đơn vị ms, Task 10 ms chỉ
         * khai được 1 ms (2 ms = đúng 20% bị từ chối); ở µs trần là 2000 µs loại
         * trừ, Task `main` khai 1999 µs như 199 ms của Task 1000 ms cũ.
         * Nhân trên uint64 để tránh overflow nếu input đối kháng. */
        if (cfg.budget_us == 0 ||
            static_cast<uint64_t>(cfg.budget_us) * 100ull >=
                static_cast<uint64_t>(cfg.period_ms) * 1000ull *
                    st_base_step::kMaxTaskBudgetPercent)
            return fail("task budget_us must be >0 and <20% of period for Rev A");
    } else {
        if (cfg.period_ms < st_sched_limits::kMinPeriodMs ||
            cfg.period_ms > st_sched_limits::kMaxPeriodMs)
            return fail("task period_ms out of range");
        /* Chu kỳ supporting phải là bội số tick vật lý cũ. Đây không phải
         * base step sản phẩm Rev A. */
        if (cfg.period_ms % st_sched_limits::kBaseTickMs != 0)
            return fail("task period_ms must be a multiple of base tick " +
                        std::to_string(st_sched_limits::kBaseTickMs) + " ms");
        if (cfg.budget_us == 0 ||
            static_cast<uint64_t>(cfg.budget_us) > static_cast<uint64_t>(cfg.period_ms) * 1000ull)
            return fail("task budget_us must be in 1..period");
    }
    if (cfg.overrun_threshold < 1 || cfg.overrun_threshold > 100)
        return fail("overrun_threshold must be 1..100");

    for (const auto& t : tasks_) {
        if (t->config().id == cfg.id) return fail("duplicate task id '" + cfg.id + "'");
        if (t->config().priority == cfg.priority)
            return fail("duplicate task priority " + std::to_string(cfg.priority));
    }

    tasks_.push_back(std::make_unique<StTask>(cfg));
    tasks_.back()->set_base_step_ns(base_step_ns_);
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
    /* `order` vẫn phải DUY NHẤT trong Task (giữ nguyên bất biến có sẵn): nó là
     * thứ quyết định thứ tự chạy, và cho phép trùng sẽ biến thứ tự thành thứ
     * cần tie-break — tức là thành thứ có thể đổi khi ai đó sửa tie-break.
     *
     * Sắp theo `order`, rồi theo `instance_id` khi trùng. Không bám thứ tự
     * THÊM VÀO: hai controller nạp cùng một package theo thứ tự khác nhau phải
     * chạy Program theo cùng một dãy, nếu không kết quả không tái lập được. */
    std::sort(task->programs().begin(), task->programs().end(),
              [](const std::unique_ptr<StProgramInstance>& a,
                 const std::unique_ptr<StProgramInstance>& b) {
                  if (a->order != b->order) return a->order < b->order;
                  return a->instance_id < b->instance_id;
              });
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
    return stage_activation(p, artifact, error, is_rollback);
}

bool StScheduler::stage_activation(StProgramInstance* p,
                                   const std::vector<uint8_t>& artifact, std::string* error,
                                   bool is_rollback)
{
    if (!p) { if (error) *error = "null program instance"; return false; }
    if (p->has_pending) {
        if (error) *error = "an activation is already pending for '" + p->instance_id + "'";
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
            retain_result = retain_service_->restore(p->instance_id, &prepared->program,
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

bool StScheduler::prepare_program_set(const std::string& task_id,
                                      const std::vector<StProgramSetEntry>& entries,
                                      StPreparedProgramSet* prepared, std::string* error)
{
    auto fail = [&](const std::string& message) {
        if (error) *error = message;
        return false;
    };
    if (prepared == nullptr) return fail("null prepared program set");
    StTask* task = find_task(task_id);
    if (task == nullptr) return fail("unknown task '" + task_id + "'");
    if (entries.empty()) return fail("package has no program instance");

    const std::size_t max_per_task = profile_ == StSchedulerProfile::REV_A
                                         ? st_profile_generated::kMaxProgramsPerTask
                                         : st_sched_limits::kMaxProgramsPerTask;
    const std::size_t max_total = profile_ == StSchedulerProfile::REV_A
                                      ? st_profile_generated::kMaxProgramsTotal
                                      : st_sched_limits::kMaxProgramsTotal;
    if (entries.size() > max_per_task)
        return fail("too many program instances in prepared package");
    std::size_t other_task_programs = 0;
    for (const auto& other : tasks_)
        if (other.get() != task) other_task_programs += other->programs().size();
    if (entries.size() + other_task_programs > max_total)
        return fail("too many program instances in resource");

    std::size_t enabled_count = 0;
    for (std::size_t index = 0; index < entries.size(); ++index) {
        const StProgramSetEntry& entry = entries[index];
        if (entry.instance_id.empty() || entry.instance_id.size() > 64)
            return fail("instance id must be 1..64 characters");
        /* Đường NẠP (stage gói mới lẫn khôi phục Active/LKG sau reboot đều đi
         * qua đây): nhận tập mới ∪ legacy 30000 ms. Từ chối legacy ở đây là làm
         * bộ điều khiển đang chạy gói cũ mất chương trình ngay lúc nâng cấp. */
        if (profile_ == StSchedulerProfile::REV_A && entry.period_ms != 0 &&
            !st_limits::RevALoaderAllowsPeriod(entry.period_ms))
            return fail(std::string(st_diag_code::kSchedulePeriodNotAllowed) +
                        " program period_ms " + std::to_string(entry.period_ms) +
                        " is not allowed by Rev A profile");
        for (std::size_t prior = 0; prior < index; ++prior) {
            if (entries[prior].instance_id == entry.instance_id)
                return fail("duplicate instance id '" + entry.instance_id + "'");
            if (entries[prior].order == entry.order)
                return fail("duplicate order " + std::to_string(entry.order) +
                            " in task '" + task_id + "'");
        }
        if (entry.enabled) ++enabled_count;
    }
    const std::size_t max_enabled = profile_ == StSchedulerProfile::REV_A
                                        ? st_profile_generated::kMaxProgramsEnabled
                                        : st_sched_limits::kMaxProgramsTotal;
    if (enabled_count > max_enabled)
        return fail("too many enabled programs in prepared package");

    StPreparedProgramSet shadow;
    try {
        shadow.reserve(entries.size());
        for (const StProgramSetEntry& entry : entries) {
            auto program = std::make_unique<StProgramInstance>();
            program->instance_id = entry.instance_id;
            program->order = entry.order;
            program->period_ms = entry.period_ms;
            program->enabled = entry.enabled;
            if (retain_service_) {
                program->retain_mailbox = retain_service_->register_instance(entry.instance_id);
                if (!program->retain_mailbox)
                    return fail("cannot register RETAIN identity for instance '" +
                                entry.instance_id + "'");
            }
            if (!stage_activation(program.get(), entry.artifact, error, false)) return false;
            shadow.push_back(std::move(program));
        }
    } catch (const std::bad_alloc&) {
        return fail("program set staging allocation failed");
    }
    prepared->swap(shadow);
    return true;
}

bool StScheduler::arm_prepared_program_set(StPreparedProgramSet* prepared, bool rollback,
                                           std::string* error)
{
    if (prepared == nullptr || prepared->empty()) {
        if (error) *error = "prepared program set is empty";
        return false;
    }
    std::size_t enabled_count = 0;
    for (const auto& program : *prepared) {
        if (!program || !program->has_pending.load(std::memory_order_acquire) ||
            program->pending_commit_requested.load(std::memory_order_acquire) ||
            !program->pending_program) {
            if (error) *error = "prepared program set is incomplete";
            return false;
        }
        if (program->enabled) ++enabled_count;
    }
    const std::size_t max_enabled = profile_ == StSchedulerProfile::REV_A
                                        ? st_profile_generated::kMaxProgramsEnabled
                                        : st_sched_limits::kMaxProgramsTotal;
    if (enabled_count > max_enabled) {
        if (error) *error = "too many enabled programs in prepared package";
        return false;
    }
    /* Chỉ ghi sau khi MỌI phần tử đã qua preflight: không có prefix armed. */
    for (auto& program : *prepared) {
        program->pending_is_rollback = rollback;
        program->pending_commit_requested.store(true, std::memory_order_release);
    }
    return true;
}

bool StScheduler::swap_prepared_program_set_at_boundary(
    const std::string& task_id, StPreparedProgramSet* prepared) noexcept
{
    StTask* task = find_task(task_id);
    if (task == nullptr || prepared == nullptr || prepared->empty()) return false;
    for (const auto& program : *prepared) {
        if (!program || !program->has_pending.load(std::memory_order_acquire) ||
            !program->pending_commit_requested.load(std::memory_order_acquire) ||
            !program->pending_program || program->runtime.has_retired())
            return false;
    }

    /* Mọi mutation dưới đây chỉ chạm topology shadow. Nếu một handle bất ngờ bị
     * từ chối, topology live vẫn chưa swap và caller có thể discard cả shadow. */
    for (auto& program : *prepared) {
        if (!program->runtime.activate_prepared(std::move(program->pending_program))) return false;
        program->process_input_count = 0;
        program->input_snapshot_generation = 0;
        program->input_snapshot_valid = true;
        program->last_successful_base_step = 0;
        program->output_commit_generation = 0;
        program->output_commit_now_ns = 0;
        /* Program Disabled không có output cycle để chờ; nó đã qua loader và
         * không thể publish, nên đủ điều kiện package barrier ngay. */
        program->committed_since_activation = !program->enabled;
        program->outputs_withdrawn = false;
        program->retain_restore_state = program->pending_retain_restore_state;
        program->retain_reject_code = program->pending_retain_reject_code;
        program->retain_generation = program->pending_retain_generation;
        program->last_successful_now_ns = 0;
        /* T60-002: gói mới chưa chạy lần nào, nên không được thừa kế mốc chạy
         * lẫn chuỗi lỡ nhịp của gói cũ — cả hai đều mô tả một artifact khác. */
        program->last_run_mono_ns = 0;
        program->consecutive_missed_release = 0;
        program->activated_artifact.swap(program->pending_artifact);
        program->state = program->enabled ? StProgramState::RUNNING
                                          : StProgramState::DISABLED;
        program->pending_is_rollback = false;
        program->pending_changed_state = false;
        program->pending_retain_restore_state = StRetainRestoreState::NOT_APPLICABLE;
        program->pending_retain_reject_code = nullptr;
        program->pending_retain_generation = 0;
        program->pending_commit_requested.store(false, std::memory_order_relaxed);
        program->has_pending.store(false, std::memory_order_release);
        /* ADR-061 — gói đã Commission với chu kỳ của profile cũ vẫn CHẠY (mất
         * chương trình lúc nâng cấp là lỗi an toàn), nhưng phải NÓI RA ở mỗi lần
         * activate: chu kỳ legacy chạy im lặng thì không ai biết gói cần được
         * Commission lại theo tập mới. Một dòng mỗi Program mỗi lần activate,
         * không phải mỗi tick, và chuỗi định dạng không cấp phát. */
        if (profile_ == StSchedulerProfile::REV_A && st_limits::RevAIsLegacyPeriod(program->period_ms))
            std::fprintf(stderr,
                         "WARN  programming.legacy_period instance=%s period_ms=%u"
                         " (ngoai tap chu ky ADR-061; chay tuong thich, can Commission lai)\n",
                         program->instance_id.c_str(), program->period_ms);
    }
    task->programs().swap(*prepared);
    return true;
}

bool StScheduler::restore_program_set_at_boundary(
    const std::string& task_id, StPreparedProgramSet* previous) noexcept
{
    StTask* task = find_task(task_id);
    if (task == nullptr || previous == nullptr) return false;
    task->programs().swap(*previous);
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
    /* T59-402 — trần 16 Program chạy đồng thời (DDD §0/§4.1). Trần này phải ép
     * ở đây, nơi một Program thực sự BẮT ĐẦU tác động lên đầu ra; ép ở lớp cấu
     * hình chỉ chặn được ý định, không chặn được trạng thái. Program đã RUNNING
     * không tính lại vì `start` trên nó là no-op idempotent. */
    if (p->state != StProgramState::RUNNING && p->state != StProgramState::WAITING) {
        const std::size_t max_enabled = max_enabled_programs();
        if (running_program_count() >= max_enabled) {
            if (error)
                *error = "too many running programs (limit " + std::to_string(max_enabled) + ")";
            return false;
        }
    }
    if (p->state != StProgramState::RUNNING && p->state != StProgramState::WAITING)
        st_program_reset_release(p);
    p->state = StProgramState::RUNNING;
    p->enabled = true;
    return true;
}

bool StScheduler::stop(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    if (p->state != StProgramState::RUNNING && p->state != StProgramState::WAITING) {
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

std::size_t StScheduler::running_program_count() const noexcept
{
    std::size_t running = 0;
    for (const auto& task : tasks_)
        for (const auto& program : task->programs())
            if (program->state == StProgramState::RUNNING ||
                program->state == StProgramState::WAITING) ++running;
    return running;
}

std::size_t StScheduler::max_enabled_programs() const noexcept
{
    return profile_ == StSchedulerProfile::REV_A ? st_profile_generated::kMaxProgramsEnabled
                                                 : st_sched_limits::kMaxProgramsTotal;
}

StScheduler::StEnableRequestOutcome StScheduler::request_program_enabled(
    const std::string& instance_id, bool enabled, StProgramInstance** instance,
    uint64_t* ack_baseline, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) {
        /* Không tự tạo instance: bật một Program không có trong package đang
         * chạy nghĩa là người gọi và thiết bị đang nói về hai gói khác nhau. */
        if (error) *error = "instance '" + instance_id + "' not in active package";
        return StEnableRequestOutcome::UNKNOWN_INSTANCE;
    }
    /* Đọc mốc ack TRƯỚC khi arm. Đọc sau sẽ có cửa sổ mà boundary đã áp dụng
     * xong ngay giữa hai lệnh và caller chờ mãi một lần tăng không bao giờ tới. */
    const uint64_t baseline = p->enable_ack_generation.load(std::memory_order_acquire);
    uint8_t expected = static_cast<uint8_t>(StEnableRequest::NONE);
    const uint8_t desired = static_cast<uint8_t>(enabled ? StEnableRequest::ENABLE
                                                         : StEnableRequest::DISABLE);
    if (!p->pending_enable_request.compare_exchange_strong(
            expected, desired, std::memory_order_acq_rel, std::memory_order_acquire)) {
        /* Một yêu cầu khác đang chờ boundary. Ghi đè nó sẽ làm lệnh trước biến
         * mất trong im lặng — người vận hành thấy "OK" cho một lệnh chưa từng
         * được áp dụng. */
        if (error)
            *error = "an enable/disable request is already pending for '" + instance_id + "'";
        return StEnableRequestOutcome::ALREADY_PENDING;
    }
    if (instance) *instance = p;
    if (ack_baseline) *ack_baseline = baseline;
    return StEnableRequestOutcome::ARMED;
}

void StScheduler::apply_pending_enable_requests(StTask& task) noexcept
{
    for (auto& p : task.programs()) {
        const uint8_t request = p->pending_enable_request.load(std::memory_order_acquire);
        if (request == static_cast<uint8_t>(StEnableRequest::NONE)) continue;

        StEnableAckResult result = StEnableAckResult::APPLIED;
        const StProgramState state_at_request = p->state;
        if (request == static_cast<uint8_t>(StEnableRequest::ENABLE)) {
            if (p->state == StProgramState::RUNNING || p->state == StProgramState::WAITING) {
                /* Idempotent: lệnh Enable lặp lại trên Program đang chạy là
                 * câu trả lời "đúng rồi", không phải lỗi. */
                p->enabled = true;
            } else if (p->state != StProgramState::DISABLED &&
                       p->state != StProgramState::ACTIVE &&
                       p->state != StProgramState::STOPPED &&
                       p->state != StProgramState::ROLLED_BACK) {
                /* FAULTED chưa reset, EMPTY, REJECTED... — từ chối là câu trả
                 * lời đúng cho người vận hành, không phải lỗi cần che. */
                result = StEnableAckResult::REJECTED_STATE;
            } else if (running_program_count() >= max_enabled_programs()) {
                /* T59-402 — trần Program chạy đồng thời của profile. Kiểm TRƯỚC
                 * khi chạm bất kỳ trường nào: bản trước enable xong mới thấy vượt
                 * trần và để lại Program ở STOPPED/`enabled=true`, tức một lệnh
                 * bị từ chối vẫn kịp đổi trạng thái nửa vời. */
                result = StEnableAckResult::REJECTED_LIMIT;
            } else {
                /* DISABLED -> RUNNING đi thẳng: bước STOPPED trung gian của
                 * đường cũ không quan sát được từ ngoài boundary, và tách hai
                 * bước ra mới là thứ tạo ra trạng thái nửa vời khi bước sau hỏng. */
                st_program_reset_release(p.get());
                p->enabled = true;
                p->state = StProgramState::RUNNING;
            }
        } else {
            /* Disable phải KẾT THÚC ở DISABLED, không chỉ STOPPED: dừng mà vẫn
             * `enabled=true` làm runtime tiếp tục công bố Program đang bật
             * trong khi người vận hành tin là đã tắt. Áp dụng được từ mọi
             * trạng thái, kể cả FAULTED. */
            p->enabled = false;
            p->state = StProgramState::DISABLED;
        }

        p->enable_ack_state.store(static_cast<uint8_t>(state_at_request),
                                  std::memory_order_relaxed);
        p->enable_ack_result.store(static_cast<uint8_t>(result), std::memory_order_relaxed);
        p->pending_enable_request.store(static_cast<uint8_t>(StEnableRequest::NONE),
                                        std::memory_order_relaxed);
        /* release: non-RT thấy generation tăng thì chắc chắn thấy kết quả và
         * trạng thái đã ghi ở trên. Tăng CUỐI CÙNG, không sớm hơn. */
        p->enable_ack_generation.fetch_add(1, std::memory_order_release);
    }
}

void StScheduler::apply_pending_enable_requests_at_boundary()
{
    for (auto& task : tasks_) apply_pending_enable_requests(*task);
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
            p->output_commit_now_ns = 0;
            /* Gói mới chưa chạy lần nào: tư cách của gói CŨ không được thừa kế. */
            p->committed_since_activation = false;
            p->outputs_withdrawn = false;
            p->retain_restore_state = p->pending_retain_restore_state;
            p->retain_reject_code = p->pending_retain_reject_code;
            p->retain_generation = p->pending_retain_generation;
            p->last_successful_now_ns = 0;
            /* T60-002: mốc chạy và chuỗi lỡ nhịp thuộc về artifact CŨ. */
            p->last_run_mono_ns = 0;
            p->consecutive_missed_release = 0;
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
        /* T59-407 — công bố ngay ảnh ĐÃ RESET, không chờ chu kỳ chạy kế tiếp.
         *
         * Triệu chứng nếu thiếu: reset xong, RAM sạch, nhưng file bền vững vẫn
         * giữ giá trị cũ — khởi động lại là giá trị cũ quay về. Đúng nghĩa "reset
         * nửa vời" mà `T59-407` cấm.
         *
         * Nguyên nhân: `publish_committed_retain_snapshots()` chỉ công bố cho
         * Program vừa CHẠY và vừa COMMIT output trong base step này. Mà Program
         * hay bị reset nhất lại là Program đang STOPPED hoặc FAULTED — đúng
         * những Program không bao giờ thoả điều kiện đó. Force-flush sau đó chỉ
         * ghi lại ảnh CŨ, hoặc không ghi gì.
         *
         * Công bố ở đây không phụ thuộc trạng thái chạy: reset là một sự kiện
         * của DỮ LIỆU, không phải của việc chạy. */
        if (p->retain_mailbox != nullptr && p->runtime.loaded()) {
            const StLoadedProgram* loaded = p->runtime.program();
            if (loaded != nullptr && loaded->has_retain())
                (void)st_publish_retain_snapshot(p->retain_mailbox, *loaded,
                                                 p->last_successful_now_ns);
        }
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

bool StScheduler::run_program(StTask& task, StProgramInstance& program, uint64_t now_ns,
                             LaneOutcome* outcome)
{
    const uint64_t program_start = wall_clock_();

    bool has_input_binding = false;
    for (const StIrIoBinding& binding : program.runtime.program()->io_bindings) {
        if (!binding.is_output) {
            has_input_binding = true;
            break;
        }
    }
    auto record_fault = [&](const char* code, uint32_t pc, int line) {
        program.fault_count++;
        program.last_fault_code = code;
        program.last_fault_pc = pc;
        program.last_fault_line = line;
        program.state = StProgramState::FAULTED;
        program.last_successful_base_step = 0;
        outcome->faults++;
        outcome->dispatch_failed = true;
        if (outcome->event_count < outcome->events.size()) {
            StRuntimeTraceEvent& event = outcome->events[outcome->event_count++];
            event.kind = StTraceEventKind::RUNTIME_FAULT;
            event.timestamp_ns = now_ns;
            event.ok = false;
            event.task_id = task.config().id.c_str();
            event.instance_id = program.instance_id.c_str();
            event.code = code;
        }
    };

    if (has_input_binding &&
        (program.input_snapshot_generation != base_step_count_ || !program.input_snapshot_valid)) {
        /* Required input không GOOD/mapped/coercible thì Program này KHÔNG
         * execute — chạy bằng slot cũ sẽ trình bày dữ liệu stale như dữ liệu
         * live và vẫn publish output mới. */
        record_fault(st_diag_code::kRtNonFiniteInput, 0, 0);
        return false;
    }

    const StExecResult result = program.runtime.execute(static_cast<int64_t>(now_ns));
    program.run_count++;
    program.last_release_base_step = base_step_count_;
    /* T60-002 — MỐC THỜI GIAN của lần chạy, ghi ngay sau khi thân chương trình
     * đã thực thi và TRƯỚC nhánh fault: một Program chết lúc 10:03 phải báo
     * 10:03, không phải mốc của lần chạy tốt cuối cùng trước đó. Chỉ RUNNING
     * mới được dispatch, nên sau khi fault chuyển sang FAULTED thì mốc này đứng
     * yên đúng tại thời điểm chết. Dùng `now_ns` (đồng hồ chụp một lần cho cả
     * tick) chứ không gọi `wall_clock_()`: cột này được so với
     * `captured_monotonic_ns` của cùng snapshot, hai đồng hồ khác nhau thì phép
     * trừ đó vô nghĩa. */
    program.last_run_mono_ns = now_ns;
    if (result.waiting) {
        /* WAIT do freshness là backpressure có chủ đích. Runtime đã rollback
         * toàn bộ slot/FB và không publish signal/output. Công bố WAITING để
         * read-back không nói sai là RUNNING; dispatcher vẫn release WAITING
         * ở chu kỳ kế để tự hồi phục khi producer có dữ liệu. */
        program.state = StProgramState::WAITING;
        program.last_successful_base_step = 0;
        return true;
    }
    if (!result.ok) {
        record_fault(result.fault_code, result.fault_pc, result.fault_line);
        return false;
    }
    program.last_successful_base_step = base_step_count_;
    program.state = StProgramState::RUNNING;
    program.last_successful_now_ns = now_ns;
    /* Đo WCET theo TỪNG Program: với ba lớp chu kỳ trong một Task, một con số
     * gộp ở Task không trả lời được "Program nào ăn hết ngân sách". */
    program.last_exec_ns = wall_clock_() - program_start;
    if (program.last_exec_ns > program.max_exec_ns) program.max_exec_ns = program.last_exec_ns;
    outcome->ran++;
    return true;
}

void StScheduler::run_lane(StTask& task, const LaneWork& work, uint64_t now_ns,
                           LaneOutcome* outcome)
{
    for (std::size_t slot = 0; slot < work.program_count; ++slot) {
        StProgramInstance& program = *task.programs()[work.program_index[slot]];
        /* Cô lập lỗi (kiến trúc §8 "isolate Program"): fault của MỘT Program
         * không dừng những Program còn lại. Trước T59-403 một fault dừng cả
         * Task, nên một Program hỏng làm mọi Program khác — kể cả Program không
         * liên quan gì tới nó — ngừng tác động lên đầu ra mà không có mục nào
         * trong hồ sơ nói vì sao. Trao đổi dữ liệu giữa Program đi qua Published
         * Signal, nơi consumer có chính sách fallback khai báo cho đúng tình
         * huống producer chết. */
        (void)run_program(task, program, now_ns, outcome);
    }
}

void StScheduler::run_task(StTask& task, uint64_t now_ns, StSchedulerTickResult* out)
{
    /* task_start là đồng hồ RIÊNG cho WCET (SPEC §5) — KHÁC now_ns (mốc
     * logic chung của tick, dùng cho FB/deadline). Đọc chung một mốc ở đây
     * luôn cho exec_ns=0, không bao giờ phát hiện được overrun dù Task chạy
     * chậm tới đâu; đây là lỗi đã có trước TASK-PROG-304, không phải hành vi
     * định trước. */
    const uint64_t task_start = wall_clock_();
    task.last_dispatch_base_step_ = base_step_count_;
    task.last_dispatch_succeeded_ = true;

    /* Phân lane. Dùng bộ đệm cấp phát sẵn của scheduler: cấp phát trong chu kỳ
     * quét là thứ làm WCET không còn giới hạn trên. */
    std::size_t lane_count = 0;
    for (LaneWork& lane : lane_work_) lane.program_count = 0;
    for (LaneOutcome& outcome : lane_outcome_) outcome = LaneOutcome{};

    for (std::size_t index = 0; index < task.programs().size(); ++index) {
        StProgramInstance& program = *task.programs()[index];
        if (!program.enabled) continue;
        /* CHỈ RUNNING mới được thực thi. ACTIVE nghĩa là "đã là package hiện
         * hành" chứ chưa phải "đang được chạy mỗi chu kỳ" — chuyển sang RUNNING
         * là việc của lệnh `start`. Gộp hai trạng thái sẽ làm `start` trở nên
         * vô nghĩa và người vận hành mất quyền quyết định khi nào chương trình
         * bắt đầu tác động lên đầu ra (SPEC §7.1, §7.3). */
        if (program.state != StProgramState::RUNNING &&
            program.state != StProgramState::WAITING) continue;
        if (!program.runtime.loaded()) continue;
        /* Deadline RIÊNG của Program: một package 3 lớp chu kỳ chạy trong cùng
         * một Task, nên Task đến hạn KHÔNG có nghĩa mọi Program đến hạn. */
        if (!st_program_due(program, task.config().period_ms, now_ns)) continue;
        st_program_mark_released(&program, now_ns,
                                 st_release_tolerance_ns(
                                     static_cast<uint64_t>(task.config().period_ms) * 1000000ull));

        const std::size_t lane = program.lane < kMaxLanes ? program.lane : 0;
        LaneWork& work = lane_work_[lane];
        if (work.program_count < work.program_index.size())
            work.program_index[work.program_count++] = static_cast<uint16_t>(index);
        if (lane + 1 > lane_count) lane_count = lane + 1;
    }

    if (lane_mode_ == StLaneMode::PARALLEL && lane_count > 1 && !workers_.empty()) {
        /* Lane 0 chạy trên chính luồng gọi: một luồng đã có sẵn thì giao nó cho
         * worker rồi ngồi chờ là lãng phí thuần tuý. */
        const std::size_t dispatched = std::min(lane_count - 1, workers_.size());
        for (std::size_t lane = 1; lane <= dispatched; ++lane) {
            Worker& worker = *workers_[lane - 1];
            worker.task = &task;
            worker.work = &lane_work_[lane];
            worker.outcome = &lane_outcome_[lane];
            worker.now_ns = now_ns;
            worker.has_work.store(true, std::memory_order_release);
        }
        run_lane(task, lane_work_[0], now_ns, &lane_outcome_[0]);
        /* Lane vượt số worker chạy nốt trên luồng gọi — thiếu worker phải làm
         * chậm đi, không được làm BỎ SÓT. */
        for (std::size_t lane = dispatched + 1; lane < lane_count; ++lane)
            run_lane(task, lane_work_[lane], now_ns, &lane_outcome_[lane]);
        for (std::size_t lane = 1; lane <= dispatched; ++lane) {
            Worker& worker = *workers_[lane - 1];
            while (worker.has_work.load(std::memory_order_acquire)) std::this_thread::yield();
        }
    } else {
        for (std::size_t lane = 0; lane < lane_count; ++lane)
            run_lane(task, lane_work_[lane], now_ns, &lane_outcome_[lane]);
    }

    /* Trộn theo SỐ HIỆU LANE, không theo thứ tự hoàn thành: trộn theo thứ tự
     * hoàn thành sẽ làm trace và số đếm khác nhau giữa hai lần chạy cùng một
     * cấu hình, và "single/multicore cùng ngữ nghĩa" mất nghĩa. */
    uint32_t ran = 0;
    for (std::size_t lane = 0; lane < lane_count; ++lane) {
        const LaneOutcome& outcome = lane_outcome_[lane];
        ran += outcome.ran;
        out->faults += outcome.faults;
        if (outcome.dispatch_failed) task.last_dispatch_succeeded_ = false;
        for (std::size_t index = 0; index < outcome.event_count; ++index)
            if (trace_ != nullptr) trace_->push(outcome.events[index]);
    }

    const uint64_t exec_ns = wall_clock_() - task_start;
    task.stats_.run_count++;
    task.stats_.last_exec_ns = exec_ns;
    if (exec_ns > task.stats_.max_exec_ns) task.stats_.max_exec_ns = exec_ns;
    task.monitor_.record(exec_ns, static_cast<uint64_t>(task.config().budget_us) * 1000ull);

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
            if (p->state != StProgramState::RUNNING &&
                p->state != StProgramState::WAITING) continue;
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

StScheduler::~StScheduler() { stop_workers(); }

void StScheduler::start_workers(std::size_t count)
{
    stop_workers();
    workers_.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        auto worker = std::make_unique<Worker>();
        Worker* raw = worker.get();
        raw->owner = this;
        /* Spin + yield thay vì condition variable: đường quét không được đi vào
         * kernel để chờ. Worker chỉ tồn tại khi PARALLEL được bật tường minh,
         * nên chi phí spin là chi phí người dựng hệ đã chọn. */
        raw->thread = std::thread([raw]() {
            while (!raw->stop.load(std::memory_order_acquire)) {
                if (!raw->has_work.load(std::memory_order_acquire)) {
                    std::this_thread::yield();
                    continue;
                }
                raw->owner->run_lane(*raw->task, *raw->work, raw->now_ns, raw->outcome);
                raw->has_work.store(false, std::memory_order_release);
            }
        });
        workers_.push_back(std::move(worker));
    }
}

void StScheduler::stop_workers()
{
    for (auto& worker : workers_) {
        worker->stop.store(true, std::memory_order_release);
        if (worker->thread.joinable()) worker->thread.join();
    }
    workers_.clear();
}

void StScheduler::set_lane_mode(StLaneMode mode)
{
    if (mode == lane_mode_) return;
    lane_mode_ = mode;
    if (mode == StLaneMode::PARALLEL) {
        const unsigned hardware = std::thread::hardware_concurrency();
        /* Một luồng đã là luồng gọi, nên chỉ cần thêm `hardware - 1`. Trần
         * `kMaxLanes - 1` vì không bao giờ có nhiều lane hơn thế. */
        const std::size_t count =
            std::min<std::size_t>(kMaxLanes - 1, hardware > 1 ? hardware - 1 : 1);
        start_workers(count);
    } else {
        stop_workers();
    }
}

bool StScheduler::set_program_lane(const std::string& instance_id, uint8_t lane,
                                   std::string* error)
{
    if (lane >= kMaxLanes) {
        if (error) *error = "lane vượt trần " + std::to_string(kMaxLanes);
        return false;
    }
    StProgramInstance* program = find_program(instance_id);
    if (program == nullptr) {
        if (error) *error = "không có instance '" + instance_id + "'";
        return false;
    }
    program->lane = lane;
    return true;
}

StSchedulerTickResult StScheduler::on_base_step(uint64_t now_ns)
{
    StSchedulerTickResult result;
    result.base_step_sequence = ++base_step_count_;
    last_tick_now_ns_ = now_ns;

    /* tasks_ đã sắp theo ưu tiên tăng dần từ lúc add_task. Non-preemptive:
     * task ưu tiên cao chạy TRỌN VẸN rồi mới tới task kế. */
    /* Bước 3 của tick (SPEC §4): áp MỌI activation đang chờ, cho MỌI task —
     * không chỉ task đến hạn. Nếu chỉ áp cho task đến hạn thì activation của
     * một task chu kỳ dài phải đợi trọn một chu kỳ mới có hiệu lực, trong khi
     * BE đã báo "đã activate". Áp ở đây cũng bảo đảm không bao giờ swap package
     * giữa lúc execute() đang chạy. */
    apply_pending_activations_at_boundary();

    /* Đổi bản signal TRƯỚC khi bất kỳ Program nào chạy. Consumer trong chu kỳ
     * này đọc thứ publisher đã ghi ở chu kỳ TRƯỚC — độ trễ một chu kỳ là cái giá
     * của việc mọi consumer thấy cùng một ảnh, và nó là cái giá rẻ hơn nhiều so
     * với kết quả phụ thuộc thứ tự chạy. */
    if (signal_bus_ != nullptr) signal_bus_->commit_at_boundary();

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
    /* T59-501 — thăng cấp LKG là thao tác của cả GÓI, all-or-nothing.
     *
     * Bản trước thăng cấp từng Program độc lập. Với gói trộn ba lớp chu kỳ,
     * Program 1 s đủ tư cách ngay base step đầu còn Program 30 s phải chờ 30
     * base step — nên tập LKG trở thành NỬA GÓI MỚI NỬA GÓI CŨ. Rollback từ một
     * tập như vậy khôi phục một tổ hợp chưa từng được Check, và "old LKG exact"
     * mất nghĩa.
     *
     * Điều kiện là "đã commit ÍT NHẤT MỘT LẦN kể từ activate", không phải "cùng
     * commit ở một base step" — đòi điều thứ hai là đòi một thứ không bao giờ
     * xảy ra với gói nhiều chu kỳ. */
    bool package_qualified = true;
    bool has_candidate = false;
    for (const auto& task : tasks_) {
        for (const auto& program : task->programs()) {
            if (program->activated_artifact.empty()) continue;
            has_candidate = true;
            if (!program->committed_since_activation) package_qualified = false;
        }
    }
    if (!has_candidate || !package_qualified) return;

    for (auto& task : tasks_) {
        for (auto& program : task->programs()) {
            if (program->activated_artifact.empty()) continue;
            program->retired_artifact.swap(program->last_known_good);
            program->last_known_good.swap(program->activated_artifact);
        }
    }
}

} // namespace core
