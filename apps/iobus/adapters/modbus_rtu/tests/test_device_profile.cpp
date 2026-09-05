/**
 * @file  test_device_profile.cpp
 * @brief TC-10-01: profile parser valid/invalid (MOD-003).
 */
#include <gtest/gtest.h>
#include <cstdio>
#include <fstream>
#include "device_profile.hpp"

using namespace iobus::fieldbus;

class ProfileTest : public ::testing::Test {
protected:
    std::string tmp_path;

    void write_profile(const std::string& json)
    {
        tmp_path = "/tmp/test_profile_" + std::to_string(getpid()) + ".json";
        std::ofstream f(tmp_path);
        f << json;
    }
    void TearDown() override { if (!tmp_path.empty()) ::unlink(tmp_path.c_str()); }
};

TEST_F(ProfileTest, ValidMinimalProfile)
{
    write_profile(R"({
        "profile_id": "test-meter",
        "points": [
          {"name":"kWh","fc":4,"addr":1000,"count":2,"type":"float32",
           "byte_order":"ABCD","scale":1.0,"offset":0.0}
        ]
    })");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.profile_id, "test-meter");
    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_EQ(prof.points[0].fc, 4u);
    EXPECT_EQ(prof.points[0].type, PointType::Float32);
    EXPECT_EQ(prof.points[0].byte_order, ByteOrder::ABCD);
}

TEST_F(ProfileTest, InvalidFcRejected)
{
    write_profile(R"({"profile_id":"bad","points":[{"name":"x","fc":99,"addr":0,"count":1,"type":"uint16"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points.size(), 0u);   /* point di-skip */
}

TEST_F(ProfileTest, WritableBadFcRejected)
{
    /* fc=4 (read-only) + writable=true → invalid */
    write_profile(R"({"points":[{"name":"x","fc":4,"addr":0,"count":1,"type":"uint16","writable":true}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points.size(), 0u);
}

TEST_F(ProfileTest, WritableCoilAndHoldingRegisterAccepted)
{
    write_profile(R"({"points":[
      {"name":"relay","fc":1,"addr":0,"count":1,"type":"bool","writable":true},
      {"name":"setpoint","fc":3,"addr":10,"count":1,"type":"uint16","writable":true}
    ]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    ASSERT_EQ(prof.points.size(), 2u);
    EXPECT_TRUE(prof.points[0].writable);
    EXPECT_TRUE(prof.points[1].writable);
}

TEST_F(ProfileTest, Float32MissingByteOrderRejected)
{
    write_profile(R"({"points":[{"name":"x","fc":4,"addr":0,"count":2,"type":"float32"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points.size(), 0u);
}

/* OD-MBRTU-014: cấu hình CŨ còn `expose_bacnet` phải nạp được và Point vẫn hoạt
 * động bình thường — gỡ tính năng không được biến file cấu hình đang chạy thành
 * file hỏng. Nhưng nó KHÔNG được im lặng: người vận hành phải thấy cảnh báo
 * deprecated, nếu không họ sẽ tin BACnet exposure đang chạy trong khi không.
 *
 * Test khoá đúng hai điều đó: Point vẫn được nhận, và stderr có cảnh báo. */
TEST_F(ProfileTest, LegacyExposeBacnetIsIgnoredWithDeprecationWarning)
{
    write_profile(R"({"points":[
      {"name":"kWh","fc":4,"addr":1000,"count":2,"type":"float32",
       "byte_order":"ABCD","expose_bacnet":true,"bacnet_object_type":"AV","bacnet_instance":100}
    ]})");

    testing::internal::CaptureStderr();
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    const std::string diagnostics = testing::internal::GetCapturedStderr();

    /* Point vẫn hợp lệ: mọi trường CÒN trong phạm vi Rev A phải giữ nguyên. */
    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_EQ(prof.points[0].name, "kWh");
    EXPECT_EQ(prof.points[0].addr, 1000u);
    EXPECT_EQ(prof.points[0].count, 2u);

    EXPECT_NE(diagnostics.find("profile.expose_bacnet_deprecated"), std::string::npos)
        << "nạp cấu hình cũ có expose_bacnet mà không cảnh báo — người vận hành sẽ "
           "tưởng BACnet exposure đang chạy. stderr: "
        << diagnostics;
}

/* Không có `expose_bacnet` là đường đi thường gặp; nó tuyệt đối không được sinh
 * cảnh báo, nếu không log vận hành sẽ đầy nhiễu và cảnh báo thật bị chìm. */
TEST_F(ProfileTest, ProfileWithoutLegacyBacnetFieldStaysQuiet)
{
    write_profile(R"({"points":[
      {"name":"kWh","fc":4,"addr":1000,"count":2,"type":"float32","byte_order":"ABCD"}
    ]})");

    testing::internal::CaptureStderr();
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    const std::string diagnostics = testing::internal::GetCapturedStderr();

    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_EQ(diagnostics.find("expose_bacnet"), std::string::npos) << diagnostics;
}

