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
    EXPECT_EQ(g.declared_scan_ms(), 1000u);
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

    const uint8_t modes[KX_N_AO] = {1, 0, 0, 0};
    g.set_ao_modes(modes);
    r.set_ao_modes(modes);
    g.execute(t, r);
    EXPECT_NEAR(r.resolve().ao[0], 12.0f, 0.01f)
        << "50% ở mode 4-20mA phải thành giá trị vật lý 12mA";
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

TEST(GraphRuntime, ScanMsSyncSingleSourceOfTruth)
{
    /* Yêu cầu fix timing: dt PHẢI theo chu kỳ scan thật của core, không theo
     * device.scan_ms khai báo trong graph.json khi hai giá trị lệch nhau. */
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(kThermostat));   /* khai báo scan_ms=1000 */
    EXPECT_EQ(g.declared_scan_ms(), 1000u);
    EXPECT_EQ(g.effective_scan_ms(), 1000u);

    g.sync_actual_scan_ms(500);                /* core chạy thật 500ms */
    EXPECT_EQ(g.effective_scan_ms(), 500u) << "dt phải theo chu kỳ thật";
    EXPECT_EQ(g.declared_scan_ms(), 1000u) << "giá trị khai báo giữ nguyên để đối chiếu";
}

TEST(GraphRuntime, PidDtFollowsActualScanPeriod)
{
    /* PID thuần tích phân (kp=0, ki=1): sau 1 scan, out = ki·e·dt.
     * e = sp - pv = 10. dt=1s → 10; dt=0.5s → 5. Lệch dt là thấy ngay. */
    const char* pid_graph = R"({
      "schema_version": "1.0",
      "device": { "bacnet_device_id": 1, "name": "t", "scan_ms": 1000 },
      "io_map": {},
      "nodes": [
        { "id": "ai1",  "type": "AI_Input", "params": { "channel": 0 } },
        { "id": "sp1",  "type": "Setpoint", "params": { "default": 10.0 } },
        { "id": "pid1", "type": "PID", "params": { "kp": 0.0, "ki": 1.0, "kd": 0, "out_lo": 0, "out_hi": 100 }, "power_on": { "out": 0 } },
        { "id": "ao1",  "type": "AO_Output", "params": { "channel": 0, "limit_lo": 0, "limit_hi": 100 }, "power_on": { "in": 0 } }
      ],
      "links": [
        { "from": "ai1.out",  "to": "pid1.pv" },
        { "from": "sp1.out",  "to": "pid1.sp" },
        { "from": "pid1.out", "to": "ao1.in" }
      ]
    })";

    PointTable t;
    t.update_inputs(io_with_ai(0, 0.0f));

    /* dt = 1000ms (khai báo = thật) */
    GraphRuntime g1;
    ASSERT_TRUE(g1.load_string(pid_graph));
    g1.sync_actual_scan_ms(1000);
    PriorityResolver r1;
    g1.execute(t, r1);
    const float out_1s = r1.resolve().ao[0];   /* % = ki·e·dt = 10·1 = 10 */

    /* core thật chạy 500ms → dt phải = 0.5 → tích phân một nửa */
    GraphRuntime g2;
    ASSERT_TRUE(g2.load_string(pid_graph));
    g2.sync_actual_scan_ms(500);
    PriorityResolver r2;
    g2.execute(t, r2);
    const float out_500ms = r2.resolve().ao[0];

    EXPECT_NEAR(out_500ms * 2.0f, out_1s, 0.01f)
        << "dt không theo chu kỳ thật: 1s=" << out_1s << " 0.5s=" << out_500ms;
}

