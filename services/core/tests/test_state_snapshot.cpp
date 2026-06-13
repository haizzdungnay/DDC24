/**
 * @file  test_state_snapshot.cpp
 * @brief COR-010: state.snap load/save, atomic rename, bad-snap ignored,
 *        restore theo id+type, PID/timer không persist.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <filesystem>

#include "state_snapshot.hpp"
#include "graph_runtime.hpp"

using namespace core;
namespace fs = std::filesystem;

namespace {

/* Tạo path tạm duy nhất trong /tmp cho mỗi test */
std::string tmp_path(const std::string& suffix)
{
    return "/tmp/mkddc_snap_test_" + suffix + ".snap";
}

void cleanup(const std::string& path)
{
    std::remove(path.c_str());
    std::remove((path + ".tmp").c_str());
}

} // namespace

TEST(StateSnapshot, SaveAndLoad)
{
    const std::string path = tmp_path("basic");
    cleanup(path);

    StateSnapshot ss(path);
    std::vector<PersistEntry> entries = {
        {"fan1_rt",  "RuntimeCounter", 123456.7, 0},
        {"kwh_main", "PulseCounter",   0.0,      884213},
    };

    ASSERT_TRUE(ss.save(entries));

    const auto loaded = ss.load();
    ASSERT_EQ(loaded.size(), 2u);

    /* RuntimeCounter */
    const auto* rt = [&]() -> const PersistEntry* {
        for (const auto& e : loaded) if (e.id == "fan1_rt") return &e;
        return nullptr;
    }();
    ASSERT_NE(rt, nullptr);
    EXPECT_EQ(rt->type, "RuntimeCounter");
    EXPECT_NEAR(rt->run_seconds, 123456.7, 0.001);

    /* PulseCounter */
    const auto* pc = [&]() -> const PersistEntry* {
        for (const auto& e : loaded) if (e.id == "kwh_main") return &e;
        return nullptr;
    }();
    ASSERT_NE(pc, nullptr);
    EXPECT_EQ(pc->type, "PulseCounter");
    EXPECT_EQ(pc->count_raw, 884213u);

    cleanup(path);
}

TEST(StateSnapshot, MissingFileReturnsEmpty)
{
    const std::string path = tmp_path("missing");
    cleanup(path);

    StateSnapshot ss(path);
    const auto loaded = ss.load();
    EXPECT_TRUE(loaded.empty()) << "file khong ton tai -> {} + WARN, khong crash";
}

TEST(StateSnapshot, BadJsonIgnored)
{
    const std::string path = tmp_path("badjson");
    cleanup(path);

    /* ghi file JSON hỏng */
    FILE* f = std::fopen(path.c_str(), "w");
    ASSERT_NE(f, nullptr);
    std::fputs("this is not json {{{", f);
    std::fclose(f);

    StateSnapshot ss(path);
    const auto loaded = ss.load();
    EXPECT_TRUE(loaded.empty()) << "JSON hong -> {} + WARN";

    cleanup(path);
}

TEST(StateSnapshot, WrongVersionIgnored)
{
    const std::string path = tmp_path("badver");
    cleanup(path);

    FILE* f = std::fopen(path.c_str(), "w");
    ASSERT_NE(f, nullptr);
    std::fputs(R"({"version":99,"saved_at_ms":0,"nodes":{}})", f);
    std::fclose(f);

    StateSnapshot ss(path);
    const auto loaded = ss.load();
    EXPECT_TRUE(loaded.empty()) << "version la -> {} + WARN";

    cleanup(path);
}

TEST(StateSnapshot, AtomicWriteViaRename)
{
    const std::string path = tmp_path("atomic");
    cleanup(path);

    StateSnapshot ss(path);
    std::vector<PersistEntry> entries = {{"n1", "RuntimeCounter", 1.0, 0}};
    ASSERT_TRUE(ss.save(entries));

    /* .tmp không được còn tồn tại sau save thành công */
    EXPECT_FALSE(fs::exists(path + ".tmp")) << ".tmp phai duoc rename het";
    EXPECT_TRUE(fs::exists(path)) << "file snap phai ton tai";

    cleanup(path);
}

