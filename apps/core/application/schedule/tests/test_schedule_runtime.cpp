/**
 * Test Scheduler Engine v3.1 (SCHD-110).
 *
 * Đây là bộ test của một lớp đưa lệnh ra quạt, van và bơm, nên nó kiểm cả hai
 * chiều: cấu hình đúng phải chạy đúng, và cấu hình sai phải bị TỪ CHỐI chứ
 * không được đoán ý người dùng.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

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

/* ── Dựng JSON v3.1 ────────────────────────────────────────────────────── */

std::string schedule_json(const std::string& id,
                          const std::string& weekly,
                          const std::string& exceptions = "[]",
                          const std::string& targets =
                              R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])",
                          const std::string& value_type = "BINARY",
                          const std::string& def = R"({"value":"INACTIVE"})",
                          int priority = 16,
                          const std::string& effective = R"({"start_date":null,"end_date":null})",
                          bool enabled = true)
{
    return std::string("{") +
        R"("schema_version":"3.1",)" +
        R"("schedule_id":")" + id + R"(",)" +
        R"("schedule_name":")" + id + R"( name",)" +
        R"("enabled":)" + (enabled ? "true" : "false") + "," +
        R"("status":"PUBLISHED",)" +
        R"("timezone":"Asia/Ho_Chi_Minh",)" +
        R"("effective_period":)" + effective + "," +
        R"("value_type":")" + value_type + R"(",)" +
        R"("priority_for_writing":)" + std::to_string(priority) + "," +
        R"("schedule_default":)" + def + "," +
        R"("weekly_schedule":)" + weekly + "," +
        R"("exception_schedule":)" + exceptions + "," +
        R"("target_objects":)" + targets + "," +
        R"("revision":1)" +
        "}";
}

/* Lịch tuần chỉ có T2 bật 08:00, tắt 18:00; các ngày khác rỗng. */
std::string weekly_mon_only()
{
    return R"({"MON":[{"time":"08:00:00","value":"ACTIVE"},{"time":"18:00:00","value":"INACTIVE"}],)"
           R"("TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
}

std::string weekly_empty()
{
    return R"({"MON":[],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
}

/* Bọc một hoặc nhiều Schedule Object thành mảng cấu hình. */
std::string config(const std::vector<std::string>& items)
{
    std::string s = "[";
    for (std::size_t i = 0; i < items.size(); i++) {
        if (i) s += ",";
        s += items[i];
    }
    return s + "]";
}

CivilTime at(int year, int month, int day, int hour, int minute = 0, int second = 0)
{
    CivilTime t;
    t.year = year;
    t.month = month;
    t.day = day;
    t.weekday = day_of_week_iso(year, month, day) - 1;   /* 1..7 → 0..6 */
    t.second_of_day = hour * 3600 + minute * 60 + second;
    return t;
}

struct Fixture {
    IoSnapshot io{};
    PointTable table;
    PriorityResolver resolver;
    ScheduleRuntime runtime;

    bool load(const std::string& json)
    {
        TempFile f(json);
        return runtime.load(f.path(), true);
    }
};

bool do_on(PriorityResolver& r, int ch)
{
    return r.resolve().do_valid[ch] && r.resolve().dout[ch] != 0;
}

} // namespace

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Lịch tuần nhiều mốc trong một ngày (đặc tả §6.2)
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31Weekly, MultipleTransitionsInOneDay)
{
    /* 2026-08-10 là Thứ Hai. Nghỉ trưa 12:00-13:00. */
    const std::string weekly =
        R"({"MON":[{"time":"07:30:00","value":"ACTIVE"},{"time":"12:00:00","value":"INACTIVE"},)"
        R"({"time":"13:00:00","value":"ACTIVE"},{"time":"18:00:00","value":"INACTIVE"}],)"
        R"("TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly)})));

    struct Case { int hour; int minute; bool on; const char* why; };
    const Case cases[] = {
        {7, 0, false, "trước mốc đầu tiên"},
        {7, 30, true, "đúng mốc bật"},
        {11, 59, true, "trong ca sáng"},
        {12, 0, false, "đúng mốc nghỉ trưa"},
        {12, 30, false, "trong giờ nghỉ trưa"},
        {13, 0, true, "đúng mốc vào ca chiều"},
        {17, 59, true, "trong ca chiều"},
        {18, 0, false, "đúng mốc tan ca"},
        {23, 59, false, "sau tan ca"},
    };
    for (const Case& c : cases) {
        f.runtime.evaluate_at(at(2026, 8, 10, c.hour, c.minute), f.io, f.table, f.resolver);
        EXPECT_EQ(do_on(f.resolver, 0), c.on) << c.why << " lúc " << c.hour << ":" << c.minute;
    }
}

TEST(ScheduleV31Weekly, CarriesLastEventAcrossMidnight)
{
    /* Bật T2 08:00 và KHÔNG tắt. Sang T3 vẫn phải còn bật — mốc gần nhất trước
     * bây giờ nằm ở ngày hôm trước, không phải rơi về default. */
    const std::string weekly =
        R"({"MON":[{"time":"08:00:00","value":"ACTIVE"}],)"
        R"("TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly)})));

    f.runtime.evaluate_at(at(2026, 8, 11, 3, 0), f.io, f.table, f.resolver);   /* Thứ Ba 03:00 */
    EXPECT_TRUE(do_on(f.resolver, 0));
    EXPECT_EQ(f.runtime.state_of("SCH-001")->source, ValueSource::Weekly);
}

