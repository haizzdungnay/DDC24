/**
 * @file  test_st_program_lanes.cpp
 * @brief T59-403 — worker lane, cô lập lỗi và không cấp phát trong đường quét.
 *
 *        Ba điều được khoá ở đây:
 *        1. Hai chế độ lane cho ĐÚNG cùng kết quả quan sát được. Nếu khác, thì
 *           một trong hai đang chạy khác thứ người dùng cấu hình — và không có
 *           cách nào biết là chế độ nào.
 *        2. Fault của một Program không lây sang Program khác, kể cả cùng lane.
 *        3. Đường quét không cấp phát heap: cấp phát trong chu kỳ là thứ làm
 *           WCET không còn giới hạn trên.
 */
#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_profile_generated.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"
#include "tests/allocation_probe.hpp"

namespace core {
namespace {

constexpr uint64_t kMs = 1000000ull;

std::vector<uint8_t> build(const std::string& source)
{
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source, &module, &diagnostic))
        << diagnostic.code << ": " << diagnostic.message;
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

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

int32_t counter_of(StScheduler& scheduler, const std::string& instance)
{
    StValue value;
    EXPECT_TRUE(scheduler.find_program(instance)->runtime.get_variable("n", &value));
    return value.i;
}

/* Fixture 10 Program / 3 lớp chu kỳ / 4 lane. Trả về số đếm của từng Program
 * sau `ticks` chu kỳ base-step 1 s. */
struct FixtureResult {
    std::vector<int32_t> counters;
    uint32_t programs_run = 0;
    uint32_t faults = 0;
};

FixtureResult run_fixture(StLaneMode mode, std::size_t ticks)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    scheduler.set_lane_mode(mode);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    EXPECT_TRUE(scheduler.add_task(task, &error)) << error;

    const std::array<uint32_t, 3> periods = {1000u, 5000u, 30000u};
    std::vector<std::string> names;
    for (int index = 0; index < 10; ++index) {
        const std::string id = "P_" + std::to_string(index);
        EXPECT_TRUE(scheduler.add_program("main", id, static_cast<uint16_t>(index), &error))
            << error;
        EXPECT_TRUE(scheduler.set_program_lane(id, static_cast<uint8_t>(index % 4), &error))
            << error;
        scheduler.find_program(id)->period_ms = periods[index % periods.size()];
        names.push_back(id);
    }
    for (const std::string& id : names) {
        EXPECT_TRUE(scheduler.request_activation(id, counter_program(), &error)) << error;
    }
    scheduler.tick(0);
    for (const std::string& id : names) EXPECT_TRUE(scheduler.start(id, &error)) << error;

    FixtureResult result;
    for (std::size_t tick = 1; tick <= ticks; ++tick) {
        const StSchedulerTickResult step = scheduler.tick(tick * 1000 * kMs);
        result.programs_run += step.programs_run;
        result.faults += step.faults;
    }
    for (const std::string& id : names) result.counters.push_back(counter_of(scheduler, id));
    return result;
}

} // namespace

/* Hai chế độ lane phải cho ĐÚNG cùng kết quả. Đây là bất biến gốc của việc có
 * hai chế độ: khác nhau nghĩa là chọn chế độ trở thành một quyết định về ngữ
 * nghĩa, chứ không còn là quyết định về hiệu năng. */
TEST(StProgramLanes, SequentialAndParallelProduceIdenticalResults)
{
    const FixtureResult sequential = run_fixture(StLaneMode::SEQUENTIAL, 30);
    const FixtureResult parallel = run_fixture(StLaneMode::PARALLEL, 30);
    EXPECT_EQ(sequential.counters, parallel.counters);
    EXPECT_EQ(sequential.programs_run, parallel.programs_run);
    EXPECT_EQ(sequential.faults, parallel.faults);
    /* Số đếm phải khớp lý thuyết chứ không chỉ khớp NHAU: hai chế độ cùng sai
     * một kiểu vẫn cho hai kết quả bằng nhau. */
    const std::vector<int32_t> expected = {30, 6, 1, 30, 6, 1, 30, 6, 1, 30};
    EXPECT_EQ(sequential.counters, expected);
}

/* Chạy lặp lại nhiều lần ở chế độ song song: một kết quả đúng có thể là may
 * mắn về thời điểm, một kết quả đúng 20 lần thì không. */
TEST(StProgramLanes, ParallelResultIsStableAcrossRepeats)
{
    const FixtureResult reference = run_fixture(StLaneMode::PARALLEL, 10);
    for (int attempt = 0; attempt < 20; ++attempt) {
        const FixtureResult again = run_fixture(StLaneMode::PARALLEL, 10);
        ASSERT_EQ(reference.counters, again.counters) << "lần " << attempt;
        ASSERT_EQ(reference.programs_run, again.programs_run) << "lần " << attempt;
    }
}

