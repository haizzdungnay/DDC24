/**
 * @file  test_st_program_release.cpp
 * @brief T59-402 — mỗi Program release theo deadline RIÊNG của nó.
 *
 *        DDD §7.1: Task không còn là đơn vị chạy chung. Một package có ba lớp
 *        chu kỳ (1 s / 5 s / 30 s) chạy trong cùng một Task, nên "Task đến hạn"
 *        KHÔNG có nghĩa "mọi Program đến hạn".
 *
 *        Bộ test này khoá luật release ở mức thuần hàm (`st_program_due` /
 *        `st_program_mark_released`) để kiểm được tính tất định của deadline mà
 *        không phải dựng cả một scan loop có I/O.
 */
#include <gtest/gtest.h>

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

#include "st/st_scheduler.hpp"

using namespace core;

namespace {

constexpr uint64_t kMs = 1000000ull;

/* `StProgramInstance` mang atomic nên không copy/move được — cấp phát tại chỗ
 * thay vì trả về theo giá trị. */
std::unique_ptr<StProgramInstance> make_program(const std::string& id, uint32_t period_ms,
                                                uint16_t order)
{
    auto program = std::make_unique<StProgramInstance>();
    program->instance_id = id;
    program->period_ms = period_ms;
    program->order = order;
    return program;
}

/* Đếm số lần release trong `duration_ms`, bước theo `step_ms`. */
uint32_t release_count(StProgramInstance* program, uint64_t duration_ms, uint64_t step_ms)
{
    uint32_t releases = 0;
    for (uint64_t now = 0; now <= duration_ms; now += step_ms) {
        if (!st_program_due(*program, 1000, now * kMs)) continue;
        ++releases;
        st_program_mark_released(program, now * kMs);
    }
    return releases;
}

} // namespace

/* `period_ms == 0` giữ NGUYÊN hành vi cũ: Task quyết định thời điểm. Đổi mặc
 * định sẽ làm mọi cấu hình chưa khai chu kỳ chạy khác đi mà không ai yêu cầu. */
TEST(StProgramRelease, ZeroPeriodDefersToTask)
{
    auto program = make_program("legacy", 0, 0);
    for (uint64_t now = 0; now < 10; ++now) {
        EXPECT_TRUE(st_program_due(*program, 1000, now * 1000 * kMs));
        st_program_mark_released(program.get(), now * 1000 * kMs);
    }
    EXPECT_EQ(program->missed_release_count, 0u);
}

/* Ba lớp chu kỳ trong cùng một Task cho đúng số release của từng lớp. */
TEST(StProgramRelease, ThreePeriodClassesReleaseIndependently)
{
    auto fast = make_program("fast", 1000, 0);
    auto medium = make_program("medium", 5000, 1);
    auto slow = make_program("slow", 30000, 2);

    /* 30 giây, bước 1 giây. Lần đầu luôn release (chưa `release_started`). */
    EXPECT_EQ(release_count(fast.get(), 30000, 1000), 31u);
    EXPECT_EQ(release_count(medium.get(), 30000, 1000), 7u);
    EXPECT_EQ(release_count(slow.get(), 30000, 1000), 2u);
}

/* Deadline bám mốc LÝ THUYẾT, không bám thời điểm chạy thật: một tick trễ không
 * được đẩy mọi deadline sau đó trôi theo. */
TEST(StProgramRelease, DeadlineIsTheoreticalNotDriftedByLateTick)
{
    auto program = make_program("fast", 1000, 0);
    ASSERT_TRUE(st_program_due(*program, 1000, 0));
    st_program_mark_released(program.get(), 0);
    EXPECT_EQ(program->next_release_ns, 1000 * kMs);

    /* Tick tới trễ 300 ms: deadline kế tiếp vẫn là mốc 2000 ms, không phải
     * 1300 + 1000 = 2300 ms. */
    ASSERT_TRUE(st_program_due(*program, 1000, 1300 * kMs));
    st_program_mark_released(program.get(), 1300 * kMs);
    EXPECT_EQ(program->next_release_ns, 2000 * kMs);
    EXPECT_EQ(program->missed_release_count, 0u);
}

