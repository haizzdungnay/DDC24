#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <string>

#include <unistd.h>

#include "graph/clock_snapshot.hpp"
#include "schedule/schedule_runtime.hpp"

using namespace core;

namespace {

class TempFile {
public:
    explicit TempFile(const std::string& content)
    {
        char buf[96];
        std::snprintf(buf, sizeof(buf), "/tmp/schedule-runtime-%d-%d.json", getpid(), counter_++);
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

const char* kValidSchedule = R"([
  {
    "id": "SCH-001",
    "label": "AO Monday",
    "enabled": true,
    "scheduleType": "analog_output_value",
    "startTime": "07:00",
    "endTime": "12:00",
    "weekdays": ["monday"],
    "target": {"kind": "AO", "channel": 1, "pointId": "AO-01"},
    "value": 50
  },
  {
    "id": "SCH-002",
    "label": "DO Monday",
    "enabled": true,
    "scheduleType": "digital_output_value",
    "startTime": "08:00",
    "endTime": "12:00",
    "weekdays": ["monday"],
    "target": {"kind": "DO", "channel": 2, "pointId": "DO-02"},
    "value": 1
  },
  {
    "id": "SCH-003",
    "label": "Loop",
    "enabled": true,
    "scheduleType": "control_loop_setpoint",
    "startTime": "09:00",
    "endTime": "12:00",
    "weekdays": ["monday"],
    "target": {"kind": "AV", "channel": 3, "pointId": "AV-03"},
    "value": 22.5
  },
  {
    "id": "SCH-004",
    "label": "Mode",
    "enabled": true,
    "scheduleType": "controller_operation_mode",
    "startTime": "10:00",
    "endTime": "12:00",
    "weekdays": ["monday"],
    "value": 2
  }
])";

} // namespace

TEST(ScheduleRuntime, LoadParsesExecutableRows)
{
    TempFile file(kValidSchedule);
    std::vector<ScheduleConfig> rows;
    ASSERT_TRUE(load_schedule_config(file.path(), true, &rows));
    EXPECT_EQ(rows.size(), 4u);
}

TEST(ScheduleRuntime, RejectsBadTargetForType)
{
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "bad",
        "enabled": true,
        "scheduleType": "analog_output_value",
        "startTime": "07:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "DO", "channel": 1, "pointId": "DO-01"},
        "value": 50
      }
    ])");
    std::vector<ScheduleConfig> rows;
    EXPECT_FALSE(load_schedule_config(file.path(), true, &rows));
}

TEST(ScheduleRuntime, RejectsControllerModeOutsideMsvOne)
{
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "bad",
        "enabled": true,
        "scheduleType": "controller_operation_mode",
        "startTime": "07:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "MSV", "channel": 2, "pointId": "MSV-02"},
        "value": 1
      }
    ])");
    std::vector<ScheduleConfig> rows;
    EXPECT_FALSE(load_schedule_config(file.path(), true, &rows));
}

TEST(ScheduleRuntime, RejectsTargetPointIdMismatch)
{
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "bad",
        "enabled": true,
        "scheduleType": "controller_operation_mode",
        "startTime": "07:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "MSV", "channel": 1, "pointId": "MSV-02"},
        "value": 1
      }
    ])");
    std::vector<ScheduleConfig> rows;
    EXPECT_FALSE(load_schedule_config(file.path(), true, &rows));
}

TEST(ScheduleRuntime, RejectsHugeTargetChannel)
{
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "bad",
        "enabled": true,
        "scheduleType": "analog_output_value",
        "startTime": "07:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "AO", "channel": 1e100},
        "value": 50
      }
    ])");
    std::vector<ScheduleConfig> rows;
    EXPECT_FALSE(load_schedule_config(file.path(), true, &rows));
}

TEST(ScheduleRuntime, DisabledExecutableRowsStillValidate)
{
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "bad",
        "enabled": false,
        "scheduleType": "analog_output_value",
        "startTime": "24:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "AO", "channel": 1},
        "value": 50
      }
    ])");
    std::vector<ScheduleConfig> rows;
    EXPECT_FALSE(load_schedule_config(file.path(), true, &rows));
}

