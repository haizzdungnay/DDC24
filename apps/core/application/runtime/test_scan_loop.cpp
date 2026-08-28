/**
 * @file  test_scan_loop.cpp
 * @brief Không overrun với load giả (07 tests); flow end-to-end trong RAM:
 *        shm giả → reader → priority/safe-state → output_writer ghi do_cmd/ao_setpoint.
 */
#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

#include "ipc/iobus_reader.hpp"
#include "ipc/output_writer.hpp"
#include "runtime/scan_loop.hpp"
#include "st/st_compile.hpp"
#include "st/st_diagnostic.hpp"
#include "st/st_ir.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

using namespace core;

namespace {

struct Fixture {
    kx_io_shm_t shm;
    IobusReader reader;
    PointTable table;
    PointQuality quality;
    WebIpc web;            /* không open → drain rỗng */
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe{quality};
    OutputWriter writer{reader};
    BacnetObjTable bacnet;  /* không attach → publish no-op */
    CoreMetrics metrics;
    ScanLoop loop;

    Fixture() : loop({&reader, &table, &quality, &web, &graph, &resolver,
                      &safe, &writer, &bacnet, &metrics})
    {
        std::memset(&shm, 0, sizeof(shm));
        shm.magic = KX_SHM_MAGIC;
        shm.iop_status = KX_IOP_NORMAL;
        shm.ts_ns = 1;
        reader.attach_external(&shm);
    }

    /* giả iobus sống: ts tăng mỗi scan */
    void tick_iobus() { shm.ts_ns += 1000000; }
};

} // namespace

TEST(ScanLoop, StepWritesResolvedOutputToShm)
{
    Fixture f;
    f.resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);
    f.resolver.set_ao(PRIO_LOCAL_MANUAL, 1, 5.0f);

    f.tick_iobus();
    f.loop.step();

    EXPECT_EQ(f.shm.do_cmd[0], 1) << "core ghi do_cmd qua output_writer";
    EXPECT_FLOAT_EQ(f.shm.ao_setpoint[1], 5.0f) << "eng value, không convert raw";
    EXPECT_EQ(f.metrics.scan_count(), 1u);
}

namespace {

const char* kAoGraph = R"({
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1, "name": "t", "scan_ms": 1000 },
  "io_map": {},
  "nodes": [
    { "id": "ao1", "type": "AO_Output", "params": { "channel": 0, "limit_lo": 0, "limit_hi": 100 }, "power_on": { "in": 42 } }
  ],
  "links": []
})";

} // namespace

TEST(ScanLoop, GraphOnlyModePublishesGraphAoOutput)
{
    /* Cơ sở so sánh: hành vi TRƯỚC TASK-PROG-306, mode mặc định không đổi. */
    kx_io_shm_t shm{};
    shm.magic = KX_SHM_MAGIC;
    shm.iop_status = KX_IOP_NORMAL;
    shm.ts_ns = 1;
    IobusReader reader;
    reader.attach_external(&shm);
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    ASSERT_TRUE(graph.load_string(kAoGraph));
    PriorityResolver resolver;
    SafeState safe(quality);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    CoreMetrics metrics;

    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                   &metrics, -1, nullptr, nullptr, nullptr, CutoverMode::GRAPH_ONLY});
    shm.ts_ns += 1000000;
    loop.step();

    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_LOCAL_LOGIC)
        << "GRAPH_ONLY: graph phải là producer, đúng hành vi trước Task 306";
}

TEST(ScanLoop, ProgramOnlyModeSkipsGraphExecuteEntirely)
{
    /* TASK-PROG-306, DDD-CTRL-PROG-001 §10: "một Point Local logic không có
     * hai producer". Cùng graph.json ghi AO-01 như test trên, nhưng
     * PROGRAM_ONLY phải khoá hẳn graph.execute() — không chỉ "chương trình
     * ghi đè sau" (điều đó không chứng minh được graph đã ngừng chạy, vì hai
     * nguồn cùng mức ưu tiên 5 thì "nguồn sau thắng" dù có gate hay không). */
    kx_io_shm_t shm{};
    shm.magic = KX_SHM_MAGIC;
    shm.iop_status = KX_IOP_NORMAL;
    shm.ts_ns = 1;
    IobusReader reader;
    reader.attach_external(&shm);
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    ASSERT_TRUE(graph.load_string(kAoGraph));
    PriorityResolver resolver;
    SafeState safe(quality);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    CoreMetrics metrics;

    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                   &metrics, -1, nullptr, nullptr, nullptr, CutoverMode::PROGRAM_ONLY});
    shm.ts_ns += 1000000;
    loop.step();

    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT)
        << "PROGRAM_ONLY: graph.execute() không được chạy — không ai claim AO-01";
}

