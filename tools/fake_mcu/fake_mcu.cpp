/**
 * @file  fake_mcu.cpp
 * @brief Emulator MCU slave IOP qua PTY/UART — contract 05 §11 (ADR-010 v2).
 *        Self-contained: chỉ phụ thuộc contracts/iop/iop_protocol.h (không link iobus_lib).
 *
 * Hành vi:
 *   HANDSHAKE   → HANDSHAKE_RESP (version/status cấu hình được)
 *   GET_IO      → IO_RESP fake — 16 kênh UI mô phỏng field device một AHU thật
 *                 (xem docs/07_records/reviews/FAKE_MCU_AHU_WIRING_2026-08-14.md),
 *                 phản hồi động theo lệnh AO/DO đã nhận (đóng vòng feedback)
 *   SET_DO/AO/AO_CFG → ACK; lưu state để IO_RESP feedback (DO_FB_MASK, UI feedback)
 *   GET_DIAG    → DIAG_RESP fake + clear sticky WDG_RESET
 *   RESET_IO    → ACK + IO về safe
 * Inject: --crc-error RATE, --timeout N, --nack CMD ERR, --seq-wrong,
 *         --stuck-relay, --overtemp, --hs-status N, --vdd-fault,
 *         --adc-fault {1|2|3}, --dac-fault, --wdg-reset N, --stuck-ui CH RAW
 */
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <string>

#include <fcntl.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>

#include "iop_protocol.h"

namespace {

struct McuState {
    uint8_t  do_state = 0;            /* bit0..3 = DO1..4 */
    uint16_t ao_raw[4] = {};
    uint8_t  ao_mode_mask = 0;
    uint16_t sample_cnt = 0;
    uint16_t fault_flags = 0;
    bool     safe_state = false;
    uint16_t rx_cnt = 0, crc_err = 0, seq_err = 0;
    uint64_t boot_ns = 0;
    uint64_t last_rx_ns = 0;          /* cho MCU safe timeout 200ms (lớp 1) */
    double   do1_on_since_t = -1.0;   /* giây kể từ boot lúc DO-01 (Fan Enable) bật gần nhất; -1 = đang tắt */
    double   last_tick_t = 0.0;       /* giây (kể từ boot) lần build_io_resp_payload gần nhất, để tính dt */
    double   filter_dirt_accum_s = 0.0;    /* tổng giây quạt đã chạy kể từ lần "thay lọc" gần nhất */
    double   filter_tripped_since_t = -1.0; /* giây lúc Filter DP bắt đầu báo bẩn; -1 = đang sạch */
};

struct Inject {
    double   crc_error_rate = 0.0;    /* xác suất trả frame CRC sai */
    int      timeout_frames = 0;      /* bỏ trả lời N frame đầu */
    uint8_t  nack_cmd = 0;            /* NACK command này... */
    uint8_t  nack_err = 0;            /* ...với error code này */
    bool     seq_wrong = false;       /* echo SEQ+1 (sai) */
    bool     stuck_relay = false;     /* DO_FB không theo lệnh + FAULT bit4 (IOP_FAULT_RELAY_STUCK) */
    bool     overtemp = false;        /* MCU_TEMP=90.0°C + FAULT bit6 (IOP_FAULT_MCU_OVERTEMP) */
    bool     vdd_fault = false;       /* FAULT bit7 (IOP_FAULT_VDD) — critical alarm path */
    uint8_t  hs_status = IOP_HS_STATUS_OK;

