/**
 * @file  test_safe_state.cpp
 * @brief Bảng trigger 07 §5: iop_status=FAULT → out safe; ts_ns đứng yên 4 scan →
 *        safe; hết fault → trả quyền cho resolver.
 */
#include <gtest/gtest.h>

#include "safe_state.hpp"

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
    q.evaluate(t, io);

    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f) << "0-10V safe = 0V";
    EXPECT_FLOAT_EQ(out.ao[1], 4.0f) << "4-20mA safe = 4mA";
    for (int i = 0; i < KX_N_DO; i++)
        EXPECT_EQ(out.dout[i], 0) << "DO open";
}

TEST(SafeState, StaleShm4ScansForcesSafe)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    q.evaluate(t, io);   /* fresh */
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active());
    EXPECT_EQ(out.dout[0], 1);

    /* ts đứng yên 4 scan → stale > 3 → safe */
    for (int i = 0; i < 4; i++)
        q.evaluate(t, io);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_EQ(out.dout[0], 0);
    EXPECT_FLOAT_EQ(out.ao[0], 0.0f);
}

TEST(SafeState, RecoveryReturnsControlToResolver)
{
    PointTable t;
    PointQuality q;
    SafeState s(q);

    IoSnapshot io = normal_io(100);
    io.iop_status = KX_IOP_FAULT;
    q.evaluate(t, io);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());

    /* hết fault + ts mới → trả quyền */
    io.iop_status = KX_IOP_NORMAL;
    io.ts_ns = 200;
    q.evaluate(t, io);
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
    q.evaluate(t, io);
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
    q.evaluate(t, io);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "AI0 GOOD → không trigger";

    /* kênh graph đang dùng (AI0) thành BAD → T6 trigger */
    io.ts_ns = 200;
    io.ui_quality[0] = KX_Q_BAD;
    t.update_inputs(io);
    q.evaluate(t, io);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active());
    EXPECT_EQ(out.dout[0], 0);

    /* kênh graph KHÔNG dùng (AI5) BAD → không trigger */
    io.ts_ns = 300;
    io.ui_quality[0] = KX_Q_GOOD;
    io.ui_quality[5] = KX_Q_BAD;
    t.update_inputs(io);
    q.evaluate(t, io);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "BAD trên kênh graph không dùng → kệ";
}

TEST(SafeState, T7NoGraphNoManualForcesSafe)
{
    PointTable t;
    PointQuality q;
    GraphRuntime g;                 /* KHÔNG load → loaded()=false */
    PriorityResolver r;
    SafeState s(q, &g, &r);

    IoSnapshot io = normal_io(100);
    q.evaluate(t, io);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_TRUE(s.active()) << "không graph + không manual → T7 safe";
    EXPECT_EQ(out.dout[0], 0);

    /* manual active (mức 2) → T7 hết trigger */
    r.set_do(PRIO_LOCAL_MANUAL, 0, true);
    io.ts_ns = 200;
    q.evaluate(t, io);
    out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "có manual active → có người điều khiển → thoát T7";
    EXPECT_EQ(out.dout[0], 1);

    /* release manual → T7 trigger lại */
    r.release_do(PRIO_LOCAL_MANUAL, 0);
    io.ts_ns = 300;
    q.evaluate(t, io);
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
    q.evaluate(t, io);
    OutputCmd out = active_out();
    s.apply(io, t, &out);
    EXPECT_FALSE(s.active()) << "graph loaded → T7 off dù không manual";
}