TEST(ScanLoop, FaultTriggersSafeOutputs)
{
    Fixture f;
    f.resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);
    f.tick_iobus();
    f.loop.step();
    EXPECT_EQ(f.shm.do_cmd[0], 1);

    f.shm.iop_status = KX_IOP_FAULT;
    f.tick_iobus();
    f.loop.step();
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "fault → safe ≤1 scan";
}

/* Fixture (trên) cố ý KHÔNG nối graph/resolver vào SafeState (chỉ test T1/T3
 * độc lập, xem constructor comment ở safety/safe_state.hpp) nên T6/T7 luôn
 * inert ở đó. Bootstrap thật (`bootstrap/main.cpp`) nối đủ ba:
 * `SafeState safe(quality, &graph, &resolver);` — hai test dưới đây dựng lại
 * đúng kiểu nối đó cục bộ, không đổi Fixture dùng chung để khỏi ảnh hưởng các
 * test T1/T3 khác. */
TEST(ScanLoop, NoControllerAloneMarksSafeStateAsCommissionRecoverable)
{
    kx_io_shm_t shm{};
    shm.magic = KX_SHM_MAGIC;
    shm.iop_status = KX_IOP_NORMAL;
    shm.ts_ns = 1;
    IobusReader reader;
    reader.attach_external(&shm);
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;   /* không load — !graph.loaded() */
    PriorityResolver resolver;   /* không set gì — !any_active_above_default() */
    SafeState safe(quality, &graph, &resolver);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    CoreMetrics metrics;
    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                   &metrics});

    /* Không set gì ở resolver, không load graph — đúng kịch bản "chương trình
     * đang Active (nếu có) không ghi output nào": T7 (no_controller) là
     * trigger DUY NHẤT, mọi trigger khác (fault/stale/graph_bad/overrun) đều
     * false. Commission một Program có output phải tự giải quyết được. */
    shm.ts_ns += 1000000;
    loop.step();

    EXPECT_TRUE(safe.active());
    EXPECT_TRUE(safe.triggers().no_controller);
    EXPECT_FALSE(safe.triggers().iop_fault);
    EXPECT_FALSE(safe.triggers().stale);
    EXPECT_TRUE(web.snapshot_for_test().safe_state);
    EXPECT_TRUE(web.snapshot_for_test().safe_state_no_controller_only)
        << "safe-state chỉ do chưa ai điều khiển — không phải lỗi thật";
}

TEST(ScanLoop, FaultAlongsideNoControllerIsNotCommissionRecoverable)
{
    kx_io_shm_t shm{};
    shm.magic = KX_SHM_MAGIC;
    shm.iop_status = KX_IOP_FAULT;   /* lỗi IOP thật, đi kèm no_controller */
    shm.ts_ns = 1;
    IobusReader reader;
    reader.attach_external(&shm);
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe(quality, &graph, &resolver);
    OutputWriter writer(reader);
    BacnetObjTable bacnet;
    CoreMetrics metrics;
    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer, &bacnet,
                   &metrics});

    shm.ts_ns += 1000000;
    loop.step();

    EXPECT_TRUE(safe.active());
    EXPECT_TRUE(safe.triggers().iop_fault);
    EXPECT_TRUE(safe.triggers().no_controller);
    EXPECT_TRUE(web.snapshot_for_test().safe_state);
    EXPECT_FALSE(web.snapshot_for_test().safe_state_no_controller_only)
        << "có lỗi IOP thật — không được coi là an toàn để Commission bỏ qua";
}

TEST(ScanLoop, StaleShmTriggersSafeWithin6Scans)
{
    Fixture f;
    f.resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);
    f.tick_iobus();
    f.loop.step();
    EXPECT_EQ(f.shm.do_cmd[0], 1);

    /* iobus chết: ts_ns đứng yên */
    for (int i = 0; i < 6; i++)
        f.loop.step();
    EXPECT_EQ(f.shm.do_cmd[0], 0) << "stale → safe";

    /* iobus sống lại → trả quyền */
    f.tick_iobus();
    f.loop.step();
    EXPECT_EQ(f.shm.do_cmd[0], 1);
}

TEST(ScanLoop, NoOverrunWithLightLoad)
{
    Fixture f;
    std::atomic<bool> shutdown{false};

    std::thread stopper([&] {
        /* ~50 scan ở 5ms */
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        shutdown.store(true);
    });
    f.loop.run(shutdown, 5000000ull /* 5ms */);
    stopper.join();

    EXPECT_GE(f.metrics.scan_count(), 30u);
    EXPECT_EQ(f.metrics.scan_overrun(), 0u) << "load giả nhẹ không được overrun";
}

