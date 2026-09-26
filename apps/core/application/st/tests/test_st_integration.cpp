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
#include <chrono>
#include <cstring>
#include <string>
#include <thread>
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
    /* T59-205: harness conformance của ngôn ngữ và runtime, gồm cả PID — xem
     * chú thích ở test_st_exec.cpp. Đường production giữ mặc định BẬT. */
    StCompileOptions options;
    options.enforce_review_gate = false;
    EXPECT_TRUE(compile_st_source(src, &mod, &d, options)) << d.code << ": " << d.message;
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
    /* T59-205: xem chú thích ở `build` phía trên — harness conformance. */
    StCompileOptions options;
    options.enforce_review_gate = false;
    EXPECT_TRUE(compile_st_source(src, &mod, &d, options)) << d.code << ": " << d.message;
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

void set_two_ai(PointTable* table, float first, uint8_t first_quality,
                float second, uint8_t second_quality, uint64_t timestamp)
{
    IoSnapshot io{};
    io.ts_ns = timestamp;
    io.ui_value[0] = first;
    io.ui_quality[0] = first_quality;
    io.ui_value[1] = second;
    io.ui_quality[1] = second_quality;
    table->update_inputs(io);
}

void attach_valid_iobus(IobusReader* reader, kx_io_shm_t* shm, float ui0 = 2.0f)
{
    std::memset(shm, 0, sizeof(*shm));
    shm->magic = KX_SHM_MAGIC;
    shm->iop_status = KX_IOP_NORMAL;
    shm->ts_ns = 1;
    shm->ui_value[0] = ui0;
    shm->ui_quality[0] = KX_Q_GOOD;
    reader->attach_external(shm);
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

TEST(StIntegration, AhuSupplyFanSampleRefreshesMappedOutputsEveryCycle)
{
    const char* source = R"ST(
PROGRAM AHU_SupplyFan_Sample
VAR_INPUT
    SupplyVoltage : REAL;
    SupplyCurrent : REAL;
END_VAR
VAR_OUTPUT
    FanCommand : BOOL;
    FanSpeedVoltage : REAL;
END_VAR

FanCommand := (SupplyVoltage > 2.0) AND (SupplyCurrent > 4.0);
IF FanCommand THEN
    FanSpeedVoltage := LIMIT(0.0, SupplyVoltage, 10.0);
ELSE
    FanSpeedVoltage := 0.0;
END_IF;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding supply_voltage{};
    supply_voltage.slot = slot_of(module, "SupplyVoltage");
    supply_voltage.point_kind = StPointKind::UI;
    supply_voltage.point_index = 1;
    StIrIoBinding supply_current{};
    supply_current.slot = slot_of(module, "SupplyCurrent");
    supply_current.point_kind = StPointKind::UI;
    supply_current.point_index = 5;
    StIrIoBinding fan_command{};
    fan_command.slot = slot_of(module, "FanCommand");
    fan_command.is_output = true;
    fan_command.point_kind = StPointKind::DO;
    fan_command.point_index = 1;
    StIrIoBinding fan_speed_voltage{};
    fan_speed_voltage.slot = slot_of(module, "FanSpeedVoltage");
    fan_speed_voltage.is_output = true;
    fan_speed_voltage.point_kind = StPointKind::AO;
    fan_speed_voltage.point_index = 1;

    StScheduler scheduler;
    std::string error;
    ASSERT_TRUE(scheduler.add_task(task_cfg("main", 1000), &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "program-main", 0, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation(
        "program-main",
        build_with_bindings(source, {supply_voltage, supply_current,
                                     fan_command, fan_speed_voltage}),
        &error)) << error;
    scheduler.tick(0);
    ASSERT_TRUE(scheduler.start("program-main", &error)) << error;

    PointTable table;
    PriorityResolver resolver;
    const auto run_cycle = [&](uint64_t now_ms, float voltage, float current) {
        IoSnapshot io{};
        io.ts_ns = now_ms * kMs;
        io.ui_value[0] = voltage;
        io.ui_quality[0] = KX_Q_GOOD;
        io.ui_value[4] = current;
        io.ui_quality[4] = KX_Q_GOOD;
        table.update_inputs(io);

        StIoBridgeStats stats{};
        EXPECT_TRUE(st_capture_due_inputs(&scheduler, table, now_ms * kMs, &stats));
        EXPECT_EQ(scheduler.tick(now_ms * kMs).programs_run, 1u);
        EXPECT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
        EXPECT_EQ(stats.output_commit_generation, scheduler.base_step_count());
        return resolver.resolve();
    };

    OutputCmd output = run_cycle(1000, 6.0f, 5.0f);
    EXPECT_EQ(output.dout[0], 1u);
    EXPECT_FLOAT_EQ(output.ao[0], 6.0f);

    output = run_cycle(2000, 7.0f, 0.5f);
    EXPECT_EQ(output.dout[0], 0u);
    EXPECT_FLOAT_EQ(output.ao[0], 0.0f);

    output = run_cycle(3000, 8.0f, 5.0f);
    EXPECT_EQ(output.dout[0], 1u);
    EXPECT_FLOAT_EQ(output.ao[0], 8.0f);
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

/* ---- Hold-last + rút proposal an toàn (TASK-PROG-401, DDD-CTRL-PROG-001 §6) ---- */

TEST(StIntegration, HoldLastKeepsPreviousProposalIndefinitelyWhenTtlDisabled)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    ASSERT_TRUE(st_apply_all_outputs(&sched, &resolver, &table, &stats));
    ASSERT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);
    ASSERT_FLOAT_EQ(resolver.resolve().ao[0], 10.0f);

    /* Không load input lại trước tick kế -> input_snapshot_generation lệch
     * base_step_count_ -> FAULTED (không phải chạy thành công rồi mới lỗi). */
    sched.tick(200 * kMs);
    ASSERT_EQ(sched.find_program("p")->state, StProgramState::FAULTED);
    st_apply_all_outputs(&sched, &resolver, &table, &stats);

    /* `hold_ttl_ns = 0` TẮT HẲN TTL -> giữ vô hạn. Sau ADR-051 đây chỉ còn là
     * affordance chẩn đoán: đường sản phẩm luôn mang TTL đã ký, xem
     * T59_406_ScanDepsDefaultIsSignedTtlNotUnlimitedHold. */
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, 0, &stats), 0u);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC)
        << "TTL tắt thì hold-last phải giữ proposal cũ";
    EXPECT_FLOAT_EQ(resolver.resolve().ao[0], 10.0f);
}

