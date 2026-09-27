/**
 * @file  test_st_value_trace.cpp
 * @brief T59-408 — trace giá trị bounded lấy tại ranh giới quét.
 */
#include <gtest/gtest.h>

#include <array>
#include <atomic>
#include <string>
#include <thread>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"
#include "st/st_value_trace.hpp"
#include "tests/allocation_probe.hpp"

namespace core {
namespace {

constexpr uint64_t kMs = 1000000ull;

std::vector<uint8_t> counter_program()
{
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(R"ST(
PROGRAM counter
VAR_OUTPUT n : INT; END_VAR
    n := n + 1;
END_PROGRAM
)ST", &module, &diagnostic)) << diagnostic.code << ": " << diagnostic.message;
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

/* Scheduler một Program đang chạy, để trace có thứ thật để đọc. */
void build_scheduler(StScheduler* scheduler)
{
    std::string error;
    StTaskConfig task;
    task.id = "T";
    task.period_ms = 100;
    task.budget_us = 100000;
    ASSERT_TRUE(scheduler->add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler->add_program("T", "instance-1", 0, &error)) << error;
    ASSERT_TRUE(scheduler->request_activation("instance-1", counter_program(), &error)) << error;
    scheduler->tick(0);
    ASSERT_TRUE(scheduler->start("instance-1", &error)) << error;
}

StTraceVariable variable_of(const char* name = "n")
{
    StTraceVariable variable;
    variable.instance_id = "instance-1";
    variable.variable_name = name;
    return variable;
}

} // namespace

/* Tham số ngoài dải bị chặn ở lớp `start`, không đẩy xuống vòng lấy mẫu. */
TEST(StValueTrace, RejectsOutOfRangeParameters)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    StValueTrace trace;
    const StTraceVariable variable = variable_of("n");
    std::string error;
    EXPECT_FALSE(trace.start("", scheduler, &variable, 1, 1000, 10000, 0, &error));
    EXPECT_FALSE(trace.start("s1", scheduler, nullptr, 0, 1000, 10000, 0, &error));
    /* ADR-061 4.6: dải yêu cầu 10..50000 ms. */
    EXPECT_FALSE(trace.start("s1", scheduler, &variable, 1, 9, 10000, 0, &error));
    EXPECT_FALSE(trace.start("s1", scheduler, &variable, 1, 50001, 10000, 0, &error));
    EXPECT_FALSE(trace.start("s1", scheduler, &variable, 1, 1000, 0, 0, &error));
    EXPECT_FALSE(trace.start("s1", scheduler, &variable, 1, 1000, kMaxTraceDurationMs + 1, 0, &error));
    EXPECT_EQ(trace.status().state, StTraceState::IDLE);

    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 1000, 10000, 0, &error)) << error;
    /* Phiên thứ hai bị từ chối: nhận nó sẽ hoặc âm thầm huỷ phiên đang chạy của
     * người khác, hoặc nhân ngân sách RAM lên. */
    EXPECT_FALSE(trace.start("s2", scheduler, &variable, 1, 1000, 10000, 0, &error));
    /* Dừng nhầm phiên của người khác cũng bị từ chối. */
    EXPECT_FALSE(trace.stop("s2", &error));
    EXPECT_TRUE(trace.stop("s1", &error)) << error;
}

/* ADR-061 4.6 — chu kỳ lấy mẫu HIỆU LỰC = max(yêu cầu, base step). Mẫu chỉ lấy
 * được ở ranh giới quét: hứa 10 ms trên base step 1 s là hứa suông. */