TEST(ScheduleV31Weekly, FallsBackToDefaultWhenNoEventEverFired)
{
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json(
        "SCH-001", weekly_empty(), "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])",
        "BINARY", R"({"value":"ACTIVE"})")})));

    f.runtime.evaluate_at(at(2026, 8, 10, 9, 0), f.io, f.table, f.resolver);
    const ScheduleState* st = f.runtime.state_of("SCH-001");
    ASSERT_NE(st, nullptr);
    EXPECT_EQ(st->source, ValueSource::Default);
    EXPECT_TRUE(do_on(f.resolver, 0)) << "default ACTIVE phải được ghi ra target";
}

TEST(ScheduleV31Weekly, SortsUnorderedTimeValues)
{
    const std::string weekly =
        R"({"MON":[{"time":"18:00:00","value":"INACTIVE"},{"time":"08:00:00","value":"ACTIVE"}],)"
        R"("TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly)})));
    f.runtime.evaluate_at(at(2026, 8, 10, 10, 0), f.io, f.table, f.resolver);
    EXPECT_TRUE(do_on(f.resolver, 0));
}

TEST(ScheduleV31Weekly, ComputesNextTransition)
{
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_mon_only())})));
    f.runtime.evaluate_at(at(2026, 8, 10, 10, 0), f.io, f.table, f.resolver);
    const ScheduleState* st = f.runtime.state_of("SCH-001");
    ASSERT_NE(st, nullptr);
    /* Thứ Hai là ngày 0 của tuần; 18:00 = 64800 giây. */
    EXPECT_EQ(st->next_transition_week_second, 18 * 3600);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Ngoại lệ — 5 kiểu date_rule (đặc tả §7.1)
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31Exception, DateRuleOverridesWeekly)
{
    /* 2026-09-02 là Thứ Tư. Weekly bật cả T4; exception tắt cả ngày. */
    const std::string weekly =
        R"({"MON":[],"TUE":[],"WED":[{"time":"00:00:00","value":"ACTIVE"}],)"
        R"("THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    const std::string exceptions =
        R"([{"exception_id":"EXC-001","name":"Quoc khanh",)"
        R"("date_rule":{"type":"DATE","date":"2026-09-02"},"event_priority":1,)"
        R"("time_values":[{"time":"00:00:00","value":"INACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly, exceptions)})));

    f.runtime.evaluate_at(at(2026, 9, 2, 10, 0), f.io, f.table, f.resolver);
    EXPECT_FALSE(do_on(f.resolver, 0)) << "ngoại lệ phải ghi đè lịch tuần";
    const ScheduleState* st = f.runtime.state_of("SCH-001");
    EXPECT_EQ(st->source, ValueSource::Exception);
    EXPECT_EQ(st->source_exception_id, "EXC-001");

    /* Hôm sau không còn ngoại lệ — nhưng weekly THU rỗng nên giá trị hiệu lực
     * là mốc cuối cùng còn lại của T4, tức vẫn ACTIVE. */
    f.runtime.evaluate_at(at(2026, 9, 3, 10, 0), f.io, f.table, f.resolver);
    EXPECT_EQ(f.runtime.state_of("SCH-001")->source, ValueSource::Weekly);
}

TEST(ScheduleV31Exception, DateRangeRule)
{
    const std::string exceptions =
        R"([{"exception_id":"EXC-TET","name":"Tet",)"
        R"("date_rule":{"type":"DATE_RANGE","start_date":"2026-02-14","end_date":"2026-02-20"},)"
        R"("event_priority":1,"time_values":[{"time":"00:00:00","value":"ACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_empty(), exceptions)})));

    struct Case { int month; int day; bool inside; };
    const Case cases[] = {
        {2, 13, false}, {2, 14, true}, {2, 17, true}, {2, 20, true}, {2, 21, false},
    };
    for (const Case& c : cases) {
        f.runtime.evaluate_at(at(2026, c.month, c.day, 12, 0), f.io, f.table, f.resolver);
        EXPECT_EQ(f.runtime.state_of("SCH-001")->source == ValueSource::Exception, c.inside)
            << "ngày " << c.day << "/" << c.month;
    }
}

TEST(ScheduleV31Exception, WeekNDayFirstMondayOfMonth)
{
    const std::string exceptions =
        R"([{"exception_id":"EXC-MAINT","name":"Bao tri",)"
        R"("date_rule":{"type":"WEEK_N_DAY","month":0,"week_of_month":1,"day_of_week":1},)"
        R"("event_priority":1,"time_values":[{"time":"00:00:00","value":"ACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_empty(), exceptions)})));

    /* Tháng 9/2026: Thứ Hai đầu tiên là ngày 07. */
    struct Case { int month; int day; bool match; const char* why; };
    const Case cases[] = {
        {9, 7, true, "T2 đầu tiên của tháng 9"},
        {9, 14, false, "T2 thứ hai của tháng"},
        {9, 6, false, "Chủ nhật"},
        {10, 5, true, "T2 đầu tiên của tháng 10"},
        {11, 2, true, "T2 đầu tiên của tháng 11"},
    };
    for (const Case& c : cases) {
        f.runtime.evaluate_at(at(2026, c.month, c.day, 12, 0), f.io, f.table, f.resolver);
        EXPECT_EQ(f.runtime.state_of("SCH-001")->source == ValueSource::Exception, c.match) << c.why;
    }
}