TEST(StIntegration, HoldLastWithdrawsExactlyWhenTtlElapsesAfterFault)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);   /* publish thành công tại t=100 ms */
    ASSERT_TRUE(st_apply_all_outputs(&sched, &resolver, &table, &stats));
    ASSERT_EQ(sched.find_program("p")->output_commit_now_ns, 100 * kMs);

    sched.tick(200 * kMs);   /* FAULTED (input snapshot cũ) */
    ASSERT_EQ(sched.find_program("p")->state, StProgramState::FAULTED);
    st_apply_all_outputs(&sched, &resolver, &table, &stats);

    /* TTL 200 ms kể từ lệnh cuối (t=100 ms) -> ngưỡng rút là t=300 ms. Tại
     * t=200 ms còn trong TTL nên CHƯA được rút. */
    const uint64_t ttl_ns = 200 * kMs;
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, ttl_ns, &stats), 0u);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC)
        << "còn trong holdTtl, chưa tới lúc rút";

    /* Ngay TRƯỚC ngưỡng một ns vẫn phải giữ: biên là >=, không phải "khoảng đó". */
    sched.tick(300 * kMs - 1);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, ttl_ns, &stats), 0u);

    sched.tick(300 * kMs);   /* đúng ngưỡng holdTtl */
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, ttl_ns, &stats), 1u);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT)
        << "hết holdTtl phải rút proposal, nhả quyền cho downstream";

    /* Idempotent: gọi lại không rút thêm lần hai (đã outputs_withdrawn). */
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, ttl_ns, &stats), 0u);
}

TEST(StIntegration, StoppedProgramWithdrawsImmediatelyRegardlessOfTtl)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    ASSERT_TRUE(st_apply_all_outputs(&sched, &resolver, &table, &stats));
    ASSERT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);

    std::string err;
    ASSERT_TRUE(sched.stop("p", &err)) << err;

    /* Lệnh operator (stop) phải rút NGAY tại safe boundary, không chờ TTL dù
     * TTL rất lớn hoặc chưa cấu hình — khác hẳn chính sách hold-last cho FAULT. */
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, 1000000, &stats), 1u);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
}

TEST(StIntegration, DisabledProgramWithdrawsImmediately)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    ASSERT_TRUE(st_apply_all_outputs(&sched, &resolver, &table, &stats));

    std::string err;
    ASSERT_TRUE(sched.disable("p", &err)) << err;

    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, 0, &stats), 1u);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
}

TEST(StIntegration, RestartAfterWithdrawReclaimsPriorityAndResetsHoldLastTracking)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    ASSERT_TRUE(st_apply_all_outputs(&sched, &resolver, &table, &stats));

    std::string err;
    ASSERT_TRUE(sched.stop("p", &err)) << err;
    ASSERT_EQ(st_withdraw_stale_outputs(&sched, &resolver, 0, &stats), 1u);
    ASSERT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);

    /* Restart + publish lại thành công -> tái xác nhận claim mức 5 và mở lại
     * cơ hội rút cho lần dừng kế tiếp (outputs_withdrawn reset). */
    ASSERT_TRUE(sched.start("p", &err)) << err;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(300 * kMs);
    ASSERT_TRUE(st_apply_all_outputs(&sched, &resolver, &table, &stats));
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);
    EXPECT_FALSE(sched.find_program("p")->outputs_withdrawn);

    ASSERT_TRUE(sched.stop("p", &err)) << err;
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, 0, &stats), 1u)
        << "sau khi publish lại, dừng lần hai phải rút được lần nữa";
}

/* ---- TTL hold-last đã ký (ADR-051, DDD-CTRL-PROG-001 §6/§15) ---- */

TEST(StIntegration, T59_406_SignedHoldTtlIsSixtySecondsOfWallClock)
{
    /* Quyết định là 60 GIÂY. Đo bằng số vòng quét thì cùng một quyết định lại
     * cho ra thời gian giữ khác nhau tuỳ base step và tuỳ vòng lặp có chạy đúng
     * nhịp hay không — đúng thứ người ký KHÔNG ký. */
    EXPECT_EQ(st_hold_ttl::kSignedTtlMs, 60000u);
    EXPECT_EQ(st_hold_ttl::kSignedTtlNs, 60000000000ull);
    EXPECT_LE(st_hold_ttl::kSignedTtlMs, st_hold_ttl::kMaxConfigurableMs);

    /* Tiền đề của con số: TTL >= 2x chu kỳ của Program. Tuổi lệnh cuối lúc
     * Program chết đã có thể bằng trọn một chu kỳ, nên TTL nhỏ hơn 2x làm thời
     * gian giữ THỰC TẾ trôi xuống tận 0 — không hứa được gì với người vận hành.
     *
     * ADR-061 4.4: profile có lớp 50 000 ms nên 60 s toàn cục không còn đủ; tiền
     * đề được giữ bằng TTL THEO INSTANCE = max(60 s, 2 x chu kỳ Program). */
    EXPECT_EQ(st_hold_ttl::max_allowed_period_ms(), 50000u);
    for (const uint32_t period_ms : st_profile_generated::kAllowedPeriodMs) {
        const uint64_t ttl_ns = st_hold_ttl::instance_ttl_ns(st_hold_ttl::kSignedTtlNs, period_ms);
        EXPECT_GE(ttl_ns, 2u * st_hold_ttl::ns_from_ms(period_ms)) << period_ms;
        EXPECT_GE(ttl_ns, st_hold_ttl::kSignedTtlNs) << period_ms << " ms: sàn 60 s không được hạ";
        if (period_ms <= 30000u) {
            EXPECT_EQ(ttl_ns, st_hold_ttl::kSignedTtlNs)
                << period_ms << " ms: mọi Program <= 30 s giữ đúng 60 s như ADR-051";
        }
    }
    EXPECT_EQ(st_hold_ttl::instance_ttl_ns(st_hold_ttl::kSignedTtlNs, 50000u), 100000 * kMs)
        << "ADR-061 4.4: Program 50 000 ms có TTL 100 s";
    /* Legacy 30 000 ms (gói commission trước ADR-061) giữ TTL 60 s. */
    EXPECT_EQ(st_hold_ttl::instance_ttl_ns(st_hold_ttl::kSignedTtlNs, 30000u), 60000 * kMs);
    /* Sàn tắt (0) vẫn là tắt: TTL theo instance không được "bật lại" hold vô hạn
     * thành giữ 2x chu kỳ trong đường chẩn đoán. */
    EXPECT_EQ(st_hold_ttl::instance_ttl_ns(0, 50000u), 0u);
    /* Sàn field lớn hơn 2x chu kỳ thì sàn thắng. */
    EXPECT_EQ(st_hold_ttl::instance_ttl_ns(300000 * kMs, 50000u), 300000 * kMs);
}

