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
    EXPECT_EQ(cfg.ui[0].sensor, SensorType::MA4_20);
    EXPECT_EQ(cfg.ui[1].sensor, SensorType::NTC10K);
    EXPECT_EQ(cfg.ao_mode[0], AoMode::V0_10);
    EXPECT_EQ(cfg.ao_mode[1], AoMode::MA4_20);
}

TEST(IobusConfig, AoBacnetPropertiesParseAndDefaultByMode)
{
    TempConfig f(R"({
      "ao": [
        {"ch":1,"name":"CW VALVE","mode":"0-10V","units":"percent","min_pv":0,"max_pv":100},
        {"ch":2,"mode":"4-20mA"}
      ]
    })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg));
    EXPECT_EQ(cfg.ao_channels[0].name, "CW VALVE");
    EXPECT_EQ(cfg.ao_channels[0].units_str, "percent");
    EXPECT_FLOAT_EQ(cfg.ao_channels[0].min_pv, 0.0f);
    EXPECT_FLOAT_EQ(cfg.ao_channels[0].max_pv, 100.0f);
    EXPECT_EQ(cfg.ao_channels[0].mode, AoMode::V0_10);
    EXPECT_EQ(cfg.ao_channels[1].mode, AoMode::MA4_20);
    EXPECT_EQ(cfg.ao_channels[1].units_str, "milliampere");
    EXPECT_FLOAT_EQ(cfg.ao_channels[1].min_pv, 4.0f);
    EXPECT_FLOAT_EQ(cfg.ao_channels[1].max_pv, 20.0f);
    EXPECT_EQ(cfg.ao_channels[2].name, "AO3");
    EXPECT_EQ(cfg.ao_channels[2].units_str, "volt");
    EXPECT_FLOAT_EQ(cfg.ao_channels[2].max_pv, 10.0f);
}

TEST(IobusConfig, MissingFileHasUsableAoDefaults)
{
    IobusConfig cfg;
    ASSERT_TRUE(load_config("/tmp/khong-ton-tai-ao-defaults.json", false, &cfg));
    for (int i = 0; i < KX_N_AO; ++i) {
        EXPECT_EQ(cfg.ao_channels[i].units_str, "volt");
        EXPECT_FLOAT_EQ(cfg.ao_channels[i].min_pv, 0.0f);
        EXPECT_FLOAT_EQ(cfg.ao_channels[i].max_pv, 10.0f);
    }
}

TEST(IobusConfig, InvalidAoBacnetPropertiesFailFast)
{
    TempConfig bad_range(R"({"ao":[{"ch":1,"mode":"0-10V","min_pv":100,"max_pv":0}]})");
    IobusConfig cfg;
    EXPECT_FALSE(load_config(bad_range.path(), true, &cfg));

    TempConfig bad_units(R"({"ao":[{"ch":1,"mode":"0-10V","units":"bananas"}]})");
    EXPECT_FALSE(load_config(bad_units.path(), true, &cfg));
}

TEST(IobusConfig, WebIoConfigMapsEasySetU0ToU7)
{
    TempConfig f(R"({
      "ui": [
        {
          "ch": 16,
          "type": "potentiometer",
          "unit": "percent",
          "enabled": true,
          "invert": false,
          "scale_lo": -5,
          "scale_hi": 205,
          "range_mult": 4,
          "filter_samples": 7,
          "sensor_cal": -0.5,
          "math_func": 3,
          "cal_gain": 1.01,
          "cal_offset": -0.02
        }
      ],
      "ao": [ { "ch": 4, "mode": "4-20mA" } ]
    })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg));
    EXPECT_EQ(cfg.ui[15].sensor, SensorType::POTENTIOMETER);
    EXPECT_EQ(cfg.ui[15].unit, "percent");
    EXPECT_FLOAT_EQ(cfg.ui[15].scale_lo, -5.0f);
    EXPECT_FLOAT_EQ(cfg.ui[15].scale_hi, 205.0f);
    EXPECT_EQ(cfg.ui[15].range_mult, 4);
    EXPECT_EQ(cfg.ui[15].filter_samples, 7);
    EXPECT_FLOAT_EQ(cfg.ui[15].sensor_cal, -0.5f);
    EXPECT_EQ(cfg.ui[15].math_func, 3);
    EXPECT_FLOAT_EQ(cfg.ui[15].cal_gain, 1.01f);
    EXPECT_FLOAT_EQ(cfg.ui[15].cal_offset, -0.02f);
    EXPECT_EQ(cfg.ao_mode[3], AoMode::MA4_20);
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
    EXPECT_EQ(cfg.ui[0].sensor, SensorType::UNKNOWN) << "kênh đó quality=BAD khi scale";
}

