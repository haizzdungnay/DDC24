/**
 * @file  bacnet_schedule.hpp
 * @brief P4 — BACnet Schedule Object (type 17) và Calendar Object (type 6).
 *        Plan 50 SCHD-401..406, ADR-023 QĐ-4.
 *
 * Phơi lịch của MK-DDC-24 ra mạng BACnet để BMS đọc được cấu hình lịch mà
 * không cần vào giao diện web.
 *
 * Phạm vi có chủ ý: **chỉ đọc**. Đặc tả §13 bắt mọi thay đổi lịch phải qua
 * validate → preview → publish → ACK, có revision và audit. Cho phép một BMS
 * ngoài ghi thẳng `Weekly_Schedule` qua BACnet là bỏ qua toàn bộ chuỗi đó, và
 * biến nhật ký audit thành thứ không giải thích được. Ghi vào lịch trả
 * `WRITE_ACCESS_DENIED`.
 *
 * `Present_Value` và `Priority_For_Writing` vẫn phản ánh trạng thái THẬT do
 * controller báo, nên BMS giám sát được.
 *
 * Nguồn dữ liệu là bản sao trạng thái mà core publish; iobus không tự đọc
 * schedule.conf. Một tệp cấu hình có hai người đọc là hai cách hiểu.
 */
#ifndef IOBUS_BACNET_SCHEDULE_HPP
#define IOBUS_BACNET_SCHEDULE_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "bacnet_cov.hpp"

namespace iobus::bacnet {

/** Mã object type theo ASHRAE 135. */
constexpr uint16_t kBacnetObjectTypeCalendar = 6;
constexpr uint16_t kBacnetObjectTypeSchedule = 17;

/** Trần phơi ra BACnet, khớp trần của Scheduler Engine. */
constexpr int kMaxBacnetSchedules = 64;
constexpr int kMaxBacnetCalendars = 16;

/** Một mốc Time-Value trong Weekly_Schedule / Exception_Schedule. */
struct BacnetTimeValue {
    uint8_t hour = 0;
    uint8_t minute = 0;
    uint8_t second = 0;
    float   value = 0.0f;
};

/** Một ngày trong Weekly_Schedule; index 0 = Thứ Hai theo ASHRAE. */
struct BacnetDaySchedule {
    std::vector<BacnetTimeValue> time_values;
};

struct BacnetDateRange {
    /* 0 = không giới hạn (wildcard của BACnet). */
    uint16_t start_year = 0; uint8_t start_month = 0; uint8_t start_day = 0;
    uint16_t end_year = 0;   uint8_t end_month = 0;   uint8_t end_day = 0;
};

/** Tham chiếu tới một đối tượng bị lịch điều khiển. */
struct BacnetObjectPropertyRef {
    BacnetObjectType obj_type = BacnetObjectType::BINARY_OUTPUT;
    uint32_t instance = 0;
    /* 85 = PRESENT_VALUE. */
    uint32_t property_id = 85;
};

/**
 * Schedule Object (type 17).
 *
 * Các thuộc tính bắt buộc theo ASHRAE 135 §12.24 mà thiết bị này hỗ trợ:
 * Object_Identifier, Object_Name, Object_Type, Present_Value, Effective_Period,
 * Weekly_Schedule, Exception_Schedule, Schedule_Default,
 * List_Of_Object_Property_References, Priority_For_Writing, Status_Flags,
 * Reliability, Out_Of_Service.
 */
struct BacnetSchedule {
    uint32_t    instance = 0;
    std::string name;
    bool        enabled = false;

    /* Giá trị đang hiệu lực do controller báo. Không tự tính lại ở iobus —
     * hai nơi cùng tính là hai nơi để lệch nhau. */
    float       present_value = 0.0f;
    bool        present_value_known = false;

    float       schedule_default = 0.0f;
    BacnetDateRange effective_period;
    BacnetDaySchedule weekly[7];
    std::vector<BacnetTimeValue> exception_values;   /* rút gọn cho ReadProperty */
    std::vector<BacnetObjectPropertyRef> references;
    uint8_t     priority_for_writing = 16;

    /* Mã lỗi đặc tả §11 gần nhất, rỗng = bình thường. Dùng để suy Reliability. */
    std::string error_code;
};

/** Calendar Object (type 6) — danh sách ngày cho CALENDAR_REFERENCE. */
struct BacnetCalendar {
    uint32_t    instance = 0;
    std::string name;
    struct Entry { uint16_t year = 0; uint8_t month = 0; uint8_t day = 0; };
    std::vector<Entry> dates;
    /** Hôm nay có nằm trong danh sách không (Present_Value của Calendar). */
    bool present_value = false;
};

/**
 * Sổ đăng ký Schedule/Calendar phơi ra BACnet.
 *
 * `iobus` nhận bản sao trạng thái từ core rồi phục vụ ReadProperty. Không giữ
 * logic đánh giá lịch nào ở đây.
 */
class BacnetScheduleObjects {
public:
    /** Thay toàn bộ tập lịch. Vượt trần thì cắt và ghi cảnh báo. */
    void set_schedules(std::vector<BacnetSchedule> list);
    void set_calendars(std::vector<BacnetCalendar> list);

    std::size_t schedule_count() const { return schedules_.size(); }
    std::size_t calendar_count() const { return calendars_.size(); }

    const BacnetSchedule* find_schedule(uint32_t instance) const;
    const BacnetCalendar* find_calendar(uint32_t instance) const;

    /** Present_Value. Trả false khi instance sai hoặc controller chưa báo —
     *  nơi gọi phải trả Reliability thay vì bịa một con số. */
    bool read_schedule_present_value(uint32_t instance, float* value, uint8_t* status_flags) const;
    bool read_calendar_present_value(uint32_t instance, bool* value) const;

    /**
     * Mọi WriteProperty vào Schedule/Calendar đều bị từ chối.
     * Trả về mã lỗi BACnet WRITE_ACCESS_DENIED (abort reason 40 theo §18.1),
     * để nơi gọi dựng Error PDU đúng chuẩn thay vì im lặng bỏ qua.
     */
    static constexpr uint8_t kWriteAccessDenied = 40;
    bool write_denied(std::string* reason) const;

    const std::vector<BacnetSchedule>& schedules() const { return schedules_; }
    const std::vector<BacnetCalendar>& calendars() const { return calendars_; }

private:
    std::vector<BacnetSchedule> schedules_;
    std::vector<BacnetCalendar> calendars_;
};

/** Trạng thái tin cậy suy từ mã lỗi đặc tả §11 (ASHRAE Reliability enum). */
uint8_t schedule_reliability_from_error(const std::string& error_code);

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_SCHEDULE_HPP */
