/**
 * @file  schedule_clock.hpp
 * @brief Thời gian dân dụng theo múi giờ CỦA TỪNG LỊCH + phát hiện nhảy giờ
 *        (Plan 50 SCHD-301..304, 306).
 *
 * Vì sao tồn tại: trước bản này, `ScheduleRuntime` lấy giờ bằng `localtime_r`,
 * tức theo TZ của TIẾN TRÌNH. Bo Foxlinx chạy `Etc/UTC` trong khi lịch được
 * cấu hình `Asia/Ho_Chi_Minh`, nên một lịch đặt 08:00 giờ Việt Nam sẽ chạy lúc
 * 08:00 UTC = 15:00 giờ Việt Nam. Lệch 7 tiếng, và không có gì trên giao diện
 * cho thấy điều đó.
 *
 * Cách làm: đổi mốc UTC sang giờ dân dụng của đúng múi giờ mà lịch khai báo,
 * dùng cơ sở dữ liệu múi giờ của hệ thống (đã có sẵn trên bo, gồm cả quy tắc
 * DST). Không tự cài bảng offset — bảng tự cài sẽ sai vào ngày một quốc gia
 * đổi quy tắc, và ngày đó không ai biết.
 */
#ifndef CORE_SCHEDULE_CLOCK_HPP
#define CORE_SCHEDULE_CLOCK_HPP

#include <cstdint>
#include <ctime>
#include <string>

namespace core {

/* ── Thời gian dân dụng theo múi giờ của lịch ──────────────────────────── */
struct CivilTime {
    int year = 1970;
    int month = 1;          /* 1..12 */
    int day = 1;            /* 1..31 */
    int weekday = 0;        /* 0=Thứ Hai … 6=Chủ nhật */
    int second_of_day = 0;  /* 0..86399 */
};

CivilTime civil_from_tm(const std::tm& tm);

/**
 * Đổi mốc UTC sang giờ dân dụng của `timezone` (tên IANA).
 *
 * Trả false khi múi giờ không đọc được — nơi gọi phải coi đó là
 * `SCH-TIME-001` chứ KHÔNG được lặng lẽ rơi về giờ UTC. Rơi về UTC là cách
 * biến một lỗi cấu hình nhìn thấy được thành một lệch giờ âm thầm.
 */
bool civil_time_in_zone(const std::string& timezone, int64_t utc_epoch_s, CivilTime* out);

/**
 * Giờ hệ thống đã đồng bộ chưa (SCH-TIME-002).
 *
 * Ngưỡng là mốc 2020-01-01. RTC hết pin thường trả về 1970 hoặc một mốc mặc
 * định của nhà sản xuất; đánh giá lịch trên một cái đồng hồ như vậy là ra lệnh
 * theo một ngày không có thật.
 */
bool system_clock_synced(int64_t utc_epoch_s);

/**
 * Phát hiện thời gian nhảy tiến hoặc lùi (SCHD-303).
 *
 * Nguyên lý: CLOCK_MONOTONIC không nhảy, CLOCK_REALTIME thì có (NTP sửa giờ,
 * người dùng đổi giờ, RTC đọc lại sau khi khởi động). Hai đồng hồ trôi khác
 * nhau quá ngưỡng nghĩa là realtime vừa bị dịch.
 */
class TimeJumpDetector {
public:
    struct Result {
        bool jumped = false;
        /** Độ lệch phát hiện được, giây. Âm = giờ nhảy LÙI. */
        int64_t delta_s = 0;
    };

    /** Ngưỡng mặc định 5 giây — lớn hơn sai số lập lịch của scan loop, nhỏ hơn
     *  mọi bước chỉnh giờ đáng quan tâm. */
    explicit TimeJumpDetector(int64_t threshold_s = 5) : threshold_s_(threshold_s) {}

    Result observe(uint64_t monotonic_ns, int64_t utc_epoch_ms);
    void reset() { has_previous_ = false; }

private:
    int64_t threshold_s_;
    bool has_previous_ = false;
    uint64_t prev_monotonic_ns_ = 0;
    int64_t prev_utc_epoch_ms_ = 0;
};

} // namespace core

#endif /* CORE_SCHEDULE_CLOCK_HPP */
