#include "schedule/schedule_runtime.hpp"

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <utility>

#include "json_min.hpp"

namespace core {

namespace {

constexpr std::size_t kMaxSchedules = 64;
constexpr int kDayMinutes = 24 * 60;
constexpr int kWeekMinutes = 7 * 24 * 60;

int read_file(const std::string& path, std::string* out)
{
    if (path.empty()) return ENOENT;
    errno = 0;
    std::ifstream f(path);
    if (!f.is_open()) return errno != 0 ? errno : ENOENT;
    std::stringstream ss;
    ss << f.rdbuf();
    *out = ss.str();
    return 0;
}

bool as_int(const json::Value* value, int* out)
{
    if (!value || !value->is_num()) return false;
    const double raw = value->num;
    if (!std::isfinite(raw) ||
        raw < static_cast<double>(std::numeric_limits<int>::min()) ||
        raw > static_cast<double>(std::numeric_limits<int>::max())) {
        return false;
    }
    const int parsed = static_cast<int>(raw);
    if (raw != static_cast<double>(parsed)) return false;
    *out = parsed;
    return true;
}

bool as_number(const json::Value* value, double* out)
{
    if (!value || !value->is_num() || !std::isfinite(value->num)) return false;
    *out = value->num;
    return true;
}

bool as_string(const json::Value* value, std::string* out)
{
    if (!value || !value->is_str()) return false;
    *out = value->str;
    return true;
}

bool as_bool(const json::Value* value, bool* out)
{
    if (!value || !value->is_bool()) return false;
    *out = value->b;
    return true;
}

bool parse_time(const std::string& value, int* out)
{
    if (value.size() != 5 || value[2] != ':') return false;
    const int hour = (value[0] - '0') * 10 + (value[1] - '0');
    const int minute = (value[3] - '0') * 10 + (value[4] - '0');
    if (value[0] < '0' || value[0] > '9' || value[1] < '0' || value[1] > '9' ||
        value[3] < '0' || value[3] > '9' || value[4] < '0' || value[4] > '9' ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return false;
    }
    *out = hour * 60 + minute;
    return true;
}

bool parse_date(const std::string& value, int* out)
{
    if (value.size() != 5 || value[2] != '-') return false;
    if (value[0] < '0' || value[0] > '9' || value[1] < '0' || value[1] > '9' ||
        value[3] < '0' || value[3] > '9' || value[4] < '0' || value[4] > '9') {
        return false;
    }
    const int month = (value[0] - '0') * 10 + (value[1] - '0');
    const int day = (value[3] - '0') * 10 + (value[4] - '0');
    static const int month_days[12] = {31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (month < 1 || month > 12 || day < 1 || day > month_days[month - 1]) return false;
    int ordinal = day;
    for (int i = 0; i < month - 1; i++) ordinal += month_days[i];
    *out = ordinal;
    return true;
}

bool parse_weekday(const std::string& value, int* out)
{
    if (value == "monday")    { *out = 0; return true; }
    if (value == "tuesday")   { *out = 1; return true; }
    if (value == "wednesday") { *out = 2; return true; }
    if (value == "thursday")  { *out = 3; return true; }
    if (value == "friday")    { *out = 4; return true; }
    if (value == "saturday")  { *out = 5; return true; }
    if (value == "sunday")    { *out = 6; return true; }
    return false;
}

bool parse_type(const std::string& value, ScheduleType* out)
{
    if (value == "not_active") { *out = ScheduleType::NotActive; return true; }
    if (value == "controller_operation_mode") {
        *out = ScheduleType::ControllerOperationMode; return true;
    }
    if (value == "control_loop_setpoint") { *out = ScheduleType::ControlLoopSetpoint; return true; }
    if (value == "analog_output_value") { *out = ScheduleType::AnalogOutputValue; return true; }
    if (value == "fan_state_value") { *out = ScheduleType::FanStateValue; return true; }
    if (value == "digital_output_value") { *out = ScheduleType::DigitalOutputValue; return true; }
    if (value == "holiday_period") { *out = ScheduleType::HolidayPeriod; return true; }
    return false;
}

std::string point_id(const char* kind, int channel)
{
    return std::string(kind) + "-" + (channel < 10 ? "0" : "") + std::to_string(channel);
}

bool parse_target(const json::Value* value, ScheduleType type, ScheduleTarget* out)
{
    if (type == ScheduleType::ControllerOperationMode) {
        out->kind = PointKind::MSV;
        out->idx = 0;
        out->point_id = point_id("MSV", 1);
        if (!value) return true;
    }
    if (!value || !value->is_obj()) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target\n");
        return false;
    }

    std::string kind;
    int channel = 0;
    std::string pid;
    if (!as_string(value->get("kind"), &kind) || !as_int(value->get("channel"), &channel)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_fields\n");
        return false;
    }
    if (const json::Value* p = value->get("pointId")) {
        if (!as_string(p, &pid)) return false;
    }

    int max_channel = 0;
    if (kind == "AO") {
        out->kind = PointKind::AO;
        max_channel = KX_N_AO;
    } else if (kind == "DO") {
        out->kind = PointKind::BO;
        max_channel = KX_N_DO;
    } else if (kind == "AV") {
        out->kind = PointKind::AV;
        max_channel = KX_N_AV;
    } else if (kind == "BV") {
        out->kind = PointKind::BV;
        max_channel = KX_N_BV;
    } else if (kind == "MSV") {
        out->kind = PointKind::MSV;
        max_channel = KX_N_MSV;
    } else {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_kind kind=%s\n", kind.c_str());
        return false;
    }
    if (channel < 1 || channel > max_channel) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_channel kind=%s ch=%d\n",
                     kind.c_str(), channel);
        return false;
    }
    const std::string expected_pid = point_id(kind.c_str(), channel);
    if (!pid.empty() && pid != expected_pid) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_point_id pointId=%s expected=%s\n",
                     pid.c_str(), expected_pid.c_str());
        return false;
    }
    out->idx = channel - 1;
    out->point_id = expected_pid;
    return true;
}