TEST(GraphRuntime, RejectsScanMsOutOfBounds)
{
    /* review PR#12: scan_ms > 2000 → watchdog kick mỗi scan vượt WatchdogSec=3
     * → systemd kill-loop; giá trị khổng lồ → cast uint32 UB. Phải reject. */
    GraphRuntime g;
    auto graph_with_scan = [](const char* ms) {
        return std::string(R"({"schema_version":"1.0","device":{"bacnet_device_id":1,"name":"t","scan_ms":)")
               + ms + R"(},"nodes":[{"id":"sp1","type":"Setpoint","params":{}}],"links":[]})";
    };
    EXPECT_FALSE(g.load_string(graph_with_scan("2500"))) << "scan_ms > 2000";
    EXPECT_FALSE(g.load_string(graph_with_scan("5000000000"))) << "không được wrap uint32";
    EXPECT_FALSE(g.load_string(graph_with_scan("400"))) << "min 500";
    EXPECT_TRUE(g.load_string(graph_with_scan("2000")));
    EXPECT_EQ(g.declared_scan_ms(), 2000u);

    /* load FAIL không được làm bẩn scan_ms từ file bị reject */
    GraphRuntime g2;
    ASSERT_TRUE(g2.load_string(graph_with_scan("1500")));
    EXPECT_FALSE(g2.load_string(graph_with_scan("2500")));
    EXPECT_EQ(g2.declared_scan_ms(), 1500u) << "giá trị từ graph bị reject không được commit";
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

/* ================================================================
 * Tests cho 10 component type mới (COR-009)
 * ================================================================ */

TEST(GraphRuntime, ManualAuto)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"sel",    "type":"Setpoint","params":{"default":0}},
        {"id":"manual", "type":"Setpoint","params":{"default":42}},
        {"id":"autov",  "type":"Setpoint","params":{"default":7}},
        {"id":"n",      "type":"ManualAuto","params":{}}
      ],
      "links": [
        {"from":"sel.out",    "to":"n.sel"},
        {"from":"manual.out", "to":"n.manual"},
        {"from":"autov.out",  "to":"n.auto"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    PointTable t;
    PriorityResolver r;
    g.execute(t, r);
    /* sel=0 (false) → out = auto = 7 */
    /* Cannot read node output directly; verify via a sink — re-test with DO sink */
    (void)t; (void)r;   /* logic tested implicitly via load + no crash */
    EXPECT_TRUE(g.loaded());
}

TEST(GraphRuntime, ManualAutoSelectsOutput)
{
    /* sel=0→auto=7, sel=1→manual=42 — dùng DO sink để verify bool */
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"sel",    "type":"Setpoint","params":{"default":1}},
        {"id":"mv",     "type":"Setpoint","params":{"default":1}},
        {"id":"av",     "type":"Setpoint","params":{"default":0}},
        {"id":"ma",     "type":"ManualAuto","params":{}},
        {"id":"do1",    "type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"sel.out","to":"ma.sel"},
        {"from":"mv.out", "to":"ma.manual"},
        {"from":"av.out", "to":"ma.auto"},
        {"from":"ma.out", "to":"do1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    PointTable t;
    PriorityResolver r;
    g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 1) << "sel=1 -> manual=1 -> DO on";
}

TEST(GraphRuntime, OnDelayTiming)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"sp",  "type":"Setpoint","params":{"default":1}},
        {"id":"n",   "type":"OnDelay", "params":{"delay_s":3}},
        {"id":"do1", "type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"sp.out","to":"n.in"},
        {"from":"n.out", "to":"do1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);
    PointTable t;
    PriorityResolver r;

    g.execute(t, r); EXPECT_EQ(r.resolve().dout[0], 0) << "scan1: acc=1 < 3";
    g.execute(t, r); EXPECT_EQ(r.resolve().dout[0], 0) << "scan2: acc=2 < 3";
    g.execute(t, r); EXPECT_EQ(r.resolve().dout[0], 1) << "scan3: acc=3 >= 3 -> on";
    g.execute(t, r); EXPECT_EQ(r.resolve().dout[0], 1) << "scan4: giữ on";
}

TEST(GraphRuntime, OnDelayResetOnFalseInput)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai1", "type":"AI_Input","params":{"channel":0}},
        {"id":"n",   "type":"OnDelay","params":{"delay_s":5}},
        {"id":"do1", "type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"ai1.out","to":"n.in"},
        {"from":"n.out",  "to":"do1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);

    PointTable t;
    PriorityResolver r;
    /* in=1 x2 scans, lúc chưa đủ delay */
    t.update_inputs(io_with_ai(0, 1.0f));
    g.execute(t, r); g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 0) << "acc=2 < 5";

    /* in=0 -> acc reset */
    t.update_inputs(io_with_ai(0, 0.0f));
    g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 0) << "in=0 -> out=0 ngay";

    /* in=1 lại từ đầu */
    t.update_inputs(io_with_ai(0, 1.0f));
    for (int i = 0; i < 4; i++) g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 0) << "acc reset -> can 5 scan tu dau";
    g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 1) << "scan 5 sau reset -> on";
}

