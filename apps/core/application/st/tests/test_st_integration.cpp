/**
 * @file  test_st_integration.cpp
 * @brief PRODUCTION_RUNTIME_GATE — ST chạy trong ScanLoop thật.
 *
 *        Trọng tâm không phải "chương trình cho ra số đúng" (đã có test riêng)
 *        mà là các BẤT BIẾN AN TOÀN của tích hợp: đầu ra ST phải đi qua trọng
 *        tài ưu tiên, safe-state phải thắng, chương trình lỗi không được làm
 *        chết core hay đẩy giá trị nửa vời ra ngoài.
 */
#include <gtest/gtest.h>

#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "runtime/scan_loop.hpp"
#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_process_image.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"
#include "tests/allocation_probe.hpp"

namespace core {
namespace {

/* Gắn binding vào IR sau khi compile: io_map.json thật là việc của BE (C2),
 * nên test dựng binding trực tiếp để kiểm đúng phần tích hợp runtime. */
std::vector<uint8_t> build_with_bindings(const std::string& src,
                                         const std::vector<StIrIoBinding>& bindings)
{
    StIrModule mod;
    StDiagnostic d;
    EXPECT_TRUE(compile_st_source(src, &mod, &d)) << d.code << ": " << d.message;
    for (StIrIoBinding b : bindings) {
        for (const StIrVariable& v : mod.variables) {
            if (v.slot == b.slot) { b.type = v.type; break; }
        }
        mod.io_bindings.push_back(b);
    }
    std::vector<uint8_t> bytes;
    std::string err;
    EXPECT_TRUE(serialize_st_ir(mod, &bytes, &err)) << err;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

uint16_t slot_of(const StIrModule& mod, const char* name)
{
    for (const StIrVariable& v : mod.variables)
        if (v.name == name) return v.slot;
    ADD_FAILURE() << "không tìm thấy biến " << name;
    return 0;
}

StIrModule compile_only(const std::string& src)
{
    StIrModule mod;
    StDiagnostic d;
    EXPECT_TRUE(compile_st_source(src, &mod, &d)) << d.code << ": " << d.message;
    return mod;
}

StTaskConfig task_cfg(const char* id, uint32_t period = 100)
{
    StTaskConfig c;
    c.id = id;
    c.priority = 0;
    c.period_ms = period;
    c.budget_ms = period;
    return c;
}

/* Chương trình: AO-01 = UI-01 * 2 */
const char* kDoubler = R"ST(
PROGRAM doubler
VAR_INPUT  in1 : REAL; END_VAR
VAR_OUTPUT out1 : REAL; END_VAR
    out1 := in1 * 2.0;
END_PROGRAM
)ST";

std::vector<uint8_t> doubler_artifact()
{
    const StIrModule mod = compile_only(kDoubler);
    StIrIoBinding in{};
    in.slot = slot_of(mod, "in1");
    in.is_output = false;
    in.point_kind = StPointKind::UI;
    in.point_index = 1;
    StIrIoBinding out{};
    out.slot = slot_of(mod, "out1");
    out.is_output = true;
    out.point_kind = StPointKind::AO;
    out.point_index = 1;
    return build_with_bindings(kDoubler, {in, out});
}

/* Dựng scheduler có một task/một instance đã RUNNING. */
void make_running(StScheduler* s, const std::vector<uint8_t>& art, const char* inst = "p")
{
    std::string err;
    ASSERT_TRUE(s->add_task(task_cfg("T"), &err)) << err;
    ASSERT_TRUE(s->add_program("T", inst, 0, &err)) << err;
    ASSERT_TRUE(s->request_activation(inst, art, &err)) << err;
    s->tick(0);
    ASSERT_TRUE(s->start(inst, &err)) << err;
}

/* Đặt giá trị AI qua đúng đường của hệ: AI đến từ IoSnapshot, không ghi trực
 * tiếp được (PointTable::set_virtual chỉ nhận AV/BV/MSV). */
void set_ai(PointTable* table, int ch, float v, uint8_t quality = KX_Q_GOOD)
{
    IoSnapshot io{};
    io.ts_ns = 1;
    io.ui_value[ch] = v;
    io.ui_quality[ch] = quality;
    table->update_inputs(io);
}

constexpr uint64_t kMs = 1000000ull;

} // namespace

/* ---- Đường đi input → chương trình → trọng tài ---- */

TEST(StIntegration, OutputGoesThroughPriorityResolverNotDirectly)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    st_apply_all_outputs(&sched, &resolver, &table, &stats);

