/**
 * @file  test_iobus_config.cpp
 * @brief Gap #3 (iobus) analysis report: test load_config() — hợp lệ, thiếu file,
 *        thiếu field, JSON hỏng (fail-fast), sensor_type lạ, ao mode.
 */
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <string>

#include <unistd.h>

#include "config/iobus_config.hpp"

using namespace iobus;

namespace {

class TempConfig {
public:
    explicit TempConfig(const std::string& content)
    {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "/tmp/iobus-cfg-test-%d-%d.json", getpid(), counter_++);
        path_ = buf;
        std::ofstream f(path_);
        f << content;
    }
    ~TempConfig() { ::unlink(path_.c_str()); }
    const std::string& path() const { return path_; }

private:
    std::string path_;
    static int counter_;
};

int TempConfig::counter_ = 0;

} // namespace

TEST(IobusConfig, ValidFullConfig)
{
    TempConfig f(R"({
      "iop": {
        "uart_device": "/dev/ttyUSB7",
        "baud": 921600,
        "poll_period_ms": 20,
        "response_timeout_ms": 15,
        "max_retry": 5,
        "reconnect_interval_ms": 3000,
        "handshake_timeout_ms": 500
      },
      "ui": [
        { "id": "UI1", "sensor_type": "4-20mA", "unit": "mA" },
        { "id": "UI2", "sensor_type": "NTC10K", "unit": "degC" }
      ],
      "ao": [
        { "id": "AO1", "mode": "0-10V" },
        { "id": "AO2", "mode": "4-20mA" }
      ],
      "log_level": "debug",
      "rt_priority": 50
    })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg));
    EXPECT_EQ(cfg.uart_device, "/dev/ttyUSB7");
    EXPECT_EQ(cfg.poll_period_ms, 20u);
    EXPECT_EQ(cfg.response_timeout_ms, 15u);
    EXPECT_EQ(cfg.max_retry, 5u);
    EXPECT_EQ(cfg.reconnect_interval_ms, 3000u);
    EXPECT_EQ(cfg.handshake_timeout_ms, 500u);
    EXPECT_EQ(cfg.log_level, "debug");
    EXPECT_EQ(cfg.rt_priority, 50);
    EXPECT_EQ(cfg.ui_sensor[0], SensorType::MA4_20);
    EXPECT_EQ(cfg.ui_sensor[1], SensorType::NTC10K);
    EXPECT_EQ(cfg.ao_mode[0], AoMode::V0_10);
    EXPECT_EQ(cfg.ao_mode[1], AoMode::MA4_20);
}

TEST(IobusConfig, MissingFileUsesDefaults)
{
    IobusConfig cfg;
    ASSERT_TRUE(load_config("/tmp/khong-ton-tai-12345.json", false, &cfg));
    EXPECT_EQ(cfg.uart_device, "/dev/ttyS2");
    EXPECT_EQ(cfg.baud, static_cast<int>(IOP_BAUD));
    EXPECT_EQ(cfg.poll_period_ms, IOP_GET_IO_PERIOD_MS);
}

TEST(IobusConfig, MissingFileFailsWhenMustExist)
{
    IobusConfig cfg;
    EXPECT_FALSE(load_config("/tmp/khong-ton-tai-12345.json", true, &cfg));
}

TEST(IobusConfig, MissingFieldsFallBackToDefaults)
{
    TempConfig f(R"({ "iop": { "uart_device": "/dev/ttyS9" } })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg));
    EXPECT_EQ(cfg.uart_device, "/dev/ttyS9");
    EXPECT_EQ(cfg.baud, static_cast<int>(IOP_BAUD));   /* default */
    EXPECT_EQ(cfg.max_retry, IOP_MAX_RETRY);
}

TEST(IobusConfig, MalformedJsonFailsFast)
{
    TempConfig f(R"({ "iop": { "uart_device": "/dev/ttyS2" )");   /* thiếu ngoặc đóng */
    IobusConfig cfg;
    EXPECT_FALSE(load_config(f.path(), true, &cfg)) << "JSON hỏng → fail-fast (06 §4)";

    TempConfig f2("khong phai json");
    EXPECT_FALSE(load_config(f2.path(), true, &cfg));
}

TEST(IobusConfig, UnknownSensorTypeMarked)
{
    TempConfig f(R"({ "ui": [ { "id": "UI1", "sensor_type": "tu-che-9000" } ] })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg)) << "service VẪN chạy (06 §4)";
    EXPECT_EQ(cfg.ui_sensor[0], SensorType::UNKNOWN) << "kênh đó quality=BAD khi scale";
}

TEST(IobusConfig, BaudOverrideAllowedWithWarn)
{
    TempConfig f(R"({ "iop": { "baud": 115200 } })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg));
    EXPECT_EQ(cfg.baud, 115200) << "dev mode cho phép override (06 §4)";
}
