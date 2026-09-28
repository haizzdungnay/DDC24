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

#include "graph/point_table.hpp"
#include "graph/point_writer.hpp"
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
void build_scheduler(StScheduler* scheduler, uint32_t task_period_ms = 100)
{
    std::string error;
    StTaskConfig task;
    task.id = "T";
    task.period_ms = task_period_ms;
    task.budget_us = task_period_ms >= 100 ? 100000 : task_period_ms * 199;
    ASSERT_TRUE(scheduler->add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler->add_program("T", "instance-1", 0, &error)) << error;
    ASSERT_TRUE(scheduler->request_activation("instance-1", counter_program(), &error)) << error;
    /* Chỉ áp activation, KHÔNG tick: tick ở 0 đánh dấu Task đã chạy tại 0 và
     * boundary đầu của test (cũng ở 0) sẽ không còn là một lần release. */
    scheduler->apply_pending_activations_at_boundary();
    ASSERT_TRUE(scheduler->start("instance-1", &error)) << error;
}

/* Issue #798: ranh giới quét thật gọi `on_base_step` (Program chạy) rồi mới lấy
 * mẫu. Trace chỉ lấy mẫu ở boundary có Program được theo dõi vừa release, nên
 * test phải đi đúng thứ tự đó thay vì gọi `on_boundary` trên scheduler đứng im. */
void boundary(StScheduler& scheduler, StValueTrace& trace, uint64_t now_ns,
              const PointTable* table = nullptr)
{
    scheduler.on_base_step(now_ns);
    trace.on_boundary(scheduler, now_ns, table);
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
    for (uint64_t now = 0; now < 3000 * kMs; now += 10 * kMs) boundary(scheduler, trace, now);
    EXPECT_EQ(trace.sample_count(), 3u) << "3 s ở nhịp hiệu lực 1 s = 3 mẫu, không phải 300";
    EXPECT_TRUE(trace.stop("s1", &error)) << error;

    /* Task 10 ms chỉ có ở profile Rev A; Program chạy mỗi boundary nên mỗi
     * boundary là một release (Issue #798). */
    StScheduler fast(StSchedulerProfile::REV_A);
    build_scheduler(&fast, 10);
    fast.set_base_step_ns(10 * kMs);
    StValueTrace fast_trace;
    ASSERT_TRUE(fast_trace.start("s2", fast, &variable, 1, 10, 10000, 0, &error)) << error;
    EXPECT_EQ(fast_trace.status().effective_sample_period_ms, 10u);
    for (uint64_t now = 0; now < 100 * kMs; now += 10 * kMs) boundary(fast, fast_trace, now);
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

    boundary(scheduler, trace, 0);
    EXPECT_EQ(trace.sample_count(), 1u) << "mẫu đầu phải lấy ngay tại boundary kế";

    /* Boundary trong cùng chu kỳ không tạo thêm mẫu. */
    boundary(scheduler, trace, 500 * kMs);
    EXPECT_EQ(trace.sample_count(), 1u);

    boundary(scheduler, trace, 1000 * kMs);
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
    for (uint64_t tick = 0; tick <= 5; ++tick) boundary(scheduler, trace, tick * 1000 * kMs);
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
        boundary(scheduler, single, tick * 100 * kMs);
    /* Một biến: thời lượng chặn trước, KHÔNG chạm trần Ô. */
    EXPECT_EQ(single.sample_count(), kMaxTraceDurationMs / 100u);
    EXPECT_LT(single.sample_count(), kMaxTraceCells);
    EXPECT_EQ(single.dropped_count(), 0u);
    EXPECT_EQ(single.status().state, StTraceState::COMPLETED);

    std::array<StTraceVariable, kMaxTraceVariables> many{};
    for (std::size_t index = 0; index < kMaxTraceVariables; ++index)
        many[index] = variable_of("n");
    /* Scheduler mới: đồng hồ của cái cũ đã đi tới 10 phút. */
    StScheduler wide_scheduler;
    build_scheduler(&wide_scheduler);
    StValueTrace wide;
    ASSERT_TRUE(wide.start("s2", wide_scheduler, many.data(), many.size(), 100, kMaxTraceDurationMs, 0, &error))
        << error;
    for (uint64_t tick = 0; tick < 400; ++tick) boundary(wide_scheduler, wide, tick * 100 * kMs);
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
    for (uint64_t tick = 0; tick < slots + 5; ++tick) boundary(scheduler, trace, tick * 100 * kMs);
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
    boundary(scheduler, trace, 0);
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
        for (uint64_t tick = 0; tick < 200; ++tick) boundary(scheduler, trace, tick * 100 * kMs);
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
        boundary(scheduler, trace, 0);   /* phải trả về ngay, không treo */
        EXPECT_EQ(hold.sample_count(), 0u) << "boundary bị chặn không được ghi mẫu";
        EXPECT_EQ(hold.status().contended_boundary_count, 1u);
    }
    /* Boundary kế có release của Program (Task 100 ms) — Issue #798: mẫu chỉ
     * lấy ở boundary Program vừa chạy. */
    boundary(scheduler, trace, 100 * kMs);
    ASSERT_EQ(trace.sample_count(), 1u) << "mẫu tới hạn phải được lấy ở boundary kế";
    EXPECT_EQ(trace.sample(0).timestamp_ns, 100 * kMs) << "mốc là thời điểm lấy thật";
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
    boundary(scheduler, trace, 0);
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