/* Lỡ nhiều chu kỳ thì ĐẾM và BỎ, không chạy bù: chạy bù làm timer nhảy và làm
 * tình trạng quá tải nặng thêm. */
TEST(StProgramRelease, MissedReleasesAreCountedAndSkippedNotReplayed)
{
    auto program = make_program("fast", 1000, 0);
    st_program_mark_released(program.get(), 0);
    /* Nhảy thẳng tới 5,4 s: đã lỡ các mốc 1..4 s. */
    ASSERT_TRUE(st_program_due(*program, 1000, 5400 * kMs));
    st_program_mark_released(program.get(), 5400 * kMs);
    EXPECT_EQ(program->missed_release_count, 4u);
    EXPECT_GT(program->next_release_ns, 5400 * kMs);
    EXPECT_LE(program->next_release_ns, 6400 * kMs);
}

/* Thứ tự chạy KHÔNG bám thứ tự thêm vào: hai controller nạp cùng một package
 * theo thứ tự khác nhau phải chạy Program theo cùng một dãy. */
TEST(StProgramRelease, ExecutionOrderIsIndependentOfCreationOrder)
{
    auto build = [](const std::vector<std::pair<std::string, uint16_t>>& entries) {
        StScheduler scheduler(StSchedulerProfile::REV_A);
        StTaskConfig task;
        task.id = "main";
        task.period_ms = 1000;
        task.budget_ms = 199;
        std::string error;
        EXPECT_TRUE(scheduler.add_task(task, &error)) << error;
        for (const auto& entry : entries)
            EXPECT_TRUE(scheduler.add_program("main", entry.first, entry.second, &error)) << error;
        std::vector<std::string> order;
        for (const auto& program : scheduler.find_task("main")->programs())
            order.push_back(program->instance_id);
        return order;
    };
    const std::vector<std::pair<std::string, uint16_t>> forward = {
        {"P_ahu", 0}, {"P_boiler", 1}, {"P_chiller", 2}};
    const std::vector<std::pair<std::string, uint16_t>> reverse = {
        {"P_chiller", 2}, {"P_ahu", 0}, {"P_boiler", 1}};
    EXPECT_EQ(build(forward), build(reverse));
}

/* Trần 16 Program chạy đồng thời (DDD §0/§4.1) phải ép ở chỗ Program THỰC SỰ
 * bắt đầu tác động lên đầu ra. Ép ở lớp cấu hình chỉ chặn được ý định. */
TEST(StProgramRelease, RunningProgramCeilingIsSixteen)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    std::string error;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;

    for (uint16_t index = 0; index < 20; ++index) {
        const std::string id = "P_" + std::to_string(index);
        ASSERT_TRUE(scheduler.add_program("main", id, index, &error)) << error;
        /* `start` chỉ đi từ ACTIVE/STOPPED/ROLLED_BACK; đặt trực tiếp để test
         * đúng TRẦN chứ không test lại máy trạng thái. */
        scheduler.find_program(id)->state = StProgramState::ACTIVE;
    }
    uint32_t started = 0;
    for (uint16_t index = 0; index < 20; ++index) {
        if (scheduler.start("P_" + std::to_string(index), &error)) ++started;
    }
    EXPECT_EQ(started, 16u) << "trần Program chạy đồng thời không đúng 16";
    EXPECT_NE(error.find("too many running programs"), std::string::npos);

    /* Dừng một Program phải giải phóng đúng một suất — trần là trần ĐỘNG, không
     * phải một lần đếm rồi khoá vĩnh viễn. */
    ASSERT_TRUE(scheduler.stop("P_0", &error)) << error;
    EXPECT_TRUE(scheduler.start("P_16", &error)) << error;
}

/* Fixture 10 Program / 3 lớp chu kỳ: đếm release trong 30 s phải khớp lý thuyết
 * cho từng lớp, và tổng phải tất định giữa hai lần chạy. */
