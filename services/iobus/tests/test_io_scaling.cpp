/**
 * @file  test_io_scaling.cpp
 * @brief Bảng test case bắt buộc 06 §3.6, sai số ±1%.
 */
#include <gtest/gtest.h>

#include "io/io_scaling.hpp"

using namespace iobus;

namespace {
/* helper: đóng s24 dương vào uint24 (như IO_RESP) */
uint32_t u24(int32_t v) { return static_cast<uint32_t>(v) & 0xFFFFFF; }
}

TEST(IoScaling, Volt0_10)
{
    kx_quality_t q;
    EXPECT_FLOAT_EQ(ui_to_eng(u24(0), SensorType::V0_10, &q), 0.0f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(u24(8388607), SensorType::V0_10, &q), 10.0f, 0.1f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(u24(4194304), SensorType::V0_10, &q), 5.0f, 0.05f);  /* ±1% */
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, Ma4_20)
{
    kx_quality_t q;
    EXPECT_NEAR(ui_to_eng(u24(0), SensorType::MA4_20, &q), 4.0f, 0.04f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(u24(8388607), SensorType::MA4_20, &q), 20.0f, 0.2f);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, UiOverrangeIsBad)
{
    /* Case chuẩn 06 §3.6: raw=9300000 (>110%FS) → BAD.
     * 9300000 không vừa s24 dương → wrap thành s24 âm sâu (< -2%FS) → BAD. */
    kx_quality_t q;
    ui_to_eng(9300000u & 0xFFFFFFu, SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    /* đứt loop 4-20mA: raw âm sâu → mA < 3.5 → BAD */
    ui_to_eng(u24(-4194304), SensorType::MA4_20, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    /* raw=-1 → ~4.0mA → vẫn GOOD (sát biên không phải đứt loop) */
    ui_to_eng(0xFFFFFFu, SensorType::MA4_20, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, DryContact)
{
    kx_quality_t q;
    EXPECT_FLOAT_EQ(ui_to_eng(u24(8000000), SensorType::DRY_CONTACT, &q), 1.0f);
    EXPECT_FLOAT_EQ(ui_to_eng(u24(100), SensorType::DRY_CONTACT, &q), 0.0f);
}

TEST(IoScaling, UnknownTypeIsBad)
{
    kx_quality_t q;
    ui_to_eng(u24(123), SensorType::UNKNOWN, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, AoEngToRawTable)
{
    /* 5.0V→32767±1; 12V→65535 clamp; -1V→0 clamp; 4mA→0; 20mA→65535 */
    EXPECT_NEAR(ao_eng_to_raw(5.0f, AoMode::V0_10), 32767, 1);
    EXPECT_EQ(ao_eng_to_raw(12.0f, AoMode::V0_10), 65535);
    EXPECT_EQ(ao_eng_to_raw(-1.0f, AoMode::V0_10), 0);
    EXPECT_EQ(ao_eng_to_raw(4.0f, AoMode::MA4_20), 0);
    EXPECT_EQ(ao_eng_to_raw(20.0f, AoMode::MA4_20), 65535);
}

TEST(IoScaling, SensorTypeFromString)
{
    EXPECT_EQ(sensor_type_from_string("0-10V"), SensorType::V0_10);
    EXPECT_EQ(sensor_type_from_string("4-20mA"), SensorType::MA4_20);
    EXPECT_EQ(sensor_type_from_string("PT100"), SensorType::PT100);
    EXPECT_EQ(sensor_type_from_string("dry-contact"), SensorType::DRY_CONTACT);
    EXPECT_EQ(sensor_type_from_string("xyz"), SensorType::UNKNOWN);
}
