/**
 * @file  fake_mcu.cpp
 * @brief Emulator MCU slave IOP qua PTY/UART — contract 05 §11 (ADR-010 v2).
 *        Self-contained: chỉ phụ thuộc shared/iop_protocol.h (không link iobus_lib).
 *
 * Hành vi:
 *   HANDSHAKE   → HANDSHAKE_RESP (version/status cấu hình được)
 *   GET_IO      → IO_RESP fake (UI ramp+sin, DI toggle, sample_cnt tăng)
 *   SET_DO/AO/AO_CFG → ACK; lưu state để IO_RESP feedback (DO_FB_MASK)
 *   GET_DIAG    → DIAG_RESP fake + clear sticky WDG_RESET
 *   RESET_IO    → ACK + IO về safe
 * Inject: --crc-error RATE, --timeout N, --nack CMD ERR, --seq-wrong,
 *         --stuck-relay, --overtemp, --hs-status N
 */
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
};

uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

/* Mirror Rev A analog front-end constants from services/iobus/io/io_scaling.hpp.
 * fake_mcu emits ADC raw, so 0-10V/4-20mA simulation must pass through
 * divider/shunt instead of treating ADC full-scale as field full-scale. */
constexpr double SIM_S24_FS = 8388607.0;
constexpr double SIM_ADC_VREF_V = 2.44;
constexpr double SIM_UI_DIV_GAIN = 9.2645;
constexpr double SIM_UI_SHUNT_OHM = 49.9;

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

int32_t raw_from_analog_safe_frac(double frac)
{
    return raw_from_milliamps(4.0 + frac * 16.0);
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

int32_t simulated_ui_raw(int i, double t)
{
    double frac;
    if (i < 8) {
        frac = 0.5 + 0.45 * std::sin((i < 4 ? 0.015 : 0.018) * t + i * 0.7);
        return raw_from_analog_safe_frac(frac);
    }
    if (i == 8) { /* UI-09 return air temp: NTC10k, about 22-30 C. */
        frac = 0.475 + 0.075 * std::sin(0.006 * t + i * 1.1);
        return raw_from_adc_ratio(frac);
    }
    if (i == 9) { /* UI-10 CO2: 0-10V scaled by io_config to ppm. */
        const double volts = 3.0 + 2.0 * (0.5 + 0.5 * std::sin(0.011 * t + 0.4));
        return raw_from_field_volts(volts);
    }
    if (i == 10) { /* UI-11 chilled water temp: NTC10k, about 10-16 C. */
        frac = 0.88 + 0.05 * std::sin(0.007 * t + i * 1.3);
        return raw_from_adc_ratio(frac);
    }
    if (i == 11 || i == 12 || i == 14) { /* fan status, motion, water leak contacts. */
        frac = (i == 14) ? 0.05 : ((std::sin(0.052 * t + i * 1.57) > 0.0) ? 0.9 : 0.05);
        return raw_from_adc_ratio(frac);
    }
    if (i == 13) { /* UI-14 light level: percent ratio. */
        frac = 0.35 + 0.35 * (0.5 + 0.5 * std::sin(0.012 * t + 1.8));
        return raw_from_adc_ratio(frac);
    }

    frac = 0.5 + 0.45 * std::sin(0.06 * t + i * 0.4);
    return raw_from_analog_safe_frac(frac);
}

bool run_self_test()
{
    for (int sample = 0; sample <= 20000; sample++) {
        const double t = static_cast<double>(sample) * 0.1;
        for (int i = 0; i < 16; i++) {
            const int32_t raw = simulated_ui_raw(i, t);
            const bool analog_safe_channel = i < 8 || i == 9 || i == 15;
            if (analog_safe_channel && field_volts_from_raw(raw) > 10.001) {
                std::fprintf(stderr, "fake_mcu: self-test fail ui=%d volts=%.6f\n",
                             i + 1, field_volts_from_raw(raw));
                return false;
            }
            if (analog_safe_channel && milliamps_from_raw(raw) > 20.001) {
                std::fprintf(stderr, "fake_mcu: self-test fail ui=%d ma=%.6f\n",
                             i + 1, milliamps_from_raw(raw));
                return false;
            }
        }
    }
    std::printf("fake_mcu: self-test ok (analog channels <= 10V and <= 20mA)\n");
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
    /* [0..63] UI_RAW[16] — 16 × int32 BE signed.
     * UI1-8/UI16 are analog-safe; UI9/UI11 are NTC; UI10 is CO2 voltage;
     * UI12/UI13/UI15 are dry contacts; UI14 is light percent. */
    for (int i = 0; i < 16; i++) {
        put_be32s(p + 4 * i, simulated_ui_raw(i, t));
    }
    /* [64] ADC1_STAT  [65] ADC2_STAT */
    p[64] = IOP_ADC_STAT_DRDY_OK;
    p[65] = IOP_ADC_STAT_DRDY_OK;
    /* [66..67] MCU_TEMP */
    put_be16(p + 66, static_cast<uint16_t>(inj.overtemp ? 900 : 250));
    /* [68..69] FAULT_FLAGS v2 */
    uint16_t flags = st.fault_flags;
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
    put_be16(p + 10, 0);                                                  /* WDG_RESET_CNT */
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

int open_pty()
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
    bool use_pty = false;
    Inject inj;
    bool verbose = false;

    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--pty") use_pty = true;
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
        else if (a == "--hs-status" && i + 1 < argc) inj.hs_status = static_cast<uint8_t>(std::atoi(argv[++i]));
        else if (a == "--verbose" || a == "-v") verbose = true;
        else if (a == "--self-test") return run_self_test() ? 0 : 1;
        else if (a == "--help") {
            std::printf("usage: fake_mcu (--pty | --uart DEV) [inject options]\n"
                        "  --crc-error RATE   --timeout N   --nack CMD ERR\n"
                        "  --seq-wrong   --stuck-relay   --overtemp   --vdd-fault   --hs-status N\n"
                        "  --self-test\n");
            return 0;
        }
    }
    if (!use_pty && uart.empty()) {
        std::fprintf(stderr, "fake_mcu: cần --pty hoặc --uart DEV (xem --help)\n");
        return 1;
    }

    const int fd = use_pty ? open_pty() : open_uart(uart);
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
                        st.do_state = static_cast<uint8_t>((st.do_state & ~mask) | (value & mask));
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