TEST(StValueTrace, EffectiveSamplePeriodIsNeverFasterThanBaseStep)
{
    EXPECT_EQ(st_trace_effective_sample_period_ms(10, 10 * kMs), 10u);
    EXPECT_EQ(st_trace_effective_sample_period_ms(10, 1000 * kMs), 1000u);
    EXPECT_EQ(st_trace_effective_sample_period_ms(5000, 10 * kMs), 5000u);
    /* Base step lẻ làm tròn LÊN: 10,5 ms không lấy mẫu được mỗi 10 ms. */
    EXPECT_EQ(st_trace_effective_sample_period_ms(10, 10500000ull), 11u);
    EXPECT_EQ(st_trace_effective_sample_period_ms(10, 0), 10u);

    StScheduler scheduler;
    build_scheduler(&scheduler);
    scheduler.set_base_step_ns(1000 * kMs);
    StValueTrace trace;
    const StTraceVariable variable = variable_of("n");
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 10, 10000, 0, &error)) << error;
    EXPECT_EQ(trace.status().requested_sample_period_ms, 10u);
    EXPECT_EQ(trace.status().effective_sample_period_ms, 1000u);
    for (uint64_t now = 0; now < 3000 * kMs; now += 10 * kMs) trace.on_boundary(scheduler, now);
    EXPECT_EQ(trace.sample_count(), 3u) << "3 s ở nhịp hiệu lực 1 s = 3 mẫu, không phải 300";
    EXPECT_TRUE(trace.stop("s1", &error)) << error;

    StScheduler fast;
    build_scheduler(&fast);
    fast.set_base_step_ns(10 * kMs);
    StValueTrace fast_trace;
    ASSERT_TRUE(fast_trace.start("s2", fast, &variable, 1, 10, 10000, 0, &error)) << error;
    EXPECT_EQ(fast_trace.status().effective_sample_period_ms, 10u);
    for (uint64_t now = 0; now < 100 * kMs; now += 10 * kMs) fast_trace.on_boundary(fast, now);
    EXPECT_EQ(fast_trace.sample_count(), 10u);
}

/* Lấy mẫu tại boundary, đúng chu kỳ, và mẫu đầu tiên lấy NGAY — người chẩn đoán
 * cần thấy trạng thái lúc bấm nút, không phải một chu kỳ sau đó. */
TEST(StValueTrace, SamplesAtBoundaryOnDeclaredPeriod)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    StValueTrace trace;
    const StTraceVariable variable = variable_of("n");
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 1000, 10000, 0, &error)) << error;

    trace.on_boundary(scheduler, 0);
    EXPECT_EQ(trace.sample_count(), 1u) << "mẫu đầu phải lấy ngay tại boundary kế";

    /* Boundary trong cùng chu kỳ không tạo thêm mẫu. */
    trace.on_boundary(scheduler, 500 * kMs);
    EXPECT_EQ(trace.sample_count(), 1u);

    trace.on_boundary(scheduler, 1000 * kMs);
    EXPECT_EQ(trace.sample_count(), 2u);
    EXPECT_EQ(trace.sample(1).timestamp_ns, 1000 * kMs);
    EXPECT_TRUE(trace.sample(1).valid[0]);
}

/* Hết thời lượng thì tự COMPLETED, không chạy mãi. */
TEST(StValueTrace, CompletesWhenDurationElapses)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    StValueTrace trace;
    const StTraceVariable variable = variable_of("n");
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 1000, 3000, 0, &error)) << error;
    for (uint64_t tick = 0; tick <= 5; ++tick) trace.on_boundary(scheduler, tick * 1000 * kMs);
    EXPECT_EQ(trace.status().state, StTraceState::COMPLETED);
    EXPECT_EQ(trace.sample_count(), 3u) << "0/1000/2000 ms; 3000 ms là hết hạn";
}

/* HAI trần cùng tồn tại và trần nào chặt hơn thì thắng — biết rõ điều này là
 * điều kiện để đọc đúng một đồ thị bị cắt cụt.
 *
 *  - Thời lượng: 10 phút ở chu kỳ 100 ms = 6.000 mẫu, chưa chạm trần Ô.
 *  - Ngân sách Ô: 32 biến chỉ được 10.000/32 = 312 mẫu, chạm trần Ô rất sớm.
 *
 * Ngân sách BỘ NHỚ thì không phụ thuộc số biến — đó là điều làm cho con số RAM
 * tĩnh nói ra được. */