TEST(ScheduleRuntime, AcceptsLegacyTimeOfDayAsStartTime)
{
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "legacy",
        "enabled": true,
        "scheduleType": "analog_output_value",
        "timeOfDay": "07:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "AO", "channel": 1},
        "value": 50
      }
    ])");
    std::vector<ScheduleConfig> rows;
    ASSERT_TRUE(load_schedule_config(file.path(), true, &rows));
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].start_minute, 7 * 60);
}

TEST(ScheduleRuntime, StoresNonExecutableRowsWithoutApplying)
{
    ScheduleRuntime runtime;
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "inactive",
        "enabled": false,
        "scheduleType": "not_active"
      },
      {
        "id": "SCH-002",
        "label": "holiday",
        "enabled": true,
        "scheduleType": "holiday_period",
        "startDate": "01-01",
        "endDate": "01-01"
      },
      {
        "id": "SCH-003",
        "label": "disabled ao",
        "enabled": false,
        "scheduleType": "analog_output_value",
        "startTime": "07:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "AO", "channel": 1},
        "value": 50
      }
    ])");
    ASSERT_TRUE(runtime.load(file.path(), true));
    EXPECT_EQ(runtime.schedule_count(), 3u);

    IoSnapshot io;
    PointTable table;
    PriorityResolver resolver;
    runtime.evaluate_week_minute(0 * 24 * 60 + 8 * 60, io, table, resolver);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
}

TEST(ScheduleRuntime, AppliesActiveIntervalsByTarget)
{
    ScheduleRuntime runtime;
    TempFile file(kValidSchedule);
    ASSERT_TRUE(runtime.load(file.path(), true));

    IoSnapshot io;
    io.ao_mode[0] = 0;
    PointTable table;
    PriorityResolver resolver;

    runtime.evaluate_week_minute(0 * 24 * 60 + 10 * 60, io, table, resolver);

    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_SCHEDULE);
    EXPECT_FLOAT_EQ(resolver.resolve().ao[0], 5.0f);
    EXPECT_EQ(resolver.winning_do_level(1), PRIO_SCHEDULE);
    EXPECT_EQ(resolver.resolve().dout[1], 1);
    EXPECT_FLOAT_EQ(table.get({PointKind::AV, 2}).value, 22.5f);
    EXPECT_EQ(table.get({PointKind::AV, 2}).source, PointSource::SCHEDULE);
    EXPECT_FLOAT_EQ(table.get({PointKind::MSV, 0}).value, 2.0f);
    EXPECT_EQ(table.get({PointKind::MSV, 0}).source, PointSource::SCHEDULE);

    runtime.evaluate_week_minute(0 * 24 * 60 + 13 * 60, io, table, resolver);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);
    EXPECT_EQ(resolver.winning_do_level(1), PRIO_DEFAULT);
    EXPECT_EQ(table.get({PointKind::AV, 2}).source, PointSource::DEFAULT);
    EXPECT_EQ(table.get({PointKind::MSV, 0}).source, PointSource::DEFAULT);
}

TEST(ScheduleRuntime, UsesInjectedCivilTime)
{
    ScheduleConfig schedule;
    schedule.id = "SCH-CLOCK";
    schedule.enabled = true;
    schedule.type = ScheduleType::AnalogOutputValue;
    schedule.start_minute = 9 * 60;
    schedule.end_minute = 11 * 60;
    schedule.weekdays[0] = true;
    schedule.target = {PointKind::AO, 0, "AO-01"};
    schedule.value = 50.0;

    ScheduleRuntime runtime;
    runtime.configure({schedule});
    IoSnapshot io;
    PointTable table;
    PriorityResolver resolver;
    ClockSnapshot clock;
    clock.civil_time.tm_wday = 1; // Monday
    clock.civil_time.tm_hour = 10;
    clock.civil_time.tm_mon = 0;
    clock.civil_time.tm_mday = 15;

    runtime.evaluate(clock, io, table, resolver);

    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_SCHEDULE);
}

