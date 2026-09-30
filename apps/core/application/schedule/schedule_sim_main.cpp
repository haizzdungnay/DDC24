/**
 * @file  schedule_sim_main.cpp
 * @brief mkddc-schedule-sim — mô phỏng lịch bằng ĐÚNG engine của controller.
 *
 * Plan 50 SCHD-133 và yêu cầu của PM/CTO: "simulation phải dùng chung
 * evaluation engine với controller".
 *
 * Vì sao là một binary riêng thay vì cài lại thuật toán trong Go: cài lại là tự
 * nói dối. Bản Go sẽ đúng cho tới ngày nó lệch khỏi bản C++, và ngày đó không
 * ai biết — người dùng chỉ thấy "mô phỏng bảo ON mà thiết bị vẫn tắt".
 *
 * Dùng:
 *   mkddc-schedule-sim --config FILE --schedule SCH-001 \
 *                      --start 2026-08-10 --days 7 [--step-sec 60]
 *   mkddc-schedule-sim --config FILE --point POINT_ID \
 *                      --from RFC3339 --to RFC3339 [--step-sec 60]
 *
 * Ra stdout một JSON:
 *   chế độ --schedule: { "transitions":[…], "gaps":[…], "conflicts":[…] }
 *   chế độ --point:    { "segments":[…], "conflicts":[…] }
 *
 * Mã thoát: 0 thành công, 1 tham số sai, 2 không nạp được cấu hình,
 *           3 không tìm thấy schedule_id.
 */
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <map>
#include <string>
#include <vector>

#include "schedule/schedule_runtime.hpp"
#include "schedule/schedule_clock.hpp"

using namespace core;

namespace {

struct Args {
    std::string config;
    std::string schedule_id;
    std::string point_id;
    std::string from_str;
    std::string to_str;
    int year = 0, month = 0, day = 0;
    int days = 7;
    int step_sec = 60;
};

bool parse_date_arg(const char* s, int* y, int* m, int* d)
{
    return s && std::sscanf(s, "%d-%d-%d", y, m, d) == 3 &&
           *m >= 1 && *m <= 12 && *d >= 1 && *d <= 31;
}

bool parse_rfc3339_epoch_s(const std::string& text, int64_t* out_s)
{
    if (text.empty() || !out_s) return false;
    int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
    int n = 0;
    if (std::sscanf(text.c_str(), "%4d-%2d-%2dT%2d:%2d:%2d%n",
                    &year, &month, &day, &hour, &minute, &second, &n) < 6) {
        return false;
    }
    std::tm tm{};
    tm.tm_year = year - 1900;
    tm.tm_mon = month - 1;
    tm.tm_mday = day;
    tm.tm_hour = hour;
    tm.tm_min = minute;
    tm.tm_sec = second;
    time_t t = timegm(&tm);
    if (t == static_cast<time_t>(-1)) return false;

    const char* rem = text.c_str() + n;
    if (*rem == '.') {
        rem++;
        while (*rem >= '0' && *rem <= '9') rem++;
    }
    if (*rem == 'Z' || *rem == 'z') {
        // UTC
    } else if (*rem == '+' || *rem == '-') {
        char sign = *rem++;
        int off_h = 0, off_m = 0;
        if (std::sscanf(rem, "%2d:%2d", &off_h, &off_m) >= 1) {
            int off_sec = off_h * 3600 + off_m * 60;
            if (sign == '+') t -= off_sec;
            else t += off_sec;
        }
    }
    *out_s = static_cast<int64_t>(t);
    return true;
}

std::string iso_utc(int64_t epoch_s)
{
    const std::time_t seconds = static_cast<std::time_t>(epoch_s);
    std::tm tm{};
    gmtime_r(&seconds, &tm);
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return std::string(buf);
}

std::string format_value(double val)
{
    char buf[64];
    if (val == static_cast<int64_t>(val)) {
        std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(val));
    } else {
        std::snprintf(buf, sizeof(buf), "%.2f", val);
        char* p = buf + std::strlen(buf) - 1;
        while (p > buf && *p == '0') *p-- = '\0';
        if (p > buf && *p == '.') *p = '\0';
    }
    return std::string(buf);
}

std::string json_escape(const std::string& in)
{
    std::string out;
    for (char c : in) {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if (c == '\n') out += "\\n";
        else out += c;
    }
    return out;
}

