/**
 * @file  test_output_command.cpp
 * @brief 06 §3.9: đổi do_cmd → đúng 1 SET_DO; không đổi → không gửi (idempotent);
 *        NACK ERR_SAFE_STATE → ngừng SET_*, không spam.
 */
#include <gtest/gtest.h>

#include <array>
#include <vector>

#include "bridge/output_command.hpp"

using namespace iobus;

namespace {

struct FakeSink : public CommandSink {
    struct DoCall { uint8_t mask, value; };
    std::vector<DoCall> do_calls;
    std::vector<std::array<uint16_t, 4>> ao_calls;
    IopResult next_result{};

    FakeSink()
    {
        next_result.code = IopResult::OK;
        /* reserve trước: né false-positive stringop-overflow của GCC13 -O3
         * khi _M_realloc_insert struct 2 byte */
        do_calls.reserve(64);
        ao_calls.reserve(64);
    }

    IopResult send_set_do(uint8_t mask, uint8_t value) override
    {
        do_calls.push_back({mask, value});
        return next_result;
    }
    IopResult send_set_ao(const uint16_t raw[4]) override
    {
        ao_calls.push_back({raw[0], raw[1], raw[2], raw[3]});
        return next_result;
    }
};

} // namespace

TEST(OutputCommand, FirstProcessSendsInitialState)
{
    FakeSink sink;
    OutputCommand oc(sink);
    const float ao[4] = {0, 0, 0, 0};
    const uint8_t dout[4] = {0, 0, 0, 0};
    oc.process(ao, dout);
    /* lần đầu: gửi để đồng bộ trạng thái đã biết */
    EXPECT_EQ(sink.do_calls.size(), 1u);
    EXPECT_EQ(sink.ao_calls.size(), 1u);
}

TEST(OutputCommand, ChangedDoSendsExactlyOneSetDo)
{
    FakeSink sink;
    OutputCommand oc(sink);
    const float ao[4] = {0, 0, 0, 0};
    uint8_t dout[4] = {0, 0, 0, 0};
    oc.process(ao, dout);   /* sync ban đầu */
    sink.do_calls.clear();
    sink.ao_calls.clear();

    dout[0] = 1;
    oc.process(ao, dout);
    ASSERT_EQ(sink.do_calls.size(), 1u);
    EXPECT_EQ(sink.do_calls[0].mask, 0x01);    /* chỉ kênh đổi */
    EXPECT_EQ(sink.do_calls[0].value & 0x01, 0x01);
    EXPECT_EQ(sink.ao_calls.size(), 0u);       /* AO không đổi → không gửi */
}

TEST(OutputCommand, UnchangedSendsNothing)
{
    FakeSink sink;
    OutputCommand oc(sink);
    const float ao[4] = {2.5f, 0, 0, 0};
    const uint8_t dout[4] = {1, 0, 0, 0};
    oc.process(ao, dout);
    sink.do_calls.clear();
    sink.ao_calls.clear();

    for (int i = 0; i < 10; i++)
        oc.process(ao, dout);
    EXPECT_EQ(sink.do_calls.size(), 0u);
    EXPECT_EQ(sink.ao_calls.size(), 0u);
}

TEST(OutputCommand, AoChangeConvertsEngToRaw)
{
    FakeSink sink;
    OutputCommand oc(sink);
    const AoMode modes[4] = {AoMode::V0_10, AoMode::MA4_20, AoMode::V0_10, AoMode::V0_10};
    oc.set_ao_modes(modes);

    float ao[4] = {0, 4.0f, 0, 0};
    const uint8_t dout[4] = {0, 0, 0, 0};
    oc.process(ao, dout);
    sink.ao_calls.clear();

    ao[0] = 5.0f;     /* 0-10V → ~32768 */
    ao[1] = 12.0f;    /* 4-20mA midpoint → ~32768 */
    oc.process(ao, dout);
    ASSERT_EQ(sink.ao_calls.size(), 1u);
    EXPECT_NEAR(sink.ao_calls[0][0], 32768, 1);
    EXPECT_NEAR(sink.ao_calls[0][1], 32768, 1);
}

TEST(OutputCommand, NackSafeStateStopsSending)
{
    FakeSink sink;
    OutputCommand oc(sink);
    sink.next_result.code = IopResult::NACK;
    sink.next_result.nack_err = ERR_SAFE_STATE;

    const float ao[4] = {0, 0, 0, 0};
    const uint8_t dout[4] = {1, 0, 0, 0};
    oc.process(ao, dout);
    EXPECT_TRUE(oc.safe_state_blocked());
    const size_t calls_after_first = sink.do_calls.size();

    /* khi bị block → không spam retry */
    for (int i = 0; i < 5; i++)
        oc.process(ao, dout);
    EXPECT_EQ(sink.do_calls.size(), calls_after_first);

    /* clear (main retry chậm) → gửi lại được */
    sink.next_result.code = IopResult::OK;
    oc.clear_safe_blocked();
    oc.process(ao, dout);
    EXPECT_GT(sink.do_calls.size(), calls_after_first);
}

TEST(OutputCommand, FeedbackMismatchForcesResend)
{
    FakeSink sink;
    OutputCommand oc(sink);
    const float ao[4] = {0, 0, 0, 0};
    const uint8_t dout[4] = {1, 0, 0, 0};
    oc.process(ao, dout);   /* sync: SET_DO do_cmd=1 */
    sink.do_calls.clear();

    /* fb khớp → không resend */
    const uint8_t fb_ok[4] = {1, 0, 0, 0};
    for (int i = 0; i < 10; i++) {
        oc.verify_feedback(fb_ok);
        oc.process(ao, dout);
    }
    EXPECT_EQ(sink.do_calls.size(), 0u);

    /* MCU mất state (tự safe/reset): fb=0 kéo dài → sau FB_MISMATCH_POLLS poll
     * phải ép resend đúng 1 SET_DO */
    const uint8_t fb_lost[4] = {0, 0, 0, 0};
    for (int i = 0; i < OutputCommand::FB_MISMATCH_POLLS; i++) {
        oc.verify_feedback(fb_lost);
        oc.process(ao, dout);
    }
    ASSERT_EQ(sink.do_calls.size(), 1u);
    EXPECT_EQ(sink.do_calls[0].value & 0x01, 0x01) << "resend lại trạng thái mong muốn";

    /* fb khớp lại → ngừng */
    sink.do_calls.clear();
    for (int i = 0; i < 10; i++) {
        oc.verify_feedback(fb_ok);
        oc.process(ao, dout);
    }
    EXPECT_EQ(sink.do_calls.size(), 0u);
}

TEST(OutputCommand, FailedSendRetriesNextCycle)
{
    FakeSink sink;
    OutputCommand oc(sink);
    sink.next_result.code = IopResult::TIMEOUT;

    const float ao[4] = {0, 0, 0, 0};
    const uint8_t dout[4] = {1, 0, 0, 0};
    EXPECT_FALSE(oc.process(ao, dout));
    /* timeout → last_sent KHÔNG cập nhật → chu kỳ sau gửi lại */
    sink.next_result.code = IopResult::OK;
    const size_t before = sink.do_calls.size();
    EXPECT_TRUE(oc.process(ao, dout));
    EXPECT_EQ(sink.do_calls.size(), before + 1);
}
