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

TEST_F(ProfileTest, Float32MissingByteOrderRejected)
{
    write_profile(R"({"points":[{"name":"x","fc":4,"addr":0,"count":2,"type":"float32"}]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    EXPECT_EQ(prof.points.size(), 0u);
}

TEST_F(ProfileTest, ExposeBacnetFields)
{
    write_profile(R"({"points":[
      {"name":"kWh","fc":4,"addr":1000,"count":2,"type":"float32",
       "byte_order":"ABCD","expose_bacnet":true,"bacnet_object_type":"AV","bacnet_instance":100}
    ]})");
    DeviceProfile prof;
    ASSERT_TRUE(load_device_profile(tmp_path, &prof));
    ASSERT_EQ(prof.points.size(), 1u);
    EXPECT_TRUE(prof.points[0].expose_bacnet);
    EXPECT_EQ(prof.points[0].bacnet_object_type, "AV");
    EXPECT_EQ(prof.points[0].bacnet_instance, 100u);
}

TEST_F(ProfileTest, FileNotFound)
{
    DeviceProfile prof;
    EXPECT_FALSE(load_device_profile("/tmp/nonexistent_profile.json", &prof));
}