TEST_F(ProfileTest, FileNotFound)
{
    DeviceProfile prof;
    EXPECT_FALSE(load_device_profile("/tmp/nonexistent_profile.json", &prof));
}

/* ---- F-18: validation "32-bit ⇒ count là bội số của 2" ----
 * Trước 2026-07-30 luật này chỉ tồn tại trong tài liệu (device_profile.hpp);
 * biến is32bit chỉ được dùng cho check byte_order. Profile count lẻ đi qua
 * loader trọn vẹn rồi RTU publish `0*scale+offset` với KX_Q_GOOD. */

TEST_F(ProfileTest, Float32OddCountRejected)
{
    write_profile(R"({"points":[{"name":"x","fc":4,"addr":0,"count":1,
                     "type":"float32","byte_order":"ABCD"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points.size(), 0u);
}

TEST_F(ProfileTest, Int32AndUint32OddCountRejected)
{
    write_profile(R"({"points":[
        {"name":"a","fc":3,"addr":0,"count":3,"type":"int32","byte_order":"ABCD"},
        {"name":"b","fc":4,"addr":10,"count":5,"type":"uint32","byte_order":"CDAB"}
    ]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points.size(), 0u);
}

TEST_F(ProfileTest, Float32CountMultipleOfTwoAccepted)
{
    /* Chốt luật là BỘI SỐ của 2 (không phải đúng bằng 2) để giữ khả năng đọc
     * block nhiều điểm 32-bit liên tiếp mà cả hai vòng đọc đã hỗ trợ. */
    write_profile(R"({"points":[{"name":"x","fc":4,"addr":0,"count":6,
                     "type":"float32","byte_order":"ABCD"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_EQ(prof.points[0].count, 6u);
    EXPECT_EQ(ext_slots_for_point(prof.points[0]), 3u);   /* 6 register = 3 điểm */
}

TEST_F(ProfileTest, Uint16OddCountStillAccepted)
{
    /* Luật chỉ áp cho 32-bit — 16-bit count lẻ là hợp lệ, không được vạ lây. */
    write_profile(R"({"points":[{"name":"x","fc":3,"addr":0,"count":7,"type":"uint16"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_EQ(ext_slots_for_point(prof.points[0]), 7u);
}

/* ---- F-21: giới hạn block coil ---- */

TEST_F(ProfileTest, CoilBlockOverLimitRejected)
{
    write_profile(R"({"points":[{"name":"x","fc":1,"addr":0,"count":2001,"type":"bool"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points.size(), 0u);
}

TEST_F(ProfileTest, CoilBlockAtLimitAccepted)
{
    /* 2000 = MODBUS_MAX_READ_BITS, khớp buffer bits[2000] ở vòng đọc → hợp lệ.
     * Chốt cả biên trên để lần sau ai viết lại biểu thức không âm thầm lệch 1. */
    write_profile(R"({"points":[{"name":"x","fc":2,"addr":0,"count":2000,"type":"bool"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_EQ(prof.points[0].count, 2000u);
}

/* ---- F-17: ext slot accounting là hàm thuần, test không cần libmodbus ---- */

TEST(ExtSlotAccounting, WriteFunctionCodesConsumeNoSlot)
{
    for (const uint8_t fc : {5, 6, 15, 16}) {
        ProfilePoint pt;
        pt.fc = fc;
        pt.count = 4;
        pt.type = PointType::Uint16;
        EXPECT_EQ(ext_slots_for_point(pt), 0u) << "fc=" << static_cast<int>(fc);
    }
}

TEST(ExtSlotAccounting, CoilAndDiscreteInputUseOneSlotPerBit)
{
    ProfilePoint pt;
    pt.fc = 1;
    pt.count = 16;
    pt.type = PointType::Bool;
    EXPECT_EQ(ext_slots_for_point(pt), 16u);
    pt.fc = 2;
    EXPECT_EQ(ext_slots_for_point(pt), 16u);
}

TEST(ExtSlotAccounting, SixteenBitRegisterUsesOneSlotPerRegister)
{
    ProfilePoint pt;
    pt.fc = 3;
    pt.count = 5;
    pt.type = PointType::Int16;
    EXPECT_EQ(ext_slots_for_point(pt), 5u);
}

TEST(ExtSlotAccounting, ThirtyTwoBitRegisterUsesOneSlotPerTwoRegisters)
{
    /* Đây là lỗi gốc của F-17: open() đếm 2 (số register) trong khi vòng đọc
     * tiêu 1 → đặt trước gấp đôi số slot cần. */
    for (const PointType t : {PointType::Int32, PointType::Uint32, PointType::Float32}) {
        ProfilePoint pt;
        pt.fc = 4;
        pt.count = 2;
        pt.type = t;
        EXPECT_EQ(ext_slots_for_point(pt), 1u);
        pt.count = 8;
        EXPECT_EQ(ext_slots_for_point(pt), 4u);
        EXPECT_TRUE(point_type_is_32bit(t));
    }
}

TEST(ExtSlotAccounting, OddThirtyTwoBitTailIsNotCounted)
{
    /* Loader đã chặn count lẻ; với ProfilePoint dựng thủ công thì register lẻ ở
     * cuối bị vòng đọc log + bỏ và KHÔNG tiêu slot — phép làm tròn xuống ở đây
     * phải khớp đúng điều đó. */
    ProfilePoint pt;
    pt.fc = 3;
    pt.count = 5;
    pt.type = PointType::Float32;
    EXPECT_EQ(ext_slots_for_point(pt), 2u);
}

TEST(ExtSlotAccounting, ProfileTotalIsSumOverPoints)
{
    DeviceProfile prof;
    ProfilePoint a;   a.fc = 4; a.count = 2; a.type = PointType::Float32;  /* 1 */
    ProfilePoint b;   b.fc = 3; b.count = 3; b.type = PointType::Uint16;   /* 3 */
    ProfilePoint c;   c.fc = 1; c.count = 4; c.type = PointType::Bool;     /* 4 */
    ProfilePoint d;   d.fc = 6; d.count = 9; d.type = PointType::Uint16;   /* 0 */
    prof.points = {a, b, c, d};
    EXPECT_EQ(ext_slots_for_profile(prof), 8u);   /* lỗi cũ sẽ ra 2+3+4+9 = 18 */
}

/* `ISS-PIO-22` — parser phải mang `poll_group`/`stale_after_ms` tới
 * `ProfilePoint`. Không mang thì hai trường chỉ là chữ trong tệp cấu hình, và
 * người vận hành đặt `slow` cho một điểm cấu hình sẽ tin rằng đã tiết kiệm được
 * băng thông RS-485 trong khi không có gì đổi. */
TEST_F(ProfileTest, ParsesPollGroupAndStaleAfterMs)
{
    write_profile(R"json({"points":[
        {"name":"config","fc":3,"addr":0,"count":1,"type":"uint16",
         "poll_group":"slow","stale_after_ms":45000}
    ]})json");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_EQ(prof.points[0].poll_group, PollGroup::Slow);
    EXPECT_EQ(prof.points[0].stale_after_ms, 45000u);
}

/* Khoá vắng ⇒ mặc định `normal`/`0`, tức hành vi trước bản vá. Lệch mặc định ở
 * đây là đổi nhịp poll của MỌI bo đang chạy khi nâng cấp firmware. */
TEST_F(ProfileTest, PollGroupDefaultsKeepLegacyBehaviour)
{
    write_profile(R"json({"points":[
        {"name":"a","fc":3,"addr":0,"count":1,"type":"uint16"}
    ]})json");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points[0].poll_group, PollGroup::Normal);
    EXPECT_EQ(prof.points[0].stale_after_ms, 0u);
}

/* Nhóm lạ rơi về `normal` — nhưng KHÔNG im lặng: xem cảnh báo trong parser. */
TEST_F(ProfileTest, UnknownPollGroupFallsBackToNormal)
{
    write_profile(R"json({"points":[
        {"name":"a","fc":3,"addr":0,"count":1,"type":"uint16","poll_group":"cuc-nhanh"}
    ]})json");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points[0].poll_group, PollGroup::Normal);
}
