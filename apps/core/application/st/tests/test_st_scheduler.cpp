/**
 * @file  test_st_scheduler.cpp
 * @brief SCHEDULER_GATE — 12 nhóm test bắt buộc ở
 *        PROGRAM_TASK_SCHEDULER_SPEC §11.
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_process_image.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"
#include "priority/priority_resolver.hpp"
#include "tests/allocation_probe.hpp"

namespace core {
namespace {

std::vector<uint8_t> build(const std::string& src)
{
    StIrModule mod;
    StDiagnostic d;
    EXPECT_TRUE(compile_st_source(src, &mod, &d)) << d.code << ": " << d.message;
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

/* Chương trình đếm số lần chạy — cách trực tiếp nhất để kiểm thứ tự và số lần
 * thực thi mà không cần instrument scheduler. */
std::vector<uint8_t> counter_program()
{
    return build(R"ST(
PROGRAM counter
VAR_OUTPUT n : INT; END_VAR
    n := n + 1;
END_PROGRAM
)ST");
}

std::vector<uint8_t> faulting_program()
{
    return build(R"ST(
PROGRAM boom
VAR_INPUT  d : INT; END_VAR
VAR_OUTPUT n : INT; END_VAR
    n := n + 1;
    n := n / d;
END_PROGRAM
)ST");
}

StTaskConfig task_cfg(const char* id, uint8_t prio, uint32_t period, uint32_t budget = 0)
{
    StTaskConfig c;
    c.id = id;
    c.priority = prio;
    c.period_ms = period;
    c.budget_ms = budget ? budget : period;
    return c;
}

int32_t counter_of(StScheduler& s, const char* inst)
{
    StValue v;
    EXPECT_TRUE(s.find_program(inst)->runtime.get_variable("n", &v));
    return v.i;
}

/* Nạp + start một instance trong một bước — lặp lại nhiều lần trong file. */
void deploy(StScheduler& s, const char* inst, const std::vector<uint8_t>& art, uint64_t now)
{
    std::string err;
    ASSERT_TRUE(s.request_activation(inst, art, &err)) << err;
    s.tick(now);
    ASSERT_TRUE(s.start(inst, &err)) << err;
}

constexpr uint64_t kMs = 1000000ull;

} // namespace

/* ---- Cấu hình: fail-fast trên mọi vi phạm ràng buộc ---- */

TEST(StScheduler, RejectsDuplicateTaskId)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("FAST", 0, 100), &err));
    EXPECT_FALSE(s.add_task(task_cfg("FAST", 1, 200), &err));
    EXPECT_NE(err.find("duplicate task id"), std::string::npos);
}

TEST(StScheduler, RejectsDuplicatePriority)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("A", 0, 100), &err));
    EXPECT_FALSE(s.add_task(task_cfg("B", 0, 200), &err));
    EXPECT_NE(err.find("duplicate task priority"), std::string::npos);
}

TEST(StScheduler, RejectsPeriodNotMultipleOfBaseTick)
{
    /* Chu kỳ không chia hết tick cơ sở làm task trôi so với chính chu kỳ khai
     * báo, và WCET cộng dồn mất ý nghĩa. */
    StScheduler s;
    std::string err;
    EXPECT_FALSE(s.add_task(task_cfg("ODD", 0, 70), &err));
    EXPECT_NE(err.find("multiple of base tick"), std::string::npos);
}

TEST(StScheduler, RejectsBudgetLargerThanPeriod)
{
    StScheduler s;
    std::string err;
    EXPECT_FALSE(s.add_task(task_cfg("X", 0, 100, 200), &err));
}

TEST(StScheduler, RejectsTooManyTasks)
{
    StScheduler s;
    std::string err;
    for (int i = 0; i < 8; i++)
        ASSERT_TRUE(s.add_task(task_cfg(("T" + std::to_string(i)).c_str(),
                                        static_cast<uint8_t>(i), 100), &err)) << err;
    EXPECT_FALSE(s.add_task(task_cfg("T8", 7, 100), &err));
}