TEST(ScanLoop, SeqlockFailKeepsOldSnapshot)
{
    Fixture f;
    f.tick_iobus();
    f.loop.step();
    EXPECT_EQ(f.metrics.seqlock_fail(), 0u);

    KX_WRITE_BEGIN(&f.shm);   /* writer treo giữa chừng */
    f.loop.step();
    EXPECT_EQ(f.metrics.seqlock_fail(), 1u);
    KX_WRITE_END(&f.shm);
}

TEST(ScanLoop, PublishesOneCoherentPointSnapshotPerStep)
{
    Fixture f;
    EXPECT_EQ(f.web.snapshot_cache_state_for_test(), SnapshotCacheState::UNAVAILABLE);

    f.shm.ts_ns = 101;
    f.shm.ui_value[0] = 1.25f;
    f.shm.do_feedback[0] = 1;
    f.resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 5.0f);
    f.loop.step();

    ASSERT_EQ(f.web.snapshot_cache_state_for_test(), SnapshotCacheState::READY);
    const RuntimePointSnapshot first = f.web.snapshot_for_test();
    EXPECT_EQ(first.snapshot_id, 1u);
    EXPECT_GT(first.observed_utc_ms, 0u);
    EXPECT_GT(first.captured_monotonic_ns, 0u);
    EXPECT_EQ(first.rows[16].updated_at_monotonic_ns, first.captured_monotonic_ns);
    EXPECT_FLOAT_EQ(first.rows[0].value, 1.25f);
    EXPECT_EQ(first.rows[0].updated_at_monotonic_ns, 101u);
    EXPECT_FLOAT_EQ(first.rows[16].value, 5.0f);
    EXPECT_EQ(first.rows[16].source, SnapshotSource::MANUAL);
    EXPECT_FLOAT_EQ(first.rows[20].value, 1.0f);
    EXPECT_EQ(first.rows[20].updated_at_monotonic_ns, 101u);

    f.shm.ts_ns = 202;
    f.shm.ui_value[0] = 2.5f;
    f.shm.do_feedback[0] = 0;
    f.resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 6.0f);
    f.loop.step();

    const RuntimePointSnapshot second = f.web.snapshot_for_test();
    EXPECT_EQ(second.snapshot_id, 2u);
    EXPECT_FLOAT_EQ(second.rows[0].value, 2.5f);
    EXPECT_EQ(second.rows[0].updated_at_monotonic_ns, 202u);
    EXPECT_FLOAT_EQ(second.rows[16].value, 6.0f);
    EXPECT_EQ(second.rows[16].source, SnapshotSource::MANUAL);
    EXPECT_GT(second.rows[16].updated_at_monotonic_ns,
              first.rows[16].updated_at_monotonic_ns);
    EXPECT_FLOAT_EQ(second.rows[20].value, 0.0f);
    EXPECT_EQ(second.rows[20].updated_at_monotonic_ns, 202u);
}

TEST(ScanLoop, PublishesPostSafeAoAndHardwareDoFeedback)
{
    Fixture f;
    f.resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 8.0f);
    f.resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);
    f.shm.iop_status = KX_IOP_FAULT;
    f.shm.ts_ns = 303;
    f.shm.do_feedback[0] = 1;

    f.loop.step();

    const RuntimePointSnapshot snapshot = f.web.snapshot_for_test();
    EXPECT_FLOAT_EQ(snapshot.rows[16].value, 0.0f);
    EXPECT_EQ(snapshot.rows[16].source, SnapshotSource::SAFETY);
    EXPECT_FLOAT_EQ(snapshot.rows[20].value, 1.0f);
    EXPECT_EQ(snapshot.rows[20].role, SnapshotRole::HARDWARE_FEEDBACK);
    EXPECT_EQ(f.shm.do_cmd[0], 0);
}

TEST(ScanLoop, WritesPhysicalOutputBeforeSnapshotPublication)
{
    Fixture f;
    f.resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);
    f.web.set_snapshot_payload_limit_for_test(1);
    bool output_written = false;
    std::pair<kx_io_shm_t*, bool*> state{&f.shm, &output_written};
    f.web.set_publish_observer_for_test(
        [](void* context) {
            auto* observed = static_cast<std::pair<kx_io_shm_t*, bool*>*>(context);
            *observed->second = observed->first->do_cmd[0] == 1;
        },
        &state);

    f.loop.step();

    EXPECT_TRUE(output_written);
    EXPECT_EQ(f.shm.do_cmd[0], 1);
    EXPECT_EQ(f.web.snapshot_cache_state_for_test(), SnapshotCacheState::TOO_LARGE);
}

