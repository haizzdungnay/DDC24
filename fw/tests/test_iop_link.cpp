/**
 * Cross-test lớp khung IOP của FIRMWARE MCU — chạy trên host.
 *
 * Bo mạch chưa fab nên chưa có STM32 nào để nạp. Nhưng phần dễ sai nhất của
 * firmware không phụ thuộc phần cứng: endian, độ dài payload, CRC, quy tắc SEQ,
 * khi nào phải NACK. Sai một byte ở đây thì SOM và MCU không nói chuyện được, và
 * trên bàn debug nó biểu hiện thành "đường truyền nhiễu" chứ không thành một lỗi
 * rõ ràng — loại lỗi tốn nhiều ngày nhất để tìm.
 *
 * Vì `fw/src/iop/iop_link.c` là C thuần không chạm HAL, nó biên dịch được cho cả
 * host lẫn `arm-none-eabi`, nên kiểm được ngay hôm nay bằng chính `ctest` của dự
 * án — đối chiếu với `shared/iop_protocol.h` (nguồn chuẩn, ADR-010) và với
 * parser phía SOM trong `services/iobus/iop/`.
 */
#include <gtest/gtest.h>

#include <cstring>
#include <vector>

extern "C" {
#include "iop_link.h"
}

namespace {

std::vector<uint8_t> build(uint8_t cmd, uint8_t seq, const std::vector<uint8_t>& payload)
{
    std::vector<uint8_t> out(IOP_MAX_FRAME, 0u);
    const uint16_t n = iop_build_frame(out.data(), cmd, seq,
                                       payload.empty() ? nullptr : payload.data(),
                                       static_cast<uint16_t>(payload.size()));
    out.resize(n);
    return out;
}

/** Nạp cả buffer từng byte một, trả về status của byte cuối cùng. */
iop_rx_status_t feed(iop_rx_t& rx, const std::vector<uint8_t>& bytes, iop_frame_t& frame)
{
    iop_rx_status_t status = IOP_RX_IDLE;
    for (uint8_t b : bytes) status = iop_rx_push(&rx, b, &frame);
    return status;
}

}  // namespace

/* ── CRC: khớp đúng test vector ghi trong hợp đồng ────────────────────────── */

TEST(IopLinkCrc, MatchesTheVectorsWrittenIntoTheContractHeader)
{
    // `shared/iop_protocol.h` ghi rõ hai vector này kèm câu "PHẢI khớp FW & BE".
    const uint8_t a[] = { 0xAA, 0x00, 0x01, 0x00 };
    const uint8_t b[] = { 0xAA, 0x00, 0x01, 0x01 };
    EXPECT_EQ(iop_crc16(a, sizeof(a)), 0x6C20u);
    EXPECT_EQ(iop_crc16(b, sizeof(b)), 0xACE1u);
}

TEST(IopLinkCrc, GetIoFrameMatchesTheGoldenBytesByteForByte)
{
    // Hợp đồng ghi: "Frame GET_IO SEQ=1 hoàn chỉnh: AA 00 01 01 AC E1".
    // Đây là bài kiểm chặt nhất có thể làm mà không cần phần cứng.
    const std::vector<uint8_t> expected{ 0xAA, 0x00, 0x01, 0x01, 0xAC, 0xE1 };
    EXPECT_EQ(build(CMD_GET_IO, 1u, {}), expected);
}

TEST(IopLinkCrc, CrcIsTransmittedHiByteFirst)
{
    // Đảo thứ tự HI/LO là lỗi kinh điển và im lặng: CRC vẫn "hợp lệ" với chính
    // mình nhưng phía kia từ chối mọi frame.
    const auto frame = build(CMD_GET_IO, 1u, {});
    const uint16_t crc = iop_crc16(frame.data(), static_cast<uint16_t>(frame.size() - IOP_CRC_LEN));
    EXPECT_EQ(frame[frame.size() - 2u], static_cast<uint8_t>(crc >> 8));
    EXPECT_EQ(frame[frame.size() - 1u], static_cast<uint8_t>(crc & 0xFFu));
}

/* ── Bộ nhận theo byte ────────────────────────────────────────────────────── */

TEST(IopLinkRx, AcceptsAFrameDeliveredOneByteAtATime)
{
    // UART trả dữ liệu theo từng mẩu tuỳ ý; một frame hoàn toàn có thể bị cắt
    // làm đôi giữa hai lần ngắt DMA.
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    const std::vector<uint8_t> payload{ 0x01, 0x02 };

    ASSERT_EQ(feed(rx, build(CMD_SET_DO, 7u, payload), frame), IOP_RX_FRAME);
    EXPECT_EQ(frame.cmd, CMD_SET_DO);
    EXPECT_EQ(frame.seq, 7u);
    EXPECT_EQ(frame.len, IOP_SET_DO_LEN);
    EXPECT_EQ(0, std::memcmp(frame.payload, payload.data(), payload.size()));
}

