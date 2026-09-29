#include "schedule/schedule_runtime.hpp"

#include <algorithm>
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
#include "schedule/schedule_clock.hpp"

namespace core {

namespace {

constexpr std::size_t kMaxSchedules = 64;
constexpr std::size_t kMaxTargets = 32;
constexpr std::size_t kMaxExceptions = 32;
constexpr int kDaySeconds = 24 * 60 * 60;

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

bool as_int(const json::Value* v, int* out)
{
    if (!v || !v->is_num()) return false;
    const double raw = v->num;
    if (!std::isfinite(raw) || raw < -2147483648.0 || raw > 2147483647.0) return false;
    const int parsed = static_cast<int>(raw);
    if (raw != static_cast<double>(parsed)) return false;
    *out = parsed;
    return true;
}

bool as_u64(const json::Value* v, uint64_t* out)
{
    int tmp = 0;
    if (!as_int(v, &tmp) || tmp < 0) return false;
    *out = static_cast<uint64_t>(tmp);
    return true;
}

bool as_string(const json::Value* v, std::string* out)
{
    if (!v || !v->is_str()) return false;
    *out = v->str;
    return true;
}

bool as_bool(const json::Value* v, bool* out)
{
    if (!v || !v->is_bool()) return false;
    *out = v->b;
    return true;
}

/* "HH:mm:ss" → giây trong ngày. */
bool parse_time(const std::string& s, int* out)
{
    if (s.size() != 8 || s[2] != ':' || s[5] != ':') return false;
    for (int i : {0, 1, 3, 4, 6, 7}) {
        if (s[i] < '0' || s[i] > '9') return false;
    }
    const int h = (s[0] - '0') * 10 + (s[1] - '0');
    const int m = (s[3] - '0') * 10 + (s[4] - '0');
    const int sec = (s[6] - '0') * 10 + (s[7] - '0');
    if (h > 23 || m > 59 || sec > 59) return false;
    *out = h * 3600 + m * 60 + sec;
    return true;
}

/* "YYYY-MM-DD" → CivilDate. */
bool parse_date(const std::string& s, CivilDate* out)
{
    if (s.size() != 10 || s[4] != '-' || s[7] != '-') return false;
    for (int i : {0, 1, 2, 3, 5, 6, 8, 9}) {
        if (s[i] < '0' || s[i] > '9') return false;
    }
    const int y = (s[0] - '0') * 1000 + (s[1] - '0') * 100 + (s[2] - '0') * 10 + (s[3] - '0');
    const int mo = (s[5] - '0') * 10 + (s[6] - '0');
    const int d = (s[8] - '0') * 10 + (s[9] - '0');
    if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > days_in_month(y, mo)) return false;
    *out = CivilDate{y, mo, d};
    return true;
}

bool parse_value_type(const std::string& s, ValueType* out)
{
    if (s == "BINARY")     { *out = ValueType::Binary; return true; }
    if (s == "BOOLEAN")    { *out = ValueType::Boolean; return true; }
    if (s == "REAL")       { *out = ValueType::Real; return true; }
    if (s == "UNSIGNED")   { *out = ValueType::Unsigned; return true; }
    if (s == "ENUMERATED") { *out = ValueType::Enumerated; return true; }
    return false;
}

/* Giá trị JSON → double theo value_type. Chuỗi ACTIVE/INACTIVE chỉ hợp lệ với
 * BINARY; bool chỉ hợp lệ với BOOLEAN. Sai kiểu là SCH-CONFIG-002. */
bool parse_value(const json::Value* v, ValueType t, double* out)
{
    if (!v) return false;
    switch (t) {
    case ValueType::Binary:
        if (!v->is_str()) return false;
        if (v->str == "ACTIVE")   { *out = 1.0; return true; }
        if (v->str == "INACTIVE") { *out = 0.0; return true; }
        return false;
    case ValueType::Boolean:
        if (!v->is_bool()) return false;
        *out = v->b ? 1.0 : 0.0;
        return true;
    case ValueType::Real:
        if (!v->is_num() || !std::isfinite(v->num)) return false;
        *out = v->num;
        return true;
    case ValueType::Unsigned:
    case ValueType::Enumerated: {
        int tmp = 0;
        if (!as_int(v, &tmp) || tmp < 0) return false;
        *out = static_cast<double>(tmp);
        return true;
    }
    }
    return false;
}

bool parse_point_kind(const std::string& s, PointKind* kind, int* max_channel)
{
    if (s == "AO")  { *kind = PointKind::AO;  *max_channel = KX_N_AO;  return true; }
    if (s == "DO")  { *kind = PointKind::BO;  *max_channel = KX_N_DO;  return true; }
    if (s == "AV")  { *kind = PointKind::AV;  *max_channel = KX_N_AV;  return true; }
    if (s == "BV")  { *kind = PointKind::BV;  *max_channel = KX_N_BV;  return true; }
    if (s == "MSV") { *kind = PointKind::MSV; *max_channel = KX_N_MSV; return true; }
    if (s == "EXT") { *kind = PointKind::EXT; *max_channel = KX_N_EXT; return true; }
    return false;
}

const char* point_kind_name(PointKind k)
{
    switch (k) {
    case PointKind::AO:  return "AO";
    case PointKind::BO:  return "DO";
    case PointKind::AV:  return "AV";
    case PointKind::BV:  return "BV";
    case PointKind::MSV: return "MSV";
    case PointKind::EXT: return "EXT";
    default: return "?";
    }
}

std::string format_point_id(PointKind k, int channel)
{
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%s-%02d", point_kind_name(k), channel);
    return std::string(buf);
}

/* Kiểu điểm có chứa nổi value_type không (SCH-TARGET-003).
 * BV/DO là nhị phân; AV/AO/EXT là liên tục; MSV là đa trạng thái. */
bool target_kind_matches_value_type(PointKind k, ValueType t)
{
    (void)t;
    /* Hỗ trợ phối hợp nhiều tác vụ: mọi loại điểm ghi được đều gán được vào lịch. */
    return k == PointKind::BO || k == PointKind::BV ||
           k == PointKind::AO || k == PointKind::AV ||
           k == PointKind::MSV || k == PointKind::EXT;
}

bool parse_time_values(const json::Value* arr, ValueType t, std::vector<TimeValue>* out,
                       const char* ctx)
{
    if (!arr || !arr->is_arr()) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_time_values ctx=%s\n", ctx);
        return false;
    }
    out->clear();
    for (const auto& item : arr->arr) {
        std::string time_str;
        TimeValue tv;
        if (!as_string(item->get("time"), &time_str) ||
            !parse_time(time_str, &tv.second_of_day) ||
            !parse_value(item->get("value"), t, &tv.value)) {
            std::fprintf(stderr, "ERROR schedule_cfg.bad_time_value ctx=%s\n", ctx);
            return false;
        }
        out->push_back(tv);
    }
    /* Đặc tả §6.2: tự sắp xếp tăng dần; hai event cùng thời điểm là
     * SCH-CONFIG-002 chứ không phải thứ để đoán ý người dùng. */
    std::sort(out->begin(), out->end(),
              [](const TimeValue& a, const TimeValue& b) { return a.second_of_day < b.second_of_day; });
    for (std::size_t i = 1; i < out->size(); i++) {
        if (out->at(i).second_of_day == out->at(i - 1).second_of_day) {
            std::fprintf(stderr, "ERROR schedule_cfg.duplicate_time ctx=%s sec=%d\n",
                         ctx, out->at(i).second_of_day);
            return false;
        }
    }
    return true;
}