TEST(StSchedulerRevA, AcceptsOnlyProfilePeriodsAndBudgetBelowTwentyPercent)
{
    for (const uint32_t period_ms : st_profile_generated::kAllowedPeriodMs) {
        StScheduler s(StSchedulerProfile::REV_A);
        std::string err;
        ASSERT_TRUE(s.add_task(task_cfg("Control_Main", 0, period_ms,
                                        period_ms / 5 - 1), &err))
            << period_ms << " ms: " << err;
    }

    StScheduler wrong_period(StSchedulerProfile::REV_A);
    std::string err;
    EXPECT_FALSE(wrong_period.add_task(task_cfg("Control_Main", 0, 2000, 100), &err));
    EXPECT_NE(err.find("not allowed by profile"), std::string::npos);

    StScheduler exact_limit(StSchedulerProfile::REV_A);
    EXPECT_FALSE(exact_limit.add_task(task_cfg("Control_Main", 0, 1000, 200), &err));
    EXPECT_NE(err.find("<20%"), std::string::npos);

    StScheduler below_limit(StSchedulerProfile::REV_A);
    EXPECT_TRUE(below_limit.add_task(task_cfg("Control_Main", 0, 1000, 199), &err)) << err;
}

TEST(StSchedulerProduct, AcceptsProfileCapacityAndRejectsOneOver)
{
    /* Product v2 cho phép nhiều Program (32 tổng, 16 Enabled). Test cũ khoá
     * "một task, một program" nên nó chứng minh giới hạn As-Built chứ không phải
     * giới hạn sản phẩm; nay kiểm đúng trần profile và một-trên-trần. */
    StScheduler s(StSchedulerProfile::REV_A);
    std::string err;

    const std::size_t max_tasks = st_profile_generated::kMaxTasks;
    ASSERT_EQ(max_tasks, st_profile_generated::kAllowedPeriodMs.size());
    for (std::size_t index = 0; index < max_tasks; ++index) {
        const std::string id = "Task_" + std::to_string(index);
        ASSERT_TRUE(s.add_task(task_cfg(id.c_str(), static_cast<uint8_t>(index),
                                        st_profile_generated::kAllowedPeriodMs[index], 100),
                               &err))
            << err;
    }
    EXPECT_FALSE(
        s.add_task(task_cfg("Task_over", static_cast<uint8_t>(max_tasks), 1000, 100), &err));
    EXPECT_NE(err.find("limit " + std::to_string(max_tasks)), std::string::npos) << err;

    const std::size_t max_total = st_profile_generated::kMaxProgramsTotal;
    for (std::size_t index = 0; index < max_total; ++index) {
        const std::string instance = "program-" + std::to_string(index);
        ASSERT_TRUE(s.add_program("Task_0", instance, static_cast<uint16_t>(index), &err))
            << instance << ": " << err;
    }
    EXPECT_FALSE(
        s.add_program("Task_0", "program-over", static_cast<uint16_t>(max_total), &err));
    EXPECT_NE(err.find("too many program"), std::string::npos) << err;
}

TEST(StSchedulerRevA, BaseStepContinuesWhileThirtySecondTaskWaitsForRelease)
{
    StScheduler s(StSchedulerProfile::REV_A);
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("Control_Main", 0, 30000, 100), &err)) << err;
    ASSERT_TRUE(s.add_program("Control_Main", "program-main", 0, &err)) << err;
    deploy(s, "program-main", counter_program(), 0);

    for (uint64_t second = 1; second < 30; ++second) {
        const StSchedulerTickResult r = s.on_base_step(second * 1000 * kMs);
        EXPECT_EQ(r.base_step_sequence, second + 1);
        EXPECT_EQ(r.tasks_run, 0u) << "Task 30 s không được chạy ở giây " << second;
        EXPECT_EQ(r.programs_run, 0u);
    }
    const StSchedulerTickResult due = s.on_base_step(30000 * kMs);
    EXPECT_EQ(due.base_step_sequence, 31u);
    EXPECT_EQ(due.tasks_run, 1u);
    EXPECT_EQ(due.programs_run, 1u);
    EXPECT_EQ(counter_of(s, "program-main"), 1);
    EXPECT_EQ(s.base_step_count(), 31u)
        << "activation step + 30 base step phải độc lập với một Task release";
}

