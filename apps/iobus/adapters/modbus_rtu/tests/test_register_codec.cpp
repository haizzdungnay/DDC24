/**
 * @file  test_register_codec.cpp
 * @brief TC-10-02: register codec endian/scale vectors (MOD-004).
 */
#include <gtest/gtest.h>
#include "register_codec.hpp"

using namespace iobus::fieldbus;

TEST(RegisterCodec, Uint16Identity)
{
    uint16_t regs[] = {1234};
    EXPECT_FLOAT_EQ(decode_register(regs, 1, PointType::Uint16, ByteOrder::AB, 1.0f, 0.0f), 1234.0f);
}

TEST(RegisterCodec, Int16Negative)
{
    uint16_t regs[] = {static_cast<uint16_t>(-100)};
    EXPECT_FLOAT_EQ(decode_register(regs, 1, PointType::Int16, ByteOrder::AB, 1.0f, 0.0f), -100.0f);
}

TEST(RegisterCodec, BoolNonZero)
{
    uint16_t regs[] = {5};
    EXPECT_FLOAT_EQ(decode_register(regs, 1, PointType::Bool, ByteOrder::AB, 1.0f, 0.0f), 1.0f);
    uint16_t zero[] = {0};
    EXPECT_FLOAT_EQ(decode_register(zero, 1, PointType::Bool, ByteOrder::AB, 1.0f, 0.0f), 0.0f);
}

TEST(RegisterCodec, Float32ABCD)
{
    /* 1.0f = 0x3F800000; AB word order: regs[0]=0x3F80, regs[1]=0x0000 */
    uint16_t regs[] = {0x3F80, 0x0000};
    EXPECT_NEAR(decode_register(regs, 2, PointType::Float32, ByteOrder::ABCD, 1.0f, 0.0f),
                1.0f, 1e-6f);
}

TEST(RegisterCodec, Float32CDAB)
{
    /* 1.0f CDAB: regs[0]=0x0000, regs[1]=0x3F80 */
    uint16_t regs[] = {0x0000, 0x3F80};
    EXPECT_NEAR(decode_register(regs, 2, PointType::Float32, ByteOrder::CDAB, 1.0f, 0.0f),
                1.0f, 1e-6f);
}

TEST(RegisterCodec, Float32BADCAndDCBA)
{
    /* 1.0f = bytes 3F 80 00 00. BADC đảo byte trong từng word; DCBA đảo cả
     * byte lẫn word. Hai tổ hợp này đến từ cấu hình BE byte_order+word_order. */
    uint16_t badc[] = {0x803F, 0x0000};
    uint16_t dcba[] = {0x0000, 0x803F};
    EXPECT_NEAR(decode_register(badc, 2, PointType::Float32, ByteOrder::BADC, 1.0f, 0.0f), 1.0f, 1e-6f);
    EXPECT_NEAR(decode_register(dcba, 2, PointType::Float32, ByteOrder::DCBA, 1.0f, 0.0f), 1.0f, 1e-6f);
}

TEST(RegisterCodec, ScaleOffset)
{
    uint16_t regs[] = {100};
    /* scale=0.1, offset=0 → 10.0 */
    EXPECT_NEAR(decode_register(regs, 1, PointType::Uint16, ByteOrder::AB, 0.1f, 0.0f),
                10.0f, 1e-5f);
    /* scale=0.1, offset=-5 → 5.0 */
    EXPECT_NEAR(decode_register(regs, 1, PointType::Uint16, ByteOrder::AB, 0.1f, -5.0f),
                5.0f, 1e-5f);
}

TEST(RegisterCodec, EncodeDecodeRoundTrip)
{
    uint16_t regs[2] = {};
    ASSERT_TRUE(encode_register(25.5f, regs, 2, PointType::Float32, ByteOrder::ABCD, 1.0f, 0.0f));
    const float back = decode_register(regs, 2, PointType::Float32, ByteOrder::ABCD, 1.0f, 0.0f);
    EXPECT_NEAR(back, 25.5f, 1e-4f);
}

TEST(RegisterCodec, EncodeDecodeRoundTripAllOrders)
{
    for (const auto order : {ByteOrder::ABCD, ByteOrder::CDAB, ByteOrder::BADC, ByteOrder::DCBA}) {
        uint16_t regs[2] = {};
        ASSERT_TRUE(encode_register(-17.25f, regs, 2, PointType::Float32, order, 0.5f, 3.0f));
        EXPECT_NEAR(decode_register(regs, 2, PointType::Float32, order, 0.5f, 3.0f), -17.25f, 1e-4f);
    }
}

TEST(RegisterCodec, InsufficientCountReturnsZero)
{
    uint16_t regs[] = {0x1234};
    /* Float32 cần count=2 */
    EXPECT_FLOAT_EQ(decode_register(regs, 1, PointType::Float32, ByteOrder::ABCD, 1.0f, 0.0f), 0.0f);
}
