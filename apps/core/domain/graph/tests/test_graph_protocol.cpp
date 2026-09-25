/**
 * @file  test_graph_protocol.cpp
 * @brief COR-011: Protocol graph node unit tests (07_guide §12.4).
 *        T1-T5: Modbus_RTU_Read; T6: Modbus_RTU_Write; T7: Modbus_TCP_Read;
 *        T8-T9: BACnet_AV; T10: BACnet_BV; T11: validation; T12: ext_idx mapping.
 */
#include <cstring>
#include <string>

#include <gtest/gtest.h>

#include "graph/graph_runtime.hpp"
#include "graph/point_table.hpp"
#include "priority/priority_resolver.hpp"
#include "mkddc_shm.h"

using namespace core;

/* ---- helpers ---- */

static const std::string kSchemaHeader = R"json(
{
  "schema_version": "1.0",
  "device": { "scan_ms": 1000 },
)json";

static PointTable make_table() { return PointTable{}; }
static PriorityResolver make_resolver() { return PriorityResolver{}; }

static kx_ext_point_t make_ext(const char* name, float value,
                                kx_quality_t q, uint8_t online)
{
    kx_ext_point_t p{};
    std::strncpy(p.name, name, sizeof(p.name) - 1);
    p.value   = value;
    p.quality = static_cast<uint8_t>(q);
    p.online  = online;
    return p;
}

/* ---- T1: Modbus_RTU_Read outputs ext value scaled ---- */
TEST(GraphProtocol, ModbusRtuReadScaled)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "freq", "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 5, "fc": 3, "addr": 100,
                  "type": "u16", "scale": 0.1, "fallback": 0.0 } },
    { "id": "av1", "type": "BACnet_AV",
      "params": { "instance": 1, "name": "freq_av" } }
  ],
  "links": [{ "from": "freq.out", "to": "av1.in" }],
  "modbus": {
    "rtu": [{ "bus": 1, "slave": 5, "points": [{ "node": "freq" }] }]
  }
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    kx_ext_point_t ext[1];
    ext[0] = make_ext("vfd.freq[0]", 500.0f, KX_Q_GOOD, 1);
    g.feed_ext_snapshot(ext, 1);

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    /* freq.out = 500.0f * scale(0.1) = 50.0f → AV[0] = 50.0f */
    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 0}).value, 50.0f);
}

/* ---- T2: Modbus_RTU_Read fallback khi quality BAD ---- */
TEST(GraphProtocol, ModbusRtuReadFallbackOnBad)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "freq", "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 5, "fc": 3, "addr": 100,
                  "type": "u16", "scale": 1.0, "fallback": -99.0 } },
    { "id": "av1", "type": "BACnet_AV",
      "params": { "instance": 1, "name": "freq_av" } }
  ],
  "links": [{ "from": "freq.out", "to": "av1.in" }],
  "modbus": {
    "rtu": [{ "bus": 1, "slave": 5, "points": [{ "node": "freq" }] }]
  }
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    kx_ext_point_t ext[1];
    ext[0] = make_ext("vfd.freq[0]", 500.0f, KX_Q_BAD, 0);  /* quality BAD + offline */
    g.feed_ext_snapshot(ext, 1);

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    /* BACnet_AV.out = fallback (-99) → AV[0] = -99 */
    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 0}).value, -99.0f);
}

/* ---- T3: Modbus_RTU_Read fallback khi ext_idx không match (proto_ext_idx=-1) ---- */
TEST(GraphProtocol, ModbusRtuReadNoMapping)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "freq", "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 5, "fc": 3, "addr": 100,
                  "type": "u16", "scale": 1.0, "fallback": 42.0 } },
    { "id": "av1", "type": "BACnet_AV",
      "params": { "instance": 1, "name": "freq_av" } }
  ],
  "links": [{ "from": "freq.out", "to": "av1.in" }]
})json";
    /* Không có modbus section → proto_ext_idx = -1 → fallback */

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 0}).value, 42.0f);
}