/* ADR-061 4.4 — dựng một Program có chu kỳ RIÊNG `period_ms` (T59-402), publish
 * đúng một lần tại t = 1 s rồi ngừng publish (Task bị disable: Program vẫn
 * RUNNING, không bao giờ được release lại — đường im lặng khó thấy nhất). Trả về
 * mốc commit để caller đo TTL tính từ đó. */
uint64_t publish_once_then_go_silent(StScheduler* sched, PointTable* table,
                                     PriorityResolver* resolver, uint32_t period_ms)
{
    std::string err;
    EXPECT_TRUE(sched->add_task(task_cfg("T"), &err)) << err;
    EXPECT_TRUE(sched->add_program("T", "p", 0, &err)) << err;
    EXPECT_TRUE(sched->request_activation("p", doubler_artifact(), &err)) << err;
    sched->tick(0);
    EXPECT_TRUE(sched->start("p", &err)) << err;
    sched->find_program("p")->period_ms = period_ms;

    StIoBridgeStats stats;
    set_ai(table, 0, 5.0f);
    st_load_all_inputs(sched, *table, &stats);
    sched->tick(1000 * kMs);
    EXPECT_TRUE(st_apply_all_outputs(sched, resolver, table, &stats));
    EXPECT_EQ(resolver->winning_ao_level(0), PRIO_LOCAL_LOGIC);
    sched->tasks()[0]->set_enabled(false);
    return sched->find_program("p")->output_commit_now_ns;
}

TEST(StIntegration, Adr061_Program50sHoldsLastCommandForHundredSeconds)
{
    StScheduler sched;
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    const uint64_t committed = publish_once_then_go_silent(&sched, &table, &resolver, 50000u);
    ASSERT_EQ(committed, 1000 * kMs);

    /* Sàn 60 s đã ký là thứ caller truyền (đúng nối dây production). Với TTL
     * toàn cục cũ, lệnh bị rút ở đây — sớm hơn 2 x 50 s. */
    sched.tick(committed + 60000 * kMs);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, st_hold_ttl::kSignedTtlNs, &stats), 0u)
        << "Program 50 s không được rút ở 60 s: TTL theo instance là 100 s";
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);

    sched.tick(committed + 100000 * kMs - 1);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, st_hold_ttl::kSignedTtlNs, &stats), 0u);

    sched.tick(committed + 100000 * kMs);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, st_hold_ttl::kSignedTtlNs, &stats), 1u)
        << "hết đúng 100 s phải rút";
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
}

TEST(StIntegration, Adr061_LegacyProgram30sKeepsSixtySecondTtl)
{
    StScheduler sched;
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    const uint64_t committed = publish_once_then_go_silent(&sched, &table, &resolver, 30000u);

    sched.tick(committed + 60000 * kMs - 1);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, st_hold_ttl::kSignedTtlNs, &stats), 0u);
    sched.tick(committed + 60000 * kMs);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, st_hold_ttl::kSignedTtlNs, &stats), 1u)
        << "Program 30 s: TTL = max(60 s, 2 x 30 s) = 60 s";
}

TEST(StIntegration, Adr061_FieldHoldTtlOverrideIsAFloorForFastPrograms)
{
    /* `--program-hold-ttl-ms` là SÀN: Program 10 ms với sàn 5 s rút ở đúng 5 s,
     * không bị kéo lên 60 s, cũng không bị hạ xuống 2 x 10 ms. */
    StScheduler sched;
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    const uint64_t committed = publish_once_then_go_silent(&sched, &table, &resolver, 10u);
    const uint64_t floor_ns = 5000 * kMs;

    sched.tick(committed + floor_ns - 1);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, floor_ns, &stats), 0u);
    sched.tick(committed + floor_ns);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, floor_ns, &stats), 1u);
}

TEST(StIntegration, T59_406_ScanDepsDefaultIsSignedTtlNotUnlimitedHold)
{
    /* Mặc định `0` cũ nghĩa là GIỮ VÔ HẠN. Bất kỳ đường nối dây nào quên set
     * field đều âm thầm quay lại đúng hành vi ADR-051 đóng, và không test hành
     * vi nào bắt được vì "không rút" trông y hệt "chưa tới hạn". */
    const ScanDeps defaults{};
    EXPECT_EQ(defaults.program_hold_ttl_ns, st_hold_ttl::kSignedTtlNs);
    EXPECT_GT(defaults.program_hold_ttl_ns, 0u);
}

