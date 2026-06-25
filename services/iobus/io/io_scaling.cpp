#include "io/io_scaling.hpp"

#include <cmath>
#include <cstring>

namespace iobus {

static constexpr double SH_A = 1.129e-3;
static constexpr double SH_B = 2.341e-4;
static constexpr double SH_C = 8.76e-8;

static constexpr float DRY_CONTACT_THRESHOLD = IO_S24_FS * 0.5f;

SensorType sensor_type_from_string(const char* s)
{
    if (std::strcmp(s, "0-10V") == 0)       return SensorType::V0_10;
    if (std::strcmp(s, "4-20mA") == 0)      return SensorType::MA4_20;
    if (std::strcmp(s, "PT100") == 0)       return SensorType::PT100;
    if (std::strcmp(s, "PT1000") == 0)      return SensorType::PT1000;
    if (std::strcmp(s, "NTC10K") == 0)      return SensorType::NTC10K;
    if (std::strcmp(s, "NTC20K") == 0)      return SensorType::NTC20K;
    if (std::strcmp(s, "dry-contact") == 0) return SensorType::DRY_CONTACT;
    return SensorType::UNKNOWN;
}

const char* sensor_unit(SensorType t)
{
    switch (t) {
    case SensorType::V0_10:  return "V";
    case SensorType::MA4_20: return "mA";
    case SensorType::PT100:
    case SensorType::PT1000:
    case SensorType::NTC10K:
    case SensorType::NTC20K: return "degC";
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
    case SensorType::V0_10: {
        const float v = frac * 10.0f;
        if (frac > 1.10f || frac < -0.02f) *q_out = KX_Q_BAD;
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
    default:
        *q_out = KX_Q_BAD;
        return 0.0f;
    }
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
