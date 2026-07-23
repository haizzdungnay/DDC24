#include "web_ipc.hpp"

#include <cctype>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <exception>
#include <limits>
#include <unordered_set>

#include <nlohmann/json.hpp>

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

namespace core {

void WebIpc::publish_point_snapshot(const RuntimePointSnapshot& snapshot)
{
#ifdef CORE_BUILD_TESTS
    if (publish_observer_) publish_observer_(publish_observer_context_);
#endif
    try {
#ifdef CORE_BUILD_TESTS
        snapshot_serialization_count_++;
#endif
        std::size_t payload_size = 0;
        if (!serialize_runtime_point_snapshot(snapshot, snapshot_payload_.data(),
                                              std::min(snapshot_payload_limit_,
                                                       snapshot_payload_.size()),
                                              &payload_size)) {
            snapshot_ = {};
            snapshot_payload_size_ = 0;
            snapshot_state_ = SnapshotCacheState::TOO_LARGE;
            return;
        }
        snapshot_ = snapshot;
        snapshot_payload_size_ = payload_size;
        snapshot_state_ = SnapshotCacheState::READY;
        snapshot_publish_count_++;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "ERROR point_snapshot.serialize error=%s\n", error.what());
        snapshot_ = {};
        snapshot_payload_size_ = 0;
        snapshot_state_ = SnapshotCacheState::ERROR;
    } catch (...) {
        std::fprintf(stderr, "ERROR point_snapshot.serialize error=unknown\n");
        snapshot_ = {};
        snapshot_payload_size_ = 0;
        snapshot_state_ = SnapshotCacheState::ERROR;
    }
}

bool parse_point_name(const std::string& name, PointId* out)
{
    size_t i = 0;
    while (i < name.size() && std::isalpha(static_cast<unsigned char>(name[i]))) i++;
    if (i == 0 || i >= name.size()) return false;
    const std::string kind = name.substr(0, i);
    int num = 0;
    for (; i < name.size(); ++i) {
        const unsigned char c = static_cast<unsigned char>(name[i]);
        if (c < '0' || c > '9') return false;
        const int digit = c - '0';
        if (num > (std::numeric_limits<int>::max() - digit) / 10) return false;
        num = num * 10 + digit;
    }
    if (num < 1) return false;
    out->idx = num - 1;
    if (kind == "AI")  out->kind = PointKind::AI;
    else if (kind == "BI" || kind == "DI") out->kind = PointKind::BI;
    else if (kind == "AO") out->kind = PointKind::AO;
    else if (kind == "BO" || kind == "DO") out->kind = PointKind::BO;
    else if (kind == "AV") out->kind = PointKind::AV;
    else if (kind == "BV") out->kind = PointKind::BV;
    else if (kind == "MSV") out->kind = PointKind::MSV;
    else return false;
    return PointTable::valid(*out);
}

enum class RequestParseError { None, Invalid, ValueOverflow, DurationOverflow };

static RequestParseError parse_request(const std::string& line, nlohmann::json* request)
{
    std::string top_level_key;
    try {
        std::unordered_set<std::string> keys;
        bool duplicate = false;
        *request = nlohmann::json::parse(
            line, [&](int depth, nlohmann::json::parse_event_t event, nlohmann::json& parsed) {
                if (depth == 1 && event == nlohmann::json::parse_event_t::key) {
                    top_level_key = parsed.get<std::string>();
                    duplicate = !keys.insert(parsed.get<std::string>()).second || duplicate;
                }
                return true;
            });
        return request->is_object() && !duplicate ? RequestParseError::None
                                                  : RequestParseError::Invalid;
    } catch (const nlohmann::json::out_of_range& error) {
        if (error.id == 406 && top_level_key == "value")
            return RequestParseError::ValueOverflow;
        if (error.id == 406 && top_level_key == "durationS")
            return RequestParseError::DurationOverflow;
        return RequestParseError::Invalid;
    } catch (const nlohmann::json::exception&) {
        return RequestParseError::Invalid;
    }
}

/* user vào audit log: [A-Za-z0-9_.@:-], max 48 (07 §8 — bacnet dùng ':' cho IP) */
static std::string sanitize_user(const std::string& s)
{
    std::string out;
    out.reserve(48);
    for (const char c : s) {
        if (std::isalnum(static_cast<unsigned char>(c)) ||
            c == '_' || c == '.' || c == '@' || c == '-' || c == ':')
            out += c;
        if (out.size() >= 48) break;
    }
    return out.empty() ? "-" : out;
}