/* ===================================================================
 * Issue #798 (U-04) — mẫu Trace nhất quán theo LẦN CHẠY Program và tách lệnh /
 * giá trị đọc lại (`SW-TRACE-RELEASE-COHERENT-MK-DDC-24-VI`).
 * =================================================================== */
namespace {

/* `y := x` — mẫu nhất quán khi và chỉ khi y == x trong cùng mẫu. */
std::vector<uint8_t> echo_program(const std::vector<StIrIoBinding>& bindings = {})
{
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(R"ST(
PROGRAM echo
VAR_INPUT x : INT; cmd : BOOL; END_VAR
VAR_OUTPUT y : INT; q : BOOL; END_VAR
    y := x;
    q := cmd;
END_PROGRAM
)ST", &module, &diagnostic)) << diagnostic.code << ": " << diagnostic.message;
    for (StIrIoBinding binding : bindings) {
        for (const StIrVariable& variable : module.variables)
            if (variable.name == (binding.slot == 0 ? "q" : "")) binding.slot = variable.slot;
        module.io_bindings.push_back(binding);
    }
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

/* Task 10 ms (Rev A), các instance cho sẵn chu kỳ Program riêng. */
void build_rev_a(StScheduler* scheduler,
                 const std::vector<std::pair<const char*, uint32_t>>& instances,
                 const std::vector<uint8_t>& artifact)
{
    std::string error;
    StTaskConfig task;
    task.id = "T";
    task.period_ms = 10;
    task.budget_us = 1999;
    ASSERT_TRUE(scheduler->add_task(task, &error)) << error;
    uint16_t order = 0;
    for (const auto& [id, period_ms] : instances) {
        ASSERT_TRUE(scheduler->add_program("T", id, order++, &error)) << error;
        ASSERT_TRUE(scheduler->request_activation(id, artifact, &error)) << error;
    }
    scheduler->apply_pending_activations_at_boundary();
    for (const auto& [id, period_ms] : instances) {
        scheduler->find_program(id)->period_ms = period_ms;
        ASSERT_TRUE(scheduler->start(id, &error)) << error;
    }
}

StTraceVariable traced(const char* instance, const char* name)
{
    StTraceVariable variable;
    variable.instance_id = instance;
    variable.variable_name = name;
    return variable;
}

/* Ranh giới quét như ScanLoop: nạp đầu vào cho mọi Program của Task đến hạn
 * (kể cả Program chưa tới lượt chạy — đúng nguồn lệch pha của U-04), chạy
 * Program đến hạn, rồi lấy mẫu. */
void scan(StScheduler& scheduler, StValueTrace& trace, uint64_t now_ns, int32_t x,
          const PointTable* table = nullptr)
{
    for (auto& task : scheduler.tasks())
        for (auto& program : task->programs())
            (void)program->runtime.set_variable("x", StValue::make_int(x));
    scheduler.on_base_step(now_ns);
    trace.on_boundary(scheduler, now_ns, table);
}

} // namespace

/* T-798-1: Program 100 ms trong Task 10 ms, đầu vào đổi ở MỌI boundary (giữa
 * hai release). Trước #798 mẫu 10 ms mang x mới cạnh y của lần chạy trước. Nay
 * mọi mẫu có cặp (x, y) của cùng một lần chạy, và mẫu chỉ có ở boundary release. */
TEST(StValueTrace, T798_1_EverySamplePairsInputAndOutputOfTheSameRelease)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    build_rev_a(&scheduler, {{"slow", 100}}, echo_program());
    std::array<StTraceVariable, 2> variables{traced("slow", "x"), traced("slow", "y")};
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, variables.data(), variables.size(), 10, 60000, 0, &error))
        << error;
    for (uint64_t step = 0; step < 300; ++step) scan(scheduler, trace, step * 10 * kMs, int32_t(step));

    ASSERT_EQ(trace.sample_count(), 30u) << "3 s ở Program 100 ms = 30 lần chạy = 30 mẫu";
    int incoherent = 0;
    for (std::size_t index = 0; index < trace.sample_count(); ++index) {
        const StTraceSample sample = trace.sample(index);
        ASSERT_TRUE(sample.valid[0] && sample.valid[1]);
        if (sample.values[0].i != sample.values[1].i) ++incoherent;
        EXPECT_EQ(sample.release_seq[0], sample.release_seq[1]);
        EXPECT_EQ(sample.timestamp_ns % (100 * kMs), 0u) << "mẫu phải nằm đúng boundary release";
    }
    EXPECT_EQ(incoherent, 0);
}

