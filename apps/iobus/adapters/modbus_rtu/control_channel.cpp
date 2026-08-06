/**
 * @file  control_channel.cpp
 * @brief MBR-B105/B106/B108: hiện thực kênh điều khiển UDS.
 */
#include "control_channel.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

namespace iobus::fieldbus {

/* ---------------- JSON tối giản (phẳng, không lồng) ---------------- */

static size_t find_key(const std::string& s, const char* key)
{
    const std::string pat = std::string("\"") + key + "\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return std::string::npos;
    p = s.find(':', p + pat.size());
    if (p == std::string::npos) return std::string::npos;
    ++p;
    while (p < s.size() && (s[p] == ' ' || s[p] == '\t')) ++p;
    return p;
}

bool json_get_string(const std::string& s, const char* key, std::string* out)
{
    size_t p = find_key(s, key);
    if (p == std::string::npos || p >= s.size() || s[p] != '"') return false;
    std::string value;
    for (size_t i = p + 1; i < s.size(); ++i) {
        if (s[i] == '\\' && i + 1 < s.size()) {
            const char esc = s[++i];
            switch (esc) {
                case 'n': value += '\n'; break;
                case 't': value += '\t'; break;
                case 'r': value += '\r'; break;
                default:  value += esc;  break;
            }
            continue;
        }
        if (s[i] == '"') { *out = value; return true; }
        value += s[i];
    }
    return false;
}

bool json_get_number(const std::string& s, const char* key, double* out)
{
    size_t p = find_key(s, key);
    if (p == std::string::npos) return false;
    char* end = nullptr;
    const double v = std::strtod(s.c_str() + p, &end);
    if (end == s.c_str() + p) return false;
    *out = v;
    return true;
}

bool json_get_bool(const std::string& s, const char* key, bool* out)
{
    size_t p = find_key(s, key);
    if (p == std::string::npos) return false;
    if (s.compare(p, 4, "true") == 0)  { *out = true;  return true; }
    if (s.compare(p, 5, "false") == 0) { *out = false; return true; }
    return false;
}

std::string json_escape(const std::string& in)
{
    std::string out;
    out.reserve(in.size() + 8);
    for (const char ch : in) {
        switch (ch) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", ch);
                    out += buf;
                } else {
                    out += ch;
                }
        }
    }
    return out;
}

static std::string error_reply(const char* code, const std::string& message)
{
    return std::string("{\"result\":\"error\",\"code\":\"") + code +
           "\",\"reason\":\"" + json_escape(message) + "\"}";
}

/* ---------------- xử lý request ---------------- */