    /* --- Fault injection bổ sung, phủ nốt SPEC §9.3 --- */
    int      adc_fault = 0;           /* 0=không, 1=ADC1 (ch1-8), 2=ADC2 (ch9-16), 3=cả hai */
    bool     dac_fault = false;       /* FAULT bit2 (IOP_FAULT_DAC) — AO không ra được lệnh */
    uint16_t wdg_reset_cnt = 0;       /* WDG_RESET_CNT + sticky FAULT bit5 */
    int      stuck_ui_ch = -1;        /* kênh UI bị "đơ" ở giá trị cố định (0-based) */
    int32_t  stuck_ui_raw = 0;
};

uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

/* Mirror Rev A analog front-end constants from apps/iobus/io/io_scaling.hpp/.cpp.
 * fake_mcu emits ADC raw, so 0-10V/4-20mA/NTC simulation must pass through
 * divider/shunt/thermistor network thay vì coi ADC full-scale là field full-scale. */
constexpr double SIM_S24_FS = 8388607.0;
constexpr double SIM_ADC_VREF_V = 2.44;
constexpr double SIM_UI_DIV_GAIN = 9.2645;
constexpr double SIM_UI_SHUNT_OHM = 49.9;
/* NTC10K: mirror io_scaling.cpp (IO_NTC_VEXC_V, NTC_BETA_K, NTC_T0_K) — dùng
 * chung một mạch kích áp cho mọi kênh nhiệt độ AHU (SAT/RAT/OAT/MAT/CHW). */
constexpr double SIM_NTC_VEXC_V = 3.3;
constexpr double SIM_NTC_BETA_K = 3950.0;
constexpr double SIM_NTC_T0_K = 298.15;
constexpr double SIM_NTC_R0_OHM = 10000.0;
/* Trễ khởi động quạt trước khi tiếp điểm Proof-of-Flow (UI-12) báo "đang chạy". */
constexpr double SIM_FAN_SPINUP_S = 2.0;
/* "Thời tiết" mô phỏng: nén một ngày/một đợt thời tiết vào vài phút thật để
 * kỹ sư automation thấy dữ liệu sống động trong một phiên làm việc, thay vì
 * phải chờ hàng giờ. Không nhằm mô phỏng khí hậu chính xác. */
constexpr double SIM_PI = 3.14159265358979323846;
constexpr double SIM_DAY_PERIOD_S = 600.0;              /* 10 phút thật = 1 "ngày" mô phỏng */
constexpr double SIM_WEATHER_PERIOD_S = SIM_DAY_PERIOD_S * 5.0; /* ~50 phút = 1 đợt nóng/mát */
/* Filter DP Switch: bẩn dần theo tổng giờ quạt chạy, tự "thay lọc" sau khi
 * giữ trạng thái báo bẩn một khoảng đủ để kỹ sư thấy alarm rồi thấy nó hết. */
constexpr double SIM_FILTER_DIRTY_THRESHOLD_S = 90.0;
constexpr double SIM_FILTER_RESET_HOLD_S = 20.0;

int32_t clamp_s24(double raw)
{
    if (raw > SIM_S24_FS) return static_cast<int32_t>(SIM_S24_FS);
    if (raw < -SIM_S24_FS) return static_cast<int32_t>(-SIM_S24_FS);
    return static_cast<int32_t>(std::lround(raw));
}

int32_t raw_from_adc_volts(double v_adc)
{
    return clamp_s24((v_adc / SIM_ADC_VREF_V) * SIM_S24_FS);
}

int32_t raw_from_field_volts(double v_field)
{
    return raw_from_adc_volts(v_field / SIM_UI_DIV_GAIN);
}

int32_t raw_from_milliamps(double ma)
{
    return raw_from_adc_volts((ma / 1000.0) * SIM_UI_SHUNT_OHM);
}

double adc_volts_from_raw(int32_t raw)
{
    return (static_cast<double>(raw) / SIM_S24_FS) * SIM_ADC_VREF_V;
}

double field_volts_from_raw(int32_t raw)
{
    return adc_volts_from_raw(raw) * SIM_UI_DIV_GAIN;
}

double milliamps_from_raw(int32_t raw)
{
    return (adc_volts_from_raw(raw) / SIM_UI_SHUNT_OHM) * 1000.0;
}

int32_t raw_from_adc_ratio(double frac)
{
    return raw_from_adc_volts(frac * SIM_ADC_VREF_V);
}

/* raw ADC cho một nhiệt độ mục tiêu qua mạch NTC10K (nghịch đảo công thức
 * Beta trong io_scaling.cpp::ntc_resolve_temp/ntc_resistance_from_adc).
 * Lưu ý: với VEXC=3.3V > VREF=2.44V, mạch chia áp NTC-xuống-GND/pullup-lên-VEXC
 * bão hòa ADC (v_adc >= VREF) ở nhiệt độ dưới ~+3 độ C — thấp hơn hẳn dải
 * "hợp lệ" -30..70 độ C mà io_scaling.cpp khai báo. Đây là quan sát về mô hình
 * hằng số hardware hiện có (Rev 2.5, "ready for schematic review"), không phải
 * lỗi của fake_mcu — xem ghi chú trong báo cáo AHU wiring. Mọi baseline AHU
 * dưới đây được chọn ở >=5 độ C để không rơi vào vùng bão hòa này. */
int32_t raw_from_ntc10k_temp(double temp_c)
{
    const double t_k = temp_c + 273.15;
    const double r = SIM_NTC_R0_OHM * std::exp(SIM_NTC_BETA_K * (1.0 / t_k - 1.0 / SIM_NTC_T0_K));
    const double v_adc = SIM_NTC_VEXC_V * r / (r + SIM_NTC_R0_OHM);
    return raw_from_adc_volts(v_adc);
}

/* Tiếp điểm khô: raw thấp (~0.05 x FS) => eng=0 (đóng/an toàn/không trip);
 * raw cao (~0.9 x FS) => eng=1 (hở/trip/hoạt động) — đúng ngưỡng
 * DRY_CONTACT_THRESHOLD=FS*0.5 trong io_scaling.cpp. */
int32_t raw_dry_contact(bool active)
{
    return raw_from_adc_ratio(active ? 0.9 : 0.05);
}

/* Phân số 0..1 của lệnh AO kênh k (0-based) — mode-agnostic vì ao_eng_to_raw()
 * dùng frac 0..1 cho cả V0_10 lẫn MA4_20 (io_scaling.cpp). */
double ao_frac(const McuState& st, int k)
{
    return static_cast<double>(st.ao_raw[k]) / 65535.0;
}

/* Pha "ngày"/"đợt thời tiết" hiện tại, radian [0, 2π). day=0 quy ước nửa đêm. */
double sim_day_phase(double t) { return 2.0 * SIM_PI * std::fmod(t, SIM_DAY_PERIOD_S) / SIM_DAY_PERIOD_S; }
double sim_weather_phase(double t) { return 2.0 * SIM_PI * std::fmod(t, SIM_WEATHER_PERIOD_S) / SIM_WEATHER_PERIOD_S; }

/* Outside Air Temp — "thời tiết" thật: đợt nóng/mát nhiều "ngày" (weather) +
 * chu kỳ ngày/đêm (diurnal, đỉnh gần "trưa") + nhiễu loạn lưu nhanh (turbulence,
 * chu kỳ vài giây) để số liệu luôn thấy chuyển động, không riêng xu hướng chậm. */
double sim_oat_c(double t)
{
    const double mean = 30.0 + 4.0 * std::sin(sim_weather_phase(t) - SIM_PI / 2.0);
    const double diurnal = 6.0 * std::sin(sim_day_phase(t) - SIM_PI / 2.0);
    const double turbulence = 0.4 * std::sin(0.5 * t + 3.1) + 0.15 * std::sin(1.7 * t);
    return mean + diurnal + turbulence;
}

/* Hệ số "đang có người" 0..1 — cao giữa "ngày" mô phỏng, 0 lúc "đêm"; dùng
 * chung cho tải nhiệt nội (RAT) và CO2 (UI-07) để cả hai cùng kể một câu
 * chuyện vận hành nhất quán, không phải hai con số ngẫu nhiên độc lập. */
double sim_occupancy_frac(double t)
{
    return std::max(0.0, std::sin(sim_day_phase(t)));
}

/* Return Air Temp — bám nhẹ theo độ lệch OAT (khối nhiệt tòa nhà làm chậm/lọc
 * bớt dao động ngoài trời) cộng tải nhiệt nội theo giờ có người + nhiễu nhanh. */
double sim_rat_c(double t)
{
    const double oat_swing = sim_oat_c(t) - 30.0;
    const double occ = sim_occupancy_frac(t);
    const double turbulence = 0.15 * std::sin(0.7 * t + 1.0);
    return 24.0 + 0.15 * oat_swing + 1.2 * occ + turbulence;
}

/* Mixed Air Temp = trộn OAT/RAT theo tỉ lệ damper (AO-02) đang lệnh — mô
 * phỏng vật lý economizer thật, dùng chung cho UI-04 và điều kiện Freeze Stat. */
double sim_mat_c(double t, const McuState& st)
{
    const double damper_frac = ao_frac(st, 1);
    return sim_oat_c(t) * damper_frac + sim_rat_c(t) * (1.0 - damper_frac);
}

/* Supply Air Temp = khí sau coil lạnh: nhiệt độ khí trộn (MAT) trừ hiệu ứng
 * làm lạnh theo độ mở van nước lạnh AO-03. Chưa có Program điều khiển van
 * (valve=0) => SAT ~ MAT, tức "chưa được điều khiển" — đúng thực tế AHU chưa
 * có logic vận hành, kỹ sư sẽ THẤY rõ vì sao cần viết Program. Kẹp sàn 7 độ C
 * (giới hạn vật lý coil, tránh xuống vùng bão hòa ADC của NTC, xem ghi chú ở
 * raw_from_ntc10k_temp()). */
double sim_sat_c(double t, const McuState& st)
{
    const double mat_c = sim_mat_c(t, st);
    const double cooling_c = ao_frac(st, 2) * 14.0;
    const double turbulence = 0.1 * std::sin(0.9 * t + 2.0);
    return std::max(7.0, mat_c - cooling_c + turbulence);
}

/* Phân số 0..1 của Duct Static Pressure — thuần phản ứng theo lệnh quạt AO-01
 * (fan law bậc 2), dùng chung cho UI-05 (giá trị) và UI-13 (ngưỡng trip). */
double sim_dsp_frac(const McuState& st)
{
    const double fan_frac = ao_frac(st, 0);
    return fan_frac * fan_frac;
}

bool fan_status_active(const McuState& st, double t)
{
    return st.do1_on_since_t >= 0.0 && (t - st.do1_on_since_t) > SIM_FAN_SPINUP_S;
}

/* Tích lũy giờ quạt chạy (Filter DP bẩn dần) + tự "thay lọc" sau khi giữ
 * trạng thái bẩn đủ lâu — trạng thái mutate duy nhất ngoài do1_on_since_t,
 * gọi một lần mỗi GET_IO trước khi sinh 16 kênh (không phải trong self-test,
 * vì tiếp điểm khô không nằm trong phạm vi kiểm biên an toàn của self-test). */
void mcu_tick(McuState& st, double t)
{
    const double dt = (st.last_tick_t > 0.0) ? std::max(0.0, std::min(1.0, t - st.last_tick_t)) : 0.0;
    st.last_tick_t = t;
    if (st.do_state & 0x01) st.filter_dirt_accum_s += dt;
    if (st.filter_tripped_since_t < 0.0 && st.filter_dirt_accum_s > SIM_FILTER_DIRTY_THRESHOLD_S) {
        st.filter_tripped_since_t = t;
    }
    if (st.filter_tripped_since_t >= 0.0 && (t - st.filter_tripped_since_t) > SIM_FILTER_RESET_HOLD_S) {
        st.filter_tripped_since_t = -1.0;
        st.filter_dirt_accum_s = 0.0;
    }
}

/* 16 kênh UI mô phỏng field device của một AHU thật (xem
 * docs/07_records/reviews/FAKE_MCU_AHU_WIRING_2026-08-14.md để biết cấu hình
 * SensorType/scale cần đặt trong ứng dụng cho từng kênh). Các kênh feedback
 * (damper/valve/VFD) và điều kiện an toàn Freeze Stat phản hồi động theo lệnh
 * AO/DO Core đã gửi (st.ao_raw/st.do_state) — đóng vòng thật thay vì hằng số
 * độc lập, để verify được đường binding→compiler→Core→field device. */
int32_t simulated_ui_raw(int i, double t, const McuState& st)
{
    switch (i) {
    case 0: /* UI-01 Supply Air Temperature (SAT) — NTC10K, theo MAT + van lạnh AO-03 */
        return raw_from_ntc10k_temp(sim_sat_c(t, st));
    case 1: /* UI-02 Return Air Temperature (RAT) — NTC10K, "thời tiết" + tải nội */
        return raw_from_ntc10k_temp(sim_rat_c(t));
    case 2: /* UI-03 Outside Air Temperature (OAT) — NTC10K, mô phỏng thời tiết */
        return raw_from_ntc10k_temp(sim_oat_c(t));
    case 3: /* UI-04 Mixed Air Temperature (MAT) — NTC10K, theo damper AO-02 */
        return raw_from_ntc10k_temp(sim_mat_c(t, st));
    case 4: { /* UI-05 Duct Static Pressure — 4-20mA, theo tốc độ quạt AO-01 + nhiễu cảm biến */
        const double dsp_frac = sim_dsp_frac(st);
        const double noise = 0.03 * std::sin(3.0 * t + 0.2);
        return raw_from_milliamps(std::max(4.0, 4.0 + dsp_frac * 15.0 + noise));
    }
    case 5: { /* UI-06 Supply Air Humidity — 0-10V, 0-100 %RH, nghịch với nhiệt độ ngoài trời */
        const double rh_pct = 60.0 - 8.0 * std::sin(sim_day_phase(t) - SIM_PI / 2.0) +
                               3.0 * std::sin(0.6 * t + 0.5);
        return raw_from_field_volts(std::clamp(rh_pct, 0.0, 100.0) / 100.0 * 10.0);
    }
    case 6: { /* UI-07 Return Air CO2 — 0-10V (Core scale 0-2000ppm), theo giờ có người */
        const double volts = 2.0 + sim_occupancy_frac(t) * 5.0 + 0.3 * std::sin(0.8 * t + 0.4);
        return raw_from_field_volts(std::clamp(volts, 0.0, 10.0));
    }
    case 7: { /* UI-08 Economizer Damper Position Feedback — 0-10V, echo AO-02 */
        const double frac = std::clamp(ao_frac(st, 1) + 0.02 * std::sin(2.0 * t), 0.0, 1.0);
        return raw_from_field_volts(frac * 10.0);
    }
    case 8: /* UI-09 Filter Differential Pressure Switch — dry contact, bẩn dần theo giờ quạt chạy (mcu_tick) */
        return raw_dry_contact(st.filter_tripped_since_t >= 0.0);
    case 9: /* UI-10 Freeze Stat (SAFETY) — dry contact, trip khi MAT < 3 độ C */
        return raw_dry_contact(sim_mat_c(t, st) < 3.0);
    case 10: { /* UI-11 Duct Smoke Detector (SAFETY) — dry contact, xung tự-kiểm-tra định kỳ (không phải cháy thật) */
        const bool self_test_pulse = std::fmod(t, 90.0) < 3.0;
        return raw_dry_contact(self_test_pulse);
    }
    case 11: /* UI-12 Supply Fan Status/Proof of Flow — dry contact, theo DO-01 + trễ khởi động */
        return raw_dry_contact(fan_status_active(st, t));
    case 12: /* UI-13 High Duct Static Pressure Switch (SAFETY) — dry contact, trip khi lệnh quạt gần kịch trần */
        return raw_dry_contact(sim_dsp_frac(st) > 0.92);
    case 13: { /* UI-14 Chilled Water Coil Leaving Temp — NTC10K, theo van AO-03 */
        const double leaving_c = 7.0 + ao_frac(st, 2) * 6.0 + 0.15 * std::sin(0.6 * t);
        return raw_from_ntc10k_temp(leaving_c);
    }
    case 14: { /* UI-15 Heating Valve Position Feedback — 0-10V, echo AO-04 */
        const double frac = std::clamp(ao_frac(st, 3) + 0.02 * std::sin(2.0 * t + 1.0), 0.0, 1.0);
        return raw_from_field_volts(frac * 10.0);
    }
    case 15: { /* UI-16 VFD Fan Speed Feedback — 0-10V, echo AO-01 */
        const double frac = std::clamp(ao_frac(st, 0) + 0.02 * std::sin(2.0 * t + 2.0), 0.0, 1.0);
        return raw_from_field_volts(frac * 10.0);
    }
    default:
        return 0;
    }
}

bool run_self_test()
{
    McuState idle_st;   /* AO=0, DO=0 — trạng thái nghỉ (chưa Commission) */
    McuState max_st;    /* AO=max, DO=max, quạt đã bật từ đầu — trạng thái stress mọi kênh feedback */
    max_st.ao_raw[0] = max_st.ao_raw[1] = max_st.ao_raw[2] = max_st.ao_raw[3] = 65535;
    max_st.do_state = 0x0F;
    max_st.do1_on_since_t = 0.0;

    McuState* states[2] = { &idle_st, &max_st };
    for (McuState* stp : states) {
        for (int sample = 0; sample <= 20000; sample++) {
            const double t = static_cast<double>(sample) * 0.1;
            for (int i = 0; i < 16; i++) {
                const int32_t raw = simulated_ui_raw(i, t, *stp);
                /* Mỗi kênh AHU đã có SensorType dự kiến cố định (không còn là
                 * placeholder chung chung như trước) — kiểm theo đúng dải vật
                 * lý dự kiến cấu hình trong ứng dụng, xem báo cáo wiring. */
                const bool ma_channel = (i == 4);                                      /* UI-05 DSP: 4-20mA */
                const bool v_channel = (i == 5) || (i == 6) || (i == 7) ||
                                       (i == 14) || (i == 15);                          /* SAH/CO2/DamperFB/HeatValveFB/VFDSpeedFB: 0-10V */
                const bool ntc_channel = (i == 0) || (i == 1) || (i == 2) ||
                                         (i == 3) || (i == 13);                          /* SAT/RAT/OAT/MAT/CHW: NTC10K */
                if (ma_channel && milliamps_from_raw(raw) > 20.001) {
                    std::fprintf(stderr, "fake_mcu: self-test fail ui=%d ma=%.6f\n",
                                 i + 1, milliamps_from_raw(raw));
                    return false;
                }
                if (v_channel && field_volts_from_raw(raw) > 10.001) {
                    std::fprintf(stderr, "fake_mcu: self-test fail ui=%d volts=%.6f\n",
                                 i + 1, field_volts_from_raw(raw));
                    return false;
                }
                if (ntc_channel) {
                    const double v_adc = adc_volts_from_raw(raw);
                    if (v_adc <= 0.0 || v_adc >= SIM_ADC_VREF_V) {
                        std::fprintf(stderr, "fake_mcu: self-test fail ui=%d ntc v_adc=%.6f out of range\n",
                                     i + 1, v_adc);
                        return false;
                    }
                }
            }
        }
    }
    std::printf("fake_mcu: self-test ok (16-channel AHU simulation trong dải phần cứng an toàn)\n");
    return true;
}

size_t build_frame(uint8_t cmd, uint8_t seq, const uint8_t* payload, uint8_t len,
                   uint8_t* out, bool corrupt_crc)
{
    out[0] = IOP_SOF;
    out[1] = len;
    out[2] = cmd;
    out[3] = seq;
    if (len) std::memcpy(out + IOP_HDR_LEN, payload, len);
    uint16_t crc = iop_crc16(out, static_cast<uint16_t>(IOP_HDR_LEN + len));
    if (corrupt_crc) crc ^= 0xFFFF;
    out[IOP_HDR_LEN + len]     = static_cast<uint8_t>(crc >> 8);
    out[IOP_HDR_LEN + len + 1] = static_cast<uint8_t>(crc & 0xFF);
    return IOP_HDR_LEN + len + IOP_CRC_LEN;
}

void put_be16(uint8_t* p, uint16_t v) { p[0] = static_cast<uint8_t>(v >> 8); p[1] = static_cast<uint8_t>(v); }
void put_be32s(uint8_t* p, int32_t v)
{
    const uint32_t u = static_cast<uint32_t>(v);
    p[0] = static_cast<uint8_t>(u >> 24);
    p[1] = static_cast<uint8_t>(u >> 16);
    p[2] = static_cast<uint8_t>(u >> 8);
    p[3] = static_cast<uint8_t>(u);
}

void build_io_resp_payload(McuState& st, const Inject& inj, uint8_t* p)
{
    /* IO_RESP v2 — 74 bytes (ADR-010) */
    const double t = static_cast<double>(now_ns() - st.boot_ns) / 1e9;
    mcu_tick(st, t);   /* cập nhật trạng thái mutate (Filter DP bẩn dần) trước khi sinh 16 kênh */
    /* [0..63] UI_RAW[16] — 16 × int32 BE signed, mô phỏng field device AHU
     * (SAT/RAT/OAT/MAT/DSP/SAH/CO2/DamperFB/FilterDP/FreezeStat/Smoke/
     * FanStatus/HighStatic/CHW/HeatValveFB/VFDSpeedFB) — chi tiết từng kênh
     * xem simulated_ui_raw() và docs/07_records/reviews/FAKE_MCU_AHU_WIRING_2026-08-14.md. */
    for (int i = 0; i < 16; i++) {
        /* --stuck-ui mô phỏng cảm biến "đơ": giá trị không đổi dù thời gian
         * trôi. Đây là hỏng hóc thực tế mà CRC/quality KHÔNG bắt được, nên
         * phải test được rằng logic phía trên phát hiện bằng cách khác. */
        const int32_t raw = (i == inj.stuck_ui_ch) ? inj.stuck_ui_raw
                                                   : simulated_ui_raw(i, t, st);
        put_be32s(p + 4 * i, raw);
    }
    /* [64] ADC1_STAT  [65] ADC2_STAT
     * --adc-fault mô phỏng mất DRDY của chip ADS131M08: SOM phải hạ quality
     * kênh tương ứng xuống BAD và (nếu kênh đó đang được graph dùng) vào
     * safe-state theo trigger T6 — đúng kịch bản "ADC loss" của SPEC §9.3. */
    /* Mất ADC = KHÔNG set DRDY_OK (chip không báo mẫu mới) và bật LOCK
     * (lỗi giao tiếp SPI) — đúng cách ADS131M08 biểu hiện khi mất kết nối. */
    p[64] = (inj.adc_fault == 1 || inj.adc_fault == 3)
                ? static_cast<uint8_t>(IOP_ADC_STAT_LOCK) : IOP_ADC_STAT_DRDY_OK;
    p[65] = (inj.adc_fault == 2 || inj.adc_fault == 3)
                ? static_cast<uint8_t>(IOP_ADC_STAT_LOCK) : IOP_ADC_STAT_DRDY_OK;
    /* [66..67] MCU_TEMP */
    put_be16(p + 66, static_cast<uint16_t>(inj.overtemp ? 900 : 250));
    /* [68..69] FAULT_FLAGS v2 */
    uint16_t flags = st.fault_flags;
    if (inj.adc_fault == 1 || inj.adc_fault == 3) flags |= IOP_FAULT_ADC1;
    if (inj.adc_fault == 2 || inj.adc_fault == 3) flags |= IOP_FAULT_ADC2;
    if (inj.dac_fault)   flags |= IOP_FAULT_DAC;
    if (inj.stuck_relay) flags |= IOP_FAULT_RELAY_STUCK;
    if (inj.overtemp)    flags |= IOP_FAULT_MCU_OVERTEMP;
    if (inj.vdd_fault)   flags |= IOP_FAULT_VDD;
    put_be16(p + 68, flags);
    /* [70..71] SAMPLE_CNT */
    put_be16(p + 70, st.sample_cnt++);
    /* [72] DO_FB_MASK  [73] reserved */
    p[72] = inj.stuck_relay ? static_cast<uint8_t>(st.do_state ^ 0x01) : st.do_state;
    p[73] = 0;
}

void build_diag_payload(McuState& st, const Inject& inj, uint8_t* p)
{
    put_be16(p + 0, 0x0200);                                              /* FW 2.0 */
    put_be16(p + 2, static_cast<uint16_t>((now_ns() - st.boot_ns) / 1000000000ull));
    put_be16(p + 4, st.rx_cnt);
    put_be16(p + 6, st.crc_err);
    put_be16(p + 8, st.seq_err);
    /* WDG_RESET_CNT: trước đây hằng 0 nên không test được đường "MCU vừa
     * reset do watchdog". --wdg-reset N cho phép mô phỏng, kèm sticky bit5. */
    put_be16(p + 10, inj.wdg_reset_cnt);                                  /* WDG_RESET_CNT */
    put_be16(p + 12, 1000);                                               /* ADC rate Hz */
    put_be16(p + 14, static_cast<uint16_t>(inj.overtemp ? 900 : 300));
    put_be16(p + 16, 3300);                                               /* VDD mV */
    put_be16(p + 18, 0);
    st.fault_flags &= static_cast<uint16_t>(~IOP_FAULT_WDG_RESET);   /* clear sticky (v2: bit5) */
}

int open_uart(const std::string& dev)
{
    const int fd = ::open(dev.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd < 0) { std::perror("open uart"); return -1; }
    struct termios tio {};
    tcgetattr(fd, &tio);
    cfmakeraw(&tio);
    tio.c_cflag |= CLOCAL | CREAD;
    tio.c_cc[VMIN] = 0;
    tio.c_cc[VTIME] = 0;
    tcsetattr(fd, TCSANOW, &tio);
    tcflush(fd, TCIOFLUSH);
    return fd;
}

int open_pty(const std::string& link_path = "")
{
    const int fd = posix_openpt(O_RDWR | O_NOCTTY);
    if (fd < 0) { std::perror("posix_openpt"); return -1; }
    if (grantpt(fd) != 0 || unlockpt(fd) != 0) { std::perror("grantpt/unlockpt"); ::close(fd); return -1; }
    char name[128];
    if (ptsname_r(fd, name, sizeof(name)) != 0) { std::perror("ptsname"); ::close(fd); return -1; }
    struct termios tio {};
    tcgetattr(fd, &tio);
    cfmakeraw(&tio);
    tcsetattr(fd, TCSANOW, &tio);
    std::printf("pty: %s\n", name);
    if (!link_path.empty()) {
        ::unlink(link_path.c_str());
        if (::symlink(name, link_path.c_str()) != 0) {
            std::perror("symlink");
        } else {
            std::printf("pty link created: %s -> %s\n", link_path.c_str(), name);
        }
    }
    std::fflush(stdout);
    return fd;
}

uint8_t cmd_from_name(const std::string& s)
{
    if (s == "GET_IO") return CMD_GET_IO;
    if (s == "SET_AO") return CMD_SET_AO;
    if (s == "SET_DO") return CMD_SET_DO;
    if (s == "SET_AO_CFG") return CMD_SET_AO_CFG;
    if (s == "GET_DIAG") return CMD_GET_DIAG;
    if (s == "HANDSHAKE") return CMD_HANDSHAKE;
    if (s == "RESET_IO") return CMD_RESET_IO;
    return 0;
}

uint8_t err_from_name(const std::string& s)
{
    if (s == "ERR_UNKNOWN_CMD") return ERR_UNKNOWN_CMD;
    if (s == "ERR_BAD_LEN") return ERR_BAD_LEN;
    if (s == "ERR_CRC_FAIL") return ERR_CRC_FAIL;
    if (s == "ERR_BUSY") return ERR_BUSY;
    if (s == "ERR_SAFE_STATE") return ERR_SAFE_STATE;
    if (s == "ERR_VERSION_INCOMPAT") return ERR_VERSION_INCOMPAT;
    return ERR_UNKNOWN_CMD;
}

} // namespace

