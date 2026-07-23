#include <gtest/gtest.h>

#include <atomic>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

#include "api/hmi_api_client.hpp"

namespace hmi {
namespace {

std::string recv_line(int fd)
{
    std::string line;
    char c = 0;
    while (::recv(fd, &c, 1, 0) == 1 && c != '\n') line += c;
    return line;
}

void send_chunked(int fd, const nlohmann::json& value)
{
    const std::string line = value.dump() + "\n";
    const size_t split = std::min<size_t>(7, line.size());
    (void)::send(fd, line.data(), split, MSG_NOSIGNAL);
    (void)::send(fd, line.data() + split, line.size() - split, MSG_NOSIGNAL);
}

TEST(HmiApiClientTest, LoginAndCommandUseVersionedFramesWithoutLoggingSecrets)
{
    const std::string path = "/tmp/mkddc-hmi-api-test-" + std::to_string(getpid()) + ".sock";
    ::unlink(path.c_str());
    const int server = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    ASSERT_GE(server, 0);
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    ASSERT_EQ(::bind(server, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);
    ASSERT_EQ(::listen(server, 3), 0);
    std::atomic<bool> frames_ok{true};

    std::thread peer([&] {
        int fd = ::accept(server, nullptr, nullptr);
        if (fd < 0) { frames_ok.store(false); return; }
        const auto login = nlohmann::json::parse(recv_line(fd));
        frames_ok.store(frames_ok.load() && login.value("version", 0) == 1 &&
                        login.value("action", "") == "login" &&
                        login.value("password", "") == "operator-password");
        send_chunked(fd, {{"version", 1}, {"requestId", login.value("requestId", "")},
                          {"result", "accepted"}, {"reasonCode", "OK"},
                          {"token", "secret-session-token"}, {"role", "operator"},
                          {"expiresInS", 900}});
        ::close(fd);

        fd = ::accept(server, nullptr, nullptr);
        if (fd < 0) { frames_ok.store(false); return; }
        const auto policy = nlohmann::json::parse(recv_line(fd));
        frames_ok.store(frames_ok.load() && policy.value("action", "") == "policy" &&
                        policy.value("token", "") == "secret-session-token");
        send_chunked(fd, {{"version", 1}, {"requestId", policy.value("requestId", "")},
                          {"result", "accepted"}, {"reasonCode", "OK"},
                          {"policy", {{{"id", "AO-01"}, {"actions", {"override", "release"}}},
                                      {{"id", "DO-01"}, {"actions", {"override", "release"}}}}}});
        ::close(fd);

        fd = ::accept(server, nullptr, nullptr);
        if (fd < 0) { frames_ok.store(false); return; }
        const auto command = nlohmann::json::parse(recv_line(fd));
        frames_ok.store(frames_ok.load() && command.value("version", 0) == 1 &&
                        command.value("action", "") == "override" &&
                        command.value("token", "") == "secret-session-token" &&
                        command.value("ttlS", 0) == 300);
        send_chunked(fd, {{"version", 1}, {"requestId", command.value("requestId", "")},
                          {"result", "accepted"}, {"reasonCode", "OK"},
                          {"point", {{"id", "AO-01"}, {"priority", "manual"}}}});
        ::close(fd);
    });

    testing::internal::CaptureStderr();
    HmiApiClient client(path);
    const ApiReply login = client.login("operator", "operator-password");
    EXPECT_TRUE(login.accepted()) << login.reason_code;
    EXPECT_TRUE(client.authenticated());
    EXPECT_TRUE(client.available());
    EXPECT_EQ(client.role(), "operator");
    EXPECT_TRUE(client.can_control("AO-01"));
    EXPECT_TRUE(client.can_control("AO-01", "override"));
    EXPECT_TRUE(client.can_control("AO-01", "release"));
    EXPECT_FALSE(client.can_control("AO-01", "setpoint"));
    EXPECT_FALSE(client.can_control("DO-01", "setpoint"));
    const ApiReply command = client.command("override", "AO-01", 7.5,
                                            "", "maintenance", 300);
    const std::string logs = testing::internal::GetCapturedStderr();
    EXPECT_TRUE(command.accepted()) << command.reason_code;
    EXPECT_TRUE(frames_ok.load());
    EXPECT_NE(logs.find("request_id=hmi-"), std::string::npos) << logs;
    EXPECT_EQ(logs.find("operator-password"), std::string::npos) << logs;
    EXPECT_EQ(logs.find("secret-session-token"), std::string::npos) << logs;

    peer.join();
    ::close(server);
    ::unlink(path.c_str());

    const ApiReply unavailable = client.command("override", "AO-01", 8.0,
                                                "", "maintenance", 300);
    EXPECT_FALSE(unavailable.transport_ok);
    EXPECT_EQ(unavailable.reason_code, "BROKER_UNAVAILABLE");
    EXPECT_FALSE(client.available());
    EXPECT_TRUE(client.authenticated()) << "transport loss must not invent session expiry";

    const int recovery_server = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    ASSERT_GE(recovery_server, 0);
    ASSERT_EQ(::bind(recovery_server, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);
    ASSERT_EQ(::listen(recovery_server, 1), 0);
    std::thread recovery_peer([&] {
        const int fd = ::accept(recovery_server, nullptr, nullptr);
        if (fd < 0) return;
        const auto query = nlohmann::json::parse(recv_line(fd));
        send_chunked(fd, {{"version", 1}, {"requestId", query.value("requestId", "")},
                          {"result", "accepted"}, {"reasonCode", "OK"},
                          {"point", {{"id", "AO-01"}, {"priority", "manual"}}}});
        ::close(fd);
    });
    const ApiReply recovered = client.request("query", {{"pointId", "AO-01"}});
    EXPECT_TRUE(recovered.accepted()) << recovered.reason_code;
    EXPECT_TRUE(client.available());
    recovery_peer.join();
    ::close(recovery_server);
    ::unlink(path.c_str());
}

TEST(HmiApiClientTest, UnauthenticatedCommandFailsClosedBeforeTransport)
{
    HmiApiClient client("/tmp/mkddc-hmi-api-missing.sock");
    const ApiReply reply = client.command("override", "DO-01", 1,
                                          "", "maintenance", 300);
    EXPECT_FALSE(reply.transport_ok);
    EXPECT_EQ(reply.reason_code, "SESSION_EXPIRED");
    EXPECT_FALSE(client.authenticated());
}

TEST(HmiApiClientTest, LoginWithoutBoundedExpiryFailsClosed)
{
    const std::string path = "/tmp/mkddc-hmi-api-expiry-" + std::to_string(getpid()) + ".sock";
    ::unlink(path.c_str());
    const int server = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    ASSERT_GE(server, 0);
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    ASSERT_EQ(::bind(server, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)), 0);
    ASSERT_EQ(::listen(server, 1), 0);

    std::thread peer([&] {
        const int fd = ::accept(server, nullptr, nullptr);
        if (fd < 0) return;
        const auto login = nlohmann::json::parse(recv_line(fd));
        send_chunked(fd, {{"version", 1}, {"requestId", login.value("requestId", "")},
                          {"result", "accepted"}, {"reasonCode", "OK"},
                          {"token", "unbounded-token"}, {"role", "operator"}});
        ::close(fd);
    });

    HmiApiClient client(path);
    const ApiReply login = client.login("operator", "password");
    EXPECT_FALSE(login.accepted());
    EXPECT_EQ(login.reason_code, "INVALID_RESPONSE");
    EXPECT_FALSE(client.authenticated());

    peer.join();
    ::close(server);
    ::unlink(path.c_str());
}

} // namespace
} // namespace hmi