/* point name vào audit log: chỉ giữ [A-Za-z0-9], max 8 — chống log injection */
static std::string sanitize_point_name(const std::string& s)
{
    std::string out;
    out.reserve(8);
    for (const char c : s) {
        if (std::isalnum(static_cast<unsigned char>(c)))
            out += c;
        if (out.size() >= 8) break;
    }
    return out.empty() ? "-" : out;
}

static bool valid_alarm_id(const std::string& s)
{
    if (s.empty()) return false;
    for (const char c : s) {
        if (c <= ' ' || c == '/' || c == '\\') return false;
    }
    return true;
}

static std::string json_escape(const std::string& s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (const char c : s) {
        switch (c) {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) out += '?';
            else out += c;
            break;
        }
    }
    return out;
}

static const char* op_name(const WebCommand& cmd)
{
    if (cmd.kind == WebCommandKind::AlarmList) return "alarm_list";
    if (cmd.kind == WebCommandKind::AlarmAck) return "alarm_ack";
    if (cmd.kind == WebCommandKind::AlarmSuppress) return "alarm_suppress";
    if (cmd.kind == WebCommandKind::AlarmReturn) return "alarm_return";
    if (cmd.is_query) return "query";
    return cmd.is_write ? "write" : "release";
}

WebIpc::~WebIpc()
{
    close();
}

bool WebIpc::open(const std::string& sock_path)
{
    path_ = sock_path;
    fd_ = ::socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (fd_ < 0) {
        std::fprintf(stderr, "WARN  web_ipc.socket_fail errno=%d (degraded)\n", errno);
        return false;
    }
    ::unlink(path_.c_str());
    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, path_.c_str(), sizeof(addr.sun_path) - 1);
    if (::bind(fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0 ||
        ::listen(fd_, 4) != 0) {
        std::fprintf(stderr, "WARN  web_ipc.bind_fail path=%s errno=%d (degraded)\n",
                     path_.c_str(), errno);
        ::close(fd_);
        fd_ = -1;
        return false;
    }
    ::chmod(path_.c_str(), 0660);   /* group mkddc (07 §8) */
    std::fprintf(stderr, "INFO  web_ipc.listen path=%s\n", path_.c_str());
    return true;
}

void WebIpc::close()
{
    for (auto& c : clients_) ::close(c.fd);
    clients_.clear();
    if (fd_ >= 0) {
        ::close(fd_);
        ::unlink(path_.c_str());
        fd_ = -1;
    }
    response_cache_.clear();
    response_order_.clear();
}

void WebIpc::respond(const WebCommand& command, const std::string& json_line)
{
    for (auto it = clients_.begin(); it != clients_.end(); ++it) {
        Client& client = *it;
        if ((command.client_id != 0 && client.id != command.client_id) ||
            (command.client_id == 0 && client.fd != command.client_fd))
            continue;
        queue_response(client, json_line + "\n");
        if (client.outstanding > 0) client.outstanding--;
        const std::size_t before = client.write_budget_remaining;
        flush_client(client, &client.write_budget_remaining);
        outbound_budget_remaining_ -= before - client.write_budget_remaining;
        if (client.hard_close) {
            ::close(client.fd);
            clients_.erase(it);
        }
        return;
    }
}

void WebIpc::respond_command(const WebCommand& command, const std::string& json_line)
{
    const auto cached = response_cache_.find(command.id);
    if (cached != response_cache_.end()) cached->second.response = json_line;
    respond(command, json_line);
}

void WebIpc::remember_pending(uint64_t id, const std::string& request)
{
    while (response_order_.size() >= RESPONSE_CACHE_LIMIT) {
        response_cache_.erase(response_order_.front());
        response_order_.pop_front();
    }
    response_order_.push_back(id);
    response_cache_[id] = CachedResponse{request, std::string()};
}

ssize_t WebIpc::send_bytes(int fd, const void* data, std::size_t size, int flags)
{
#ifdef CORE_BUILD_TESTS
    if (send_adapter_) return send_adapter_(fd, data, size, flags, send_adapter_context_);
#endif
    return ::send(fd, data, size, flags);
}