bool executable_type(ScheduleType type)
{
    return type != ScheduleType::NotActive && type != ScheduleType::HolidayPeriod;
}

bool valid_target_for_type(ScheduleType type, const ScheduleTarget& target)
{
    if (type == ScheduleType::ControllerOperationMode) {
        return target.kind == PointKind::MSV && target.idx == 0;
    }
    if (type == ScheduleType::ControlLoopSetpoint) return target.kind == PointKind::AV;
    if (type == ScheduleType::AnalogOutputValue) {
        return target.kind == PointKind::AO ||
               (target.kind == PointKind::AV && target.idx >= 16);
    }
    if (type == ScheduleType::FanStateValue || type == ScheduleType::DigitalOutputValue) {
        return target.kind == PointKind::BO ||
               (target.kind == PointKind::BV && target.idx >= 8);
    }
    return true;
}

bool valid_value_for_type(ScheduleType type, double value)
{
    if (!std::isfinite(value)) return false;
    if (type == ScheduleType::ControllerOperationMode) return value == 0.0 || value == 1.0 || value == 2.0;
    if (type == ScheduleType::AnalogOutputValue) return value >= 0.0 && value <= 100.0;
    if (type == ScheduleType::FanStateValue || type == ScheduleType::DigitalOutputValue) {
        return value == 0.0 || value == 1.0;
    }
    return true;
}

bool parse_schedule(const json::Value& row, ScheduleConfig* out)
{
    if (!row.is_obj()) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_row\n");
        return false;
    }
    std::string type;
    std::string start_time;
    std::string end_time;
    std::string start_date;
    std::string end_date;
    if (!as_string(row.get("id"), &out->id) || out->id.empty() ||
        !as_string(row.get("label"), &out->label) || out->label.empty() ||
        !as_bool(row.get("enabled"), &out->enabled) ||
        !as_string(row.get("scheduleType"), &type) ||
        !parse_type(type, &out->type)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_required\n");
        return false;
    }

    if (out->type == ScheduleType::HolidayPeriod) {
        if (!as_string(row.get("startDate"), &start_date) ||
            !as_string(row.get("endDate"), &end_date) ||
            !parse_date(start_date, &out->start_date) ||
            !parse_date(end_date, &out->end_date)) {
            std::fprintf(stderr, "ERROR schedule_cfg.bad_holiday_date id=%s\n", out->id.c_str());
            return false;
        }
        return true;
    }
    if (!executable_type(out->type)) return true;

    if (!as_string(row.get("startTime"), &start_time) &&
        !as_string(row.get("timeOfDay"), &start_time)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_time_or_value id=%s\n", out->id.c_str());
        return false;
    }
    if (!as_string(row.get("endTime"), &end_time) ||
        !parse_time(start_time, &out->start_minute) ||
        !parse_time(end_time, &out->end_minute) ||
        out->start_minute == out->end_minute ||
        !as_number(row.get("value"), &out->value)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_time_or_value id=%s\n", out->id.c_str());
        return false;
    }
    if (!parse_target(row.get("target"), out->type, &out->target) ||
        !valid_target_for_type(out->type, out->target) ||
        !valid_value_for_type(out->type, out->value)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_or_value id=%s\n", out->id.c_str());
        return false;
    }

    const json::Value* weekdays = row.get("weekdays");
    if (!weekdays || !weekdays->is_arr() || weekdays->arr.empty()) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_weekdays id=%s\n", out->id.c_str());
        return false;
    }
    for (const auto& day : weekdays->arr) {
        std::string raw;
        int index = 0;
        if (!as_string(day.get(), &raw) || !parse_weekday(raw, &index)) {
            std::fprintf(stderr, "ERROR schedule_cfg.bad_weekday id=%s\n", out->id.c_str());
            return false;
        }
        out->weekdays[index] = true;
    }
    return true;
}