const char* source_name(ValueSource src)
{
    switch (src) {
    case ValueSource::Weekly:    return "WEEKLY";
    case ValueSource::Exception: return "EXCEPTION";
    case ValueSource::Default:   return "DEFAULT";
    case ValueSource::None:      return "NONE";
    }
    return "NONE";
}

/* Cộng n ngày vào một ngày dân dụng. */
void add_days(int* year, int* month, int* day, int n)
{
    for (int i = 0; i < n; i++) {
        (*day)++;
        if (*day > days_in_month(*year, *month)) {
            *day = 1;
            (*month)++;
            if (*month > 12) { *month = 1; (*year)++; }
        }
    }
}

std::string iso_timestamp(int y, int mo, int d, int sec_of_day)
{
    char buf[40];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d",
                  y, mo, d, sec_of_day / 3600, (sec_of_day % 3600) / 60, sec_of_day % 60);
    return std::string(buf);
}

int run_point_simulation(const Args& args)
{
    int64_t from_s = 0, to_s = 0;
    if (!parse_rfc3339_epoch_s(args.from_str, &from_s)) {
        std::fprintf(stderr, "ERROR --from phải là mốc RFC3339: %s\n", args.from_str.c_str());
        return 1;
    }
    if (!parse_rfc3339_epoch_s(args.to_str, &to_s)) {
        std::fprintf(stderr, "ERROR --to phải là mốc RFC3339: %s\n", args.to_str.c_str());
        return 1;
    }
    if (to_s <= from_s) {
        std::fprintf(stderr, "ERROR --to phải sau --from\n");
        return 1;
    }

    std::vector<ScheduleObject> schedules;
    std::vector<HolidayGroup> groups;
    if (!load_schedule_config(args.config, true, &schedules, &groups)) {
        std::fprintf(stderr, "ERROR không nạp được %s\n", args.config.c_str());
        return 2;
    }

    ScheduleRuntime runtime;
    runtime.set_holiday_groups(groups);
    runtime.configure(schedules);

    struct TargetRef {
        std::size_t schedule_idx;
        std::size_t target_idx;
    };
    std::vector<TargetRef> relevant;
    for (std::size_t si = 0; si < schedules.size(); si++) {
        for (std::size_t ti = 0; ti < schedules[si].targets.size(); ti++) {
            const auto& tgt = schedules[si].targets[ti];
            if (tgt.point_id == args.point_id || tgt.id == args.point_id) {
                relevant.push_back({si, ti});
                break;
            }
        }
    }

    if (relevant.empty()) {
        std::printf("{\"segments\":[],\"conflicts\":[]}\n");
        return 0;
    }

    int step = (args.step_sec >= 1 && args.step_sec <= 3600) ? args.step_sec : 60;

    struct Segment {
        int64_t from_s = 0;
        int64_t to_s = 0;
        bool has_winner = false;
        double value = 0.0;
        std::string schedule_id;
        std::string schedule_name;
        int priority = 0;
        std::string reason;
    };

    struct Conflict {
        std::string at;
        std::vector<std::string> schedule_ids;
        std::string winner_id;
        std::string detail;
    };

    std::vector<Segment> segments;
    std::vector<Conflict> conflicts;
    bool any_winner_ever = false;

    bool prev_had_conflict = false;
    std::vector<std::string> prev_competing;
    std::string prev_winner;

    std::map<std::string, CivilTime> tz_cache;

    for (int64_t t = from_s; t < to_s; t += step) {
        tz_cache.clear();

        struct Candidate {
            std::size_t schedule_idx;
            int priority;
            double written_value;
            ValueSource source;
            std::string exception_id;
        };
        std::vector<Candidate> candidates;

        for (const auto& ref : relevant) {
            const ScheduleObject& s = schedules[ref.schedule_idx];
            if (!s.enabled) continue;

            auto it = tz_cache.find(s.timezone);
            if (it == tz_cache.end()) {
                CivilTime ct;
                if (!civil_time_in_zone(s.timezone, t, &ct)) {
                    continue;
                }
                it = tz_cache.emplace(s.timezone, ct).first;
            }

            ScheduleState st = runtime.evaluate_schedule(s, it->second);
            if (!st.active) continue;

            const ScheduleTarget& tgt = s.targets[ref.target_idx];
            for (const TargetResult& tr : st.targets) {
                if (tr.target_id == tgt.id) {
                    if (tr.should_claim) {
                        candidates.push_back({ref.schedule_idx, s.priority_for_writing,
                                             tr.written_value, st.source, st.source_exception_id});
                    }
                    break;
                }
            }
        }

        bool has_winner = false;
        std::string winner_id;
        std::string winner_name;
        int priority = 0;
        double value = 0.0;
        std::string reason;
        std::vector<std::string> competing_ids;
        std::string conflict_detail;

        if (candidates.empty()) {
            has_winner = false;
            winner_id = "";
            winner_name = "";
            priority = 0;
            value = 0.0;
            reason = "không lịch nào ghi";
        } else if (candidates.size() == 1) {
            const auto& c = candidates[0];
            const ScheduleObject& s = schedules[c.schedule_idx];
            has_winner = true;
            winner_id = s.id;
            winner_name = s.name;
            priority = c.priority;
            value = c.written_value;
            std::string src = (c.source == ValueSource::Exception ? "exception" :
                              (c.source == ValueSource::Weekly ? "weekly" : "default"));
            reason = src + " · " + s.id;
        } else {
            // Multiple candidates => conflict
            std::size_t best_i = 0;
            for (std::size_t i = 1; i < candidates.size(); i++) {
                if (candidates[i].priority < candidates[best_i].priority ||
                    (candidates[i].priority == candidates[best_i].priority &&
                     candidates[i].schedule_idx > candidates[best_i].schedule_idx)) {
                    best_i = i;
                }
            }
            const auto& best = candidates[best_i];
            const ScheduleObject& s = schedules[best.schedule_idx];
            has_winner = true;
            winner_id = s.id;
            winner_name = s.name;
            priority = best.priority;
            value = best.written_value;

            std::string src = (best.source == ValueSource::Exception ? "exception" :
                              (best.source == ValueSource::Weekly ? "weekly" : "default"));

            std::string losers;
            for (std::size_t i = 0; i < candidates.size(); i++) {
                const std::string& cid = schedules[candidates[i].schedule_idx].id;
                competing_ids.push_back(cid);
                if (i != best_i) {
                    if (!losers.empty()) losers += ", ";
                    losers += cid;
                    if (conflict_detail.empty()) {
                        if (best.priority < candidates[i].priority) {
                            conflict_detail = "priority " + std::to_string(best.priority) + " < " +
                                              std::to_string(candidates[i].priority) + " — số nhỏ thắng";
                        } else {
                            conflict_detail = "cùng priority " + std::to_string(best.priority) + " — lịch sau thắng";
                        }
                    }
                }
            }
            reason = src + " · " + s.id + " thắng " + losers;
        }

        if (competing_ids.size() > 1) {
            bool same_conflict = prev_had_conflict &&
                                 prev_competing == competing_ids &&
                                 prev_winner == winner_id;
            if (!same_conflict) {
                conflicts.push_back({iso_utc(t), competing_ids, winner_id, conflict_detail});
                prev_had_conflict = true;
                prev_competing = competing_ids;
                prev_winner = winner_id;
            }
        } else {
            prev_had_conflict = false;
            prev_competing.clear();
            prev_winner.clear();
        }

        if (has_winner) any_winner_ever = true;

        int64_t step_end = std::min(t + step, to_s);
        bool matches = false;
        if (!segments.empty()) {
            Segment& last = segments.back();
            if (last.has_winner == has_winner) {
                if (!has_winner) {
                    matches = true;
                } else if (last.schedule_id == winner_id &&
                           last.value == value &&
                           last.priority == priority) {
                    matches = true;
                }
            }
            if (matches) {
                last.to_s = step_end;
            }
        }
        if (!matches) {
            Segment seg;
            seg.from_s = t;
            seg.to_s = step_end;
            seg.has_winner = has_winner;
            seg.value = value;
            seg.schedule_id = winner_id;
            seg.schedule_name = winner_name;
            seg.priority = priority;
            seg.reason = reason;
            segments.push_back(seg);
        }
    }

    if (!segments.empty()) {
        segments.back().to_s = to_s;
    }
    if (!any_winner_ever) {
        segments.clear();
    }

    std::string seg_json;
    for (std::size_t i = 0; i < segments.size(); i++) {
        const auto& s = segments[i];
        if (i > 0) seg_json += ',';
        seg_json += "{\"from\":\"" + iso_utc(s.from_s) + "\",\"to\":\"" + iso_utc(s.to_s) + "\"";
        if (s.has_winner) {
            seg_json += ",\"value\":" + format_value(s.value);
            seg_json += ",\"scheduleId\":\"" + json_escape(s.schedule_id) + "\"";
            seg_json += ",\"scheduleName\":\"" + json_escape(s.schedule_name) + "\"";
            seg_json += ",\"priority\":" + std::to_string(s.priority);
        } else {
            seg_json += ",\"value\":null";
            seg_json += ",\"scheduleId\":\"\"";
            seg_json += ",\"scheduleName\":\"\"";
            seg_json += ",\"priority\":0";
        }
        seg_json += ",\"reason\":\"" + json_escape(s.reason) + "\"}";
    }

    std::string conf_json;
    for (std::size_t i = 0; i < conflicts.size(); i++) {
        const auto& c = conflicts[i];
        if (i > 0) conf_json += ',';
        conf_json += "{\"at\":\"" + c.at + "\",\"scheduleIds\":[";
        for (std::size_t j = 0; j < c.schedule_ids.size(); j++) {
            if (j > 0) conf_json += ',';
            conf_json += "\"" + json_escape(c.schedule_ids[j]) + "\"";
        }
        conf_json += "],\"winnerId\":\"" + json_escape(c.winner_id) + "\"";
        if (!c.detail.empty()) {
            conf_json += ",\"detail\":\"" + json_escape(c.detail) + "\"";
        }
        conf_json += "}";
    }

    std::printf("{\"segments\":[%s],\"conflicts\":[%s]}\n", seg_json.c_str(), conf_json.c_str());
    return 0;
}

