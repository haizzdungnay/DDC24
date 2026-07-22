#include "web_ipc.hpp"

#include <cctype>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cmath>

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

namespace core {

bool parse_point_name(const std::string& name, PointId* out)
{
    size_t i = 0;
    while (i < name.size() && std::isalpha(static_cast<unsigned char>(name[i]))) i++;
    if (i == 0 || i >= name.size()) return false;
    const std::string kind = name.substr(0, i);
    const int num = std::atoi(name.c_str() + i);
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

/* ---- JSON helpers tối thiểu (flat object, 1 dòng) ---- */

static bool jget_string(const std::string& s, const char* key, std::string* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    p++;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    if (p >= s.size() || s[p] != '"') return false;
    const size_t e = s.find('"', p + 1);
    if (e == std::string::npos) return false;
    *out = s.substr(p + 1, e - p - 1);
    return true;
}

static bool jhas_key(const std::string& s, const char* key)
{
    return s.find(std::string("\"") + key + "\"") != std::string::npos;
}

static bool jget_number(const std::string& s, const char* key, double* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    p++;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    char* end = nullptr;
    const double v = std::strtod(s.c_str() + p, &end);
    if (end == s.c_str() + p) return false;
    *out = v;
    return true;
}

static bool jget_bool(const std::string& s, const char* key, bool* out)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    p++;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) p++;
    if (s.compare(p, 4, "true") == 0) {
        *out = true;
        return true;
    }
    if (s.compare(p, 5, "false") == 0) {
        *out = false;
        return true;
    }
    return false;
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

void WebIpc::respond(int fd, const std::string& json_line)
{
    const std::string line = json_line + "\n";
    (void)!::send(fd, line.c_str(), line.size(), MSG_NOSIGNAL | MSG_DONTWAIT);
}

void WebIpc::respond_command(const WebCommand& cmd, const std::string& json_line)
{
    const auto it = response_cache_.find(cmd.id);
    if (it != response_cache_.end()) it->second.response = json_line;
    respond(cmd.client_fd, json_line);
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
    if (remaining_ttl_s > 0) json += ",\"remaining_ttl_s\":" + std::to_string(remaining_ttl_s);
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
    if (remaining_ttl_s > 0) json += ",\"remaining_ttl_s\":" + std::to_string(remaining_ttl_s);
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

void WebIpc::handle_line(int fd, const std::string& line, std::vector<WebCommand>* out)
{
    double idv = 0;
    std::string op, point, source, user_raw;
    const bool has_id = jget_number(line, "id", &idv);

    /* dựng cmd TRƯỚC validate — reject sớm vẫn có id/user/point cho audit */
    WebCommand cmd;
    cmd.id = has_id ? static_cast<uint64_t>(idv) : 0;
    cmd.client_fd = fd;
    const bool has_user = jget_string(line, "user", &user_raw);
    cmd.user = sanitize_user(user_raw);
    if (jget_string(line, "point", &point))
        cmd.point_name = sanitize_point_name(point);
    const bool has_op = jget_string(line, "op", &op);
    cmd.is_write = has_op && op == "write";

    auto reject = [&](const char* err) { respond_rejected(cmd, err); };

    if (!has_id || !has_op) {
        reject("bad_request");
        return;
    }

    const auto cached = response_cache_.find(cmd.id);
    if (cached != response_cache_.end()) {
        if (cached->second.request != line) {
            respond(fd, "{\"id\":" + std::to_string(cmd.id) +
                        ",\"result\":\"rejected\",\"error\":\"id_conflict\"}");
        } else if (cached->second.response.empty()) {
            respond(fd, "{\"id\":" + std::to_string(cmd.id) +
                        ",\"result\":\"rejected\",\"error\":\"duplicate_pending\"}");
        } else {
            respond(fd, cached->second.response);
        }
        return;
    }
    if (op == "alarm_list" || op == "alarm_ack" ||
        op == "alarm_suppress" || op == "alarm_return") {
        if (!has_user) {
            reject("bad_request");
            return;
        }
        if (op == "alarm_list") cmd.kind = WebCommandKind::AlarmList;
        else if (op == "alarm_ack") cmd.kind = WebCommandKind::AlarmAck;
        else if (op == "alarm_suppress") cmd.kind = WebCommandKind::AlarmSuppress;
        else cmd.kind = WebCommandKind::AlarmReturn;
        if (cmd.kind == WebCommandKind::AlarmAck ||
            cmd.kind == WebCommandKind::AlarmSuppress ||
            cmd.kind == WebCommandKind::AlarmReturn) {
            std::string alarm_id;
            if (!jget_string(line, "alarmId", &alarm_id) || !valid_alarm_id(alarm_id)) {
                reject("bad_request");
                return;
            }
            cmd.alarm_id = alarm_id;
        }
        if (cmd.kind == WebCommandKind::AlarmAck ||
            cmd.kind == WebCommandKind::AlarmSuppress) {
            const bool has_duration = jhas_key(line, "durationS");
            const bool has_permanent = jhas_key(line, "permanent");
            if (has_duration && (!jget_number(line, "durationS", &cmd.duration_s) ||
                                 !std::isfinite(cmd.duration_s) || cmd.duration_s <= 0.0)) {
                reject("bad_duration");
                return;
            }
            if (has_permanent && !jget_bool(line, "permanent", &cmd.permanent)) {
                reject("bad_request");
                return;
            }
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
        return;
    }

    if (!has_id || !has_op || point.empty() || !jget_string(line, "source", &source)) {
        reject("bad_request");
        return;
    }
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
        double v;
        if (!jget_number(line, "value", &v) || !std::isfinite(v)) {
            reject("bad_value");
            return;
        }
        cmd.is_write = true;
        cmd.value = static_cast<float>(v);
    } else if (op == "release") {
        cmd.is_write = false;
    } else if (op == "query") {
        cmd.is_write = false;
        cmd.is_query = true;
    } else {
        reject("bad_request");
        return;
    }
    if (jhas_key(line, "ttlS")) {
        double ttl = 0.0;
        if (!cmd.is_write || source != "manual" || !jget_number(line, "ttlS", &ttl) ||
            !std::isfinite(ttl) || ttl < 1.0 || ttl > 86400.0 || std::floor(ttl) != ttl) {
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
}

std::vector<WebCommand> WebIpc::drain()
{
    std::vector<WebCommand> out;
    if (fd_ < 0) return out;

    /* accept client mới */
    for (;;) {
        const int cfd = ::accept4(fd_, nullptr, nullptr, SOCK_NONBLOCK | SOCK_CLOEXEC);
        if (cfd < 0) break;
        clients_.push_back({cfd, std::string()});
        std::fprintf(stderr, "INFO  web_ipc.client_connected fd=%d\n", cfd);
    }

    /* đọc JSON lines từ mọi client */
    for (size_t i = 0; i < clients_.size();) {
        Client& c = clients_[i];
        char buf[1024];
        bool closed = false;
        for (;;) {
            const ssize_t r = ::recv(c.fd, buf, sizeof(buf), MSG_DONTWAIT);
            if (r > 0) {
                c.buf.append(buf, static_cast<size_t>(r));
                if (c.buf.size() > 64 * 1024) { closed = true; break; }   /* client hỏng */
            } else if (r == 0) {
                closed = true;
                break;
            } else {
                if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                if (errno == EINTR) continue;
                closed = true;
                break;
            }
        }
        size_t pos;
        while ((pos = c.buf.find('\n')) != std::string::npos) {
            const std::string line = c.buf.substr(0, pos);
            c.buf.erase(0, pos + 1);
            if (!line.empty())
                handle_line(c.fd, line, &out);
        }
        if (closed) {
            ::close(c.fd);
            clients_.erase(clients_.begin() + static_cast<long>(i));
        } else {
            i++;
        }
    }
    return out;
}

} // namespace core