int main(int argc, char** argv)
{
    std::string uart;
    std::string pty_link;
    bool use_pty = false;
    Inject inj;
    bool verbose = false;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--pty") use_pty = true;
        else if (a == "--link" && i + 1 < argc) { use_pty = true; pty_link = argv[++i]; }
        else if (a == "--uart" && i + 1 < argc) uart = argv[++i];
        else if (a == "--crc-error" && i + 1 < argc) inj.crc_error_rate = std::atof(argv[++i]);
        else if (a == "--timeout" && i + 1 < argc) inj.timeout_frames = std::atoi(argv[++i]);
        else if (a == "--nack" && i + 2 < argc) {
            inj.nack_cmd = cmd_from_name(argv[++i]);
            inj.nack_err = err_from_name(argv[++i]);
        }
        else if (a == "--seq-wrong") inj.seq_wrong = true;
        else if (a == "--stuck-relay") inj.stuck_relay = true;
        else if (a == "--overtemp") inj.overtemp = true;
        else if (a == "--vdd-fault") inj.vdd_fault = true;
        else if (a == "--adc-fault" && i + 1 < argc) inj.adc_fault = std::atoi(argv[++i]);
        else if (a == "--dac-fault") inj.dac_fault = true;
        else if (a == "--wdg-reset" && i + 1 < argc)
            inj.wdg_reset_cnt = static_cast<uint16_t>(std::atoi(argv[++i]));
        else if (a == "--stuck-ui" && i + 2 < argc) {
            inj.stuck_ui_ch = std::atoi(argv[++i]);
            inj.stuck_ui_raw = static_cast<int32_t>(std::atol(argv[++i]));
        }
        else if (a == "--hs-status" && i + 1 < argc) inj.hs_status = static_cast<uint8_t>(std::atoi(argv[++i]));
        else if (a == "--verbose" || a == "-v") verbose = true;
        else if (a == "--self-test") return run_self_test() ? 0 : 1;
        else if (a == "--help") {
            std::printf("usage: fake_mcu (--pty | --uart DEV) [inject options]\n"
                        "  --crc-error RATE   --timeout N   --nack CMD ERR\n"
                        "  --seq-wrong   --stuck-relay   --overtemp   --vdd-fault   --hs-status N\n"
                        "  --adc-fault {1|2|3}  1=ADC1 ch1-8, 2=ADC2 ch9-16, 3=cả hai\n"
                        "                       (mất DRDY + LOCK -> SOM phải hạ quality BAD)\n"
                        "  --dac-fault          FAULT bit2, AO không ra được lệnh\n"
                        "  --wdg-reset N        WDG_RESET_CNT=N + sticky FAULT bit5\n"
                        "  --stuck-ui CH RAW    kênh UI đơ ở giá trị RAW\n"
                        "                       (hỏng mà CRC/quality không bắt được)\n"
                        "  --self-test\n");
            return 0;
        }
    }
    if (!use_pty && uart.empty()) {
        std::fprintf(stderr, "fake_mcu: cần --pty hoặc --uart DEV (xem --help)\n");
        return 1;
    }

    const int fd = use_pty ? open_pty(pty_link) : open_uart(uart);
    if (fd < 0) return 1;

    McuState st;
    st.boot_ns = now_ns();
    std::srand(static_cast<unsigned>(st.boot_ns));

    uint8_t rxbuf[2 * IOP_MAX_FRAME];
    size_t rxlen = 0;
    int skip_remaining = inj.timeout_frames;

    std::fprintf(stderr, "fake_mcu: running (crc-err=%.2f timeout=%d seq-wrong=%d)\n",
                 inj.crc_error_rate, inj.timeout_frames, inj.seq_wrong);

    for (;;) {
        struct pollfd pfd { fd, POLLIN, 0 };
        const int pr = poll(&pfd, 1, 50);

        /* Lớp safety 1 (MCU FW — 07 §5.1): mất frame > IOP_SAFE_TIMEOUT_MS (200ms)
         * → tự vào safe-state: AO raw 0, DO open, NACK ERR_SAFE_STATE mọi SET_*.
         * Thoát safe khi HANDSHAKE (SOM reconnect). */
        if (!st.safe_state && st.last_rx_ns != 0) {
            const uint64_t idle_ms = (now_ns() - st.last_rx_ns) / 1000000ull;
            if (idle_ms > IOP_SAFE_TIMEOUT_MS) {
                st.safe_state = true;
                st.do_state = 0;
                std::memset(st.ao_raw, 0, sizeof(st.ao_raw));
                std::fprintf(stderr, "fake_mcu: MCU SAFE-STATE after %llu ms idle (layer1)\n",
                             static_cast<unsigned long long>(idle_ms));
            }
        }

        if (pr <= 0) continue;
        if (pfd.revents & (POLLHUP | POLLERR)) {
            /* đầu kia đóng (socat/iobus restart) — chờ mở lại */
            usleep(100000);
            continue;
        }
        uint8_t tmp[512];
        const ssize_t r = ::read(fd, tmp, sizeof(tmp));
        if (r <= 0) continue;
        st.last_rx_ns = now_ns();
        if (rxlen + static_cast<size_t>(r) > sizeof(rxbuf)) rxlen = 0;   /* desync, reset */
        std::memcpy(rxbuf + rxlen, tmp, static_cast<size_t>(r));
        rxlen += static_cast<size_t>(r);

        /* parse mọi frame hoàn chỉnh trong buffer */
        for (;;) {
            size_t i = 0;
            while (i < rxlen && rxbuf[i] != IOP_SOF) i++;
            if (i) { std::memmove(rxbuf, rxbuf + i, rxlen - i); rxlen -= i; }
            if (rxlen < IOP_MIN_FRAME) break;
            const uint8_t plen = rxbuf[1];
            if (plen > IOP_MAX_PAYLOAD) { std::memmove(rxbuf, rxbuf + 1, --rxlen); continue; }
            const size_t total = IOP_HDR_LEN + plen + IOP_CRC_LEN;
            if (rxlen < total) break;

            const uint16_t want = static_cast<uint16_t>((rxbuf[IOP_HDR_LEN + plen] << 8) |
                                                        rxbuf[IOP_HDR_LEN + plen + 1]);
            const uint16_t got = iop_crc16(rxbuf, static_cast<uint16_t>(IOP_HDR_LEN + plen));
            const uint8_t cmd = rxbuf[2];
            const uint8_t seq = rxbuf[3];
            const uint8_t* payload = rxbuf + IOP_HDR_LEN;

            uint8_t out[IOP_MAX_FRAME];
            uint8_t resp_payload[IOP_MAX_PAYLOAD];
            size_t n = 0;
            const uint8_t echo_seq = inj.seq_wrong ? static_cast<uint8_t>(seq + 1) : seq;
            const bool corrupt = inj.crc_error_rate > 0.0 &&
                                 (static_cast<double>(std::rand()) / RAND_MAX) < inj.crc_error_rate;

            if (want != got) {
                st.crc_err++;
                resp_payload[0] = cmd;
                resp_payload[1] = ERR_CRC_FAIL;
                n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, false);
            } else if (skip_remaining > 0) {
                skip_remaining--;
                if (verbose) std::fprintf(stderr, "fake_mcu: inject timeout, skip cmd=0x%02X\n", cmd);
                std::memmove(rxbuf, rxbuf + total, rxlen - total);
                rxlen -= total;
                continue;
            } else if (inj.nack_cmd != 0 && cmd == inj.nack_cmd) {
                st.rx_cnt++;
                resp_payload[0] = cmd;
                resp_payload[1] = inj.nack_err;
                n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, corrupt);
            } else {
                st.rx_cnt++;
                switch (cmd) {
                case CMD_HANDSHAKE:
                    put_be16(resp_payload + 0, static_cast<uint16_t>((IOP_VER_MAJOR << 8) | IOP_VER_MINOR));
                    put_be16(resp_payload + 2, 0x0200);   /* MCU FW version 2.0 */
                    resp_payload[4] = inj.hs_status;
                    resp_payload[5] = 0;
                    put_be16(resp_payload + 6, IOP_BOARD_CAP_REV_A);  /* Rev A: UI_16|DO_4|AO_4 */
                    n = build_frame(CMD_HANDSHAKE_RESP, echo_seq, resp_payload, IOP_HANDSHAKE_RESP_LEN, out, corrupt);
                    st.safe_state = false;
                    if (verbose) std::fprintf(stderr, "fake_mcu: handshake status=%u\n", inj.hs_status);
                    break;
                case CMD_GET_IO:
                    build_io_resp_payload(st, inj, resp_payload);
                    n = build_frame(CMD_IO_RESP, echo_seq, resp_payload, IOP_IO_RESP_LEN, out, corrupt);
                    break;
                case CMD_SET_DO:
                    if (st.safe_state) {
                        resp_payload[0] = cmd; resp_payload[1] = ERR_SAFE_STATE;
                        n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, corrupt);
                    } else if (plen != IOP_SET_DO_LEN) {
                        resp_payload[0] = cmd; resp_payload[1] = ERR_BAD_LEN;
                        n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, corrupt);
                    } else {
                        const uint8_t mask = payload[0], value = payload[1];
                        const uint8_t prev_do = st.do_state;
                        st.do_state = static_cast<uint8_t>((st.do_state & ~mask) | (value & mask));
                        /* DO-01 = Supply Fan Enable: cạnh lên/xuống dùng để mô phỏng
                         * trễ khởi động quạt cho UI-12 Fan Status (fan_status_active). */
                        if ((mask & 0x01) && ((prev_do ^ st.do_state) & 0x01)) {
                            st.do1_on_since_t = (st.do_state & 0x01)
                                ? static_cast<double>(now_ns() - st.boot_ns) / 1e9
                                : -1.0;
                        }
                        resp_payload[0] = cmd;
                        n = build_frame(CMD_ACK, echo_seq, resp_payload, IOP_ACK_LEN, out, corrupt);
                        std::fprintf(stderr, "fake_mcu: SET_DO mask=0x%02X value=0x%02X -> do_state=0x%02X\n",
                                     mask, value, st.do_state);
                    }
                    break;
                case CMD_SET_AO:
                    if (st.safe_state) {
                        resp_payload[0] = cmd; resp_payload[1] = ERR_SAFE_STATE;
                        n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, corrupt);
                    } else if (plen != IOP_SET_AO_LEN) {
                        resp_payload[0] = cmd; resp_payload[1] = ERR_BAD_LEN;
                        n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, corrupt);
                    } else {
                        for (int k = 0; k < 4; k++)
                            st.ao_raw[k] = static_cast<uint16_t>((payload[2 * k] << 8) | payload[2 * k + 1]);
                        resp_payload[0] = cmd;
                        n = build_frame(CMD_ACK, echo_seq, resp_payload, IOP_ACK_LEN, out, corrupt);
                        if (verbose) std::fprintf(stderr, "fake_mcu: SET_AO raw=[%u,%u,%u,%u]\n",
                                                  st.ao_raw[0], st.ao_raw[1], st.ao_raw[2], st.ao_raw[3]);
                    }
                    break;
                case CMD_SET_AO_CFG:
                    if (plen != IOP_SET_AO_CFG_LEN) {
                        resp_payload[0] = cmd; resp_payload[1] = ERR_BAD_LEN;
                        n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, corrupt);
                    } else {
                        st.ao_mode_mask = payload[0];
                        resp_payload[0] = cmd;
                        n = build_frame(CMD_ACK, echo_seq, resp_payload, IOP_ACK_LEN, out, corrupt);
                        if (verbose) std::fprintf(stderr, "fake_mcu: SET_AO_CFG mode=0x%02X\n", st.ao_mode_mask);
                    }
                    break;
                case CMD_GET_DIAG:
                    build_diag_payload(st, inj, resp_payload);
                    n = build_frame(CMD_DIAG_RESP, echo_seq, resp_payload, IOP_DIAG_RESP_LEN, out, corrupt);
                    break;
                case CMD_RESET_IO: {
                    const uint8_t reason = plen >= 1 ? payload[0] : 0xFF;
                    st.do_state = 0;
                    std::memset(st.ao_raw, 0, sizeof(st.ao_raw));   /* AO safe raw=0 (0V/4mA) */
                    resp_payload[0] = cmd;
                    n = build_frame(CMD_ACK, echo_seq, resp_payload, IOP_ACK_LEN, out, corrupt);
                    std::fprintf(stderr, "fake_mcu: RESET_IO reason=0x%02X -> safe\n", reason);
                    break;
                }
                default:
                    resp_payload[0] = cmd;
                    resp_payload[1] = ERR_UNKNOWN_CMD;
                    n = build_frame(CMD_NACK, echo_seq, resp_payload, IOP_NACK_LEN, out, corrupt);
                    break;
                }
            }

            if (n > 0)
                (void)!::write(fd, out, n);
            std::memmove(rxbuf, rxbuf + total, rxlen - total);
            rxlen -= total;
        }
    }
}