TEST(IopLinkRx, SkipsGarbageBeforeSofAndCountsIt)
{
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    std::vector<uint8_t> stream{ 0x00, 0xFF, 0x12 };
    const auto good = build(CMD_GET_IO, 3u, {});
    stream.insert(stream.end(), good.begin(), good.end());

    ASSERT_EQ(feed(rx, stream, frame), IOP_RX_FRAME);
    EXPECT_EQ(frame.seq, 3u);
    // Đếm chứ không nuốt im lặng: byte rác là dấu hiệu đường truyền đang hỏng.
    EXPECT_EQ(rx.dropped_bytes, 3u);
}

TEST(IopLinkRx, ATruncatedFrameSwallowsTheNextOneWithoutAnIdleSignal)
{
    // Ghi nhận giới hạn THẬT của một máy trạng thái nạp theo byte: nó không thể
    // tự biết frame trước đã bị cắt, nên nó lấy các byte đầu của frame kế tiếp
    // để lấp cho đủ độ dài đang chờ. Frame lành bị mất.
    //
    // Test này tồn tại để không ai tưởng bộ nhận tự phục hồi được — nó không, và
    // đó là lý do phải có tín hiệu IDLE ở test ngay dưới.
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    auto truncated = build(CMD_SET_AO, 9u, std::vector<uint8_t>(IOP_SET_AO_LEN, 0x5A));
    truncated.resize(truncated.size() - 3u);
    feed(rx, truncated, frame);

    EXPECT_NE(feed(rx, build(CMD_GET_IO, 11u, {}), frame), IOP_RX_FRAME);
}

TEST(IopLinkRx, ResynchronisesAfterATruncatedFrameWhenTheLineGoesIdle)
{
    // Trên STM32, "đường truyền vừa im lặng" có sẵn dưới dạng ngắt IDLE line của
    // USART. Tầng driver gọi `iop_rx_on_line_idle()` ở đó; tầng giao thức không
    // tự đoán thời gian.
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    auto truncated = build(CMD_SET_AO, 9u, std::vector<uint8_t>(IOP_SET_AO_LEN, 0x5A));
    truncated.resize(truncated.size() - 3u);
    feed(rx, truncated, frame);

    const uint16_t abandoned = iop_rx_on_line_idle(&rx);
    EXPECT_EQ(abandoned, truncated.size());

    ASSERT_EQ(feed(rx, build(CMD_GET_IO, 11u, {}), frame), IOP_RX_FRAME);
    EXPECT_EQ(frame.seq, 11u);
}

TEST(IopLinkRx, IdleOnAnAlreadyEmptyReceiverIsANoOp)
{
    iop_rx_t rx{}; iop_rx_reset(&rx);
    EXPECT_EQ(iop_rx_on_line_idle(&rx), 0u);
    EXPECT_EQ(rx.dropped_bytes, 0u);
}

TEST(IopLinkRx, ReportsCrcFailureAndKeepsSeqSoTheNackCanAnswerTheRightFrame)
{
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    auto corrupt = build(CMD_GET_IO, 5u, {});
    corrupt.back() ^= 0xFFu;

    ASSERT_EQ(feed(rx, corrupt, frame), IOP_RX_ERR_CRC);
    EXPECT_EQ(frame.seq, 5u);      // NACK phải trả về đúng SEQ của frame hỏng
    EXPECT_EQ(rx.crc_errors, 1u);
}

TEST(IopLinkRx, RejectsALengthThatDoesNotMatchTheCommand)
{
    // Giao thức cố định độ dài theo lệnh. LEN sai nghĩa là sai phiên bản hoặc
    // luồng byte lệch khung — cả hai phải bị từ chối chứ không được đoán.
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    std::vector<uint8_t> bad{ IOP_SOF, 0x05, CMD_SET_DO, 0x01 };

    ASSERT_EQ(feed(rx, bad, frame), IOP_RX_ERR_LEN);
    EXPECT_EQ(rx.len_errors, 1u);
}

TEST(IopLinkRx, RejectsAnUnknownCommand)
{
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    std::vector<uint8_t> bad{ IOP_SOF, 0x00, 0x77, 0x01 };
    EXPECT_EQ(feed(rx, bad, frame), IOP_RX_ERR_LEN);
}

