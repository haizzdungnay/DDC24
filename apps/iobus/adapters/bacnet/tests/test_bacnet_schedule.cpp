/**
 * P4 — BACnet Schedule (type 17) + Calendar (type 6). Plan 50 SCHD-405.
 *
 * Trọng tâm: đối tượng phơi ra mạng phải nói THẬT. Chưa có dữ liệu thì báo
 * fault, không trả một con số bịa; và ghi vào lịch qua BACnet phải bị từ chối
 * rõ ràng chứ không nhận rồi lặng lẽ bỏ.
 */
#include <gtest/gtest.h>

#include "bacnet/bacnet_schedule.hpp"

using namespace iobus::bacnet;

namespace {

BacnetSchedule make_schedule(uint32_t instance, const char* name)
{
    BacnetSchedule s;
    s.instance = instance;
    s.name = name;
    s.enabled = true;
    s.schedule_default = 0.0f;
    s.priority_for_writing = 16;
    s.weekly[0].time_values = {{8, 0, 0, 1.0f}, {18, 0, 0, 0.0f}};
    s.references.push_back({BacnetObjectType::BINARY_OUTPUT, 1, 85});
    return s;
}

} // namespace

TEST(BacnetScheduleObject, ObjectTypeCodesMatchAshrae)
{
    /* Sai mã object type thì BMS không nhận ra đối tượng, và triệu chứng là
     * "thiết bị không có lịch" chứ không phải một lỗi rõ ràng. */
    EXPECT_EQ(kBacnetObjectTypeSchedule, 17u);
    EXPECT_EQ(kBacnetObjectTypeCalendar, 6u);
}

TEST(BacnetScheduleObject, RegistersAndFindsByInstance)
{
    BacnetScheduleObjects reg;
    reg.set_schedules({make_schedule(1, "HVAC"), make_schedule(2, "Đèn")});
    EXPECT_EQ(reg.schedule_count(), 2u);

    const BacnetSchedule* s = reg.find_schedule(2);
    ASSERT_NE(s, nullptr);
    EXPECT_EQ(s->name, "Đèn");
    EXPECT_EQ(reg.find_schedule(99), nullptr);
}

TEST(BacnetScheduleObject, ReportsFaultWhenControllerHasNotReported)
{
    /* Đây là điểm quan trọng nhất của cả tệp test này: Present_Value chưa biết
     * thì phải báo fault, KHÔNG trả 0.0. Một BMS đọc được 0.0 sẽ tưởng lịch
     * đang tắt, trong khi thật ra ta không biết gì cả. */
    BacnetScheduleObjects reg;
    BacnetSchedule s = make_schedule(1, "HVAC");
    s.present_value_known = false;
    reg.set_schedules({s});

    float value = 123.0f;
    uint8_t flags = 0;
    EXPECT_FALSE(reg.read_schedule_present_value(1, &value, &flags));
    EXPECT_EQ(flags & 0x02, 0x02) << "phải bật cờ FAULT";
    EXPECT_FLOAT_EQ(value, 123.0f) << "không được ghi đè giá trị của nơi gọi";
}

TEST(BacnetScheduleObject, ReturnsPresentValueWhenKnown)
{
    BacnetScheduleObjects reg;
    BacnetSchedule s = make_schedule(1, "HVAC");
    s.present_value = 1.0f;
    s.present_value_known = true;
    reg.set_schedules({s});

    float value = 0.0f;
    uint8_t flags = 0xFF;
    EXPECT_TRUE(reg.read_schedule_present_value(1, &value, &flags));
    EXPECT_FLOAT_EQ(value, 1.0f);
    EXPECT_EQ(flags, 0) << "không lỗi thì không cờ nào được bật";
}

TEST(BacnetScheduleObject, SetsFaultFlagWhenScheduleHasErrorCode)
{
    BacnetScheduleObjects reg;
    BacnetSchedule s = make_schedule(1, "HVAC");
    s.present_value = 1.0f;
    s.present_value_known = true;
    s.error_code = "SCH-WRITE-002";
    reg.set_schedules({s});

    float value = 0.0f;
    uint8_t flags = 0;
    EXPECT_TRUE(reg.read_schedule_present_value(1, &value, &flags));
    EXPECT_EQ(flags & 0x02, 0x02);
}

