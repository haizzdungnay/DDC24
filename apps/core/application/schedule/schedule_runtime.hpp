/**
 * @file  schedule_runtime.hpp
 * @brief Scheduler Engine v3.1 — Schedule Object (ADR-023, đặc tả §4..§10).
 *
 *        Thay hoàn toàn mô hình một-khoảng-một-giá-trị cũ. Một Schedule Object
 *        mang lịch tuần nhiều mốc, ngoại lệ riêng của nó, giá trị mặc định,
 *        khoảng hiệu lực và danh sách target.
 *
 *        PRIORITY (ADR-023 QĐ-1): `priority_for_writing` 1..16 được phân xử
 *        NGAY TRONG lớp này giữa các lịch cùng ghi một điểm; chỉ lịch thắng đi
 *        xuống `PRIO_SCHEDULE` (mức 4) của `PriorityResolver` 6 mức. Không mở
 *        rộng resolver, không chạm đường Fire/Safety. Hệ quả có chủ ý: một lịch
 *        đặt priority 1 vẫn KHÔNG thắng được lệnh tay tại chỗ (mức 2).
 *
 *        Hợp đồng: contracts/config/schedule_v3_1.schema.json (FROZEN 2026-08-07)
 */
#ifndef CORE_SCHEDULE_RUNTIME_HPP
#define CORE_SCHEDULE_RUNTIME_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <ctime>
#include <string>
#include <vector>

#include "graph/clock_snapshot.hpp"
#include "graph/point_table.hpp"
#include "graph/point_writer.hpp"
#include "ports/io_snapshot.hpp"
#include "priority/priority_resolver.hpp"
#include "schedule/schedule_clock.hpp"

namespace core {

/* ── Mã lỗi đặc tả §11 ─────────────────────────────────────────────────── */
enum class ScheduleError {
    None,
    ConfigMissingDefault,   /* SCH-CONFIG-001 */
    ConfigBadWeekly,        /* SCH-CONFIG-002 */
    ConfigExceptionConflict,/* SCH-CONFIG-003 */
    TargetNotFound,         /* SCH-TARGET-001 */
    TargetNotWritable,      /* SCH-TARGET-002 */
    TargetTypeMismatch,     /* SCH-TARGET-003 */
    TimeBadTimezone,        /* SCH-TIME-001 */
    TimeNotSynced,          /* SCH-TIME-002 */
    WriteFailed,            /* SCH-WRITE-001 */
    WriteTimeout,           /* SCH-WRITE-002 */
    RuntimeDown             /* SCH-RUNTIME-001 */
};

const char* schedule_error_code(ScheduleError e);

/* ── Kiểu giá trị (đặc tả §2.1) ────────────────────────────────────────── */
enum class ValueType { Binary, Boolean, Real, Unsigned, Enumerated };

/* Mọi giá trị lưu dạng double; ValueType quyết định cách diễn giải và cách
 * kiểm hợp lệ. BINARY: ACTIVE=1, INACTIVE=0. */
bool value_valid_for_type(ValueType t, double v);

/* ── Lịch tuần ─────────────────────────────────────────────────────────── */
struct TimeValue {
    int second_of_day = 0;
    double value = 0.0;
};

using DaySchedule = std::vector<TimeValue>;
using WeeklySchedule = std::array<DaySchedule, 7>;   /* [0]=Thứ Hai */

/* ── Ngoại lệ ──────────────────────────────────────────────────────────── */
enum class DateRuleType { Date, DateRange, WeekNDay, CalendarReference, HolidayGroup };

struct CivilDate {
    int year = 0;
    int month = 0;
    int day = 0;
    bool valid() const { return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31; }
};

struct DateRule {
    DateRuleType type = DateRuleType::Date;
    CivilDate date;             /* DATE */
    CivilDate start_date;       /* DATE_RANGE */
    CivilDate end_date;         /* DATE_RANGE */
    int month = 0;              /* WEEK_N_DAY: 1..12, 0=mọi tháng */
    int week_of_month = 0;      /* WEEK_N_DAY: 1..5, 6=tuần CUỐI (quy ước BACnet) */
    int day_of_week = 0;        /* WEEK_N_DAY: 1=Thứ Hai … 7=Chủ nhật (ISO-8601) */
    std::string ref_id;         /* CALENDAR_REFERENCE / HOLIDAY_GROUP */
};

/* Ngày `d` có khớp quy tắc không. CALENDAR_REFERENCE và HOLIDAY_GROUP tra trong
 * `groups` — chưa nạp nhóm thì trả false chứ không đoán. */
struct HolidayGroup {
    std::string id;
    std::vector<CivilDate> dates;
};

bool date_rule_matches(const DateRule& rule, const CivilTime& now,
                       const std::vector<HolidayGroup>& groups);

struct ExceptionEntry {
    std::string id;
    std::string name;
    DateRule date_rule;
    int event_priority = 16;    /* 1 cao nhất; CHỈ phân xử giữa các exception */
    std::vector<TimeValue> time_values;
};

/* ── Khoảng hiệu lực ───────────────────────────────────────────────────── */
struct EffectivePeriod {
    CivilDate start;    /* !valid() ⇒ không có ngày bắt đầu */
    CivilDate end;      /* !valid() ⇒ KHÔNG CÓ ngày kết thúc */
};

/* ── Target ────────────────────────────────────────────────────────────── */
enum class InactiveAction { WriteValue, Relinquish };

struct ScheduleTarget {
    std::string id;
    PointKind kind = PointKind::AV;
    int idx = 0;                /* 0-based */
    std::string point_id;
    double active_value = 1.0;
    double inactive_value = 0.0;
    bool has_active_value = false;
    bool has_inactive_value = false;
    InactiveAction inactive_action = InactiveAction::WriteValue;
    int staggered_delay_seconds = 0;
};

/* ── Schedule Object ───────────────────────────────────────────────────── */
struct ScheduleObject {
    std::string id;
    std::string name;
    bool enabled = false;
    std::string timezone = "Asia/Ho_Chi_Minh";
    EffectivePeriod effective_period;
    ValueType value_type = ValueType::Binary;
    int priority_for_writing = 16;
    double schedule_default = 0.0;
    WeeklySchedule weekly;
    std::vector<ExceptionEntry> exceptions;
    std::vector<ScheduleTarget> targets;
    uint64_t revision = 0;
};

/* ── Kết quả đánh giá một lịch ─────────────────────────────────────────── */
enum class ValueSource { Weekly, Exception, Default, None };

struct TargetResult {
    std::string target_id;
    PointKind kind = PointKind::AV;
    int idx = 0;
    bool written = false;       /* false = lịch này thua ở bước phân xử */
    double written_value = 0.0;
    ScheduleError error = ScheduleError::None;
    /* Nguồn ĐANG THẮNG trên PriorityResolver khi nguồn đó không phải schedule
     * (FIRE_SAFETY / LOCAL_MANUAL / BACNET / LOCAL_LOGIC). Rỗng = lệnh lịch
     * đang tới được đầu ra. Đây là trường trả lời câu hỏi tốn nhiều thời gian
     * hiện trường nhất: "lịch bật rồi mà sao thiết bị không chạy". */
    const char* override_source = "";
    bool should_claim = true;
    bool in_staggered_delay = false;
    int delay_remaining_sec = 0;
};

struct ScheduleState {
    std::string schedule_id;
    bool active = false;                        /* trong effective period + enabled */
    double effective_value = 0.0;
    ValueSource source = ValueSource::None;
    std::string source_exception_id;
    /* Giây kể từ đầu tuần tới lần chuyển kế tiếp; <0 = không có */
    int next_transition_week_second = -1;
    ScheduleError error = ScheduleError::None;
    std::vector<TargetResult> targets;
};

/* ── Runtime ───────────────────────────────────────────────────────────── */
class ScheduleRuntime {
public:
    bool load(const std::string& path, bool must_exist = false);
    bool reload(const std::string& path, bool must_exist = false);
    void configure(std::vector<ScheduleObject> schedules);
    void set_holiday_groups(std::vector<HolidayGroup> groups) { groups_ = std::move(groups); }

