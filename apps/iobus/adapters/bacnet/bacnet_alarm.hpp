/**
 * @file  bacnet_alarm.hpp
 * @brief BAC-009: alarm.sock consumer → BACnet Notification Class event dispatch.
 *        Reads KX alarm events from alarm.sock (SOCK_DGRAM); maps to
 *        ConfirmedEventNotification via bacnet-stack.
 *        Compilation of the network dispatch requires MKDDC_ENABLE_BACNET.
 */
#ifndef IOBUS_BACNET_ALARM_HPP
#define IOBUS_BACNET_ALARM_HPP

#include <cstdint>
#include <string>
#include <vector>

namespace iobus::bacnet {

/** Alarm event from alarm.sock (matches KX wire format, SW_BACNET_DESIGN §9). */
struct AlarmEvent {
    uint32_t    alarm_code    = 0;   /* E-code: E302=slave_offline, E303=error_rate, etc. */
    uint32_t    source_ext    = 0;   /* ext cache index (for fieldbus alarms) */
    uint32_t    object_inst   = 0;   /* BACnet object instance to notify via */
    float       value         = 0.0f;
    uint8_t     to_offnormal  = 0;   /* 1 = to_offnormal, 0 = to_normal */
    char        description[64] = {};
};

struct NotificationTarget {
    uint32_t    device_id       = 0;
    uint8_t     net_addr[6]     = {};   /* MAC for local segment */
    uint16_t    port            = 47808;
    uint32_t    process_id      = 1;
    bool        confirmed       = true;
};

/**
 * BAC-009: alarm socket consumer.
 * Runs in bacnet_server thread: reads alarm.sock, translates to
 * BACnet ConfirmedEventNotification via Notification Class objects.
 * The socket is read with MSG_DONTWAIT — caller must call drain() each tick.
 */
class BacnetAlarm {
public:
    explicit BacnetAlarm(const std::string& alarm_sock_path = "/run/mkddc/alarm.sock");
    ~BacnetAlarm();

    /** Open the alarm socket (SOCK_DGRAM, SOCK_NONBLOCK). Returns false on error. */
    bool open();
    void close();
    bool is_open() const { return sockfd_ >= 0; }

    /**
     * Drain all pending alarm datagrams.
     * For each event: map to BACnet Notification Class event, dispatch.
     * guarded by MKDDC_ENABLE_BACNET for actual network send.
     * Events are stored in pending_ for test inspection.
     */
    void drain(uint64_t now_ms);

    /** Pending alarm events (after last drain, for testing). */
    const std::vector<AlarmEvent>& pending() const { return pending_; }
    void clear_pending() { pending_.clear(); }

    /** Add a notification target for all events (Notification Class recipient list). */
    void add_target(const NotificationTarget& tgt);

    const std::vector<NotificationTarget>& targets() const { return targets_; }

private:
    std::string alarm_sock_path_;
    int         sockfd_ = -1;
    std::vector<AlarmEvent>          pending_;
    std::vector<NotificationTarget>  targets_;

    void dispatch_event(const AlarmEvent& ev, uint64_t now_ms);
};

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_ALARM_HPP */