TEST(ScheduleRuntime, AppliesVirtualOutputTargets)
{
    ScheduleRuntime runtime;
    TempFile file(R"([
      {
        "id": "SCH-VO-A",
        "label": "VO analog",
        "enabled": true,
        "scheduleType": "analog_output_value",
        "startTime": "08:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "AV", "channel": 17, "pointId": "AV-17"},
        "value": 42
      },
      {
        "id": "SCH-VO-B",
        "label": "VO binary",
        "enabled": true,
        "scheduleType": "digital_output_value",
        "startTime": "08:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "BV", "channel": 9, "pointId": "BV-09"},
        "value": 1
      }
    ])");
    ASSERT_TRUE(runtime.load(file.path(), true));

    IoSnapshot io;
    PointTable table;
    PriorityResolver resolver;
    runtime.evaluate_week_minute(0 * 24 * 60 + 10 * 60, io, table, resolver);
    EXPECT_FLOAT_EQ(table.get({PointKind::AV, 16}).value, 42.0f);
    EXPECT_EQ(table.get({PointKind::AV, 16}).source, PointSource::SCHEDULE);
    EXPECT_FLOAT_EQ(table.get({PointKind::BV, 8}).value, 1.0f);
    EXPECT_EQ(table.get({PointKind::BV, 8}).source, PointSource::SCHEDULE);

    runtime.evaluate_week_minute(0 * 24 * 60 + 13 * 60, io, table, resolver);
    EXPECT_EQ(table.get({PointKind::AV, 16}).source, PointSource::DEFAULT);
    EXPECT_EQ(table.get({PointKind::BV, 8}).source, PointSource::DEFAULT);
}

TEST(ScheduleRuntime, RejectsInvalidVirtualOutputTargetPools)
{
    struct Case {
        const char* type;
        const char* kind;
        int channel;
        const char* point_id;
        double value;
    };
    const Case cases[] = {
        {"analog_output_value", "AV", 16, "AV-16", 42},
        {"analog_output_value", "AV", 33, "AV-33", 42},
        {"digital_output_value", "BV", 8, "BV-08", 1},
        {"digital_output_value", "BV", 17, "BV-17", 1},
    };
    for (const Case& tc : cases) {
        char buf[512];
        std::snprintf(buf, sizeof(buf),
                      R"([{"id":"SCH-BAD","label":"Bad","enabled":true,"scheduleType":"%s","startTime":"08:00","endTime":"12:00","weekdays":["monday"],"target":{"kind":"%s","channel":%d,"pointId":"%s"},"value":%.1f}])",
                      tc.type, tc.kind, tc.channel, tc.point_id, tc.value);
        ScheduleRuntime runtime;
        TempFile file(buf);
        EXPECT_FALSE(runtime.load(file.path(), true)) << tc.kind << tc.channel;
    }
}

TEST(ScheduleRuntime, HolidayPeriodSuppressesWeeklySchedules)
{
    ScheduleRuntime runtime;
    TempFile file(R"([
      {
        "id": "SCH-001",
        "label": "Holiday",
        "enabled": true,
        "scheduleType": "holiday_period",
        "startDate": "01-01",
        "endDate": "01-01"
      },
      {
        "id": "SCH-002",
        "label": "AO Monday",
        "enabled": true,
        "scheduleType": "analog_output_value",
        "startTime": "07:00",
        "endTime": "12:00",
        "weekdays": ["monday"],
        "target": {"kind": "AO", "channel": 1, "pointId": "AO-01"},
        "value": 50
      }
    ])");
    ASSERT_TRUE(runtime.load(file.path(), true));

    IoSnapshot io;
    PointTable table;
    PriorityResolver resolver;

    runtime.evaluate_at(0 * 24 * 60 + 8 * 60, ScheduleDate{1, 1}, io, table, resolver);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_DEFAULT);

    runtime.evaluate_at(0 * 24 * 60 + 8 * 60, ScheduleDate{1, 2}, io, table, resolver);
    EXPECT_EQ(resolver.winning_ao_level(0), PRIO_SCHEDULE);
}

TEST(ScheduleRuntime, ReleasesTargetsMissingAfterReload)
{
    ScheduleRuntime runtime;
    TempFile file(kValidSchedule);
    ASSERT_TRUE(runtime.load(file.path(), true));

    IoSnapshot io;
    PointTable table;
    PriorityResolver resolver;
    runtime.evaluate_week_minute(0 * 24 * 60 + 8 * 60, io, table, resolver);
    ASSERT_EQ(resolver.winning_do_level(1), PRIO_SCHEDULE);

    file.write(R"([])");
    ASSERT_TRUE(runtime.reload(file.path(), true));
    runtime.evaluate_week_minute(0 * 24 * 60 + 8 * 60, io, table, resolver);
    EXPECT_EQ(resolver.winning_do_level(1), PRIO_DEFAULT);
}
