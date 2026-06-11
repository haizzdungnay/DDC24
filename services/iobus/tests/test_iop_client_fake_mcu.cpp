/**
 * @file  test_iop_client_fake_mcu.cpp
 * @brief Integration IopClient ↔ fake MCU slave qua PTY in-process (hermetic, không
 *        cần spawn tools/fake_mcu): handshake / poll / set_do / timeout / seq-wrong.
 */
#include <gtest/gtest.h>

#include <atomic>
#include <cstring>
#include <thread>

#include <fcntl.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>

#include "diagnostics/iobus_metrics.hpp"
#include "iop/iop_client.hpp"
#include "iop/iop_frame.hpp"

using namespace iobus;

namespace {

/* Fake MCU slave tối thiểu chạy trên master side của PTY */
class FakeMcuThread {
public:
    struct Options {
        bool seq_wrong = false;
        int  skip_frames = 0;        /* bỏ trả lời N frame đầu (inject timeout) */
        uint8_t nack_cmd = 0;
        uint8_t nack_err = 0;
    };

    bool start() { return start(Options()); }

    bool start(Options opt)
    {
        opt_ = opt;
        master_fd_ = posix_openpt(O_RDWR | O_NOCTTY);
        if (master_fd_ < 0) return false;
        if (grantpt(master_fd_) != 0 || unlockpt(master_fd_) != 0) return false;
        char name[128];
        if (ptsname_r(master_fd_, name, sizeof(name)) != 0) return false;
        slave_path_ = name;
        struct termios tio {};
        tcgetattr(master_fd_, &tio);
        cfmakeraw(&tio);
        tcsetattr(master_fd_, TCSANOW, &tio);
        running_.store(true);
        thread_ = std::thread([this] { run(); });
        return true;
    }

    void stop()
    {
        running_.store(false);
        if (thread_.joinable()) thread_.join();
        if (master_fd_ >= 0) { ::close(master_fd_); master_fd_ = -1; }
    }

    ~FakeMcuThread() { stop(); }

    const std::string& slave_path() const { return slave_path_; }
    uint8_t do_state() const { return do_state_.load(); }
    int handshake_count() const { return handshake_count_.load(); }

private:
    void run()
    {
        FrameParser parser;
        uint8_t buf[512];
        while (running_.load()) {
            struct pollfd pfd { master_fd_, POLLIN, 0 };
            if (::poll(&pfd, 1, 20) <= 0) continue;
            const ssize_t r = ::read(master_fd_, buf, sizeof(buf));
            if (r <= 0) continue;
            parser.feed(buf, static_cast<size_t>(r));
            ParsedFrame f;
            while (parser.next(&f) == ParseResult::FRAME)
                handle(f);
        }
    }

    void handle(const ParsedFrame& f)
    {
        if (opt_.skip_frames > 0) { opt_.skip_frames--; return; }

        const uint8_t seq = opt_.seq_wrong ? static_cast<uint8_t>(f.seq + 1) : f.seq;
        uint8_t payload[IOP_MAX_PAYLOAD] = {};
        uint8_t out[IOP_MAX_FRAME];
        size_t n = 0;

        if (opt_.nack_cmd != 0 && f.cmd == opt_.nack_cmd) {
            payload[0] = f.cmd;
            payload[1] = opt_.nack_err;
            n = build_frame(CMD_NACK, seq, payload, IOP_NACK_LEN, out);
        } else if (f.cmd == CMD_HANDSHAKE) {
            handshake_count_.fetch_add(1);
            payload[0] = IOP_VER_MAJOR; payload[1] = IOP_VER_MINOR;
            payload[2] = 0x01; payload[3] = 0x00;
            payload[4] = IOP_HS_STATUS_OK; payload[5] = 0;
            n = build_frame(CMD_HANDSHAKE_RESP, seq, payload, IOP_HANDSHAKE_RESP_LEN, out);
        } else if (f.cmd == CMD_GET_IO) {
            /* UI1 raw = 0x000064=100; DI=0x05; DO_FB = do_state; temp 25.0; cnt++ */
            payload[2] = 100;
            payload[24] = 0x05;
            payload[25] = do_state_.load();
            payload[26] = 0x00; payload[27] = 0xFA;
            payload[30] = static_cast<uint8_t>(sample_cnt_ >> 8);
            payload[31] = static_cast<uint8_t>(sample_cnt_);
            sample_cnt_++;
            n = build_frame(CMD_IO_RESP, seq, payload, IOP_IO_RESP_LEN, out);
        } else if (f.cmd == CMD_SET_DO && f.len == IOP_SET_DO_LEN) {
            const uint8_t mask = f.payload[0], value = f.payload[1];
            do_state_.store(static_cast<uint8_t>((do_state_.load() & ~mask) | (value & mask)));
            payload[0] = f.cmd;
            n = build_frame(CMD_ACK, seq, payload, IOP_ACK_LEN, out);
        } else if (f.cmd == CMD_SET_AO || f.cmd == CMD_SET_AO_CFG || f.cmd == CMD_RESET_IO) {
            payload[0] = f.cmd;
            n = build_frame(CMD_ACK, seq, payload, IOP_ACK_LEN, out);
        } else if (f.cmd == CMD_GET_DIAG) {
            n = build_frame(CMD_DIAG_RESP, seq, payload, IOP_DIAG_RESP_LEN, out);
        } else {
            payload[0] = f.cmd;
            payload[1] = ERR_UNKNOWN_CMD;
            n = build_frame(CMD_NACK, seq, payload, IOP_NACK_LEN, out);
        }
        if (n) (void)!::write(master_fd_, out, n);
    }