int run_schedule_simulation(const Args& args)
{
    std::vector<ScheduleObject> schedules;
    std::vector<HolidayGroup> groups;
    if (!load_schedule_config(args.config, true, &schedules, &groups)) {
        std::fprintf(stderr, "ERROR không nạp được %s\n", args.config.c_str());
        return 2;
    }

    const ScheduleObject* target = nullptr;
    for (const ScheduleObject& s : schedules) {
        if (s.id == args.schedule_id) { target = &s; break; }
    }
    if (!target) {
        std::fprintf(stderr, "ERROR không có lịch %s trong %s\n",
                     args.schedule_id.c_str(), args.config.c_str());
        return 3;
    }

    ScheduleRuntime runtime;
    runtime.set_holiday_groups(groups);
    /* configure() chỉ để runtime giữ groups_; đánh giá dùng evaluate_schedule
     * trực tiếp nên không ghi ra target nào. */
    runtime.configure({*target});

    std::string transitions;
    std::string gaps;
    std::string conflicts;
    bool have_previous = false;
    double previous_value = 0.0;
    ValueSource previous_source = ValueSource::None;
    bool gap_open = false;
    std::string gap_from;
    bool conflict_reported = false;

    int y = args.year, mo = args.month, d = args.day;
    for (int day_index = 0; day_index < args.days; day_index++) {
        for (int sec = 0; sec < 24 * 3600; sec += args.step_sec) {
            CivilTime now;
            now.year = y;
            now.month = mo;
            now.day = d;
            now.weekday = day_of_week_iso(y, mo, d) - 1;
            now.second_of_day = sec;

            const ScheduleState st = runtime.evaluate_schedule(*target, now);
            const std::string stamp = iso_timestamp(y, mo, d, sec);

            /* Khoảng KHÔNG CÓ GIÁ TRỊ: ngoài effective period hoặc lịch tắt.
             * Đây là thứ người dùng cần thấy bằng màu đỏ trước khi publish. */
            if (!st.active) {
                if (!gap_open) { gap_open = true; gap_from = stamp; }
                have_previous = false;
                continue;
            }
            if (gap_open) {
                if (!gaps.empty()) gaps += ',';
                gaps += "{\"from\":\"" + gap_from + "\",\"to\":\"" + stamp + "\"}";
                gap_open = false;
            }

            if (st.error == ScheduleError::ConfigExceptionConflict && !conflict_reported) {
                conflict_reported = true;
                conflicts += std::string(conflicts.empty() ? "" : ",") +
                    "{\"code\":\"SCH-CONFIG-003\",\"path\":\"$.exception_schedule\","
                    "\"severity\":\"error\",\"message\":\"hai ngoại lệ cùng hiệu lực và cùng "
                    "event_priority vào " + stamp + "; hệ thống không tự chọn\"}";
            }

            const bool changed = !have_previous || st.effective_value != previous_value ||
                                 st.source != previous_source;
            if (!changed) continue;

            std::string target_ids;
            for (std::size_t t = 0; t < target->targets.size(); t++) {
                if (t) target_ids += ',';
                target_ids += "\"" + json_escape(target->targets[t].id) + "\"";
            }
            if (!transitions.empty()) transitions += ',';
            transitions += "{\"at\":\"" + stamp + "\"";
            transitions += ",\"source\":\"" + std::string(source_name(st.source)) + "\"";
            transitions += ",\"source_exception_id\":";
            transitions += st.source_exception_id.empty()
                               ? "null"
                               : "\"" + json_escape(st.source_exception_id) + "\"";
            transitions += ",\"value\":" + std::to_string(st.effective_value);
            transitions += ",\"target_ids\":[" + target_ids + "]";
            transitions += ",\"priority_for_writing\":" + std::to_string(target->priority_for_writing);
            transitions += "}";

            have_previous = true;
            previous_value = st.effective_value;
            previous_source = st.source;
        }
        add_days(&y, &mo, &d, 1);
    }
    if (gap_open) {
        if (!gaps.empty()) gaps += ',';
        gaps += "{\"from\":\"" + gap_from + "\",\"to\":\"" + iso_timestamp(y, mo, d, 0) + "\"}";
    }

    std::printf("{\"transitions\":[%s],\"gaps\":[%s],\"conflicts\":[%s]}\n",
                transitions.c_str(), gaps.c_str(), conflicts.c_str());
    return 0;
}

} // namespace

