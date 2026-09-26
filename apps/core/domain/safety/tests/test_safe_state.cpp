/**
 * @file  test_safe_state.cpp
 * @brief Bảng trigger 07 §5: iop_status=FAULT → out safe; ts_ns đứng yên quá
 *        max(5 base step, 500 ms) → safe (T3, ADR-061 4.7); hết fault → trả quyền
 *        cho resolver.
 */
#include <gtest/gtest.h>

#include "safety/safe_state.hpp"

using namespace core;

namespace {

IoSnapshot normal_io(uint64_t ts)
{
    IoSnapshot io;
    io.ts_ns = ts;
    io.iop_status = KX_IOP_NORMAL;
    io.valid = true;
    return io;
}

OutputCmd active_out()
{
    OutputCmd out;
    for (int i = 0; i < KX_N_AO; i++) { out.ao[i] = 8.0f; out.ao_valid[i] = true; }
    for (int i = 0; i < KX_N_DO; i++) { out.dout[i] = 1; out.do_valid[i] = true; }
    return out;
}

} // namespace

TEST(SafeState, IopFaultForcesSafeOutputs)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    io.iop_status = KX_IOP_FAULT;
    io.ao_mode[1] = 1;   /* AO2 = 4-20mA */
    q.evaluate(t, io, 0);

    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f) << "0-10V safe = 0V";
    EXPECT_FLOAT_EQ(out.ao[1], 4.0f) << "4-20mA safe = 4mA";
    for (int i = 0; i < KX_N_DO; i++)
        EXPECT_EQ(out.dout[i], 0) << "DO open";
}

TEST(SafeState, StaleShmForcesSafeAfterHalfSecondOnTenMsBaseStep)
{
    /* ADR-061 4.7: base step 10 ms → UNCERTAIN sau 250 ms, T3 sau 500 ms. Luật
     * "3 scan" cũ ép safe sau 30 ms — ngắn hơn một vòng IOP bình thường. */
    constexpr uint64_t kMs = 1000000ull;
    PointTable t;
    PointQuality q;
    q.set_base_step_ns(10 * kMs);
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    q.evaluate(t, io, 0);   /* fresh */
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active());
    EXPECT_EQ(out.dout[0], 1);

    /* ts đứng yên 40 ms (4 base step): theo luật cũ đã safe; nay còn GOOD. */
    for (uint64_t now = 10 * kMs; now <= 40 * kMs; now += 10 * kMs) q.evaluate(t, io, now);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "40 ms stale ở base 10 ms không được ép safe";

    /* 300 ms: UNCERTAIN nhưng CHƯA T3 — UNCERTAIN chỉ hạ quality. */
    q.evaluate(t, io, 300 * kMs);
    EXPECT_TRUE(q.is_stale());
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "UNCERTAIN không ép đầu ra";

    /* Đúng 500 ms: tuổi BẰNG ngưỡng chưa phải stale BAD (luật `>` như cũ). */
    q.evaluate(t, io, 500 * kMs);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active());

    q.evaluate(t, io, 510 * kMs);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_TRUE(s.triggers().stale);
    EXPECT_EQ(out.dout[0], 0);
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f);
}

TEST(SafeState, StaleThresholdScalesWithLongBaseStep)
{
    /* Base step 1 s (dev `--scan-ms 1000`): max(5 step, 500 ms) = 5 s — giữ đúng
     * hành vi "quá 5 scan" cũ khi base step dài. */
    constexpr uint64_t kMs = 1000000ull;
    PointTable t;
    PointQuality q;
    q.set_base_step_ns(1000 * kMs);
    SafeState s(q);
    IoSnapshot io = normal_io(100);
    q.evaluate(t, io, 0);
    q.evaluate(t, io, 5000 * kMs);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active());
    q.evaluate(t, io, 6000 * kMs);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
}