TEST(ScheduleV31Exception, WeekNDayLastWeekUsesBacnetConvention)
{
    /* week_of_month = 6 nghĩa là tuần CUỐI, không phải tuần thứ sáu. */
    const std::string exceptions =
        R"([{"exception_id":"EXC-LAST","name":"Cuoi thang",)"
        R"("date_rule":{"type":"WEEK_N_DAY","month":0,"week_of_month":6,"day_of_week":5},)"
        R"("event_priority":1,"time_values":[{"time":"00:00:00","value":"ACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_empty(), exceptions)})));

    /* Tháng 8/2026 có 31 ngày; các Thứ Sáu: 7, 14, 21, 28 → cuối cùng là 28. */
    f.runtime.evaluate_at(at(2026, 8, 28, 12, 0), f.io, f.table, f.resolver);
    EXPECT_EQ(f.runtime.state_of("SCH-001")->source, ValueSource::Exception);
    f.runtime.evaluate_at(at(2026, 8, 21, 12, 0), f.io, f.table, f.resolver);
    EXPECT_NE(f.runtime.state_of("SCH-001")->source, ValueSource::Exception);
}

TEST(ScheduleV31Exception, HolidayGroupNeedsLoadedGroup)
{
    const std::string exceptions =
        R"([{"exception_id":"EXC-HG","name":"Le cong ty",)"
        R"("date_rule":{"type":"HOLIDAY_GROUP","group_id":"HG-CTY"},)"
        R"("event_priority":1,"time_values":[{"time":"00:00:00","value":"ACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_empty(), exceptions)})));

    /* Chưa nạp nhóm ⇒ KHÔNG khớp. Đoán bừa ở đây là ra lệnh nhầm cho thiết bị. */
    f.runtime.evaluate_at(at(2026, 12, 24, 12, 0), f.io, f.table, f.resolver);
    EXPECT_NE(f.runtime.state_of("SCH-001")->source, ValueSource::Exception);

    HolidayGroup g;
    g.id = "HG-CTY";
    g.dates.push_back(CivilDate{2026, 12, 24});
    f.runtime.set_holiday_groups({g});
    f.runtime.evaluate_at(at(2026, 12, 24, 12, 0), f.io, f.table, f.resolver);
    EXPECT_EQ(f.runtime.state_of("SCH-001")->source, ValueSource::Exception);
}

TEST(ScheduleV31Exception, HigherEventPriorityWins)
{
    const std::string exceptions =
        R"([{"exception_id":"EXC-LOW","name":"Thap",)"
        R"("date_rule":{"type":"DATE","date":"2026-09-02"},"event_priority":9,)"
        R"("time_values":[{"time":"00:00:00","value":"ACTIVE"}]},)"
        R"({"exception_id":"EXC-HIGH","name":"Cao",)"
        R"("date_rule":{"type":"DATE","date":"2026-09-02"},"event_priority":1,)"
        R"("time_values":[{"time":"00:00:00","value":"INACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_empty(), exceptions)})));

    f.runtime.evaluate_at(at(2026, 9, 2, 12, 0), f.io, f.table, f.resolver);
    const ScheduleState* st = f.runtime.state_of("SCH-001");
    EXPECT_EQ(st->source_exception_id, "EXC-HIGH");
    EXPECT_FALSE(do_on(f.resolver, 0));
    EXPECT_EQ(st->error, ScheduleError::None) << "khác priority thì không phải xung đột";
}

TEST(ScheduleV31Exception, EqualEventPriorityReportsConflict)
{
    /* Đặc tả §7.3 mục 3: bằng priority thì BÁO XUNG ĐỘT, không tự chọn theo
     * thời gian tạo. Im lặng chọn hộ là cách để một lỗi cấu hình sống sót qua
     * commissioning rồi nổ ngoài hiện trường. */
    const std::string exceptions =
        R"([{"exception_id":"EXC-A","name":"A",)"
        R"("date_rule":{"type":"DATE","date":"2026-09-02"},"event_priority":5,)"
        R"("time_values":[{"time":"00:00:00","value":"ACTIVE"}]},)"
        R"({"exception_id":"EXC-B","name":"B",)"
        R"("date_rule":{"type":"DATE","date":"2026-09-02"},"event_priority":5,)"
        R"("time_values":[{"time":"00:00:00","value":"INACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_empty(), exceptions)})));

    f.runtime.evaluate_at(at(2026, 9, 2, 12, 0), f.io, f.table, f.resolver);
    EXPECT_EQ(f.runtime.state_of("SCH-001")->error, ScheduleError::ConfigExceptionConflict);
    EXPECT_STREQ(schedule_error_code(ScheduleError::ConfigExceptionConflict), "SCH-CONFIG-003");
}

