/**
 * @file  test_register_codec.cpp
 * @brief TC-10-02: register codec endian/scale vectors (MOD-004).
 */
#include <gtest/gtest.h>

#include <limits>

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

/* ---- D-01/D-02: encode phải FAIL-CLOSED (sửa 2026-08-04) ----
 *
 * Trước bản sửa: encode_register ép float → integral mà không kiểm dải, tức
 * undefined behavior theo [conv.fpint]/1; và scale=0 cho raw=0 rồi trả TRUE,
 * ghi im lặng số 0 xuống thiết bị. Đường vào là plc_shm.ext[i].setpoint do node
 * graph ghi — không có clamp ở bất kỳ tầng nào.
 *
 * Các test dưới đây khẳng định: mọi đầu vào không biểu diễn được đều trả false
 * và KHÔNG chạm vào regs[]. */

namespace {
/* Sentinel để chứng minh regs[] không bị ghi khi encode thất bại. */
constexpr uint16_t kUntouched = 0xA5A5;
}

TEST(RegisterCodecEncodeGuard, ScaleZeroRejected)
{
    uint16_t regs[2] = {kUntouched, kUntouched};
    EXPECT_FALSE(encode_register(10.0f, regs, 2, PointType::Uint16, ByteOrder::AB, 0.0f, 0.0f));
    EXPECT_EQ(regs[0], kUntouched);
}

TEST(RegisterCodecEncodeGuard, NonFiniteScaleOrOffsetRejected)
{
    uint16_t regs[2] = {kUntouched, kUntouched};
    const float inf = std::numeric_limits<float>::infinity();
    const float nan = std::numeric_limits<float>::quiet_NaN();
    EXPECT_FALSE(encode_register(1.0f, regs, 2, PointType::Uint16, ByteOrder::AB, inf, 0.0f));
    EXPECT_FALSE(encode_register(1.0f, regs, 2, PointType::Uint16, ByteOrder::AB, nan, 0.0f));
    EXPECT_FALSE(encode_register(1.0f, regs, 2, PointType::Uint16, ByteOrder::AB, 1.0f, inf));
    EXPECT_EQ(regs[0], kUntouched);
}

TEST(RegisterCodecEncodeGuard, NonFiniteValueRejected)
{
    uint16_t regs[2] = {kUntouched, kUntouched};
    const float inf = std::numeric_limits<float>::infinity();
    const float nan = std::numeric_limits<float>::quiet_NaN();
    for (const auto type : {PointType::Int16, PointType::Uint16, PointType::Int32,
                            PointType::Uint32, PointType::Float32}) {
        EXPECT_FALSE(encode_register(nan, regs, 2, type, ByteOrder::ABCD, 1.0f, 0.0f));
        EXPECT_FALSE(encode_register(inf, regs, 2, type, ByteOrder::ABCD, 1.0f, 0.0f));
        EXPECT_FALSE(encode_register(-inf, regs, 2, type, ByteOrder::ABCD, 1.0f, 0.0f));
    }
    EXPECT_EQ(regs[0], kUntouched);
}

TEST(RegisterCodecEncodeGuard, OutOfRangeRejectedPerType)
{
    uint16_t regs[2] = {kUntouched, kUntouched};
    struct Case { PointType type; float below; float above; };
    /* Biên chọn cách xa để phép làm tròn không đưa giá trị trở lại trong dải. */
    const Case cases[] = {
        {PointType::Int16,  -32769.0f,      32768.0f},
        {PointType::Uint16,     -1.0f,      65536.0f},
        {PointType::Int32,  -2147484000.0f, 2147484000.0f},
        {PointType::Uint32,     -1.0f,      4294968000.0f},
    };
    for (const auto& c : cases) {
        EXPECT_FALSE(encode_register(c.below, regs, 2, c.type, ByteOrder::ABCD, 1.0f, 0.0f));
        EXPECT_FALSE(encode_register(c.above, regs, 2, c.type, ByteOrder::ABCD, 1.0f, 0.0f));
    }
    EXPECT_EQ(regs[0], kUntouched);
}

