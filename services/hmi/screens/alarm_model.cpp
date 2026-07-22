#include "screens/screen_base.hpp"

#include <cstring>
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <chrono>

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

namespace hmi {

using json = nlohmann::json;

static AlarmSeverity parse_severity(const std::string& s)
{
    if (s == "fault" || s == "FAULT" || s == "critical" || s == "CRITICAL" ||
        s == "high" || s == "HIGH")
        return AlarmSeverity::FAULT;
    if (s == "warn" || s == "WARN" || s == "warning" || s == "WARNING" ||
        s == "medium" || s == "MEDIUM" || s == "low" || s == "LOW")
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

void AlarmModel::refresh_async()
{
    if (!api_ || !api_->authenticated() || api_pending_.valid()) return;
    ack_pending_ = false;
    api_pending_ = std::async(std::launch::async, [this] {
        return api_->request("alarms");
    });
}

void AlarmModel::poll_api()
{
    if (!api_pending_.valid() ||
        api_pending_.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready)
        return;
    const bool was_ack = ack_pending_;
    const ApiReply reply = api_pending_.get();
    ack_pending_ = false;
    if (reply.accepted() && reply.payload.contains("alarms")) {
        std::lock_guard<std::mutex> lk(mtx_);
        hydrated_ = true;
        for (auto& entry : ring_) entry = AlarmEntry{};
        head_ = 0; count_ = 0;
        for (const auto& alarm : reply.payload["alarms"]) {
            if (count_ >= RING) break;
            AlarmEntry& e = ring_[count_++];
            e.used = true;
            const std::string id = alarm.value("id", "");
            const std::string source = alarm.value("source", "");
            const std::string message = alarm.value("message", "");
            const std::string time = alarm.value("time", "");
            const std::string status = alarm.value("status", "active");
            std::snprintf(e.code, sizeof(e.code), "%s", id.c_str());
            std::snprintf(e.source, sizeof(e.source), "%s", source.c_str());
            std::snprintf(e.msg, sizeof(e.msg), "%s", message.c_str());
            std::snprintf(e.ts, sizeof(e.ts), "%s", time.c_str());
            e.severity = parse_severity(alarm.value("severity", "info"));
            const bool active = alarm.value("active", status == "active" || status == "unack");
            const bool acked = status == "acked" || status == "shelved";
            e.state = active ? (acked ? AlarmState::ACTIVE_ACK : AlarmState::ACTIVE_UNACK)
                             : (acked ? AlarmState::CLEARED_ACK : AlarmState::CLEARED_UNACK);
            head_ = count_ % RING;
        }
    }
    if (was_ack && reply.accepted()) refresh_async();
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
    std::string alarm_id;
    {
        std::lock_guard<std::mutex> lk(mtx_);
        const AlarmEntry& e = ring_[idx];
        if (!e.used || e.severity == AlarmSeverity::INFO ||
            (e.state != AlarmState::ACTIVE_UNACK && e.state != AlarmState::CLEARED_UNACK)) return;
        alarm_id = e.code;
    }
    if (!api_ || !api_->authenticated() || api_pending_.valid()) return;
    ack_pending_ = true;
    api_pending_ = std::async(std::launch::async, [this, alarm_id] {
        return api_->request("alarm_ack", {{"alarmId", alarm_id}});
    });
}

bool AlarmModel::can_ack(int idx) const
{
    if (!api_ || !api_->authenticated() || api_pending_.valid()) return false;
    std::lock_guard<std::mutex> lk(mtx_);
    if (!hydrated_ || idx < 0 || idx >= RING) return false;
    const AlarmEntry& e = ring_[idx];
    return e.used && e.severity != AlarmSeverity::INFO &&
           (e.state == AlarmState::ACTIVE_UNACK || e.state == AlarmState::CLEARED_UNACK);
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