TEST(StateSnapshot, GraphRestoreByIdAndType)
{
    /* Simulate round-trip: graph run -> get_persist_state -> save -> reload -> restore */
    const std::string snap_path = tmp_path("roundtrip");
    cleanup(snap_path);

    const char* graph_src = R"({
      "schema_version":"1.0",
      "device":{"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes":[
        {"id":"run_sp","type":"Setpoint","params":{"default":1}},
        {"id":"rst_sp","type":"Setpoint","params":{"default":0}},
        {"id":"rc",    "type":"RuntimeCounter","params":{"maint_hours":0}}
      ],
      "links":[
        {"from":"run_sp.out","to":"rc.run"},
        {"from":"rst_sp.out","to":"rc.reset"}
      ]
    })";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph_src));
    g.sync_actual_scan_ms(1000);

    /* chạy 7s */
    PointTable t; PriorityResolver r;
    for (int i = 0; i < 7; i++) g.execute(t, r);
    const auto snap_data = g.get_persist_state();
    ASSERT_EQ(snap_data.size(), 1u);
    EXPECT_NEAR(snap_data[0].run_seconds, 7.0, 0.1);

    /* save to disk */
    StateSnapshot ss(snap_path);
    ASSERT_TRUE(ss.save(snap_data));

    /* reload graph (mất state) -> restore từ disk */
    ASSERT_TRUE(g.load_string(graph_src));
    EXPECT_EQ(g.get_persist_state()[0].run_seconds, 0.0) << "sau reload: state mất";

    g.restore_persist_state(ss.load());
    EXPECT_NEAR(g.get_persist_state()[0].run_seconds, 7.0, 0.1) << "restore từ disk";

    cleanup(snap_path);
}

TEST(StateSnapshot, NonPersistNodesNotInSnap)
{
    /* PID / OnDelay / Interlock không xuất hiện trong get_persist_state() */
    const char* graph_src = R"({
      "schema_version":"1.0",
      "device":{"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes":[
        {"id":"sp1","type":"Setpoint","params":{"default":10}},
        {"id":"sp2","type":"Setpoint","params":{"default":0}},
        {"id":"sp3","type":"Setpoint","params":{"default":0}},
        {"id":"pid1","type":"PID","params":{"kp":1,"ki":0.1,"kd":0,"out_lo":0,"out_hi":100}},
        {"id":"od1", "type":"OnDelay","params":{"delay_s":5}},
        {"id":"il1", "type":"Interlock","params":{"latch":0}}
      ],
      "links":[
        {"from":"sp1.out","to":"pid1.sp"},
        {"from":"sp2.out","to":"pid1.pv"},
        {"from":"sp3.out","to":"od1.in"},
        {"from":"sp3.out","to":"il1.permit"},
        {"from":"sp3.out","to":"il1.request"}
      ]
    })";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph_src));
    PointTable t; PriorityResolver r;
    for (int i = 0; i < 5; i++) g.execute(t, r);

    const auto snap = g.get_persist_state();
    EXPECT_TRUE(snap.empty()) << "PID/OnDelay/Interlock khong duoc persist";
}

TEST(StateSnapshot, DirtyFlagBehavior)
{
    const char* graph_src = R"({
      "schema_version":"1.0",
      "device":{"bacnet_device_id":1,"name":"t","scan_ms":1000},
      "io_map":{},
      "nodes":[
        {"id":"run_sp","type":"Setpoint","params":{"default":1}},
        {"id":"rst_sp","type":"Setpoint","params":{"default":0}},
        {"id":"rc",    "type":"RuntimeCounter","params":{"maint_hours":0}}
      ],
      "links":[
        {"from":"run_sp.out","to":"rc.run"},
        {"from":"rst_sp.out","to":"rc.reset"}
      ]
    })";

    GraphRuntime g;
    ASSERT_TRUE(g.load_string(graph_src));
    EXPECT_FALSE(g.dirty()) << "sau load: dirty=false";

    PointTable t; PriorityResolver r;
    g.execute(t, r);
    EXPECT_TRUE(g.dirty()) << "sau execute voi run=1: dirty=true";

    g.clear_dirty();
    EXPECT_FALSE(g.dirty()) << "sau clear_dirty: dirty=false";

    /* execute lần nữa -> dirty lại */
    g.execute(t, r);
    EXPECT_TRUE(g.dirty());
}
