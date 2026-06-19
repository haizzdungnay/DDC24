#include "iop/iop_client.hpp"

#include <cstdio>
#include <ctime>

#include <poll.h>

#include "diagnostics/iobus_metrics.hpp"
#include "iop/iop_parser.hpp"

namespace iobus {

static uint64_t now_ns()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

static const char* status_name(IopStatus s)
{
    switch (s) {
    case IopStatus::INIT:        return "INIT";
    case IopStatus::OPEN_UART:   return "OPEN_UART";
    case IopStatus::HANDSHAKE:   return "HANDSHAKE";
    case IopStatus::CONFIG_AO:   return "CONFIG_AO";
    case IopStatus::NORMAL_POLL: return "NORMAL_POLL";
    case IopStatus::FAULT:       return "FAULT";
    case IopStatus::SAFE_STATE:  return "SAFE_STATE";
    case IopStatus::RECONNECT:   return "RECONNECT";
    }
    return "?";
}

IopClient::IopClient(IobusMetrics* metrics, IopClientConfig cfg)
    : metrics_(metrics), cfg_(cfg)
{
}

void IopClient::set_status(IopStatus s)
{
    if (s != status_) {
        std::fprintf(stderr, "INFO  iop.state %s -> %s\n", status_name(status_), status_name(s));
        status_ = s;
    }
}

bool IopClient::open(const std::string& dev)
{
    set_status(IopStatus::OPEN_UART);
    parser_.reset();
    seq_ = 0;
    if (!port_.open(dev, cfg_.baud)) {
        set_status(IopStatus::FAULT);
        return false;
    }
    return true;
}

void IopClient::close()
{
    port_.close();
}

IopResult IopClient::wait_response(uint8_t sent_seq, uint8_t sent_cmd,
                                   uint8_t expect_cmd, uint8_t expect_len,
                                   ParsedFrame* resp, uint32_t timeout_ms)
{
    const uint64_t deadline = now_ns() + static_cast<uint64_t>(timeout_ms) * 1000000ull;
    IopResult res;
    for (;;) {
        /* xả buffer parser trước, rồi mới chờ thêm byte */
        for (;;) {
            ParseError perr;
            const ParseResult pr = parser_.next(resp, &perr);
            if (pr == ParseResult::NEED_MORE) break;
            if (pr == ParseResult::ERROR) {
                if (perr == ParseError::CRC_FAIL && metrics_)
                    metrics_->crc_error_count.fetch_add(1, std::memory_order_relaxed);
                continue;   /* crc_err đã đếm; vẫn chờ frame tốt tới deadline */
            }
            /* FRAME */
            if (resp->seq != sent_seq) {
                if (metrics_) metrics_->seq_error_count.fetch_add(1, std::memory_order_relaxed);
                continue;                          /* drop, chờ tiếp */
            }
            if (resp->cmd == CMD_NACK && resp->len == IOP_NACK_LEN) {
                if (metrics_) {
                    metrics_->rx_count.fetch_add(1, std::memory_order_relaxed);
                    metrics_->nack_count.fetch_add(1, std::memory_order_relaxed);
                }
                res.code = IopResult::NACK;
                res.nack_err = resp->payload[1];
                return res;
            }
            if (resp->cmd != expect_cmd || resp->len != expect_len)
                continue;                          /* frame lạ/echo sai → drop */
            if (expect_cmd == CMD_ACK && resp->payload[0] != sent_cmd)
                continue;                          /* ACK sai ECHOED_CMD (05 §15.7) */
            if (metrics_) metrics_->rx_count.fetch_add(1, std::memory_order_relaxed);
            res.code = IopResult::OK;
            return res;
        }

        const uint64_t t = now_ns();
        if (t >= deadline) {
            /* hết deadline = TIMEOUT thống nhất (CRC lỗi đã đếm riêng) —
             * để transact tăng iop_timeout đúng (#11 analysis report) */
            res.code = IopResult::TIMEOUT;
            return res;
        }
        struct pollfd pfd { port_.fd(), POLLIN, 0 };
        const int timeout_left_ms = static_cast<int>((deadline - t) / 1000000ull) + 1;
        const int pr = ::poll(&pfd, 1, timeout_left_ms);
        if (pr > 0 && (pfd.revents & POLLIN)) {
            uint8_t buf[512];
            const ssize_t r = port_.read(buf, sizeof(buf));
            if (r > 0) parser_.feed(buf, static_cast<size_t>(r));
            if (r < 0) { res.code = IopResult::NOT_OPEN; return res; }
        }
    }
}

IopResult IopClient::transact(uint8_t cmd, const uint8_t* payload, uint8_t len,
                              uint8_t expect_cmd, uint8_t expect_len,
                              ParsedFrame* resp, uint32_t timeout_ms)
{
    IopResult res;
    if (!port_.is_open()) { res.code = IopResult::NOT_OPEN; return res; }

    uint8_t frame[IOP_MAX_FRAME];
    for (uint32_t attempt = 0; attempt <= cfg_.max_retry; attempt++) {
        const uint8_t seq = seq_++;               /* SEQ +1 mỗi frame gửi, wrap 255→0 */
        const size_t n = build_frame(cmd, seq, payload, len, frame);
        if (port_.write(frame, n) < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                /* EAGAIN kéo dài (>~50ms trong iop_port) / lỗi ghi = link chết về mặt
                 * semantics → coi như TIMEOUT: đi qua retry → FAULT → RECONNECT
                 * (reconnect mở lại port). KHÔNG trả NOT_OPEN tức thì. */
                res.code = IopResult::TIMEOUT;
                res.retries = static_cast<uint8_t>(attempt);
                if (attempt < cfg_.max_retry && metrics_)
                    metrics_->retry_count.fetch_add(1, std::memory_order_relaxed);
                continue;
            } else {
                /* Lỗi ghi thực sự (EBADF, EPIPE, etc.) -> trả NOT_OPEN ngay để reconnect lập tức */
                res.code = IopResult::NOT_OPEN;
                return res;
            }
        }
        if (metrics_) metrics_->tx_count.fetch_add(1, std::memory_order_relaxed);

        res = wait_response(seq, cmd, expect_cmd, expect_len, resp, timeout_ms);
        res.retries = static_cast<uint8_t>(attempt);
        if (res.code == IopResult::OK || res.code == IopResult::NACK)
            return res;
        if (res.code == IopResult::NOT_OPEN)
            return res;
        if (attempt < cfg_.max_retry && metrics_)
            metrics_->retry_count.fetch_add(1, std::memory_order_relaxed);
    }
    if (res.code == IopResult::TIMEOUT && metrics_)
        metrics_->timeout_count.fetch_add(1, std::memory_order_relaxed);
    return res;
}

