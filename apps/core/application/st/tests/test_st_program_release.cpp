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
