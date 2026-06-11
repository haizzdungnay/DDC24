/**
 * @file  systemd_notify.hpp
 * @brief sd_notify READY=1 / WATCHDOG=1 không cần libsystemd (ghi thẳng $NOTIFY_SOCKET).
 *        Không có NOTIFY_SOCKET (chạy tay) → no-op.
 */
#ifndef IOBUS_SYSTEMD_NOTIFY_HPP
#define IOBUS_SYSTEMD_NOTIFY_HPP

namespace iobus {

class SystemdNotify {
public:
    void ready();
    void watchdog_kick();

private:
    bool notify(const char* state);
};

} // namespace iobus

#endif /* IOBUS_SYSTEMD_NOTIFY_HPP */
