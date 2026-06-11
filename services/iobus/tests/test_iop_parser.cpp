/**
 * @file  test_iop_parser.cpp
 * @brief Byte layout IO_RESP/DIAG_RESP đúng offset 05 §6, big-endian, s24.
 */
#include <gtest/gtest.h>

#include <cstring>

#include "iop/iop_parser.hpp"

using namespace iobus;

TEST(IopParser, IoRespOffsetsAndEndianness)
{
    /* Ví dụ từ SWFW spec §10.2: 8×UI=0, DI=0xFF, DO_FB=0x00, TEMP=250 (25.0°C),
     * FAULT=0, SAMPLE_CNT=100 */
    uint8_t p[IOP_IO_RESP_LEN] = {};
    p[24] = 0xFF;
    p[25] = 0x00;
    p[26] = 0x00; p[27] = 0xFA;   /* 250 BE */
    p[28] = 0x00; p[29] = 0x00;
    p[30] = 0x00; p[31] = 0x64;   /* 100 BE */

    IopIoResp r;
    ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r));
    for (int i = 0; i < 8; i++) EXPECT_EQ(r.ui_raw[i], 0u);
    EXPECT_EQ(r.di_mask, 0xFF);
    EXPECT_EQ(r.do_fb_mask, 0x00);
    EXPECT_EQ(r.mcu_temp_x10, 250);
    EXPECT_EQ(r.fault_flags, 0);
    EXPECT_EQ(r.sample_cnt, 100);
}

TEST(IopParser, IoRespUi24BitBigEndian)
{
    uint8_t p[IOP_IO_RESP_LEN] = {};
    /* UI1 = 0x123456; UI8 = 0xFFFFFF (s24 = -1) */
    p[0] = 0x12; p[1] = 0x34; p[2] = 0x56;
    p[21] = 0xFF; p[22] = 0xFF; p[23] = 0xFF;

    IopIoResp r;
    ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r));
    EXPECT_EQ(r.ui_raw[0], 0x123456u);
    EXPECT_EQ(r.ui_raw[7], 0xFFFFFFu);
    /* sign-extend qua iop_s24 */
    const uint8_t be[3] = {0xFF, 0xFF, 0xFF};
    EXPECT_EQ(iop_s24(be), -1);
}

TEST(IopParser, IoRespNegativeTempAndFaults)
{
    uint8_t p[IOP_IO_RESP_LEN] = {};
    p[26] = 0xFF; p[27] = 0x9C;   /* -100 = -10.0°C */
    p[28] = 0x00; p[29] = 0x15;   /* ADC|UI_OV|WDG_RESET = bit0|2|4 = 0x15 */

    IopIoResp r;
    ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r));
    EXPECT_EQ(r.mcu_temp_x10, -100);
    EXPECT_EQ(r.fault_flags, IOP_FAULT_ADC | IOP_FAULT_UI_OV | IOP_FAULT_WDG_RESET);
}

TEST(IopParser, IoRespRejectsWrongLen)
{
    uint8_t p[IOP_IO_RESP_LEN] = {};
    IopIoResp r;
    EXPECT_FALSE(parse_io(p, IOP_IO_RESP_LEN - 1, &r));
    EXPECT_FALSE(parse_io(p, 0, &r));
}

TEST(IopParser, DiagRespOffsets)
{
    uint8_t p[IOP_DIAG_RESP_LEN] = {};
    auto be16 = [&](int off, uint16_t v) {
        p[off] = static_cast<uint8_t>(v >> 8);
        p[off + 1] = static_cast<uint8_t>(v);
    };
    be16(0, 0x0102);   /* FW 1.2 */
    be16(2, 3600);     /* uptime */
    be16(4, 50000);    /* rx */
    be16(6, 3);        /* crc err */
    be16(8, 1);        /* seq err */
    be16(10, 2);       /* wdg resets */
    be16(12, 1000);    /* adc rate */
    be16(14, static_cast<uint16_t>(-50));  /* temp max -5.0°C */
    be16(16, 3299);    /* vdd */

    IopDiagResp d;
    ASSERT_TRUE(parse_diag(p, IOP_DIAG_RESP_LEN, &d));
    EXPECT_EQ(d.fw_version, 0x0102);
    EXPECT_EQ(d.uptime_s, 3600);
    EXPECT_EQ(d.rx_count, 50000);
    EXPECT_EQ(d.crc_error_count, 3);
    EXPECT_EQ(d.seq_error_count, 1);
    EXPECT_EQ(d.watchdog_reset_count, 2);
    EXPECT_EQ(d.adc_sample_rate, 1000);
    EXPECT_EQ(d.mcu_temp_max_x10, -50);
    EXPECT_EQ(d.vdd_mv, 3299);
}

TEST(IopParser, DiagRespRejectsWrongLen)
{
    uint8_t p[IOP_DIAG_RESP_LEN] = {};
    IopDiagResp d;
    EXPECT_FALSE(parse_diag(p, IOP_DIAG_RESP_LEN + 1, &d));
}
