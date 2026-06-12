/**
 * @file  fake_mcu.cpp
 * @brief Emulator MCU slave IOP qua PTY/UART — contract 06 §11.
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
    bool     stuck_relay = false;     /* DO_FB không theo lệnh + FAULT bit3 */
    bool     overtemp = false;        /* MCU_TEMP=90.0°C + FAULT bit5 */
    uint8_t  hs_status = IOP_HS_STATUS_OK;
};

uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
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
void put_be24(uint8_t* p, uint32_t v)
{
    p[0] = static_cast<uint8_t>(v >> 16);
    p[1] = static_cast<uint8_t>(v >> 8);
    p[2] = static_cast<uint8_t>(v);
}

void build_io_resp_payload(McuState& st, const Inject& inj, uint8_t* p)
{
    const double t = static_cast<double>(now_ns() - st.boot_ns) / 1e9;
    for (int i = 0; i < 8; i++) {
        /* UI fake: ramp + sin, mỗi kênh lệch pha — scale trong dải s24 dương */
        const double frac = 0.5 + 0.45 * std::sin(0.2 * t + i * 0.7);
        put_be24(p + 3 * i, static_cast<uint32_t>(frac * 8388607.0));
    }
    p[24] = static_cast<uint8_t>((static_cast<int>(t) / 5) & 1 ? 0x0F : 0x00);  /* DI toggle 5s */
    p[25] = inj.stuck_relay ? static_cast<uint8_t>(st.do_state ^ 0x01)          /* DO1 kẹt */
                            : st.do_state;
    int16_t temp = inj.overtemp ? 900 : 250;                                    /* 90.0 / 25.0 °C */
    put_be16(p + 26, static_cast<uint16_t>(temp));
    uint16_t flags = st.fault_flags;
    if (inj.stuck_relay) flags |= IOP_FAULT_RELAY_STUCK;
    if (inj.overtemp)    flags |= IOP_FAULT_MCU_OVERTEMP;
    put_be16(p + 28, flags);
    put_be16(p + 30, st.sample_cnt++);
    put_be16(p + 32, 0);
}

void build_diag_payload(McuState& st, const Inject& inj, uint8_t* p)
{
    put_be16(p + 0, 0x0100);                                              /* FW 1.0 */
    put_be16(p + 2, static_cast<uint16_t>((now_ns() - st.boot_ns) / 1000000000ull));
    put_be16(p + 4, st.rx_cnt);
    put_be16(p + 6, st.crc_err);
    put_be16(p + 8, st.seq_err);
    put_be16(p + 10, 0);                                                  /* WDG_RESET_CNT */
    put_be16(p + 12, 1000);                                               /* ADC rate Hz */
    put_be16(p + 14, static_cast<uint16_t>(inj.overtemp ? 900 : 300));
    put_be16(p + 16, 3300);                                               /* VDD mV */
    put_be16(p + 18, 0);
    st.fault_flags &= static_cast<uint16_t>(~IOP_FAULT_WDG_RESET);        /* clear sticky */
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
        else if (a == "--hs-status" && i + 1 < argc) inj.hs_status = static_cast<uint8_t>(std::atoi(argv[++i]));
        else if (a == "--verbose" || a == "-v") verbose = true;
        else if (a == "--help") {
            std::printf("usage: fake_mcu (--pty | --uart DEV) [inject options]\n"
                        "  --crc-error RATE   --timeout N   --nack CMD ERR\n"
                        "  --seq-wrong   --stuck-relay   --overtemp   --hs-status N\n");
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
                    put_be16(resp_payload + 2, 0x0100);
                    resp_payload[4] = inj.hs_status;
                    resp_payload[5] = 0;
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