TEST(ScheduleV31Exception, ExceptionDoesNotAffectOtherSchedules)
{
    /* Hồi quy của mô hình cũ: holiday_period từng TẮT TOÀN BỘ mọi lịch. */
    const std::string weekly_always_on =
        R"({"MON":[{"time":"00:00:00","value":"ACTIVE"}],"TUE":[{"time":"00:00:00","value":"ACTIVE"}],)"
        R"("WED":[{"time":"00:00:00","value":"ACTIVE"}],"THU":[{"time":"00:00:00","value":"ACTIVE"}],)"
        R"("FRI":[{"time":"00:00:00","value":"ACTIVE"}],"SAT":[{"time":"00:00:00","value":"ACTIVE"}],)"
        R"("SUN":[{"time":"00:00:00","value":"ACTIVE"}]})";
    const std::string holiday =
        R"([{"exception_id":"EXC-001","name":"Le",)"
        R"("date_rule":{"type":"DATE","date":"2026-09-02"},"event_priority":1,)"
        R"("time_values":[{"time":"00:00:00","value":"INACTIVE"}]}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({
        schedule_json("SCH-001", weekly_always_on, holiday),
        schedule_json("SCH-002", weekly_always_on, "[]",
                      R"([{"target_id":"TGT-002","target_type":"INTERNAL_POINT","point_kind":"DO","channel":2}])")
    })));

    f.runtime.evaluate_at(at(2026, 9, 2, 12, 0), f.io, f.table, f.resolver);
    EXPECT_FALSE(do_on(f.resolver, 0)) << "SCH-001 bị ngoại lệ của chính nó tắt";
    EXPECT_TRUE(do_on(f.resolver, 1)) << "SCH-002 KHÔNG được ảnh hưởng bởi ngoại lệ của lịch khác";
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Khoảng hiệu lực (đặc tả §5)
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31EffectivePeriod, OutsideRangeIsInactive)
{
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json(
        "SCH-001", weekly_mon_only(), "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])",
        "BINARY", R"({"value":"INACTIVE"})", 16,
        R"({"start_date":"2026-06-01","end_date":"2026-07-31"})")})));

    f.runtime.evaluate_at(at(2026, 8, 10, 10, 0), f.io, f.table, f.resolver);   /* sau end */
    EXPECT_FALSE(f.runtime.state_of("SCH-001")->active);
    EXPECT_FALSE(f.resolver.resolve().do_valid[0]) << "ngoài khoảng hiệu lực thì không giữ lệnh";

    f.runtime.evaluate_at(at(2026, 6, 1, 10, 0), f.io, f.table, f.resolver);    /* đúng biên start */
    EXPECT_TRUE(f.runtime.state_of("SCH-001")->active);
}

TEST(ScheduleV31EffectivePeriod, NullEndMeansForever)
{
    EffectivePeriod p;
    p.start = CivilDate{2026, 1, 1};
    EXPECT_TRUE(effective_period_contains(p, at(2099, 12, 31, 0)));
    EXPECT_FALSE(effective_period_contains(p, at(2025, 12, 31, 0)));
}

TEST(ScheduleV31EffectivePeriod, NullStartMeansFromBeginning)
{
    EffectivePeriod p;
    p.end = CivilDate{2026, 12, 31};
    EXPECT_TRUE(effective_period_contains(p, at(1999, 1, 1, 0)));
    EXPECT_FALSE(effective_period_contains(p, at(2027, 1, 1, 0)));
}

TEST(ScheduleV31EffectivePeriod, DisabledScheduleReleasesTarget)
{
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_mon_only())})));
    f.runtime.evaluate_at(at(2026, 8, 10, 10, 0), f.io, f.table, f.resolver);
    ASSERT_TRUE(do_on(f.resolver, 0));

    /* Nạp lại cùng lịch nhưng enabled=false — đặc tả §9.2 đòi relinquish, không
     * được giữ giá trị điều khiển cuối cùng. */
    ASSERT_TRUE(f.load(config({schedule_json(
        "SCH-001", weekly_mon_only(), "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])",
        "BINARY", R"({"value":"INACTIVE"})", 16, R"({"start_date":null,"end_date":null})", false)})));
    f.runtime.evaluate_at(at(2026, 8, 10, 10, 0), f.io, f.table, f.resolver);
    EXPECT_FALSE(f.resolver.resolve().do_valid[0]);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Phân xử priority_for_writing 1..16 (ADR-023 QĐ-1)
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31Priority, LowerNumberWinsSameTarget)
{
    const std::string weekly_on =
        R"({"MON":[{"time":"00:00:00","value":"ACTIVE"}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    const std::string weekly_off =
        R"({"MON":[{"time":"00:00:00","value":"INACTIVE"}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    const std::string same_target =
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])";

    Fixture f;
    ASSERT_TRUE(f.load(config({
        schedule_json("SCH-LOW", weekly_on, "[]", same_target, "BINARY", R"({"value":"INACTIVE"})", 16),
        schedule_json("SCH-HIGH", weekly_off, "[]", same_target, "BINARY", R"({"value":"INACTIVE"})", 2)
    })));

    f.runtime.evaluate_at(at(2026, 8, 10, 12, 0), f.io, f.table, f.resolver);
    EXPECT_FALSE(do_on(f.resolver, 0)) << "priority 2 phải thắng priority 16";

    /* Lịch thua phải THẤY ĐƯỢC là nó thua — không im lặng. */
    const ScheduleState* loser = f.runtime.state_of("SCH-LOW");
    ASSERT_NE(loser, nullptr);
    ASSERT_EQ(loser->targets.size(), 1u);
    EXPECT_FALSE(loser->targets[0].written);

    const ScheduleState* winner = f.runtime.state_of("SCH-HIGH");
    EXPECT_TRUE(winner->targets[0].written);
}

