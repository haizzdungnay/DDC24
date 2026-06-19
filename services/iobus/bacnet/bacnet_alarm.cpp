/**
 * @file  bacnet_alarm.cpp
 * @brief BAC-009 implementation.
 */
#include "bacnet_alarm.hpp"

#include <cstdio>
#include <cstring>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <fcntl.h>

#ifdef MKDDC_ENABLE_BACNET
/* bacnet-stack headers for event notification */
#include <bacnet/bacdef.h>
#include <bacnet/bacenum.h>
#include <bacnet/event.h>
#endif

namespace iobus::bacnet {

BacnetAlarm::BacnetAlarm(const std::string& path)
    : alarm_sock_path_(path)
{}

BacnetAlarm::~BacnetAlarm() { close(); }

bool BacnetAlarm::open()
{
    if (sockfd_ >= 0) return true;
    sockfd_ = ::socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (sockfd_ < 0) {
        std::fprintf(stderr, "ERROR bacnet_alarm.socket_open_failed errno=%d\n", errno);
        return false;
    }

    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", alarm_sock_path_.c_str());

    /* Client-side: no bind needed for receiving alarms published from core alarm sock.
     * Actually alarm.sock is written by the core alarm publisher; this is a subscriber.
     * We bind to a unique abstract/temp path so the alarm publisher can sendto us.
     * For simplicity: subscribe via SOCK_DGRAM — core broadcasts to all bound receivers.
     * Bind to the alarm sock path (server-side receive). */
    ::unlink(alarm_sock_path_.c_str());
    if (::bind(sockfd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::fprintf(stderr, "WARN  bacnet_alarm.bind_failed path=%s errno=%d (alarm disabled)\n",
                     alarm_sock_path_.c_str(), errno);
        ::close(sockfd_);
        sockfd_ = -1;
        return false;
    }
    std::fprintf(stderr, "INFO  bacnet_alarm.open path=%s\n", alarm_sock_path_.c_str());
    return true;
}

void BacnetAlarm::close()
{
    if (sockfd_ >= 0) {
        ::close(sockfd_);
        sockfd_ = -1;
    }
}

void BacnetAlarm::add_target(const NotificationTarget& tgt)
{
    targets_.push_back(tgt);
}

void BacnetAlarm::drain(uint64_t now_ms)
{
    if (sockfd_ < 0) return;
    pending_.clear();

    AlarmEvent ev{};
    ssize_t n;
    while ((n = ::recv(sockfd_, &ev, sizeof(ev), MSG_DONTWAIT)) > 0) {
        if (static_cast<size_t>(n) >= sizeof(AlarmEvent)) {
            pending_.push_back(ev);
            dispatch_event(ev, now_ms);
        }
        ev = {};
    }
}

void BacnetAlarm::dispatch_event(const AlarmEvent& ev, uint64_t now_ms)
{
    (void)now_ms;
#ifdef MKDDC_ENABLE_BACNET
    /* Map alarm to BACnet event notification.
     * ConfirmedEventNotification to each target in Notification Class recipient list.
     * SW_BACNET_DESIGN §9: E302/E303 use NC object instance = ev.object_inst. */
    for (const auto& tgt : targets_) {
        (void)tgt;
        /* bacnet-stack: Send_CEvent_Notify / ucix_send_event —
         * actual implementation depends on device addressing setup in bacnet_server.
         * Placeholder: log the dispatch. */
        std::fprintf(stderr, "INFO  bacnet_alarm.dispatch code=%u inst=%u offnormal=%u desc=%s\n",
                     ev.alarm_code, ev.object_inst, ev.to_offnormal, ev.description);
    }
#else
    /* Without bacnet-stack: just log */
    std::fprintf(stderr, "INFO  bacnet_alarm.event code=%u inst=%u offnormal=%u\n",
                 ev.alarm_code, ev.object_inst, ev.to_offnormal);
#endif
}

} // namespace iobus::bacnet