    Options opt_;
    int master_fd_ = -1;
    std::string slave_path_;
    std::thread thread_;
    std::atomic<bool> running_{false};
    std::atomic<uint8_t> do_state_{0};
    std::atomic<int> handshake_count_{0};
    uint16_t sample_cnt_ = 0;
};

IopClientConfig test_cfg()
{
    IopClientConfig c;
    c.baud = 0;                      /* PTY: giữ default, không set termios speed thật */
    c.response_timeout_ms = 50;      /* PTY scheduling chậm hơn UART thật */
    c.handshake_timeout_ms = 200;
    return c;
}

} // namespace

TEST(IopClientFakeMcu, HandshakeAndPoll)
{
    FakeMcuThread mcu;
    ASSERT_TRUE(mcu.start());

    IobusMetrics metrics;
    IopClient client(&metrics, test_cfg());
    ASSERT_TRUE(client.open(mcu.slave_path()));

    EXPECT_TRUE(client.handshake().ok());
    EXPECT_EQ(client.mcu_iop_version(), (IOP_VER_MAJOR << 8) | IOP_VER_MINOR);

    IopIoResp io;
    for (int i = 0; i < 20; i++) {
        const IopResult r = client.get_io(&io);
        ASSERT_TRUE(r.ok()) << "poll #" << i << " code=" << r.code;
    }
    EXPECT_EQ(io.ui_raw[0], 100u);
    EXPECT_EQ(io.di_mask, 0x05);
    EXPECT_EQ(io.mcu_temp_x10, 250);
    EXPECT_GE(metrics.rx_count.load(), 21u);
    EXPECT_EQ(metrics.crc_error_count.load(), 0u);
}

TEST(IopClientFakeMcu, SetDoRoundTripWithFeedback)
{
    FakeMcuThread mcu;
    ASSERT_TRUE(mcu.start());

    IobusMetrics metrics;
    IopClient client(&metrics, test_cfg());
    ASSERT_TRUE(client.open(mcu.slave_path()));
    ASSERT_TRUE(client.handshake().ok());

    EXPECT_TRUE(client.set_do(0x01, 0x01).ok());
    EXPECT_EQ(mcu.do_state(), 0x01);

    IopIoResp io;
    ASSERT_TRUE(client.get_io(&io).ok());
    EXPECT_EQ(io.do_fb_mask & 0x01, 0x01);   /* DO_FB phản ánh lệnh */

    EXPECT_TRUE(client.set_do(0x01, 0x00).ok());
    ASSERT_TRUE(client.get_io(&io).ok());
    EXPECT_EQ(io.do_fb_mask & 0x01, 0x00);
}

TEST(IopClientFakeMcu, TimeoutThenRecover)
{
    FakeMcuThread::Options opt;
    opt.skip_frames = 4;             /* bỏ 4 frame đầu: 1 lệnh + 3 retry = TIMEOUT */
    FakeMcuThread mcu;
    ASSERT_TRUE(mcu.start(opt));

    IobusMetrics metrics;
    IopClient client(&metrics, test_cfg());
    ASSERT_TRUE(client.open(mcu.slave_path()));

    IopIoResp io;
    const IopResult r = client.get_io(&io);
    EXPECT_EQ(r.code, IopResult::TIMEOUT);
    EXPECT_EQ(r.retries, IOP_MAX_RETRY);
    EXPECT_GE(metrics.timeout_count.load(), 1u);

    /* sau khi hết inject → recover */
    EXPECT_TRUE(client.get_io(&io).ok());
}

TEST(IopClientFakeMcu, SeqWrongIsDroppedAndCounted)
{
    FakeMcuThread::Options opt;
    opt.seq_wrong = true;
    FakeMcuThread mcu;
    ASSERT_TRUE(mcu.start(opt));

    IobusMetrics metrics;
    IopClient client(&metrics, test_cfg());
    ASSERT_TRUE(client.open(mcu.slave_path()));

    IopIoResp io;
    const IopResult r = client.get_io(&io);
    EXPECT_EQ(r.code, IopResult::TIMEOUT);   /* mọi response SEQ sai → drop → timeout */
    EXPECT_GE(metrics.seq_error_count.load(), 1u);
}

TEST(IopClientFakeMcu, NackSafeStateIsReported)
{
    FakeMcuThread::Options opt;
    opt.nack_cmd = CMD_SET_DO;
    opt.nack_err = ERR_SAFE_STATE;
    FakeMcuThread mcu;
    ASSERT_TRUE(mcu.start(opt));

    IobusMetrics metrics;
    IopClient client(&metrics, test_cfg());
    ASSERT_TRUE(client.open(mcu.slave_path()));

    const IopResult r = client.set_do(0x01, 0x01);
    EXPECT_EQ(r.code, IopResult::NACK);
    EXPECT_EQ(r.nack_err, ERR_SAFE_STATE);
    EXPECT_GE(metrics.nack_count.load(), 1u);
}
