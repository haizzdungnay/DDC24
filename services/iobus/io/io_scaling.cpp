#include "io/io_scaling.hpp"

#include <cctype>
#include <cmath>
#include <cstring>
#include <string>

namespace iobus {

static constexpr double SH_A = 1.129e-3;
static constexpr double SH_B = 2.341e-4;
static constexpr double SH_C = 8.76e-8;

static constexpr float DRY_CONTACT_THRESHOLD = IO_S24_FS * 0.5f;

static std::string lower_copy(const char* s)
{
    std::string out;
    if (!s) return out;
    for (; *s; ++s) out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(*s))));
    return out;
}

SensorType sensor_type_from_string(const char* s)
{
    const std::string v = lower_copy(s);
    if (v == "none")                         return SensorType::NONE;
    if (v == "0-10v")                        return SensorType::V0_10;
    if (v == "2-10v")                        return SensorType::V2_10;
    if (v == "4-20ma")                       return SensorType::MA4_20;
    if (v == "pt100")                        return SensorType::PT100;
    if (v == "pt1000")                       return SensorType::PT1000;
    if (v == "ntc10k")                       return SensorType::NTC10K;
    if (v == "ntc20k")                       return SensorType::NTC20K;
    if (v == "dry" || v == "dry-contact")    return SensorType::DRY_CONTACT;
    if (v == "potentiometer")                return SensorType::POTENTIOMETER;
    if (v == "light")                        return SensorType::LIGHT;
    if (v == "pulse")                        return SensorType::PULSE;
    return SensorType::UNKNOWN;
}

const char* sensor_unit(SensorType t)
{
    switch (t) {
    case SensorType::NONE:   return "";
    case SensorType::V0_10:  return "V";
    case SensorType::V2_10:  return "V";
    case SensorType::MA4_20: return "mA";
    case SensorType::PT100:
    case SensorType::PT1000:
    case SensorType::NTC10K:
    case SensorType::NTC20K: return "degC";
    case SensorType::POTENTIOMETER:
    case SensorType::LIGHT:  return "%";
    case SensorType::PULSE:  return "pulse";
    default:                 return "";
    }
}

/* R_from_raw: phụ thuộc mạch front-end — calib thật ở bring-up. */
static double r_from_raw(int32_t raw_s32, double r_nominal)
{
    return (static_cast<double>(raw_s32) / static_cast<double>(IO_S24_FS)) * 2.0 * r_nominal;
}

static double ntc_resolve_temp(double r)
{
    if (r <= 0.0) return NAN;
    const double lnr = std::log(r);
    const double t_k = 1.0 / (SH_A + SH_B * lnr + SH_C * lnr * lnr * lnr);
    return t_k - 273.15;
}

float ui_to_eng(int32_t raw_s32, SensorType t, kx_quality_t* q_out)
{
    const float frac = static_cast<float>(raw_s32) / IO_S24_FS;
    *q_out = KX_Q_GOOD;

    switch (t) {
    case SensorType::NONE:
        *q_out = KX_Q_BAD;
        return 0.0f;
    case SensorType::V0_10: {
        const float v = frac * 10.0f;
        if (frac > 1.10f || frac < -0.02f) *q_out = KX_Q_BAD;
        return v;
    }
    case SensorType::V2_10: {
        const float v = frac * 10.0f;
        if (v < 1.8f || v > 11.0f) *q_out = KX_Q_BAD;
        return v;
    }
    case SensorType::MA4_20: {
        const float ma = 4.0f + frac * 16.0f;
        if (ma < 3.5f) *q_out = KX_Q_BAD;
        else if (ma > 21.0f) *q_out = KX_Q_BAD;
        return ma;
    }
    case SensorType::PT100:
    case SensorType::PT1000: {
        /* Rev A: IOP_BOARD_CAP_RTD not set — circuit not populated.
         * When RTD hardware ships (BOARD_CAP_MAP & IOP_BOARD_CAP_RTD), reinstate
         * CVD pt_resolve_temp() here. Track as follow-up task IOB-RTD-RevB. */
        *q_out = KX_Q_BAD;
        return 0.0f;
    }
    case SensorType::NTC10K:
    case SensorType::NTC20K: {
        const double r_nom = (t == SensorType::NTC10K) ? 10000.0 : 20000.0;
        const double temp = ntc_resolve_temp(r_from_raw(raw_s32, r_nom));
        if (std::isnan(temp) || temp < -30.0 || temp > 70.0) { *q_out = KX_Q_BAD; return 0.0f; }
        return static_cast<float>(temp);
    }
    case SensorType::DRY_CONTACT:
        return (static_cast<float>(raw_s32) > DRY_CONTACT_THRESHOLD) ? 1.0f : 0.0f;
    case SensorType::POTENTIOMETER:
    case SensorType::LIGHT: {
        const float pct = frac * 100.0f;
        if (frac > 1.10f || frac < -0.02f) *q_out = KX_Q_BAD;
        return pct;
    }
    case SensorType::PULSE:
        /* ponytail: true pulse counter needs MCU edge count in IOP; until then expose raw nonnegative sample. */
        if (raw_s32 < 0) *q_out = KX_Q_BAD;
        return static_cast<float>(raw_s32 < 0 ? 0 : raw_s32);
    default:
        *q_out = KX_Q_BAD;
        return 0.0f;
    }
}