IopResult IopClient::handshake()
{
    set_status(IopStatus::HANDSHAKE);
    uint8_t payload[IOP_HANDSHAKE_LEN];
    const uint16_t ver = static_cast<uint16_t>((IOP_VER_MAJOR << 8) | IOP_VER_MINOR);
    const uint16_t cap = IOP_CAP_DIAG | IOP_CAP_RESET_IO;
    payload[0] = static_cast<uint8_t>(ver >> 8);
    payload[1] = static_cast<uint8_t>(ver & 0xFF);
    payload[2] = static_cast<uint8_t>(cap >> 8);
    payload[3] = static_cast<uint8_t>(cap & 0xFF);

    ParsedFrame resp;
    IopResult res = transact(CMD_HANDSHAKE, payload, sizeof(payload),
                             CMD_HANDSHAKE_RESP, IOP_HANDSHAKE_RESP_LEN,
                             &resp, cfg_.handshake_timeout_ms);
    if (!res.ok()) {
        std::fprintf(stderr, "ERROR iop.handshake_fail code=%d retries=%u\n", res.code, res.retries);
        return res;
    }
    mcu_iop_version_ = iop_be16(resp.payload + 0);
    mcu_fw_version_  = iop_be16(resp.payload + 2);
    const uint8_t hs_status = resp.payload[4];
    std::fprintf(stderr, "INFO  iop.handshake mcu_iop=%u.%u mcu_fw=%u.%u status=%s\n",
                 mcu_iop_version_ >> 8, mcu_iop_version_ & 0xFF,
                 mcu_fw_version_ >> 8, mcu_fw_version_ & 0xFF,
                 hs_status == IOP_HS_STATUS_OK ? "ok"
                 : hs_status == IOP_HS_STATUS_WARN ? "warn" : "incompat");
    if (hs_status == IOP_HS_STATUS_INCOMPAT) {
        res.code = IopResult::NACK;
        res.nack_err = ERR_VERSION_INCOMPAT;
        return res;
    }
    if (hs_status == IOP_HS_STATUS_WARN)
        std::fprintf(stderr, "WARN  iop.handshake version mismatch, continuing\n");
    return res;
}

