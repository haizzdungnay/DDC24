#include "api/hmi_api_client.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <utility>

#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace hmi {

namespace {
constexpr int PROTOCOL_VERSION = 1;
constexpr size_t MAX_FRAME = 8192;
constexpr int TIMEOUT_MS = 2500;

bool send_all(int fd, const std::string& value)
{
    size_t offset = 0;
    while (offset < value.size()) {
        const ssize_t n = ::send(fd, value.data() + offset, value.size() - offset, MSG_NOSIGNAL);
        if (n > 0) offset += static_cast<size_t>(n);
        else if (n < 0 && errno == EINTR) continue;
        else return false;
    }
    return true;
}

std::string safe_log(const std::string& value, size_t max)
{
    std::string out;
    for (char c : value) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-') out += c;
        if (out.size() >= max) break;
    }
    return out.empty() ? "-" : out;
}
} // namespace

HmiApiClient::HmiApiClient(std::string socket_path)
    : socket_path_(std::move(socket_path)) {}

void HmiApiClient::set_socket_path(std::string path)
{
    std::lock_guard<std::mutex> lock(mutex_);
    socket_path_ = std::move(path);
    broker_available_ = false;
    token_.clear(); username_.clear(); role_.clear(); point_actions_.clear();
    session_idle_s_ = 0; session_expires_ = {};
}

bool HmiApiClient::available() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return broker_available_;
}

std::string HmiApiClient::socket_path() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return socket_path_;
}

bool HmiApiClient::authenticated() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return !token_.empty() && session_idle_s_ > 0 &&
           std::chrono::steady_clock::now() < session_expires_;
}

std::string HmiApiClient::username() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return username_;
}

std::string HmiApiClient::role() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return role_;
}

bool HmiApiClient::can_control(const std::string& point_id,
                               const std::string& action) const
{
    std::lock_guard<std::mutex> lock(mutex_);
    const auto point = point_actions_.find(point_id);
    if (point == point_actions_.end()) return false;
    return action.empty() || point->second.find(action) != point->second.end();
}

std::string HmiApiClient::next_request_id()
{
    return "hmi-" + std::to_string(static_cast<unsigned long>(::getpid())) + "-" +
           std::to_string(sequence_.fetch_add(1) + 1);
}

void HmiApiClient::clear_session()
{
    std::lock_guard<std::mutex> lock(mutex_);
    token_.clear(); username_.clear(); role_.clear(); point_actions_.clear();
    session_idle_s_ = 0; session_expires_ = {};
}

void HmiApiClient::set_available(bool value)
{
    std::lock_guard<std::mutex> lock(mutex_);
    broker_available_ = value;
}

ApiReply HmiApiClient::login(const std::string& username, const std::string& password)
{
    ApiReply reply = request("login", {{"username", username}, {"password", password}}, false);
    if (reply.accepted()) {
        const std::string token = reply.payload.value("token", "");
        const std::string role = reply.payload.value("role", "");
        const uint32_t idle_s = reply.payload.value("expiresInS", 0u);
        if (token.empty() || role.empty() || idle_s == 0) {
            reply.transport_ok = false;
            reply.result.clear();
            reply.reason_code = "INVALID_RESPONSE";
            clear_session();
            return reply;
        }
        {
            std::lock_guard<std::mutex> lock(mutex_);
            token_ = token;
            username_ = username;
            role_ = role;
            session_idle_s_ = idle_s;
            session_expires_ = std::chrono::steady_clock::now() + std::chrono::seconds(idle_s);
            point_actions_.clear();
        }
        const ApiReply policy = request("policy");
        if (policy.accepted() && policy.payload.contains("policy")) {
            std::lock_guard<std::mutex> lock(mutex_);
            for (const auto& point : policy.payload["policy"]) {
                const std::string id = point.value("id", "");
                if (id.empty() || !point.contains("actions") || !point["actions"].is_array())
                    continue;
                auto& actions = point_actions_[id];
                for (const auto& action : point["actions"])
                    if (action.is_string() && !action.get<std::string>().empty())
                        actions.insert(action.get<std::string>());
                if (actions.empty()) point_actions_.erase(id);
            }
        }
    }
    return reply;
}

ApiReply HmiApiClient::logout()
{
    ApiReply reply = request("logout");
    clear_session();
    return reply;
}