TEST(ScanLoop, TracksAoTimestampAcrossStableAndSourceChangedSteps)
{
    Fixture f;
    f.resolver.set_ao(PRIO_LOCAL_MANUAL, 0, 5.0f);
    f.tick_iobus();
    f.loop.step();
    const RuntimePointSnapshot first = f.web.snapshot_for_test();

    f.tick_iobus();
    f.loop.step();
    const RuntimePointSnapshot stable = f.web.snapshot_for_test();
    EXPECT_EQ(stable.rows[16].updated_at_monotonic_ns,
              first.rows[16].updated_at_monotonic_ns);

    f.resolver.release_ao(PRIO_LOCAL_MANUAL, 0);
    f.resolver.set_ao(PRIO_SCHEDULE, 0, 5.0f);
    f.tick_iobus();
    f.loop.step();
    const RuntimePointSnapshot changed_source = f.web.snapshot_for_test();
    EXPECT_EQ(changed_source.rows[16].source, SnapshotSource::SCHEDULE);
    EXPECT_GT(changed_source.rows[16].updated_at_monotonic_ns,
              stable.rows[16].updated_at_monotonic_ns);
}

TEST(ScanLoop, ReusesProducerTimestampAfterSeqlockFailure)
{
    Fixture f;
    f.shm.ts_ns = 700;
    f.shm.ui_value[0] = 7.0f;
    f.shm.do_feedback[0] = 1;
    f.loop.step();
    const RuntimePointSnapshot first = f.web.snapshot_for_test();

    KX_WRITE_BEGIN(&f.shm);
    f.shm.ts_ns = 800;
    f.shm.ui_value[0] = 8.0f;
    f.shm.do_feedback[0] = 0;
    f.loop.step();
    const RuntimePointSnapshot reused = f.web.snapshot_for_test();
    KX_WRITE_END(&f.shm);

    EXPECT_EQ(reused.snapshot_id, first.snapshot_id + 1);
    EXPECT_FLOAT_EQ(reused.rows[0].value, 7.0f);
    EXPECT_EQ(reused.rows[0].updated_at_monotonic_ns, 700u);
    EXPECT_FLOAT_EQ(reused.rows[20].value, 1.0f);
    EXPECT_EQ(reused.rows[20].updated_at_monotonic_ns, 700u);
}

TEST(ScanLoop, RunSyncsGraphDtToActualPeriod)
{
    /* Yêu cầu fix timing: ScanLoop::run() phải sync dt của graph về chu kỳ thật */
    Fixture f;
    ASSERT_TRUE(f.graph.load_string(R"({
      "schema_version": "1.0",
      "device": { "bacnet_device_id": 1, "name": "t", "scan_ms": 1000 },
      "io_map": {},
      "nodes": [ { "id": "sp1", "type": "Setpoint", "params": { "default": 1.0 } },
                 { "id": "do1", "type": "DO_Output", "params": { "channel": 0 } } ],
      "links": [ { "from": "sp1.out", "to": "do1.in" } ]
    })"));
    EXPECT_EQ(f.graph.effective_scan_ms(), 1000u);

    std::atomic<bool> shutdown{false};
    std::thread stopper([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(60));
        shutdown.store(true);
    });
    f.loop.run(shutdown, 5000000ull /* core thật 5ms */);
    stopper.join();

    EXPECT_EQ(f.graph.effective_scan_ms(), 5u)
        << "run() phải ép dt graph = chu kỳ scan thật (khai báo 1000 bị WARN + override)";
}

TEST(ScanLoop, LateAttachRecoversOutputPath)
{
    /* Gap #3 analysis report: core lên trước iobus quá lâu → trước fix,
     * OutputWriter chốt nullptr vĩnh viễn. Sau fix: reader attach muộn →
     * output path tự sống lại (writer lấy mapping động). */
    kx_io_shm_t shm;
    std::memset(&shm, 0, sizeof(shm));
    shm.magic = KX_SHM_MAGIC;
    shm.iop_status = KX_IOP_NORMAL;
    shm.ts_ns = 1;

    IobusReader reader;          /* CHƯA attach — như sau 30s degraded */
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe{quality};
    OutputWriter writer{reader};
    BacnetObjTable bacnet;
    CoreMetrics metrics;
    ScanLoop loop({&reader, &table, &quality, &web, &graph, &resolver,
                   &safe, &writer, &bacnet, &metrics});

    resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);
    loop.step();                 /* degraded: không shm → không ghi, không crash */
    EXPECT_EQ(shm.do_cmd[0], 0);

    reader.attach_external(&shm);   /* iobus lên muộn (mô phỏng attach thành công) */
    shm.ts_ns = 1000000;
    loop.step();
    EXPECT_EQ(shm.do_cmd[0], 1) << "output path phải sống lại sau khi attach muộn";
}