    /* Ghi qua PointWriter — đường ghi dùng chung với mọi nguồn khác (P1-02).
     * KHÔNG nhận PointTable trực tiếp nữa: nhận nó là mở lại đúng cái cửa đã
     * làm lệnh lịch cho điểm EXT chết lặng. */
    void evaluate(const IoSnapshot& io, PointWriter& writer, PriorityResolver& resolver);
    /* Đánh giá theo đồng hồ hệ thống. MỖI LỊCH được đổi sang giờ dân dụng của
     * múi giờ mà chính nó khai báo (SCHD-301) — không dùng TZ của tiến trình. */
    void evaluate(const ClockSnapshot& clock, const IoSnapshot& io, PointWriter& writer,
                  PriorityResolver& resolver);
    /* Đánh giá với MỘT mốc giờ dân dụng cho mọi lịch. Dùng cho test và cho mô
     * phỏng, nơi múi giờ đã được nơi gọi xử lý. */
    void evaluate_at(const CivilTime& now, const IoSnapshot& io, PointWriter& writer,
                     PriorityResolver& resolver);

    std::size_t schedule_count() const { return schedules_.size(); }
    const std::vector<ScheduleState>& states() const { return states_; }
    const ScheduleState* state_of(const std::string& schedule_id) const;

    /* Đánh giá thuần không ghi ra target — dùng cho mô phỏng (SCHD-133).
     * Backend gọi CHÍNH hàm này qua vỏ C; cấm cài lại thuật toán ở nơi khác. */
    ScheduleState evaluate_schedule(const ScheduleObject& s, const CivilTime& now) const;

private:
    struct AppliedTarget {
        PointKind kind = PointKind::AV;
        int idx = 0;
        double value = 0.0;
        bool in_delay = false;
    };

    std::vector<ScheduleObject> schedules_;
    std::vector<HolidayGroup> groups_;
    TimeJumpDetector jump_detector_;
    std::vector<ScheduleState> states_;
    std::vector<AppliedTarget> applied_;

    void evaluate_zoned(int64_t utc_epoch_s, const IoSnapshot& io, PointWriter& writer,
                        PriorityResolver& resolver);
    void apply_states(const IoSnapshot& io, PointWriter& writer, PriorityResolver& resolver);

    void release_missing(const std::vector<AppliedTarget>& active, PointWriter& writer,
                         PriorityResolver& resolver);

    /* Ngoại lệ thắng của ngày cách hôm nay `ahead` ngày — dùng khi tính lần
     * chuyển trạng thái kế tiếp (P1-04). */
    const ExceptionEntry* exception_for_offset(const ScheduleObject& s, const CivilTime& now,
                                               int ahead) const;
};

bool load_schedule_config(const std::string& path, bool must_exist,
                          std::vector<ScheduleObject>* out,
                          std::vector<HolidayGroup>* groups = nullptr);

/* Phơi ra để test và để backend dùng lại — không phải chi tiết nội bộ. */
bool effective_period_contains(const EffectivePeriod& p, const CivilTime& now);
int  day_of_week_iso(int year, int month, int day);   /* 1=Thứ Hai … 7=Chủ nhật */
int  days_in_month(int year, int month);

} // namespace core

#endif /* CORE_SCHEDULE_RUNTIME_HPP */