int main(int argc, char** argv)
{
    Args args;
    for (int i = 1; i < argc; i++) {
        const char* a = argv[i];
        if (!std::strcmp(a, "--provenance")) {
            /* T63-002: xem programming_sim_worker_main.cpp — dòng này giữ
             * MKDDC_GIT_COMMIT trong binary để manifest ghi được commit. */
            std::printf("version=%s git_commit=%s build_time=%s toolchain=%s\n",
                        MKDDC_BUILD_VERSION, MKDDC_GIT_COMMIT, MKDDC_BUILD_TIME, MKDDC_TOOLCHAIN);
            return 0;
        }
        if (!std::strcmp(a, "--config") && i + 1 < argc) args.config = argv[++i];
        else if (!std::strcmp(a, "--schedule") && i + 1 < argc) args.schedule_id = argv[++i];
        else if (!std::strcmp(a, "--point") && i + 1 < argc) args.point_id = argv[++i];
        else if (!std::strcmp(a, "--from") && i + 1 < argc) args.from_str = argv[++i];
        else if (!std::strcmp(a, "--to") && i + 1 < argc) args.to_str = argv[++i];
        else if (!std::strcmp(a, "--start") && i + 1 < argc) {
            if (!parse_date_arg(argv[++i], &args.year, &args.month, &args.day)) {
                std::fprintf(stderr, "ERROR --start phải là YYYY-MM-DD\n");
                return 1;
            }
        }
        else if (!std::strcmp(a, "--days") && i + 1 < argc) args.days = std::atoi(argv[++i]);
        else if (!std::strcmp(a, "--step-sec") && i + 1 < argc) args.step_sec = std::atoi(argv[++i]);
        else {
            std::fprintf(stderr, "ERROR tham số lạ: %s\n", a);
            return 1;
        }
    }

    if (!args.point_id.empty()) {
        if (args.config.empty() || args.from_str.empty() || args.to_str.empty()) {
            std::fprintf(stderr,
                         "Dùng: mkddc-schedule-sim --config FILE --point POINT_ID "
                         "--from RFC3339 --to RFC3339 [--step-sec N]\n");
            return 1;
        }
        if (args.step_sec < 1 || args.step_sec > 3600) args.step_sec = 60;
        return run_point_simulation(args);
    }

    if (args.config.empty() || args.schedule_id.empty() || args.year == 0) {
        std::fprintf(stderr,
                     "Dùng: mkddc-schedule-sim --config FILE --schedule SCH-001 "
                     "--start YYYY-MM-DD [--days N] [--step-sec N]\n");
        return 1;
    }
    if (args.days < 1 || args.days > 366) args.days = 7;
    if (args.step_sec < 1 || args.step_sec > 3600) args.step_sec = 60;

    return run_schedule_simulation(args);
}
