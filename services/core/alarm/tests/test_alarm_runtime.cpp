#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <unistd.h>

#include "alarm/alarm_runtime.hpp"
#include "graph/clock_snapshot.hpp"
#include "ipc/config_reload.hpp"

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

TEST(AlarmRuntime, VirtualIOSourcesReadBackingPoints)
{
    TempFile file(R"([
      {"id":"ALM-VI","label":"Virtual input","enabled":true,"alarmType":1,
       "sources":[{"kind":"VI","channel":1,"pointId":"AV1"}],
       "priority":"high","delayS":0,
       "params":{"hh":32,"h":28,"l":16,"ll":12}},
      {"id":"ALM-VO","label":"Virtual output","enabled":true,"alarmType":1,
       "sources":[{"kind":"VO","channel":1,"pointId":"BV-09"}],
       "priority":"medium","delayS":0,
       "params":{"hh":1,"h":0.5,"l":-1,"ll":-2}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table;
    ASSERT_TRUE(table.set_virtual({PointKind::AV, 0}, 30.0f, PointSource::WEB));
    ASSERT_TRUE(table.set_virtual({PointKind::BV, 8}, 1.0f, PointSource::WEB));
    alarms.evaluate(table, 1000);

    EXPECT_TRUE(alarms.entity_active("ALM-VI"));
    EXPECT_EQ(alarms.entity_source("ALM-VI"), "AV-01");
    EXPECT_TRUE(alarms.entity_active("ALM-VO"));
    EXPECT_EQ(alarms.entity_source("ALM-VO"), "BV-09");
}

TEST(AlarmRuntime, VirtualIOSourceBackingBoundaries)
{
    TempFile file(R"([
      {"id":"ALM-VI-AV","label":"VI AV16","enabled":true,"alarmType":1,
       "sources":[{"kind":"VI","channel":16,"pointId":"AV-16"}],
       "priority":"high","delayS":0,"params":{"hh":32,"h":28,"l":16,"ll":12}},
      {"id":"ALM-VO-AV","label":"VO AV17","enabled":true,"alarmType":1,
       "sources":[{"kind":"VO","channel":1,"pointId":"AV-17"}],
       "priority":"high","delayS":0,"params":{"hh":32,"h":28,"l":16,"ll":12}},
      {"id":"ALM-VI-BV","label":"VI BV8","enabled":true,"alarmType":1,
       "sources":[{"kind":"VI","channel":8,"pointId":"BV-08"}],
       "priority":"high","delayS":0,"params":{"hh":1,"h":0.5,"l":-1,"ll":-2}},
      {"id":"ALM-VO-BV","label":"VO BV9","enabled":true,"alarmType":1,
       "sources":[{"kind":"VO","channel":1,"pointId":"BV-09"}],
       "priority":"high","delayS":0,"params":{"hh":1,"h":0.5,"l":-1,"ll":-2}},
      {"id":"ALM-MSV","label":"MSV2","enabled":true,"alarmType":1,
       "sources":[{"kind":"VI","channel":1,"pointId":"MSV-02"}],
       "priority":"high","delayS":0,"params":{"hh":3,"h":2,"l":0,"ll":-1}}
    ])");
    AlarmRuntime alarms;
    EXPECT_TRUE(alarms.load(file.path()));
}

TEST(AlarmRuntime, RejectsBadVirtualIOBackingPoints)
{
    const char* bad_sources[] = {
        R"({"kind":"VI","channel":1,"pointId":"AV-17"})",
        R"({"kind":"VO","channel":1,"pointId":"AV-16"})",
        R"({"kind":"VI","channel":1,"pointId":"BV-09"})",
        R"({"kind":"VO","channel":1,"pointId":"BV-08"})",
        R"({"kind":"VI","channel":1,"pointId":"MSV-01"})",
        R"({"kind":"VO","channel":1,"pointId":"AV999999999999999999"})",
    };
    for (const char* source : bad_sources) {
        TempFile file(std::string(R"([{"id":"ALM-BAD","label":"Bad","enabled":true,"alarmType":1,"sources":[)") +
                      source +
                      R"(],"priority":"high","delayS":0,"params":{"hh":32,"h":28,"l":16,"ll":12}}])");
        AlarmRuntime alarms;
        EXPECT_FALSE(alarms.load(file.path())) << source;
    }
}

TEST(AlarmRuntime, HighLowInputReportsTriggeredThresholdLevel)
{
    struct Case {
        float value;
        const char* level;
        double threshold;
    };
    const Case cases[] = {
        {33.0f, "HH", 32.0},
        {30.0f, "H", 28.0},
        {14.0f, "L", 16.0},
        {10.0f, "LL", 12.0},
    };

    for (const Case& tc : cases) {
        TempFile file(kValidAlarms);
        AlarmRuntime alarms;
        ASSERT_TRUE(alarms.load(file.path()));
        PointTable table = table_with_ui(tc.value, 22.0f);
        alarms.evaluate(table, 1000);

        const std::vector<AlarmState> states = alarms.active_states();
        const AlarmState* state = find_state(states, "ALM-001");
        ASSERT_NE(state, nullptr) << tc.level;
        EXPECT_EQ(state->trigger_level, tc.level);
        EXPECT_DOUBLE_EQ(state->threshold, tc.threshold);
    }
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

TEST(AlarmRuntime, WallClockJumpDoesNotAdvanceDelayAndTimestampUsesInjectedUtc)
{
    TempFile file(R"([
      {"id":"ALM-D","label":"Delayed","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"high","delayS":2,"params":{"hh":32,"h":28,"l":16,"ll":12}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));
    const PointTable table = table_with_ui(30.0f, 20.0f);

    alarms.evaluate(table, ClockSnapshot{10'000'000'000ull, 1'700'000'000'000ll, {}});
    alarms.evaluate(table, ClockSnapshot{11'000'000'000ull, 1'700'086'400'000ll, {}});
    EXPECT_FALSE(alarms.entity_active("ALM-D"));

    alarms.evaluate(table, ClockSnapshot{12'000'000'000ull, 1'577'934'245'000ll, {}});
    ASSERT_TRUE(alarms.entity_active("ALM-D"));
    const std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-D");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->time, "2020-01-02T03:04:05Z");
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
    const std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-R");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->trigger_level, "RUNTIME");
    EXPECT_DOUBLE_EQ(state->threshold, 0.001);
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
    EXPECT_EQ(state->trigger_level, "H");
    EXPECT_DOUBLE_EQ(state->threshold, 28.0);
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
    EXPECT_TRUE(alarms.return_to_active("ALM-001"));
    states = alarms.active_states();
    state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
    EXPECT_TRUE(state->active);
    EXPECT_FALSE(alarms.return_to_active("missing"));
    EXPECT_FALSE(alarms.return_to_active("ALM-001"));
    EXPECT_TRUE(alarms.ack("ALM-001"));

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

TEST(AlarmRuntime, TimedAckClearsAutoLatchedClear)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(30.0f, 22.0f);
    alarms.evaluate(table, 1000);
    table = table_with_ui(22.0f, 22.0f);
    alarms.evaluate(table, 1000);
    ASSERT_NE(find_state(alarms.active_states(), "ALM-001"), nullptr);

    EXPECT_TRUE(alarms.ack("ALM-001", 60.0, false));
    EXPECT_EQ(find_state(alarms.active_states(), "ALM-001"), nullptr);
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

TEST(AlarmRuntime, ReloadResetsAckWhenClearModeChanges)
{
    TempFile file(R"([
      {"id":"ALM-M","label":"Mode","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"high","clearMode":"auto","delayS":0,
       "params":{"hh":32,"h":28,"l":16,"ll":12}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(30.0f, 0.0f);
    alarms.evaluate(table, 1000);
    ASSERT_TRUE(alarms.ack("ALM-M"));

    file.write(R"([
      {"id":"ALM-M","label":"Mode","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"high","clearMode":"manual","delayS":0,
       "params":{"hh":32,"h":28,"l":16,"ll":12}}
    ])");
    ASSERT_TRUE(alarms.reload(file.path()));
    EXPECT_EQ(find_state(alarms.active_states(), "ALM-M"), nullptr);

    alarms.evaluate(table, 1000);
    const AlarmState* state = find_state(alarms.active_states(), "ALM-M");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
}

TEST(AlarmRuntime, ManualClearModeStaysVisibleUntilSuppressed)
{
    TempFile file(R"([
      {"id":"ALM-M","label":"Manual","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"high","clearMode":"manual","delayS":0,
       "params":{"hh":32,"h":28,"l":16,"ll":12}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(30.0f, 0.0f);
    alarms.evaluate(table, 1000);
    table = table_with_ui(22.0f, 0.0f);
    alarms.evaluate(table, 1000);

    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-M");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "unack");
    EXPECT_FALSE(state->active);

    EXPECT_TRUE(alarms.ack("ALM-M"));
    states = alarms.active_states();
    state = find_state(states, "ALM-M");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "acked");
    EXPECT_FALSE(state->active);

    EXPECT_TRUE(alarms.suppress("ALM-M"));
    EXPECT_EQ(find_state(alarms.active_states(), "ALM-M"), nullptr);
}

TEST(AlarmRuntime, FlexiblePriorityUsesFirstMatchingSeverityRule)
{
    TempFile file(R"([
      {"id":"ALM-F","label":"Flexible","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"flexible","delayS":0,
       "params":{"hh":40,"h":28,"l":16,"ll":12,"severityRules":[
         {"severity":"critical","op":">=","value":35},
         {"severity":"high","op":">=","value":28}
       ]}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    alarms.evaluate(table_with_ui(30.0f, 0.0f), 1000);
    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-F");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->priority, "high");
}

TEST(AlarmRuntime, ReloadResetsAckWhenSeverityRulesChange)
{
    TempFile file(R"([
      {"id":"ALM-F","label":"Flexible","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"flexible","delayS":0,
       "params":{"hh":40,"h":28,"l":16,"ll":12,"severityRules":[
         {"severity":"high","op":">=","value":28}
       ]}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    PointTable table = table_with_ui(30.0f, 0.0f);
    alarms.evaluate(table, 1000);
    ASSERT_TRUE(alarms.ack("ALM-F"));

    file.write(R"([
      {"id":"ALM-F","label":"Flexible","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"flexible","delayS":0,
       "params":{"hh":40,"h":28,"l":16,"ll":12,"severityRules":[
         {"severity":"medium","op":">=","value":28}
       ]}}
    ])");
    ASSERT_TRUE(alarms.reload(file.path()));
    EXPECT_EQ(find_state(alarms.active_states(), "ALM-F"), nullptr);

    alarms.evaluate(table, 1000);
    const AlarmState* state = find_state(alarms.active_states(), "ALM-F");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
    EXPECT_EQ(state->priority, "medium");
}

TEST(AlarmRuntime, FlexiblePriorityFallsBackToInfo)
{
    TempFile file(R"([
      {"id":"ALM-F","label":"Flexible","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"flexible","delayS":0,
       "params":{"hh":40,"h":28,"l":16,"ll":12,"severityRules":[
         {"severity":"critical","op":">=","value":100}
       ]}}
    ])");
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    alarms.evaluate(table_with_ui(30.0f, 0.0f), 1000);
    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-F");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->priority, "info");
}

TEST(AlarmRuntime, FlexiblePriorityRequiresSeverityRule)
{
    TempFile file(R"([
      {"id":"ALM-F","label":"Flexible","enabled":true,"alarmType":1,
       "sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],
       "priority":"flexible","delayS":0,
       "params":{"hh":40,"h":28,"l":16,"ll":12,"severityRules":[]}}
    ])");
    AlarmRuntime alarms;
    EXPECT_FALSE(alarms.load(file.path()));
}

TEST(AlarmRuntime, TimedAckExpiresWhileAlarmVisible)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    alarms.evaluate(table_with_ui(30.0f, 22.0f), 1000);
    ASSERT_TRUE(alarms.ack("ALM-001", 1.0, false));
    std::vector<AlarmState> states = alarms.active_states();
    const AlarmState* state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "acked");

    alarms.evaluate(table_with_ui(30.0f, 22.0f), 1000);
    states = alarms.active_states();
    state = find_state(states, "ALM-001");
    ASSERT_NE(state, nullptr);
    EXPECT_EQ(state->status, "active");
}

TEST(AlarmRuntime, TimedSuppressHidesThenReappears)
{
    TempFile file(kValidAlarms);
    AlarmRuntime alarms;
    ASSERT_TRUE(alarms.load(file.path()));

    alarms.evaluate(table_with_ui(30.0f, 22.0f), 1000);
    ASSERT_TRUE(alarms.suppress("ALM-001", 1.0, false));
    EXPECT_EQ(find_state(alarms.active_states(), "ALM-001"), nullptr);

    alarms.evaluate(table_with_ui(30.0f, 22.0f), 1000);
    EXPECT_NE(find_state(alarms.active_states(), "ALM-001"), nullptr);
}
