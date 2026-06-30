#include "platform/systemd_notify.hpp"

#include <cstdlib>
#include <cstring>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace hmi {

bool SystemdNotify::notify(const char* state)
{
    const char* sock = std::getenv("NOTIFY_SOCKET");
    if (!sock || !sock[0]) return false;

    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, sock, sizeof(addr.sun_path) - 1);
    if (addr.sun_path[0] == '@') addr.sun_path[0] = '\0';  /* abstract namespace */

    const int fd = ::socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return false;
    const ssize_t r = ::sendto(fd, state, std::strlen(state), MSG_NOSIGNAL,
                               reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr));
    ::close(fd);
    return r >= 0;
}

void SystemdNotify::ready()       { notify("READY=1"); }
void SystemdNotify::watchdog_kick() { notify("WATCHDOG=1"); }

} // namespace hmi