TEST(StIntegration, T59_406_HoldTtlWithdrawsProgramThatStoppedPublishingWithoutFaultState)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    programming::ProgramCandidateRegistry registry;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    std::string err;
    st_load_all_inputs(&sched, table, &stats);
    sched.tick(100 * kMs);
    ASSERT_TRUE(st_apply_all_outputs(&sched, &resolver, &table, &stats));
    ASSERT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);
    ASSERT_TRUE(st_register_instance_candidates(*sched.find_program("p"), &registry,
                                                sched.base_step_count(), &err))
        << err;
    ASSERT_EQ(registry.owner_of(PointKind::AO, 0), "p");

    /* Task bị disable: Program KHÔNG chuyển FAULTED, không chuyển STOPPED —
     * nó vẫn RUNNING và chỉ đơn giản không bao giờ được release nữa. Đây là
     * đường im lặng mà chính sách "chỉ rút khi FAULTED" để lọt: lệnh cuối sống
     * vĩnh viễn dù không còn ai tính ra nó. */
    sched.tasks()[0]->set_enabled(false);
    ASSERT_EQ(sched.find_program("p")->state, StProgramState::RUNNING);

    const uint64_t ttl_ns = 5000 * kMs;   /* 5 s */
    const uint64_t threshold = sched.find_program("p")->output_commit_now_ns + ttl_ns;
    for (uint64_t now = 200 * kMs; now < threshold; now += 500 * kMs) {
        sched.tick(now);
        ASSERT_EQ(st_withdraw_stale_outputs(&sched, &resolver, ttl_ns, &registry, &stats), 0u)
            << "còn trong TTL mà đã rút, now_ns=" << now;
        ASSERT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);
    }

    sched.tick(threshold);
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, ttl_ns, &registry, &stats), 1u);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT)
        << "hết TTL thì lệnh cũ phải nhả, kể cả khi Program chưa từng mang trạng thái FAULTED";

    const programming::CandidateClaim* claim = registry.find(PointKind::AO, 0);
    ASSERT_NE(claim, nullptr);
    EXPECT_FALSE(claim->active);
    EXPECT_EQ(claim->withdraw_reason, programming::CandidateWithdrawReason::FAULT_TTL_EXPIRED)
        << "rút vì hết TTL phải mang đúng lý do đó, không lẫn với lệnh operator";
    EXPECT_TRUE(registry.owner_of(PointKind::AO, 0).empty());
}

TEST(StIntegration, T59_406_NeverPublishedInstanceIsNotWithdrawnByTtl)
{
    StScheduler sched;
    make_running(&sched, doubler_artifact());

    PointTable table;
    PriorityResolver resolver;
    programming::ProgramCandidateRegistry registry;

    /* Không set_ai -> input không GOOD -> Program fault ngay lần chạy đầu và
     * KHÔNG BAO GIỜ publish. `output_commit_generation` đứng ở 0. */
    StIoBridgeStats stats;
    for (int i = 1; i <= 10; ++i) {
        st_load_all_inputs(&sched, table, &stats);
        sched.tick(static_cast<uint64_t>(i) * 100 * kMs);
        st_apply_all_outputs(&sched, &resolver, &table, &stats);
    }
    ASSERT_EQ(sched.find_program("p")->output_commit_generation, 0u);
    ASSERT_EQ(sched.find_program("p")->output_commit_now_ns, 0u);

    /* Instance chưa từng giữ gì thì không có gì để rút — ghi một dòng "đã rút"
     * ở đây chỉ làm nhiễu đúng chỗ người vận hành cần đọc khi có sự cố thật. */
    EXPECT_EQ(st_withdraw_stale_outputs(&sched, &resolver, kMs, &registry, &stats), 0u);
    EXPECT_FALSE(sched.find_program("p")->outputs_withdrawn);
    EXPECT_EQ(registry.find(PointKind::AO, 0), nullptr);
}

TEST(StIntegration, T59_406_SlowestHealthyTaskNeverReachesSignedHoldTtl)
{
    /* Task 30 s trên base step 1 s là trường hợp xấu nhất của profile: lệnh
     * cuối luôn già tới 30 base step ngay cả khi mọi thứ khoẻ mạnh. Test này
     * canh chính tiền đề của ADR-051 — nếu ai đó hạ TTL xuống dưới 2x chu kỳ
     * chậm nhất, một hệ HOÀN TOÀN BÌNH THƯỜNG sẽ bị rút đầu ra định kỳ. */
    StScheduler sched;
    std::string err;
    ASSERT_TRUE(sched.add_task(task_cfg("T", 30000), &err)) << err;
    ASSERT_TRUE(sched.add_program("T", "p", 0, &err)) << err;
    ASSERT_TRUE(sched.request_activation("p", doubler_artifact(), &err)) << err;
    sched.tick(0);
    ASSERT_TRUE(sched.start("p", &err)) << err;

    PointTable table;
    PriorityResolver resolver;
    set_ai(&table, 0, 5.0f);

    StIoBridgeStats stats;
    const uint64_t ttl_ns = st_hold_ttl::kSignedTtlNs;
    for (uint64_t step = 1; step <= 300; ++step) {
        set_ai(&table, 0, 5.0f);
        st_load_all_inputs(&sched, table, &stats);
        sched.tick(step * 1000 * kMs);           /* base step 1 s */
        st_apply_all_outputs(&sched, &resolver, &table, &stats);
        ASSERT_EQ(st_withdraw_stale_outputs(&sched, &resolver, ttl_ns, &stats), 0u)
            << "hệ khoẻ mạnh bị rút đầu ra tại base_step=" << step;
        /* Trước lần tới hạn ĐẦU TIÊN của Task 30 s thì chưa có lệnh nào để giữ;
         * khẳng định mức 5 ở đó là khẳng định sai chỗ. */
        if (sched.find_program("p")->output_commit_generation > 0) {
            ASSERT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC)
                << "base_step=" << step;
        }
    }
    EXPECT_EQ(sched.find_program("p")->state, StProgramState::RUNNING);
    /* 300 s / 30 s: phải có ít nhất 9 lần publish thật, nếu không thì test đã
     * "pass" chỉ vì Task chưa bao giờ chạy. */
    EXPECT_GE(stats.output_batches_committed, 9u);
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