TEST(ScanLoop, DetachesOnBadMagicAndRestoresOnReattach)
{
    Fixture f;
    f.resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);
    f.tick_iobus();
    f.loop.step();
    EXPECT_EQ(f.shm.do_cmd[0], 1);

    // Corrupt magic
    f.shm.magic = 0;
    f.tick_iobus();
    f.loop.step(); // should fail read and detach

    EXPECT_FALSE(f.reader.attached());

    // Fix magic
    f.shm.magic = KX_SHM_MAGIC;
    f.tick_iobus();
    f.reader.attach_external(&f.shm);
    // next step should write outputs
    f.loop.step();
    EXPECT_TRUE(f.reader.attached());
    EXPECT_EQ(f.shm.do_cmd[0], 1);
}

TEST(PointTable, ModbusExtSnapshotIsAvailableWithRuntimeSourceAndQuality)
{
    PointTable table;
    kx_ext_point_t ext[2]{};
    ext[0].value = 21.5f;
    ext[0].quality = KX_Q_GOOD;
    ext[1].value = 7.0f;
    ext[1].quality = KX_Q_UNCERTAIN;
    table.update_ext(ext, 2);

    const Point first = table.get({PointKind::EXT, 0});
    const Point second = table.get({PointKind::EXT, 1});
    EXPECT_FLOAT_EQ(first.value, 21.5f);
    EXPECT_EQ(first.quality, KX_Q_GOOD);
    EXPECT_EQ(first.source, PointSource::MODBUS_RTU);
    EXPECT_GT(first.ts_ns, 0u);
    EXPECT_EQ(second.quality, KX_Q_UNCERTAIN);
    EXPECT_EQ(table.get({PointKind::EXT, 2}).quality, KX_Q_BAD);
}

/* ===================================================================
 * T60-004 — bảng Program TOÀN HỆ THỐNG trong point_snapshot (Plan 60 §6 P0-A).
 *
 * Khối `task` của snapshot chỉ mô tả `tasks().front()`. Từ `T59-402/403` mỗi
 * Program tự release theo chu kỳ riêng, nên một Task không còn đại diện được
 * cho hệ. Bộ test dưới đây khoá phần ĐIỀN mảng: đủ mọi Task, đúng chu kỳ hiệu
 * lực, giữ nguyên Program `DISABLED`, và chạm đúng trần
 * `st_sched_limits::kMaxProgramsTotal`.
 * =================================================================== */

namespace {

/* Chương trình ST tối thiểu. Đi đúng đường compile + ký như production để số đo
 * trong dump là số THẬT, không phải struct nhồi tay. Biên dịch một lần rồi dùng
 * lại: 32 lần compile trong một test là phí thời gian chứ không thêm bằng chứng. */
const std::vector<uint8_t>& counter_artifact()
{
    static const std::vector<uint8_t> artifact = [] {
        StIrModule module;
        StDiagnostic diagnostic;
        EXPECT_TRUE(compile_st_source(R"ST(
PROGRAM counter
VAR_OUTPUT n : INT; END_VAR
    n := n + 1;
END_PROGRAM
)ST",
                                      &module, &diagnostic))
            << diagnostic.code << ": " << diagnostic.message;
        std::vector<uint8_t> bytes;
        std::string error;
        EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
        EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
        return bytes;
    }();
    return artifact;
}

const RuntimeProgramSnapshot* find_program_row(const RuntimePointSnapshot& snapshot,
                                               std::string_view instance_id)
{
    for (std::size_t index = 0; index < snapshot.program_count; ++index)
        if (std::string_view(snapshot.programs[index].instance_id.data()) == instance_id)
            return &snapshot.programs[index];
    return nullptr;
}

/* Fixture CÓ Program Runtime thật. Fixture dùng chung ở đầu file cố ý không có
 * scheduler (nó khoá đường I/O trần trụi); thêm ở đây thay vì sửa nó để không
 * đổi điều kiện của các test T1/T3 đã có. */
struct ProgramFixture {
    kx_io_shm_t shm;
    IobusReader reader;
    PointTable table;
    PointQuality quality;
    WebIpc web;
    GraphRuntime graph;
    PriorityResolver resolver;
    SafeState safe{quality};
    OutputWriter writer{reader};
    BacnetObjTable bacnet;
    CoreMetrics metrics;
    /* Profile supporting: 8 Task × 16 Program/Task, trần TOÀN HỆ THỐNG 32. */
    StScheduler scheduler;
    ScanLoop loop;

    ProgramFixture()
        : loop({&reader, &table, &quality, &web, &graph, &resolver, &safe, &writer,
                &bacnet, &metrics, -1, nullptr, nullptr, &scheduler})
    {
        std::memset(&shm, 0, sizeof(shm));
        shm.magic = KX_SHM_MAGIC;
        shm.iop_status = KX_IOP_NORMAL;
        shm.ts_ns = 1;
        reader.attach_external(&shm);
    }

    void tick_iobus() { shm.ts_ns += 1000000; }

