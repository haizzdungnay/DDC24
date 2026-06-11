/**
 * @file  iop_frame.hpp
 * @brief Build/parse frame IOP: SOF | LEN | CMD | SEQ | PAYLOAD | CRC_HI CRC_LO.
 *        Parser stateful (feed nhiều chunk) — contract 06 §3.2, negative 05 §15.
 */
#ifndef IOBUS_IOP_FRAME_HPP
#define IOBUS_IOP_FRAME_HPP

#include <cstddef>
#include <cstdint>

#include "iop_protocol.h"

namespace iobus {

struct ParsedFrame {
    uint8_t cmd = 0;
    uint8_t seq = 0;
    uint8_t len = 0;
    uint8_t payload[IOP_MAX_PAYLOAD] = {};
};

enum class ParseError { NONE, BAD_LEN, CRC_FAIL };

enum class ParseResult { NEED_MORE, FRAME, ERROR };

/* Build frame hoàn chỉnh vào out (≥ IOP_MAX_FRAME byte). Trả về tổng số byte. */
size_t build_frame(uint8_t cmd, uint8_t seq, const uint8_t* payload, uint8_t len, uint8_t* out);

/**
 * Parser stream stateful: nuốt byte qua feed(), tự tìm SOF, gom đủ frame.
 * - SOF sai → bỏ byte (resync), không báo lỗi.
 * - LEN > IOP_MAX_PAYLOAD → ERROR(BAD_LEN), resync sau SOF.
 * - CRC sai → ERROR(CRC_FAIL), resync sau SOF.
 */
class FrameParser {
public:
    /* Nạp thêm n byte vào buffer nội bộ. */
    void feed(const uint8_t* buf, size_t n);

    /* Lấy frame kế tiếp từ buffer đã nạp. */
    ParseResult next(ParsedFrame* out, ParseError* err = nullptr);

    void reset();

    uint32_t crc_err_count() const { return crc_err_; }
    uint32_t bad_len_count() const { return bad_len_; }

private:
    uint8_t  buf_[2 * IOP_MAX_FRAME] = {};
    size_t   len_ = 0;
    uint32_t crc_err_ = 0;
    uint32_t bad_len_ = 0;

    void consume(size_t n);
};

} // namespace iobus

#endif /* IOBUS_IOP_FRAME_HPP */