TEST(RegisterCodecEncodeGuard, InRangeBoundariesAccepted)
{
    uint16_t regs[2] = {};
    EXPECT_TRUE(encode_register(-32768.0f, regs, 1, PointType::Int16, ByteOrder::AB, 1.0f, 0.0f));
    EXPECT_TRUE(encode_register(32767.0f, regs, 1, PointType::Int16, ByteOrder::AB, 1.0f, 0.0f));
    EXPECT_TRUE(encode_register(0.0f, regs, 1, PointType::Uint16, ByteOrder::AB, 1.0f, 0.0f));
    EXPECT_TRUE(encode_register(65535.0f, regs, 1, PointType::Uint16, ByteOrder::AB, 1.0f, 0.0f));
    /* 4294967040 = 2^32 - 256, giá trị lớn nhất < 2^32 mà float biểu diễn ĐÚNG. */
    EXPECT_TRUE(encode_register(4294967040.0f, regs, 2, PointType::Uint32, ByteOrder::ABCD, 1.0f, 0.0f));
}

/* Hệ quả của việc contract v1 dùng `float` làm kiểu truyền: UINT32_MAX không
 * biểu diễn được. `4294967295.0f` được compiler làm tròn thành 4294967296.0f
 * (đúng 2^32), tức đã NGOÀI dải uint32 trước khi tới hàm encode.
 *
 * Guard từ chối là ĐÚNG: thà không ghi còn hơn ghi 0 do tràn. Nhưng nó cho thấy
 * giới hạn thật của contract hiện tại — float chỉ giữ chính xác số nguyên tới
 * 2^24. Đây chính là lý do Track B (DDD-DM-MBRTU-001 §9 G-DM-04) chuyển sample
 * và setpoint sang `double`. Test này khoá lại hành vi hiện tại để lần đổi
 * contract sau phải cập nhật nó một cách có ý thức. */
TEST(RegisterCodecEncodeGuard, Uint32MaxNotRepresentableInFloatIsRejected)
{
    uint16_t regs[2] = {kUntouched, kUntouched};
    EXPECT_EQ(static_cast<double>(4294967295.0f), 4294967296.0);
    EXPECT_FALSE(encode_register(4294967295.0f, regs, 2, PointType::Uint32,
                                 ByteOrder::ABCD, 1.0f, 0.0f));
    EXPECT_EQ(regs[0], kUntouched);
}

/* Scale/offset đưa giá trị kỹ thuật hợp lệ về raw ngoài dải — vẫn phải chặn.
 * Ví dụ đời thực: Point uint16 với scale 0.001 (đọc 0..65.535), logic ghi 100. */
TEST(RegisterCodecEncodeGuard, ScaleDrivenOverflowRejected)
{
    uint16_t regs[1] = {kUntouched};
    EXPECT_FALSE(encode_register(100.0f, regs, 1, PointType::Uint16, ByteOrder::AB, 0.001f, 0.0f));
    EXPECT_EQ(regs[0], kUntouched);
    /* Trong dải thì vẫn phải ghi được. */
    EXPECT_TRUE(encode_register(65.0f, regs, 1, PointType::Uint16, ByteOrder::AB, 0.001f, 0.0f));
}

TEST(RegisterCodecEncodeGuard, RoundingIsNearestTiesAwayFromZero)
{
    uint16_t regs[1] = {};
    ASSERT_TRUE(encode_register(2.5f, regs, 1, PointType::Uint16, ByteOrder::AB, 1.0f, 0.0f));
    EXPECT_EQ(regs[0], 3u);
    ASSERT_TRUE(encode_register(-2.5f, regs, 1, PointType::Int16, ByteOrder::AB, 1.0f, 0.0f));
    EXPECT_EQ(static_cast<int16_t>(regs[0]), -3);
}