    void add_task(const char* id, uint8_t priority, uint32_t period_ms)
    {
        StTaskConfig config;
        config.id = id;
        config.priority = priority;
        config.period_ms = period_ms;
        config.budget_ms = period_ms;
        std::string error;
        ASSERT_TRUE(scheduler.add_task(config, &error)) << error;
    }

    /* `program_period_ms == 0` = "theo chu kỳ Task" (T59-402). `add_program`
     * không nhận chu kỳ riêng nên đặt thẳng trường — đúng thứ mà đường nạp
     * package (`StProgramSetEntry::period_ms`) làm. */
    void add_program(const char* task_id, const char* instance_id, uint16_t order,
                     uint32_t program_period_ms)
    {
        std::string error;
        ASSERT_TRUE(scheduler.add_program(task_id, instance_id, order, &error)) << error;
        scheduler.find_program(instance_id)->period_ms = program_period_ms;
    }

    void stage(const char* instance_id)
    {
        std::string error;
        ASSERT_TRUE(scheduler.request_activation(instance_id, counter_artifact(), &error))
            << error;
    }

    void start(const char* instance_id)
    {
        std::string error;
        ASSERT_TRUE(scheduler.start(instance_id, &error)) << error;
    }

    void step()
    {
        tick_iobus();
        loop.step();
    }
};

} // namespace

/* Hồi quy chính của `T60-002`: trước đó chỉ `tasks().front()` được báo cáo, nên
 * mọi Program thuộc Task thứ hai trở đi KHÔNG hề xuất hiện trong snapshot. Test
 * này cũng khoá luật phân giải chu kỳ: `period_ms == 0` phải ra chu kỳ Task,
 * tuyệt đối không phát `0` ra ngoài (`0 ms` ở cột Cycle là số bịa). */
TEST(ScanLoop, PublishesEveryProgramOfEveryTaskWithItsEffectiveCycle)
{
    ProgramFixture f;
    f.add_task("FAST", 0, 100);
    f.add_task("SLOW", 1, 1000);
    f.add_program("FAST", "P_ahu", 0, 0);       /* thừa kế chu kỳ Task = 100 ms */
    f.add_program("SLOW", "P_boiler", 0, 5000); /* chu kỳ RIÊNG của Program */
    f.add_program("SLOW", "P_chiller", 1, 0);   /* thừa kế chu kỳ Task = 1000 ms */

    f.step();

    /* Bản SAO, không phải tham chiếu: `snapshot_for_test()` trả về chính cache
     * sống của WebIpc, nên giữ tham chiếu rồi quét tiếp sẽ so một giá trị với
     * chính nó. */
    const RuntimePointSnapshot snapshot = f.web.snapshot_for_test();
    ASSERT_EQ(snapshot.program_count, 3u)
        << "Program của Task thứ hai trở đi phải có mặt, không chỉ tasks().front()";
    EXPECT_FALSE(snapshot.programs_truncated);

    /* Thứ tự tất định: Task theo priority, Program theo `order`. */
    EXPECT_EQ(std::string_view(snapshot.programs[0].instance_id.data()), "P_ahu");
    EXPECT_EQ(std::string_view(snapshot.programs[1].instance_id.data()), "P_boiler");
    EXPECT_EQ(std::string_view(snapshot.programs[2].instance_id.data()), "P_chiller");

    ASSERT_NE(find_program_row(snapshot, "P_ahu"), nullptr);
    ASSERT_NE(find_program_row(snapshot, "P_boiler"), nullptr);
    ASSERT_NE(find_program_row(snapshot, "P_chiller"), nullptr);
    EXPECT_EQ(find_program_row(snapshot, "P_ahu")->period_ms, 100u);
    EXPECT_EQ(find_program_row(snapshot, "P_boiler")->period_ms, 5000u)
        << "chu kỳ riêng của Program không được thay bằng chu kỳ Task";
    EXPECT_EQ(find_program_row(snapshot, "P_chiller")->period_ms, 1000u);
    for (std::size_t index = 0; index < snapshot.program_count; ++index)
        EXPECT_NE(snapshot.programs[index].period_ms, 0u)
            << "`0 ms` ở cột Cycle là số bịa — phải phân giải về chu kỳ Task";

    /* Nhiều chu kỳ quét liên tiếp: bảng phải giữ nguyên thành phần, không rơi
     * rụng và không nhân đôi. */
    for (int cycle = 0; cycle < 5; ++cycle) f.step();
    const RuntimePointSnapshot later = f.web.snapshot_for_test();
    EXPECT_EQ(later.snapshot_id, snapshot.snapshot_id + 5);
    ASSERT_EQ(later.program_count, 3u);
    EXPECT_EQ(std::string_view(later.programs[2].instance_id.data()), "P_chiller");
}