IopResult IopClient::get_io(IopIoResp* out)
{
    ParsedFrame resp;
    IopResult res = transact(CMD_GET_IO, nullptr, 0,
                             CMD_IO_RESP, IOP_IO_RESP_LEN, &resp, cfg_.response_timeout_ms);
    if (res.ok()) {
        if (!parse_io(resp.payload, resp.len, out)) {
            res.code = IopResult::CRC_FAIL;       /* không xảy ra: len đã verify */
            return res;
        }
        last_io_resp_ns_ = now_ns();
        if (metrics_)
            metrics_->last_valid_sample_cnt.store(out->sample_cnt, std::memory_order_relaxed);
    }
    return res;
}

IopResult IopClient::set_do(uint8_t mask, uint8_t value)
{
    const uint8_t payload[IOP_SET_DO_LEN] = { mask, value };
    ParsedFrame resp;
    return transact(CMD_SET_DO, payload, sizeof(payload),
                    CMD_ACK, IOP_ACK_LEN, &resp, cfg_.response_timeout_ms);
}

IopResult IopClient::set_ao(const uint16_t ao_raw[4])
{
    uint8_t payload[IOP_SET_AO_LEN];
    for (int i = 0; i < 4; i++) {
        payload[2 * i]     = static_cast<uint8_t>(ao_raw[i] >> 8);
        payload[2 * i + 1] = static_cast<uint8_t>(ao_raw[i] & 0xFF);
    }
    ParsedFrame resp;
    return transact(CMD_SET_AO, payload, sizeof(payload),
                    CMD_ACK, IOP_ACK_LEN, &resp, cfg_.response_timeout_ms);
}

IopResult IopClient::set_ao_cfg(uint8_t ao_mode_mask)
{
    const uint8_t payload[IOP_SET_AO_CFG_LEN] = { ao_mode_mask };
    ParsedFrame resp;
    return transact(CMD_SET_AO_CFG, payload, sizeof(payload),
                    CMD_ACK, IOP_ACK_LEN, &resp, cfg_.response_timeout_ms);
}

IopResult IopClient::get_diag(IopDiagResp* out)
{
    ParsedFrame resp;
    IopResult res = transact(CMD_GET_DIAG, nullptr, 0,
                             CMD_DIAG_RESP, IOP_DIAG_RESP_LEN, &resp, cfg_.response_timeout_ms);
    if (res.ok() && !parse_diag(resp.payload, resp.len, out))
        res.code = IopResult::CRC_FAIL;
    return res;
}

IopResult IopClient::reset_io(uint8_t reason)
{
    const uint8_t payload[IOP_RESET_IO_LEN] = { reason };
    ParsedFrame resp;
    return transact(CMD_RESET_IO, payload, sizeof(payload),
                    CMD_ACK, IOP_ACK_LEN, &resp, cfg_.response_timeout_ms);
}

} // namespace iobus
