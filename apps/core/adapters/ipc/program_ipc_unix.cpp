#include "ipc/program_ipc_unix.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <ctime>

#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

namespace core::programming {
namespace {

bool read_exact(int fd, uint8_t* destination, std::size_t size)
{
    std::size_t offset = 0;
    while (offset < size) {
        const ssize_t count = ::recv(fd, destination + offset, size - offset, 0);
        if (count <= 0) return false;
        offset += static_cast<std::size_t>(count);
    }
    return true;
}

bool write_exact(int fd, const std::vector<uint8_t>& bytes)
{
    std::size_t offset = 0;
    while (offset < bytes.size()) {
        const ssize_t count = ::send(fd, bytes.data() + offset, bytes.size() - offset,
                                     MSG_NOSIGNAL);
        if (count <= 0) return false;
        offset += static_cast<std::size_t>(count);
    }
    return true;
}

uint32_t read_u32_le(const uint8_t* bytes)
{
    return static_cast<uint32_t>(bytes[0]) |
           (static_cast<uint32_t>(bytes[1]) << 8U) |
           (static_cast<uint32_t>(bytes[2]) << 16U) |
           (static_cast<uint32_t>(bytes[3]) << 24U);
}

uint64_t monotonic_now_ns()
{
    struct timespec timestamp {};
    ::clock_gettime(CLOCK_MONOTONIC, &timestamp);
    return static_cast<uint64_t>(timestamp.tv_sec) * 1000000000ULL +
           static_cast<uint64_t>(timestamp.tv_nsec);
}

} // namespace

ProgramIpcUnixEndpoint::~ProgramIpcUnixEndpoint() { close(); }

bool ProgramIpcUnixEndpoint::open(const std::string& path, std::string* error)
{
    close();
    if (path.empty() || path.size() >= sizeof(sockaddr_un::sun_path)) {
        if (error) *error = "Programming socket path invalid";
        return false;
    }
    listener_ = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (listener_ < 0) { if (error) *error = std::strerror(errno); return false; }
    ::unlink(path.c_str());
    struct sockaddr_un address {};
    address.sun_family = AF_UNIX;
    std::strncpy(address.sun_path, path.c_str(), sizeof(address.sun_path) - 1);
    if (::bind(listener_, reinterpret_cast<struct sockaddr*>(&address), sizeof(address)) != 0 ||
        ::chmod(path.c_str(), 0660) != 0 || ::listen(listener_, 8) != 0) {
        if (error) *error = std::strerror(errno);
        close();
        return false;
    }
    path_ = path;
    return true;
}

void ProgramIpcUnixEndpoint::run(ProgramIpcServer* server,
                                 const std::atomic<bool>* shutdown) noexcept
{
    if (listener_ < 0 || !server || !shutdown) return;
    while (!shutdown->load(std::memory_order_acquire)) {
        struct pollfd descriptor { listener_, POLLIN, 0 };
        const int ready = ::poll(&descriptor, 1, 250);
        if (ready <= 0 || !(descriptor.revents & POLLIN)) continue;
        const int client = ::accept4(listener_, nullptr, nullptr, SOCK_CLOEXEC);
        if (client < 0) continue;
        struct timeval timeout {3, 0};
        (void)::setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        (void)::setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
        std::array<uint8_t, 4> header{};
        if (!read_exact(client, header.data(), header.size())) { ::close(client); continue; }
        const uint32_t length = read_u32_le(header.data());
        if (length == 0 || length > PROGRAM_IPC_MAX_FRAME) { ::close(client); continue; }
        std::vector<uint8_t> frame(4U + length);
        std::copy(header.begin(), header.end(), frame.begin());
        if (!read_exact(client, frame.data() + 4, length)) { ::close(client); continue; }
        const std::vector<uint8_t> response =
            server->HandleFrame(frame, ReadPeerCredentials(client), monotonic_now_ns());
        if (!response.empty()) (void)write_exact(client, response);
        ::close(client);
    }
}

void ProgramIpcUnixEndpoint::close() noexcept
{
    if (listener_ >= 0) { ::close(listener_); listener_ = -1; }
    if (!path_.empty()) { ::unlink(path_.c_str()); path_.clear(); }
}

} // namespace core::programming
