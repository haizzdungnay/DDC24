#include "screens/screen_base.hpp"

#include <cstring>
#include <algorithm>
#include <cerrno>
#include <cstdio>

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

namespace hmi {

using json = nlohmann::json;

static AlarmSeverity parse_severity(const std::string& s)
{
    if (s == "fault" || s == "FAULT" || s == "critical" || s == "CRITICAL")
        return AlarmSeverity::FAULT;
    if (s == "warn" || s == "WARN" || s == "warning" || s == "WARNING")
        return AlarmSeverity::WARN;
    return AlarmSeverity::INFO;
}

AlarmModel::~AlarmModel()
{
    close_socket();
}

bool AlarmModel::open_socket(const std::string& path)
{
    close_socket();
    const int fd = ::socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (fd < 0) return false;
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    if (path.size() >= sizeof(addr.sun_path)) {
        ::close(fd);
        return false;
    }
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    ::unlink(path.c_str());
    if (::bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
        std::fprintf(stderr, "WARN  hmi.alarm bind path=%s errno=%d\n", path.c_str(), errno);
        ::close(fd);
        return false;
    }
    socket_fd_ = fd;
    socket_path_ = path;
    return true;
}

void AlarmModel::close_socket()
{
    if (socket_fd_ >= 0) {
        ::close(socket_fd_);
        socket_fd_ = -1;
    }
    if (!socket_path_.empty()) {
        ::unlink(socket_path_.c_str());
        socket_path_.clear();
    }
}

void AlarmModel::drain_socket()
{
    if (socket_fd_ < 0) return;
    char buf[2048];
    for (;;) {
        const ssize_t n = ::recv(socket_fd_, buf, sizeof(buf), MSG_DONTWAIT);
        if (n > 0) {
            on_alarm_json(buf, static_cast<size_t>(n));
            continue;
        }
        if (n < 0 && errno == EINTR) continue;
        break;
    }
}

void AlarmModel::on_alarm_json(const char* buf, size_t len)
{
    try {
        json j = json::parse(buf, buf + len);
        std::string code_s = j.value("code", "");
        if (code_s.empty()) return;

        bool active = j.value("active", true);
        const std::string state = j.value("state", "");
        const std::string event = j.value("event", "");
        if (state.rfind("CLEARED_", 0) == 0 || event == "clear") active = false;
        const std::string ts  = j.value("ts", "");
        const std::string src = j.value("source", "");
        const std::string msg = j.value("message", j.value("msg", ""));
        update_condition(code_s.c_str(), active,
                         parse_severity(j.value("severity", "info")),
                         src.c_str(), msg.c_str(), ts.c_str());
    } catch (...) {}
}

void AlarmModel::update_condition(const char* code, bool active, AlarmSeverity severity,
                                  const char* source, const char* message, const char* ts)
{
    if (!code || !code[0]) return;
    std::lock_guard<std::mutex> lk(mtx_);
    int idx = find_code(code);
    if (idx < 0) {
        idx = head_;
        head_ = (head_ + 1) % RING;
        if (count_ < RING) ++count_;
        ring_[idx] = AlarmEntry{};
        ring_[idx].used = true;
        ring_[idx].state = active ? AlarmState::ACTIVE_UNACK : AlarmState::CLEARED_UNACK;
    } else if (active) {
        if (ring_[idx].state == AlarmState::CLEARED_ACK ||
            ring_[idx].state == AlarmState::CLEARED_UNACK)
            ring_[idx].state = AlarmState::ACTIVE_UNACK;
    } else {
        if (ring_[idx].state == AlarmState::ACTIVE_UNACK)
            ring_[idx].state = AlarmState::CLEARED_UNACK;
        else if (ring_[idx].state == AlarmState::ACTIVE_ACK)
            ring_[idx].state = AlarmState::CLEARED_ACK;
    }
    AlarmEntry& e = ring_[idx];
    std::snprintf(e.code, sizeof(e.code), "%s", code);
    std::snprintf(e.source, sizeof(e.source), "%s", source ? source : "");
    std::snprintf(e.msg, sizeof(e.msg), "%s", message ? message : "");
    std::snprintf(e.ts, sizeof(e.ts), "%s", ts ? ts : "");
    e.severity = severity;
}

void AlarmModel::ack(int idx)
{
    if (idx < 0 || idx >= RING) return;
    std::lock_guard<std::mutex> lk(mtx_);
    AlarmEntry& e = ring_[idx];
    if (!e.used) return;
    if (e.severity == AlarmSeverity::INFO) return;
    if (e.state == AlarmState::ACTIVE_UNACK)  e.state = AlarmState::ACTIVE_ACK;
    if (e.state == AlarmState::CLEARED_UNACK) e.state = AlarmState::CLEARED_ACK;
}

std::array<AlarmEntry, AlarmModel::RING> AlarmModel::snapshot(int* count) const
{
    std::lock_guard<std::mutex> lk(mtx_);
    std::array<AlarmEntry, RING> out{};
    std::memcpy(out.data(), ring_, sizeof(ring_));
    if (count) *count = count_;
    return out;
}

int AlarmModel::active_count() const
{
    std::lock_guard<std::mutex> lk(mtx_);
    int n = 0;
    for (int i = 0; i < RING; i++) {
        if (!ring_[i].used) continue;
        if (ring_[i].state == AlarmState::ACTIVE_UNACK ||
            ring_[i].state == AlarmState::ACTIVE_ACK)
            ++n;
    }
    return n;
}

int AlarmModel::unacked_count() const
{
    std::lock_guard<std::mutex> lk(mtx_);
    int n = 0;
    for (int i = 0; i < RING; i++) {
        if (!ring_[i].used) continue;
        if (ring_[i].state == AlarmState::ACTIVE_UNACK ||
            ring_[i].state == AlarmState::CLEARED_UNACK)
            ++n;
    }
    return n;
}

int AlarmModel::critical_count() const
{
    std::lock_guard<std::mutex> lk(mtx_);
    int n = 0;
    for (int i = 0; i < RING; i++) {
        if (!ring_[i].used) continue;
        if (ring_[i].severity == AlarmSeverity::FAULT &&
            (ring_[i].state == AlarmState::ACTIVE_UNACK ||
             ring_[i].state == AlarmState::ACTIVE_ACK))
            ++n;
    }
    return n;
}

int AlarmModel::find_code(const char* code)
{
    for (int i = 0; i < RING; i++) {
        if (ring_[i].used && std::strcmp(ring_[i].code, code) == 0)
            return i;
    }
    return -1;
}

} // namespace hmi