TEST(BacnetScheduleObject, WriteIsAlwaysDenied)
{
    /* Cho BMS ghi thẳng Weekly_Schedule là bỏ qua validate → preview →
     * publish → ACK, và biến nhật ký audit thành thứ không giải thích được. */
    BacnetScheduleObjects reg;
    reg.set_schedules({make_schedule(1, "HVAC")});

    std::string reason;
    EXPECT_TRUE(reg.write_denied(&reason));
    EXPECT_FALSE(reason.empty()) << "phải nói RÕ vì sao bị từ chối";
    EXPECT_NE(reason.find("audit"), std::string::npos);
    EXPECT_EQ(BacnetScheduleObjects::kWriteAccessDenied, 40u);
}

TEST(BacnetScheduleObject, TruncatesBeyondCapacityInsteadOfCorrupting)
{
    BacnetScheduleObjects reg;
    std::vector<BacnetSchedule> many;
    for (int i = 0; i < kMaxBacnetSchedules + 10; i++) {
        many.push_back(make_schedule(static_cast<uint32_t>(i + 1), "X"));
    }
    reg.set_schedules(std::move(many));
    EXPECT_EQ(reg.schedule_count(), static_cast<std::size_t>(kMaxBacnetSchedules));
}

TEST(BacnetScheduleObject, MapsSpecErrorCodesToReliability)
{
    /* Ánh xạ này để BMS phân biệt "cấu hình sai" với "mất liên lạc" mà không
     * cần đọc log của controller. */
    EXPECT_EQ(schedule_reliability_from_error(""), 0);              /* NO_FAULT_DETECTED */
    EXPECT_EQ(schedule_reliability_from_error("SCH-CONFIG-001"), 10); /* CONFIGURATION_ERROR */
    EXPECT_EQ(schedule_reliability_from_error("SCH-TARGET-003"), 10);
    EXPECT_EQ(schedule_reliability_from_error("SCH-WRITE-002"), 12);  /* COMMUNICATION_FAILURE */
    EXPECT_EQ(schedule_reliability_from_error("SCH-RUNTIME-001"), 12);
    EXPECT_EQ(schedule_reliability_from_error("SCH-TIME-002"), 7);    /* UNRELIABLE_OTHER */
}

TEST(BacnetCalendarObject, PresentValueReflectsWhetherTodayIsInList)
{
    BacnetScheduleObjects reg;
    BacnetCalendar c;
    c.instance = 1;
    c.name = "Ngày lễ công ty";
    c.dates = {{2026, 9, 2}, {2026, 12, 24}};
    c.present_value = true;
    reg.set_calendars({c});

    bool today = false;
    EXPECT_TRUE(reg.read_calendar_present_value(1, &today));
    EXPECT_TRUE(today);
    EXPECT_FALSE(reg.read_calendar_present_value(99, &today)) << "instance sai phải trả false";
    EXPECT_EQ(reg.calendar_count(), 1u);
}

TEST(BacnetScheduleObject, KeepsWeeklyAndReferencesForReadProperty)
{
    BacnetScheduleObjects reg;
    reg.set_schedules({make_schedule(1, "HVAC")});
    const BacnetSchedule* s = reg.find_schedule(1);
    ASSERT_NE(s, nullptr);

    ASSERT_EQ(s->weekly[0].time_values.size(), 2u);
    EXPECT_EQ(s->weekly[0].time_values[0].hour, 8);
    EXPECT_FLOAT_EQ(s->weekly[0].time_values[1].value, 0.0f);

    ASSERT_EQ(s->references.size(), 1u);
    EXPECT_EQ(s->references[0].obj_type, BacnetObjectType::BINARY_OUTPUT);
    EXPECT_EQ(s->references[0].property_id, 85u) << "85 = PRESENT_VALUE";
    EXPECT_EQ(s->priority_for_writing, 16);
}