int week_minute(const std::tm& tm)
{
    const int monday_based = (tm.tm_wday + 6) % 7;
    return monday_based * 24 * 60 + tm.tm_hour * 60 + tm.tm_min;
}

ScheduleDate schedule_date(const std::tm& tm)
{
    return ScheduleDate{tm.tm_mon + 1, tm.tm_mday};
}

int date_ordinal(ScheduleDate date)
{
    static const int month_days[12] = {31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (date.month < 1 || date.month > 12) return 0;
    if (date.day < 1 || date.day > month_days[date.month - 1]) return 0;
    int ordinal = date.day;
    for (int i = 0; i < date.month - 1; i++) ordinal += month_days[i];
    return ordinal;
}

bool ordinal_in_range(int value, int start, int end)
{
    if (start <= 0 || end <= 0 || value <= 0) return false;
    if (start <= end) return value >= start && value <= end;
    return value >= start || value <= end;
}

bool interval_active(const ScheduleConfig& schedule, int week_minute, int* age)
{
    week_minute %= kWeekMinutes;
    if (week_minute < 0) week_minute += kWeekMinutes;
    for (int day = 0; day < 7; day++) {
        if (!schedule.weekdays[day]) continue;
        const int start = day * kDayMinutes + schedule.start_minute;
        int end = day * kDayMinutes + schedule.end_minute;
        if (end <= start) end += kDayMinutes;
        for (int offset = 0; offset <= kWeekMinutes; offset += kWeekMinutes) {
            const int now = week_minute + offset;
            if (now >= start && now < end) {
                *age = now - start;
                return true;
            }
        }
    }
    return false;
}

struct Winner {
    ScheduleConfig schedule;
    int age = kWeekMinutes + 1;
    std::size_t order = 0;
};

std::string target_key(const ScheduleTarget& target)
{
    return std::to_string(static_cast<int>(target.kind)) + ":" + std::to_string(target.idx);
}

float ao_percent_to_engineering(double percent, uint8_t mode)
{
    if (mode == 1) return static_cast<float>(4.0 + (percent * 16.0 / 100.0));
    return static_cast<float>(percent / 10.0);
}

} // namespace

bool load_schedule_config(const std::string& path, bool must_exist,
                          std::vector<ScheduleConfig>* out)
{
    out->clear();
    std::string src;
    const int rerr = read_file(path, &src);
    if (rerr == ENOENT && !must_exist) {
        std::fprintf(stderr, "WARN  schedule_cfg.missing path=%s (schedules disabled)\n",
                     path.c_str());
        return true;
    }
    if (rerr != 0) {
        std::fprintf(stderr, "ERROR schedule_cfg.open_fail path=%s errno=%d (%s)\n",
                     path.c_str(), rerr, std::strerror(rerr));
        return false;
    }

    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root || !root->is_arr()) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_json path=%s (%s)\n",
                     path.c_str(), err.c_str());
        return false;
    }
    if (root->arr.size() > kMaxSchedules) {
        std::fprintf(stderr, "ERROR schedule_cfg.too_many count=%zu max=%zu\n",
                     root->arr.size(), kMaxSchedules);
        return false;
    }

    std::set<std::string> seen_ids;
    for (const auto& row : root->arr) {
        ScheduleConfig parsed;
        if (!parse_schedule(*row, &parsed)) return false;
        if (!seen_ids.insert(parsed.id).second) {
            std::fprintf(stderr, "ERROR schedule_cfg.dup_id id=%s\n", parsed.id.c_str());
            return false;
        }
        out->push_back(std::move(parsed));
    }
    std::fprintf(stderr, "INFO  schedule_cfg.loaded path=%s schedules=%zu\n",
                 path.c_str(), out->size());
    return true;
}