TEST(StIntegration, InputSnapshotRejectsWholeBatchAndDoesNotReusePartialValues)
{
    const char* source = R"ST(
PROGRAM pair
VAR_INPUT a : REAL; b : REAL; END_VAR
VAR_OUTPUT total : REAL; END_VAR
total := a + b;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding a{};
    a.slot = slot_of(module, "a");
    a.point_kind = StPointKind::UI;
    a.point_index = 1;
    StIrIoBinding b{};
    b.slot = slot_of(module, "b");
    b.point_kind = StPointKind::UI;
    b.point_index = 2;
    StIrIoBinding total{};
    total.slot = slot_of(module, "total");
    total.is_output = true;
    total.point_kind = StPointKind::AO;
    total.point_index = 1;

    StScheduler scheduler;
    make_running(&scheduler, build_with_bindings(source, {a, b, total}));
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;

    set_two_ai(&table, 2.0f, KX_Q_GOOD, 3.0f, KX_Q_GOOD, 11);
    ASSERT_TRUE(st_load_all_inputs(&scheduler, table, &stats));
    ASSERT_EQ(scheduler.tick(100 * kMs).programs_run, 1u);

    StProgramInstance* instance = scheduler.find_program("p");
    ASSERT_NE(instance, nullptr);
    const StLoadedProgram* loaded = instance->runtime.program();
    ASSERT_NE(loaded, nullptr);
    EXPECT_FLOAT_EQ(loaded->slots[a.slot].r, 2.0f);
    EXPECT_FLOAT_EQ(loaded->slots[b.slot].r, 3.0f);

    set_two_ai(&table, 8.0f, KX_Q_GOOD, 9.0f, KX_Q_BAD, 12);
    EXPECT_FALSE(st_load_all_inputs(&scheduler, table, &stats));
    EXPECT_FLOAT_EQ(loaded->slots[a.slot].r, 2.0f)
        << "binding đầu không được commit khi binding sau BAD";
    EXPECT_FLOAT_EQ(loaded->slots[b.slot].r, 3.0f);
    const StSchedulerTickResult failed = scheduler.tick(200 * kMs);
    EXPECT_EQ(failed.faults, 1u);
    EXPECT_STREQ(instance->last_fault_code, st_diag_code::kRtNonFiniteInput);
    EXPECT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
}

TEST(StIntegration, TypedInputRejectsImplicitFractionalToIntegerConversion)
{
    const char* source = R"ST(
PROGRAM integer_input
VAR_INPUT state : UINT; END_VAR
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding input{};
    input.slot = slot_of(module, "state");
    input.point_kind = StPointKind::MSV;
    input.point_index = 1;
    StScheduler scheduler;
    make_running(&scheduler, build_with_bindings(source, {input}));
    PointTable table;
    ASSERT_TRUE(table.set_virtual({PointKind::MSV, 0}, 1.5f, PointSource::WEB));
    StIoBridgeStats stats;
    EXPECT_FALSE(st_load_all_inputs(&scheduler, table, &stats));
    EXPECT_EQ(stats.inputs_rejected, 1u);
    EXPECT_FALSE(scheduler.find_program("p")->input_snapshot_valid);
}

TEST(StIntegration, OutputPublishRejectsWholeBatchBeforePriorityMutation)
{
    const char* source = R"ST(
PROGRAM outputs
VAR_OUTPUT first : REAL; invalid : REAL; END_VAR
first := 5.0;
invalid := 99.0;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding first{};
    first.slot = slot_of(module, "first");
    first.is_output = true;
    first.point_kind = StPointKind::AO;
    first.point_index = 1;
    StIrIoBinding invalid = first;
    invalid.slot = slot_of(module, "invalid");
    invalid.point_index = 2;

    StScheduler scheduler;
    make_running(&scheduler, build_with_bindings(source, {first, invalid}));
    ASSERT_EQ(scheduler.tick(100 * kMs).programs_run, 1u);
    PointTable table;
    PriorityResolver resolver;
    PointWriter writer(table, nullptr);
    StIoBridgeStats stats;
    EXPECT_FALSE(st_apply_all_outputs(&scheduler, &resolver, &writer, &stats));
    EXPECT_EQ(stats.outputs_applied, 0u);
    EXPECT_EQ(stats.output_batches_rejected, 1u);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
    EXPECT_EQ(resolver.winning_ao_level(1), PRIO_DEFAULT);
}

TEST(StIntegration, DoesNotRepublishOutputWhenLongPeriodTaskIsNotDue)
{
    const char* source = R"ST(
PROGRAM slow
VAR_OUTPUT out1 : REAL; END_VAR
out1 := 4.0;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding output{};
    output.slot = slot_of(module, "out1");
    output.is_output = true;
    output.point_kind = StPointKind::AO;
    output.point_index = 1;

    StScheduler scheduler;
    std::string error;
    ASSERT_TRUE(scheduler.add_task(task_cfg("slow", 5000), &error)) << error;
    ASSERT_TRUE(scheduler.add_program("slow", "p", 0, &error)) << error;
    const std::vector<uint8_t> artifact = build_with_bindings(source, {output});
    ASSERT_TRUE(scheduler.request_activation("p", artifact, &error)) << error;
    scheduler.tick(0);
    ASSERT_TRUE(scheduler.start("p", &error)) << error;

    ASSERT_EQ(scheduler.tick(5000 * kMs).programs_run, 1u);
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats first_stats;
    ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &first_stats));
    ASSERT_EQ(first_stats.output_commit_generation, scheduler.base_step_count());
    ASSERT_TRUE(resolver.release_ao(PRIO_LOCAL_LOGIC, 0));

    const uint64_t prior_generation = scheduler.find_program("p")->output_commit_generation;
    ASSERT_EQ(scheduler.tick(6000 * kMs).programs_run, 0u);
    StIoBridgeStats skipped_stats;
    EXPECT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &skipped_stats));
    EXPECT_EQ(skipped_stats.outputs_applied, 0u);
    EXPECT_EQ(skipped_stats.output_batches_committed, 0u);
    EXPECT_EQ(scheduler.find_program("p")->output_commit_generation, prior_generation);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
}