TEST(StScheduler, RejectsDuplicateProgramOrderInTask)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p1", 0, &err));
    EXPECT_FALSE(s.add_program("T", "p2", 0, &err));
    EXPECT_NE(err.find("duplicate order"), std::string::npos);
}

TEST(StScheduler, RejectsDuplicateInstanceIdAcrossTasks)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("A", 0, 100), &err));
    ASSERT_TRUE(s.add_task(task_cfg("B", 1, 100), &err));
    ASSERT_TRUE(s.add_program("A", "same", 0, &err));
    EXPECT_FALSE(s.add_program("B", "same", 0, &err));
}

/* ---- Thứ tự và chu kỳ ---- */

TEST(StScheduler, TasksRunInPriorityOrderRegardlessOfInsertionOrder)
{
    StScheduler s;
    std::string err;
    /* Thêm theo thứ tự ưu tiên NGƯỢC để chắc chắn scheduler tự sắp lại. */
    ASSERT_TRUE(s.add_task(task_cfg("SLOW", 2, 100), &err));
    ASSERT_TRUE(s.add_task(task_cfg("FAST", 0, 100), &err));
    ASSERT_TRUE(s.add_task(task_cfg("NORM", 1, 100), &err));

    ASSERT_EQ(s.tasks().size(), 3u);
    EXPECT_EQ(s.tasks()[0]->config().id, "FAST");
    EXPECT_EQ(s.tasks()[1]->config().id, "NORM");
    EXPECT_EQ(s.tasks()[2]->config().id, "SLOW");
}

TEST(StScheduler, ProgramsRunInDeclaredOrderWithinTask)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    /* Thêm ngược order để kiểm scheduler sắp lại theo `order`. */
    ASSERT_TRUE(s.add_program("T", "second", 1, &err));
    ASSERT_TRUE(s.add_program("T", "first", 0, &err));

    ASSERT_EQ(s.find_task("T")->programs()[0]->instance_id, "first");
    ASSERT_EQ(s.find_task("T")->programs()[1]->instance_id, "second");
}

TEST(StScheduler, FastTaskRunsMoreOftenThanSlowTask)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("FAST", 0, 100), &err));
    ASSERT_TRUE(s.add_task(task_cfg("SLOW", 1, 1000), &err));
    ASSERT_TRUE(s.add_program("FAST", "f", 0, &err));
    ASSERT_TRUE(s.add_program("SLOW", "s", 0, &err));

    deploy(s, "f", counter_program(), 0);
    deploy(s, "s", counter_program(), 0);

    /* 2 giây, tick mỗi 50 ms. */
    for (uint64_t t = 50; t <= 2000; t += 50) s.tick(t * kMs);

    const int32_t fast = counter_of(s, "f");
    const int32_t slow = counter_of(s, "s");
    EXPECT_GE(fast, 19) << "task 100 ms phải chạy ~20 lần trong 2 s";
    EXPECT_LE(fast, 21);
    EXPECT_GE(slow, 1) << "task 1000 ms phải chạy ~2 lần trong 2 s";
    EXPECT_LE(slow, 3);
}

TEST(StScheduler, PeriodDoesNotDriftOverManyCycles)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);

    /* 10 giây. Bù trôi theo mốc lý thuyết -> đúng 100 lần, không ít hơn. */
    for (uint64_t t = 50; t <= 10000; t += 50) s.tick(t * kMs);
    const int32_t n = counter_of(s, "p");
    EXPECT_GE(n, 99);
    EXPECT_LE(n, 101);
}

TEST(StScheduler, MissedCyclesAreSkippedNotCaughtUp)
{
    /* Lỡ nhiều chu kỳ -> chạy ĐÚNG MỘT lần ở tick kế, không chạy bù nhiều
     * lần. Chạy bù làm timer nhảy và làm quá tải nặng thêm (SPEC §4). */
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);

    const int32_t before = counter_of(s, "p");
    /* Nhảy 5 giây (lỡ 50 chu kỳ) trong MỘT tick. */
    s.tick(5000 * kMs);
    EXPECT_EQ(counter_of(s, "p"), before + 1) << "phải chạy đúng 1 lần, không bù 50 lần";
    EXPECT_EQ(s.find_task("T")->stats().missed_release_count, 49u);
}