TEST(SafeState, RecoveryReturnsControlToResolver)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    io.iop_status = KX_IOP_FAULT;
    q.evaluate(t, io, 0);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());

    /* hết fault + ts mới → trả quyền */
    io.iop_status = KX_IOP_NORMAL;
    io.ts_ns = 200;
    q.evaluate(t, io, 0);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active());
    EXPECT_EQ(out.dout[0], 1) << "resolver giữ nguyên giá trị";
    EXPECT_FLOAT_EQ(out.ao[0], 8.0f);
}

TEST(SafeState, SafeStatusAlsoTriggers)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    io.iop_status = KX_IOP_SAFE;
    q.evaluate(t, io, 0);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_EQ(out.dout[2], 0);
}

/* ---- T6/T7 (07 §5.2 — implemented Rev A theo quyết định 2026-06-12) ---- */

namespace {

const char* kGraphAi0 = R"({
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1, "name": "t", "scan_ms": 1000 },
  "io_map": {},
  "nodes": [
    { "id": "ai1", "type": "AI_Input", "params": { "channel": 0 } },
    { "id": "sp1", "type": "Setpoint", "params": { "default": 25.0 } },
    { "id": "c1",  "type": "Compare_GT", "params": {} },
    { "id": "do1", "type": "DO_Output", "params": { "channel": 0 } }
  ],
  "links": [
    { "from": "ai1.out", "to": "c1.a" },
    { "from": "sp1.out", "to": "c1.b" },
    { "from": "c1.out",  "to": "do1.in" }
  ]
})";

} // namespace

TEST(SafeState, T6GraphInputBadForcesSafe)
{
    PointTable t;
    PointQuality q;
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(kGraphAi0));
    PriorityResolver r;
    SafeState s(q, &g, &r);

    IoSnapshot io = normal_io(100);
    io.ui_quality[0] = KX_Q_GOOD;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "AI0 GOOD → không trigger";

    /* kênh graph đang dùng (AI0) thành BAD → T6 trigger */
    io.ts_ns = 200;
    io.ui_quality[0] = KX_Q_BAD;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_EQ(out.dout[0], 0);

    /* kênh graph KHÔNG dùng (AI5) BAD → không trigger */
    io.ts_ns = 300;
    io.ui_quality[0] = KX_Q_GOOD;
    io.ui_quality[5] = KX_Q_BAD;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "BAD trên kênh graph không dùng → kệ";
}

TEST(SafeState, ProgramOwnerIgnoresInactiveGraphInputPolicy)
{
    PointTable t;
    PointQuality q;
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(kGraphAi0));
    PriorityResolver r;
    SafeState s(q, &g, &r);

    IoSnapshot io = normal_io(100);
    io.ui_quality[0] = KX_Q_BAD;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    ASSERT_TRUE(r.set_do(PRIO_LOCAL_MANUAL, 0, true));
    OutputCmd out = r.resolve();

    s.apply(io, t, &out, false);

    EXPECT_FALSE(s.active());
    EXPECT_FALSE(s.triggers().graph_input_bad)
        << "graph giữ để rollback không còn là safety authority trong PROGRAM_ONLY";
    EXPECT_FALSE(s.triggers().no_controller) << "manual vẫn là nguồn điều khiển hợp lệ";
    EXPECT_EQ(out.dout[0], 1);
}

TEST(SafeState, ProgramOwnerDetectsNoControllerEvenWhenRollbackGraphIsLoaded)
{
    PointTable t;
    PointQuality q;
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(kGraphAi0));
    PriorityResolver r;
    SafeState s(q, &g, &r);

    IoSnapshot io = normal_io(100);
    io.ui_quality[0] = KX_Q_GOOD;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    OutputCmd out = active_out();

    s.apply(io, t, &out, false);

    EXPECT_TRUE(s.active());
    EXPECT_TRUE(s.triggers().no_controller)
        << "graph inactive không được che việc Program chưa publish output";
    EXPECT_FALSE(s.triggers().graph_input_bad);
}

