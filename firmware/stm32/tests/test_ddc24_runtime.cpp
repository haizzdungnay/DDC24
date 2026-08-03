#include <gtest/gtest.h>

#include <array>
#include <vector>

extern "C" {
#include "ddc24_runtime.h"
}

namespace {
std::vector<uint8_t> tx;
std::array<uint16_t, 4> appliedAo{};
uint8_t appliedDo = 0xFF;
int aoCalls = 0, doCalls = 0;

void uartTx(const uint8_t* data, uint16_t len) { tx.assign(data, data + len); }
bool applyAo(const uint16_t raw[4], uint8_t) { std::copy(raw, raw + 4, appliedAo.begin()); aoCalls++; return true; }
bool applyDo(uint8_t value) { appliedDo = value; doCalls++; return true; }
bool sample(int32_t ui[16], uint8_t* a1, uint8_t* a2, int16_t* temp, uint16_t* faults, uint8_t* feedback)
{
    for (int i = 0; i < 16; i++) ui[i] = i - 8;
    *a1 = IOP_ADC_STAT_DRDY_OK; *a2 = IOP_ADC_STAT_DRDY_OK; *temp = 321;
    *faults = 0; *feedback = appliedDo; return true;
}

void sendFrame(ddc24_runtime_t& runtime, uint8_t cmd, uint8_t seq,
               const std::vector<uint8_t>& payload, uint32_t now)
{
    uint8_t frame[IOP_MAX_FRAME];
    const uint16_t len = iop_build_frame(frame, cmd, seq,
        payload.empty() ? nullptr : payload.data(), static_cast<uint16_t>(payload.size()));
    for (uint16_t i = 0; i < len; i++) ddc24_runtime_rx_byte(&runtime, frame[i], now);
}

iop_frame_t parseTx(iop_rx_t& rx)
{
    iop_frame_t result{};
    for (uint8_t byte : tx) (void)iop_rx_push(&rx, byte, &result);
    return result;
}
}

TEST(Ddc24Runtime, StartupAppliesPhysicalSafeStateBeforeHandshake)
{
    tx.clear(); aoCalls = doCalls = 0; appliedDo = 0xFF; appliedAo.fill(0xFFFF);
    ddc24_hal_t hal{sample, applyAo, applyDo, uartTx}; ddc24_runtime_t runtime{};
    ddc24_runtime_init(&runtime, &hal, 0);
    EXPECT_TRUE(runtime.safe_active); EXPECT_EQ(runtime.safe_entries, 1u);
    EXPECT_EQ(appliedDo, 0u); EXPECT_EQ(appliedAo, (std::array<uint16_t, 4>{0,0,0,0}));
}

TEST(Ddc24Runtime, AppliesAoAndRelayAndDoesNotExecuteDuplicateSequenceTwice)
{
    tx.clear(); aoCalls = doCalls = 0;
    ddc24_hal_t hal{sample, applyAo, applyDo, uartTx}; ddc24_runtime_t runtime{};
    ddc24_runtime_init(&runtime, &hal, 0); aoCalls = doCalls = 0;
    sendFrame(runtime, CMD_SET_AO, 1, {0,1, 0,2, 0,3, 0,4}, 10);
    EXPECT_EQ(appliedAo, (std::array<uint16_t, 4>{1,2,3,4})); EXPECT_EQ(aoCalls, 1);
    sendFrame(runtime, CMD_SET_AO, 1, {0,9, 0,9, 0,9, 0,9}, 11);
    EXPECT_EQ(aoCalls, 1);
    sendFrame(runtime, CMD_SET_DO, 2, {0x0F, 0x05}, 12);
    EXPECT_EQ(appliedDo, 0x05); EXPECT_EQ(doCalls, 1);
}

TEST(Ddc24Runtime, SamplesSixteenAdcChannelsAndReportsFaults)
{
    tx.clear(); ddc24_hal_t hal{sample, applyAo, applyDo, uartTx}; ddc24_runtime_t runtime{};
    ddc24_runtime_init(&runtime, &hal, 0);
    sendFrame(runtime, CMD_HANDSHAKE, 1, {IOP_VER_MAJOR, IOP_VER_MINOR, 0, 0}, 5);
    sendFrame(runtime, CMD_GET_IO, 2, {}, 6);
    iop_rx_t rx{}; iop_rx_reset(&rx); const iop_frame_t response = parseTx(rx);
    ASSERT_EQ(response.cmd, CMD_IO_RESP); ASSERT_EQ(response.len, IOP_IO_RESP_LEN);
    EXPECT_EQ(iop_be32s(response.payload), -8); EXPECT_EQ(iop_be32s(response.payload + 60), 7);
    EXPECT_EQ(iop_be16(response.payload + 68), 0u);
}

TEST(Ddc24Runtime, LossOfSomForTwoHundredMillisecondsAppliesRealSafeCallbacks)
{
    tx.clear(); aoCalls = doCalls = 0;
    ddc24_hal_t hal{sample, applyAo, applyDo, uartTx}; ddc24_runtime_t runtime{};
    ddc24_runtime_init(&runtime, &hal, 0);
    sendFrame(runtime, CMD_HANDSHAKE, 1, {IOP_VER_MAJOR, IOP_VER_MINOR, 0, 0}, 100);
    sendFrame(runtime, CMD_SET_DO, 2, {0x0F, 0x0F}, 110);
    const int callsBefore = doCalls;
    /* Watchdog được gia hạn bởi mọi frame hợp lệ, không chỉ HANDSHAKE. Frame
     * SET_DO ở 110 ms là bằng chứng link gần nhất, nên mốc safe là 310 ms. */
    ddc24_runtime_tick(&runtime, 110 + IOP_SAFE_TIMEOUT_MS - 1); EXPECT_EQ(doCalls, callsBefore);
    ddc24_runtime_tick(&runtime, 110 + IOP_SAFE_TIMEOUT_MS); EXPECT_GT(doCalls, callsBefore); EXPECT_EQ(appliedDo, 0u);
}