/* Cô lập lỗi giữa hai LANE: lane khác hoàn toàn độc lập. */
TEST(StProgramLanes, FaultInOneLaneDoesNotStopAnother)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    scheduler.set_lane_mode(StLaneMode::PARALLEL);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_bad", 0, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_good", 1, &error)) << error;
    ASSERT_TRUE(scheduler.set_program_lane("P_bad", 0, &error)) << error;
    ASSERT_TRUE(scheduler.set_program_lane("P_good", 1, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_bad", faulting_program(), &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_good", counter_program(), &error)) << error;
    scheduler.tick(0);
    ASSERT_TRUE(scheduler.start("P_bad", &error)) << error;
    ASSERT_TRUE(scheduler.start("P_good", &error)) << error;

    const StSchedulerTickResult result = scheduler.tick(1000 * kMs);
    EXPECT_EQ(result.faults, 1u);
    EXPECT_EQ(scheduler.find_program("P_bad")->state, StProgramState::FAULTED);
    EXPECT_EQ(scheduler.find_program("P_good")->state, StProgramState::RUNNING);
    EXPECT_EQ(counter_of(scheduler, "P_good"), 1);
}

/* Cô lập lỗi TRONG CÙNG một lane: cô lập không phải là hệ quả của việc chạy
 * trên luồng khác, mà là chính sách của scheduler. */
TEST(StProgramLanes, FaultIsIsolatedWithinTheSameLane)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_bad", 0, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_good", 1, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_bad", faulting_program(), &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_good", counter_program(), &error)) << error;
    scheduler.tick(0);
    ASSERT_TRUE(scheduler.start("P_bad", &error)) << error;
    ASSERT_TRUE(scheduler.start("P_good", &error)) << error;

    scheduler.tick(1000 * kMs);
    EXPECT_EQ(scheduler.find_program("P_bad")->state, StProgramState::FAULTED);
    EXPECT_EQ(counter_of(scheduler, "P_good"), 1) << "cùng lane vẫn phải được cô lập";

    /* Và Program lành tiếp tục chạy ở các chu kỳ sau — cô lập một lần rồi kẹt
     * cũng là không cô lập. */
    scheduler.tick(2000 * kMs);
    EXPECT_EQ(counter_of(scheduler, "P_good"), 2);
    EXPECT_EQ(scheduler.find_program("P_bad")->state, StProgramState::FAULTED)
        << "Program fault không tự hồi phục";
}

/* Đường quét không cấp phát heap. Bộ đếm là `thread_local` nên phép đo này phủ
 * luồng gọi: phân lane, điều phối, trộn kết quả và — ở chế độ tuần tự — toàn bộ
 * thân lane. Worker chạy CHÍNH `run_lane` đó, nên phần thân đã được phủ. */
TEST(StProgramLanes, ScanPathDoesNotAllocate)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    for (int index = 0; index < 8; ++index) {
        const std::string id = "P_" + std::to_string(index);
        ASSERT_TRUE(scheduler.add_program("main", id, static_cast<uint16_t>(index), &error))
            << error;
        ASSERT_TRUE(scheduler.set_program_lane(id, static_cast<uint8_t>(index % 4), &error))
            << error;
        ASSERT_TRUE(scheduler.request_activation(id, counter_program(), &error)) << error;
    }
    scheduler.tick(0);
    for (int index = 0; index < 8; ++index)
        ASSERT_TRUE(scheduler.start("P_" + std::to_string(index), &error)) << error;

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        scheduler.tick(1000 * kMs);
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u) << "đường quét tuần tự không được cấp phát";

    scheduler.set_lane_mode(StLaneMode::PARALLEL);
    {
        allocation_probe::ScopedCounter counter;
        scheduler.tick(2000 * kMs);
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u) << "điều phối lane song song không được cấp phát";
    scheduler.set_lane_mode(StLaneMode::SEQUENTIAL);
}

/* Lane vượt số worker phải chạy nốt trên luồng gọi. Thiếu worker được phép làm
 * CHẬM, không được phép làm BỎ SÓT. */
TEST(StProgramLanes, LanesBeyondWorkerCountStillRun)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    scheduler.set_lane_mode(StLaneMode::PARALLEL);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    const std::size_t lanes = kMaxLanes;
    for (std::size_t index = 0; index < lanes; ++index) {
        const std::string id = "P_" + std::to_string(index);
        ASSERT_TRUE(scheduler.add_program("main", id, static_cast<uint16_t>(index), &error))
            << error;
        ASSERT_TRUE(scheduler.set_program_lane(id, static_cast<uint8_t>(index), &error)) << error;
        ASSERT_TRUE(scheduler.request_activation(id, counter_program(), &error)) << error;
    }
    scheduler.tick(0);
    for (std::size_t index = 0; index < lanes; ++index)
        ASSERT_TRUE(scheduler.start("P_" + std::to_string(index), &error)) << error;

    const StSchedulerTickResult result = scheduler.tick(1000 * kMs);
    EXPECT_EQ(result.programs_run, lanes);
    for (std::size_t index = 0; index < lanes; ++index)
        EXPECT_EQ(counter_of(scheduler, "P_" + std::to_string(index)), 1)
            << "lane " << index << " bị bỏ sót";
}

/* Lane vượt trần bị từ chối ở lớp cấu hình, không im lặng gộp về lane 0. */
TEST(StProgramLanes, RejectsLaneAboveLimit)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_0", 0, &error)) << error;
    EXPECT_FALSE(scheduler.set_program_lane("P_0", static_cast<uint8_t>(kMaxLanes), &error));
    EXPECT_NE(error.find("lane vượt trần"), std::string::npos) << error;
    EXPECT_FALSE(scheduler.set_program_lane("P_missing", 0, &error));
}

} // namespace core
