#include "io/io_scaling.hpp"

#include <cctype>
#include <cmath>
#include <cstring>
#include <string>

namespace iobus {

static constexpr float DRY_CONTACT_THRESHOLD = IO_S24_FS * 0.5f;
static constexpr float IO_NTC_VEXC_V = 3.3f;
static constexpr double NTC_BETA_K = 3950.0;
static constexpr double NTC_T0_K = 298.15;

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
    case SensorType::DRY_CONTACT: return "bool";
    case SensorType::POTENTIOMETER:
    case SensorType::LIGHT:  return "%";
    case SensorType::PULSE:  return "pulse";
    default:                 return "";
    }
}

const char* sensor_raw_unit(SensorType t)
{
    switch (t) {
    case SensorType::MA4_20:
        return "mA";
    case SensorType::V0_10:
    case SensorType::V2_10:
    case SensorType::PT100:
    case SensorType::PT1000:
    case SensorType::NTC10K:
    case SensorType::NTC20K:
    case SensorType::POTENTIOMETER:
    case SensorType::LIGHT:
        return "V";
    default:
        return "";
    }
}

float ui_raw_electric(int32_t raw_s32, SensorType t)
{
    if (t == SensorType::MA4_20) return (adc_volts(raw_s32) / IO_UI_SHUNT_OHM) * 1000.0f;
    if (t == SensorType::V0_10 || t == SensorType::V2_10) return adc_volts(raw_s32) * IO_UI_DIV_GAIN;
    if (sensor_raw_unit(t)[0] == 'V') return adc_volts(raw_s32);
    return 0.0f;
}

/* Per-channel 2-point calibration hook; defaults are identity until bring-up fills config/NVM. */
static float apply_cal(float value, float gain, float offset)
{
    return value * gain + offset;
}

static float apply_cal(float value, const UiScaleConfig& cfg)
{
    return apply_cal(value, cfg.cal_gain, cfg.cal_offset);
}

float ui_raw_electric(int32_t raw_s32, const UiScaleConfig& cfg)
{
    const float value = ui_raw_electric(raw_s32, cfg.sensor);
    return sensor_raw_unit(cfg.sensor)[0] ? apply_cal(value, cfg) : value;
}

static double ntc_resistance_from_adc(float v_adc, double r_pullup)
{
    if (v_adc <= 0.0f || v_adc >= IO_NTC_VEXC_V) return NAN;
    return r_pullup * static_cast<double>(v_adc) / static_cast<double>(IO_NTC_VEXC_V - v_adc);
}

static double ntc_resolve_temp(double r, double r0)
{
    if (r <= 0.0) return NAN;
    const double t_k = 1.0 / ((1.0 / NTC_T0_K) + (1.0 / NTC_BETA_K) * std::log(r / r0));
    return t_k - 273.15;
}

float ui_to_eng(int32_t raw_s32, SensorType t, kx_quality_t* q_out)
{
    kx_reliability_t ignored;
    return ui_to_eng(raw_s32, t, q_out, &ignored);
}