TEST(ScheduleV31Priority, DifferentTargetsDoNotCompete)
{
    const std::string weekly_on =
        R"({"MON":[{"time":"00:00:00","value":"ACTIVE"}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    Fixture f;
    ASSERT_TRUE(f.load(config({
        schedule_json("SCH-001", weekly_on, "[]",
                      R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])",
                      "BINARY", R"({"value":"INACTIVE"})", 16),
        schedule_json("SCH-002", weekly_on, "[]",
                      R"([{"target_id":"TGT-002","target_type":"INTERNAL_POINT","point_kind":"DO","channel":2}])",
                      "BINARY", R"({"value":"INACTIVE"})", 1)
    })));
    f.runtime.evaluate_at(at(2026, 8, 10, 12, 0), f.io, f.table, f.resolver);
    EXPECT_TRUE(do_on(f.resolver, 0));
    EXPECT_TRUE(do_on(f.resolver, 1));
}

TEST(ScheduleV31Priority, ScheduleAlwaysSitsAtCoreLevelFour)
{
    /* ADR-023 QĐ-1, hệ quả có chủ ý: lịch priority 1 vẫn THUA lệnh tay tại chỗ
     * (mức 2 của resolver). Một lịch tự động không nên đè được lệnh của kỹ
     * thuật viên đang đứng trước tủ điện. */
    const std::string weekly_on =
        R"({"MON":[{"time":"00:00:00","value":"ACTIVE"}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json(
        "SCH-001", weekly_on, "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])",
        "BINARY", R"({"value":"INACTIVE"})", 1)})));

    f.resolver.set_do(PRIO_LOCAL_MANUAL, 0, false);
    f.runtime.evaluate_at(at(2026, 8, 10, 12, 0), f.io, f.table, f.resolver);
    EXPECT_FALSE(do_on(f.resolver, 0)) << "lệnh tay mức 2 phải thắng mọi lịch";
    EXPECT_EQ(f.resolver.winning_do_level(0), PRIO_LOCAL_MANUAL);

    f.resolver.release_do(PRIO_LOCAL_MANUAL, 0);
    EXPECT_TRUE(do_on(f.resolver, 0)) << "nhả lệnh tay thì lệnh lịch lộ ra";
    EXPECT_EQ(f.resolver.winning_do_level(0), PRIO_SCHEDULE);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Target — nhiều target, kiểu dữ liệu, lỗi ghi (đặc tả §8)
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31Target, WritesEveryTargetInList)
{
    const std::string weekly_on =
        R"({"MON":[{"time":"00:00:00","value":"ACTIVE"}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    const std::string targets =
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1},)"
        R"({"target_id":"TGT-002","target_type":"INTERNAL_POINT","point_kind":"DO","channel":2},)"
        R"({"target_id":"TGT-003","target_type":"INTERNAL_POINT","point_kind":"BV","channel":3}])";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_on, "[]", targets)})));

    f.runtime.evaluate_at(at(2026, 8, 10, 12, 0), f.io, f.table, f.resolver);
    EXPECT_TRUE(do_on(f.resolver, 0));
    EXPECT_TRUE(do_on(f.resolver, 1));
    EXPECT_FLOAT_EQ(f.table.get({PointKind::BV, 2}).value, 1.0f);
    EXPECT_EQ(f.table.get({PointKind::BV, 2}).source, PointSource::SCHEDULE);

    const ScheduleState* st = f.runtime.state_of("SCH-001");
    ASSERT_EQ(st->targets.size(), 3u);
    for (const TargetResult& t : st->targets) {
        EXPECT_TRUE(t.written) << t.target_id;
        EXPECT_EQ(t.error, ScheduleError::None);
    }
}

TEST(ScheduleV31Target, AnalogPercentIsConvertedByAoMode)
{
    const std::string weekly_on =
        R"({"MON":[{"time":"00:00:00","value":50.0}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    Fixture f;
    f.io.ao_mode[0] = 0;   /* 0-10 V */
    ASSERT_TRUE(f.load(config({schedule_json(
        "SCH-001", weekly_on, "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"AO","channel":1}])",
        "REAL", R"({"value":0.0})")})));

    f.runtime.evaluate_at(at(2026, 8, 10, 12, 0), f.io, f.table, f.resolver);
    EXPECT_FLOAT_EQ(f.resolver.resolve().ao[0], 5.0f) << "50% của 0-10V là 5V";

    f.io.ao_mode[0] = 1;   /* 4-20 mA */
    f.runtime.evaluate_at(at(2026, 8, 10, 12, 0), f.io, f.table, f.resolver);
    EXPECT_FLOAT_EQ(f.resolver.resolve().ao[0], 12.0f) << "50% của 4-20mA là 12mA";
}

