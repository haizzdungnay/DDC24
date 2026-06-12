/**
 * @file  test_config_reload.cpp
 * @brief SIGHUP reload (COR-008, CONFIG_SCHEMA D-5): config tốt → default mức 6
 *        đổi không restart; config hỏng → GIỮ config cũ; manual đang giữ không mất;
 *        graph reload atomic (fail giữ graph cũ, unchanged giữ state node).
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <string>

#include <unistd.h>

#include "config_reload.hpp"

using namespace core;

namespace {

class TempFile {
public:
    explicit TempFile(const std::string& content, const char* tag = "cfg")
    {
        char buf[80];
        std::snprintf(buf, sizeof(buf), "/tmp/reload-test-%s-%d-%d.json", tag, getpid(), counter_++);
        path_ = buf;
        write(content);
    }
    ~TempFile() { ::unlink(path_.c_str()); }
    void write(const std::string& content)
    {
        std::ofstream f(path_);
        f << content;
    }
    const std::string& path() const { return path_; }

private:
    std::string path_;
    static int counter_;
};

int TempFile::counter_ = 0;

const char* kGraphOk = R"({
  "schema_version": "1.0",
  "device": { "scan_ms": 1000 },
  "nodes": [
    { "id": "sp1", "type": "Setpoint", "params": { "default": 1.0 } },
    { "id": "do1", "type": "DO_Output", "params": { "channel": 0 } }
  ],
  "links": [ { "from": "sp1.out", "to": "do1.in" } ]
})";

} // namespace

TEST(ConfigReload, GoodConfigUpdatesLevel6Defaults)
{
    PriorityResolver resolver;
    TempFile safe_cfg(R"({ "do": [ {"ch":1,"safe":"closed"} ] })", "safe");

    ReloadSpec spec;
    spec.safe_cfg_path = safe_cfg.path();
    spec.io_cfg_path = "/tmp/khong-co-io-cfg-reload-9999.json";   /* thiếu → default 0-10V */
    spec.graph_path = "/tmp/khong-co-graph-reload-9999.json";     /* chưa từng có graph */

    EXPECT_TRUE(reload_configs(spec, &resolver, nullptr));
    const OutputCmd out = resolver.resolve();
    EXPECT_EQ(out.dout[0], 1) << "default mức 6 DO1 phải đổi sang closed sau reload";
}

TEST(ConfigReload, BadConfigKeepsOldDefaults)
{
    PriorityResolver resolver;
    resolver.set_default_do(0, true);   /* config cũ đang chạy: DO1 default closed */

    TempFile safe_cfg(R"({ "do": [ {"ch":1,"safe":"open"} )", "bad");   /* JSON hỏng */
    ReloadSpec spec;
    spec.safe_cfg_path = safe_cfg.path();
    spec.io_cfg_path = "/tmp/khong-co-io-cfg-reload-9999.json";
    spec.graph_path = "/tmp/khong-co-graph-reload-9999.json";

    EXPECT_FALSE(reload_configs(spec, &resolver, nullptr));
    const OutputCmd out = resolver.resolve();
    EXPECT_EQ(out.dout[0], 1) << "config hỏng → GIỮ default cũ, không reset";
}

TEST(ConfigReload, ManualHoldSurvivesReload)
{
    PriorityResolver resolver;
    resolver.set_do(PRIO_LOCAL_MANUAL, 0, true);   /* user đang giữ DO1=1 */

    TempFile safe_cfg(R"({ "do": [ {"ch":1,"safe":"open"} ] })", "safe");
    ReloadSpec spec;
    spec.safe_cfg_path = safe_cfg.path();
    spec.io_cfg_path = "/tmp/khong-co-io-cfg-reload-9999.json";
    spec.graph_path = "/tmp/khong-co-graph-reload-9999.json";

    EXPECT_TRUE(reload_configs(spec, &resolver, nullptr));
    EXPECT_EQ(resolver.winning_do_level(0), PRIO_LOCAL_MANUAL)
        << "reload KHÔNG được nhả lệnh manual đang giữ";
    EXPECT_EQ(resolver.resolve().dout[0], 1);
}

TEST(GraphReload, FailKeepsOldGraph)
{
    GraphRuntime graph;
    TempFile graph_file(kGraphOk, "graph");
    ASSERT_TRUE(graph.load(graph_file.path()));
    ASSERT_TRUE(graph.loaded());

    graph_file.write("{ json hỏng");
    EXPECT_FALSE(graph.reload(graph_file.path()));
    EXPECT_TRUE(graph.loaded()) << "reload fail phải GIỮ graph cũ (khác load() boot)";

    /* graph cũ vẫn chạy được: Setpoint 1.0 → DO_Output ch0 qua resolver mức 5 */
    PointTable table;
    PriorityResolver resolver;
    graph.execute(table, resolver);
    EXPECT_EQ(resolver.winning_do_level(0), PRIO_LOCAL_LOGIC);
    EXPECT_EQ(resolver.resolve().dout[0], 1);
}

TEST(GraphReload, MissingFileKeepsOldGraph)
{
    GraphRuntime graph;
    TempFile graph_file(kGraphOk, "graph");
    ASSERT_TRUE(graph.load(graph_file.path()));

    EXPECT_FALSE(graph.reload("/tmp/khong-co-graph-reload-9999.json"));
    EXPECT_TRUE(graph.loaded());
}

TEST(GraphReload, UnchangedContentIsNoOp)
{
    GraphRuntime graph;
    TempFile graph_file(kGraphOk, "graph");
    ASSERT_TRUE(graph.load(graph_file.path()));

    testing::internal::CaptureStderr();
    EXPECT_TRUE(graph.reload(graph_file.path()));
    const std::string log = testing::internal::GetCapturedStderr();
    EXPECT_NE(log.find("graph.reload_unchanged"), std::string::npos)
        << "nội dung không đổi → giữ state node (PID integral không reset)";
}

TEST(GraphReload, ChangedContentSwapsAtomically)
{
    GraphRuntime graph;
    TempFile graph_file(kGraphOk, "graph");
    ASSERT_TRUE(graph.load(graph_file.path()));

    /* đổi Setpoint 1.0 → 0.0: sau swap, DO_Output phải ghi 0 */
    std::string changed = kGraphOk;
    const size_t pos = changed.find("\"default\": 1.0");
    ASSERT_NE(pos, std::string::npos);
    changed.replace(pos, 14, "\"default\": 0.0");
    graph_file.write(changed);

    EXPECT_TRUE(graph.reload(graph_file.path()));
    ASSERT_TRUE(graph.loaded());

    PointTable table;
    PriorityResolver resolver;
    graph.execute(table, resolver);
    EXPECT_EQ(resolver.resolve().dout[0], 0) << "graph mới phải có hiệu lực sau reload";
}
