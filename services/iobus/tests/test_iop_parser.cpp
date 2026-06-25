/**
 * @file  test_iop_parser.cpp
 * @brief Byte layout IO_RESP v2 (74B) / DIAG_RESP (20B) per ADR-010.
 *        UI_RAW: 16 × int32 BE signed. Offset: [0..63] UI, [64] ADC1_STAT,
 *        [65] ADC2_STAT, [66..67] MCU_TEMP, [68..69] FAULT_FLAGS,
 *        [70..71] SAMPLE_CNT, [72] DO_FB_MASK, [73] reserved.
 */
#include <gtest/gtest.h>

#include <cstring>

#include "iop/iop_parser.hpp"

using namespace iobus;

namespace {
void put_be32s(uint8_t* p, int32_t v)
{
    const uint32_t u = static_cast<uint32_t>(v);
    p[0] = static_cast<uint8_t>(u >> 24);
    p[1] = static_cast<uint8_t>(u >> 16);
    p[2] = static_cast<uint8_t>(u >> 8);
    p[3] = static_cast<uint8_t>(u);
}
void put_be16(uint8_t* p, uint16_t v) { p[0] = static_cast<uint8_t>(v >> 8); p[1] = static_cast<uint8_t>(v); }
}

TEST(IopParser, IoRespAllZeroUi)
{
    /* 16 UI = 0, ADC_STAT = DRDY_OK, TEMP=250 (25.0°C), FAULT=0, CNT=100, DO_FB=0 */
    uint8_t p[IOP_IO_RESP_LEN] = {};
    p[64] = IOP_ADC_STAT_DRDY_OK;
    p[65] = IOP_ADC_STAT_DRDY_OK;
    put_be16(p + 66, static_cast<uint16_t>(250));
    put_be16(p + 70, 100);

    IopIoResp r;
    ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r));
    for (int i = 0; i < 16; i++) EXPECT_EQ(r.ui_raw[i], 0);
    EXPECT_EQ(r.adc1_stat,    IOP_ADC_STAT_DRDY_OK);
    EXPECT_EQ(r.adc2_stat,    IOP_ADC_STAT_DRDY_OK);
    EXPECT_EQ(r.mcu_temp_x10, 250);
    EXPECT_EQ(r.fault_flags,  0u);
    EXPECT_EQ(r.sample_cnt,   100u);
    EXPECT_EQ(r.do_fb_mask,   0u);
}

TEST(IopParser, IoRespUi32BitSignedBigEndian)
{
    uint8_t p[IOP_IO_RESP_LEN] = {};
    /* UI1 = +8388607 at offset 0; UI16 = -1 at offset 60 */
    put_be32s(p + 0,  8388607);
    put_be32s(p + 60, -1);

    IopIoResp r;
    ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r));
    EXPECT_EQ(r.ui_raw[0],  8388607);
    EXPECT_EQ(r.ui_raw[15], -1);
    for (int i = 1; i < 15; i++) EXPECT_EQ(r.ui_raw[i], 0);
}

TEST(IopParser, IoRespNegativeTempAndFaultsV2)
{
    uint8_t p[IOP_IO_RESP_LEN] = {};
    put_be16(p + 66, static_cast<uint16_t>(-100));  /* -10.0°C */
    /* ADC1_FAULT(bit0) | UI_OV(bit3) | WDG_RESET(bit5) */
    put_be16(p + 68, IOP_FAULT_ADC1 | IOP_FAULT_UI_OV | IOP_FAULT_WDG_RESET);

    IopIoResp r;
    ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r));
    EXPECT_EQ(r.mcu_temp_x10, -100);
    EXPECT_EQ(r.fault_flags,  IOP_FAULT_ADC1 | IOP_FAULT_UI_OV | IOP_FAULT_WDG_RESET);
}

TEST(IopParser, IoRespAdcStatAndDoFb)
{
    uint8_t p[IOP_IO_RESP_LEN] = {};
    p[64] = IOP_ADC_STAT_DRDY_OK;
    p[65] = IOP_ADC_STAT_LOCK | IOP_ADC_STAT_CRC_FAULT;
    p[72] = 0x05;   /* DO1+DO3 feedback on */

    IopIoResp r;
    ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r));
    EXPECT_EQ(r.adc1_stat,  IOP_ADC_STAT_DRDY_OK);
    EXPECT_EQ(r.adc2_stat,  IOP_ADC_STAT_LOCK | IOP_ADC_STAT_CRC_FAULT);
    EXPECT_EQ(r.do_fb_mask, 0x05u);
}

TEST(IopParser, IoRespRejectsWrongLen)
{
    uint8_t p[IOP_IO_RESP_LEN] = {};
    IopIoResp r;
    EXPECT_FALSE(parse_io(p, IOP_IO_RESP_LEN - 1, &r));
    EXPECT_FALSE(parse_io(p, 34, &r));   /* old v1 length — must reject */
    EXPECT_FALSE(parse_io(p, 0, &r));
}

TEST(IopParser, IoRespFaultBitPositionsV2)
{
    const struct { uint16_t bit; const char* name; } cases[] = {
        { IOP_FAULT_ADC1,         "ADC1" },
        { IOP_FAULT_ADC2,         "ADC2" },
        { IOP_FAULT_DAC,          "DAC" },
        { IOP_FAULT_UI_OV,        "UI_OV" },
        { IOP_FAULT_RELAY_STUCK,  "RELAY_STUCK" },
        { IOP_FAULT_WDG_RESET,    "WDG_RESET" },
        { IOP_FAULT_MCU_OVERTEMP, "MCU_OVERTEMP" },
        { IOP_FAULT_VDD,          "VDD" },
    };
    for (const auto& c : cases) {
        uint8_t p[IOP_IO_RESP_LEN] = {};
        put_be16(p + 68, c.bit);
        IopIoResp r;
        ASSERT_TRUE(parse_io(p, IOP_IO_RESP_LEN, &r)) << c.name;
        EXPECT_EQ(r.fault_flags, c.bit) << c.name;
    }
}

TEST(IopParser, DiagRespOffsets)
{
    uint8_t p[IOP_DIAG_RESP_LEN] = {};
    auto be16 = [&](int off, uint16_t v) {
        p[off] = static_cast<uint8_t>(v >> 8);
        p[off + 1] = static_cast<uint8_t>(v);
    };
    be16(0, 0x0102);
    be16(2, 3600);
    be16(4, 50000);
    be16(6, 3);
    be16(8, 1);
    be16(10, 2);
    be16(12, 1000);
    be16(14, static_cast<uint16_t>(-50));
    be16(16, 3299);

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