TEST(StProgramRelease, TenProgramThreePeriodFixtureIsDeterministic)
{
    auto run = []() {
        std::vector<std::unique_ptr<StProgramInstance>> programs;
        for (int index = 0; index < 4; ++index)
            programs.push_back(make_program("fast" + std::to_string(index), 1000,
                                            static_cast<uint16_t>(index)));
        for (int index = 0; index < 4; ++index)
            programs.push_back(make_program("medium" + std::to_string(index), 5000,
                                            static_cast<uint16_t>(4 + index)));
        for (int index = 0; index < 2; ++index)
            programs.push_back(make_program("slow" + std::to_string(index), 30000,
                                            static_cast<uint16_t>(8 + index)));
        std::vector<uint32_t> counts;
        for (auto& program : programs)
            counts.push_back(release_count(program.get(), 30000, 1000));
        return counts;
    };
    const std::vector<uint32_t> first = run();
    EXPECT_EQ(first, run()) << "release không tất định giữa hai lần chạy";
    const std::vector<uint32_t> expected = {31, 31, 31, 31, 7, 7, 7, 7, 2, 2};
    EXPECT_EQ(first, expected);
}

/* ===================================================================
 * T60-004 — `consecutive_missed_release` (T60-002, Plan 60 §4.2 điều 4).
 *
 * Công thức `health` chỉ được đọc bộ đếm LIÊN TIẾP, không đọc bộ đếm tích luỹ:
 * `missed_release_count` không bao giờ giảm, nên dùng nó để kết luận "sức khoẻ
 * HIỆN TẠI" sẽ ghim Program ở DEGRADED vĩnh viễn chỉ vì một lần lỡ nhịp cách
 * đây một giờ. Vì vậy phần phải khoá là chiều RESET, không phải chiều tăng.
 * =================================================================== */
TEST(StProgramRelease, ConsecutiveMissedReleaseResetsAfterAnOnTimeCycle)
{
    auto program = make_program("fast", 1000, 0);

    /* Chu kỳ đầu tiên: chưa có gì để lỡ. */
    ASSERT_TRUE(st_program_due(*program, 1000, 0));
    st_program_mark_released(program.get(), 0);
    EXPECT_EQ(program->missed_release_count, 0u);
    EXPECT_EQ(program->consecutive_missed_release, 0u);

    /* Nhảy thẳng tới 5,4 s: lỡ các mốc 1..4 s. */
    ASSERT_TRUE(st_program_due(*program, 1000, 5400 * kMs));
    st_program_mark_released(program.get(), 5400 * kMs);
    EXPECT_EQ(program->missed_release_count, 4u);
    EXPECT_EQ(program->consecutive_missed_release, 4u);

    /* Vẫn đang lỡ nhịp ⇒ chuỗi CỘNG DỒN, không reset giữa chừng. */
    ASSERT_TRUE(st_program_due(*program, 1000, 8100 * kMs));
    st_program_mark_released(program.get(), 8100 * kMs);
    EXPECT_EQ(program->missed_release_count, 6u);
    EXPECT_EQ(program->consecutive_missed_release, 6u);

    /* MỘT chu kỳ đúng hạn (trễ 700 ms = jitter, chưa trọn một chu kỳ) phải kết
     * thúc chuỗi NGAY, trong khi bộ đếm tích luỹ giữ nguyên con số lịch sử. */
    ASSERT_TRUE(st_program_due(*program, 1000, 9700 * kMs));
    st_program_mark_released(program.get(), 9700 * kMs);
    EXPECT_EQ(program->consecutive_missed_release, 0u)
        << "một chu kỳ đúng hạn phải đưa chuỗi lỡ nhịp về 0";
    EXPECT_EQ(program->missed_release_count, 6u)
        << "bộ đếm tích luỹ là lịch sử, không được reset theo";

    /* Và ở lại 0 qua nhiều chu kỳ đúng hạn liên tiếp. */
    for (uint64_t now = 10000; now <= 15000; now += 1000) {
        ASSERT_TRUE(st_program_due(*program, 1000, now * kMs));
        st_program_mark_released(program.get(), now * kMs);
        EXPECT_EQ(program->consecutive_missed_release, 0u) << "now=" << now;
    }
    EXPECT_EQ(program->missed_release_count, 6u);
}

/* `st_program_mark_released` là API công khai nên có thể bị gọi TRƯỚC hạn.
 * Sớm hơn hạn thì chắc chắn không lỡ nhịp — chuỗi phải về 0, không được giữ lại
 * con số cũ và báo DEGRADED cho một Program đang chạy sớm. */
