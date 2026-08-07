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
 *
 * Ra stdout một JSON:
 *   { "transitions":[…], "gaps":[…], "conflicts":[…] }
 *
 * Mã thoát: 0 thành công, 1 tham số sai, 2 không nạp được cấu hình,
 *           3 không tìm thấy schedule_id.
 */
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "schedule/schedule_runtime.hpp"

using namespace core;

namespace {

struct Args {
    std::string config;
    std::string schedule_id;
    int year = 0, month = 0, day = 0;
    int days = 7;
    int step_sec = 60;
};

bool parse_date_arg(const char* s, int* y, int* m, int* d)
{
    return s && std::sscanf(s, "%d-%d-%d", y, m, d) == 3 &&
           *m >= 1 && *m <= 12 && *d >= 1 && *d <= 31;
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

/* Cộng `n` ngày vào một ngày dân dụng. */
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

} // namespace

int main(int argc, char** argv)
{
    Args args;
    for (int i = 1; i < argc; i++) {
        const char* a = argv[i];
        if (!std::strcmp(a, "--config") && i + 1 < argc) args.config = argv[++i];
        else if (!std::strcmp(a, "--schedule") && i + 1 < argc) args.schedule_id = argv[++i];
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
    if (args.config.empty() || args.schedule_id.empty() || args.year == 0) {
        std::fprintf(stderr,
                     "Dùng: mkddc-schedule-sim --config FILE --schedule SCH-001 "
                     "--start YYYY-MM-DD [--days N] [--step-sec N]\n");
        return 1;
    }
    if (args.days < 1 || args.days > 366) args.days = 7;
    if (args.step_sec < 1 || args.step_sec > 3600) args.step_sec = 60;

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
