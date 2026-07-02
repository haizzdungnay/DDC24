#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <unistd.h>

#include "alarm_runtime.hpp"
#include "config_reload.hpp"

using namespace core;

namespace {

class TempFile {
public:
    explicit TempFile(const std::string& content, const char* tag = "alarm")
    {
        char buf[96];
        std::snprintf(buf, sizeof(buf), "/tmp/alarm-test-%s-%d-%d.json",
                      tag, getpid(), counter_++);
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

const char* kValidAlarms = R"([
  {
    "id":"ALM-001","label":"Supply air","enabled":true,"alarmType":1,
    "sources":[
      {"kind":"UI","channel":1,"pointId":"UI-01"},
      {"kind":"UI","channel":2,"pointId":"UI-02"}
    ],
    "priority":"high","delayS":0,"publishBacnet":false,
    "params":{"hh":32,"h":28,"l":16,"ll":12,"hysteresis":0.5}
  },
  {
    "id":"ALM-002","label":"Fan runtime","enabled":true,"alarmType":3,
    "sources":[{"kind":"DO","channel":1,"pointId":"DO-01"}],
    "priority":"medium","delayS":0,"publishBacnet":false,
    "params":{"runtimeHours":0.001}
  }
])";

PointTable table_with_ui(float ui1, float ui2)
{
    IoSnapshot io;
    io.ui_value[0] = ui1;
    io.ui_value[1] = ui2;
    PointTable table;
    table.update_inputs(io);
    return table;
}

std::string too_many_alarms_json()
{
    std::ostringstream out;
    out << "[";
    for (int i = 0; i < 65; i++) {
        if (i != 0) out << ",";
        out << "{\"id\":\"ALM-" << i << "\",\"label\":\"x\",\"enabled\":false,"
            << "\"alarmType\":0,\"sources\":[],\"priority\":\"low\",\"delayS\":0,"
            << "\"params\":{}}";
    }
    out << "]";
    return out.str();
}

} // namespace

TEST(AlarmRuntime, LoadsType1Type3MultiSource)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));
    EXPECT_EQ(alarms.entity_count(), 2u);
    EXPECT_EQ(alarms.branch_count(), 3u);
}

TEST(AlarmRuntime, MultiSourceEntityUsesOrAndKeepsTriggerPointId)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(22.0f, 30.0f);
    alarms.evaluate(table, 1000);
    EXPECT_TRUE(alarms.entity_active("ALM-001"));
    EXPECT_EQ(alarms.entity_source("ALM-001"), "UI-02");

    table = table_with_ui(22.0f, 22.0f);
    alarms.evaluate(table, 1000);
    EXPECT_FALSE(alarms.entity_active("ALM-001"));
}

TEST(AlarmRuntime, DelaySMustElapseBeforeActive)
{
    TempFile file(R"([
      {"id":"ALM-D","label":"Delayed","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"high","delayS":2,"params":{"hh":32,"h":28,"l":16,"ll":12}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(30.0f, 20.0f);
    alarms.evaluate(table, 1000);
    EXPECT_FALSE(alarms.entity_active("ALM-D"));
    alarms.evaluate(table, 1000);
    EXPECT_TRUE(alarms.entity_active("ALM-D"));
}

TEST(AlarmRuntime, RuntimeHoursTypeActivatesAfterRuntimeLimit)
{
    TempFile file(R"([
      {"id":"ALM-R","label":"Runtime","enabled":true,"alarmType":3,
       "sources":[{"kind":"DO","channel":1,"pointId":"DO-01"}],
       "priority":"medium","delayS":0,"params":{"runtimeHours":0.001}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    IoSnapshot io;
    io.do_feedback[0] = 1;
    PointTable table;
    table.update_inputs(io);
    for (int i = 0; i < 3; i++) {
        alarms.evaluate(table, 1000);
        EXPECT_FALSE(alarms.entity_active("ALM-R"));
    }
    alarms.evaluate(table, 1000);
    EXPECT_TRUE(alarms.entity_active("ALM-R"));
    EXPECT_EQ(alarms.entity_source("ALM-R"), "DO-01");
}

TEST(AlarmRuntime, DeferredEnabledTypeIsIgnored)
{
    TempFile file(R"([
      {"id":"ALM-X","label":"Deferred","enabled":true,"alarmType":2,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"low","delayS":0,"params":{"setpoint":1}}
    ])");
    AlarmRuntime alarms;
    EXPECT_TRUE(alarms.load(file.path()));
    EXPECT_EQ(alarms.entity_count(), 0u);
    EXPECT_EQ(alarms.branch_count(), 0u);
}

TEST(AlarmRuntime, CapsAreDefensive)
{
    TempFile file(too_many_alarms_json());
    std::vector<AlarmEntityConfig> cfg;
    EXPECT_FALSE(load_alarm_config(file.path(), false, &cfg));
}

TEST(AlarmRuntime, BadReloadKeepsOldAndSafeStateReloadStillApplies)
{
    TempFile alarm_file(kValidAlarms, "alarm");
    TempFile safe_file(R"({ "do": [ {"ch":1,"safe":"closed"} ] })", "safe");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(alarm_file.path()));
    alarm_file.write("{ broken json");

    PriorityResolver resolver;
    ReloadSpec spec;
    spec.safe_cfg_path = safe_file.path();
    spec.io_cfg_path = "/tmp/khong-co-io-cfg-alarm-reload-9999.json";
    spec.graph_path = "/tmp/khong-co-graph-alarm-reload-9999.json";
    spec.alarm_cfg_path = alarm_file.path();

    EXPECT_FALSE(reload_configs(spec, &resolver, nullptr, &alarms));
    EXPECT_EQ(resolver.resolve().dout[0], 1)
        << "bad alarm config must not block safe-state reload";
    EXPECT_EQ(alarms.entity_count(), 2u) << "bad alarm reload keeps old config";
}