TEST(StIntegration, VirtualPointBridgePreservesSnapshotMetadataAndProgramSource)
{
    const char* source = R"ST(
PROGRAM virtual_bridge
VAR_INPUT value : REAL; END_VAR
VAR_OUTPUT enabled : BOOL; END_VAR
enabled := value > 1.0;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding input{};
    input.slot = slot_of(module, "value");
    input.point_kind = StPointKind::AV;
    input.point_index = 1;
    StIrIoBinding output{};
    output.slot = slot_of(module, "enabled");
    output.is_output = true;
    output.point_kind = StPointKind::BV;
    output.point_index = 1;

    StScheduler scheduler;
    make_running(&scheduler, build_with_bindings(source, {input, output}));
    PointTable table;
    ASSERT_TRUE(table.set_virtual({PointKind::AV, 0}, 2.5f, PointSource::WEB));
    const Point source_point = table.get({PointKind::AV, 0});
    StIoBridgeStats stats;
    ASSERT_TRUE(st_load_all_inputs(&scheduler, table, &stats));
    StProgramInstance* instance = scheduler.find_program("p");
    ASSERT_EQ(instance->process_input_count, 1u);
    EXPECT_EQ(instance->process_inputs[0].quality, KX_Q_GOOD);
    EXPECT_EQ(instance->process_inputs[0].source,
              static_cast<uint8_t>(PointSource::WEB));
    EXPECT_EQ(instance->process_inputs[0].observed_at_ns, source_point.ts_ns);
    ASSERT_EQ(scheduler.tick(100 * kMs).programs_run, 1u);
    PriorityResolver resolver;
    PointWriter writer(table, nullptr);
    ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &writer, &stats));
    const Point result = table.get({PointKind::BV, 0});
    EXPECT_FLOAT_EQ(result.value, 1.0f);
    EXPECT_EQ(result.source, PointSource::PROGRAM);
}

TEST(StIntegration, ModbusRtuBridgeReadsExtAndPublishesSetpointDirty)
{
    const char* source = R"ST(
PROGRAM rtu_bridge
VAR_INPUT actual : REAL; END_VAR
VAR_OUTPUT request : REAL; END_VAR
request := actual + 1.0;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding input{};
    input.slot = slot_of(module, "actual");
    input.point_kind = StPointKind::EXT;
    input.point_index = 1;
    StIrIoBinding output{};
    output.slot = slot_of(module, "request");
    output.is_output = true;
    output.point_kind = StPointKind::EXT;
    output.point_index = 2;

    StScheduler scheduler;
    make_running(&scheduler, build_with_bindings(source, {input, output}));
    PointTable table;
    kx_ext_point_t ext[2]{};
    ext[0].value = 3.5f;
    ext[0].quality = KX_Q_GOOD;
    ext[0].sample_mono_ns = 123456;
    ext[1].quality = KX_Q_GOOD;
    table.update_ext(ext, 2);
    StIoBridgeStats stats;
    ASSERT_TRUE(st_load_all_inputs(&scheduler, table, &stats));
    StProgramInstance* instance = scheduler.find_program("p");
    ASSERT_EQ(instance->process_input_count, 1u);
    EXPECT_EQ(instance->process_inputs[0].observed_at_ns, 123456u);
    EXPECT_EQ(instance->process_inputs[0].source,
              static_cast<uint8_t>(PointSource::MODBUS_RTU));
    ASSERT_EQ(scheduler.tick(100 * kMs).programs_run, 1u);

    kx_plc_shm_t shm{};
    shm.ext_count = 2;
    shm.ext[1].writable = 1;
    PriorityResolver resolver;
    PointWriter writer(table, &shm);
    ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &writer, &stats));
    EXPECT_FLOAT_EQ(shm.ext[1].setpoint, 4.5f);
    EXPECT_EQ(shm.ext[1].dirty, 1);
    const Point result = table.get({PointKind::EXT, 1});
    EXPECT_FLOAT_EQ(result.value, 4.5f);
    EXPECT_EQ(result.source, PointSource::PROGRAM);
}