/* T-798-2: phiên trộn Program 10 ms và 100 ms. Ô của Program chưa release mang
 * NOT_RELEASED (không bịa giá trị cũ); ô của Program vừa chạy có giá trị. */
TEST(StValueTrace, T798_2_MixedPeriodSessionMarksCellsOfNotReleasedProgram)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    build_rev_a(&scheduler, {{"fast", 0}, {"slow", 100}}, echo_program());
    std::array<StTraceVariable, 2> variables{traced("fast", "y"), traced("slow", "y")};
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, variables.data(), variables.size(), 10, 60000, 0, &error))
        << error;
    for (uint64_t step = 0; step < 100; ++step) scan(scheduler, trace, step * 10 * kMs, int32_t(step + 1));

    ASSERT_EQ(trace.sample_count(), 100u) << "Program 10 ms chạy mỗi boundary";
    int slow_valid = 0;
    for (std::size_t index = 0; index < trace.sample_count(); ++index) {
        const StTraceSample sample = trace.sample(index);
        EXPECT_TRUE(sample.valid[0]);
        EXPECT_EQ(sample.reason[0], StTraceCellReason::OK);
        if (sample.valid[1]) {
            ++slow_valid;
            EXPECT_EQ(sample.values[1].i, sample.values[0].i) << "cùng boundary, cùng đầu vào";
        } else {
            EXPECT_EQ(sample.reason[1], StTraceCellReason::NOT_RELEASED);
            EXPECT_EQ(sample.values[1].i, 0) << "ô không release không được mang giá trị cũ";
        }
    }
    EXPECT_EQ(slow_valid, 10);
}

/* T-798-3: số release liên tiếp khi mọi lần chạy đều được lấy mẫu; khi boundary
 * bị luồng IPC chặn thì khoảng trống HIỆN RA ở số release (cách nhau 2), không
 * lặng lẽ. Biến không phân giải được mang UNRESOLVED, số release 0. */
TEST(StValueTrace, T798_3_ReleaseSequenceIsContiguousAndGapsAreVisible)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    build_rev_a(&scheduler, {{"slow", 100}}, echo_program());
    std::array<StTraceVariable, 2> variables{traced("slow", "y"), traced("slow", "khong_co")};
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, variables.data(), variables.size(), 10, 60000, 0, &error))
        << error;
    for (uint64_t step = 0; step < 50; ++step) {
        if (step == 20) {
            /* Boundary 200 ms là một release — bị chặn thì mất đúng lần đó. */
            StValueTrace::ConsistentRead hold(trace);
            scan(scheduler, trace, step * 10 * kMs, int32_t(step));
            continue;
        }
        scan(scheduler, trace, step * 10 * kMs, int32_t(step));
    }
    ASSERT_EQ(trace.sample_count(), 4u) << "release 0/100/200/300/400 ms trừ lần 200 ms bị chặn";
    std::vector<uint64_t> seq;
    for (std::size_t index = 0; index < trace.sample_count(); ++index) {
        const StTraceSample sample = trace.sample(index);
        seq.push_back(sample.release_seq[0]);
        EXPECT_EQ(sample.reason[1], StTraceCellReason::UNRESOLVED);
        EXPECT_EQ(sample.release_seq[1], 0u);
    }
    /* Mẫu hoãn từ 200 ms được lấy ở release kế (300 ms); release 200 ms mất. */
    EXPECT_EQ(seq, (std::vector<uint64_t>{1, 2, 4, 5}));
}