TEST(StScheduler, MultipleTasksDueInSameTickAllRunInPriorityOrder)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("A", 0, 100), &err));
    ASSERT_TRUE(s.add_task(task_cfg("B", 1, 100), &err));
    ASSERT_TRUE(s.add_program("A", "a", 0, &err));
    ASSERT_TRUE(s.add_program("B", "b", 0, &err));
    deploy(s, "a", counter_program(), 0);
    deploy(s, "b", counter_program(), 0);

    const StSchedulerTickResult r = s.tick(100 * kMs);
    EXPECT_EQ(r.tasks_run, 2u);
    EXPECT_EQ(r.programs_run, 2u);
}

/* ---- Nhiều Program trong một Task ---- */

TEST(StScheduler, MultipleProgramsInOneTaskAllRun)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p0", 0, &err));
    ASSERT_TRUE(s.add_program("T", "p1", 1, &err));
    deploy(s, "p0", counter_program(), 0);
    deploy(s, "p1", counter_program(), 0);

    s.tick(100 * kMs);
    EXPECT_EQ(counter_of(s, "p0"), 1);
    EXPECT_EQ(counter_of(s, "p1"), 1);
}

TEST(StScheduler, ProgramFaultIsIsolatedFromRestOfTask)
{
    /* T59-403 ĐẢO CHIỀU hành vi cũ. Trước đây Program 0 lỗi làm Program 1 không
     * chạy, với lý do "các Program trong một Task thường phối hợp". Lý do đó
     * thuộc về thời Task chỉ có một Program và mọi trao đổi là ngầm.
     *
     * Trong mô hình đa Program, kiến trúc §8 quy định "isolate Program", và trao
     * đổi giữa Program đi qua Published Signal có chính sách fallback KHAI BÁO
     * cho đúng tình huống producer chết. Dừng cả Task nghĩa là một Program hỏng
     * làm mọi Program khác — kể cả Program không liên quan gì tới nó — ngừng tác
     * động lên đầu ra, mà không có mục nào trong hồ sơ nói vì sao. */
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "bad", 0, &err));
    ASSERT_TRUE(s.add_program("T", "good", 1, &err));
    deploy(s, "bad", faulting_program(), 0);
    deploy(s, "good", counter_program(), 0);

    /* d = 0 -> chia cho 0 */
    const StSchedulerTickResult r = s.tick(100 * kMs);
    EXPECT_EQ(r.faults, 1u);
    EXPECT_EQ(s.find_program("bad")->state, StProgramState::FAULTED);
    EXPECT_EQ(s.find_program("good")->state, StProgramState::RUNNING)
        << "Program lành không được lây trạng thái fault";
    EXPECT_EQ(counter_of(s, "good"), 1) << "Program lành phải vẫn chạy trong đúng tick đó";
    EXPECT_FALSE(s.find_task("T")->last_dispatch_succeeded())
        << "Task vẫn phải báo dispatch không sạch — cô lập không có nghĩa là im lặng";
}

TEST(StScheduler, FaultedProgramDoesNotCommitPartialState)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "bad", 0, &err));
    deploy(s, "bad", faulting_program(), 0);

    s.tick(100 * kMs);
    /* `n := n + 1` chạy TRƯỚC lệnh chia lỗi, nhưng phải bị huỷ cùng chu kỳ. */
    EXPECT_EQ(counter_of(s, "bad"), 0) << "không được commit nửa chừng";
}

/* ---- Overrun ---- */

