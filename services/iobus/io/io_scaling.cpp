#include "io/io_scaling.hpp"

#include <cmath>
#include <cstring>

namespace iobus {

/* Hằng số 06 §3.6 — chép đúng, không gõ lại từ trí nhớ */
static constexpr double CVD_A = 3.9083e-3;
static constexpr double CVD_B = -5.775e-7;
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

/* R_from_raw: phụ thuộc mạch front-end (divider/excitation) — calib thật ở
 * Phase bring-up. Skeleton: coi raw tỉ lệ thuận R với hệ số danh định. */
static double r_from_raw(int32_t raw_s24, double r_nominal)
{
    return (static_cast<double>(raw_s24) / static_cast<double>(IO_S24_FS)) * 2.0 * r_nominal;
}

/* CVD ngược (IEC 60751), T≥0: R = R0(1 + A·T + B·T²) → giải bậc 2 */
static double pt_resolve_temp(double r, double r0)
{
    const double disc = CVD_A * CVD_A - 4.0 * CVD_B * (1.0 - r / r0);
    if (disc < 0.0) return NAN;
    return (-CVD_A + std::sqrt(disc)) / (2.0 * CVD_B);
}

static double ntc_resolve_temp(double r)
{
    if (r <= 0.0) return NAN;
    const double lnr = std::log(r);
    const double t_k = 1.0 / (SH_A + SH_B * lnr + SH_C * lnr * lnr * lnr);
    return t_k - 273.15;
}

float ui_to_eng(uint32_t raw_u24, SensorType t, kx_quality_t* q_out)
{
    const uint8_t be[3] = { static_cast<uint8_t>(raw_u24 >> 16),
                            static_cast<uint8_t>(raw_u24 >> 8),
                            static_cast<uint8_t>(raw_u24) };
    const int32_t raw = iop_s24(be);
    const float frac = static_cast<float>(raw) / IO_S24_FS;
    *q_out = KX_Q_GOOD;

    switch (t) {
    case SensorType::V0_10: {
        const float v = frac * 10.0f;
        if (frac > 1.10f || frac < -0.02f) *q_out = KX_Q_BAD;   /* >110%FS / <-2%FS */
        return v;
    }
    case SensorType::MA4_20: {
        const float ma = 4.0f + frac * 16.0f;
        if (ma < 3.5f) *q_out = KX_Q_BAD;                        /* đứt loop */
        else if (ma > 21.0f) *q_out = KX_Q_BAD;
        return ma;
    }
    case SensorType::PT100:
    case SensorType::PT1000: {
        const double r0 = (t == SensorType::PT100) ? 100.0 : 1000.0;
        const double temp = pt_resolve_temp(r_from_raw(raw, r0), r0);
        if (std::isnan(temp) || temp < -50.0 || temp > 200.0) { *q_out = KX_Q_BAD; return 0.0f; }
        return static_cast<float>(temp);
    }
    case SensorType::NTC10K:
    case SensorType::NTC20K: {
        const double r_nom = (t == SensorType::NTC10K) ? 10000.0 : 20000.0;
        const double temp = ntc_resolve_temp(r_from_raw(raw, r_nom));
        if (std::isnan(temp) || temp < -30.0 || temp > 70.0) { *q_out = KX_Q_BAD; return 0.0f; }
        return static_cast<float>(temp);
    }
    case SensorType::DRY_CONTACT:
        return (static_cast<float>(raw) > DRY_CONTACT_THRESHOLD) ? 1.0f : 0.0f;
    default:
        *q_out = KX_Q_BAD;   /* sensor_type không nhận ra → BAD, không scale (06 §4) */
        return 0.0f;
    }
}

uint16_t ao_eng_to_raw(float v, AoMode m)
{
    float frac;
    if (m == AoMode::V0_10)
        frac = v / 10.0f;
    else
        frac = (v - 4.0f) / 16.0f;      /* raw 0 = 4mA (IOP_AO_SAFE_CURR_RAW=0) */
    if (frac < 0.0f) frac = 0.0f;
    if (frac > 1.0f) frac = 1.0f;
    return static_cast<uint16_t>(frac * 65535.0f + 0.5f);
}

} // namespace iobus