TEST(StValueTrace, DurationAndCellBudgetAreTwoSeparateCaps)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);

    StValueTrace single;
    const StTraceVariable one = variable_of("n");
    std::string error;
    ASSERT_TRUE(single.start("s1", scheduler, &one, 1, 100, kMaxTraceDurationMs, 0, &error)) << error;
    for (uint64_t tick = 0; tick < kMaxTraceCells + 10; ++tick)
        single.on_boundary(scheduler, tick * 100 * kMs);
    /* Một biến: thời lượng chặn trước, KHÔNG chạm trần Ô. */
    EXPECT_EQ(single.sample_count(), kMaxTraceDurationMs / 100u);
    EXPECT_LT(single.sample_count(), kMaxTraceCells);
    EXPECT_EQ(single.dropped_count(), 0u);
    EXPECT_EQ(single.status().state, StTraceState::COMPLETED);

    std::array<StTraceVariable, kMaxTraceVariables> many{};
    for (std::size_t index = 0; index < kMaxTraceVariables; ++index)
        many[index] = variable_of("n");
    StValueTrace wide;
    ASSERT_TRUE(wide.start("s2", scheduler, many.data(), many.size(), 100, kMaxTraceDurationMs, 0, &error))
        << error;
    for (uint64_t tick = 0; tick < 400; ++tick) wide.on_boundary(scheduler, tick * 100 * kMs);
    /* 32 biến: trần Ô chặn trước, và số mẫu rơi được ĐẾM. */
    EXPECT_EQ(wide.sample_count(), kMaxTraceCells / kMaxTraceVariables);
    EXPECT_GT(wide.dropped_count(), 0u);
}

/* Hết chỗ thì ghi đè mẫu cũ nhất và ĐẾM số rơi. Giấu con số đó sẽ làm người đọc
 * đồ thị tưởng mình thấy toàn bộ. */
TEST(StValueTrace, OverflowDropsOldestAndCountsThem)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    std::array<StTraceVariable, kMaxTraceVariables> many{};
    for (std::size_t index = 0; index < kMaxTraceVariables; ++index)
        many[index] = variable_of("n");
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, many.data(), many.size(), 100, kMaxTraceDurationMs, 0, &error))
        << error;
    const std::size_t slots = kMaxTraceCells / kMaxTraceVariables;
    for (uint64_t tick = 0; tick < slots + 5; ++tick) trace.on_boundary(scheduler, tick * 100 * kMs);
    EXPECT_EQ(trace.sample_count(), slots);
    EXPECT_EQ(trace.dropped_count(), 5u);
    /* Mẫu 0 là mẫu CŨ NHẤT CÒN GIỮ, không phải mẫu đầu tiên từng lấy. */
    EXPECT_EQ(trace.sample(0).timestamp_ns, 5ull * 100 * kMs);
}

/* Biến không đọc được phải đánh dấu `valid=false`, không bịa số 0: "không đo
 * được" và "đo được giá trị 0" là hai sự thật khác nhau. */
TEST(StValueTrace, UnreadableVariableIsMarkedNotZeroed)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    std::array<StTraceVariable, 2> variables{};
    variables[0] = variable_of("n");
    variables[1] = variable_of("khong_ton_tai");
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, variables.data(), variables.size(), 1000, 10000, 0, &error))
        << error;
    trace.on_boundary(scheduler, 0);
    const StTraceSample sample = trace.sample(0);
    EXPECT_TRUE(sample.valid[0]);
    EXPECT_FALSE(sample.valid[1]) << "biến không đọc được bị trình bày như một giá trị thật";
}

/* Vòng lấy mẫu nằm trong đường quét: không cấp phát. */
TEST(StValueTrace, SamplingDoesNotAllocate)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    std::array<StTraceVariable, 8> variables{};
    for (std::size_t index = 0; index < variables.size(); ++index)
        variables[index] = variable_of("n");
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, variables.data(), variables.size(), 100, 600000, 0, &error))
        << error;

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (uint64_t tick = 0; tick < 200; ++tick) trace.on_boundary(scheduler, tick * 100 * kMs);
        allocations = counter.allocations();
    }
    EXPECT_EQ(allocations, 0u);
}


/* ===================================================================
 * F05 còn mở / ADR-061 4.10 bước 2 (X19) — trace có HAI luồng chạm vào: luồng
 * IPC Programming (start/stop/đọc) và luồng quét (on_boundary).
 * =================================================================== */

