#include "st/st_scheduler.hpp"

#include <algorithm>

namespace core {

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
    last_run_ns_ += period_ns;
    /* Nhưng nếu đã lỡ nhiều chu kỳ thì BỎ, không chạy bù (SPEC §4): chạy bù
     * làm timer nhảy và làm tình trạng quá tải nặng thêm. */
    if (last_run_ns_ + period_ns <= now_ns) last_run_ns_ = now_ns;
}

/* ---- StScheduler: cấu hình ---- */

bool StScheduler::add_task(const StTaskConfig& cfg, std::string* error)
{
    auto fail = [&](const std::string& m) { if (error) *error = m; return false; };

    if (tasks_.size() >= st_sched_limits::kMaxTasks)
        return fail("too many tasks (limit " + std::to_string(st_sched_limits::kMaxTasks) + ")");
    if (cfg.id.empty() || cfg.id.size() > 16) return fail("task id must be 1..16 characters");
    if (cfg.priority > 7) return fail("task priority must be 0..7");
    if (cfg.period_ms < st_sched_limits::kMinPeriodMs ||
        cfg.period_ms > st_sched_limits::kMaxPeriodMs)
        return fail("task period_ms out of range");
    /* Chu kỳ phải là bội số của tick cơ sở, nếu không task sẽ trôi so với
     * chính chu kỳ khai báo và WCET cộng dồn mất ý nghĩa. */
    if (cfg.period_ms % st_sched_limits::kBaseTickMs != 0)
        return fail("task period_ms must be a multiple of base tick " +
                    std::to_string(st_sched_limits::kBaseTickMs) + " ms");
    if (cfg.budget_ms == 0 || cfg.budget_ms > cfg.period_ms)
        return fail("task budget_ms must be in 1..period_ms");
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
    if (task->programs().size() >= st_sched_limits::kMaxProgramsPerTask)
        return fail("too many programs in task '" + task_id + "'");
    if (find_program(instance_id)) return fail("duplicate instance id '" + instance_id + "'");

    std::size_t total = 0;
    for (const auto& t : tasks_) total += t->programs().size();
    if (total >= st_sched_limits::kMaxProgramsTotal)
        return fail("too many program instances in resource");

    for (const auto& p : task->programs())
        if (p->order == order)
            return fail("duplicate order " + std::to_string(order) + " in task '" + task_id + "'");

    auto inst = std::make_unique<StProgramInstance>();
    inst->instance_id = instance_id;
    inst->order = order;
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
                                     const std::vector<uint8_t>& artifact, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance '" + instance_id + "'"; return false; }
    if (p->has_pending) {
        if (error) *error = "an activation is already pending for '" + instance_id + "'";
        return false;
    }
    p->pending_artifact = artifact;
    p->has_pending = true;
    p->state = StProgramState::STAGED;
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

bool StScheduler::rollback(const std::string& instance_id, std::string* error)
{
    StProgramInstance* p = find_program(instance_id);
    if (!p) { if (error) *error = "unknown instance"; return false; }
    if (p->last_known_good.empty()) {
        if (error) *error = "no last-known-good package to roll back to";
        return false;
    }
    /* Rollback đi LẠI đúng đường verify — không phải cửa sau bỏ qua kiểm tra.
     * Nếu package tốt trước đây nay không load được (vd đổi ABI runtime), thà
     * biết ngay còn hơn chạy một thứ chưa được kiểm. */
    StLoadError err;
    if (!p->runtime.activate(p->last_known_good.data(), p->last_known_good.size(), &err,
                             &loader_opts_)) {
        if (error) *error = "rollback failed to load: " + err.code + " " + err.message;
        p->state = StProgramState::FAULTED;
        return false;
    }
    p->state = StProgramState::ROLLED_BACK;
    p->last_fault_code = nullptr;
    return true;
}

/* ---- Tick ---- */

void StScheduler::apply_pending_activations(StTask& task)
{
    for (auto& p : task.programs()) {
        if (!p->has_pending) continue;
        const bool had_previous = p->runtime.loaded();
        StLoadError err;
        const bool ok = p->runtime.activate(p->pending_artifact.data(),
                                            p->pending_artifact.size(), &err, &loader_opts_);
        if (ok) {
            p->state = StProgramState::ACTIVE;
            /* Giữ lại bytes để promote thành last-known-good SAU KHI chạy được
             * >= 1 tick không fault — package chưa chạy lần nào không đủ tư
             * cách làm mốc rollback. */
            p->activated_artifact = p->pending_artifact;
        } else {
            /* Thất bại GIỮ NGUYÊN package đang chạy — không có mã lỗi nào dẫn
             * tới trạng thái "không có chương trình nào chạy" nếu trước đó đã
             * có (TYPED_IR_ARTIFACT_SPEC §8). */
            p->state = had_previous ? StProgramState::RUNNING : StProgramState::REJECTED;
        }
        /* Tiêu thụ request dù thành hay bại: không retry ngầm ở tick sau với
         * cùng artifact lỗi. */
        p->has_pending = false;
        p->pending_artifact.clear();
    }
}

void StScheduler::run_task(StTask& task, uint64_t now_ns, StSchedulerTickResult* out)
{
    const uint64_t start = now_ns;
    uint32_t ran = 0;

    for (auto& p : task.programs()) {
        if (!p->enabled) continue;
        /* CHỈ RUNNING mới được thực thi. ACTIVE nghĩa là "đã là package hiện
         * hành" chứ chưa phải "đang được chạy mỗi chu kỳ" — chuyển sang RUNNING
         * là việc của lệnh `start`. Gộp hai trạng thái sẽ làm `start` trở nên
         * vô nghĩa và người vận hành mất quyền quyết định khi nào chương trình
         * bắt đầu tác động lên đầu ra (SPEC §7.1, §7.3). */
        if (p->state != StProgramState::RUNNING) continue;
        if (!p->runtime.loaded()) continue;

        const StExecResult r = p->runtime.execute(static_cast<int64_t>(now_ns));
        p->run_count++;
        if (!r.ok) {
            p->fault_count++;
            p->last_fault_code = r.fault_code;
            p->last_fault_pc = r.fault_pc;
            p->last_fault_line = r.fault_line;
            p->state = StProgramState::FAULTED;
            out->faults++;
            /* Fault của MỘT Program dừng cả Task: các Program trong một Task
             * thường phối hợp (Program 0 tính setpoint, Program 1 dùng nó), nên
             * chạy tiếp sẽ đẩy đầu ra vào tổ hợp chưa từng được thiết kế
             * (SPEC §5). Staging của từng Program đã được StProgramRuntime huỷ. */
            break;
        }
        /* Chạy được >= 1 tick không fault -> đủ điều kiện last-known-good. */
        if (!p->activated_artifact.empty()) {
            p->last_known_good = p->activated_artifact;
            p->activated_artifact.clear();
        }
        ran++;
    }

    const uint64_t exec_ns = now_ns - start;
    task.stats_.run_count++;
    task.stats_.last_exec_ns = exec_ns;
    if (exec_ns > task.stats_.max_exec_ns) task.stats_.max_exec_ns = exec_ns;
    task.monitor_.record(exec_ns, static_cast<uint64_t>(task.config().budget_ms) * 1000000ull);

    out->programs_run += ran;
    out->tasks_run++;
}

StSchedulerTickResult StScheduler::tick(uint64_t now_ns)
{
    StSchedulerTickResult result;

    /* tasks_ đã sắp theo ưu tiên tăng dần từ lúc add_task. Non-preemptive:
     * task ưu tiên cao chạy TRỌN VẸN rồi mới tới task kế. */
    /* Bước 3 của tick (SPEC §4): áp MỌI activation đang chờ, cho MỌI task —
     * không chỉ task đến hạn. Nếu chỉ áp cho task đến hạn thì activation của
     * một task chu kỳ dài phải đợi trọn một chu kỳ mới có hiệu lực, trong khi
     * BE đã báo "đã activate". Áp ở đây cũng bảo đảm không bao giờ swap package
     * giữa lúc execute() đang chạy. */
    for (auto& t : tasks_) apply_pending_activations(*t);

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

} // namespace core