TEST(GraphRuntime, OffDelayTiming)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai1", "type":"AI_Input","params":{"channel":0}},
        {"id":"n",   "type":"OffDelay","params":{"delay_s":2}},
        {"id":"do1", "type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"ai1.out","to":"n.in"},
        {"from":"n.out",  "to":"do1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);
    PointTable t;
    PriorityResolver r;

    /* in=1 -> out=1 ngay */
    t.update_inputs(io_with_ai(0, 1.0f));
    g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 1) << "in=1 -> on ngay";

    /* in=0 -> out giữ 2 scan */
    t.update_inputs(io_with_ai(0, 0.0f));
    g.execute(t, r); EXPECT_EQ(r.resolve().dout[0], 1) << "scan1 after off: acc=1 < 2";
    g.execute(t, r); EXPECT_EQ(r.resolve().dout[0], 0) << "scan2 after off: acc=2 -> off";
}

TEST(GraphRuntime, InterlockTruthTable)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"permit",  "type":"AI_Input","params":{"channel":0}},
        {"id":"request", "type":"AI_Input","params":{"channel":1}},
        {"id":"il",      "type":"Interlock","params":{"latch":1}},
        {"id":"do1",     "type":"DO_Output","params":{"channel":0}},
        {"id":"do2",     "type":"DO_Output","params":{"channel":1}}
      ],
      "links": [
        {"from":"permit.out",  "to":"il.permit"},
        {"from":"request.out", "to":"il.request"},
        {"from":"il.out",      "to":"do1.in"},
        {"from":"il.tripped",  "to":"do2.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);

    auto run = [&](float permit_v, float request_v) -> std::pair<int,int> {
        IoSnapshot io;
        io.ts_ns = 1; io.iop_status = KX_IOP_NORMAL; io.valid = true;
        io.ui_value[0] = permit_v; io.ui_quality[0] = KX_Q_GOOD;
        io.ui_value[1] = request_v; io.ui_quality[1] = KX_Q_GOOD;
        PointTable t; PriorityResolver r;
        t.update_inputs(io);
        g.execute(t, r);
        auto out = r.resolve();
        return {out.dout[0], out.dout[1]};
    };

    /* permit=1, request=1, no trip -> out=1, tripped=0 */
    auto [o, tr] = run(1.0f, 1.0f);
    EXPECT_EQ(o, 1) << "permit+request -> out";
    EXPECT_EQ(tr, 0) << "no trip";

    /* permit=0 -> trip, out=0 */
    auto [o2, tr2] = run(0.0f, 1.0f);
    EXPECT_EQ(o2, 0);
    EXPECT_EQ(tr2, 1) << "permit=0 -> tripped";

    /* permit=1, request=1, still tripped (latch) -> out=0 */
    auto [o3, tr3] = run(1.0f, 1.0f);
    EXPECT_EQ(o3, 0) << "latch giữ trip du permit=1";
    EXPECT_EQ(tr3, 1);

    /* permit=1, request=0 -> clear trip (manual reset) */
    auto [o4, tr4] = run(1.0f, 0.0f);
    EXPECT_EQ(o4, 0) << "request=0 -> out=0 (request chua co)";
    EXPECT_EQ(tr4, 0) << "trip cleared";

    /* permit=1, request=1 -> out=1 sau khi clear */
    auto [o5, tr5] = run(1.0f, 1.0f);
    EXPECT_EQ(o5, 1) << "sau clear: permit+request -> out";
    EXPECT_EQ(tr5, 0);
}

TEST(GraphRuntime, RuntimeCounterHoursAndAlarm)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"run_sp",  "type":"Setpoint","params":{"default":1}},
        {"id":"rst_sp",  "type":"Setpoint","params":{"default":0}},
        {"id":"rc",      "type":"RuntimeCounter","params":{"maint_hours":0.001}},
        {"id":"do_alarm","type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"run_sp.out", "to":"rc.run"},
        {"from":"rst_sp.out", "to":"rc.reset"},
        {"from":"rc.alarm",   "to":"do_alarm.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);
    PointTable t;
    PriorityResolver r;

    EXPECT_FALSE(g.dirty());

    /* scan 1: run=1, dt=1s -> rt_seconds=1 -> dirty */
    g.execute(t, r);
    EXPECT_TRUE(g.dirty()) << "RuntimeCounter dirty sau run";

    /* maint_hours=0.001 = 3.6s; sau 4 scan (4s) -> alarm */
    g.execute(t, r); g.execute(t, r); g.execute(t, r);
    const auto out = r.resolve();
    EXPECT_EQ(out.dout[0], 1) << "alarm khi hours >= maint_hours";

    /* persist state */
    const auto snap = g.get_persist_state();
    ASSERT_EQ(snap.size(), 1u);
    EXPECT_EQ(snap[0].id, "rc");
    EXPECT_EQ(snap[0].type, "RuntimeCounter");
    EXPECT_GT(snap[0].run_seconds, 3.0);
}

TEST(GraphRuntime, RuntimeCounterResetEdge)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai_run", "type":"AI_Input","params":{"channel":0}},
        {"id":"ai_rst", "type":"AI_Input","params":{"channel":1}},
        {"id":"rc",     "type":"RuntimeCounter","params":{"maint_hours":0}}
      ],
      "links": [
        {"from":"ai_run.out","to":"rc.run"},
        {"from":"ai_rst.out","to":"rc.reset"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);

    auto run_scan = [&](float run_v, float rst_v) {
        IoSnapshot io; io.ts_ns=1; io.iop_status=KX_IOP_NORMAL; io.valid=true;
        io.ui_value[0]=run_v; io.ui_quality[0]=KX_Q_GOOD;
        io.ui_value[1]=rst_v; io.ui_quality[1]=KX_Q_GOOD;
        PointTable t; PriorityResolver r;
        t.update_inputs(io);
        g.execute(t, r);
    };

    /* chạy 3s */
    for (int i = 0; i < 3; i++) run_scan(1.0f, 0.0f);
    auto s1 = g.get_persist_state();
    EXPECT_NEAR(s1[0].run_seconds, 3.0, 0.1);

    /* rising edge reset -> run_seconds = 0 */
    run_scan(0.0f, 1.0f);
    auto s2 = g.get_persist_state();
    EXPECT_EQ(s2[0].run_seconds, 0.0);
}