/* Luồng quét KHÔNG bao giờ chờ: khi luồng IPC đang giữ trace, boundary bỏ lượt,
 * đếm lại, và mẫu tới hạn được lấy ở boundary kế với mốc thời gian THẬT của nó. */
TEST(StValueTrace, BoundaryNeverWaitsForReaderAndDefersTheDueSample)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    StValueTrace trace;
    const StTraceVariable variable = variable_of("n");
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 1000, 10000, 0, &error)) << error;

    {
        StValueTrace::ConsistentRead hold(trace);
        trace.on_boundary(scheduler, 0);   /* phải trả về ngay, không treo */
        EXPECT_EQ(hold.sample_count(), 0u) << "boundary bị chặn không được ghi mẫu";
        EXPECT_EQ(hold.status().contended_boundary_count, 1u);
    }
    trace.on_boundary(scheduler, 10 * kMs);
    ASSERT_EQ(trace.sample_count(), 1u) << "mẫu tới hạn phải được lấy ở boundary kế";
    EXPECT_EQ(trace.sample(0).timestamp_ns, 10 * kMs) << "mốc là thời điểm lấy thật";
    EXPECT_TRUE(trace.sample(0).valid[0]);
    EXPECT_EQ(trace.status().contended_boundary_count, 1u);
}

/* Tên → slot phân giải trên LUỒNG QUÉT ở boundary đầu tiên sau `start()`: luồng
 * IPC không đọc cấu trúc Program đang chạy (activation cũng đổi nó ở boundary). */
TEST(StValueTrace, NameResolutionHappensAtTheScanBoundary)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    StValueTrace trace;
    const StTraceVariable variable = variable_of("n");
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 1000, 10000, 0, &error)) << error;
    EXPECT_FALSE(trace.variable(0).resolved) << "start() không được tự phân giải trên luồng gọi";
    trace.on_boundary(scheduler, 0);
    EXPECT_TRUE(trace.variable(0).resolved);
    EXPECT_TRUE(trace.sample(0).valid[0]);
}

/* Hai luồng thật cùng chạy: luồng "quét" gọi on_boundary liên tục, luồng "IPC"
 * start/đọc/stop liên tục. Chạy dưới ThreadSanitizer thì bất kỳ truy cập không
 * đồng bộ nào cũng thành lỗi; ở build thường test khoá tính nhất quán của mỗi
 * lần đọc (mốc thời gian tăng dần, số mẫu không vượt trần). */
TEST(StValueTrace, ConcurrentIpcReaderAndScanBoundaryStayConsistent)
{
    StScheduler scheduler;
    build_scheduler(&scheduler);
    scheduler.set_base_step_ns(10 * kMs);
    StValueTrace trace;
    std::atomic<bool> stop{false};
    std::thread scan([&] {
        uint64_t now = 0;
        while (!stop.load(std::memory_order_acquire)) {
            trace.on_boundary(scheduler, now);
            now += 10 * kMs;
        }
    });
    std::array<StTraceVariable, 4> variables{};
    for (auto& variable : variables) variable = variable_of("n");
    std::string error;
    for (int session = 0; session < 200; ++session) {
        const std::string id = "s" + std::to_string(session);
        (void)trace.start(id, scheduler, variables.data(), variables.size(), 10, 600000, 0, &error);
        for (int read = 0; read < 5; ++read) {
            StValueTrace::ConsistentRead view(trace);
            const std::size_t count = view.sample_count();
            EXPECT_LE(count, kMaxTraceCells / variables.size());
            uint64_t previous = 0;
            for (std::size_t index = 0; index < count; ++index) {
                const StTraceSample sample = view.sample(index);
                EXPECT_GE(sample.timestamp_ns, previous) << "mẫu đọc ra không theo thứ tự";
                previous = sample.timestamp_ns;
            }
        }
        (void)trace.status();
        (void)trace.sample_count();
        (void)trace.stop(id, &error);
    }
    stop.store(true, std::memory_order_release);
    scan.join();
    EXPECT_NE(trace.status().state, StTraceState::RUNNING);
}

} // namespace core