TEST(IopLinkRx, RejectsABadLengthBeforeSwallowingTheNextFrame)
{
    // Điểm mấu chốt: một LEN hỏng có thể trỏ tới 252 byte. Nếu bộ nhận tin nó
    // rồi đọc tiếp thì nó nuốt luôn frame kế tiếp, và mất frame theo chuỗi.
    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    const std::vector<uint8_t> bad_header{ IOP_SOF, 0xFC, CMD_GET_IO, 0x01 };
    ASSERT_EQ(feed(rx, bad_header, frame), IOP_RX_ERR_LEN);

    ASSERT_EQ(feed(rx, build(CMD_GET_IO, 2u, {}), frame), IOP_RX_FRAME);
    EXPECT_EQ(frame.seq, 2u);
}

/* ── Round-trip mọi lệnh của hợp đồng ─────────────────────────────────────── */

TEST(IopLinkRoundTrip, EveryCommandInTheContractSurvivesBuildThenParse)
{
    const uint8_t commands[] = {
        CMD_GET_IO, CMD_IO_RESP, CMD_SET_AO, CMD_SET_DO, CMD_ACK, CMD_SET_AO_CFG,
        CMD_GET_DIAG, CMD_DIAG_RESP, CMD_HANDSHAKE, CMD_HANDSHAKE_RESP,
        CMD_RESET_IO, CMD_NACK
    };
    for (uint8_t cmd : commands) {
        const int32_t len = iop_expected_payload_len(cmd);
        ASSERT_GE(len, 0) << "CMD 0x" << std::hex << int(cmd) << " thiếu trong bảng độ dài";

        std::vector<uint8_t> payload(static_cast<size_t>(len));
        for (size_t i = 0; i < payload.size(); ++i) payload[i] = static_cast<uint8_t>(0xA0u + i);

        iop_rx_t rx{}; iop_rx_reset(&rx);
        iop_frame_t frame{};
        ASSERT_EQ(feed(rx, build(cmd, 0x42u, payload), frame), IOP_RX_FRAME)
            << "round-trip hỏng ở CMD 0x" << std::hex << int(cmd);
        EXPECT_EQ(frame.cmd, cmd);
        EXPECT_EQ(frame.len, static_cast<uint16_t>(len));
        if (len > 0) EXPECT_EQ(0, std::memcmp(frame.payload, payload.data(), payload.size()));
    }
}

TEST(IopLinkRoundTrip, IoRespCarriesSixteenSignedInt32ChannelsBigEndian)
{
    // IOP v2 (ADR-010) đổi UI_RAW từ 8×uint24 sang 16×int32 BE. Giá trị ÂM là
    // chỗ dễ hỏng nhất: sign-extend sai thì nhiệt độ dưới 0 °C đọc ra thành một
    // số dương rất lớn, và cảnh báo quá nhiệt bắn giả.
    std::vector<uint8_t> payload(IOP_IO_RESP_LEN, 0u);
    const int32_t values[16] = { 0, -1, 1, -8388608, 8388607, -12345, 12345,
                                 -2147483648, 2147483647, 100, -100, 7, -7, 0, 42, -42 };
    for (int ch = 0; ch < 16; ++ch) {
        const uint32_t u = static_cast<uint32_t>(values[ch]);
        payload[ch * 4 + 0] = static_cast<uint8_t>(u >> 24);
        payload[ch * 4 + 1] = static_cast<uint8_t>(u >> 16);
        payload[ch * 4 + 2] = static_cast<uint8_t>(u >> 8);
        payload[ch * 4 + 3] = static_cast<uint8_t>(u);
    }

    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    ASSERT_EQ(feed(rx, build(CMD_IO_RESP, 1u, payload), frame), IOP_RX_FRAME);
    for (int ch = 0; ch < 16; ++ch) {
        EXPECT_EQ(iop_be32s(&frame.payload[ch * 4]), values[ch]) << "kênh " << ch;
    }
}

/* ── NACK / ACK ───────────────────────────────────────────────────────────── */

TEST(IopLinkNack, CarriesTheOffendingCommandAndTheErrorCode)
{
    std::vector<uint8_t> out(IOP_MAX_FRAME, 0u);
    const uint16_t n = iop_build_nack(out.data(), 9u, CMD_SET_DO, ERR_CRC_FAIL);
    out.resize(n);

    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    ASSERT_EQ(feed(rx, out, frame), IOP_RX_FRAME);
    EXPECT_EQ(frame.cmd, CMD_NACK);
    EXPECT_EQ(frame.seq, 9u);            // NACK mang SEQ của frame gây lỗi
    EXPECT_EQ(frame.payload[0], CMD_SET_DO);
    EXPECT_EQ(frame.payload[1], ERR_CRC_FAIL);
}

TEST(IopLinkAck, EchoesTheCommandItAcknowledges)
{
    std::vector<uint8_t> out(IOP_MAX_FRAME, 0u);
    out.resize(iop_build_ack(out.data(), 4u, CMD_RESET_IO));

    iop_rx_t rx{}; iop_rx_reset(&rx);
    iop_frame_t frame{};
    ASSERT_EQ(feed(rx, out, frame), IOP_RX_FRAME);
    EXPECT_EQ(frame.cmd, CMD_ACK);
    EXPECT_EQ(frame.payload[0], CMD_RESET_IO);
}