TEST(SafeState, T7NoGraphNoManualForcesSafe)
{
    PointTable t;
    PointQuality q;
    GraphRuntime g;                 /* KHÔNG load → loaded()=false */
    PriorityResolver r;
    SafeState s(q, &g, &r);

    IoSnapshot io = normal_io(100);
    q.evaluate(t, io, 0);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active()) << "không graph + không manual → T7 safe";
    EXPECT_EQ(out.dout[0], 0);

    /* manual active (mức 2) → T7 hết trigger */
    r.set_do(PRIO_LOCAL_MANUAL, 0, true);
    io.ts_ns = 200;
    q.evaluate(t, io, 0);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "có manual active → có người điều khiển → thoát T7";
    EXPECT_EQ(out.dout[0], 1);

    /* release manual → T7 trigger lại */
    r.release_do(PRIO_LOCAL_MANUAL, 0);
    io.ts_ns = 300;
    q.evaluate(t, io, 0);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
}

TEST(SafeState, T7OffWhenGraphLoaded)
{
    PointTable t;
    PointQuality q;
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(kGraphAi0));
    PriorityResolver r;
    SafeState s(q, &g, &r);

    IoSnapshot io = normal_io(100);
    io.ui_quality[0] = KX_Q_GOOD;
    t.update_inputs(io);
    q.evaluate(t, io, 0);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "graph loaded → T7 off dù không manual";
}

/* ---- T8: Task overrun (ACTION 7 / TASK_SAFETY_GATE) ---- */

TEST(SafeState, OverrunMonitorForcesSafeWhenThresholdReached)
{
    PointQuality quality;
    OverrunMonitor mon(2);
    SafeState safe(quality);
    safe.set_overrun_monitor(&mon);

    IoSnapshot io{};
    io.iop_status = KX_IOP_NORMAL;
    PointTable table;
    OutputCmd out{};
    out.ao[0] = 7.5f;
    out.ao_valid[0] = true;
    out.dout[0] = 1;
    out.do_valid[0] = true;

    /* Chưa overrun -> không đụng output. */
    safe.apply(io, table, &out);
    EXPECT_FALSE(safe.active());
    EXPECT_FLOAT_EQ(out.ao[0], 7.5f);

    mon.record(1000, 100);
    mon.record(1000, 100);
    ASSERT_TRUE(mon.should_force_safe());

    out.ao[0] = 7.5f;
    out.dout[0] = 1;
    safe.apply(io, table, &out);
    EXPECT_TRUE(safe.active());
    EXPECT_TRUE(safe.triggers().overrun);
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f) << "AO phải về safe";
    EXPECT_EQ(out.dout[0], 0) << "DO phải mở";
}

TEST(SafeState, OverrunSafeReleasedAfterRecoveryStreak)
{
    PointQuality quality;
    OverrunMonitor mon(2);
    SafeState safe(quality);
    safe.set_overrun_monitor(&mon);

    IoSnapshot io{};
    io.iop_status = KX_IOP_NORMAL;
    PointTable table;
    OutputCmd out{};

    mon.record(1000, 100);
    mon.record(1000, 100);
    safe.apply(io, table, &out);
    ASSERT_TRUE(safe.active());

    mon.record(10, 100);
    safe.apply(io, table, &out);
    EXPECT_TRUE(safe.active()) << "một lần tốt chưa đủ để rời safe";

    mon.record(10, 100);
    out.ao[0] = 7.5f;
    safe.apply(io, table, &out);
    EXPECT_FALSE(safe.active());
    EXPECT_FLOAT_EQ(out.ao[0], 7.5f) << "rời safe thì trả quyền cho resolver";
}

TEST(SafeState, WithoutMonitorOverrunTriggerNeverFires)
{
    /* Không gắn monitor = T8 không được đánh giá; các trigger khác không đổi. */
    PointQuality quality;
    SafeState safe(quality);
    IoSnapshot io{};
    io.iop_status = KX_IOP_NORMAL;
    PointTable table;
    OutputCmd out{};
    safe.apply(io, table, &out);
    EXPECT_FALSE(safe.triggers().overrun);
}
