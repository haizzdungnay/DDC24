#include "iop/iop_frame.hpp"

#include <cstring>

#include "iop/iop_crc.hpp"

namespace iobus {

size_t build_frame(uint8_t cmd, uint8_t seq, const uint8_t* payload, uint8_t len, uint8_t* out)
{
    out[0] = IOP_SOF;
    out[1] = len;
    out[2] = cmd;
    out[3] = seq;
    if (len > 0)
        std::memcpy(out + IOP_HDR_LEN, payload, len);
    const uint16_t crc = crc16(out, IOP_HDR_LEN + len);
    out[IOP_HDR_LEN + len]     = static_cast<uint8_t>(crc >> 8);   /* HI trước */
    out[IOP_HDR_LEN + len + 1] = static_cast<uint8_t>(crc & 0xFF);
    return IOP_HDR_LEN + len + IOP_CRC_LEN;
}

void FrameParser::feed(const uint8_t* buf, size_t n)
{
    if (n > sizeof(buf_))
        { buf += n - sizeof(buf_); n = sizeof(buf_); }
    if (len_ + n > sizeof(buf_)) {
        /* buffer đầy (rác/desync) → giữ phần mới nhất */
        const size_t drop = len_ + n - sizeof(buf_);
        consume(drop);
    }
    std::memcpy(buf_ + len_, buf, n);
    len_ += n;
}

void FrameParser::consume(size_t n)
{
    if (n >= len_) { len_ = 0; return; }
    std::memmove(buf_, buf_ + n, len_ - n);
    len_ -= n;
}

ParseResult FrameParser::next(ParsedFrame* out, ParseError* err)
{
    if (err) *err = ParseError::NONE;
    for (;;) {
        /* resync: bỏ byte tới khi gặp SOF */
        size_t i = 0;
        while (i < len_ && buf_[i] != IOP_SOF) i++;
        if (i > 0) consume(i);
        if (len_ < 2) return ParseResult::NEED_MORE;

        const uint8_t plen = buf_[1];
        if (plen > IOP_MAX_PAYLOAD) {
            bad_len_++;
            consume(1);                 /* bỏ SOF giả, resync */
            if (err) *err = ParseError::BAD_LEN;
            return ParseResult::ERROR;
        }
        const size_t total = IOP_HDR_LEN + plen + IOP_CRC_LEN;
        if (len_ < total) return ParseResult::NEED_MORE;

        const uint16_t want = static_cast<uint16_t>((buf_[IOP_HDR_LEN + plen] << 8) |
                                                    buf_[IOP_HDR_LEN + plen + 1]);
        const uint16_t got = crc16(buf_, IOP_HDR_LEN + plen);
        if (want != got) {
            crc_err_++;
            consume(1);                 /* resync sau SOF */
            if (err) *err = ParseError::CRC_FAIL;
            return ParseResult::ERROR;
        }

        out->len = plen;
        out->cmd = buf_[2];
        out->seq = buf_[3];
        if (plen > 0)
            std::memcpy(out->payload, buf_ + IOP_HDR_LEN, plen);
        consume(total);
        return ParseResult::FRAME;
    }
}

void FrameParser::reset()
{
    len_ = 0;
}

} // namespace iobus