/* T-798-4 (phần Core): biến gắn điểm đầu ra có số ĐỌC LẠI từ bảng điểm, khác
 * lệnh khi thiết bị chưa theo kịp, kèm tuổi tăng giữa hai lần cập nhật điểm.
 * Biến không gắn điểm đầu ra không có kênh đọc lại (NONE), không chép lệnh. */
TEST(StValueTrace, T798_4_OutputBoundVariableCarriesReadbackDistinctFromCommand)
{
    StIrIoBinding output{};
    output.slot = 0;   /* echo_program điền slot của `q` */
    output.is_output = true;
    output.point_kind = StPointKind::DO;
    output.point_index = 1;
    output.type = StType::BOOL;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    build_rev_a(&scheduler, {{"relay", 0}}, echo_program({output}));
    PointTable table;
    IoSnapshot io{};
    io.ts_ns = 5 * kMs;
    io.do_feedback[0] = 0;   /* relay chưa đổi */
    table.update_inputs(io);

    std::array<StTraceVariable, 2> variables{traced("relay", "q"), traced("relay", "y")};
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, variables.data(), variables.size(), 10, 60000, 0, &error))
        << error;
    (void)scheduler.find_program("relay")->runtime.set_variable("cmd", StValue::make_bool(true));
    scan(scheduler, trace, 10 * kMs, 1, &table);
    scan(scheduler, trace, 30 * kMs, 1, &table);
    ASSERT_EQ(trace.sample_count(), 2u);
    const StTraceSample first = trace.sample(0);
    EXPECT_TRUE(first.valid[0]);
    EXPECT_TRUE(first.values[0].b) << "lệnh Program: đóng";
    ASSERT_EQ(first.readback_state[0], StTraceReadback::VALID);
    EXPECT_FALSE(first.readback[0].b) << "đọc lại: relay chưa đóng — khác lệnh";
    EXPECT_EQ(first.readback_age_ms[0], 5u);
    EXPECT_EQ(trace.sample(1).readback_age_ms[0], 25u) << "tuổi tăng khi điểm chưa cập nhật";
    EXPECT_EQ(first.readback_state[1], StTraceReadback::NONE) << "y không gắn điểm đầu ra";

    io.ts_ns = 40 * kMs;
    io.do_feedback[0] = 1;
    table.update_inputs(io);
    scan(scheduler, trace, 40 * kMs, 1, &table);
    const StTraceSample caught_up = trace.sample(2);
    EXPECT_TRUE(caught_up.readback[0].b);
    EXPECT_EQ(caught_up.readback_age_ms[0], 0u);

    /* Không có bảng điểm (đường không có phần cứng): gắn điểm nhưng KHÔNG có số. */
    scan(scheduler, trace, 50 * kMs, 1, nullptr);
    EXPECT_EQ(trace.sample(3).readback_state[0], StTraceReadback::UNAVAILABLE);
}

/* T-798-4 trên bo (EV-PROG-TRACE-798-TARGET): với DO Modbus, bước xuất lệnh
 * của chính chu kỳ đó ghi lệnh vào ô EXT của PointTable qua
 * `PointWriter::write` → `set_virtual` (ts = lúc ghi). Bản đầu của #798 đọc
 * `get()` nên mọi ô báo "đọc lại" = lệnh, tuổi 0 ms. Test đi đúng thứ tự của
 * ScanLoop: `update_ext` (mẫu poll) → Program chạy → ghi lệnh → lấy mẫu Trace. */