bool ScheduleRuntime::load(const std::string& path, bool must_exist)
{
    std::vector<ScheduleConfig> cfg;
    if (!load_schedule_config(path, must_exist, &cfg)) return false;
    configure(std::move(cfg));
    return true;
}

bool ScheduleRuntime::reload(const std::string& path, bool must_exist)
{
    std::vector<ScheduleConfig> cfg;
    if (!load_schedule_config(path, must_exist, &cfg)) {
        std::fprintf(stderr, "WARN  schedule.reload_keep_old path=%s\n", path.c_str());
        return false;
    }
    configure(std::move(cfg));
    return true;
}

void ScheduleRuntime::configure(std::vector<ScheduleConfig> schedules)
{
    schedules_ = std::move(schedules);
}

void ScheduleRuntime::evaluate(const IoSnapshot& io, PointTable& table,
                               PriorityResolver& resolver)
{
    evaluate(capture_clock_snapshot(), io, table, resolver);
}

void ScheduleRuntime::evaluate(const ClockSnapshot& clock, const IoSnapshot& io,
                               PointTable& table, PriorityResolver& resolver)
{
    evaluate_at(week_minute(clock.civil_time), schedule_date(clock.civil_time),
                io, table, resolver);
}

void ScheduleRuntime::evaluate_week_minute(int week_minute, const IoSnapshot& io,
                                           PointTable& table, PriorityResolver& resolver)
{
    evaluate_at(week_minute, schedule_date(capture_clock_snapshot().civil_time),
                io, table, resolver);
}

void ScheduleRuntime::evaluate_at(int week_minute, ScheduleDate date, const IoSnapshot& io,
                                  PointTable& table, PriorityResolver& resolver)
{
    week_minute %= kWeekMinutes;
    if (week_minute < 0) week_minute += kWeekMinutes;
    const int today = date_ordinal(date);

    bool holiday_active = false;
    for (const ScheduleConfig& schedule : schedules_) {
        if (!schedule.enabled || schedule.type != ScheduleType::HolidayPeriod) continue;
        if (ordinal_in_range(today, schedule.start_date, schedule.end_date)) {
            holiday_active = true;
            break;
        }
    }

    std::map<std::string, Winner> winners;
    if (!holiday_active) {
        for (std::size_t order = 0; order < schedules_.size(); order++) {
            const ScheduleConfig& schedule = schedules_[order];
            if (!schedule.enabled || !executable_type(schedule.type)) continue;
            int age = 0;
            if (!interval_active(schedule, week_minute, &age)) continue;
            const std::string key = target_key(schedule.target);
            const auto it = winners.find(key);
            if (it == winners.end() || age < it->second.age ||
                (age == it->second.age && order > it->second.order)) {
                winners[key] = Winner{schedule, age, order};
            }
        }
    }

    std::vector<AppliedTarget> active;
    active.reserve(winners.size());
    for (const auto& item : winners) {
        const ScheduleConfig& schedule = item.second.schedule;
        const ScheduleTarget& target = schedule.target;
        active.push_back({target.kind, target.idx});
        if (target.kind == PointKind::AO) {
            const uint8_t mode = target.idx >= 0 && target.idx < KX_N_AO ? io.ao_mode[target.idx] : 0;
            resolver.set_ao(PRIO_SCHEDULE, target.idx,
                            ao_percent_to_engineering(schedule.value, mode));
        } else if (target.kind == PointKind::BO) {
            resolver.set_do(PRIO_SCHEDULE, target.idx, schedule.value != 0.0);
        } else {
            table.set_virtual({target.kind, target.idx},
                              static_cast<float>(schedule.value), PointSource::SCHEDULE);
        }
    }
    release_missing(active, table, resolver);
    applied_ = std::move(active);
}

void ScheduleRuntime::release_missing(const std::vector<AppliedTarget>& active, PointTable& table,
                                      PriorityResolver& resolver)
{
    for (const AppliedTarget& old : applied_) {
        bool still_active = false;
        for (const AppliedTarget& now : active) {
            if (old.kind == now.kind && old.idx == now.idx) {
                still_active = true;
                break;
            }
        }
        if (still_active) continue;
        if (old.kind == PointKind::AO) {
            resolver.release_ao(PRIO_SCHEDULE, old.idx);
        } else if (old.kind == PointKind::BO) {
            resolver.release_do(PRIO_SCHEDULE, old.idx);
        } else {
            table.release_virtual({old.kind, old.idx});
        }
    }
}

} // namespace core