/* Trần mảng snapshot phải bằng ĐÚNG trần Program toàn hệ thống của scheduler.
 * `scan_loop.cpp` đã có `static_assert` cho ràng buộc đó; test này chứng minh
 * cấu hình chạm trần thật sự đi trọn vẹn qua đường xuất, và 32 KHÔNG bị báo
 * nhầm là tràn (lỗi off-by-one điển hình ở chỗ cắt). */
TEST(ScanLoop, FillsProgramTableUpToTheSystemWideCeilingOfThirtyTwo)
{
    static_assert(KX_POINT_SNAPSHOT_MAX_PROGRAMS == st_sched_limits::kMaxProgramsTotal,
                  "trần mảng snapshot phải bằng đúng trần Program toàn hệ thống");
    ASSERT_EQ(st_sched_limits::kMaxProgramsTotal, 32u);

    ProgramFixture f;
    f.add_task("T0", 0, 100);
    f.add_task("T1", 1, 100);
    f.add_task("T2", 2, 100);
    for (std::size_t index = 0; index < st_sched_limits::kMaxProgramsTotal; ++index) {
        const std::string instance = "P_" + std::to_string(index);
        const char* task = index < st_sched_limits::kMaxProgramsPerTask ? "T0" : "T1";
        f.add_program(task, instance.c_str(),
                      static_cast<uint16_t>(index % st_sched_limits::kMaxProgramsPerTask),
                      0);
    }

    /* Program thứ 33 bị CHÍNH scheduler từ chối ở tầng tổng — đây là bằng chứng
     * 32 là trần thật, không phải một con số test tự đặt. */
    std::string error;
    EXPECT_FALSE(f.scheduler.add_program("T2", "P_overflow", 0, &error));
    EXPECT_NE(error.find("too many program instances in resource"), std::string::npos)
        << error;

    f.step();

    const RuntimePointSnapshot snapshot = f.web.snapshot_for_test();
    EXPECT_EQ(snapshot.program_count, st_sched_limits::kMaxProgramsTotal);
    EXPECT_FALSE(snapshot.programs_truncated)
        << "đúng 32 là chạm trần, không phải tràn";
    for (std::size_t index = 0; index < st_sched_limits::kMaxProgramsTotal; ++index)
        EXPECT_NE(find_program_row(snapshot, "P_" + std::to_string(index)), nullptr)
            << "thiếu P_" << index;

    const auto json = nlohmann::json::parse(f.web.snapshot_payload_for_test());
    EXPECT_EQ(json.at("programs").size(), 32u);
    EXPECT_FALSE(json.at("programsTruncated").get<bool>());
}

/* Program `DISABLED` phải NẰM TRONG bảng với trạng thái thật của nó. Lọc nó ra
 * khỏi danh sách sẽ làm UI hiển thị "không có Program đó" — khác hẳn với "có,
 * và đang bị tắt có chủ đích" (Plan 60 §4.1). */
TEST(ScanLoop, KeepsDisabledProgramInTheTableWithItsRealState)
{
    ProgramFixture f;
    f.add_task("MAIN", 0, 50);
    f.add_program("MAIN", "P_running", 0, 0);
    f.add_program("MAIN", "P_disabled", 1, 0);
    f.stage("P_running");
    f.stage("P_disabled");
    f.step(); /* boundary áp dụng activation */
    f.start("P_running");
    f.start("P_disabled");
    f.step();

    std::string error;
    ASSERT_TRUE(f.scheduler.disable("P_disabled", &error)) << error;
    f.step();

    const RuntimePointSnapshot snapshot = f.web.snapshot_for_test();
    ASSERT_EQ(snapshot.program_count, 2u) << "DISABLED không được biến mất khỏi bảng";
    const RuntimeProgramSnapshot* running = find_program_row(snapshot, "P_running");
    const RuntimeProgramSnapshot* disabled = find_program_row(snapshot, "P_disabled");
    ASSERT_NE(running, nullptr);
    ASSERT_NE(disabled, nullptr);
    EXPECT_EQ(std::string_view(running->state.data()), "RUNNING");
    EXPECT_TRUE(running->enabled);
    EXPECT_EQ(std::string_view(disabled->state.data()), "DISABLED");
    EXPECT_FALSE(disabled->enabled);
    EXPECT_EQ(disabled->period_ms, 50u) << "chu kỳ khai báo vẫn đúng khi bị tắt";

    const auto json = nlohmann::json::parse(f.web.snapshot_payload_for_test());
    ASSERT_EQ(json.at("programs").size(), 2u);
    bool saw_disabled = false;
    for (const auto& row : json.at("programs")) {
        if (row.at("instanceId") != "P_disabled") continue;
        saw_disabled = true;
        EXPECT_EQ(row.at("state"), "DISABLED");
        EXPECT_FALSE(row.at("enabled").get<bool>());
    }
    EXPECT_TRUE(saw_disabled);
}

