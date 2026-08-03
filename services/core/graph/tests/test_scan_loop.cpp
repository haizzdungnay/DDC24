/**
 * @file  test_scan_loop.cpp
 * @brief Không overrun với load giả (07 tests); flow end-to-end trong RAM:
 *        shm giả → reader → priority/safe-state → output_writer ghi do_cmd/ao_setpoint.
 */
#include <gtest/gtest.h>

#include <atomic>
#include <cstring>
#include <thread>

#include "graph/scan_loop.hpp"

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
