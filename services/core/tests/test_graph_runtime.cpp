/**
 * @file  test_graph_runtime.cpp
 * @brief Graph engine Rev A: load/validate (dup id, type lạ, multi-wire, cycle,
 *        schema_version), execute topo order, sink ghi resolver MỨC 5,
 *        used_ai_channels cho T6, PID/Scale/Compare hành vi cơ bản.
 */
#include <gtest/gtest.h>

#include "graph_runtime.hpp"

using namespace core;

namespace {

IoSnapshot io_with_ai(int ch, float v)
{
    IoSnapshot io;
    io.ts_ns = 1;
    io.iop_status = KX_IOP_NORMAL;
    io.ui_value[ch] = v;
    io.ui_quality[ch] = KX_Q_GOOD;
    io.valid = true;
    return io;
}

const char* kThermostat = R"({
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1, "name": "t", "scan_ms": 1000 },
  "io_map": {},
  "nodes": [
    { "id": "ai1", "type": "AI_Input", "params": { "channel": 0 } },
    { "id": "sp1", "type": "Setpoint", "params": { "default": 25.0 } },
    { "id": "c1",  "type": "Compare_GT", "params": { "hysteresis": 1.0 } },
    { "id": "do1", "type": "DO_Output", "params": { "channel": 0 } }
  ],
  "links": [
    { "from": "ai1.out", "to": "c1.a" },
    { "from": "sp1.out", "to": "c1.b" },
    { "from": "c1.out",  "to": "do1.in" }
  ]
})";

} // namespace

TEST(GraphRuntime, LoadValidGraph)
{
    GraphRuntime g;
    EXPECT_TRUE(g.load_string(kThermostat));
    EXPECT_TRUE(g.loaded());
    ASSERT_EQ(g.used_ai_channels().size(), 1u);
    EXPECT_EQ(g.used_ai_channels()[0], 0);
    EXPECT_EQ(g.scan_ms(), 1000u);
}

TEST(GraphRuntime, ThermostatControlsDoViaResolverLevel5)
{
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(kThermostat));
    PointTable t;
    PriorityResolver r;

    /* nhiệt 30 > sp 25 → DO1 on */
    t.update_inputs(io_with_ai(0, 30.0f));
    g.execute(t, r);
    OutputCmd out = r.resolve();
    EXPECT_EQ(out.dout[0], 1);

    /* nhiệt 24.5 — trong vùng hysteresis (sp-h=24) → vẫn on */
    t.update_inputs(io_with_ai(0, 24.5f));
    g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 1) << "hysteresis giữ trạng thái";

    /* nhiệt 23 < 24 → off */
    t.update_inputs(io_with_ai(0, 23.0f));
    g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 0);

    /* mức 5 phải thua manual mức 2 */
    t.update_inputs(io_with_ai(0, 30.0f));
    g.execute(t, r);
    r.set_do(PRIO_LOCAL_MANUAL, 0, false);
    EXPECT_EQ(r.resolve().dout[0], 0) << "manual thắng logic";
}

TEST(GraphRuntime, ScaleAndAoOutputPercentToEng)
{
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(R"({
      "schema_version": "1.0",
      "device": { "bacnet_device_id": 1, "name": "t", "scan_ms": 1000 },
      "io_map": {},
      "nodes": [
        { "id": "ai1", "type": "AI_Input", "params": { "channel": 1 } },
        { "id": "sc1", "type": "Scale", "params": { "in_lo": 0, "in_hi": 10, "out_lo": 0, "out_hi": 100 } },
        { "id": "ao1", "type": "AO_Output", "params": { "channel": 0, "limit_lo": 0, "limit_hi": 100 }, "power_on": { "in": 0 } }
      ],
      "links": [
        { "from": "ai1.out", "to": "sc1.in" },
        { "from": "sc1.out", "to": "ao1.in" }
      ]
    })"));
    PointTable t;
    PriorityResolver r;

    t.update_inputs(io_with_ai(1, 5.0f));   /* 5V → 50% → AO 0-10V = 5.0V eng */
    g.execute(t, r);
    OutputCmd out = r.resolve();
    ASSERT_TRUE(out.ao_valid[0]);
    EXPECT_NEAR(out.ao[0], 5.0f, 0.01f);
}

