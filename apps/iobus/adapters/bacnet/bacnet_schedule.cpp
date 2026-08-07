#include "bacnet_schedule.hpp"

#include <cstdio>
#include <utility>

namespace iobus::bacnet {

namespace {

/* ASHRAE 135 Reliability enum, phần thiết bị này dùng. */
constexpr uint8_t kReliabilityNoFaultDetected     = 0;
constexpr uint8_t kReliabilityConfigurationError  = 10;
constexpr uint8_t kReliabilityCommunicationFailure = 12;
constexpr uint8_t kReliabilityUnreliableOther     = 7;

/* Status_Flags bit 1 = FAULT (§12.x). */
constexpr uint8_t kStatusFlagFault = 0x02;

} // namespace

void BacnetScheduleObjects::set_schedules(std::vector<BacnetSchedule> list)
{
    if (list.size() > static_cast<std::size_t>(kMaxBacnetSchedules)) {
        std::fprintf(stderr, "WARN  bacnet_schedule.too_many count=%zu max=%d (cắt bớt)\n",
                     list.size(), kMaxBacnetSchedules);
        list.resize(kMaxBacnetSchedules);
    }
    schedules_ = std::move(list);
}

void BacnetScheduleObjects::set_calendars(std::vector<BacnetCalendar> list)
{
    if (list.size() > static_cast<std::size_t>(kMaxBacnetCalendars)) {
        std::fprintf(stderr, "WARN  bacnet_calendar.too_many count=%zu max=%d (cắt bớt)\n",
                     list.size(), kMaxBacnetCalendars);
        list.resize(kMaxBacnetCalendars);
    }
    calendars_ = std::move(list);
}

const BacnetSchedule* BacnetScheduleObjects::find_schedule(uint32_t instance) const
{
    for (const BacnetSchedule& s : schedules_) {
        if (s.instance == instance) return &s;
    }
    return nullptr;
}

const BacnetCalendar* BacnetScheduleObjects::find_calendar(uint32_t instance) const
{
    for (const BacnetCalendar& c : calendars_) {
        if (c.instance == instance) return &c;
    }
    return nullptr;
}

bool BacnetScheduleObjects::read_schedule_present_value(uint32_t instance, float* value,
                                                        uint8_t* status_flags) const
{
    const BacnetSchedule* s = find_schedule(instance);
    if (!s || !value) return false;

    /* Controller chưa báo ⇒ KHÔNG trả một con số bịa. Nơi gọi phải dựng
     * Reliability + Status_Flags FAULT thay vì Present_Value giả. */
    if (!s->present_value_known) {
        if (status_flags) *status_flags = kStatusFlagFault;
        return false;
    }

    *value = s->present_value;
    if (status_flags) *status_flags = s->error_code.empty() ? 0 : kStatusFlagFault;
    return true;
}

bool BacnetScheduleObjects::read_calendar_present_value(uint32_t instance, bool* value) const
{
    const BacnetCalendar* c = find_calendar(instance);
    if (!c || !value) return false;
    *value = c->present_value;
    return true;
}

bool BacnetScheduleObjects::write_denied(std::string* reason) const
{
    /* Ghi thẳng vào lịch qua BACnet sẽ bỏ qua chuỗi validate → preview →
     * publish → ACK mà đặc tả §13 bắt buộc, và biến nhật ký audit thành thứ
     * không giải thích được. Từ chối rõ ràng còn hơn nhận rồi lặng lẽ bỏ. */
    if (reason) {
        *reason = "Schedule/Calendar chỉ đọc qua BACnet; sửa lịch phải đi qua "
                  "REST API để có validate, revision và audit";
    }
    return true;
}

uint8_t schedule_reliability_from_error(const std::string& error_code)
{
    if (error_code.empty()) return kReliabilityNoFaultDetected;
    /* Lỗi cấu hình → CONFIGURATION_ERROR; lỗi ghi/giao tiếp →
     * COMMUNICATION_FAILURE; còn lại → UNRELIABLE_OTHER. Ánh xạ này để BMS
     * phân biệt được "cấu hình sai" với "mất liên lạc" mà không cần đọc log. */
    if (error_code.rfind("SCH-CONFIG", 0) == 0 || error_code.rfind("SCH-TARGET", 0) == 0) {
        return kReliabilityConfigurationError;
    }
    if (error_code.rfind("SCH-WRITE", 0) == 0 || error_code == "SCH-RUNTIME-001") {
        return kReliabilityCommunicationFailure;
    }
    return kReliabilityUnreliableOther;
}

} // namespace iobus::bacnet
