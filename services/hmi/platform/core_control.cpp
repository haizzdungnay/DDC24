#include "platform/core_control.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <string>
#include <vector>

#include <poll.h>
#include <signal.h>
#include <sys/reboot.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace hmi {

bool CoreControl::apply_safe_states(const PointDb& db) const
{
    std::vector<const PointEntry*> outputs;
    for (const auto& p : db.entries()) {
        if (p.io_type != "AO" && p.io_type != "DO") continue;
        if (!p.has_safe_state) {
            std::fprintf(stderr, "ERROR hmi.safe_reboot missing_safe_state point=%s\n",
                         p.point_id.c_str());
            return false;
        }
        outputs.push_back(&p);
    }
    if (outputs.empty()) {
        std::fprintf(stderr, "ERROR hmi.safe_reboot no_output_points\n");
        return false;
    }

    const int fd = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return false;
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", socket_path_.c_str());
    if (::connect(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
        std::fprintf(stderr, "ERROR hmi.safe_reboot core_connect errno=%d\n", errno);
        ::close(fd); return false;
    }

    uint64_t id = 7000;
    std::string request;
    for (const PointEntry* p : outputs) {
        const double value = p->io_type == "AO" ? static_cast<double>(p->safe_state_ao)
                                                  : (p->safe_state_do ? 1.0 : 0.0);
        char line[256];
        std::snprintf(line, sizeof(line),
            "{\"id\":%llu,\"op\":\"write\",\"point\":\"%s\",\"value\":%.9g,"
            "\"source\":\"manual\",\"user\":\"hmi-safe-reboot\"}\n",
            static_cast<unsigned long long>(id++), p->point_id.c_str(), value);
        request += line;
    }
    size_t sent = 0;
    while (sent < request.size()) {
        const ssize_t n = ::send(fd, request.data() + sent, request.size() - sent, MSG_NOSIGNAL);
        if (n <= 0) { ::close(fd); return false; }
        sent += static_cast<size_t>(n);
    }

    struct pollfd pfd{fd, POLLIN, 0};
    std::string responses;
    size_t response_lines = 0;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while (response_lines < outputs.size()) {
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
            deadline - std::chrono::steady_clock::now()).count();
        if (remaining <= 0) break;
        pfd.revents = 0;
        const int ready = ::poll(&pfd, 1, static_cast<int>(remaining));
        if (ready <= 0 || (pfd.revents & (POLLERR | POLLNVAL))) break;
        char buf[4096];
        const ssize_t n = ::recv(fd, buf, sizeof(buf), 0);
        if (n <= 0) break;
        responses.append(buf, static_cast<size_t>(n));
        response_lines = static_cast<size_t>(
            std::count(responses.begin(), responses.end(), '\n'));
    }
    ::close(fd);

    size_t accepted = 0;
    size_t pos = 0;
    while ((pos = responses.find("\"result\":\"accepted\"", pos)) != std::string::npos) {
        ++accepted; pos += 10;
    }
    if (accepted != outputs.size()) {
        std::fprintf(stderr, "ERROR hmi.safe_reboot safe_apply accepted=%zu expected=%zu\n",
                     accepted, outputs.size());
        return false;
    }
    return true;
}

bool CoreControl::safe_reboot(const PointDb& db, bool allow_reboot) const
{
    if (!apply_safe_states(db)) return false;
    ::sync();
    if (!allow_reboot) {
        std::fprintf(stderr, "WARN  hmi.safe_reboot inhibited by runtime policy\n");
        return false;
    }
    return ::reboot(RB_AUTOBOOT) == 0;
}

static bool comm_matches(pid_t pid, const char* expected_name)
{
    std::ifstream comm("/proc/" + std::to_string(pid) + "/comm");
    std::string name;
    return std::getline(comm, name) && name == expected_name;
}

static pid_t find_unique_process(const char* expected_name)
{
    DIR* proc = ::opendir("/proc");
    if (!proc) return -1;
    pid_t found = -1;
    while (const struct dirent* entry = ::readdir(proc)) {
        char* end = nullptr;
        const long value = std::strtol(entry->d_name, &end, 10);
        if (!end || *end != '\0' || value <= 1) continue;
        const pid_t pid = static_cast<pid_t>(value);
        if (!comm_matches(pid, expected_name)) continue;
        if (found != -1) {
            ::closedir(proc);
            return -1;
        }
        found = pid;
    }
    ::closedir(proc);
    return found;
}

bool CoreControl::signal_process(const char* pidfile, const char* expected_name,
                                 int signal_number)
{
    std::ifstream f(pidfile);
    long pid_value = -1;
    if (!(f >> pid_value) || pid_value <= 1 ||
        !comm_matches(static_cast<pid_t>(pid_value), expected_name)) {
        pid_value = find_unique_process(expected_name);
    }
    if (pid_value <= 1) return false;
    return ::kill(static_cast<pid_t>(pid_value), signal_number) == 0;
}

bool CoreControl::reload_services()
{
    const bool core = signal_process("/run/mkddc/core.pid", "mkddc-core", SIGHUP);
    const bool iobus = signal_process("/run/mkddc/iobus.pid", "mkddc-iobus", SIGHUP);
    return core && iobus;
}

bool CoreControl::restart_services()
{
    const bool core = signal_process("/run/mkddc/core.pid", "mkddc-core", SIGTERM);
    const bool iobus = signal_process("/run/mkddc/iobus.pid", "mkddc-iobus", SIGTERM);
    return core && iobus;
}

} // namespace hmi