TEST(StProgramRelease, EarlyMarkClearsTheMissedChain)
{
    auto program = make_program("fast", 1000, 0);
    st_program_mark_released(program.get(), 0);
    st_program_mark_released(program.get(), 5400 * kMs);
    ASSERT_EQ(program->consecutive_missed_release, 4u);

    /* Deadline kế tiếp là 6000 ms; gọi ở 5500 ms là gọi trước hạn. */
    st_program_mark_released(program.get(), 5500 * kMs);
    EXPECT_EQ(program->consecutive_missed_release, 0u);
    EXPECT_EQ(program->missed_release_count, 4u);
}

/* `period_ms == 0` = "theo chu kỳ Task": Task đã quyết định thời điểm, nên
 * Program không tự đếm lỡ nhịp và chuỗi phải đứng yên ở 0. Nếu không, mọi cấu
 * hình chưa khai chu kỳ riêng sẽ bị `health` chấm DEGRADED oan. */
TEST(StProgramRelease, TaskInheritedPeriodNeverAccumulatesAMissedChain)
{
    auto program = make_program("legacy", 0, 0);
    for (uint64_t now = 0; now < 10; ++now) {
        ASSERT_TRUE(st_program_due(*program, 1000, now * 5000 * kMs));
        st_program_mark_released(program.get(), now * 5000 * kMs);
    }
    EXPECT_EQ(program->consecutive_missed_release, 0u);
    EXPECT_EQ(program->missed_release_count, 0u);
}

/* ===================================================================
 * F01 (EV-PROG-FBD-ST-MB-20260925) — jitter nhỏ hơn tick neo KHÔNG được làm
 * mất release.
 *
 * Trên bo Foxlinx, hai Program 1000 ms trên base 1000 ms mất 23 và 30 release
 * trong 144 chu kỳ: release đầu được neo ở thời điểm quét thật (jitter 120 µs),
 * và mọi tick sau có jitter nhỏ hơn bị so chặt là "chưa tới hạn".
 * =================================================================== */
namespace {

constexpr uint64_t kUs = 1000ull;

/* Jitter đo được trên bo (19–127 µs), tick neo là tick có jitter lớn nhất. */
uint64_t board_jitter_ns(uint64_t tick)
{
    static const uint64_t pattern_us[] = {120, 20, 33, 127, 19, 61, 45, 110, 28, 90, 22, 74};
    return pattern_us[tick % (sizeof(pattern_us) / sizeof(pattern_us[0]))] * kUs;
}

struct ReleaseTally {
    uint32_t releases = 0;
    uint32_t missed = 0;
};

ReleaseTally run_jittered(StProgramInstance* program, uint32_t task_period_ms, uint64_t ticks,
                          uint64_t tick_ns)
{
    const uint64_t tolerance =
        st_release_tolerance_ns(static_cast<uint64_t>(task_period_ms) * kMs);
    ReleaseTally tally;
    for (uint64_t tick = 0; tick < ticks; ++tick) {
        const uint64_t now = tick * tick_ns + board_jitter_ns(tick);
        if (!st_program_due(*program, task_period_ms, now)) continue;
        ++tally.releases;
        st_program_mark_released(program, now, tolerance);
    }
    tally.missed = program->missed_release_count;
    return tally;
}

} // namespace

TEST(StProgramReleaseJitter, JitterBelowAnchorNeverDropsAReleaseAtOneSecond)
{
    auto program = make_program("fbd_do", 1000, 0);
    const ReleaseTally tally = run_jittered(program.get(), 1000, 144, 1000 * kMs);
    EXPECT_EQ(tally.releases, 144u) << "mỗi tick 1 s phải release đúng một lần";
    EXPECT_EQ(tally.missed, 0u);
    EXPECT_EQ(program->consecutive_missed_release, 0u);
}

/* Bộ chu kỳ chủ sở hữu chốt 2026-09-25 trên base step 10 ms: số release của mỗi
 * lớp phải đúng lý thuyết, kể cả khi mọi tick mang jitter. */