ApiReply HmiApiClient::request(const std::string& action, nlohmann::json fields,
                               bool use_auth)
{
    ApiReply reply;
    reply.request_id = next_request_id();
    struct RequestLog {
        const ApiReply& reply;
        const std::string& action;
        ~RequestLog()
        {
            std::fprintf(stderr, "INFO hmi.api request_id=%s action=%s result=%s reason_code=%s\n",
                         safe_log(reply.request_id, 64).c_str(), safe_log(action, 24).c_str(),
                         safe_log(reply.result, 16).c_str(), safe_log(reply.reason_code, 32).c_str());
        }
    } request_log{reply, action};
    nlohmann::json request = std::move(fields);
    request["version"] = PROTOCOL_VERSION;
    request["requestId"] = reply.request_id;
    request["action"] = action;
    std::string path;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        path = socket_path_;
        if (use_auth) {
            if (token_.empty() || session_idle_s_ == 0 ||
                std::chrono::steady_clock::now() >= session_expires_) {
                token_.clear(); username_.clear(); role_.clear(); point_actions_.clear();
                session_idle_s_ = 0; session_expires_ = {};
                reply.reason_code = "SESSION_EXPIRED";
                return reply;
            }
            request["token"] = token_;
        }
    }

    const int fd = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (fd < 0 || path.empty()) {
        if (fd >= 0) ::close(fd);
        set_available(false);
        reply.reason_code = "BROKER_UNAVAILABLE";
        return reply;
    }
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    if (path.size() >= sizeof(addr.sun_path)) {
        ::close(fd); set_available(false); reply.reason_code = "BROKER_UNAVAILABLE"; return reply;
    }
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    if (::connect(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0 &&
        errno != EINPROGRESS) {
        ::close(fd); set_available(false); reply.reason_code = "BROKER_UNAVAILABLE"; return reply;
    }
    struct pollfd pfd{fd, POLLOUT, 0};
    if (::poll(&pfd, 1, TIMEOUT_MS) <= 0 || !(pfd.revents & POLLOUT)) {
        ::close(fd); set_available(false); reply.reason_code = "BROKER_TIMEOUT"; return reply;
    }
    int socket_error = 0;
    socklen_t socket_error_len = sizeof(socket_error);
    if (::getsockopt(fd, SOL_SOCKET, SO_ERROR, &socket_error, &socket_error_len) != 0 || socket_error != 0) {
        ::close(fd); set_available(false); reply.reason_code = "BROKER_UNAVAILABLE"; return reply;
    }
    const int flags = ::fcntl(fd, F_GETFL, 0);
    if (flags >= 0) (void)::fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);
    struct timeval timeout{TIMEOUT_MS / 1000, (TIMEOUT_MS % 1000) * 1000};
    (void)::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    (void)::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

    std::string line = request.dump();
    line += '\n';
    if (line.size() > MAX_FRAME || !send_all(fd, line)) {
        ::close(fd); set_available(false); reply.reason_code = "BROKER_UNAVAILABLE"; return reply;
    }
    std::string response;
    char buf[512];
    while (response.size() <= MAX_FRAME) {
        const ssize_t n = ::recv(fd, buf, sizeof(buf), 0);
        if (n > 0) {
            response.append(buf, static_cast<size_t>(n));
            const size_t newline = response.find('\n');
            if (newline != std::string::npos) { response.resize(newline); break; }
        } else if (n < 0 && errno == EINTR) continue;
        else break;
    }
    ::close(fd);
    try {
        if (response.empty() || response.size() > MAX_FRAME) throw std::runtime_error("bad frame");
        reply.payload = nlohmann::json::parse(response);
        if (reply.payload.value("version", 0) != PROTOCOL_VERSION)
            throw std::runtime_error("protocol version mismatch");
        reply.transport_ok = true;
        reply.result = reply.payload.value("result", "rejected");
        reply.reason_code = reply.payload.value("reasonCode", "INVALID_RESPONSE");
        reply.message = reply.payload.value("message", "");
        if (reply.payload.value("requestId", "") != reply.request_id)
            throw std::runtime_error("request id mismatch");
        set_available(true);
        if (reply.reason_code == "SESSION_EXPIRED" || reply.reason_code == "AUTH_REQUIRED")
            clear_session();
        else if (use_auth) {
            std::lock_guard<std::mutex> lock(mutex_);
            if (!token_.empty() && session_idle_s_ > 0)
                session_expires_ = std::chrono::steady_clock::now() +
                                   std::chrono::seconds(session_idle_s_);
        }
    } catch (...) {
        set_available(false);
        reply.transport_ok = false;
        reply.result.clear();
        reply.reason_code = "INVALID_RESPONSE";
    }
    return reply;
}

ApiReply HmiApiClient::command(const std::string& action, const std::string& point_id,
                               double value, const std::string& mode,
                               const std::string& reason, uint32_t ttl_s)
{
    nlohmann::json fields{{"pointId", point_id}};
    if (action != "release" && !(action == "mode" && mode == "auto")) fields["value"] = value;
    if (!mode.empty()) fields["mode"] = mode;
    if (!reason.empty()) fields["reason"] = reason;
    if (ttl_s > 0) fields["ttlS"] = ttl_s;
    return request(action, std::move(fields));
}

} // namespace hmi