/* ---- T4: Modbus_RTU_Read GOOD quality → scaled output ---- */
TEST(GraphProtocol, ModbusRtuReadGoodQuality)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "kw", "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 3, "fc": 4, "addr": 200,
                  "type": "f32", "scale": 0.001, "fallback": 0.0 } },
    { "id": "av1", "type": "BACnet_AV",
      "params": { "instance": 1, "name": "power_kw" } }
  ],
  "links": [{ "from": "kw.out", "to": "av1.in" }],
  "modbus": {
    "rtu": [
      { "bus": 1, "slave": 5, "points": [{ "node": "dummy_0" }] },
      { "bus": 1, "slave": 3, "points": [{ "node": "kw" }] }
    ]
  }
})json";
    /* dummy_0 không map vào node nào → kw có ext_idx = 1 */

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    kx_ext_point_t ext[2];
    ext[0] = make_ext("vfd.v[0]",    0.0f,    KX_Q_GOOD, 1);
    ext[1] = make_ext("meter.kw[0]", 5000.0f, KX_Q_GOOD, 1);
    g.feed_ext_snapshot(ext, 2);

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    /* 5000 * 0.001 = 5.0 */
    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 0}).value, 5.0f);
}

/* ---- T5: Multiple RTU reads — each gets correct ext_idx ---- */
TEST(GraphProtocol, MultipleRtuReadsIndexed)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "r0", "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 1, "fc": 3, "addr": 0,
                  "type": "u16", "scale": 1.0, "fallback": -1.0 } },
    { "id": "r1", "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 1, "fc": 3, "addr": 1,
                  "type": "u16", "scale": 1.0, "fallback": -1.0 } },
    { "id": "av0", "type": "BACnet_AV", "params": { "instance": 1, "name": "r0" } },
    { "id": "av1", "type": "BACnet_AV", "params": { "instance": 2, "name": "r1" } }
  ],
  "links": [
    { "from": "r0.out", "to": "av0.in" },
    { "from": "r1.out", "to": "av1.in" }
  ],
  "modbus": {
    "rtu": [{ "bus": 1, "slave": 1, "points": [
      { "node": "r0" }, { "node": "r1" }
    ]}]
  }
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    kx_ext_point_t ext[2];
    ext[0] = make_ext("s1.h0[0]", 10.0f, KX_Q_GOOD, 1);
    ext[1] = make_ext("s1.h1[0]", 20.0f, KX_Q_GOOD, 1);
    g.feed_ext_snapshot(ext, 2);

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 0}).value, 10.0f);
    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 1}).value, 20.0f);
}

/* ---- T6: Modbus_RTU_Write — apply_ext_writes ghi setpoint vào shm ---- */
TEST(GraphProtocol, ModbusRtuWriteAppliesSetpoint)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "sp_src", "type": "Setpoint",
      "params": { "default": 50.0 } },
    { "id": "w0", "type": "Modbus_RTU_Write",
      "params": { "bus": 1, "slave": 5, "fc": 6, "addr": 0, "type": "u16" } }
  ],
  "links": [{ "from": "sp_src.out", "to": "w0.in" }],
  "modbus": {
    "rtu": [{ "bus": 1, "slave": 5, "points": [{ "node": "w0" }] }]
  }
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    /* Setup fake shm */
    kx_plc_shm_t shm{};
    shm.magic     = KX_SHM_MAGIC;
    shm.ext_count = 1;
    shm.ext[0].setpoint = 0.0f;
    shm.ext[0].dirty    = 0;

    g.apply_ext_writes(&shm);

    EXPECT_FLOAT_EQ(shm.ext[0].setpoint, 50.0f);
    EXPECT_EQ(shm.ext[0].dirty, 1u);
    EXPECT_EQ(shm.ext_cmd_seq[0], 1u);
    g.apply_ext_writes(&shm);
    EXPECT_EQ(shm.ext_cmd_seq[0], 1u)
        << "Graph giữ nguyên setpoint không được biến thành lệnh mới mỗi scan";
}