TEST(StProgramReleaseJitter, OwnerPeriodSetOnTenMsBaseReleasesExactly)
{
    const uint32_t periods[] = {10, 50, 100, 500, 1000, 5000, 10000, 50000};
    constexpr uint64_t kTicks = 10000;   /* 100 s trên base 10 ms */
    for (const uint32_t period : periods) {
        auto program = make_program("p" + std::to_string(period), period, 0);
        const ReleaseTally tally = run_jittered(program.get(), 10, kTicks, 10 * kMs);
        const uint32_t expected = static_cast<uint32_t>((kTicks - 1) * 10 / period + 1);
        EXPECT_EQ(tally.releases, expected) << "period " << period << " ms";
        EXPECT_EQ(tally.missed, 0u) << "period " << period << " ms";
    }
}

/* Dung sai chỉ nuốt jitter, không cho chạy sớm trọn một tick. */
TEST(StProgramReleaseJitter, ToleranceNeverAdvancesAReleaseByAWholeTick)
{
    auto program = make_program("p50", 50, 0);
    st_program_mark_released(program.get(), 0);
    ASSERT_EQ(program->next_release_ns, 50 * kMs);
    /* Task 10 ms: tick 40 ms (sớm đúng một tick) chưa tới hạn; tick 50 ms trừ
     * jitter âm vẫn là đúng hạn. */
    EXPECT_FALSE(st_program_due(*program, 10, 40 * kMs + 120 * kUs));
    EXPECT_TRUE(st_program_due(*program, 10, 50 * kMs - 100 * kUs));
}

/* Lỡ thật (một tick biến mất) vẫn phải được đếm, kể cả khi tick kế đến sớm hơn
 * tick neo. Dung sai không được biến một lần lỡ thành "đúng hạn". */
TEST(StProgramReleaseJitter, RealMissIsStillCountedWhenNextTickIsEarly)
{
    auto program = make_program("p1000", 1000, 0);
    const uint64_t tolerance = st_release_tolerance_ns(1000 * kMs);
    st_program_mark_released(program.get(), 120 * kUs, tolerance);          /* neo */
    ASSERT_TRUE(st_program_due(*program, 1000, 1000 * kMs + 20 * kUs));
    st_program_mark_released(program.get(), 1000 * kMs + 20 * kUs, tolerance);
    /* Tick 2000 ms mất hẳn (overrun); tick 3000 ms đến với jitter 19 µs. */
    ASSERT_TRUE(st_program_due(*program, 1000, 3000 * kMs + 19 * kUs));
    st_program_mark_released(program.get(), 3000 * kMs + 19 * kUs, tolerance);
    EXPECT_EQ(program->missed_release_count, 1u);
    EXPECT_EQ(program->consecutive_missed_release, 1u);
}

/* Task bật lại ở một tick có jitter (ví dụ sau Restore) không được bỏ tick kế
 * có jitter nhỏ hơn: runCount phải bằng số tick. */
TEST(StProgramReleaseJitter, TaskReanchoredOnJitteredTickKeepsEveryTick)
{
    StTaskConfig cfg;
    cfg.id = "main";
    cfg.period_ms = 1000;
    cfg.budget_ms = 199;
    StTask task(cfg);
    task.set_base_step_ns(1000 * kMs);
    uint32_t runs = 0;
    for (uint64_t tick = 0; tick < 144; ++tick) {
        const uint64_t now = tick * 1000 * kMs + board_jitter_ns(tick);
        if (!task.due(now)) continue;
        ++runs;
        task.mark_ran(now);
    }
    EXPECT_EQ(runs, 144u);
    EXPECT_EQ(task.stats().missed_release_count, 0u);
}

/* Task 100 ms trên base 10 ms: dung sai bị chặn ở nửa BASE STEP, nên tick sớm
 * một base step không được chạy Task. */
TEST(StProgramReleaseJitter, TaskToleranceIsBoundedByBaseStep)
{
    StTaskConfig cfg;
    cfg.id = "fast";
    cfg.period_ms = 100;
    cfg.budget_ms = 19;
    StTask task(cfg);
    task.set_base_step_ns(10 * kMs);
    EXPECT_EQ(task.release_tolerance_ns(), 5 * kMs);
    ASSERT_TRUE(task.due(0));
    task.mark_ran(120 * kUs);
    EXPECT_FALSE(task.due(90 * kMs + 20 * kUs));
    EXPECT_TRUE(task.due(100 * kMs + 20 * kUs));
}