TEST(StScheduler, TaskOverrunTriggersForceSafeAtThreshold)
{
    StScheduler s;
    std::string err;
    StTaskConfig c = task_cfg("T", 0, 100, 100);
    c.overrun_threshold = 2;
    ASSERT_TRUE(s.add_task(c, &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);

    StTask* t = s.find_task("T");
    /* Nạp overrun trực tiếp qua monitor — test này kiểm ĐƯỜNG NỐI scheduler →
     * safe, không kiểm lại logic monitor (đã có test riêng). */
    t->monitor().record(200 * kMs, 100 * kMs);
    EXPECT_FALSE(s.any_force_safe());
    t->monitor().record(200 * kMs, 100 * kMs);
    EXPECT_TRUE(s.any_force_safe());
}

TEST(StScheduler, ThreeConsecutiveRealOverrunsFaultTaskAtHostLevel)
{
    /* TASK-PROG-304: trước đây run_task() đo exec_ns bằng now_ns - now_ns
     * (cùng một tham số, không đổi trong hàm) — LUÔN LÀ 0, nên overrun không
     * bao giờ phát hiện được dù Task chạy chậm tới đâu trên bất kỳ phần cứng
     * nào. Test này lái qua đường THẬT (on_base_step -> run_task -> đồng hồ
     * WCET riêng), không nạp trực tiếp vào monitor như test phía trên. */
    StScheduler s;
    std::string err;
    StTaskConfig c = task_cfg("T", 0, /*period=*/100, /*budget=*/10);
    c.overrun_threshold = 3;
    ASSERT_TRUE(s.add_task(c, &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);

    uint64_t clock_ns = 0;
    s.set_wall_clock_for_test([&clock_ns]() {
        clock_ns += 20 * kMs; /* mỗi lần đọc "trôi" 20 ms — vượt budget 10 ms */
        return clock_ns;
    });

    s.tick(100 * kMs);
    EXPECT_EQ(s.find_program("p")->state, StProgramState::RUNNING) << "overrun 1/3 chưa đủ ngưỡng";
    s.tick(200 * kMs);
    EXPECT_EQ(s.find_program("p")->state, StProgramState::RUNNING) << "overrun 2/3 chưa đủ ngưỡng";
    s.tick(300 * kMs);
    EXPECT_EQ(s.find_program("p")->state, StProgramState::FAULTED)
        << "overrun 3/3 liên tiếp phải fault ĐÚNG Task này";
    EXPECT_STREQ(s.find_program("p")->last_fault_code, st_diag_code::kRtTaskOverrun);
    EXPECT_FALSE(s.find_task("T")->last_dispatch_succeeded());

    /* Không tự hồi phục — phải reset_fault tường minh (SPEC §8), kể cả khi
     * đồng hồ "nhanh lại" ở tick sau. */
    s.tick(400 * kMs);
    EXPECT_EQ(s.find_program("p")->state, StProgramState::FAULTED)
        << "FAULT không tự rời khi chưa reset_fault";
}

TEST(StScheduler, OneOrTwoOverrunsDoNotFaultOtherIndependentTask)
{
    /* "SafetyManager condition độc lập" (TASK-PROG-303/304): overrun của
     * Task A không được lan sang Task B — mỗi Task tự chịu trách nhiệm ngân
     * sách của mình, không có kênh chung nào ép cả hai cùng safe/fault. */
    StScheduler s;
    std::string err;
    StTaskConfig slow = task_cfg("SLOW", 0, /*period=*/100, /*budget=*/10);
    slow.overrun_threshold = 3;
    StTaskConfig fast = task_cfg("FAST", 1, /*period=*/100, /*budget=*/100);
    ASSERT_TRUE(s.add_task(slow, &err));
    ASSERT_TRUE(s.add_task(fast, &err));
    ASSERT_TRUE(s.add_program("SLOW", "p_slow", 0, &err));
    ASSERT_TRUE(s.add_program("FAST", "p_fast", 0, &err));
    deploy(s, "p_slow", counter_program(), 0);
    deploy(s, "p_fast", counter_program(), 0);

    uint64_t clock_ns = 0;
    s.set_wall_clock_for_test([&clock_ns]() {
        clock_ns += 20 * kMs;
        return clock_ns;
    });

    s.tick(100 * kMs);
    s.tick(200 * kMs);
    EXPECT_EQ(s.find_program("p_slow")->state, StProgramState::RUNNING);
    EXPECT_EQ(s.find_program("p_fast")->state, StProgramState::RUNNING)
        << "Task FAST không overrun (exec_ns 20ms < budget 100ms) và không bị Task SLOW kéo theo";
    EXPECT_GT(counter_of(s, "p_fast"), 0) << "Task FAST vẫn chạy bình thường";
}

TEST(StScheduler, DisabledTaskDoesNotForceSafe)
{
    StScheduler s;
    std::string err;
    StTaskConfig c = task_cfg("T", 0, 100, 100);
    c.overrun_threshold = 1;
    ASSERT_TRUE(s.add_task(c, &err));
    StTask* t = s.find_task("T");
    t->monitor().record(200 * kMs, 100 * kMs);
    ASSERT_TRUE(s.any_force_safe());

    t->set_enabled(false);
    EXPECT_FALSE(s.any_force_safe())
        << "task đã disable không được tiếp tục ép safe-state";
}

/* ---- Enable / disable ---- */

TEST(StScheduler, DisabledTaskDoesNotRun)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);
    s.tick(100 * kMs);
    const int32_t before = counter_of(s, "p");

    s.find_task("T")->set_enabled(false);
    for (uint64_t t = 200; t <= 1000; t += 100) s.tick(t * kMs);
    EXPECT_EQ(counter_of(s, "p"), before);
}

