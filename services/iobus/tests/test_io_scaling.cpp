/**
 * @file  test_io_scaling.cpp
 * @brief Scaling tests: ui_to_eng(int32_t raw_s32, ...) — IOP v2 signed input.
 */
#include <gtest/gtest.h>

#include "io/io_scaling.hpp"

using namespace iobus;

TEST(IoScaling, Volt0_10)
{
    kx_quality_t q;
    EXPECT_FLOAT_EQ(ui_to_eng(0, SensorType::V0_10, &q), 0.0f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(8388607, SensorType::V0_10, &q), 10.0f, 0.1f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(4194304, SensorType::V0_10, &q), 5.0f, 0.05f);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, Ma4_20)
{
    kx_quality_t q;
    EXPECT_NEAR(ui_to_eng(0, SensorType::MA4_20, &q), 4.0f, 0.04f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(8388607, SensorType::MA4_20, &q), 20.0f, 0.2f);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, UiOverrangeIsBad)
{
    kx_quality_t q;
    /* raw=9300000 > 110%FS (8388607*1.10=9227467) → BAD */
    ui_to_eng(9300000, SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    /* raw=-4194304: mA=4+(-0.5*16)=-4.0 < 3.5 → broken loop → BAD */
    ui_to_eng(-4194304, SensorType::MA4_20, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    /* raw=-1: frac≈0, mA≈4.0 → GOOD (not a broken loop) */
    ui_to_eng(-1, SensorType::MA4_20, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, DryContact)
{
    kx_quality_t q;
    EXPECT_FLOAT_EQ(ui_to_eng(8000000, SensorType::DRY_CONTACT, &q), 1.0f);
    EXPECT_FLOAT_EQ(ui_to_eng(100,     SensorType::DRY_CONTACT, &q), 0.0f);
}

TEST(IoScaling, Pt100Pt1000RevAAlwaysBad)
{
    /* Rev A: circuit not populated — must return BAD regardless of input */
    kx_quality_t q;
    ui_to_eng(4000000, SensorType::PT100,  &q);
    EXPECT_EQ(q, KX_Q_BAD);
    ui_to_eng(4000000, SensorType::PT1000, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, UnknownTypeIsBad)
{
    kx_quality_t q;
    ui_to_eng(123, SensorType::UNKNOWN, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, NegativeRawValid)
{
    /* IOP v2: negative raw_s32 is valid (ADS131M08 bidirectional) */
    kx_quality_t q;
    /* -8388608 = min s24: frac = -1.0 → V = -10V → BAD (< -2%FS) */
    ui_to_eng(-8388608, SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    /* raw = -1: frac ≈ 0 → V ≈ 0V → GOOD */
    const float v = ui_to_eng(-1, SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(v, 0.0f, 0.01f);
}

TEST(IoScaling, Ntc10kAt25C)
{
    /* r_from_raw: r = (raw/FS) * 2 * r_nominal
     * raw = FS/2 = 4194304 → r = 1.0 * 10000 = R0 → Steinhart-Hart ≈ 25°C */
    kx_quality_t q;
    const float t = ui_to_eng(4194304, SensorType::NTC10K, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(t, 25.0f, 1.5f);   /* tolerance: SH coeffs for generic NTC */
}

TEST(IoScaling, Ntc20kAt10C)
{
    /* raw=4194304 → r=(0.5)*2*20000=20000Ω; SH(20kΩ,same coeffs) ≈ 9.94°C.
     * SH_A/B/C are calibrated for a ~10kΩ NTC curve; NTC20K uses same
     * coefficients with scaled r_nominal — gives ~10°C at half-scale. */
    kx_quality_t q;
    const float t = ui_to_eng(4194304, SensorType::NTC20K, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(t, 10.0f, 1.5f);
}

TEST(IoScaling, NtcBrokenWireIsBad)
{
    /* raw=0 → r=0 → ntc_resolve_temp(0) returns NAN → BAD */
    kx_quality_t q;
    ui_to_eng(0, SensorType::NTC10K, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    /* raw<0 → r<0 → NAN → BAD (reverse-biased / shorted) */
    ui_to_eng(-100000, SensorType::NTC10K, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    ui_to_eng(0, SensorType::NTC20K, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, Ntc10kOutOfRangeIsBad)
{
    /* raw=1 → r very small → very high temp → > 70°C → BAD */
    kx_quality_t q;
    ui_to_eng(1, SensorType::NTC10K, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, AoEngToRawTable)
{
    EXPECT_NEAR(ao_eng_to_raw(5.0f, AoMode::V0_10), 32767, 1);
    EXPECT_EQ(ao_eng_to_raw(12.0f, AoMode::V0_10), 65535);
    EXPECT_EQ(ao_eng_to_raw(-1.0f, AoMode::V0_10), 0);
    EXPECT_EQ(ao_eng_to_raw(4.0f, AoMode::MA4_20), 0);
    EXPECT_EQ(ao_eng_to_raw(20.0f, AoMode::MA4_20), 65535);
}

TEST(IoScaling, SensorTypeFromString)
{
    EXPECT_EQ(sensor_type_from_string("0-10V"),      SensorType::V0_10);
    EXPECT_EQ(sensor_type_from_string("4-20mA"),     SensorType::MA4_20);
    EXPECT_EQ(sensor_type_from_string("PT100"),      SensorType::PT100);
    EXPECT_EQ(sensor_type_from_string("dry-contact"),SensorType::DRY_CONTACT);
    EXPECT_EQ(sensor_type_from_string("xyz"),        SensorType::UNKNOWN);
}