/* ---- T7: Modbus_TCP_Read → same ext snapshot path as RTU ---- */
TEST(GraphProtocol, ModbusTcpReadFromExtSnapshot)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "tcp0", "type": "Modbus_TCP_Read",
      "params": { "host": "192.168.1.50", "unit": 1, "fc": 3, "addr": 0,
                  "type": "u16", "scale": 2.0, "fallback": -1.0 } },
    { "id": "av1", "type": "BACnet_AV",
      "params": { "instance": 1, "name": "tcp_val" } }
  ],
  "links": [{ "from": "tcp0.out", "to": "av1.in" }],
  "modbus": {
    "tcp": [{ "host": "192.168.1.50", "unit": 1, "points": [{ "node": "tcp0" }] }]
  }
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    kx_ext_point_t ext[1];
    ext[0] = make_ext("chiller.reg[0]", 100.0f, KX_Q_GOOD, 1);
    g.feed_ext_snapshot(ext, 1);

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 0}).value, 200.0f);  /* 100 * 2.0 */
}

/* ---- T8: BACnet_AV read — output current AV value ---- */
TEST(GraphProtocol, BacnetAvReadCurrentValue)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "av_sp", "type": "BACnet_AV",
      "params": { "instance": 2, "name": "setpoint" } }
  ],
  "links": []
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    PointTable t = make_table();
    /* Pre-populate AV[1] (instance 2 → idx 1) from web */
    t.set_virtual({PointKind::AV, 1}, 22.5f, PointSource::WEB);

    PriorityResolver r = make_resolver();
    g.execute(t, r);

    /* BACnet_AV node outputs the current AV value — verify via chaining not needed
     * since we can't get internal outputs; verify no crash and AV not overwritten */
    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 1}).value, 22.5f);
}

/* ---- T9: BACnet_AV write — "in" wired sets AV from graph ---- */
TEST(GraphProtocol, BacnetAvWriteFromGraph)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "sp_const", "type": "Setpoint",
      "params": { "default": 25.0 } },
    { "id": "av3", "type": "BACnet_AV",
      "params": { "instance": 3, "name": "comfort_sp" } }
  ],
  "links": [{ "from": "sp_const.out", "to": "av3.in" }]
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    /* BACnet_AV.in=25.0 → writes AV[2] (instance 3 → idx 2) */
    EXPECT_FLOAT_EQ(t.get({PointKind::AV, 2}).value, 25.0f);
}

/* ---- T10: BACnet_BV write/read ---- */
TEST(GraphProtocol, BacnetBvWriteFromGraph)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "di1", "type": "DI_Input", "params": { "channel": 0 } },
    { "id": "bv1", "type": "BACnet_BV",
      "params": { "instance": 1, "name": "door_open" } }
  ],
  "links": [{ "from": "di1.out", "to": "bv1.in" }]
})json";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(src));

    PointTable t = make_table(); PriorityResolver r = make_resolver();
    g.execute(t, r);

    /* DI[0] defaults to 0 → BV[0] = 0 */
    EXPECT_FLOAT_EQ(t.get({PointKind::BV, 0}).value, 0.0f);
}

/* ---- T11: Validation — Modbus_RTU_Read missing fallback → load fails ---- */
TEST(GraphProtocol, ValidationMissingFallback)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "freq", "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 5, "fc": 3, "addr": 100, "type": "u16" } }
  ],
  "links": []
})json";

    GraphRuntime g;
    EXPECT_FALSE(g.load_string(src));  /* thiếu fallback → load fail */
}

/* ---- T12: Validation — BACnet_AV missing instance → load fails ---- */
TEST(GraphProtocol, ValidationBacnetAvMissingInstance)
{
    const std::string src = kSchemaHeader + R"json(
  "nodes": [
    { "id": "av_no_inst", "type": "BACnet_AV",
      "params": { "name": "no_instance" } }
  ],
  "links": []
})json";

    GraphRuntime g;
    EXPECT_FALSE(g.load_string(src));
}