TEST(StScheduler, DisabledProgramDoesNotRunButTaskStillRuns)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "off", 0, &err));
    ASSERT_TRUE(s.add_program("T", "on", 1, &err));
    deploy(s, "off", counter_program(), 0);
    deploy(s, "on", counter_program(), 0);

    ASSERT_TRUE(s.disable("off", &err));
    s.tick(100 * kMs);
    EXPECT_EQ(counter_of(s, "off"), 0);
    EXPECT_EQ(counter_of(s, "on"), 1);
}

TEST(StScheduler, ReEnablingTaskResetsOverrunCounter)
{
    StScheduler s;
    std::string err;
    StTaskConfig c = task_cfg("T", 0, 100, 100);
    c.overrun_threshold = 2;
    ASSERT_TRUE(s.add_task(c, &err));
    StTask* t = s.find_task("T");
    t->monitor().record(200 * kMs, 100 * kMs);
    EXPECT_EQ(t->monitor().stats().consecutive, 1u);

    t->set_enabled(false);
    EXPECT_EQ(t->monitor().stats().consecutive, 0u)
        << "mang số đếm cũ sang lần bật lại sẽ khiến task vừa bật đã bị coi là hỏng";
}

/* ---- Vòng đời ---- */

TEST(StScheduler, ActivationAppliedAtTickBoundaryNotImmediately)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));

    ASSERT_TRUE(s.request_activation("p", counter_program(), &err));
    EXPECT_FALSE(s.find_program("p")->runtime.loaded()) << "chưa tick thì chưa nạp";
    EXPECT_EQ(s.find_program("p")->state, StProgramState::STAGED);

    s.tick(100 * kMs);
    EXPECT_TRUE(s.find_program("p")->runtime.loaded());
    EXPECT_EQ(s.find_program("p")->state, StProgramState::ACTIVE);
}

TEST(StScheduler, PreparedActivationAndLkgPromotionAllocateNothingAtCommitBoundary)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    ASSERT_TRUE(s.request_activation("p", counter_program(), &err));

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        s.tick(0);  // chỉ swap prepared handle
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);

    ASSERT_TRUE(s.start("p", &err));
    {
        allocation_probe::ScopedCounter counter;
        s.tick(100 * kMs);  // chỉ execute; chưa được nâng LKG trước output commit
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
    EXPECT_TRUE(s.find_program("p")->last_known_good.empty());

    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    {
        allocation_probe::ScopedCounter counter;
        EXPECT_TRUE(st_apply_all_outputs(&s, &resolver, &table, &stats));
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
    EXPECT_FALSE(s.find_program("p")->last_known_good.empty());
}

TEST(StScheduler, SecondActivationRejectedWhileFirstPending)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    ASSERT_TRUE(s.request_activation("p", counter_program(), &err));
    EXPECT_FALSE(s.request_activation("p", counter_program(), &err));
}