TEST(ScheduleV31Target, ReleasesTargetWhenNoLongerClaimed)
{
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_mon_only())})));
    f.runtime.evaluate_at(at(2026, 8, 10, 10, 0), f.io, f.table, f.resolver);
    ASSERT_TRUE(f.resolver.resolve().do_valid[0]);

    /* Đổi sang lịch không còn target nào ⇒ phải nhả. */
    ASSERT_TRUE(f.load(config({schedule_json("SCH-001", weekly_mon_only(), "[]", "[]")})));
    f.runtime.evaluate_at(at(2026, 8, 10, 10, 0), f.io, f.table, f.resolver);
    EXPECT_FALSE(f.resolver.resolve().do_valid[0]);
}

TEST(ScheduleV31Target, MultiStateValueWritesMsv)
{
    const std::string weekly =
        R"({"MON":[{"time":"00:00:00","value":2}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    Fixture f;
    ASSERT_TRUE(f.load(config({schedule_json(
        "SCH-001", weekly, "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"MSV","channel":1}])",
        "ENUMERATED", R"({"value":0})")})));
    f.runtime.evaluate_at(at(2026, 8, 10, 12, 0), f.io, f.table, f.resolver);
    EXPECT_FLOAT_EQ(f.table.get({PointKind::MSV, 0}).value, 2.0f);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Cấu hình sai PHẢI bị từ chối
 * ══════════════════════════════════════════════════════════════════════════ */

namespace {
void expect_rejected(const std::string& json, const char* why)
{
    TempFile f(json);
    std::vector<ScheduleObject> out;
    EXPECT_FALSE(load_schedule_config(f.path(), true, &out)) << why;
}
} // namespace

TEST(ScheduleV31Reject, MissingScheduleDefault)
{
    /* SCH-CONFIG-001 */
    std::string json = schedule_json("SCH-001", weekly_mon_only());
    const std::string needle = R"("schedule_default":{"value":"INACTIVE"},)";
    json.replace(json.find(needle), needle.size(), "");
    expect_rejected(config({json}), "thiếu schedule_default phải bị từ chối");
}

TEST(ScheduleV31Reject, WeeklyMissingADay)
{
    /* SCH-CONFIG-002 */
    const std::string weekly =
        R"({"MON":[],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[]})";   /* thiếu SUN */
    expect_rejected(config({schedule_json("SCH-001", weekly)}), "weekly thiếu ngày phải bị từ chối");
}

TEST(ScheduleV31Reject, DuplicateTimeInSameDay)
{
    /* SCH-CONFIG-002: hai event cùng thời điểm không phải thứ để đoán ý. */
    const std::string weekly =
        R"({"MON":[{"time":"08:00:00","value":"ACTIVE"},{"time":"08:00:00","value":"INACTIVE"}],)"
        R"("TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    expect_rejected(config({schedule_json("SCH-001", weekly)}), "trùng thời điểm phải bị từ chối");
}

TEST(ScheduleV31Reject, BadTimeFormat)
{
    const std::string weekly =
        R"({"MON":[{"time":"8:00","value":"ACTIVE"}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    expect_rejected(config({schedule_json("SCH-001", weekly)}), "giờ phải đúng HH:mm:ss");
}

TEST(ScheduleV31Reject, PriorityOutOfRange)
{
    expect_rejected(config({schedule_json(
        "SCH-001", weekly_mon_only(), "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])",
        "BINARY", R"({"value":"INACTIVE"})", 17)}), "priority 17 ngoài dải 1..16");
}

TEST(ScheduleV31Reject, TargetChannelOutOfRange)
{
    /* SCH-TARGET-001 */
    expect_rejected(config({schedule_json(
        "SCH-001", weekly_mon_only(), "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":99}])")}),
        "kênh DO 99 vượt phần cứng");
}

TEST(ScheduleV31Reject, TargetKindIncompatibleWithValueType)
{
    /* SCH-TARGET-003: BINARY không ghi được vào AO. */
    expect_rejected(config({schedule_json(
        "SCH-001", weekly_mon_only(), "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"AO","channel":1}])")}),
        "BINARY ghi vào AO phải bị từ chối");
}

TEST(ScheduleV31Reject, DuplicateTargetInSameSchedule)
{
    expect_rejected(config({schedule_json(
        "SCH-001", weekly_mon_only(), "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1},)"
        R"({"target_id":"TGT-002","target_type":"INTERNAL_POINT","point_kind":"DO","channel":1}])")}),
        "cùng một điểm hai lần trong một lịch");
}

TEST(ScheduleV31Reject, DuplicateScheduleId)
{
    expect_rejected(config({schedule_json("SCH-001", weekly_mon_only()),
                            schedule_json("SCH-001", weekly_mon_only())}),
                    "trùng schedule_id");
}

TEST(ScheduleV31Reject, DuplicateExceptionId)
{
    const std::string exceptions =
        R"([{"exception_id":"EXC-A","name":"A","date_rule":{"type":"DATE","date":"2026-09-02"},)"
        R"("event_priority":1,"time_values":[{"time":"00:00:00","value":"ACTIVE"}]},)"
        R"({"exception_id":"EXC-A","name":"B","date_rule":{"type":"DATE","date":"2026-09-03"},)"
        R"("event_priority":2,"time_values":[{"time":"00:00:00","value":"ACTIVE"}]}])";
    expect_rejected(config({schedule_json("SCH-001", weekly_empty(), exceptions)}),
                    "trùng exception_id");
}

TEST(ScheduleV31Reject, WrongSchemaVersion)
{
    std::string json = schedule_json("SCH-001", weekly_mon_only());
    const std::string needle = R"("schema_version":"3.1")";
    json.replace(json.find(needle), needle.size(), R"("schema_version":"3.0")");
    expect_rejected(config({json}), "schema_version khác 3.1 phải bị từ chối");
}

TEST(ScheduleV31Reject, BinaryValueMustBeActiveOrInactive)
{
    const std::string weekly =
        R"({"MON":[{"time":"08:00:00","value":true}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    expect_rejected(config({schedule_json("SCH-001", weekly)}),
                    "BINARY chỉ nhận ACTIVE/INACTIVE, không nhận bool");
}