TEST(GraphRuntime, PidConverges)
{
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(R"({
      "schema_version": "1.0",
      "device": { "bacnet_device_id": 1, "name": "t", "scan_ms": 1000 },
      "io_map": {},
      "nodes": [
        { "id": "ai1",  "type": "AI_Input", "params": { "channel": 0 } },
        { "id": "sp1",  "type": "Setpoint", "params": { "default": 5.0 } },
        { "id": "pid1", "type": "PID", "params": { "kp": 2.0, "ki": 0.5, "kd": 0, "out_lo": 0, "out_hi": 100 }, "power_on": { "out": 0 } },
        { "id": "ao1",  "type": "AO_Output", "params": { "channel": 0, "limit_lo": 0, "limit_hi": 100 }, "power_on": { "in": 0 } }
      ],
      "links": [
        { "from": "ai1.out",  "to": "pid1.pv" },
        { "from": "sp1.out",  "to": "pid1.sp" },
        { "from": "pid1.out", "to": "ao1.in" }
      ]
    })"));
    PointTable t;
    PriorityResolver r;

    /* pv=0, sp=5 → error dương → output tăng dần (ki tích lũy) */
    t.update_inputs(io_with_ai(0, 0.0f));
    g.execute(t, r);
    const float u1 = r.resolve().ao[0];
    g.execute(t, r);
    const float u2 = r.resolve().ao[0];
    EXPECT_GT(u1, 0.0f);
    EXPECT_GT(u2, u1) << "tích phân tăng khi error dương";

    /* pv = sp → error 0 → output giữ (chỉ còn tích phân cũ) */
    t.update_inputs(io_with_ai(0, 5.0f));
    g.execute(t, r);
    const float u3 = r.resolve().ao[0];
    g.execute(t, r);
    const float u4 = r.resolve().ao[0];
    EXPECT_NEAR(u3, u4, 0.01f) << "error=0 → output ổn định";
}

TEST(GraphRuntime, RejectsBadGraphs)
{
    GraphRuntime g;

    EXPECT_FALSE(g.load_string("khong json")) << "JSON hỏng";
    EXPECT_FALSE(g.load_string(R"({"schema_version":"2.0","nodes":[],"links":[]})"))
        << "schema_version lạ";

    EXPECT_FALSE(g.load_string(R"({
      "schema_version": "1.0",
      "nodes": [
        { "id": "a", "type": "Setpoint", "params": {} },
        { "id": "a", "type": "Setpoint", "params": {} }
      ],
      "links": []
    })")) << "id trùng";

    EXPECT_FALSE(g.load_string(R"({
      "schema_version": "1.0",
      "nodes": [ { "id": "a", "type": "FlimFlam", "params": {} } ],
      "links": []
    })")) << "type ngoài component library";

    EXPECT_FALSE(g.load_string(R"({
      "schema_version": "1.0",
      "nodes": [
        { "id": "a", "type": "Setpoint", "params": {} },
        { "id": "b", "type": "Setpoint", "params": {} },
        { "id": "n", "type": "NOT", "params": {} }
      ],
      "links": [
        { "from": "a.out", "to": "n.in" },
        { "from": "b.out", "to": "n.in" }
      ]
    })")) << "2 wire vào 1 input";

    EXPECT_FALSE(g.load_string(R"({
      "schema_version": "1.0",
      "nodes": [
        { "id": "n1", "type": "NOT", "params": {} },
        { "id": "n2", "type": "NOT", "params": {} }
      ],
      "links": [
        { "from": "n1.out", "to": "n2.in" },
        { "from": "n2.out", "to": "n1.in" }
      ]
    })")) << "cycle";

    EXPECT_FALSE(g.load_string(R"({
      "schema_version": "1.0",
      "nodes": [ { "id": "do1", "type": "DO_Output", "params": { "channel": 9 } } ],
      "links": []
    })")) << "channel ngoài dải";

    EXPECT_FALSE(g.loaded()) << "mọi lần fail phải giữ loaded()=false";
}

TEST(GraphRuntime, NotLoadedExecuteIsNoop)
{
    GraphRuntime g;
    PointTable t;
    PriorityResolver r;
    g.execute(t, r);
    EXPECT_FALSE(r.any_active_above_default());
}