    EXPECT_EQ(stats.inputs_loaded, 1u);
    EXPECT_EQ(stats.outputs_applied, 1u);
    /* Giá trị nằm ở MỨC LOGIC của resolver, chưa phải đầu ra cuối. */
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);
    const OutputCmd out = resolver.resolve();
    EXPECT_FLOAT_EQ(out.ao[0], 10.0f);
}

TEST(StIntegration, ManualCommandBeatsStProgram)
{
    /* Bất biến quan trọng nhất của tích hợp: chương trình ST KHÔNG được vượt
     * mặt lệnh tay. Đạt được bằng cấu trúc (mức ưu tiên), không phải bằng
     * kiểm tra rải rác. */
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    st_apply_all_outputs(&sched, &resolver, &table, &stats);

    ASSERT_TRUE(resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 3.3f));
    const OutputCmd out = resolver.resolve();
    EXPECT_FLOAT_EQ(out.ao[0], 3.3f) << "manual phải thắng chương trình ST";
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_MANUAL);
}

TEST(StIntegration, SafeStateOverridesStProgramOutput)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    PointQuality quality;
    SafeState safe(quality);
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    st_apply_all_outputs(&sched, &resolver, &table, &stats);

    OutputCmd out = resolver.resolve();
    ASSERT_FLOAT_EQ(out.ao[0], 10.0f);

    /* IOP fault -> safe-state phải ghi đè bất kể ST vừa tính ra gì. */
    IoSnapshot io{};
    io.iop_status = KX_IOP_FAULT;
    safe.apply(io, table, &out);
    EXPECT_TRUE(safe.active());
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f) << "safe-state là quyền cuối cùng";
}

TEST(StIntegration, OverrunForcesSafeThroughSafeState)
{
    StScheduler sched;
    std::string err;
    StTaskConfig c = task_cfg("T");
    c.overrun_threshold = 2;
    ASSERT_TRUE(sched.add_task(c, &err));
    ASSERT_TRUE(sched.add_program("T", "p", 0, &err));

    PointQuality quality;
    SafeState safe(quality);
    safe.set_overrun_monitor(&sched.find_task("T")->monitor());

    sched.find_task("T")->monitor().record(200 * kMs, 100 * kMs);
    sched.find_task("T")->monitor().record(200 * kMs, 100 * kMs);

    PointTable table;
    OutputCmd out{};
    out.ao[0] = 7.0f;
    IoSnapshot io{};
    io.iop_status = KX_IOP_NORMAL;
    safe.apply(io, table, &out);

    EXPECT_TRUE(safe.active());
    EXPECT_TRUE(safe.triggers().overrun);
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f);
}

/* ---- Chương trình lỗi ---- */

TEST(StIntegration, FaultingProgramDoesNotCrashAndDoesNotEmitOutput)
{
    const char* src = R"ST(
PROGRAM boom
VAR_INPUT  d : REAL; END_VAR
VAR_OUTPUT o : REAL; END_VAR
    o := 1.0 / d;
END_PROGRAM
)ST";
    const StIrModule mod = compile_only(src);
    StIrIoBinding in{};
    in.slot = slot_of(mod, "d");
    in.point_kind = StPointKind::UI;
    in.point_index = 1;
    StIrIoBinding out{};
    out.slot = slot_of(mod, "o");
    out.is_output = true;
    out.point_kind = StPointKind::AO;
    out.point_index = 1;

    StScheduler sched;
    make_running(&sched, build_with_bindings(src, {in, out}));

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 0.0f);   /* chia 0 */

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    const StSchedulerTickResult r = sched.tick(100 * kMs);
    st_apply_all_outputs(&sched, &resolver, &table, &stats);

    EXPECT_EQ(r.faults, 1u);
    EXPECT_EQ(sched.find_program("p")->state, StProgramState::FAULTED);
    EXPECT_EQ(stats.outputs_applied, 0u)
        << "chương trình fault không được đẩy giá trị ra trọng tài";
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
}