TEST(StScheduler, FailedActivationKeepsRunningProgram)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);
    s.tick(100 * kMs);
    const int32_t before = counter_of(s, "p");

    std::vector<uint8_t> broken = counter_program();
    broken[broken.size() - 1] ^= 0xFF;
    ASSERT_FALSE(s.request_activation("p", broken, &err));
    s.tick(200 * kMs);

    EXPECT_EQ(s.find_program("p")->state, StProgramState::RUNNING)
        << "activation lỗi phải giữ package đang chạy";
    EXPECT_GT(counter_of(s, "p"), before) << "chương trình cũ vẫn chạy";
}

TEST(StScheduler, StopDoesNotForceSafeState)
{
    /* `stop` là hành động vận hành có chủ ý, KHÔNG phải yêu cầu an toàn.
     * Gộp hai ý nghĩa làm người vận hành không biết mình đang yêu cầu gì. */
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);

    ASSERT_TRUE(s.stop("p", &err));
    EXPECT_FALSE(s.any_force_safe());
    EXPECT_EQ(s.find_program("p")->state, StProgramState::STOPPED);
}

TEST(StScheduler, StoppedProgramDoesNotRun)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));
    deploy(s, "p", counter_program(), 0);
    s.tick(100 * kMs);
    const int32_t before = counter_of(s, "p");

    ASSERT_TRUE(s.stop("p", &err));
    for (uint64_t t = 200; t <= 1000; t += 100) s.tick(t * kMs);
    EXPECT_EQ(counter_of(s, "p"), before);
}

TEST(StScheduler, InvalidTransitionsRejectedStably)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "p", 0, &err));

    EXPECT_FALSE(s.start("p", &err)) << "EMPTY -> RUNNING không hợp lệ";
    EXPECT_FALSE(s.stop("p", &err)) << "EMPTY -> STOPPED không hợp lệ";
    EXPECT_FALSE(s.reset_fault("p", &err)) << "chưa FAULTED thì không reset được";
    EXPECT_FALSE(s.rollback("p", &err)) << "chưa có last-known-good";
    EXPECT_FALSE(s.start("khong-ton-tai", &err));
}

TEST(StScheduler, ResetClearsFaultAndAllowsRestart)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "bad", 0, &err));
    deploy(s, "bad", faulting_program(), 0);
    s.tick(100 * kMs);
    ASSERT_EQ(s.find_program("bad")->state, StProgramState::FAULTED);

    ASSERT_TRUE(s.reset_fault("bad", &err)) << err;
    EXPECT_EQ(s.find_program("bad")->state, StProgramState::STOPPED);
    EXPECT_EQ(s.find_program("bad")->last_fault_code, nullptr);
    EXPECT_TRUE(s.start("bad", &err));
}

TEST(StScheduler, FaultedProgramDoesNotKeepRunning)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("T", 0, 100), &err));
    ASSERT_TRUE(s.add_program("T", "bad", 0, &err));
    deploy(s, "bad", faulting_program(), 0);
    s.tick(100 * kMs);
    const uint32_t faults_after_first = s.find_program("bad")->fault_count;

    for (uint64_t t = 200; t <= 1000; t += 100) s.tick(t * kMs);
    EXPECT_EQ(s.find_program("bad")->fault_count, faults_after_first)
        << "FAULTED không được chạy lại cho tới khi có can thiệp";
}

/* ---- Instance độc lập ---- */

TEST(StScheduler, TwoInstancesOfSameArtifactHaveIndependentState)
{
    StScheduler s;
    std::string err;
    ASSERT_TRUE(s.add_task(task_cfg("A", 0, 100), &err));
    ASSERT_TRUE(s.add_task(task_cfg("B", 1, 500), &err));
    ASSERT_TRUE(s.add_program("A", "i1", 0, &err));
    ASSERT_TRUE(s.add_program("B", "i2", 0, &err));

    const std::vector<uint8_t> art = counter_program();
    deploy(s, "i1", art, 0);
    deploy(s, "i2", art, 0);

    for (uint64_t t = 100; t <= 1000; t += 100) s.tick(t * kMs);

    /* Cùng artifact nhưng chu kỳ khác nhau -> bộ đếm phải khác nhau. */
    EXPECT_GT(counter_of(s, "i1"), counter_of(s, "i2"))
        << "hai instance phải có trạng thái hoàn toàn tách biệt";
}

} // namespace core
