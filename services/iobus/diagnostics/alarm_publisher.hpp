/**
 * @file  alarm_publisher.hpp
 * @brief Publish alarm JSON lines lên /run/mkddc/alarm.sock (06 §3.11, §9).
 *        Non-blocking: chưa có subscriber → drop có log, KHÔNG block poll.
 */
#ifndef IOBUS_ALARM_PUBLISHER_HPP
#define IOBUS_ALARM_PUBLISHER_HPP

#include <cstdint>
#include <string>

namespace iobus {

struct Alarm {
    std::string code;        /* IOP_TIMEOUT, IOP_INIT_FAIL, MCU_FAULT_FLAGS... (06 §9) */
    std::string severity;    /* "warning" | "critical" */
    std::string message;
    std::string data_json;   /* JSON object bổ sung, vd {"uart":"/dev/ttyS2"} */
};

class AlarmPublisher {
public:
    ~AlarmPublisher();

    /* Tạo Unix dgram socket server tại path. Fail → degraded (WARN), vẫn chạy. */
    bool open(const std::string& sock_path = "/run/mkddc/alarm.sock");
    void close();

    void publish(const Alarm& a);

private:
    int         fd_ = -1;
    std::string path_;
    uint32_t    dropped_ = 0;
};

} // namespace iobus

#endif /* IOBUS_ALARM_PUBLISHER_HPP */
