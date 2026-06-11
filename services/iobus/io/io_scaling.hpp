/**
 * @file  io_scaling.hpp
 * @brief Raw s24 ↔ engineering theo sensor_type (bảng 06 §3.6); eng → raw AO.
 *        Phase 0-2 (fake MCU): 0-10V / 4-20mA / dry-contact đầy đủ;
 *        PT100/PT1000/NTC skeleton (R_from_raw cần calib mạch thật ở bring-up).
 */
#ifndef IOBUS_IO_SCALING_HPP
#define IOBUS_IO_SCALING_HPP

#include "io/io_types.hpp"

namespace iobus {

/* Full-scale dương của s24 */
constexpr float IO_S24_FS = 8388607.0f;

SensorType  sensor_type_from_string(const char* s);
const char* sensor_unit(SensorType t);   /* "V","mA","degC","" */

/* raw uint24 (như nhận từ IO_RESP) → eng + quality. Dùng iop_s24 nội bộ. */
float ui_to_eng(uint32_t raw_u24, SensorType t, kx_quality_t* q_out);

/* eng (V hoặc mA theo mode) → raw DAC 16-bit, clamp [0,65535]. */
uint16_t ao_eng_to_raw(float v, AoMode m);

} // namespace iobus

#endif /* IOBUS_IO_SCALING_HPP */