TEST(StIntegration, PidActualFeedbackDetectsPriorityOverride)
{
    /* TASK-PROG-303: "program/actual feedback" là ACTUAL của PID bind vào
     * CHÍNH Point Table AO mà OUT publish tới — round-trip qua hardware
     * feedback (io.ao_setpoint) y hệt production, không phải kênh riêng. */
    const char* source = R"ST(
PROGRAM ctrl
VAR_INPUT sp : REAL; pv : REAL; actual : REAL; END_VAR
VAR_OUTPUT y : REAL; tr : BOOL; END_VAR
VAR loop1 : PID; END_VAR
loop1(SP := sp, PV := pv, KP := 1.0, KI := 0.0, KD := 0.0,
      OUT_MIN := 0.0, OUT_MAX := 10.0, ACTUAL := actual);
y := loop1.OUT;
tr := loop1.TRACKING;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding sp_bind{};
    sp_bind.slot = slot_of(module, "sp");
    sp_bind.point_kind = StPointKind::AV;
    sp_bind.point_index = 1;
    StIrIoBinding pv_bind{};
    pv_bind.slot = slot_of(module, "pv");
    pv_bind.point_kind = StPointKind::AV;
    pv_bind.point_index = 2;
    StIrIoBinding actual_bind{};
    actual_bind.slot = slot_of(module, "actual");
    actual_bind.point_kind = StPointKind::AO;
    actual_bind.point_index = 1;
    StIrIoBinding y_bind{};
    y_bind.slot = slot_of(module, "y");
    y_bind.is_output = true;
    y_bind.point_kind = StPointKind::AO;
    y_bind.point_index = 1;

    StScheduler scheduler;
    make_running(&scheduler, build_with_bindings(source, {sp_bind, pv_bind, actual_bind, y_bind}));
    PointTable table;
    PriorityResolver resolver;
    StIoBridgeStats stats;
    ASSERT_TRUE(table.set_virtual({PointKind::AV, 0}, 10.0f, PointSource::WEB));  /* sp */
    ASSERT_TRUE(table.set_virtual({PointKind::AV, 1}, 0.0f, PointSource::WEB));   /* pv */

    auto tracking = [&] {
        StValue v;
        StProgramInstance* inst = scheduler.find_program("p");
        EXPECT_TRUE(inst->runtime.get_variable("tr", &v));
        return v.b;
    };
    auto feed_hardware_back = [&](float value) {
        IoSnapshot io{};
        io.ts_ns = table.get({PointKind::AO, 0}).ts_ns + 1;
        io.ao_setpoint[0] = value;
        table.update_inputs(io);
    };

    /* AO Point Table mặc định BAD tới khi có feedback thật đầu tiên — mô
     * phỏng trạng thái nguội trước khi có round-trip nào (VS-PROG-018:
     * missing không được thành zero). */
    feed_hardware_back(0.0f);

    /* Cycle 1: chưa có ACTUAL trước đó (pid_first) — không override. */
    ASSERT_TRUE(st_load_all_inputs(&scheduler, table, &stats));
    ASSERT_EQ(scheduler.tick(100 * kMs).programs_run, 1u);
    ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
    EXPECT_FALSE(tracking());
    const float y1 = resolver.resolve().ao[0];
    EXPECT_FLOAT_EQ(y1, 10.0f) << "P thuần: kp(1)*error(10)";

    /* Phần cứng báo lại ĐÚNG giá trị vừa publish — không ai override. */
    feed_hardware_back(y1);
    ASSERT_TRUE(st_load_all_inputs(&scheduler, table, &stats));
    ASSERT_EQ(scheduler.tick(200 * kMs).programs_run, 1u);
    ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
    EXPECT_FALSE(tracking()) << "actual khớp đề xuất trước — không phải override";

    /* Nguồn ưu tiên cao hơn (manual) thắng arbitration; phần cứng giờ báo
     * giá trị CỦA MANUAL, không phải của program. */
    ASSERT_TRUE(resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 3.3f));
    feed_hardware_back(resolver.resolve().ao[0]);
    ASSERT_TRUE(st_load_all_inputs(&scheduler, table, &stats));
    ASSERT_EQ(scheduler.tick(300 * kMs).programs_run, 1u);
    EXPECT_TRUE(tracking()) << "actual lệch đề xuất cycle trước — phải phát hiện override";
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
    kx_io_shm_t shm{};
    IobusReader reader;
    attach_valid_iobus(&reader, &shm);
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

    const uint64_t base_steps_before = sched.base_step_count();
    EXPECT_NO_FATAL_FAILURE(loop.step());
    EXPECT_EQ(loop.st_tick_for_test().base_step_sequence, base_steps_before + 1);
    EXPECT_EQ(loop.st_tick_for_test().tasks_run, 1u);
    EXPECT_EQ(loop.st_tick_for_test().programs_run, 1u);
    EXPECT_STREQ(web.snapshot_for_test().task.state.data(), "RUNNING");
}

TEST(StIntegration, ScanLoopPublishesFaultWhenProgramInstanceFaults)
{
    kx_io_shm_t shm{};
    IobusReader reader;
    attach_valid_iobus(&reader, &shm);
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
    deps.mode = CutoverMode::PROGRAM_ONLY;
    ScanLoop loop(deps);

    shm.ts_ns += 1000000;
    loop.step();
    ASSERT_STREQ(web.snapshot_for_test().task.state.data(), "RUNNING");

    shm.ui_quality[0] = KX_Q_BAD;
    shm.ts_ns += 1000000;
    std::this_thread::sleep_for(std::chrono::milliseconds(110));
    loop.step();

    ASSERT_EQ(sched.find_program("p")->state, StProgramState::FAULTED);
    EXPECT_STREQ(web.snapshot_for_test().task.state.data(), "FAULT")
        << "task snapshot phải phản ánh instance FAULTED, không chỉ task enabled";
}

TEST(StIntegration, ScanLoopWithdrawsStoppedProgramOutputAtSafeBoundary)
{
    /* TASK-PROG-401: xác nhận wiring thật trong ScanLoop::step() — không chỉ
     * hàm st_withdraw_stale_outputs() đơn lẻ — rút proposal đúng lúc operator
     * dừng chương trình, không phải chỉ trong unit test cô lập. */
    kx_io_shm_t shm{};
    IobusReader reader;
    attach_valid_iobus(&reader, &shm);
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

    loop.step();
    ASSERT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC);

    std::string err;
    ASSERT_TRUE(sched.stop("p", &err)) << err;

    loop.step();
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT)
        << "ScanLoop phải rút proposal mức 5 ngay tick sau khi operator stop";
    EXPECT_STREQ(web.snapshot_for_test().task.state.data(), "STOPPED");
}