/* ADR-011: overload với reliability output — phân biệt nguyên nhân lỗi cụ thể. */
float ui_to_eng(int32_t raw_s32, SensorType t, kx_quality_t* q_out, kx_reliability_t* r_out)
{
    const float frac = static_cast<float>(raw_s32) / IO_S24_FS;
    *q_out = KX_Q_GOOD;
    *r_out = KX_REL_RELIABLE;

    switch (t) {
    case SensorType::NONE:
        *q_out = KX_Q_BAD;
        *r_out = KX_REL_CONFIGURATION_ERROR;
        return 0.0f;
    case SensorType::V0_10: {
        const float v = adc_volts(raw_s32) * IO_UI_DIV_GAIN;
        if (v > 11.0f) { *q_out = KX_Q_BAD; *r_out = KX_REL_OVER_RANGE; }
        else if (v < -0.2f) { *q_out = KX_Q_BAD; *r_out = KX_REL_UNDER_RANGE; }
        return v;
    }
    case SensorType::V2_10: {
        const float v = adc_volts(raw_s32) * IO_UI_DIV_GAIN;
        if (v > 11.0f) { *q_out = KX_Q_BAD; *r_out = KX_REL_OVER_RANGE; }
        else if (v < 1.8f) { *q_out = KX_Q_BAD; *r_out = KX_REL_UNDER_RANGE; }
        return v;
    }
    case SensorType::MA4_20: {
        const float ma = (adc_volts(raw_s32) / IO_UI_SHUNT_OHM) * 1000.0f;
        if (ma < 3.5f) { *q_out = KX_Q_BAD; *r_out = KX_REL_OPEN_LOOP; }
        else if (ma > 21.0f) { *q_out = KX_Q_BAD; *r_out = KX_REL_SHORTED_LOOP; }
        return ma;
    }
    case SensorType::PT100:
    case SensorType::PT1000:
        /* Rev A: hardware not populated — configuration mismatch. */
        *q_out = KX_Q_BAD;
        *r_out = KX_REL_CONFIGURATION_ERROR;
        return 0.0f;
    case SensorType::NTC10K:
    case SensorType::NTC20K: {
        const double r_nom = (t == SensorType::NTC10K) ? 10000.0 : 20000.0;
        const double temp = ntc_resolve_temp(ntc_resistance_from_adc(adc_volts(raw_s32), r_nom), r_nom);
        if (std::isnan(temp) || temp < -30.0 || temp > 70.0) {
            *q_out = KX_Q_BAD;
            *r_out = (temp > 70.0) ? KX_REL_OVER_RANGE : KX_REL_UNDER_RANGE;
            return 0.0f;
        }
        return static_cast<float>(temp);
    }
    case SensorType::DRY_CONTACT:
        return (static_cast<float>(raw_s32) > DRY_CONTACT_THRESHOLD) ? 1.0f : 0.0f;
    case SensorType::POTENTIOMETER:
    case SensorType::LIGHT: {
        const float pct = frac * 100.0f;
        if (frac > 1.10f) { *q_out = KX_Q_BAD; *r_out = KX_REL_OVER_RANGE; }
        else if (frac < -0.02f) { *q_out = KX_Q_BAD; *r_out = KX_REL_UNDER_RANGE; }
        return pct;
    }
    case SensorType::PULSE:
        if (raw_s32 < 0) { *q_out = KX_Q_BAD; *r_out = KX_REL_UNRELIABLE_OTHER; }
        return static_cast<float>(raw_s32 < 0 ? 0 : raw_s32);
    default:
        *q_out = KX_Q_BAD;
        *r_out = KX_REL_CONFIGURATION_ERROR;
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

float ui_to_eng(int32_t raw_s32, const UiScaleConfig& cfg, kx_quality_t* q_out, kx_reliability_t* r_out)
{
    if (!cfg.enabled) {
        *q_out = KX_Q_BAD;
        *r_out = KX_REL_CONFIGURATION_ERROR;
        return 0.0f;
    }

    float value = ui_to_eng(raw_s32, cfg.sensor, q_out, r_out);
    if (*q_out == KX_Q_BAD) return value;

    switch (cfg.sensor) {
    case SensorType::V0_10:
        value = apply_cal(value, cfg);
        value = scale_range(value, 0.0f, 10.0f, cfg, q_out);
        break;
    case SensorType::V2_10:
        value = apply_cal(value, cfg);
        value = scale_range(value, 2.0f, 10.0f, cfg, q_out);
        break;
    case SensorType::MA4_20:
        value = apply_cal(value, cfg);
        value = scale_range(value, 4.0f, 20.0f, cfg, q_out);
        break;
    case SensorType::NTC10K:
    case SensorType::NTC20K: {
        const double r_nom = (cfg.sensor == SensorType::NTC10K) ? 10000.0 : 20000.0;
        const double temp = ntc_resolve_temp(
            ntc_resistance_from_adc(apply_cal(adc_volts(raw_s32), cfg), r_nom), r_nom);
        if (std::isnan(temp) || temp < -30.0 || temp > 70.0) {
            *q_out = KX_Q_BAD;
            *r_out = (!std::isnan(temp) && temp > 70.0)
                ? KX_REL_OVER_RANGE : KX_REL_UNDER_RANGE;
            return 0.0f;
        }
        value = static_cast<float>(temp);
        break;
    }
    case SensorType::POTENTIOMETER:
    case SensorType::LIGHT:
        value = apply_cal(value, cfg);
        value = scale_range(value, 0.0f, 100.0f, cfg, q_out);
        break;
    case SensorType::DRY_CONTACT:
        value = cfg.invert ? (value > 0.5f ? 0.0f : 1.0f) : value;
        break;
    default:
        break;
    }
    if (*q_out == KX_Q_BAD) *r_out = KX_REL_UNRELIABLE_OTHER;
    else value += cfg.sensor_cal;
    return value;
}

float ui_to_eng(int32_t raw_s32, const UiScaleConfig& cfg, kx_quality_t* q_out)
{
    kx_reliability_t ignored;
    return ui_to_eng(raw_s32, cfg, q_out, &ignored);
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
