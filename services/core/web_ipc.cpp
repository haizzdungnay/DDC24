#include "web_ipc.hpp"

#include <cctype>
#include <cerrno>
#include <cstdio>
#include <cstring>

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
}

void WebIpc::respond(int fd, const std::string& json_line)
{
    const std::string line = json_line + "\n";
    (void)!::send(fd, line.c_str(), line.size(), MSG_NOSIGNAL | MSG_DONTWAIT);
}

void WebIpc::respond_accepted(const WebCommand& cmd, float applied_value)
{
    char buf[160];
    std::snprintf(buf, sizeof(buf),
                  "{\"id\":%llu,\"result\":\"accepted\",\"applied_value\":%g,"
                  "\"active_source\":\"manual\"}",
                  static_cast<unsigned long long>(cmd.id), static_cast<double>(applied_value));
    respond(cmd.client_fd, buf);
}

void WebIpc::respond_rejected(const WebCommand& cmd, const char* error)
{
    char buf[128];
    std::snprintf(buf, sizeof(buf), "{\"id\":%llu,\"result\":\"rejected\",\"error\":\"%s\"}",
                  static_cast<unsigned long long>(cmd.id), error);
    respond(cmd.client_fd, buf);
}

void WebIpc::handle_line(int fd, const std::string& line, std::vector<WebCommand>* out)
{
    double idv = 0;
    std::string op, point, source, user;
    const bool has_id = jget_number(line, "id", &idv);
    const uint64_t id = has_id ? static_cast<uint64_t>(idv) : 0;

    auto reject = [&](const char* err) {
        char buf[128];
        std::snprintf(buf, sizeof(buf), "{\"id\":%llu,\"result\":\"rejected\",\"error\":\"%s\"}",
                      static_cast<unsigned long long>(id), err);
        respond(fd, buf);
    };

    if (!has_id || !jget_string(line, "op", &op) || !jget_string(line, "point", &point) ||
        !jget_string(line, "source", &source)) {
        reject("bad_request");
        return;
    }
    if (source != "manual") {       /* Rev A: chỉ manual (mức 2) qua socket này */
        reject("bad_request");
        return;
    }
    WebCommand cmd;
    cmd.id = id;
    cmd.client_fd = fd;
    jget_string(line, "user", &cmd.user);
    if (!parse_point_name(point, &cmd.point)) {
        reject("unknown_point");
        return;
    }
    if (cmd.point.kind == PointKind::AI || cmd.point.kind == PointKind::BI) {
        reject("readonly_point");
        return;
    }
    if (op == "write") {
        double v;
        if (!jget_number(line, "value", &v)) {
            reject("bad_value");
            return;
        }
        cmd.is_write = true;
        cmd.value = static_cast<float>(v);
    } else if (op == "release") {
        cmd.is_write = false;
    } else {
        reject("bad_request");
        return;
    }
    if (out->size() >= 64) {        /* queue đầy → rejected busy (07 §8) */
        reject("busy");
        return;
    }
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
