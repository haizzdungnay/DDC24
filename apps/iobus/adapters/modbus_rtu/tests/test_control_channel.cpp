/**
 * @file  test_control_channel.cpp
 * @brief MBR-B105/B106/B108 — TW-MBRTU-10..14.
 *
 * `handle_line()` được tách khỏi socket có chủ đích: nó là nơi mọi quyết định
 * nằm, và test được mà không cần dựng UDS. Phần socket (peer credential, trần
 * frame) kiểm bằng test tích hợp riêng ở dưới.
 */
#include <gtest/gtest.h>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <string>
#include <thread>

#include "control_channel.hpp"

using namespace iobus::fieldbus;

namespace {

std::string sock_path_for(const char* tag)
{
    return std::string("/tmp/mkddc_ctl_") + tag + "_" + std::to_string(::getpid()) + ".sock";
}

/* Gửi một dòng request và đọc một dòng response. */
std::string round_trip(const std::string& path, const std::string& request)
{
    const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return "";
    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    if (::connect(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
        ::close(fd);
        return "";
    }
    const std::string line = request + "\n";
    ::send(fd, line.c_str(), line.size(), 0);
    char buf[2048] = {};
    const ssize_t n = ::recv(fd, buf, sizeof(buf) - 1, 0);
    ::close(fd);
    return n > 0 ? std::string(buf, static_cast<size_t>(n)) : std::string();
}

} // namespace

TEST(ControlChannelJson, ParsesStringNumberAndBool)
{
    const std::string line =
        R"({"op":"write","request_id":"abc-1","value":12.5,"readback":true,"fc":6})";
    std::string s;
    double n = 0;
    bool b = false;
    EXPECT_TRUE(json_get_string(line, "op", &s));
    EXPECT_EQ(s, "write");
    EXPECT_TRUE(json_get_string(line, "request_id", &s));
    EXPECT_EQ(s, "abc-1");
    EXPECT_TRUE(json_get_number(line, "value", &n));
    EXPECT_DOUBLE_EQ(n, 12.5);
    EXPECT_TRUE(json_get_bool(line, "readback", &b));
    EXPECT_TRUE(b);
    EXPECT_FALSE(json_get_string(line, "missing", &s));
}

/* Escape phải xử lý dấu nháy và ký tự điều khiển: một `reason` chứa nháy kép
 * sẽ phá cú pháp JSON của response và làm BE parse hỏng toàn bộ. */
TEST(ControlChannelJson, EscapesQuotesAndControlCharacters)
{
    EXPECT_EQ(json_escape("a\"b"), "a\\\"b");
    EXPECT_EQ(json_escape("a\\b"), "a\\\\b");
    EXPECT_EQ(json_escape("a\nb"), "a\\nb");
}

TEST(ControlChannelHandler, UnknownOpIsRejectedNotIgnored)
{
    ControlChannel channel;
    const std::string reply = channel.handle_line(R"({"op":"format_disk"})");
    EXPECT_NE(reply.find("\"result\":\"error\""), std::string::npos);
    EXPECT_NE(reply.find("unknown_op"), std::string::npos);
}

TEST(ControlChannelHandler, MissingOpIsBadRequest)
{
    ControlChannel channel;
    const std::string reply = channel.handle_line(R"({"request_id":"x"})");
    EXPECT_NE(reply.find("bad_request"), std::string::npos);
}

/* Handler chưa được cấp ⇒ trả `unsupported`, KHÔNG được giả vờ thành công.
 * Một ACK giả ở đây làm BE ghi "đã apply" vào journal cho một việc chưa xảy ra. */
TEST(ControlChannelHandler, UnwiredHandlersReportUnsupportedInsteadOfFakeAck)
{
    ControlChannel channel;
    EXPECT_NE(channel.handle_line(R"({"op":"apply_config","revision":3})").find("unsupported"),
              std::string::npos);
    EXPECT_NE(channel.handle_line(R"({"op":"write","request_id":"r1"})").find("unsupported"),
              std::string::npos);
}

TEST(ControlChannelHandler, WriteWithoutRequestIdIsRejected)
{
    ControlChannel channel;
    ControlHandlers handlers;
    handlers.submit_write = [](const ControlWriteRequest&, std::string*) { return true; };
    ASSERT_TRUE(channel.start(sock_path_for("wr_noid"), handlers));

    /* Không có request_id thì không ai nhận được kết quả — chấp nhận nó là tạo
     * ra một lệnh ghi mồ côi xuống thiết bị hiện trường. */
    const std::string reply = channel.handle_line(R"({"op":"write","value":1})");
    EXPECT_NE(reply.find("bad_request"), std::string::npos);
    channel.stop();
}

/* Lệnh ghi mới vào hàng đợi phải trả `accepted`, KHÔNG phải `applied`:
 * chưa ai biết slave có nhận hay không (FW_SOM_DESIGN §8.2). */
TEST(ControlChannelHandler, AcceptedWriteIsNotReportedAsApplied)
{
    ControlChannel channel;
    ControlHandlers handlers;
    handlers.submit_write = [](const ControlWriteRequest& req, std::string*) {
        EXPECT_EQ(req.request_id, "w-7");
        EXPECT_EQ(req.slave_addr, 3u);
        EXPECT_DOUBLE_EQ(req.value, 42.0);
        return true;
    };
    ASSERT_TRUE(channel.start(sock_path_for("wr_ok"), handlers));

    const std::string reply = channel.handle_line(
        R"({"op":"write","request_id":"w-7","slave_addr":3,"fc":6,"address":10,"value":42})");
    EXPECT_NE(reply.find("\"result\":\"accepted\""), std::string::npos);
    EXPECT_EQ(reply.find("applied"), std::string::npos);
    channel.stop();
}

/* MBR-B106: apply thất bại phải REJECT kèm lý do, và iobus giữ generation cũ.
 * Trả ACK cho một apply hỏng là cách BE và iobus bắt đầu chạy hai cấu hình
 * khác nhau mà không ai biết. */
TEST(ControlChannelHandler, FailedApplyReturnsRejectWithReason)
{
    ControlChannel channel;
    ControlHandlers handlers;
    handlers.apply_config = [](uint64_t, const std::string&, const std::string&,
                               std::string* reason, uint64_t*, uint64_t*) {
        if (reason) *reason = "revision_mismatch";
        return false;
    };
    ASSERT_TRUE(channel.start(sock_path_for("apply_bad"), handlers));

    const std::string reply =
        channel.handle_line(R"({"op":"apply_config","revision":9,"checksum":"abc"})");
    EXPECT_NE(reply.find("\"result\":\"reject\""), std::string::npos);
    EXPECT_NE(reply.find("revision_mismatch"), std::string::npos);
    channel.stop();
}

TEST(ControlChannelHandler, SuccessfulApplyReturnsAckWithRevisionAndGeneration)
{
    ControlChannel channel;
    ControlHandlers handlers;
    handlers.apply_config = [](uint64_t revision, const std::string& checksum,
                               const std::string& path, std::string*,
                               uint64_t* applied, uint64_t* generation) {
        EXPECT_EQ(revision, 12u);
        EXPECT_EQ(checksum, "deadbeef");
        EXPECT_EQ(path, "/data/config/fieldbus.conf");
        *applied    = 12;
        *generation = 5;
        return true;
    };
    ASSERT_TRUE(channel.start(sock_path_for("apply_ok"), handlers));

    const std::string reply = channel.handle_line(
        R"({"op":"apply_config","revision":12,"checksum":"deadbeef","path":"/data/config/fieldbus.conf"})");
    EXPECT_NE(reply.find("\"result\":\"ack\""), std::string::npos);
    EXPECT_NE(reply.find("\"applied_revision\":12"), std::string::npos);
    EXPECT_NE(reply.find("\"generation\":5"), std::string::npos);
    channel.stop();
}

/* MBR-B108: commissioning read phải kiểm biên TRƯỚC khi chạm dây.
 * slave_addr 0 là broadcast và count 0 là vô nghĩa; cả hai nếu lọt xuống
 * libmodbus đều sinh hành vi không xác định trên bus thật. */
TEST(ControlChannelHandler, CommissioningReadValidatesBoundsBeforeTouchingTheWire)
{
    ControlChannel channel;
    bool probed = false;
    ControlHandlers handlers;
    handlers.probe_read = [&](uint8_t, uint8_t, uint8_t, uint16_t, uint16_t, uint32_t) {
        probed = true;
        return ControlProbeResult{};
    };
    ASSERT_TRUE(channel.start(sock_path_for("probe_guard"), handlers));

    EXPECT_NE(channel.handle_line(R"({"op":"read_test","slave_addr":0,"count":1})")
                  .find("bad_request"), std::string::npos);
    EXPECT_NE(channel.handle_line(R"({"op":"read_test","slave_addr":3,"count":0})")
                  .find("bad_request"), std::string::npos);
    EXPECT_NE(channel.handle_line(R"({"op":"read_test","slave_addr":3,"count":200})")
                  .find("bad_request"), std::string::npos);
    EXPECT_FALSE(probed) << "không được phát lệnh nào khi tham số đã sai";
    channel.stop();
}

TEST(ControlChannelHandler, CommissioningReadReturnsValueAndElapsed)
{
    ControlChannel channel;
    ControlHandlers handlers;
    handlers.probe_read = [](uint8_t bus_id, uint8_t slave, uint8_t fc, uint16_t addr,
                             uint16_t count, uint32_t timeout_ms) {
        EXPECT_EQ(bus_id, 2u);
        EXPECT_EQ(slave, 7u);
        EXPECT_EQ(fc, 4u);
        EXPECT_EQ(addr, 100u);
        EXPECT_EQ(count, 1u);
        EXPECT_EQ(timeout_ms, 800u);
        ControlProbeResult out;
        out.ok         = true;
        out.value      = 1234.0;
        out.elapsed_us = 4200;
        return out;
    };
    ASSERT_TRUE(channel.start(sock_path_for("probe_ok"), handlers));

    const std::string reply = channel.handle_line(
        R"({"op":"read_test","bus_id":2,"slave_addr":7,"fc":4,"address":100,"count":1,"timeout_ms":800})");
    EXPECT_NE(reply.find("\"result\":\"ok\""), std::string::npos);
    EXPECT_NE(reply.find("1234"), std::string::npos);
    EXPECT_NE(reply.find("\"elapsed_us\":4200"), std::string::npos);
    channel.stop();
}

/* Kiểm tra đường socket thật: kết nối, gửi, nhận, và dọn file socket khi stop. */
TEST(ControlChannelSocket, ServesStatusOverUnixStreamAndCleansUpOnStop)
{
    const std::string path = sock_path_for("status");
    ControlChannel channel;
    ControlHandlers handlers;
    handlers.status_fields = []() { return std::string("\"generation\":4,\"ext_count\":9"); };
    ASSERT_TRUE(channel.start(path, handlers));

    const std::string reply = round_trip(path, R"({"op":"status"})");
    EXPECT_NE(reply.find("\"result\":\"ok\""), std::string::npos);
    EXPECT_NE(reply.find("\"generation\":4"), std::string::npos);
    EXPECT_NE(reply.find("\"ext_count\":9"), std::string::npos);

    channel.stop();
    /* File socket phải biến mất: để lại làm lần start sau bind fail. */
    EXPECT_NE(::access(path.c_str(), F_OK), 0);
}

/* Frame vượt trần phải bị từ chối và đóng kết nối. Không có bước này, một
 * client gửi dòng không bao giờ kết thúc sẽ giữ RAM của iobus tới khi OOM —
 * và OOM ở đây kéo theo cả IOP. */
TEST(ControlChannelSocket, OversizedFrameIsRejectedInsteadOfBufferedForever)
{
    const std::string path = sock_path_for("bigframe");
    ControlChannel channel;
    ControlHandlers handlers;
    handlers.status_fields = []() { return std::string(); };
    ASSERT_TRUE(channel.start(path, handlers));

    const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    ASSERT_GE(fd, 0);
    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    ASSERT_EQ(::connect(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);

    /* Không có '\n': server phải cắt vì vượt trần, không chờ mãi. */
    const std::string chunk(8192, 'x');
    for (int i = 0; i < 10; i++) {
        if (::send(fd, chunk.c_str(), chunk.size(), MSG_NOSIGNAL) < 0) break;
    }
    char buf[512] = {};
    const ssize_t n = ::recv(fd, buf, sizeof(buf) - 1, 0);
    if (n > 0) {
        EXPECT_NE(std::string(buf, static_cast<size_t>(n)).find("frame_too_large"),
                  std::string::npos);
    }
    ::close(fd);
    channel.stop();
}
