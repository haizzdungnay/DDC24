/**
 * @file  test_io_scaling.cpp
 * @brief Scaling tests: ADS131M08 signed raw -> UI engineering/raw-electric.
 */
#include <gtest/gtest.h>

#include <cmath>
#include <cstdint>

#include "io/io_scaling.hpp"

using namespace iobus;

namespace {

int32_t raw_from_adc(float v_adc)
{
    return static_cast<int32_t>(std::lround((v_adc / IO_ADC_VREF_V) * IO_S24_FS));
}

int32_t raw_from_field_v(float v_field)
{
    return raw_from_adc(v_field / IO_UI_DIV_GAIN);
}

int32_t raw_from_ma(float ma)
{
    return raw_from_adc((ma / 1000.0f) * IO_UI_SHUNT_OHM);
}

} // namespace

TEST(IoScaling, Volt0_10UsesDividerTransfer)
{
    kx_quality_t q;
    EXPECT_FLOAT_EQ(ui_to_eng(0, SensorType::V0_10, &q), 0.0f);
    EXPECT_EQ(q, KX_Q_GOOD);

    const int32_t raw_10v = raw_from_field_v(10.0f);
    EXPECT_NEAR(adc_volts(raw_10v), 10.0f / IO_UI_DIV_GAIN, 0.001f);
    EXPECT_NEAR(ui_to_eng(raw_10v, SensorType::V0_10, &q), 10.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(raw_from_field_v(5.0f), SensorType::V0_10, &q), 5.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, AdcFullScaleIsNotFieldFullScale)
{
    kx_quality_t q;
    const float v = ui_to_eng(static_cast<int32_t>(IO_S24_FS), SensorType::V0_10, &q);
    EXPECT_NEAR(v, IO_ADC_VREF_V * IO_UI_DIV_GAIN, 0.02f);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, Volt2_10QualityUsesFieldVolts)
{
    kx_quality_t q;
    EXPECT_NEAR(ui_to_eng(raw_from_field_v(2.0f), SensorType::V2_10, &q), 2.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);

    EXPECT_NEAR(ui_to_eng(raw_from_field_v(10.0f), SensorType::V2_10, &q), 10.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);

    ui_to_eng(raw_from_field_v(1.7f), SensorType::V2_10, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, Ma4_20UsesShuntTransfer)
{
    kx_quality_t q;
    EXPECT_NEAR(ui_to_eng(raw_from_ma(4.0f), SensorType::MA4_20, &q), 4.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);

    const int32_t raw_20ma = raw_from_ma(20.0f);
    EXPECT_NEAR(adc_volts(raw_20ma), 0.998f, 0.001f);
    EXPECT_NEAR(ui_to_eng(raw_20ma, SensorType::MA4_20, &q), 20.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);
}

TEST(IoScaling, RawElectricValueAndUnit)
{
    EXPECT_NEAR(ui_raw_electric(raw_from_field_v(10.0f), SensorType::V0_10), 10.0f, 0.02f);
    EXPECT_STREQ(sensor_raw_unit(SensorType::V0_10), "V");

    EXPECT_NEAR(ui_raw_electric(raw_from_ma(20.0f), SensorType::MA4_20), 20.0f, 0.02f);
    EXPECT_STREQ(sensor_raw_unit(SensorType::MA4_20), "mA");

    EXPECT_NEAR(ui_raw_electric(raw_from_adc(1.65f), SensorType::NTC10K), 1.65f, 0.001f);
    EXPECT_STREQ(sensor_raw_unit(SensorType::NTC10K), "V");

    EXPECT_FLOAT_EQ(ui_raw_electric(8000000, SensorType::DRY_CONTACT), 0.0f);
    EXPECT_STREQ(sensor_raw_unit(SensorType::DRY_CONTACT), "");
    EXPECT_STREQ(sensor_unit(SensorType::DRY_CONTACT), "bool");
}

TEST(IoScaling, UiOverrangeIsBad)
{
    kx_quality_t q;
    ui_to_eng(raw_from_field_v(11.2f), SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    ui_to_eng(raw_from_field_v(-0.3f), SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    ui_to_eng(raw_from_ma(3.4f), SensorType::MA4_20, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    ui_to_eng(raw_from_ma(21.5f), SensorType::MA4_20, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, DryContact)
{
    kx_quality_t q;
    EXPECT_FLOAT_EQ(ui_to_eng(8000000, SensorType::DRY_CONTACT, &q), 1.0f);
    EXPECT_FLOAT_EQ(ui_to_eng(100,     SensorType::DRY_CONTACT, &q), 0.0f);
}

TEST(IoScaling, Pt100Pt1000RevAAlwaysBad)
{
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
    kx_quality_t q;
    ui_to_eng(raw_from_field_v(-0.3f), SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    const float v = ui_to_eng(-1, SensorType::V0_10, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(v, 0.0f, 0.01f);
}

TEST(IoScaling, Ntc10kAt25C)
{
    kx_quality_t q;
    const float t = ui_to_eng(raw_from_adc(1.65f), SensorType::NTC10K, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(t, 25.0f, 0.2f);
}

TEST(IoScaling, Ntc20kAt25C)
{
    kx_quality_t q;
    const float t = ui_to_eng(raw_from_adc(1.65f), SensorType::NTC20K, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(t, 25.0f, 0.2f);
}

TEST(IoScaling, NtcBrokenWireIsBad)
{
    kx_quality_t q;
    ui_to_eng(0, SensorType::NTC10K, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    ui_to_eng(-100000, SensorType::NTC10K, &q);
    EXPECT_EQ(q, KX_Q_BAD);

    ui_to_eng(0, SensorType::NTC20K, &q);
    EXPECT_EQ(q, KX_Q_BAD);
}

TEST(IoScaling, Ntc10kOutOfRangeIsBad)
{
    kx_quality_t q;
    ui_to_eng(raw_from_adc(0.05f), SensorType::NTC10K, &q);
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

TEST(IoScaling, ReliabilityOverloadPreservesHardwareTransfer)
{
    kx_quality_t q;
    kx_reliability_t r;
    EXPECT_NEAR(ui_to_eng(raw_from_field_v(10.0f), SensorType::V0_10, &q, &r), 10.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_EQ(r, KX_REL_RELIABLE);
    EXPECT_NEAR(ui_to_eng(raw_from_ma(20.0f), SensorType::MA4_20, &q, &r), 20.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_EQ(r, KX_REL_RELIABLE);
}

TEST(IoScaling, ReliabilityFaultMapping)
{
    kx_quality_t q;
    kx_reliability_t r;

    ui_to_eng(0, SensorType::NONE, &q, &r);
    EXPECT_EQ(r, KX_REL_CONFIGURATION_ERROR);
    ui_to_eng(raw_from_field_v(11.2f), SensorType::V0_10, &q, &r);
    EXPECT_EQ(r, KX_REL_OVER_RANGE);
    ui_to_eng(raw_from_field_v(1.7f), SensorType::V2_10, &q, &r);
    EXPECT_EQ(r, KX_REL_UNDER_RANGE);
    ui_to_eng(raw_from_ma(3.4f), SensorType::MA4_20, &q, &r);
    EXPECT_EQ(r, KX_REL_OPEN_LOOP);
    ui_to_eng(raw_from_ma(21.5f), SensorType::MA4_20, &q, &r);
    EXPECT_EQ(r, KX_REL_SHORTED_LOOP);
    ui_to_eng(-1, SensorType::PULSE, &q, &r);
    EXPECT_EQ(r, KX_REL_UNRELIABLE_OTHER);
}

TEST(IoScaling, ReliabilityConfiguredPathPreservesCalibration)
{
    UiScaleConfig cfg;
    cfg.sensor = SensorType::V0_10;
    cfg.scale_lo = 0.0f;
    cfg.scale_hi = 10.0f;
    cfg.cal_gain = 2.0f;
    cfg.cal_offset = 1.0f;

    kx_quality_t q;
    kx_reliability_t r;
    EXPECT_NEAR(ui_to_eng(raw_from_field_v(4.0f), cfg, &q, &r), 9.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_EQ(r, KX_REL_RELIABLE);
}

TEST(IoScaling, AoEngineeringRangeMapsToPhysicalOutput)
{
    EXPECT_NEAR(ao_eng_to_raw_phys(50.0f, 0.0f, 100.0f, AoMode::V0_10), 32768, 1);
    EXPECT_NEAR(ao_eng_to_raw_phys(50.0f, 0.0f, 100.0f, AoMode::MA4_20), 32768, 1);
    EXPECT_EQ(ao_eng_to_raw_phys(-10.0f, 0.0f, 100.0f, AoMode::V0_10), 0);
    EXPECT_EQ(ao_eng_to_raw_phys(110.0f, 0.0f, 100.0f, AoMode::V0_10), 65535);
}

TEST(IoScaling, SensorTypeFromString)
{
    EXPECT_EQ(sensor_type_from_string("0-10V"),      SensorType::V0_10);
    EXPECT_EQ(sensor_type_from_string("2-10V"),      SensorType::V2_10);
    EXPECT_EQ(sensor_type_from_string("4-20mA"),     SensorType::MA4_20);
    EXPECT_EQ(sensor_type_from_string("PT100"),      SensorType::PT100);
    EXPECT_EQ(sensor_type_from_string("NTC10k"),     SensorType::NTC10K);
    EXPECT_EQ(sensor_type_from_string("potentiometer"), SensorType::POTENTIOMETER);
    EXPECT_EQ(sensor_type_from_string("dry-contact"),SensorType::DRY_CONTACT);
    EXPECT_EQ(sensor_type_from_string("xyz"),        SensorType::UNKNOWN);
}

TEST(IoScaling, ConfiguredEasySetScaleCalibrationAndRangeMultiplier)
{
    UiScaleConfig cfg;
    cfg.sensor = SensorType::V0_10;
    cfg.scale_lo = 0.0f;
    cfg.scale_hi = 100.0f;
    cfg.range_mult = 1;
    cfg.sensor_cal = 2.0f;

    kx_quality_t q;
    const float value = ui_to_eng(raw_from_field_v(5.0f), cfg, &q);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(value, 502.0f, 1.0f);
}

TEST(IoScaling, ConfiguredTwoPointCalibrationHook)
{
    UiScaleConfig cfg;
    cfg.sensor = SensorType::V0_10;
    cfg.scale_lo = 0.0f;
    cfg.scale_hi = 10.0f;

    kx_quality_t q;
    EXPECT_NEAR(ui_to_eng(raw_from_field_v(4.0f), cfg, &q), 4.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);

    cfg.cal_gain = 2.0f;
    cfg.cal_offset = 1.0f;
    EXPECT_NEAR(ui_to_eng(raw_from_field_v(4.0f), cfg, &q), 9.0f, 0.02f);
    EXPECT_EQ(q, KX_Q_GOOD);
    EXPECT_NEAR(ui_raw_electric(raw_from_field_v(4.0f), cfg), 9.0f, 0.02f);
}

TEST(IoScaling, ConfiguredDryContactInvert)
{
    UiScaleConfig cfg;
    cfg.sensor = SensorType::DRY_CONTACT;
    cfg.invert = true;

    kx_quality_t q;
    EXPECT_FLOAT_EQ(ui_to_eng(8000000, cfg, &q), 0.0f);
    EXPECT_EQ(q, KX_Q_GOOD);
}