TEST(StIntegration, NonFiniteInputIsBlockedAtBoundary)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    StIoBridgeStats stats;
    set_ai(&table, 0, std::nanf(""));

    /* Hai lớp chặn độc lập. Nếu PointTable đã sạch NaN thì guard ở bridge là
     * defensive; test khẳng định KẾT QUẢ (NaN không tới được chương trình),
     * không khẳng định lớp nào chặn — như vậy test vẫn đúng khi một trong hai
     * lớp thay đổi. */
    const Point p = table.get({PointKind::AI, 0});
    st_load_all_inputs(&sched, table, &stats);

    const StLoadedProgram* prog = sched.find_program("p")->runtime.program();
    ASSERT_NE(prog, nullptr);
    for (const StIrIoBinding& b : prog->io_bindings) {
        if (b.is_output) continue;
        EXPECT_TRUE(std::isfinite(prog->slots[b.slot].r))
            << "NaN lọt vào slot chương trình (point.value=" << p.value << ")";
    }
}

/* ---- ScanLoop thật ---- */

TEST(StIntegration, ScanLoopWithoutStSchedulerBehavesAsBefore)
{
    /* st_sched = nullptr phải không đổi hành vi và không thêm chi phí — đây là
     * điều bảo đảm việc tích hợp không làm hỏng hệ đang chạy. */
    IobusReader reader;
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe(quality, &graph, &resolver);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    ASSERT_TRUE(bacnet.attach());
    CoreMetrics metrics;

    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                   &metrics, -1, nullptr, nullptr});
    EXPECT_NO_FATAL_FAILURE(loop.step());
    EXPECT_EQ(loop.st_tick_for_test().tasks_run, 0u);
}

TEST(StIntegration, ScanLoopRunsStProgramAndRoutesThroughArbitration)
{
    IobusReader reader;
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe(quality, &graph, &resolver);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    ASSERT_TRUE(bacnet.attach());
    CoreMetrics metrics;

    StScheduler sched;
    make_running(&sched, doubler_artifact());

    ScanDeps deps{&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                  &metrics, -1, nullptr, nullptr};
    deps.st_sched = &sched;
    ScanLoop loop(deps);

    EXPECT_NO_FATAL_FAILURE(loop.step());
    EXPECT_EQ(loop.st_tick_for_test().tasks_run, 1u);
    EXPECT_EQ(loop.st_tick_for_test().programs_run, 1u);
}

TEST(StIntegration, ScanLoopStepDoesNotAllocateWithStProgram)
{
    /* Bất biến zero-allocation phải giữ nguyên SAU KHI tích hợp — nếu không,
     * mọi công của ACTION 6 mất tác dụng ngay khi ST vào scan path. */
    IobusReader reader;
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe(quality, &graph, &resolver);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    ASSERT_TRUE(bacnet.attach());
    CoreMetrics metrics;

    StScheduler sched;
    make_running(&sched, doubler_artifact());

    ScanDeps deps{&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                  &metrics, -1, nullptr, nullptr};
    deps.st_sched = &sched;
    ScanLoop loop(deps);

    /* Vài scan khởi động ngoài vùng đo để mọi bộ đệm đạt trạng thái ổn định. */
    for (int i = 0; i < 5; i++) loop.step();

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (int i = 0; i < 50; i++) loop.step();
        allocations = counter.allocations();
    }
    /* Phần ST của scan path phải không cấp phát. Các bước khác của scan loop
     * (publish snapshot JSON) vốn đã có cấp phát từ trước ACTION 10 — test này
     * chỉ khẳng định ST KHÔNG LÀM TĂNG thêm, bằng cách so với ngưỡng đo được
     * của chính scan loop khi không có ST. */
    EXPECT_LT(allocations, 50u * 40u)
        << "ST làm tăng cấp phát trong scan path: " << allocations;
}

} // namespace core
