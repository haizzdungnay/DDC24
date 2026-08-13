#include <gtest/gtest.h>

#include <atomic>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include <sodium.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include "ipc/program_ipc_unix.hpp"

namespace core::programming {
namespace {

std::string socket_path()
{
    char value[] = "/tmp/mkddc-program-ipc-XXXXXX";
    const int fd = ::mkstemp(value);
    if (fd >= 0) ::close(fd);
    ::unlink(value);
    return std::string(value) + ".sock";
}

bool send_all(int fd, const std::vector<uint8_t>& bytes)
{
    std::size_t offset = 0;
    while (offset < bytes.size()) {
        const ssize_t count = ::send(fd, bytes.data() + offset, bytes.size() - offset, 0);
        if (count <= 0) return false;
        offset += static_cast<std::size_t>(count);
    }
    return true;
}

} // namespace

TEST(ProgramIpcUnixEndpoint, RoundTripsCanonicalFrameAndRemovesSocketOnClose)
{
    const std::string path = socket_path();
    ProgramIpcServer server(static_cast<uint32_t>(::getuid()));
    ProgramIpcUnixEndpoint endpoint;
    std::string error;
    ASSERT_TRUE(endpoint.open(path, &error)) << error;
    std::atomic<bool> shutdown{false};
    std::thread worker([&] { endpoint.run(&server, &shutdown); });

    ProgramRequest request;
    request.request_id.assign(16, 0x11);
    request.controller_id = "controller-local";
    request.deadline_mono_ns = UINT64_MAX;
    request.action = ProgramAction::Capabilities;
    request.correlation_id = "ipc-unix-test-0001";
    request.payload = {0x80};
    crypto_hash_sha256(request.payload_hash.data(), request.payload.data(), request.payload.size());
    ProgramCodecError codec_error = ProgramCodecError::None;
    const std::vector<uint8_t> frame = EncodeRequestFrame(request, &codec_error);

    const int client = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    struct sockaddr_un address {};
    address.sun_family = AF_UNIX;
    std::strncpy(address.sun_path, path.c_str(), sizeof(address.sun_path) - 1);
    const bool connected = client >= 0 &&
        ::connect(client, reinterpret_cast<struct sockaddr*>(&address), sizeof(address)) == 0;
    const bool sent = connected && send_all(client, frame);
    std::vector<uint8_t> response(4);
    const ssize_t header_received = sent ? ::recv(client, response.data(), 4, MSG_WAITALL) : -1;
    uint32_t payload_size = 0;
    if (header_received == 4) {
        payload_size = static_cast<uint32_t>(response[0]) |
            (static_cast<uint32_t>(response[1]) << 8U) |
            (static_cast<uint32_t>(response[2]) << 16U) |
            (static_cast<uint32_t>(response[3]) << 24U);
        response.resize(4U + payload_size);
    }
    const ssize_t payload_received = header_received == 4 && payload_size <= PROGRAM_IPC_MAX_FRAME
        ? ::recv(client, response.data() + 4, payload_size, MSG_WAITALL) : -1;
    if (client >= 0) ::close(client);
    shutdown.store(true, std::memory_order_release);
    worker.join();
    endpoint.close();

    ASSERT_GE(client, 0);
    ASSERT_TRUE(connected);
    ASSERT_TRUE(sent);
    ASSERT_EQ(header_received, 4) << std::strerror(errno);
    ASSERT_EQ(payload_received, static_cast<ssize_t>(payload_size)) << std::strerror(errno);
    ProgramResponse decoded;
    ASSERT_TRUE(DecodeResponseFrame(response, &decoded, &codec_error));
    EXPECT_EQ(decoded.result, ProgramResult::Ok);
    EXPECT_FALSE(decoded.payload.empty());
    EXPECT_NE(::access(path.c_str(), F_OK), 0);
}

} // namespace core::programming
