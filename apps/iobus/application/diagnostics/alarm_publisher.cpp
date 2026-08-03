#include "diagnostics/alarm_publisher.hpp"

#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace iobus {

AlarmPublisher::~AlarmPublisher()
{
    close();
}

bool AlarmPublisher::open(const std::string& sock_path)
{
    path_ = sock_path;
    /* SOCK_DGRAM connect-less: iobus là publisher, subscriber bind path.
     * Subscriber chưa tồn tại → sendto fail (ECONNREFUSED/ENOENT) → drop có đếm. */
    fd_ = ::socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    if (fd_ < 0) {
        std::fprintf(stderr, "WARN  alarm.open_fail errno=%d (alarm degraded)\n", errno);
        return false;
    }
    return true;
}

void AlarmPublisher::close()
{
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

void AlarmPublisher::publish(const Alarm& a)
{
    char ts[32];
    {
        struct timespec now;
        clock_gettime(CLOCK_REALTIME, &now);
        struct tm tm_utc;
        gmtime_r(&now.tv_sec, &tm_utc);
        strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
    }
    char line[1024];
    const int n = std::snprintf(line, sizeof(line),
        "{\"ts\":\"%s\",\"source\":\"mkddc-iobus\",\"code\":\"%s\",\"severity\":\"%s\","
        "\"message\":\"%s\",\"data\":%s}\n",
        ts, a.code.c_str(), a.severity.c_str(), a.message.c_str(),
        a.data_json.empty() ? "{}" : a.data_json.c_str());
    if (n <= 0) return;

    /* Luôn log ra journald để không mất alarm khi chưa có subscriber */
    std::fprintf(stderr, "ALARM %s", line);

    if (fd_ < 0) return;
    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, path_.c_str(), sizeof(addr.sun_path) - 1);
    const ssize_t s = ::sendto(fd_, line, static_cast<size_t>(n), MSG_DONTWAIT,
                               reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr));
    if (s < 0) {
        dropped_++;
        if ((dropped_ & (dropped_ - 1)) == 0)   /* log thưa dần: 1,2,4,8,... */
            std::fprintf(stderr, "WARN  alarm.drop count=%u errno=%d (no subscriber?)\n",
                         dropped_, errno);
    }
}

} // namespace iobus
