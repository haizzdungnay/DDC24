/**
 * @file  test_iop_crc.cpp
 * @brief IOP-SW-010 — 12 vector chuẩn (SWFW spec §10.1 / 15_CONTRACT_FREEZE §5).
 *        KHÔNG tự bịa vector khác làm chuẩn.
 */
#include <gtest/gtest.h>

#include "iop/iop_crc.hpp"

using iobus::crc16;

struct CrcVector {
    const char* name;
    const uint8_t* input;
    size_t len;
    uint16_t expect;
};

static const uint8_t V1[]  = {0xAA, 0x00, 0x01, 0x00};
static const uint8_t V2[]  = {0xAA, 0x00, 0x01, 0x01};
static const uint8_t V3[]  = {0xAA, 0x00, 0x01, 0xFF};
static const uint8_t V4[]  = {0xAA, 0x00, 0x20, 0x02};
static const uint8_t V5[]  = {0xAA, 0x04, 0x30, 0x00, 0x01, 0x01, 0x00, 0x03};
static const uint8_t V6[]  = {0xAA, 0x02, 0x11, 0x03, 0x01, 0x01};
static const uint8_t V7[]  = {0xAA, 0x02, 0x11, 0x04, 0x03, 0x01};
static const uint8_t V8[]  = {0xAA, 0x08, 0x10, 0x05, 0x80, 0x00, 0x00, 0x00,
                              0x00, 0x00, 0x00, 0x00};
static const uint8_t V9[]  = {0xAA, 0x01, 0x13, 0x06, 0x02};
static const uint8_t V10[] = {0xAA, 0x01, 0x40, 0x07, 0x05};
static const uint8_t V11[] = {0xAA, 0x01, 0x12, 0x03, 0x11};
static const uint8_t V12[] = {0xAA, 0x02, 0xFE, 0x08, 0x01, 0x03};

static const CrcVector kVectors[] = {
    {"V1 GET_IO SEQ=0",     V1,  sizeof(V1),  0x6C20},
    {"V2 GET_IO SEQ=1",     V2,  sizeof(V2),  0xACE1},
    {"V3 GET_IO SEQ=255",   V3,  sizeof(V3),  0x2C60},
    {"V4 GET_DIAG SEQ=2",   V4,  sizeof(V4),  0xFDB9},
    {"V5 HANDSHAKE SEQ=0",  V5,  sizeof(V5),  0x019A},
    {"V6 SET_DO SEQ=3",     V6,  sizeof(V6),  0xBD54},
    {"V7 SET_DO SEQ=4",     V7,  sizeof(V7),  0x1CE4},
    {"V8 SET_AO SEQ=5",     V8,  sizeof(V8),  0x1EE3},
    {"V9 SET_AO_CFG SEQ=6", V9,  sizeof(V9),  0x404E},
    {"V10 RESET_IO SEQ=7",  V10, sizeof(V10), 0x03FE},
    {"V11 ACK SEQ=3",       V11, sizeof(V11), 0x1D5D},
    {"V12 NACK SEQ=8",      V12, sizeof(V12), 0x6A90},
};

TEST(IopCrc, TwelveStandardVectors)
{
    for (const auto& v : kVectors)
        EXPECT_EQ(crc16(v.input, v.len), v.expect) << v.name;
}

/* 2 vector tra nhanh — assert riêng theo plan SOM-IOP-001 */
TEST(IopCrc, QuickReferenceVectors)
{
    const uint8_t v1[] = {0xAA, 0x00, 0x01, 0x00};
    const uint8_t v2[] = {0xAA, 0x00, 0x01, 0x01};
    EXPECT_EQ(crc16(v1, sizeof(v1)), 0x6C20);
    EXPECT_EQ(crc16(v2, sizeof(v2)), 0xACE1);
}