TEST(IobusConfig, SparseIdEntriesMapToCorrectChannel)
{
    /* review PR#12: parser cũ positional mù → config sparse lệch kênh.
     * Giờ phải theo "id":"AO<n>"/"UI<n>". */
    TempConfig f(R"({
      "ui": [ { "id": "UI3", "sensor_type": "4-20mA" } ],
      "ao": [ { "id": "AO2", "mode": "4-20mA" } ]
    })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg));
    EXPECT_EQ(cfg.ui[2].sensor, SensorType::MA4_20) << "UI3 → index 2";
    EXPECT_EQ(cfg.ui[0].sensor, SensorType::V0_10) << "UI1 không khai → default";
    EXPECT_EQ(cfg.ao_mode[1], AoMode::MA4_20) << "AO2 → index 1";
    EXPECT_EQ(cfg.ao_mode[0], AoMode::V0_10) << "AO1 không khai → default";
}

TEST(IobusConfig, BaudOverrideAllowedWithWarn)
{
    TempConfig f(R"({ "iop": { "baud": 115200 } })");
    IobusConfig cfg;
    ASSERT_TRUE(load_config(f.path(), true, &cfg));
    EXPECT_EQ(cfg.baud, 115200) << "dev mode cho phép override (06 §4)";
}

TEST(IobusConfig, ReloadConfigSafeUpdatesSafeFields)
{
    IobusConfig cfg;
    cfg.poll_period_ms = 10;
    cfg.log_level = "info";

    TempConfig f(R"({
      "iop": {
        "poll_period_ms": 50,
        "max_retry": 4
      },
      "log_level": "debug"
    })");

    ASSERT_TRUE(reload_config_safe(f.path(), true, cfg, "", ""));
    EXPECT_EQ(cfg.poll_period_ms, 50u);
    EXPECT_EQ(cfg.max_retry, 4u);
    EXPECT_EQ(cfg.log_level, "debug");
}

TEST(IobusConfig, ReloadConfigSafeWarnsOnDangerousFieldsAndKeepsOld)
{
    IobusConfig cfg;
    cfg.uart_device = "/dev/ttyS2";
    cfg.baud = 921600;
    cfg.poll_period_ms = 10;

    TempConfig f(R"({
      "iop": {
        "uart_device": "/dev/ttyS9",
        "baud": 115200,
        "poll_period_ms": 30
      }
    })");

    ASSERT_TRUE(reload_config_safe(f.path(), true, cfg, "", ""));
    EXPECT_EQ(cfg.uart_device, "/dev/ttyS2"); // Kept old dangerous field
    EXPECT_EQ(cfg.baud, 921600);              // Kept old dangerous field
    EXPECT_EQ(cfg.poll_period_ms, 30u);         // Updated safe field
}

TEST(IobusConfig, ReloadAoModeChangeRequiresRestart)
{
    IobusConfig cfg;
    cfg.ao_mode[0] = AoMode::V0_10;
    cfg.ao_channels[0].mode = AoMode::V0_10;

    TempConfig f(R"({ "ao": [ {"ch":1,"mode":"4-20mA"} ] })");
    ASSERT_TRUE(reload_config_safe(f.path(), true, cfg, "", ""));
    EXPECT_EQ(cfg.ao_mode[0], AoMode::V0_10);
    EXPECT_EQ(cfg.ao_channels[0].mode, AoMode::V0_10);
}

TEST(IobusConfig, ReloadConfigSafeFailsOnBadJsonAndKeepsOld)
{
    IobusConfig cfg;
    cfg.poll_period_ms = 10;
    cfg.log_level = "info";

    TempConfig f(R"({
      "iop": {
        "poll_period_ms": 50,
    )"); // Malformed JSON

    ASSERT_FALSE(reload_config_safe(f.path(), true, cfg, "", ""));
    EXPECT_EQ(cfg.poll_period_ms, 10u); // Unchanged
    EXPECT_EQ(cfg.log_level, "info");   // Unchanged
}
