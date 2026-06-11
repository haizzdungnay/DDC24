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
    OutputWriter writer{&shm};
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