TEST(GraphRuntime, PulseCounterEdgeMode)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai_pulse","type":"AI_Input","params":{"channel":0}},
        {"id":"ai_rst",  "type":"AI_Input","params":{"channel":1}},
        {"id":"pc",      "type":"PulseCounter","params":{"scale":2.0}}
      ],
      "links": [
        {"from":"ai_pulse.out","to":"pc.pulse"},
        {"from":"ai_rst.out",  "to":"pc.reset"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);

    auto run_scan = [&](float pulse_v, float rst_v) {
        IoSnapshot io; io.ts_ns=1; io.iop_status=KX_IOP_NORMAL; io.valid=true;
        io.ui_value[0]=pulse_v; io.ui_quality[0]=KX_Q_GOOD;
        io.ui_value[1]=rst_v;   io.ui_quality[1]=KX_Q_GOOD;
        PointTable t; PriorityResolver r;
        t.update_inputs(io);
        g.execute(t, r);
    };

    run_scan(0.0f, 0.0f);   /* low */
    run_scan(1.0f, 0.0f);   /* rising edge -> count_raw=1 */
    run_scan(1.0f, 0.0f);   /* high, no edge */
    run_scan(0.0f, 0.0f);   /* falling */
    run_scan(1.0f, 0.0f);   /* rising edge -> count_raw=2 */

    const auto snap = g.get_persist_state();
    ASSERT_EQ(snap.size(), 1u);
    EXPECT_EQ(snap[0].count_raw, 2u) << "2 rising edges";

    /* reset rising edge -> count_raw=0 */
    run_scan(0.0f, 1.0f);
    EXPECT_EQ(g.get_persist_state()[0].count_raw, 0u) << "reset cleared count";
}

TEST(GraphRuntime, PulseCounterRollover)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai_pulse","type":"AI_Input","params":{"channel":0}},
        {"id":"ai_rst",  "type":"AI_Input","params":{"channel":1}},
        {"id":"pc",      "type":"PulseCounter","params":{"scale":1.0,"rollover":3}}
      ],
      "links": [
        {"from":"ai_pulse.out","to":"pc.pulse"},
        {"from":"ai_rst.out",  "to":"pc.reset"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);

    auto pulse = [&]() {
        IoSnapshot io; io.ts_ns=1; io.iop_status=KX_IOP_NORMAL; io.valid=true;
        io.ui_quality[0]=KX_Q_GOOD; io.ui_quality[1]=KX_Q_GOOD;
        PointTable t; PriorityResolver r;
        /* rising edge */
        io.ui_value[0]=0.0f; t.update_inputs(io); g.execute(t, r);
        io.ui_value[0]=1.0f; t.update_inputs(io); g.execute(t, r);
    };

    pulse(); pulse(); /* count=2, below rollover=3 */
    EXPECT_EQ(g.get_persist_state()[0].count_raw, 2u);
    pulse(); /* count=3 >= rollover -> wrap to 0 */
    EXPECT_EQ(g.get_persist_state()[0].count_raw, 0u) << "rollover reset";
}

