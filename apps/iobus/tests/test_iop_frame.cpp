/**
 * @file  test_iop_frame.cpp
 * @brief Round-trip build→feed; frame GET_IO SEQ=1 = AA 00 01 01 AC E1;
 *        negative theo 05 §15 (SOF sai, LEN quá max, CRC sai, multi-chunk).
 */
#include <gtest/gtest.h>

#include "iop/iop_frame.hpp"

using namespace iobus;

TEST(IopFrame, BuildGetIoSeq1MatchesContract)
{
    uint8_t out[IOP_MAX_FRAME];
    const size_t n = build_frame(CMD_GET_IO, 1, nullptr, 0, out);
    ASSERT_EQ(n, 6u);
    const uint8_t expect[] = {0xAA, 0x00, 0x01, 0x01, 0xAC, 0xE1};
    EXPECT_EQ(0, memcmp(out, expect, 6));
}

TEST(IopFrame, RoundTrip)
{
    const uint8_t payload[] = {0x01, 0x02, 0x03, 0xFF};
    uint8_t out[IOP_MAX_FRAME];
    const size_t n = build_frame(CMD_SET_DO, 42, payload, sizeof(payload), out);

    FrameParser p;
    p.feed(out, n);
    ParsedFrame f;
    ASSERT_EQ(p.next(&f), ParseResult::FRAME);
    EXPECT_EQ(f.cmd, CMD_SET_DO);
    EXPECT_EQ(f.seq, 42);
    ASSERT_EQ(f.len, sizeof(payload));
    EXPECT_EQ(0, memcmp(f.payload, payload, sizeof(payload)));
}

TEST(IopFrame, MultiChunkFeed)
{
    const uint8_t payload[] = {0xDE, 0xAD};
    uint8_t out[IOP_MAX_FRAME];
    const size_t n = build_frame(CMD_SET_DO, 7, payload, sizeof(payload), out);

    FrameParser p;
    ParsedFrame f;
    /* nạp từng byte một — phải NEED_MORE cho tới byte cuối */
    for (size_t i = 0; i + 1 < n; i++) {
        p.feed(out + i, 1);
        EXPECT_EQ(p.next(&f), ParseResult::NEED_MORE);
    }
    p.feed(out + n - 1, 1);
    ASSERT_EQ(p.next(&f), ParseResult::FRAME);
    EXPECT_EQ(f.seq, 7);
}

TEST(IopFrame, SkipsGarbageBeforeSof)
{
    uint8_t out[IOP_MAX_FRAME];
    const size_t n = build_frame(CMD_GET_IO, 1, nullptr, 0, out);

    FrameParser p;
    const uint8_t garbage[] = {0x00, 0x12, 0x55};   /* không có SOF */
    p.feed(garbage, sizeof(garbage));
    p.feed(out, n);
    ParsedFrame f;
    ASSERT_EQ(p.next(&f), ParseResult::FRAME);
    EXPECT_EQ(f.cmd, CMD_GET_IO);
}

TEST(IopFrame, BadLenReportsErrorAndResyncs)
{
    FrameParser p;
    const uint8_t bad[] = {0xAA, 0xFF};   /* LEN=255 > IOP_MAX_PAYLOAD=252 */
    p.feed(bad, sizeof(bad));
    ParsedFrame f;
    ParseError err;
    EXPECT_EQ(p.next(&f, &err), ParseResult::ERROR);
    EXPECT_EQ(err, ParseError::BAD_LEN);
    EXPECT_EQ(p.bad_len_count(), 1u);

    /* sau resync vẫn parse được frame tốt */
    uint8_t out[IOP_MAX_FRAME];
    const size_t n = build_frame(CMD_GET_IO, 2, nullptr, 0, out);
    p.feed(out, n);
    while (true) {
        const ParseResult r = p.next(&f, &err);
        if (r == ParseResult::FRAME) break;
        ASSERT_NE(r, ParseResult::NEED_MORE) << "frame tốt phải parse được sau resync";
    }
    EXPECT_EQ(f.seq, 2);
}

TEST(IopFrame, CrcFailReportsError)
{
    uint8_t out[IOP_MAX_FRAME];
    const size_t n = build_frame(CMD_GET_IO, 1, nullptr, 0, out);
    out[n - 1] ^= 0xFF;   /* hỏng CRC LO */

    FrameParser p;
    p.feed(out, n);
    ParsedFrame f;
    ParseError err;
    EXPECT_EQ(p.next(&f, &err), ParseResult::ERROR);
    EXPECT_EQ(err, ParseError::CRC_FAIL);
    EXPECT_EQ(p.crc_err_count(), 1u);
}

TEST(IopFrame, TwoFramesInOneFeed)
{
    uint8_t a[IOP_MAX_FRAME], b[IOP_MAX_FRAME];
    const size_t na = build_frame(CMD_GET_IO, 1, nullptr, 0, a);
    const size_t nb = build_frame(CMD_GET_DIAG, 2, nullptr, 0, b);

    FrameParser p;
    p.feed(a, na);
    p.feed(b, nb);
    ParsedFrame f;
    ASSERT_EQ(p.next(&f), ParseResult::FRAME);
    EXPECT_EQ(f.cmd, CMD_GET_IO);
    ASSERT_EQ(p.next(&f), ParseResult::FRAME);
    EXPECT_EQ(f.cmd, CMD_GET_DIAG);
    EXPECT_EQ(p.next(&f), ParseResult::NEED_MORE);
}