std::string ControlChannel::handle_line(const std::string& line) const
{
    std::string op;
    if (!json_get_string(line, "op", &op))
        return error_reply("bad_request", "thiếu trường op");

    if (op == "status") {
        const std::string fields = handlers_.status_fields ? handlers_.status_fields() : "";
        return std::string("{\"result\":\"ok\"") + (fields.empty() ? "" : "," + fields) + "}";
    }

    if (op == "apply_config") {
        if (!handlers_.apply_config)
            return error_reply("unsupported", "iobus không hỗ trợ apply_config");
        double revision = 0;
        json_get_number(line, "revision", &revision);
        std::string checksum;
        json_get_string(line, "checksum", &checksum);
        std::string path;
        json_get_string(line, "path", &path);

        std::string reason;
        uint64_t applied = 0;
        uint64_t generation = 0;
        const bool ok = handlers_.apply_config(static_cast<uint64_t>(revision), checksum, path,
                                               &reason, &applied, &generation);
        if (!ok) {
            /* FW_SOM_DESIGN §9: REJECT phải nói rõ lý do và iobus GIỮ generation
             * cũ đang chạy. Không tự restart để áp cấu hình. */
            return std::string("{\"result\":\"reject\",\"reason\":\"") + json_escape(reason) + "\"}";
        }
        char buf[256];
        std::snprintf(buf, sizeof(buf),
                      "{\"result\":\"ack\",\"applied_revision\":%llu,\"generation\":%llu}",
                      static_cast<unsigned long long>(applied),
                      static_cast<unsigned long long>(generation));
        return buf;
    }

    if (op == "write") {
        if (!handlers_.submit_write)
            return error_reply("unsupported", "iobus không hỗ trợ write");
        ControlWriteRequest req;
        json_get_string(line, "request_id", &req.request_id);
        double n = 0;
        if (json_get_number(line, "slave_addr", &n)) req.slave_addr = static_cast<uint8_t>(n);
        if (json_get_number(line, "bus_id", &n))     req.bus_id     = static_cast<uint8_t>(n);
        if (json_get_number(line, "fc", &n))         req.fc         = static_cast<uint8_t>(n);
        if (json_get_number(line, "address", &n))    req.reg_addr   = static_cast<uint16_t>(n);
        if (json_get_number(line, "value", &n))      req.value      = n;
        if (json_get_number(line, "deadline_ms", &n)) req.deadline_ms = static_cast<uint32_t>(n);
        json_get_bool(line, "readback", &req.readback);
        if (req.request_id.empty())
            return error_reply("bad_request", "write bắt buộc có request_id");

        std::string reason;
        if (!handlers_.submit_write(req, &reason))
            return std::string("{\"result\":\"rejected\",\"request_id\":\"") +
                   json_escape(req.request_id) + "\",\"reason\":\"" + json_escape(reason) + "\"}";
        /* "accepted" chứ KHÔNG phải "applied": lệnh mới vào hàng đợi, chưa ai
         * biết slave có nhận hay không. Nói applied ở đây là nói dối
         * (FW_SOM_DESIGN §8.2). */
        return std::string("{\"result\":\"accepted\",\"request_id\":\"") +
               json_escape(req.request_id) + "\"}";
    }

    if (op == "test_connection" || op == "read_test") {
        if (!handlers_.probe_read)
            return error_reply("unsupported", "iobus không hỗ trợ commissioning read");
        double n = 0;
        uint8_t  bus_id = 0, slave = 0, fc = 3;
        uint16_t addr = 0, count = 1;
        uint32_t timeout_ms = 500;
        if (json_get_number(line, "bus_id", &n))     bus_id = static_cast<uint8_t>(n);
        if (json_get_number(line, "slave_addr", &n)) slave  = static_cast<uint8_t>(n);
        if (json_get_number(line, "fc", &n))         fc     = static_cast<uint8_t>(n);
        if (json_get_number(line, "address", &n))    addr   = static_cast<uint16_t>(n);
        if (json_get_number(line, "count", &n))      count  = static_cast<uint16_t>(n);
        if (json_get_number(line, "timeout_ms", &n)) timeout_ms = static_cast<uint32_t>(n);
        if (slave < 1 || slave > 247)
            return error_reply("bad_request", "slave_addr phải trong 1..247");
        if (count == 0 || count > 125)
            return error_reply("bad_request", "count phải trong 1..125");

        const ControlProbeResult probe =
            handlers_.probe_read(bus_id, slave, fc, addr, count, timeout_ms);
        char buf[512];
        if (!probe.ok) {
            std::snprintf(buf, sizeof(buf),
                          "{\"result\":\"fail\",\"reason\":\"%s\",\"exception_code\":%u,"
                          "\"elapsed_us\":%u}",
                          json_escape(probe.reason).c_str(), probe.exception_code,
                          probe.elapsed_us);
            return buf;
        }
        std::snprintf(buf, sizeof(buf),
                      "{\"result\":\"ok\",\"value\":%.10g,\"elapsed_us\":%u}",
                      probe.value, probe.elapsed_us);
        return buf;
    }

    return error_reply("unknown_op", "op không được hỗ trợ: " + op);
}

/* ---------------- vòng đời socket ---------------- */

ControlChannel::~ControlChannel()
{
    stop();
}