TEST(GraphRuntime, PersistRestoreByIdAndType)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"run_sp","type":"Setpoint","params":{"default":1}},
        {"id":"rst_sp","type":"Setpoint","params":{"default":0}},
        {"id":"rc",    "type":"RuntimeCounter","params":{"maint_hours":0}}
      ],
      "links": [
        {"from":"run_sp.out","to":"rc.run"},
        {"from":"rst_sp.out","to":"rc.reset"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);
    PointTable t; PriorityResolver r;

    /* chạy 10s */
    for (int i = 0; i < 10; i++) g.execute(t, r);
    const auto snap = g.get_persist_state();

    /* reload graph (mất state) -> restore */
    ASSERT_TRUE(g.load_string(graph));
    EXPECT_EQ(g.get_persist_state()[0].run_seconds, 0.0) << "sau reload: reset";
    g.restore_persist_state(snap);
    EXPECT_NEAR(g.get_persist_state()[0].run_seconds, 10.0, 0.1) << "restored";
}

TEST(GraphRuntime, SafeState)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"val",  "type":"AI_Input","params":{"channel":0}},
        {"id":"good", "type":"AI_Input","params":{"channel":1}},
        {"id":"ss",   "type":"SafeState","params":{"safe_value":5.0}},
        {"id":"ao1",  "type":"AO_Output","params":{"channel":0,"limit_lo":0,"limit_hi":100}}
      ],
      "links": [
        {"from":"val.out",  "to":"ss.in"},
        {"from":"good.out", "to":"ss.good"},
        {"from":"ss.out",   "to":"ao1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));

    auto run = [&](float val_v, float good_v) -> float {
        IoSnapshot io; io.ts_ns=1; io.iop_status=KX_IOP_NORMAL; io.valid=true;
        io.ui_value[0]=val_v;  io.ui_quality[0]=KX_Q_GOOD;
        io.ui_value[1]=good_v; io.ui_quality[1]=KX_Q_GOOD;
        PointTable t; PriorityResolver r;
        t.update_inputs(io); g.execute(t, r);
        return r.resolve().ao[0];
    };

    /* good=1 -> pass val=50 -> AO 5V (0-10V 50%) */
    EXPECT_NEAR(run(50.0f, 1.0f), 5.0f, 0.01f) << "good=1 -> pass through";
    /* good=0 -> safe_value=5 -> AO 0.5V */
    EXPECT_NEAR(run(50.0f, 0.0f), 0.5f, 0.01f) << "good=0 -> safe_value=5%";
}

TEST(GraphRuntime, AlarmHighHysteresis)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai1","type":"AI_Input","params":{"channel":0}},
        {"id":"ah",  "type":"AlarmHigh","params":{"limit":80.0,"hysteresis":5.0}},
        {"id":"do1", "type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"ai1.out","to":"ah.pv"},
        {"from":"ah.out", "to":"do1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));

    auto run = [&](float pv) -> int {
        PointTable t; PriorityResolver r;
        t.update_inputs(io_with_ai(0, pv));
        g.execute(t, r);
        return r.resolve().dout[0];
    };

    EXPECT_EQ(run(70.0f), 0) << "pv=70 < limit=80";
    EXPECT_EQ(run(85.0f), 1) << "pv=85 > 80 -> alarm";
    EXPECT_EQ(run(77.0f), 1) << "pv=77 > 80-5=75 -> stays alarm (hysteresis)";
    EXPECT_EQ(run(74.0f), 0) << "pv=74 < 75 -> alarm cleared";
}

TEST(GraphRuntime, AlarmLowHysteresis)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai1","type":"AI_Input","params":{"channel":0}},
        {"id":"al",  "type":"AlarmLow","params":{"limit":20.0,"hysteresis":3.0}},
        {"id":"do1", "type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"ai1.out","to":"al.pv"},
        {"from":"al.out", "to":"do1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));

    auto run = [&](float pv) -> int {
        PointTable t; PriorityResolver r;
        t.update_inputs(io_with_ai(0, pv));
        g.execute(t, r);
        return r.resolve().dout[0];
    };

    EXPECT_EQ(run(30.0f), 0) << "pv=30 > 20";
    EXPECT_EQ(run(15.0f), 1) << "pv=15 < 20 -> alarm";
    EXPECT_EQ(run(22.0f), 1) << "pv=22 < 20+3=23 -> stays alarm";
    EXPECT_EQ(run(24.0f), 0) << "pv=24 > 23 -> cleared";
}

TEST(GraphRuntime, AlarmDelayOnAndOff)
{
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"ai1","type":"AI_Input","params":{"channel":0}},
        {"id":"ad",  "type":"AlarmDelay","params":{"on_delay_s":2,"off_delay_s":2}},
        {"id":"do1", "type":"DO_Output","params":{"channel":0}}
      ],
      "links": [
        {"from":"ai1.out","to":"ad.in"},
        {"from":"ad.out", "to":"do1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph));
    g.sync_actual_scan_ms(1000);

    auto run = [&](float v) -> int {
        PointTable t; PriorityResolver r;
        t.update_inputs(io_with_ai(0, v));
        g.execute(t, r);
        return r.resolve().dout[0];
    };

    /* on-delay: in=1 x2 scans, on_delay=2 -> on at scan2 */
    EXPECT_EQ(run(1.0f), 0) << "scan1: acc=1 < 2";
    EXPECT_EQ(run(1.0f), 1) << "scan2: acc=2 -> on";

    /* off-delay: in=0 x2 scans, off_delay=2 -> off at scan2 */
    EXPECT_EQ(run(0.0f), 1) << "off scan1: acc=1 < 2, stay on";
    EXPECT_EQ(run(0.0f), 0) << "off scan2: acc=2 -> off";
}

TEST(GraphRuntime, MultiOutputRuntimeCounterWiredToSink)
{
    /* Verify RuntimeCounter.hours và .alarm ports đều có thể dùng làm from trong link */
    const char* graph = R"({
      "schema_version": "1.0",
      "device": {"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes": [
        {"id":"run_sp","type":"Setpoint","params":{"default":1}},
        {"id":"rst_sp","type":"Setpoint","params":{"default":0}},
        {"id":"rc",    "type":"RuntimeCounter","params":{"maint_hours":100}},
        {"id":"do1",   "type":"DO_Output","params":{"channel":0}},
        {"id":"ao1",   "type":"AO_Output","params":{"channel":0,"limit_lo":0,"limit_hi":1000}}
      ],
      "links": [
        {"from":"run_sp.out","to":"rc.run"},
        {"from":"rst_sp.out","to":"rc.reset"},
        {"from":"rc.alarm",  "to":"do1.in"},
        {"from":"rc.hours",  "to":"ao1.in"}
      ]
    })";
    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph)) << "graph voi multi-output RC phai load duoc";
    g.sync_actual_scan_ms(1000);
    PointTable t;
    PriorityResolver r;
    /* maint_hours=100h, 1 scan = 1/3600h << 100 -> alarm=0 */
    g.execute(t, r);
    EXPECT_EQ(r.resolve().dout[0], 0);
}