bool WebIpc::queue_response(Client& client, std::string response, bool close_after)
{
    if (response.size() > KX_POINT_SNAPSHOT_MAX_PAYLOAD ||
        client.output.size() > KX_POINT_SNAPSHOT_MAX_PAYLOAD - response.size()) {
        if (client.output.empty()) {
            client.output = "{\"id\":0,\"result\":\"rejected\","
                            "\"error\":\"response_too_large\"}\n";
        }
        client.close_after_flush = true;
        return false;
    }
    client.output += response;
    client.close_after_flush = client.close_after_flush || close_after;
    return true;
}

void WebIpc::flush_client(Client& client, std::size_t* write_budget)
{
    int interrupted = 0;
    while (!client.output.empty() && *write_budget > 0) {
        const std::size_t count = std::min(client.output.size(), *write_budget);
        const ssize_t sent = send_bytes(client.fd, client.output.data(), count,
                                        MSG_NOSIGNAL | MSG_DONTWAIT);
        if (sent > 0) {
            client.output.erase(0, static_cast<std::size_t>(sent));
            *write_budget -= static_cast<std::size_t>(sent);
#ifdef CORE_BUILD_TESTS
            budget_counters_.write_bytes += static_cast<std::size_t>(sent);
#endif
            interrupted = 0;
            continue;
        }
        if (sent < 0 && errno == EINTR && interrupted++ < 3) continue;
        if (sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;
        client.hard_close = true;
        return;
    }
}

void WebIpc::reap_disconnected_clients()
{
    for (auto it = clients_.begin(); it != clients_.end();) {
        Client& client = *it;
        char byte = 0;
        const ssize_t received = ::recv(client.fd, &byte, 1, MSG_PEEK | MSG_DONTWAIT);
        if (received == 0) {
            client.read_closed = true;
        } else if (received < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
            client.hard_close = true;
        }
        if (client.hard_close ||
            (client.read_closed && client.outstanding == 0 && client.output.empty())) {
            ::close(client.fd);
            it = clients_.erase(it);
        } else {
            ++it;
        }
    }
}

bool WebIpc::handle_snapshot_line(Client& client, const std::string& line,
                                  bool* snapshot_accepted)
{
    uint64_t id = 0;
    bool valid = true;
    nlohmann::json request;
    try {
        std::unordered_set<std::string> keys;
        bool duplicate = false;
        request = nlohmann::json::parse(
            line, [&](int depth, nlohmann::json::parse_event_t event, nlohmann::json& parsed) {
                if (depth == 1 && event == nlohmann::json::parse_event_t::key)
                    duplicate = !keys.insert(parsed.get<std::string>()).second || duplicate;
                return true;
            });
        valid = request.is_object() && !duplicate && request.contains("id") &&
                request["id"].is_number_unsigned() && request.contains("op") &&
                request["op"].is_string() && request["op"] == "point_snapshot" &&
                request.contains("user") && request["user"].is_string() &&
                !request["user"].get_ref<const std::string&>().empty();
        if (valid) id = request["id"].get<uint64_t>();
    } catch (const nlohmann::json::exception&) {
        valid = false;
    }

    auto rejected = [&](const char* error) {
        queue_response(client, "{\"id\":" + std::to_string(id) +
                                   ",\"result\":\"rejected\",\"error\":\"" +
                                   error + "\"}\n");
    };
    if (!valid) {
        rejected("bad_request");
        return true;
    }
    if (*snapshot_accepted) {
        rejected("busy");
        return true;
    }
    if (snapshot_state_ == SnapshotCacheState::UNAVAILABLE) {
        rejected("snapshot_unavailable");
        return true;
    }
    if (snapshot_state_ == SnapshotCacheState::TOO_LARGE) {
        rejected("snapshot_too_large");
        return true;
    }
    if (snapshot_state_ == SnapshotCacheState::ERROR) {
        rejected("snapshot_error");
        return true;
    }

    char prefix[96];
    const int prefix_size = std::snprintf(prefix, sizeof(prefix),
                                          "{\"id\":%llu,\"result\":\"accepted\",",
                                          static_cast<unsigned long long>(id));
    if (prefix_size <= 0 || static_cast<std::size_t>(prefix_size) >= sizeof(prefix) ||
        snapshot_payload_size_ < 1) {
        rejected("response_too_large");
        return true;
    }
    std::string response;
    response.reserve(static_cast<std::size_t>(prefix_size) + snapshot_payload_size_ + 1);
    response.append(prefix, static_cast<std::size_t>(prefix_size));
    response.append(snapshot_payload_.data() + 1, snapshot_payload_size_ - 1);
    response += '\n';
    if (!queue_response(client, std::move(response))) return true;
    *snapshot_accepted = true;
#ifdef CORE_BUILD_TESTS
    budget_counters_.snapshot_accepted++;
#endif
    return true;
}

static bool is_snapshot_request(const std::string& line)
{
    nlohmann::json request;
    return parse_request(line, &request) == RequestParseError::None &&
           request.contains("op") &&
           request["op"].is_string() && request["op"] == "point_snapshot";
}

/* 1 dòng/lệnh, format chuẩn 07 §8 — stderr→journald giữ timestamp */
void WebIpc::audit(const WebCommand& cmd, const char* result, const char* active_source,
                   float applied_value)
{
    std::fprintf(stderr,
                 "AUDIT web_cmd id=%llu user=%s point=%s op=%s value=%g result=%s"
                 " active_source=%s\n",
                 static_cast<unsigned long long>(cmd.id),
                 cmd.user.empty() ? "-" : cmd.user.c_str(),
                 cmd.point_name.empty() ? "-" : cmd.point_name.c_str(),
                 op_name(cmd),
                 static_cast<double>(applied_value), result, active_source);
}

void WebIpc::respond_accepted(const WebCommand& cmd, float applied_value,
                              const char* active_source, uint32_t remaining_ttl_s)
{
    std::string json = "{\"id\":" + std::to_string(cmd.id) +
                       ",\"result\":\"accepted\",\"applied_value\":" +
                       std::to_string(applied_value) + ",\"active_source\":\"" +
                       active_source + "\"";
    if (remaining_ttl_s > 0)
        json += ",\"remaining_ttl_s\":" + std::to_string(remaining_ttl_s);
    json += "}";
    respond_command(cmd, json);
    audit(cmd, "accepted", active_source, applied_value);
}

void WebIpc::respond_overridden(const WebCommand& cmd, float applied_value,
                                const char* active_source, uint32_t remaining_ttl_s)
{
    std::string json = "{\"id\":" + std::to_string(cmd.id) +
                       ",\"result\":\"overridden\",\"applied_value\":" +
                       std::to_string(applied_value) + ",\"active_source\":\"" +
                       active_source + "\"";
    if (remaining_ttl_s > 0)
        json += ",\"remaining_ttl_s\":" + std::to_string(remaining_ttl_s);
    json += "}";
    respond_command(cmd, json);
    audit(cmd, "overridden", active_source, applied_value);
}

void WebIpc::respond_rejected(const WebCommand& cmd, const char* error)
{
    char buf[128];
    std::snprintf(buf, sizeof(buf), "{\"id\":%llu,\"result\":\"rejected\",\"error\":\"%s\"}",
                  static_cast<unsigned long long>(cmd.id), error);
    respond_command(cmd, buf);
    audit(cmd, "rejected", "-", cmd.value);
}

void WebIpc::respond_alarm_list(const WebCommand& cmd, const std::vector<AlarmState>& alarms)
{
    std::string json = "{\"id\":" + std::to_string(cmd.id) +
                       ",\"result\":\"accepted\",\"alarms\":[";
    for (std::size_t i = 0; i < alarms.size(); i++) {
        const AlarmState& alarm = alarms[i];
        if (i != 0) json += ',';
        json += "{\"id\":\"" + json_escape(alarm.id) + "\"";
        json += ",\"alarmSettingId\":\"" + json_escape(alarm.alarm_setting_id) + "\"";
        json += ",\"time\":\"" + json_escape(alarm.time) + "\"";
        json += ",\"status\":\"" + json_escape(alarm.status) + "\"";
        json += ",\"sourcePointId\":\"" + json_escape(alarm.source_point_id) + "\"";
        json += ",\"value\":" + std::to_string(alarm.value);
        json += ",\"triggerLevel\":\"" + json_escape(alarm.trigger_level) + "\"";
        json += ",\"threshold\":" + std::to_string(alarm.threshold);
        json += ",\"priority\":\"" + json_escape(alarm.priority) + "\"";
        json += ",\"label\":\"" + json_escape(alarm.label) + "\"";
        json += ",\"alarmType\":" + std::to_string(alarm.alarm_type);
        json += ",\"occurrence\":" + std::to_string(alarm.occurrence);
        json += ",\"active\":" + std::string(alarm.active ? "true" : "false");
        json += "}";
    }
    json += "]}";
    respond_command(cmd, json);
    audit(cmd, "accepted", "alarm", 0.0f);
}

void WebIpc::respond_alarm_ack_accepted(const WebCommand& cmd)
{
    const std::string json = "{\"id\":" + std::to_string(cmd.id) +
                             ",\"result\":\"accepted\",\"alarmId\":\"" +
                             json_escape(cmd.alarm_id) + "\"}";
    respond_command(cmd, json);
    audit(cmd, "accepted", "alarm", 0.0f);
}

void WebIpc::respond_alarm_suppress_accepted(const WebCommand& cmd)
{
    const std::string json = "{\"id\":" + std::to_string(cmd.id) +
                             ",\"result\":\"accepted\",\"alarmId\":\"" +
                             json_escape(cmd.alarm_id) + "\"}";
    respond_command(cmd, json);
    audit(cmd, "accepted", "alarm", 0.0f);
}

void WebIpc::respond_alarm_return_accepted(const WebCommand& cmd)
{
    const std::string json = "{\"id\":" + std::to_string(cmd.id) +
                             ",\"result\":\"accepted\",\"alarmId\":\"" +
                             json_escape(cmd.alarm_id) + "\"}";
    respond_command(cmd, json);
    audit(cmd, "accepted", "alarm", 0.0f);
}

void WebIpc::handle_line(Client& client, const std::string& line,
                         std::vector<WebCommand>* out)
{
    WebCommand cmd;
    cmd.client_fd = client.fd;
    cmd.client_id = client.id;
    auto reject = [&](const char* error) {
        queue_response(client, "{\"id\":" + std::to_string(cmd.id) +
                                   ",\"result\":\"rejected\",\"error\":\"" +
                                   error + "\"}\n");
        audit(cmd, "rejected", "-", cmd.value);
    };
    nlohmann::json request;
    const RequestParseError parse_error = parse_request(line, &request);
    if (parse_error != RequestParseError::None) {
        reject(parse_error == RequestParseError::ValueOverflow
                   ? "bad_value"
                   : parse_error == RequestParseError::DurationOverflow ? "bad_duration"
                                                                         : "bad_request");
        return;
    }
    if (!request.contains("id") ||
        !request["id"].is_number_unsigned() || !request.contains("op") ||
        !request["op"].is_string()) {
        reject("bad_request");
        return;
    }
    cmd.id = request["id"].get<uint64_t>();
    const std::string op = request["op"].get<std::string>();
    cmd.is_write = op == "write";
    const bool has_user = request.contains("user") && request["user"].is_string() &&
                          !request["user"].get_ref<const std::string&>().empty();
    cmd.user = sanitize_user(has_user ? request["user"].get<std::string>() : "");
    if (!has_user || cmd.user == "-") {
        reject("bad_request");
        return;
    }
    std::string point;
    if (request.contains("point") && request["point"].is_string()) {
        point = request["point"].get<std::string>();
        cmd.point_name = sanitize_point_name(point);
    }
    const auto cached = response_cache_.find(cmd.id);
    if (cached != response_cache_.end()) {
        if (cached->second.request != line) {
            queue_response(client, "{\"id\":" + std::to_string(cmd.id) +
                                       ",\"result\":\"rejected\","
                                       "\"error\":\"id_conflict\"}\n");
        } else if (cached->second.response.empty()) {
            queue_response(client, "{\"id\":" + std::to_string(cmd.id) +
                                       ",\"result\":\"rejected\","
                                       "\"error\":\"duplicate_pending\"}\n");
        } else {
            queue_response(client, cached->second.response + "\n");
        }
        return;
    }
    if (op == "alarm_list" || op == "alarm_ack" ||
        op == "alarm_suppress" || op == "alarm_return") {
        if (op == "alarm_list") cmd.kind = WebCommandKind::AlarmList;
        else if (op == "alarm_ack") cmd.kind = WebCommandKind::AlarmAck;
        else if (op == "alarm_suppress") cmd.kind = WebCommandKind::AlarmSuppress;
        else cmd.kind = WebCommandKind::AlarmReturn;
        if (cmd.kind == WebCommandKind::AlarmAck ||
            cmd.kind == WebCommandKind::AlarmSuppress ||
            cmd.kind == WebCommandKind::AlarmReturn) {
            if (!request.contains("alarmId") || !request["alarmId"].is_string()) {
                reject("bad_request");
                return;
            }
            const std::string alarm_id = request["alarmId"].get<std::string>();
            if (!valid_alarm_id(alarm_id)) { reject("bad_request"); return; }
            cmd.alarm_id = alarm_id;
        }
        if (cmd.kind == WebCommandKind::AlarmAck ||
            cmd.kind == WebCommandKind::AlarmSuppress) {
            const bool has_duration = request.contains("durationS");
            const bool has_permanent = request.contains("permanent");
            if (has_duration && (!request["durationS"].is_number() ||
                                 !std::isfinite(cmd.duration_s = request["durationS"].get<double>()) ||
                                 cmd.duration_s <= 0.0)) {
                reject("bad_duration");
                return;
            }
            if (has_permanent && !request["permanent"].is_boolean()) {
                reject("bad_request");
                return;
            }
            if (has_permanent) cmd.permanent = request["permanent"].get<bool>();
            if (has_duration && !has_permanent) cmd.permanent = false;
            if (!cmd.permanent && !has_duration) {
                reject("bad_duration");
                return;
            }
        }
        if (out->size() >= 64) {
            reject("busy");
            return;
        }
        remember_pending(cmd.id, line);
        out->push_back(cmd);
        client.outstanding++;
        return;
    }

    if (point.empty() || !request.contains("source") || !request["source"].is_string()) {
        reject("bad_request");
        return;
    }
    const std::string source = request["source"].get<std::string>();
    /* 07 §8 BAC-CONFLICT-001: source enum mức 2 manual + mức 3 bacnet */
    if (source == "manual") {
        cmd.prio = 2;   /* PRIO_LOCAL_MANUAL */
    } else if (source == "bacnet") {
        cmd.prio = 3;   /* PRIO_BACNET */
    } else {
        reject("unknown_source");
        return;
    }
    if (!parse_point_name(point, &cmd.point)) {
        reject("unknown_point");
        return;
    }
    if (op != "query" && (cmd.point.kind == PointKind::AI || cmd.point.kind == PointKind::BI)) {
        reject("readonly_point");
        return;
    }
    if (op == "write") {
        if (!request.contains("value") || !request["value"].is_number()) {
            reject("bad_value");
            return;
        }
        const double v = request["value"].get<double>();
        const float fv = static_cast<float>(v);
        if (!std::isfinite(v) || !std::isfinite(fv)) {
            reject("bad_value");
            return;
        }
        cmd.is_write = true;
        cmd.value = fv;
    } else if (op == "release") {
        cmd.is_write = false;
    } else if (op == "query") {
        cmd.is_write = false;
        cmd.is_query = true;
    } else {
        reject("bad_request");
        return;
    }
    if (request.contains("ttlS")) {
        if (!cmd.is_write || source != "manual" || !request["ttlS"].is_number_unsigned()) {
            reject("bad_ttl");
            return;
        }
        const uint64_t ttl = request["ttlS"].get<uint64_t>();
        if (ttl < 1 || ttl > 86400) {
            reject("bad_ttl");
            return;
        }
        cmd.ttl_s = static_cast<uint32_t>(ttl);
    }
    if (out->size() >= 64) {        /* queue đầy → rejected busy (07 §8) */
        reject("busy");
        return;
    }
    remember_pending(cmd.id, line);
    out->push_back(cmd);
    client.outstanding++;
}

std::vector<WebCommand> WebIpc::drain()
{
    std::vector<WebCommand> out;
    if (fd_ < 0) return out;

#ifdef CORE_BUILD_TESTS
    budget_counters_ = {};
#endif
    outbound_budget_remaining_ = KX_POINT_SNAPSHOT_MAX_PAYLOAD;
    constexpr std::size_t max_clients = 4;
    constexpr std::size_t max_accept_attempts = 4;
    constexpr std::size_t max_read_bytes = 64u * 1024u;
    constexpr std::size_t max_lines = 64;
    std::size_t read_budget = max_read_bytes;
    std::size_t line_budget = max_lines;
    bool snapshot_accepted = false;

    /* One-shot clients close after reading their response; free those slots before admission. */
    reap_disconnected_clients();

    /* accept client mới */
    for (std::size_t attempt = 0; attempt < max_accept_attempts; ++attempt) {
#ifdef CORE_BUILD_TESTS
        budget_counters_.accept_attempts++;
#endif
        const int cfd = ::accept4(fd_, nullptr, nullptr, SOCK_NONBLOCK | SOCK_CLOEXEC);
        if (cfd < 0) break;
        if (clients_.size() >= max_clients) {
            ::close(cfd);
            continue;
        }
        clients_.push_back({cfd, next_client_id_++, {}, {}, false, false, false, 0, 0});
        std::fprintf(stderr, "INFO  web_ipc.client_connected fd=%d\n", cfd);
    }

    constexpr std::size_t read_quantum = 16u * 1024u;
    constexpr std::size_t line_quantum = 16;
    constexpr std::size_t write_quantum = 16u * 1024u;
    std::vector<uint64_t> order;
    order.reserve(clients_.size());
    if (!clients_.empty()) {
        round_robin_cursor_ %= clients_.size();
        for (std::size_t offset = 0; offset < clients_.size(); ++offset)
            order.push_back(clients_[(round_robin_cursor_ + offset) % clients_.size()].id);
        round_robin_cursor_ = (round_robin_cursor_ + 1) % clients_.size();
    }

    /* đọc JSON lines từ mọi client */
    for (const uint64_t client_id : order) {
        const auto found = std::find_if(clients_.begin(), clients_.end(),
                                        [client_id](const Client& client) {
                                            return client.id == client_id;
                                        });
        if (found == clients_.end()) continue;
        Client& c = *found;
        std::size_t client_read_budget = std::min(read_budget, read_quantum);
        std::size_t client_line_budget = std::min(line_budget, line_quantum);
        c.write_budget_remaining = std::min(outbound_budget_remaining_, write_quantum);
        char buf[1024];
        for (; !c.read_closed && !c.close_after_flush && !c.hard_close &&
               client_read_budget > 0;) {
            const std::size_t count = std::min(sizeof(buf), client_read_budget);
            const ssize_t r = ::recv(c.fd, buf, count, MSG_DONTWAIT);
            if (r > 0) {
                c.input.append(buf, static_cast<size_t>(r));
                client_read_budget -= static_cast<std::size_t>(r);
                read_budget -= static_cast<std::size_t>(r);
#ifdef CORE_BUILD_TESTS
                budget_counters_.read_bytes += static_cast<std::size_t>(r);
#endif
                if (c.input.size() > KX_POINT_SNAPSHOT_MAX_PAYLOAD) {
                    c.input.clear();
                    c.read_closed = true;
                    queue_response(c, "{\"id\":0,\"result\":\"rejected\","
                                      "\"error\":\"bad_request\"}\n", true);
                    c.hard_close = true;
                    break;
                }
            } else if (r == 0) {
                c.read_closed = true;
                break;
            } else {
                if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                if (errno == EINTR) continue;
                c.read_closed = true;
                c.close_after_flush = true;
                break;
            }
        }
        size_t pos;
        while (!c.close_after_flush && !c.hard_close && client_line_budget > 0 &&
               (pos = c.input.find('\n')) != std::string::npos) {
            const std::string line = c.input.substr(0, pos);
            const bool snapshot_request = is_snapshot_request(line);
            if (snapshot_request) {
                const std::size_t reserve = snapshot_accepted ||
                                                     snapshot_state_ != SnapshotCacheState::READY
                                                 ? 128u
                                                 : snapshot_payload_size_ + 64u;
                if ((reserve > KX_POINT_SNAPSHOT_MAX_PAYLOAD && !c.output.empty()) ||
                    (reserve <= KX_POINT_SNAPSHOT_MAX_PAYLOAD &&
                     c.output.size() > KX_POINT_SNAPSHOT_MAX_PAYLOAD - reserve))
                    break;
            }
            c.input.erase(0, pos + 1);
            client_line_budget--;
            line_budget--;
#ifdef CORE_BUILD_TESTS
            budget_counters_.lines++;
#endif
            if (!line.empty() &&
                !(snapshot_request && handle_snapshot_line(c, line, &snapshot_accepted)))
                handle_line(c, line, &out);
        }
        flush_client(c, &c.write_budget_remaining);
        const std::size_t written = std::min(write_quantum, outbound_budget_remaining_) -
                                    c.write_budget_remaining;
        outbound_budget_remaining_ -= written;
        if (c.hard_close || ((c.read_closed || c.close_after_flush) &&
                             c.outstanding == 0 && c.output.empty())) {
            ::close(c.fd);
            clients_.erase(std::find_if(clients_.begin(), clients_.end(),
                                        [client_id](const Client& client) {
                                            return client.id == client_id;
                                        }));
        }
    }
    return out;
}

} // namespace core