TEST(StIntegration, ScanLoopStepDoesNotAllocateWithStProgram)
{
    /* Bất biến zero-allocation phải giữ nguyên SAU KHI tích hợp — nếu không,
     * mọi công của ACTION 6 mất tác dụng ngay khi ST vào scan path. */
    kx_io_shm_t shm{};
    IobusReader reader;
    attach_valid_iobus(&reader, &shm);
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

TEST(StIntegration, TenThousandCycleSoakStaysAllocationFreeAndBounded)
{
    /* TASK-PROG-307 (host phần "no-allocation/blocking" + "load test" của
     * VS-PROG-012/027 — KHÔNG PHẢI 10.000 chu kỳ WCET thật trên Forlinx, đòi
     * hỏi target/HIL thật, ngoài khả năng môi trường host). Cấu hình đúng
     * đường production sau TASK-PROG-306: PROGRAM_ONLY, graph.execute() bị
     * khoá, StScheduler là producer duy nhất, có bounded trace attach. */
    kx_io_shm_t shm{};
    IobusReader reader;
    attach_valid_iobus(&reader, &shm);
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

    StScheduler sched(StSchedulerProfile::REV_A);
    std::string err;
    StTaskConfig rev_a_cfg;
    rev_a_cfg.id = "T";
    rev_a_cfg.period_ms = 1000;
    rev_a_cfg.budget_ms = 100;  /* 10% < 20% (OD-PROG-012) */
    ASSERT_TRUE(sched.add_task(rev_a_cfg, &err)) << err;
    ASSERT_TRUE(sched.add_program("T", "p", 0, &err)) << err;
    ASSERT_TRUE(sched.request_activation("p", doubler_artifact(), &err)) << err;
    sched.tick(0);
    ASSERT_TRUE(sched.start("p", &err)) << err;
    StSchedulerTrace trace;
    sched.set_trace_log(&trace);

    ScanDeps deps{&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                  &metrics, -1, nullptr, nullptr};
    deps.st_sched = &sched;
    deps.mode = CutoverMode::PROGRAM_ONLY;
    ScanLoop loop(deps);

    /* Mỗi scan step phải đẩy đồng hồ đúng MỘT BASE STEP (1 s Rev A). Bước 1 ms
     * như trước làm Task 1 s chỉ chạy 10 lần trong "10.000 chu kỳ" — con số
     * trong tên test khi đó nói về vòng lặp, không nói về chu kỳ chương trình,
     * và mọi chính sách tính theo tuổi lệnh (hold TTL ADR-051) bị đo sai nhịp. */
    for (int i = 0; i < 5; i++) { shm.ts_ns += 1000000000ull; loop.step(); }

    std::size_t allocations = 0;
    {
        allocation_probe::ScopedCounter counter;
        for (int i = 0; i < 10000; i++) { shm.ts_ns += 1000000000ull; loop.step(); }
        allocations = counter.allocations();
    }
    EXPECT_LT(allocations, 10000u * 40u)
        << "10.000 chu kỳ không được làm tăng cấp phát vượt ngưỡng scan loop nền: "
        << allocations;
    /* Bounded: capacity trace không phình ra dù chạy rất nhiều chu kỳ — nếu
     * fault/overrun/activation không xảy ra suốt soak thì size()==0 vẫn hợp
     * lệ, điều cần khẳng định là KHÔNG VƯỢT capacity, không phải phải đầy. */
    EXPECT_LE(trace.size(), trace.capacity());
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC)
        << "sau 10.000 chu kỳ, program vẫn là producer AO — không rơi vào FAULT im lặng";
    /* ADR-051: soak chạy đúng nối dây production (`ScanDeps` mang TTL đã ký), nên
     * nó cũng là bằng chứng TTL 60 s KHÔNG cắn vào hệ khoẻ mạnh suốt 10.000 chu
     * kỳ — hold-last chỉ rút khi thật sự không còn ai publish. */
    EXPECT_EQ(deps.program_hold_ttl_ns, st_hold_ttl::kSignedTtlNs);
}

/* ===================================================================
 * F06 (EV-PROG-FBD-ST-MB-20260925) — Disable/Stop một Program ĐÃ ghi DO Modbus
 * phải nhả lệnh EXT (`dirty=0` + `ext_cmd_seq` mới) để iobus ghi `safe_value`.
 * Trên bo, DO2 kẹt ở 1 suốt 18 phút sau Disable vì EXT "không có gì để rút".
 * =================================================================== */
namespace {

struct ExtOutputRig {
    StScheduler scheduler;
    PointTable table;
    kx_plc_shm_t shm{};
    PriorityResolver resolver;
    StIoBridgeStats stats;
};

void arm_ext_output(ExtOutputRig* rig)
{
    const char* source = R"ST(
PROGRAM rtu_do
VAR_OUTPUT cmd : REAL; END_VAR
cmd := 1.0;
END_PROGRAM
)ST";
    const StIrModule module = compile_only(source);
    StIrIoBinding output{};
    output.slot = slot_of(module, "cmd");
    output.is_output = true;
    output.point_kind = StPointKind::EXT;
    output.point_index = 2;
    make_running(&rig->scheduler, build_with_bindings(source, {output}));
    rig->shm.ext_count = 2;
    rig->shm.ext[1].writable = 1;
}

} // namespace

TEST(StIntegration, F06_DisabledProgramReleasesPublishedExtOutput)
{
    ExtOutputRig rig;
    arm_ext_output(&rig);
    ASSERT_EQ(rig.scheduler.tick(100 * kMs).programs_run, 1u);
    PointWriter writer(rig.table, &rig.shm);
    ASSERT_TRUE(st_apply_all_outputs(&rig.scheduler, &rig.resolver, &writer, &rig.stats));
    ASSERT_EQ(rig.shm.ext[1].dirty, 1);
    const uint32_t command_seq = rig.shm.ext_cmd_seq[1];
    ASSERT_NE(command_seq, 0u);

    std::string err;
    ASSERT_TRUE(rig.scheduler.disable("p", &err)) << err;
    EXPECT_EQ(st_withdraw_stale_outputs(&rig.scheduler, &rig.resolver, 0, nullptr, &writer,
                                        &rig.stats), 1u);
    EXPECT_EQ(rig.shm.ext[1].dirty, 0) << "EXT phải được nhả để iobus về safe_value";
    EXPECT_EQ(rig.shm.ext_cmd_seq[1], command_seq + 1) << "nhả phải mang danh tính lệnh mới";
    EXPECT_NE(rig.table.get({PointKind::EXT, 1}).source, PointSource::PROGRAM);

    /* Idempotent: rút lần hai không tạo thêm lệnh nào. */
    EXPECT_EQ(st_withdraw_stale_outputs(&rig.scheduler, &rig.resolver, 0, nullptr, &writer,
                                        &rig.stats), 0u);
    EXPECT_EQ(rig.shm.ext_cmd_seq[1], command_seq + 1);
}

/* Instance CHƯA từng publish (mọi Program lúc Core khởi động ở DISABLED) không
 * được nhả EXT: nhả ở đó sẽ giật mọi DO Modbus về safe ở mỗi lần Core khởi động
 * lại, trước khi intent kịp bật Program trở lại. */
TEST(StIntegration, F06_NeverPublishedExtOutputIsNotReleasedOnDisable)
{
    ExtOutputRig rig;
    arm_ext_output(&rig);
    PointWriter writer(rig.table, &rig.shm);
    std::string err;
    ASSERT_TRUE(rig.scheduler.disable("p", &err)) << err;
    (void)st_withdraw_stale_outputs(&rig.scheduler, &rig.resolver, 0, nullptr, &writer, &rig.stats);
    EXPECT_EQ(rig.shm.ext_cmd_seq[1], 0u);
    EXPECT_EQ(rig.shm.ext[1].dirty, 0);
}

} // namespace core