static float range_factor(uint8_t range_mult)
{
    if (range_mult == 1 || range_mult == 4) return 10.0f;
    if (range_mult == 2 || range_mult == 5) return 100.0f;
    return 1.0f;
}

static bool sqrt_range(uint8_t range_mult)
{
    return range_mult == 3 || range_mult == 4 || range_mult == 5;
}

static float scale_range(float value, float in_lo, float in_hi, const UiScaleConfig& cfg, kx_quality_t* q_out)
{
    if (in_hi <= in_lo || cfg.scale_hi <= cfg.scale_lo) {
        *q_out = KX_Q_BAD;
        return 0.0f;
    }
    float frac = (value - in_lo) / (in_hi - in_lo);
    if (frac < 0.0f) frac = 0.0f;
    if (frac > 1.0f) frac = 1.0f;
    if (sqrt_range(cfg.range_mult)) frac = std::sqrt(frac);
    const float factor = range_factor(cfg.range_mult);
    const float lo = cfg.scale_lo * factor;
    const float hi = cfg.scale_hi * factor;
    return lo + frac * (hi - lo);
}

float ui_to_eng(int32_t raw_s32, const UiScaleConfig& cfg, kx_quality_t* q_out)
{
    if (!cfg.enabled) {
        *q_out = KX_Q_BAD;
        return 0.0f;
    }

    float value = ui_to_eng(raw_s32, cfg.sensor, q_out);
    if (*q_out == KX_Q_BAD) return value;

    switch (cfg.sensor) {
    case SensorType::V0_10:
        value = scale_range(value, 0.0f, 10.0f, cfg, q_out);
        break;
    case SensorType::V2_10:
        value = scale_range(value, 2.0f, 10.0f, cfg, q_out);
        break;
    case SensorType::MA4_20:
        value = scale_range(value, 4.0f, 20.0f, cfg, q_out);
        break;
    case SensorType::POTENTIOMETER:
    case SensorType::LIGHT:
        value = scale_range(value, 0.0f, 100.0f, cfg, q_out);
        break;
    case SensorType::DRY_CONTACT:
        value = cfg.invert ? (value > 0.5f ? 0.0f : 1.0f) : value;
        break;
    default:
        break;
    }
    if (*q_out != KX_Q_BAD) value += cfg.sensor_cal;
    return value;
}

uint16_t ao_eng_to_raw(float v, AoMode m)
{
    float frac;
    if (m == AoMode::V0_10)
        frac = v / 10.0f;
    else
        frac = (v - 4.0f) / 16.0f;
    if (frac < 0.0f) frac = 0.0f;
    if (frac > 1.0f) frac = 1.0f;
    return static_cast<uint16_t>(frac * 65535.0f + 0.5f);
}

} // namespace iobus
