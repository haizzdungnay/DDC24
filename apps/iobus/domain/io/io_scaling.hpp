/**
 * @file  io_scaling.hpp
 * @brief Raw int32 (IOP v2 signed) ↔ engineering theo sensor_type; eng → raw AO.
 *        PT100/PT1000: code còn nhưng Rev A hardware không lắp — quality = BAD.
 */
#ifndef IOBUS_IO_SCALING_HPP
#define IOBUS_IO_SCALING_HPP

#include "io/io_types.hpp"

namespace iobus {

/* Full-scale dương của s24 */
constexpr float IO_S24_FS = 8388607.0f;
/* Rev A UI transfer source: hardware-design/03_io_subsystem/IO_UI_CIRCUIT.md. */
constexpr float IO_ADC_VREF_V   = 2.44f;   /* ADS131M08 VREF */
constexpr float IO_ADC_PGA_GAIN = 1.0f;    /* PGA gain -> FSR = +/-VREF */
constexpr float IO_UI_DIV_GAIN  = 9.2645f; /* (100k + 12.1k) / 12.1k */
constexpr float IO_UI_SHUNT_OHM = 49.9f;   /* 4-20mA precision shunt */

inline float adc_volts(int32_t raw_s32)
{
    return (static_cast<float>(raw_s32) / IO_S24_FS) * (IO_ADC_VREF_V / IO_ADC_PGA_GAIN);
}

SensorType  sensor_type_from_string(const char* s);
const char* sensor_unit(SensorType t);   /* "V","mA","degC","" */
const char* sensor_raw_unit(SensorType t); /* "V","mA" or "" when not applicable */

/* raw int32 signed (IOP v2 — iop_be32s() đã sign-extend) → eng + quality. */
float ui_raw_electric(int32_t raw_s32, SensorType t);
float ui_raw_electric(int32_t raw_s32, const UiScaleConfig& cfg);
float ui_to_eng(int32_t raw_s32, SensorType t, kx_quality_t* q_out);
float ui_to_eng(int32_t raw_s32, const UiScaleConfig& cfg, kx_quality_t* q_out);

/* Overloads với reliability output (ADR-011): ghi nguyên nhân lỗi cụ thể thay vì chỉ BAD. */
float ui_to_eng(int32_t raw_s32, SensorType t, kx_quality_t* q_out, kx_reliability_t* r_out);
float ui_to_eng(int32_t raw_s32, const UiScaleConfig& cfg, kx_quality_t* q_out, kx_reliability_t* r_out);

/* eng (V hoặc mA theo mode) → raw DAC 16-bit, clamp [0,65535]. */
uint16_t ao_eng_to_raw(float v, AoMode m);

} // namespace iobus

#endif /* IOBUS_IO_SCALING_HPP */