bool parse_date_rule(const json::Value* v, DateRule* out)
{
    std::string type;
    if (!v || !v->is_obj() || !as_string(v->get("type"), &type)) return false;

    if (type == "DATE") {
        std::string s;
        out->type = DateRuleType::Date;
        return as_string(v->get("date"), &s) && parse_date(s, &out->date);
    }
    if (type == "DATE_RANGE") {
        std::string a, b;
        out->type = DateRuleType::DateRange;
        return as_string(v->get("start_date"), &a) && parse_date(a, &out->start_date) &&
               as_string(v->get("end_date"), &b) && parse_date(b, &out->end_date);
    }
    if (type == "WEEK_N_DAY") {
        out->type = DateRuleType::WeekNDay;
        if (!as_int(v->get("month"), &out->month) ||
            !as_int(v->get("week_of_month"), &out->week_of_month) ||
            !as_int(v->get("day_of_week"), &out->day_of_week)) {
            return false;
        }
        return out->month >= 0 && out->month <= 12 &&
               out->week_of_month >= 1 && out->week_of_month <= 6 &&
               out->day_of_week >= 1 && out->day_of_week <= 7;
    }
    if (type == "CALENDAR_REFERENCE") {
        out->type = DateRuleType::CalendarReference;
        return as_string(v->get("calendar_id"), &out->ref_id);
    }
    if (type == "HOLIDAY_GROUP") {
        out->type = DateRuleType::HolidayGroup;
        return as_string(v->get("group_id"), &out->ref_id);
    }
    return false;
}

bool parse_target(const json::Value* v, ValueType value_type, ScheduleTarget* out)
{
    std::string target_type;
    if (!v || !v->is_obj() || !as_string(v->get("target_id"), &out->id) ||
        !as_string(v->get("target_type"), &target_type)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target\n");
        return false;
    }
    if (target_type != "INTERNAL_POINT") {
        /* BACNET_OBJECT thuộc P4 (ADR-023 QĐ-4). Nhận diện được nhưng chưa
         * ghi được — từ chối thẳng thay vì im lặng bỏ qua. */
        std::fprintf(stderr, "ERROR schedule_cfg.target_type_unsupported type=%s (P4)\n",
                     target_type.c_str());
        return false;
    }

    std::string kind_str;
    int channel = 0;
    int max_channel = 0;
    if (!as_string(v->get("point_kind"), &kind_str) || !as_int(v->get("channel"), &channel) ||
        !parse_point_kind(kind_str, &out->kind, &max_channel)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_fields id=%s\n", out->id.c_str());
        return false;
    }
    if (channel < 1 || channel > max_channel) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_channel SCH-TARGET-001 kind=%s ch=%d max=%d\n",
                     kind_str.c_str(), channel, max_channel);
        return false;
    }
    if (!target_kind_matches_value_type(out->kind, value_type)) {
        std::fprintf(stderr, "ERROR schedule_cfg.target_type_mismatch SCH-TARGET-003 kind=%s\n",
                     kind_str.c_str());
        return false;
    }
    out->idx = channel - 1;
    out->point_id = format_point_id(out->kind, channel);

    std::string declared;
    if (as_string(v->get("point_id"), &declared) && declared != out->point_id) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_target_point_id got=%s expected=%s\n",
                     declared.c_str(), out->point_id.c_str());
        return false;
    }
    return true;
}