/* ── Phiên: chống thực thi lặp và safe-state ──────────────────────────────── */

TEST(IopSession, TreatsARepeatedSeqAsARetryAndRefusesToExecuteItTwice)
{
    // SOM retry tối đa IOP_MAX_RETRY lần khi không thấy phản hồi. Một `SET_DO`
    // bị retry mà MCU thực thi hai lần là hai lần đóng/mở contactor thật.
    iop_session_t s{}; iop_session_reset(&s);
    iop_frame_t frame{};
    frame.cmd = CMD_SET_DO;
    frame.seq = 5u;

    EXPECT_TRUE(iop_session_accept(&s, &frame, 1000u));
    EXPECT_FALSE(iop_session_accept(&s, &frame, 1005u));
    EXPECT_EQ(s.duplicates, 1u);

    frame.seq = 6u;
    EXPECT_TRUE(iop_session_accept(&s, &frame, 1010u));
}

TEST(IopSession, DoesNotForceSafeStateBeforeTheFirstHandshake)
{
    // Trước khi bắt tay thì chưa có ai điều khiển, nên chưa có gì để bảo vệ;
    // ép safe-state lúc đó chỉ tạo một lần chuyển trạng thái vô nghĩa khi cấp nguồn.
    iop_session_t s{}; iop_session_reset(&s);
    EXPECT_FALSE(iop_session_should_safe_state(&s, 10u * IOP_SAFE_TIMEOUT_MS));
}

TEST(IopSession, FallsBackToSafeStateWhenTheSomGoesQuiet)
{
    iop_session_t s{}; iop_session_reset(&s);
    iop_frame_t hs{};
    hs.cmd = CMD_HANDSHAKE;
    hs.seq = 1u;
    iop_session_accept(&s, &hs, 1000u);

    EXPECT_FALSE(iop_session_should_safe_state(&s, 1000u + IOP_SAFE_TIMEOUT_MS - 1u));
    EXPECT_TRUE(iop_session_should_safe_state(&s, 1000u + IOP_SAFE_TIMEOUT_MS));
}

TEST(IopSession, SafeStateTimerSurvivesMillisecondCounterWraparound)
{
    // `now_ms` trên MCU là uint32 và wrap sau ~49,7 ngày. Trừ trực tiếp mà không
    // để số học unsigned lo phần wrap sẽ khiến MCU KHÔNG vào safe-state đúng
    // lúc — trên một thiết bị chạy liên tục nhiều tháng, đó là lỗi có thật.
    iop_session_t s{}; iop_session_reset(&s);
    iop_frame_t hs{};
    hs.cmd = CMD_HANDSHAKE;
    hs.seq = 1u;
    const uint32_t before_wrap = 0xFFFFFF00u;
    iop_session_accept(&s, &hs, before_wrap);

    const uint32_t after_wrap = before_wrap + IOP_SAFE_TIMEOUT_MS;  // đã wrap qua 0
    EXPECT_TRUE(iop_session_should_safe_state(&s, after_wrap));
    EXPECT_FALSE(iop_session_should_safe_state(&s, before_wrap + IOP_SAFE_TIMEOUT_MS - 1u));
}

/* ── Bắt tay: kiểm hằng số dùng chung, không định nghĩa lại ───────────────── */

TEST(IopContract, FirmwareUsesTheSharedContractConstantsNotItsOwnCopies)
{
    // Nếu ai đó chép hằng số sang FW rồi sửa một bên, cross-test này là chỗ duy
    // nhất phát hiện ra trước khi đấu dây thật.
    EXPECT_EQ(IOP_VER_MAJOR, 2u);
    EXPECT_EQ(IOP_MAX_FRAME, IOP_HDR_LEN + IOP_MAX_PAYLOAD + IOP_CRC_LEN);
    EXPECT_EQ(IOP_IO_RESP_LEN, 74u);
    EXPECT_EQ(IOP_HANDSHAKE_RESP_LEN, 8u);
    EXPECT_EQ(IOP_BOARD_CAP_REV_A,
              IOP_BOARD_CAP_UI_16 | IOP_BOARD_CAP_DO_4 | IOP_BOARD_CAP_AO_4);
    // AO safe-state: IOP-Q-004 còn treo (0V hay 4mA), nhưng raw 0 là chốt chung
    // cho cả hai mode và FW không được tự chọn khác.
    EXPECT_EQ(IOP_AO_SAFE_VOLT_RAW, 0u);
    EXPECT_EQ(IOP_AO_SAFE_CURR_RAW, 0u);
}
