#ifndef CORE_SCHEDULE_RUNTIME_HPP
#define CORE_SCHEDULE_RUNTIME_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "graph/clock_snapshot.hpp"
#include "ipc/iobus_reader.hpp"
#include "graph/point_table.hpp"
#include "ipc/priority_resolver.hpp"

namespace core {

enum class ScheduleType {
    NotActive,
    ControllerOperationMode,
    ControlLoopSetpoint,
    AnalogOutputValue,
    FanStateValue,
    DigitalOutputValue,
    HolidayPeriod
};

struct ScheduleTarget {
    PointKind kind = PointKind::MSV;
    int idx = 0;
    std::string point_id;
};

struct ScheduleConfig {
    std::string id;
    std::string label;
    bool enabled = false;
    ScheduleType type = ScheduleType::NotActive;
    int start_minute = 0;
    int end_minute = 0;
    int start_date = 0;      /* month/day ordinal, 1..366 */
    int end_date = 0;
    bool weekdays[7] = {};   /* 0=Monday ... 6=Sunday */
    ScheduleTarget target;
    double value = 0.0;
};

struct ScheduleDate {
    int month = 1;
    int day = 1;
};

class ScheduleRuntime {
public:
    bool load(const std::string& path, bool must_exist = false);
    bool reload(const std::string& path, bool must_exist = false);
    void configure(std::vector<ScheduleConfig> schedules);

    void evaluate(const IoSnapshot& io, PointTable& table, PriorityResolver& resolver);
    void evaluate(const ClockSnapshot& clock, const IoSnapshot& io, PointTable& table,
                  PriorityResolver& resolver);
    void evaluate_week_minute(int week_minute, const IoSnapshot& io,
                              PointTable& table, PriorityResolver& resolver);
    void evaluate_at(int week_minute, ScheduleDate date, const IoSnapshot& io,
                     PointTable& table, PriorityResolver& resolver);

    std::size_t schedule_count() const { return schedules_.size(); }

private:
    struct AppliedTarget {
        PointKind kind = PointKind::MSV;
        int idx = 0;
    };

    std::vector<ScheduleConfig> schedules_;
    std::vector<AppliedTarget> applied_;

    void release_missing(const std::vector<AppliedTarget>& active, PointTable& table,
                         PriorityResolver& resolver);
};

bool load_schedule_config(const std::string& path, bool must_exist,
                          std::vector<ScheduleConfig>* out);

} // namespace core

#endif /* CORE_SCHEDULE_RUNTIME_HPP */