const char* kWeekdayKeys[7] = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"};

bool parse_schedule(const json::Value& row, ScheduleObject* out)
{
    if (!row.is_obj()) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_row\n");
        return false;
    }

    std::string schema_version;
    if (!as_string(row.get("schema_version"), &schema_version) || schema_version != "3.1") {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_schema_version got=%s want=3.1\n",
                     schema_version.c_str());
        return false;
    }
    std::string value_type_str;
    if (!as_string(row.get("schedule_id"), &out->id) || out->id.empty() ||
        !as_string(row.get("schedule_name"), &out->name) || out->name.empty() ||
        !as_bool(row.get("enabled"), &out->enabled) ||
        !as_string(row.get("value_type"), &value_type_str) ||
        !parse_value_type(value_type_str, &out->value_type)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_required id=%s\n", out->id.c_str());
        return false;
    }
    if (const json::Value* tz = row.get("timezone")) {
        if (!as_string(tz, &out->timezone) || out->timezone.empty()) {
            std::fprintf(stderr, "ERROR schedule_cfg.bad_timezone SCH-TIME-001 id=%s\n", out->id.c_str());
            return false;
        }
    }
    if (!as_int(row.get("priority_for_writing"), &out->priority_for_writing) ||
        out->priority_for_writing < 1 || out->priority_for_writing > 16) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_priority id=%s\n", out->id.c_str());
        return false;
    }
    if (!as_u64(row.get("revision"), &out->revision)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_revision id=%s\n", out->id.c_str());
        return false;
    }

    /* schedule_default BẮT BUỘC — thiếu là SCH-CONFIG-001. */
    const json::Value* def = row.get("schedule_default");
    if (!def || !def->is_obj() || !parse_value(def->get("value"), out->value_type, &out->schedule_default)) {
        std::fprintf(stderr, "ERROR schedule_cfg.missing_default SCH-CONFIG-001 id=%s\n", out->id.c_str());
        return false;
    }

    const json::Value* ep = row.get("effective_period");
    if (!ep || !ep->is_obj()) {
        std::fprintf(stderr, "ERROR schedule_cfg.missing_effective_period id=%s\n", out->id.c_str());
        return false;
    }
    std::string sd;
    if (as_string(ep->get("start_date"), &sd) && !parse_date(sd, &out->effective_period.start)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_effective_start id=%s\n", out->id.c_str());
        return false;
    }
    std::string ed;
    if (as_string(ep->get("end_date"), &ed) && !parse_date(ed, &out->effective_period.end)) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_effective_end id=%s\n", out->id.c_str());
        return false;
    }

    /* weekly_schedule LUÔN đủ bảy ngày (đặc tả §6.1). */
    const json::Value* weekly = row.get("weekly_schedule");
    if (!weekly || !weekly->is_obj()) {
        std::fprintf(stderr, "ERROR schedule_cfg.missing_weekly SCH-CONFIG-002 id=%s\n", out->id.c_str());
        return false;
    }
    for (int d = 0; d < 7; d++) {
        const json::Value* day = weekly->get(kWeekdayKeys[d]);
        if (!day) {
            std::fprintf(stderr, "ERROR schedule_cfg.weekly_missing_day SCH-CONFIG-002 id=%s day=%s\n",
                         out->id.c_str(), kWeekdayKeys[d]);
            return false;
        }
        if (!parse_time_values(day, out->value_type, &out->weekly[d], kWeekdayKeys[d])) return false;
    }

    const json::Value* exceptions = row.get("exception_schedule");
    if (!exceptions || !exceptions->is_arr()) {
        std::fprintf(stderr, "ERROR schedule_cfg.missing_exceptions id=%s\n", out->id.c_str());
        return false;
    }
    if (exceptions->arr.size() > kMaxExceptions) {
        std::fprintf(stderr, "ERROR schedule_cfg.too_many_exceptions id=%s n=%zu\n",
                     out->id.c_str(), exceptions->arr.size());
        return false;
    }
    std::set<std::string> exception_ids;
    for (const auto& e : exceptions->arr) {
        ExceptionEntry entry;
        if (!e->is_obj() || !as_string(e->get("exception_id"), &entry.id) ||
            !as_string(e->get("name"), &entry.name) ||
            !parse_date_rule(e->get("date_rule"), &entry.date_rule) ||
            !as_int(e->get("event_priority"), &entry.event_priority) ||
            entry.event_priority < 1 || entry.event_priority > 16 ||
            !parse_time_values(e->get("time_values"), out->value_type, &entry.time_values,
                               entry.id.c_str()) ||
            entry.time_values.empty()) {
            std::fprintf(stderr, "ERROR schedule_cfg.bad_exception id=%s exc=%s\n",
                         out->id.c_str(), entry.id.c_str());
            return false;
        }
        if (!exception_ids.insert(entry.id).second) {
            std::fprintf(stderr, "ERROR schedule_cfg.dup_exception_id SCH-CONFIG-003 id=%s exc=%s\n",
                         out->id.c_str(), entry.id.c_str());
            return false;
        }
        out->exceptions.push_back(std::move(entry));
    }

    const json::Value* targets = row.get("target_objects");
    if (!targets || !targets->is_arr()) {
        std::fprintf(stderr, "ERROR schedule_cfg.missing_targets id=%s\n", out->id.c_str());
        return false;
    }
    if (targets->arr.size() > kMaxTargets) {
        std::fprintf(stderr, "ERROR schedule_cfg.too_many_targets id=%s n=%zu max=%zu\n",
                     out->id.c_str(), targets->arr.size(), kMaxTargets);
        return false;
    }
    std::set<std::string> target_keys;
    for (const auto& t : targets->arr) {
        ScheduleTarget target;
        if (!parse_target(t.get(), out->value_type, &target)) return false;
        const std::string key = std::to_string(static_cast<int>(target.kind)) + ":" +
                                std::to_string(target.idx);
        if (!target_keys.insert(key).second) {
            std::fprintf(stderr, "ERROR schedule_cfg.dup_target id=%s point=%s\n",
                         out->id.c_str(), target.point_id.c_str());
            return false;
        }
        out->targets.push_back(std::move(target));
    }
    return true;
}