/* Ranh giới mà phía Go dựa vào (`T60-011`, Plan 60 §4.2 điều 1): mảng RỖNG =
 * "Core sống, hệ không có Program nào"; THIẾU KHOÁ = "Core đời cũ" ⇒ phải ra
 * `UNAVAILABLE`. Test khẳng định KHOÁ CÓ MẶT ở cả hai cấu hình không-Program:
 * có scheduler nhưng chưa có Task, và không nối scheduler nào cả. */
TEST(ScanLoop, EmptySchedulerPublishesPresentButEmptyProgramArray)
{
    ProgramFixture with_scheduler; /* có StScheduler, chưa có Task nào */
    with_scheduler.step();

    EXPECT_EQ(with_scheduler.web.snapshot_for_test().program_count, 0u);
    EXPECT_FALSE(with_scheduler.web.snapshot_for_test().programs_truncated);
    const std::string with_payload{with_scheduler.web.snapshot_payload_for_test()};
    EXPECT_NE(with_payload.find("\"programs\":[]"), std::string::npos);
    const auto with_json = nlohmann::json::parse(with_payload);
    ASSERT_TRUE(with_json.contains("programs"));
    EXPECT_TRUE(with_json.at("programs").is_array());
    EXPECT_TRUE(with_json.at("programs").empty());
    ASSERT_TRUE(with_json.contains("programsTruncated"));
    EXPECT_FALSE(with_json.at("programsTruncated").get<bool>());

    Fixture without_scheduler; /* `st_sched == nullptr` */
    without_scheduler.tick_iobus();
    without_scheduler.loop.step();

    const auto without_json =
        nlohmann::json::parse(without_scheduler.web.snapshot_payload_for_test());
    ASSERT_TRUE(without_json.contains("programs"))
        << "không có Program Runtime vẫn phải phát khoá — vắng khoá nghĩa là Core đời cũ";
    EXPECT_TRUE(without_json.at("programs").empty());
    EXPECT_FALSE(without_json.at("programsTruncated").get<bool>());
}

/* MỐC BÀN GIAO M1 — bản dump `point_snapshot` THẬT, sinh từ ScanLoop chạy với
 * hai Program khác chu kỳ và artifact ST đã ký. In ra stdout để `T60-011/012`
 * có hình dạng wire thật để decode, thay vì một mẫu viết tay. */
TEST(ScanLoop, DumpsRealProgramSnapshotJsonForBackendHandoff)
{
    ProgramFixture f;
    f.add_task("MAIN", 0, 50);
    f.add_program("MAIN", "P_ahu_supply_fan", 0, 0);  /* thừa kế Task = 50 ms */
    f.add_program("MAIN", "P_boiler_stage", 1, 200);  /* chu kỳ riêng 200 ms */
    f.stage("P_ahu_supply_fan");
    f.stage("P_boiler_stage");
    f.step();
    f.start("P_ahu_supply_fan");
    f.start("P_boiler_stage");

    /* Chạy đủ lâu để CẢ HAI lớp chu kỳ release ít nhất một lần thật. */
    for (int cycle = 0; cycle < 60; ++cycle) {
        f.step();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    const std::string payload{f.web.snapshot_payload_for_test()};
    ASSERT_FALSE(payload.empty());
    const auto json = nlohmann::json::parse(payload);
    ASSERT_EQ(json.at("programs").size(), 2u);
    EXPECT_EQ(json.at("programs").at(0).at("instanceId"), "P_ahu_supply_fan");
    EXPECT_EQ(json.at("programs").at(0).at("periodMs").get<uint32_t>(), 50u);
    EXPECT_EQ(json.at("programs").at(0).at("state"), "RUNNING");
    EXPECT_GT(json.at("programs").at(0).at("lastRunMonoNs").get<uint64_t>(), 0u)
        << "Program 50 ms phải đã chạy thật";
    EXPECT_EQ(json.at("programs").at(1).at("instanceId"), "P_boiler_stage");
    EXPECT_EQ(json.at("programs").at(1).at("periodMs").get<uint32_t>(), 200u);
    EXPECT_EQ(json.at("programs").at(1).at("state"), "RUNNING");
    EXPECT_GT(json.at("programs").at(1).at("lastRunMonoNs").get<uint64_t>(), 0u)
        << "Program 200 ms phải đã chạy thật";
    EXPECT_LE(json.at("programs").at(1).at("lastRunMonoNs").get<uint64_t>(),
              json.at("capturedMonotonicNs").get<uint64_t>())
        << "mốc chạy phải cùng họ đồng hồ với capturedMonotonicNs";

    std::printf("\n===== T60-004 M1 POINT_SNAPSHOT DUMP BEGIN =====\n%s\n"
                "===== T60-004 M1 POINT_SNAPSHOT DUMP END =====\n",
                payload.c_str());
    std::fflush(stdout);
}
