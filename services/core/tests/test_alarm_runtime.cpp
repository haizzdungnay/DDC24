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

const AlarmState* find_state(const std::vector<AlarmState>& states, const std::string& id)
{
    for (const AlarmState& state : states) {
        if (state.id == id) return &state;
    }
    return nullptr;
}

std::string high_low_alarm_json(double h, double delay_s = 0.0)
{
    std::ostringstream out;
    out << R"([
      {"id":"ALM-A","label":"Supply alarm","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"high","delayS":)" << delay_s << R"(,
       "params":{"hh":32,"h":)" << h << R"(,"l":16,"ll":12,"hysteresis":0.5}}
    ])";
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

TEST(AlarmRuntime, AckActiveThenClearRemovesVisibleAlarm)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(22.0f, 30.0f);
    alarms.evaluate(table, 1000);
    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
    EXPECT_TRUE(state->active);
    EXPECT_EQ(state->source_point_id, "UI-02");
    EXPECT_DOUBLE_EQ(state->value, 30.0);
    EXPECT_EQ(state->priority, "high");
    EXPECT_EQ(state->label, "Supply air");
    EXPECT_EQ(state->alarm_type, 1);
    EXPECT_EQ(state->alarm_setting_id, "ALM-001");
    EXPECT_FALSE(state->time.empty());

    EXPECT_TRUE(alarms.ack("ALM-001"));
    states = alarms.active_states();
    state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "acked");
    EXPECT_TRUE(state->active);

    table = table_with_ui(22.0f, 22.0f);
    alarms.evaluate(table, 1000);
    states = alarms.active_states();
    EXPECT_EQ(find_state(states, "ALM-001"), nullptr);
}

TEST(AlarmRuntime, ClearBeforeAckLatchesUntilAck)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(22.0f, 30.0f);
    alarms.evaluate(table, 1000);
    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    const uint64_t occurrence = state->occurrence;
    const std::string first_time = state->time;

    table = table_with_ui(22.0f, 22.0f);
    alarms.evaluate(table, 1000);
    states = alarms.active_states();
    state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "unack");
    EXPECT_FALSE(state->active);
    EXPECT_EQ(state->source_point_id, "UI-02");
    EXPECT_EQ(state->occurrence, occurrence);
    EXPECT_EQ(state->time, first_time);

    table = table_with_ui(30.0f, 22.0f);
    alarms.evaluate(table, 1000);
    states = alarms.active_states();
    state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
    EXPECT_TRUE(state->active);
    EXPECT_EQ(state->source_point_id, "UI-01");
    EXPECT_DOUBLE_EQ(state->value, 30.0);
    EXPECT_EQ(state->occurrence, occurrence) << "unacked retrigger keeps same occurrence";
    EXPECT_EQ(state->time, first_time);

    table = table_with_ui(22.0f, 22.0f);
    alarms.evaluate(table, 1000);
    EXPECT_TRUE(alarms.ack("ALM-001"));
    states = alarms.active_states();
    EXPECT_EQ(find_state(states, "ALM-001"), nullptr);
}

TEST(AlarmRuntime, RetriggerAfterAckAndClearCreatesNewOccurrence)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(22.0f, 30.0f);
    alarms.evaluate(table, 1000);
    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    const uint64_t first_occurrence = state->occurrence;
    ASSERT_TRUE(alarms.ack("ALM-001"));

    table = table_with_ui(22.0f, 22.0f);
    alarms.evaluate(table, 1000);
    EXPECT_EQ(find_state(alarms.active_states(), "ALM-001"), nullptr);

    table = table_with_ui(30.0f, 22.0f);
    alarms.evaluate(table, 1000);
    states = alarms.active_states();
    state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
    EXPECT_GT(state->occurrence, first_occurrence);
}

TEST(AlarmRuntime, AckUnknownOrNormalReturnsFalse)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));
    EXPECT_FALSE(alarms.ack("missing"));
    EXPECT_FALSE(alarms.ack("ALM-001"));
}

TEST(AlarmRuntime, ReloadKeepsAckWhenFingerprintUnchanged)
{
    TempFile file(high_low_alarm_json(28.0));
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(30.0f, 0.0f);
    alarms.evaluate(table, 1000);
    ASSERT_TRUE(alarms.ack("ALM-A"));
    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-A");
    ASSERT_NE(state, nullptr);
    ASSERT_EQ(state->status, "acked");
    const uint64_t occurrence = state->occurrence;
    const std::string first_time = state->time;

    file.write(high_low_alarm_json(28.0));
    ASSERT_TRUE(alarms.reload(file.path()));
    states = alarms.active_states();
    state = find_state(states, "ALM-A");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "acked");
    EXPECT_EQ(state->occurrence, occurrence);
    EXPECT_EQ(state->time, first_time);
}

TEST(AlarmRuntime, ReloadResetsAckWhenFingerprintChanges)
{
    TempFile file(high_low_alarm_json(28.0));
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(30.0f, 0.0f);
    alarms.evaluate(table, 1000);
    ASSERT_TRUE(alarms.ack("ALM-A"));

    file.write(high_low_alarm_json(27.0));
    ASSERT_TRUE(alarms.reload(file.path()));
    EXPECT_EQ(find_state(alarms.active_states(), "ALM-A"), nullptr);

    alarms.evaluate(table, 1000);
    const std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-A");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
    EXPECT_FALSE(alarms.ack("missing"));
}