bool parse_holiday_groups(const json::Value* v, std::vector<HolidayGroup>* out)
{
    if (!v || !v->is_arr()) return true;   /* không có nhóm nào là hợp lệ */
    for (const auto& g : v->arr) {
        HolidayGroup group;
        if (!g->is_obj() || !as_string(g->get("group_id"), &group.id)) return false;
        const json::Value* dates = g->get("dates");
        if (dates && dates->is_arr()) {
            for (const auto& d : dates->arr) {
                std::string s;
                CivilDate parsed;
                if (!as_string(d.get(), &s) || !parse_date(s, &parsed)) return false;
                group.dates.push_back(parsed);
            }
        }
        out->push_back(std::move(group));
    }
    return true;
}

/* Giá trị có hiệu lực tại `second_of_day` trong một danh sách Time-Value đã sắp
 * xếp: mốc GẦN NHẤT TRƯỚC hoặc BẰNG thời điểm hiện tại. Trả false nếu ngày này
 * chưa có mốc nào tới lượt. */
bool value_at(const std::vector<TimeValue>& list, int second_of_day, double* out, int* start_sec)
{
    const TimeValue* best = nullptr;
    for (const TimeValue& tv : list) {
        if (tv.second_of_day > second_of_day) break;
        best = &tv;
    }
    if (!best) return false;
    *out = best->value;
    if (start_sec) *start_sec = best->second_of_day;
    return true;
}

float ao_percent_to_engineering(double percent, uint8_t mode)
{
    if (mode == 1) return static_cast<float>(4.0 + (percent * 16.0 / 100.0));
    return static_cast<float>(percent / 10.0);
}

/* Tên nguồn theo hợp đồng schedule_v3_1.schema.json (LOCAL_MANUAL…), KHÁC tên
 * dùng cho log của prio_source_name ("manual"). Trộn hai bộ tên là cách để
 * frontend nhận một enum không khớp schema. */
const char* override_source_name(int level)
{
    switch (level) {
    case PRIO_FIRE_SAFETY:  return "FIRE_SAFETY";
    case PRIO_LOCAL_MANUAL: return "LOCAL_MANUAL";
    case PRIO_BACNET:       return "BACNET";
    case PRIO_LOCAL_LOGIC:  return "LOCAL_LOGIC";
    default:                return "";
    }
}

std::string target_key(PointKind kind, int idx)
{
    return std::to_string(static_cast<int>(kind)) + ":" + std::to_string(idx);
}

} // namespace

/* ── Hàm phơi ra ngoài ─────────────────────────────────────────────────── */

const char* schedule_error_code(ScheduleError e)
{
    switch (e) {
    case ScheduleError::None:                    return "";
    case ScheduleError::ConfigMissingDefault:    return "SCH-CONFIG-001";
    case ScheduleError::ConfigBadWeekly:         return "SCH-CONFIG-002";
    case ScheduleError::ConfigExceptionConflict: return "SCH-CONFIG-003";
    case ScheduleError::TargetNotFound:          return "SCH-TARGET-001";
    case ScheduleError::TargetNotWritable:       return "SCH-TARGET-002";
    case ScheduleError::TargetTypeMismatch:      return "SCH-TARGET-003";
    case ScheduleError::TimeBadTimezone:         return "SCH-TIME-001";
    case ScheduleError::TimeNotSynced:           return "SCH-TIME-002";
    case ScheduleError::WriteFailed:             return "SCH-WRITE-001";
    case ScheduleError::WriteTimeout:            return "SCH-WRITE-002";
    case ScheduleError::RuntimeDown:             return "SCH-RUNTIME-001";
    }
    return "";
}

bool value_valid_for_type(ValueType t, double v)
{
    if (!std::isfinite(v)) return false;
    switch (t) {
    case ValueType::Binary:
    case ValueType::Boolean:
        return v == 0.0 || v == 1.0;
    case ValueType::Real:
        return true;
    case ValueType::Unsigned:
    case ValueType::Enumerated:
        return v >= 0.0 && std::trunc(v) == v;
    }
    return false;
}