TEST(ScheduleV31Reject, UnsignedValueMustNotBeNegative)
{
    const std::string weekly =
        R"({"MON":[{"time":"08:00:00","value":-1}],"TUE":[],"WED":[],"THU":[],"FRI":[],"SAT":[],"SUN":[]})";
    expect_rejected(config({schedule_json(
        "SCH-001", weekly, "[]",
        R"([{"target_id":"TGT-001","target_type":"INTERNAL_POINT","point_kind":"MSV","channel":1}])",
        "UNSIGNED", R"({"value":0})")}), "UNSIGNED không nhận số âm");
}

TEST(ScheduleV31Reject, TooManySchedules)
{
    std::vector<std::string> items;
    for (int i = 0; i < 65; i++) {
        char id[16];
        std::snprintf(id, sizeof(id), "SCH-%03d", i + 1);
        items.push_back(schedule_json(id, weekly_empty(), "[]", "[]"));
    }
    expect_rejected(config(items), "quá 64 lịch");
}

TEST(ScheduleV31Reject, TooManyTargets)
{
    std::string targets = "[";
    for (int i = 0; i < 33; i++) {
        if (i) targets += ",";
        targets += R"({"target_id":"TGT-)" + std::to_string(i) +
                   R"(","target_type":"INTERNAL_POINT","point_kind":"BV","channel":)" +
                   std::to_string((i % KX_N_BV) + 1) + "}";
    }
    targets += "]";
    expect_rejected(config({schedule_json("SCH-001", weekly_empty(), "[]", targets)}),
                    "quá 32 target");
}

TEST(ScheduleV31Reject, BacnetTargetIsNotSupportedYet)
{
    /* ADR-023 QĐ-4: BACNET_OBJECT thuộc P4. Từ chối thẳng còn hơn im lặng bỏ
     * qua rồi để người dùng tưởng lịch đang điều khiển thiết bị. */
    expect_rejected(config({schedule_json(
        "SCH-001", weekly_mon_only(), "[]",
        R"([{"target_id":"TGT-001","target_type":"BACNET_OBJECT","device_instance":1001,)"
        R"("object_type":"BINARY_OUTPUT","object_instance":1,"property_identifier":"PRESENT_VALUE"}])")}),
        "BACNET_OBJECT chưa hỗ trợ ở P1");
}

TEST(ScheduleV31Reject, MalformedJson)
{
    expect_rejected("{ this is not json", "JSON hỏng");
}

TEST(ScheduleV31Reject, NotAnArray)
{
    expect_rejected(R"({"foo":1})", "gốc không phải mảng và cũng không có khoá schedules");
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Nạp lại cấu hình
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31Reload, BadConfigKeepsRunningConfig)
{
    /* Cấu hình hỏng KHÔNG được làm mất cấu hình đang chạy — đây là bất biến an
     * toàn, không phải tiện nghi. */
    TempFile f(config({schedule_json("SCH-001", weekly_mon_only())}));
    ScheduleRuntime runtime;
    ASSERT_TRUE(runtime.load(f.path(), true));
    ASSERT_EQ(runtime.schedule_count(), 1u);

    f.write("{ hỏng");
    EXPECT_FALSE(runtime.reload(f.path(), true));
    EXPECT_EQ(runtime.schedule_count(), 1u) << "phải giữ nguyên lịch cũ";
}

TEST(ScheduleV31Reload, MissingFileIsToleratedWhenOptional)
{
    ScheduleRuntime runtime;
    EXPECT_TRUE(runtime.load("/tmp/khong-ton-tai-schedule-v31.json", false));
    EXPECT_EQ(runtime.schedule_count(), 0u);
}

TEST(ScheduleV31Reload, AcceptsWrapperObjectWithHolidayGroups)
{
    const std::string exceptions =
        R"([{"exception_id":"EXC-HG","name":"Le","date_rule":{"type":"HOLIDAY_GROUP","group_id":"HG-CTY"},)"
        R"("event_priority":1,"time_values":[{"time":"00:00:00","value":"ACTIVE"}]}])";
    const std::string wrapper =
        R"({"schedules":)" + config({schedule_json("SCH-001", weekly_empty(), exceptions)}) +
        R"(,"holiday_groups":[{"group_id":"HG-CTY","dates":["2026-12-24"]}]})";

    Fixture f;
    ASSERT_TRUE(f.load(wrapper));
    f.runtime.evaluate_at(at(2026, 12, 24, 12, 0), f.io, f.table, f.resolver);
    EXPECT_EQ(f.runtime.state_of("SCH-001")->source, ValueSource::Exception);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. Tiện ích lịch
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31Calendar, DayOfWeekIso)
{
    EXPECT_EQ(day_of_week_iso(2026, 8, 10), 1) << "10/08/2026 là Thứ Hai";
    EXPECT_EQ(day_of_week_iso(2026, 8, 16), 7) << "16/08/2026 là Chủ nhật";
    EXPECT_EQ(day_of_week_iso(2026, 9, 2), 3) << "02/09/2026 là Thứ Tư";
    EXPECT_EQ(day_of_week_iso(2000, 1, 1), 6) << "01/01/2000 là Thứ Bảy";
}

