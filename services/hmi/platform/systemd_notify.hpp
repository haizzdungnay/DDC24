#ifndef HMI_SYSTEMD_NOTIFY_HPP
#define HMI_SYSTEMD_NOTIFY_HPP

namespace hmi {

/* sd_notify READY=1 / WATCHDOG=1 — không cần libsystemd. No-op nếu không có NOTIFY_SOCKET. */
class SystemdNotify {
public:
    void ready();
    void watchdog_kick();

private:
    bool notify(const char* state);
};

} // namespace hmi

#endif