int days_in_month(int year, int month)
{
    static const int base[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (month < 1 || month > 12) return 0;
    if (month == 2) {
        const bool leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        return leap ? 29 : 28;
    }
    return base[month - 1];
}

/* Sakamoto — trả 1=Thứ Hai … 7=Chủ nhật (ISO-8601). */
int day_of_week_iso(int year, int month, int day)
{
    static const int t[12] = {0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4};
    int y = year;
    if (month < 3) y -= 1;
    const int sunday_based = (y + y / 4 - y / 100 + y / 400 + t[month - 1] + day) % 7;
    return sunday_based == 0 ? 7 : sunday_based;
}

CivilTime civil_from_tm(const std::tm& tm)
{
    CivilTime out;
    out.year = tm.tm_year + 1900;
    out.month = tm.tm_mon + 1;
    out.day = tm.tm_mday;
    out.weekday = (tm.tm_wday + 6) % 7;   /* tm_wday 0=CN → 0=Thứ Hai */
    out.second_of_day = tm.tm_hour * 3600 + tm.tm_min * 60 + tm.tm_sec;
    return out;
}

static long date_ordinal(int year, int month, int day)
{
    /* Số ngày kể từ 1970-01-01, đủ để so sánh thứ tự. */
    long days = 0;
    for (int y = 1970; y < year; y++) {
        days += ((y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)) ? 366 : 365;
    }
    for (int m = 1; m < month; m++) days += days_in_month(year, m);
    return days + day - 1;
}

bool effective_period_contains(const EffectivePeriod& p, const CivilTime& now)
{
    const long today = date_ordinal(now.year, now.month, now.day);
    if (p.start.valid() && today < date_ordinal(p.start.year, p.start.month, p.start.day)) {
        return false;
    }
    if (p.end.valid() && today > date_ordinal(p.end.year, p.end.month, p.end.day)) {
        return false;
    }
    return true;   /* end không hợp lệ = KHÔNG CÓ ngày kết thúc */
}

bool date_rule_matches(const DateRule& rule, const CivilTime& now,
                       const std::vector<HolidayGroup>& groups)
{
    switch (rule.type) {
    case DateRuleType::Date:
        return rule.date.valid() && rule.date.year == now.year &&
               rule.date.month == now.month && rule.date.day == now.day;

    case DateRuleType::DateRange: {
        if (!rule.start_date.valid() || !rule.end_date.valid()) return false;
        const long today = date_ordinal(now.year, now.month, now.day);
        const long from = date_ordinal(rule.start_date.year, rule.start_date.month, rule.start_date.day);
        const long to = date_ordinal(rule.end_date.year, rule.end_date.month, rule.end_date.day);
        return today >= from && today <= to;
    }

    case DateRuleType::WeekNDay: {
        if (rule.month != 0 && rule.month != now.month) return false;
        if (day_of_week_iso(now.year, now.month, now.day) != rule.day_of_week) return false;
        /* week_of_month 6 = tuần CUỐI (quy ước BACnet): ngày này là lần xuất
         * hiện cuối cùng của thứ đó trong tháng. */
        if (rule.week_of_month == 6) {
            return now.day + 7 > days_in_month(now.year, now.month);
        }
        const int occurrence = (now.day - 1) / 7 + 1;
        return occurrence == rule.week_of_month;
    }

    case DateRuleType::CalendarReference:
    case DateRuleType::HolidayGroup: {
        /* Chưa nạp nhóm thì trả false — không đoán. */
        for (const HolidayGroup& g : groups) {
            if (g.id != rule.ref_id) continue;
            for (const CivilDate& d : g.dates) {
                if (d.year == now.year && d.month == now.month && d.day == now.day) return true;
            }
            return false;
        }
        return false;
    }
    }
    return false;
}

bool load_schedule_config(const std::string& path, bool must_exist,
                          std::vector<ScheduleObject>* out,
                          std::vector<HolidayGroup>* groups)
{
    out->clear();
    if (groups) groups->clear();

    std::string src;
    const int rerr = read_file(path, &src);
    if (rerr == ENOENT && !must_exist) {
        std::fprintf(stderr, "WARN  schedule_cfg.missing path=%s (schedules disabled)\n", path.c_str());
        return true;
    }
    if (rerr != 0) {
        std::fprintf(stderr, "ERROR schedule_cfg.open_fail path=%s errno=%d (%s)\n",
                     path.c_str(), rerr, std::strerror(rerr));
        return false;
    }

    std::string err;
    const json::ValuePtr root = json::Parser::parse(src, &err);
    if (!root) {
        std::fprintf(stderr, "ERROR schedule_cfg.bad_json path=%s (%s)\n", path.c_str(), err.c_str());
        return false;
    }

    /* Hai hình dạng được chấp nhận: mảng thuần (hợp đồng v3.1), hoặc object bọc
     * {schedules:[…], holiday_groups:[…]} khi cần khai báo nhóm ngày lễ. */
    const json::Value* list = root.get();
    if (root->is_obj()) {
        list = root->get("schedules");
        if (groups && !parse_holiday_groups(root->get("holiday_groups"), groups)) {
            std::fprintf(stderr, "ERROR schedule_cfg.bad_holiday_groups path=%s\n", path.c_str());
            return false;
        }
    }
    if (!list || !list->is_arr()) {
        std::fprintf(stderr, "ERROR schedule_cfg.not_an_array path=%s\n", path.c_str());
        return false;
    }
    if (list->arr.size() > kMaxSchedules) {
        std::fprintf(stderr, "ERROR schedule_cfg.too_many count=%zu max=%zu\n",
                     list->arr.size(), kMaxSchedules);
        return false;
    }

    std::set<std::string> seen_ids;
    for (const auto& row : list->arr) {
        ScheduleObject parsed;
        if (!parse_schedule(*row, &parsed)) return false;
        if (!seen_ids.insert(parsed.id).second) {
            std::fprintf(stderr, "ERROR schedule_cfg.dup_id id=%s\n", parsed.id.c_str());
            return false;
        }
        out->push_back(std::move(parsed));
    }
    std::fprintf(stderr, "INFO  schedule_cfg.loaded path=%s schedules=%zu\n", path.c_str(), out->size());
    return true;
}

/* ── ScheduleRuntime ───────────────────────────────────────────────────── */

bool ScheduleRuntime::load(const std::string& path, bool must_exist)
{
    std::vector<ScheduleObject> cfg;
    std::vector<HolidayGroup> groups;
    if (!load_schedule_config(path, must_exist, &cfg, &groups)) return false;
    groups_ = std::move(groups);
    configure(std::move(cfg));
    return true;
}

bool ScheduleRuntime::reload(const std::string& path, bool must_exist)
{
    std::vector<ScheduleObject> cfg;
    std::vector<HolidayGroup> groups;
    if (!load_schedule_config(path, must_exist, &cfg, &groups)) {
        /* Cấu hình hỏng KHÔNG được làm mất cấu hình đang chạy. */
        std::fprintf(stderr, "WARN  schedule.reload_keep_old path=%s\n", path.c_str());
        return false;
    }
    groups_ = std::move(groups);
    configure(std::move(cfg));
    return true;
}

void ScheduleRuntime::configure(std::vector<ScheduleObject> schedules)
{
    schedules_ = std::move(schedules);
    states_.clear();
}

const ScheduleState* ScheduleRuntime::state_of(const std::string& schedule_id) const
{
    for (const ScheduleState& s : states_) {
        if (s.schedule_id == schedule_id) return &s;
    }
    return nullptr;
}

/* Ngoại lệ thắng của ngày cách hôm nay `ahead` ngày (P1-04). Dùng đúng quy tắc
 * phân xử của hôm nay: event_priority nhỏ hơn thắng. */
const ExceptionEntry* ScheduleRuntime::exception_for_offset(const ScheduleObject& s,
                                                            const CivilTime& now, int ahead) const
{
    CivilTime future = now;
    for (int i = 0; i < ahead; i++) {
        future.day++;
        if (future.day > days_in_month(future.year, future.month)) {
            future.day = 1;
            future.month++;
            if (future.month > 12) { future.month = 1; future.year++; }
        }
    }
    future.weekday = day_of_week_iso(future.year, future.month, future.day) - 1;
    future.second_of_day = 0;

    const ExceptionEntry* best = nullptr;
    for (const ExceptionEntry& e : s.exceptions) {
        if (e.time_values.empty()) continue;
        if (!date_rule_matches(e.date_rule, future, groups_)) continue;
        if (!best || e.event_priority < best->event_priority) best = &e;
    }
    return best;
}

ScheduleState ScheduleRuntime::evaluate_schedule(const ScheduleObject& s, const CivilTime& now) const
{
    ScheduleState st;
    st.schedule_id = s.id;

    if (!s.enabled || !effective_period_contains(s.effective_period, now)) {
        st.active = false;
        st.source = ValueSource::None;
        return st;
    }
    st.active = true;

    /* 1. Ngoại lệ — đặc tả §7.3: exception hợp lệ → weekly → default. */
    const ExceptionEntry* winner = nullptr;
    bool conflict = false;
    for (const ExceptionEntry& e : s.exceptions) {
        if (!date_rule_matches(e.date_rule, now, groups_)) continue;
        if (!winner) {
            winner = &e;
        } else if (e.event_priority < winner->event_priority) {
            winner = &e;
            conflict = false;
        } else if (e.event_priority == winner->event_priority) {
            /* Bằng priority ⇒ báo xung đột. KHÔNG tự chọn theo thứ tự khai báo
             * hay thời gian tạo (đặc tả §7.3 mục 3). */
            conflict = true;
        }
    }
    if (conflict) st.error = ScheduleError::ConfigExceptionConflict;

    int start_sec = -1;
    if (winner && value_at(winner->time_values, now.second_of_day, &st.effective_value, &start_sec)) {
        st.source = ValueSource::Exception;
        st.source_exception_id = winner->id;
    } else {
        /* 2. Lịch tuần — mốc gần nhất trước hoặc bằng bây giờ; chưa tới mốc nào
         * hôm nay thì lùi tối đa 7 ngày để lấy mốc cuối cùng còn hiệu lực. */
        bool found = false;
        for (int back = 0; back < 7 && !found; back++) {
            const int day = ((now.weekday - back) % 7 + 7) % 7;
            const int cutoff = (back == 0) ? now.second_of_day : kDaySeconds - 1;
            if (value_at(s.weekly[day], cutoff, &st.effective_value, &start_sec)) {
                st.source = ValueSource::Weekly;
                found = true;
            }
        }
        if (!found) {
            /* 3. Mặc định. */
            st.effective_value = s.schedule_default;
            st.source = ValueSource::Default;
        }
    }

    /* Lần chuyển trạng thái kế tiếp — quét tối đa 8 ngày tới.
     *
     * P1-04: bản đầu chỉ tra ngoại lệ cho HÔM NAY, các ngày sau luôn đọc lịch
     * tuần. Với một lịch tuần rỗng và ngoại lệ vào ngày mai, nó trả -1 nghĩa là
     * "không có lần chuyển nào" trong khi thực tế có — giao diện hiện gạch
     * ngang lúc hệ thống sắp làm việc. Nay mỗi ngày phía trước đều được hỏi
     * xem có ngoại lệ nào áp dụng không, đúng thứ tự exception → weekly. */
    st.next_transition_week_second = -1;
    for (int ahead = 0; ahead < 8 && st.next_transition_week_second < 0; ahead++) {
        const int day = (now.weekday + ahead) % 7;
        const int floor_sec = (ahead == 0) ? now.second_of_day : -1;

        const std::vector<TimeValue>* list = &s.weekly[day];
        if (ahead == 0) {
            if (winner) list = &winner->time_values;
        } else if (const ExceptionEntry* future = exception_for_offset(s, now, ahead)) {
            list = &future->time_values;
        }

        for (const TimeValue& tv : *list) {
            if (tv.second_of_day <= floor_sec) continue;
            st.next_transition_week_second = (now.weekday + ahead) * kDaySeconds + tv.second_of_day;
            break;
        }
    }

    for (const ScheduleTarget& t : s.targets) {
        TargetResult r;
        r.target_id = t.id;
        r.kind = t.kind;
        r.idx = t.idx;
        r.written_value = st.effective_value;
        st.targets.push_back(r);
    }
    return st;
}

void ScheduleRuntime::evaluate(const IoSnapshot& io, PointWriter& writer, PriorityResolver& resolver)
{
    evaluate(capture_clock_snapshot(), io, writer, resolver);
}

void ScheduleRuntime::evaluate(const ClockSnapshot& clock, const IoSnapshot& io, PointWriter& writer,
                               PriorityResolver& resolver)
{
    const int64_t utc_epoch_s = clock.utc_epoch_ms / 1000;

    /* SCHD-303: hai đồng hồ trôi khác nhau ⇒ realtime vừa bị dịch (NTP sửa
     * giờ, người dùng đổi giờ, hoặc RTC đọc lại sau khởi động). Ghi lại để
     * người vận hành giải thích được vì sao lịch vừa đổi trạng thái đột ngột.
     * Không cần ép tính lại: vòng quét vốn đánh giá lại mỗi lần, và mô hình
     * này tính GIÁ TRỊ ĐANG HIỆU LỰC chứ không phát lại chuỗi sự kiện. */
    const TimeJumpDetector::Result jump = jump_detector_.observe(clock.monotonic_ns, clock.utc_epoch_ms);
    if (jump.jumped) {
        std::fprintf(stderr, "WARN  schedule.time_jump delta_s=%lld (đánh giá lại toàn bộ lịch)\n",
                     static_cast<long long>(jump.delta_s));
    }

    /* SCHD-306 / SCH-TIME-002: đồng hồ chưa được đặt thì mọi ngày giờ tính ra
     * đều vô nghĩa. KHÔNG giữ lệnh nào — nhả hết để nguồn ưu tiên thấp hơn
     * điều khiển. Ra lệnh theo một cái đồng hồ sai còn tệ hơn không ra lệnh. */
    if (!system_clock_synced(utc_epoch_s)) {
        std::fprintf(stderr, "ERROR schedule.clock_not_synced SCH-TIME-002 epoch_s=%lld\n",
                     static_cast<long long>(utc_epoch_s));
        states_.clear();
        states_.reserve(schedules_.size());
        for (const ScheduleObject& s : schedules_) {
            ScheduleState st;
            st.schedule_id = s.id;
            st.active = false;
            st.error = ScheduleError::TimeNotSynced;
            states_.push_back(std::move(st));
        }
        release_missing({}, writer, resolver);
        applied_.clear();
        return;
    }

    evaluate_zoned(utc_epoch_s, io, writer, resolver);
}

/* SCHD-301/302: mỗi lịch được đổi sang giờ dân dụng của MÚI GIỜ CỦA CHÍNH NÓ.
 * Trước bản này mọi lịch dùng TZ của tiến trình, nên trên một bo chạy UTC thì
 * lịch khai báo Asia/Ho_Chi_Minh chạy lệch 7 tiếng mà không có dấu hiệu nào. */
void ScheduleRuntime::evaluate_zoned(int64_t utc_epoch_s, const IoSnapshot& io,
                                     PointWriter& writer, PriorityResolver& resolver)
{
    states_.clear();
    states_.reserve(schedules_.size());
    for (const ScheduleObject& s : schedules_) {
        CivilTime now;
        if (!civil_time_in_zone(s.timezone, utc_epoch_s, &now)) {
            /* Múi giờ sai KHÔNG được lặng lẽ rơi về UTC — đó là cách biến một
             * lỗi cấu hình nhìn thấy được thành một lệch giờ âm thầm. */
            std::fprintf(stderr, "ERROR schedule.bad_timezone SCH-TIME-001 id=%s tz=%s\n",
                         s.id.c_str(), s.timezone.c_str());
            ScheduleState st;
            st.schedule_id = s.id;
            st.active = false;
            st.error = ScheduleError::TimeBadTimezone;
            states_.push_back(std::move(st));
            continue;
        }
        states_.push_back(evaluate_schedule(s, now));
    }
    apply_states(io, writer, resolver);
}

void ScheduleRuntime::evaluate_at(const CivilTime& now, const IoSnapshot& io, PointWriter& writer,
                                  PriorityResolver& resolver)
{
    states_.clear();
    states_.reserve(schedules_.size());
    for (const ScheduleObject& s : schedules_) {
        states_.push_back(evaluate_schedule(s, now));
    }
    apply_states(io, writer, resolver);
}

/* Phân xử priority giữa các lịch rồi ghi ra target. Tách riêng để cả đường
 * evaluate_at (một múi giờ) lẫn evaluate_zoned (mỗi lịch một múi giờ) dùng
 * chung — hai bản sao của bước phân xử là hai chỗ để lệch nhau. */
void ScheduleRuntime::apply_states(const IoSnapshot& io, PointWriter& writer,
                                   PriorityResolver& resolver)
{
    /* ── Phân xử priority_for_writing 1..16 GIỮA CÁC LỊCH (ADR-023 QĐ-1) ──
     * Nhiều lịch cùng ghi một điểm: priority nhỏ hơn thắng; bằng nhau thì lịch
     * có mốc bắt đầu muộn hơn thắng; vẫn bằng thì lịch đứng sau thắng và ghi
     * cảnh báo. Chỉ NGƯỜI THẮNG mới đi xuống PRIO_SCHEDULE của resolver. */
    struct Claim {
        std::size_t schedule_index = 0;
        std::size_t target_index = 0;
        int priority = 16;
        int next_transition = -1;
        double value = 0.0;
    };
    std::map<std::string, Claim> winners;

    for (std::size_t si = 0; si < schedules_.size(); si++) {
        const ScheduleState& st = states_[si];
        if (!st.active) continue;
        for (std::size_t ti = 0; ti < st.targets.size(); ti++) {
            const TargetResult& tr = st.targets[ti];
            const std::string key = target_key(tr.kind, tr.idx);
            Claim claim{si, ti, schedules_[si].priority_for_writing,
                        st.next_transition_week_second, st.effective_value};
            const auto it = winners.find(key);
            if (it == winners.end()) {
                winners[key] = claim;
                continue;
            }
            const Claim& cur = it->second;
            const bool better = claim.priority < cur.priority ||
                                (claim.priority == cur.priority && si > cur.schedule_index);
            if (better) {
                /* Lịch thua vẫn phải thấy được là nó thua, không im lặng. */
                states_[cur.schedule_index].targets[cur.target_index].written = false;
                winners[key] = claim;
            } else {
                states_[si].targets[ti].written = false;
            }
        }
    }

    std::vector<AppliedTarget> active;
    active.reserve(winners.size());
    for (const auto& item : winners) {
        const Claim& c = item.second;
        ScheduleState& st = states_[c.schedule_index];
        TargetResult& tr = st.targets[c.target_index];

        active.push_back({tr.kind, tr.idx});
        bool ok = true;
        if (tr.kind == PointKind::AO) {
            const uint8_t mode = (tr.idx >= 0 && tr.idx < KX_N_AO) ? io.ao_mode[tr.idx] : 0;
            const double pct = (c.value == 1.0) ? 100.0 : c.value;
            ok = resolver.set_ao(PRIO_SCHEDULE, tr.idx, ao_percent_to_engineering(pct, mode));
        } else if (tr.kind == PointKind::BO) {
            ok = resolver.set_do(PRIO_SCHEDULE, tr.idx, c.value != 0.0);
        } else {
            /* Point ảo và điểm mở rộng đi qua đường ghi dùng chung; với EXT nó
             * đặt cả setpoint + dirty để iobus đẩy xuống thiết bị. */
            ok = writer.write({tr.kind, tr.idx}, static_cast<float>(c.value),
                              PointSource::SCHEDULE);
        }
        tr.written = ok;
        tr.written_value = c.value;
        /* Một target ghi lỗi KHÔNG được ngăn các target khác (đặc tả §11). */
        if (!ok) tr.error = ScheduleError::WriteFailed;

        /* Ghi được vào resolver chưa chắc đã tới đầu ra: một nguồn priority cao
         * hơn (safety, lệnh tay, BACnet) có thể đang giữ kênh. Không nói ra thì
         * người vận hành thấy "lịch đang bật" mà thiết bị đứng im. */
        tr.override_source = "";
        if (tr.kind == PointKind::AO || tr.kind == PointKind::BO) {
            const int winner = tr.kind == PointKind::AO ? resolver.winning_ao_level(tr.idx)
                                                        : resolver.winning_do_level(tr.idx);
            if (winner != PRIO_SCHEDULE) tr.override_source = override_source_name(winner);
        }
    }

    release_missing(active, writer, resolver);
    applied_ = std::move(active);
}

void ScheduleRuntime::release_missing(const std::vector<AppliedTarget>& active, PointWriter& writer,
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
            writer.release({old.kind, old.idx});
        }
    }
}

} // namespace core
