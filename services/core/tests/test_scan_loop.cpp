/**
 * @file  test_scan_loop.cpp
 * @brief Không overrun với load giả (07 tests); flow end-to-end trong RAM:
 *        shm giả → reader → priority/safe-state → output_writer ghi do_cmd/ao_setpoint.
 */
#include <gtest/gtest.h>

#include <atomic>
#include <cstring>
#include <thread>

#include "scan_loop.hpp"

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
