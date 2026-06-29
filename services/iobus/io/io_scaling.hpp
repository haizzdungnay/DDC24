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

SensorType  sensor_type_from_string(const char* s);
const char* sensor_unit(SensorType t);   /* "V","mA","degC","" */

/* raw int32 signed (IOP v2 — iop_be32s() đã sign-extend) → eng + quality. */
float ui_to_eng(int32_t raw_s32, SensorType t, kx_quality_t* q_out);
float ui_to_eng(int32_t raw_s32, const UiScaleConfig& cfg, kx_quality_t* q_out);

/* eng (V hoặc mA theo mode) → raw DAC 16-bit, clamp [0,65535]. */
uint16_t ao_eng_to_raw(float v, AoMode m);

} // namespace iobus

#endif /* IOBUS_IO_SCALING_HPP */