TEST(ScheduleV31Calendar, DaysInMonthHandlesLeapYears)
{
    EXPECT_EQ(days_in_month(2024, 2), 29);
    EXPECT_EQ(days_in_month(2026, 2), 28);
    EXPECT_EQ(days_in_month(2000, 2), 29) << "2000 chia hết 400 nên là năm nhuận";
    EXPECT_EQ(days_in_month(1900, 2), 28) << "1900 chia hết 100 nhưng không chia hết 400";
    EXPECT_EQ(days_in_month(2026, 13), 0);
}

TEST(ScheduleV31Calendar, ValueValidForType)
{
    EXPECT_TRUE(value_valid_for_type(ValueType::Binary, 1.0));
    EXPECT_FALSE(value_valid_for_type(ValueType::Binary, 2.0));
    EXPECT_TRUE(value_valid_for_type(ValueType::Real, -12.5));
    EXPECT_FALSE(value_valid_for_type(ValueType::Unsigned, -1.0));
    EXPECT_FALSE(value_valid_for_type(ValueType::Unsigned, 1.5));
    EXPECT_TRUE(value_valid_for_type(ValueType::Enumerated, 3.0));
}

TEST(ScheduleV31Calendar, ErrorCodesMatchSpec)
{
    EXPECT_STREQ(schedule_error_code(ScheduleError::ConfigMissingDefault), "SCH-CONFIG-001");
    EXPECT_STREQ(schedule_error_code(ScheduleError::ConfigBadWeekly), "SCH-CONFIG-002");
    EXPECT_STREQ(schedule_error_code(ScheduleError::TargetNotFound), "SCH-TARGET-001");
    EXPECT_STREQ(schedule_error_code(ScheduleError::TargetTypeMismatch), "SCH-TARGET-003");
    EXPECT_STREQ(schedule_error_code(ScheduleError::WriteTimeout), "SCH-WRITE-002");
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9. Hiệu năng — đặc tả §21 đòi 64 lịch dưới 100 ms (SCHD-111)
 * ══════════════════════════════════════════════════════════════════════════ */

TEST(ScheduleV31Performance, SixtyFourSchedulesUnder100ms)
{
    std::vector<std::string> items;
    for (int i = 0; i < 64; i++) {
        char id[16];
        std::snprintf(id, sizeof(id), "SCH-%03d", i + 1);
        /* Mỗi lịch: 7 ngày × 4 mốc, 4 ngoại lệ, 16 target AV. */
        std::string weekly = "{";
        const char* days[7] = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"};
        for (int d = 0; d < 7; d++) {
            if (d) weekly += ",";
            weekly += std::string("\"") + days[d] + "\":[" +
                      R"({"time":"07:30:00","value":10.0},{"time":"12:00:00","value":0.0},)"
                      R"({"time":"13:00:00","value":20.0},{"time":"18:00:00","value":0.0}])";
        }
        weekly += "}";

        std::string exceptions = "[";
        for (int e = 0; e < 4; e++) {
            if (e) exceptions += ",";
            exceptions += R"({"exception_id":"EXC-)" + std::to_string(e) +
                          R"(","name":"E","date_rule":{"type":"WEEK_N_DAY","month":0,"week_of_month":)" +
                          std::to_string(e + 1) +
                          R"(,"day_of_week":1},"event_priority":)" + std::to_string(e + 1) +
                          R"(,"time_values":[{"time":"06:00:00","value":5.0}]})";
        }
        exceptions += "]";

        std::string targets = "[";
        for (int t = 0; t < 16; t++) {
            if (t) targets += ",";
            targets += R"({"target_id":"TGT-)" + std::to_string(t) +
                       R"(","target_type":"INTERNAL_POINT","point_kind":"AV","channel":)" +
                       std::to_string((t % KX_N_AV) + 1) + "}";
        }
        targets += "]";

        items.push_back(schedule_json(id, weekly, exceptions, targets, "REAL", R"({"value":0.0})",
                                      (i % 16) + 1));
    }

    Fixture f;
    ASSERT_TRUE(f.load(config(items)));
    ASSERT_EQ(f.runtime.schedule_count(), 64u);

    const auto begin = std::chrono::steady_clock::now();
    constexpr int kRounds = 100;
    for (int i = 0; i < kRounds; i++) {
        f.runtime.evaluate_at(at(2026, 8, 10, 14, 0), f.io, f.table, f.resolver);
    }
    const auto elapsed = std::chrono::steady_clock::now() - begin;
    const double per_round_ms =
        std::chrono::duration<double, std::milli>(elapsed).count() / kRounds;

    std::printf("[PERF] 64 lịch × 16 target: %.3f ms/vòng (ngưỡng đặc tả §21: 100 ms)\n",
                per_round_ms);
    EXPECT_LT(per_round_ms, 100.0);
}