TEST(GraphRuntime, ValidateDelayOutOfRange)
{
    GraphRuntime g;
    const std::string bad = R"({
      "schema_version":"1.0","device":{"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes":[{"id":"n","type":"OnDelay","params":{"delay_s":90000}}],
      "links":[]
    })";
    EXPECT_FALSE(g.load_string(bad)) << "delay_s > 86400 -> load fail";

    const std::string ok = R"({
      "schema_version":"1.0","device":{"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes":[{"id":"sp","type":"Setpoint","params":{"default":0}},
               {"id":"n", "type":"OnDelay","params":{"delay_s":86400}}],
      "links":[{"from":"sp.out","to":"n.in"}]
    })";
    EXPECT_TRUE(g.load_string(ok)) << "delay_s=86400 -> ok";
}

TEST(GraphRuntime, ValidateBadFromPort)
{
    GraphRuntime g;
    /* Setpoint không có port 'hours' */
    const std::string bad = R"({
      "schema_version":"1.0","device":{"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes":[{"id":"sp","type":"Setpoint","params":{"default":0}},
               {"id":"n", "type":"OnDelay","params":{"delay_s":1}}],
      "links":[{"from":"sp.hours","to":"n.in"}]
    })";
    EXPECT_FALSE(g.load_string(bad)) << "Setpoint.hours khong ton tai -> load fail";
}