TEST(StValueTrace, T798_4_ModbusReadbackIsThePolledCoilNotTheCommandJustWritten)
{
    StIrIoBinding output{};
    output.slot = 0;   /* echo_program điền slot của `q` */
    output.is_output = true;
    output.point_kind = StPointKind::EXT;
    output.point_index = 1;
    output.type = StType::BOOL;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    build_rev_a(&scheduler, {{"relay", 0}}, echo_program({output}));

    PointTable table;
    kx_plc_shm_t shm{};
    shm.ext_count = 1;
    shm.ext[0].writable = 1;
    shm.ext[0].quality = KX_EXTQ_GOOD;
    shm.ext[0].value = 0.0;                    /* coil còn mở */
    shm.ext[0].sample_mono_ns = 5 * kMs;       /* lần poll FC01 gần nhất */
    const PointId coil{PointKind::EXT, 0};

    const StTraceVariable variable = traced("relay", "q");
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 10, 60000, 0, &error)) << error;
    (void)scheduler.find_program("relay")->runtime.set_variable("cmd", StValue::make_bool(true));

    auto cycle = [&](uint64_t now_ns) {
        table.update_ext(shm.ext, shm.ext_count);
        scheduler.on_base_step(now_ns);
        PointWriter writer(table, &shm);
        ASSERT_TRUE(writer.write(coil, 1.0f, PointSource::PROGRAM));
        trace.on_boundary(scheduler, now_ns, &table);
    };
    cycle(10 * kMs);
    ASSERT_EQ(table.get(coil).value, 1.0f) << "tiền đề: lệnh đã ghi đè ô EXT như trên bo";
    const StTraceSample first = trace.sample(0);
    EXPECT_TRUE(first.values[0].b) << "lệnh: đóng";
    ASSERT_EQ(first.readback_state[0], StTraceReadback::VALID);
    EXPECT_FALSE(first.readback[0].b) << "đọc lại là coil poll (còn mở), không phải lệnh vừa ghi";
    EXPECT_EQ(first.readback_age_ms[0], 5u) << "tuổi tính từ mốc poll, không phải lúc ghi lệnh";

    cycle(30 * kMs);
    EXPECT_FALSE(trace.sample(1).readback[0].b);
    EXPECT_EQ(trace.sample(1).readback_age_ms[0], 25u) << "tuổi tăng giữa hai lần poll";

    shm.ext[0].value = 1.0;                    /* poll kế thấy coil đã đóng */
    shm.ext[0].sample_mono_ns = 40 * kMs;
    cycle(40 * kMs);
    EXPECT_TRUE(trace.sample(2).readback[0].b);
    EXPECT_EQ(trace.sample(2).readback_age_ms[0], 0u) << "tuổi về 0 ở lần poll mới";
}

/* Đầu ra gắn điểm ảo (AV/BV/MSV) không có kênh đọc lại từ thiết bị: giá trị
 * trong bảng là chính lệnh vừa ghi, nên ô phải là UNAVAILABLE (BE trả null), không
 * phải "đọc lại" bằng lệnh (SW-TRACE-RELEASE-COHERENT §4). */
TEST(StValueTrace, T798_4_VirtualPointOutputHasNoReadback)
{
    StIrIoBinding output{};
    output.slot = 0;
    output.is_output = true;
    output.point_kind = StPointKind::BV;
    output.point_index = 1;
    output.type = StType::BOOL;
    StScheduler scheduler(StSchedulerProfile::REV_A);
    build_rev_a(&scheduler, {{"status", 0}}, echo_program({output}));
    PointTable table;
    const StTraceVariable variable = traced("status", "q");
    StValueTrace trace;
    std::string error;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 10, 60000, 0, &error)) << error;
    (void)scheduler.find_program("status")->runtime.set_variable("cmd", StValue::make_bool(true));
    scheduler.on_base_step(10 * kMs);
    ASSERT_TRUE(table.set_virtual({PointKind::BV, 0}, 1.0f, PointSource::PROGRAM));
    trace.on_boundary(scheduler, 10 * kMs, &table);
    ASSERT_EQ(trace.sample_count(), 1u);
    EXPECT_TRUE(trace.sample(0).values[0].b);
    EXPECT_EQ(trace.sample(0).readback_state[0], StTraceReadback::UNAVAILABLE);
}

/* Program không còn được dispatch (STOPPED) thì không chờ release mãi: mẫu vẫn
 * lấy, ô mang NOT_RELEASED. */
TEST(StValueTrace, StoppedProgramDoesNotFreezeTheSession)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    build_rev_a(&scheduler, {{"slow", 100}}, echo_program());
    std::string error;
    ASSERT_TRUE(scheduler.stop("slow", &error)) << error;
    const StTraceVariable variable = traced("slow", "y");
    StValueTrace trace;
    ASSERT_TRUE(trace.start("s1", scheduler, &variable, 1, 10, 60000, 0, &error)) << error;
    for (uint64_t step = 0; step < 5; ++step) scan(scheduler, trace, step * 10 * kMs, 1);
    ASSERT_EQ(trace.sample_count(), 5u);
    EXPECT_EQ(trace.sample(0).reason[0], StTraceCellReason::NOT_RELEASED);
}

} // namespace core