bool ControlChannel::start(const std::string& sock_path, ControlHandlers handlers)
{
    handlers_  = std::move(handlers);
    sock_path_ = sock_path;

    const int fd = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) {
        std::fprintf(stderr, "ERROR control_channel.socket_fail errno=%d\n", errno);
        return false;
    }
    ::unlink(sock_path.c_str());

    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, sock_path.c_str(), sizeof(addr.sun_path) - 1);
    if (::bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
        std::fprintf(stderr, "ERROR control_channel.bind_fail path=%s errno=%d\n",
                     sock_path.c_str(), errno);
        ::close(fd);
        return false;
    }
    /* 0660: quyền file là lớp phòng thủ đầu; SO_PEERCRED là lớp thứ hai và là
     * lớp quyết định. */
    ::chmod(sock_path.c_str(), 0660);
    if (::listen(fd, 4) != 0) {
        std::fprintf(stderr, "ERROR control_channel.listen_fail errno=%d\n", errno);
        ::close(fd);
        return false;
    }
    listen_fd_ = fd;
    stop_.store(false);
    thread_ = std::thread([this]() { serve(); });
    std::fprintf(stderr, "INFO  control_channel.listening path=%s\n", sock_path.c_str());
    return true;
}

void ControlChannel::stop()
{
    if (listen_fd_ < 0) return;
    stop_.store(true);
    ::shutdown(listen_fd_, SHUT_RDWR);
    ::close(listen_fd_);
    listen_fd_ = -1;
    if (thread_.joinable()) thread_.join();
    if (!sock_path_.empty()) ::unlink(sock_path_.c_str());
}

void ControlChannel::serve()
{
    while (!stop_.load()) {
        struct pollfd pfd {listen_fd_, POLLIN, 0};
        const int rc = ::poll(&pfd, 1, 200);
        if (rc <= 0) continue;
        if (stop_.load()) break;

        const int conn = ::accept(listen_fd_, nullptr, nullptr);
        if (conn < 0) continue;

        /* Peer credential — lớp bảo vệ quyết định. Một tiến trình cùng máy
         * chạy dưới uid khác KHÔNG được đổi cấu hình fieldbus hay ghi register
         * xuống thiết bị hiện trường. */
        struct ucred cred {};
        socklen_t cred_len = sizeof(cred);
        if (::getsockopt(conn, SOL_SOCKET, SO_PEERCRED, &cred, &cred_len) != 0) {
            std::fprintf(stderr, "WARN  control_channel.peercred_unavailable — từ chối kết nối\n");
            ::close(conn);
            continue;
        }
        const uid_t self = ::geteuid();
        if (cred.uid != 0 && cred.uid != self) {
            std::fprintf(stderr, "WARN  control_channel.peer_denied uid=%u pid=%d"
                         " — chỉ root hoặc uid=%u được điều khiển fieldbus\n",
                         cred.uid, cred.pid, self);
            ::close(conn);
            continue;
        }

        std::string buffer;
        char chunk[1024];
        while (!stop_.load()) {
            struct pollfd cfd {conn, POLLIN, 0};
            if (::poll(&cfd, 1, 2000) <= 0) break;
            const ssize_t n = ::recv(conn, chunk, sizeof(chunk), 0);
            if (n <= 0) break;
            buffer.append(chunk, static_cast<size_t>(n));
            if (buffer.size() > kMaxFrameBytes) {
                /* Frame quá cỡ: đóng ngay. Cắt bớt rồi xử lý tiếp là mời một
                 * client lỗi giữ RAM của iobus vô thời hạn. */
                const std::string reply =
                    error_reply("frame_too_large", "frame vượt 64 KiB") + "\n";
                ::send(conn, reply.c_str(), reply.size(), MSG_NOSIGNAL);
                break;
            }
            size_t nl;
            while ((nl = buffer.find('\n')) != std::string::npos) {
                const std::string line = buffer.substr(0, nl);
                buffer.erase(0, nl + 1);
                if (line.empty()) continue;
                const std::string reply = handle_line(line) + "\n";
                if (::send(conn, reply.c_str(), reply.size(), MSG_NOSIGNAL) < 0) break;
            }
        }
        ::close(conn);
    }
}

} // namespace iobus::fieldbus
