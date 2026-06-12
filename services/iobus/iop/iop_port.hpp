/**
 * @file  iop_port.hpp
 * @brief Mở/cấu hình UART (hoặc PTY dev), read/write byte thô — KHÔNG biết frame.
 *        Contract 06 §3.1: raw 8N1, no flow control, O_RDWR|O_NOCTTY|O_NONBLOCK.
 */
#ifndef IOBUS_IOP_PORT_HPP
#define IOBUS_IOP_PORT_HPP

#include <cstddef>
#include <cstdint>
#include <string>

#include <sys/types.h>

namespace iobus {

class IopPort {
public:
    ~IopPort();

    bool open(const std::string& dev, int baud);
    void close();
    bool is_open() const { return fd_ >= 0; }
    int  fd() const { return fd_; }

    /* Trả số byte; 0 nếu chưa có dữ liệu (EAGAIN); -1 lỗi thật. EINTR tự retry. */
    ssize_t read(uint8_t* buf, size_t n);

    /* Ghi đủ n byte hoặc -1. EAGAIN → poll(POLLOUT) tối đa ~50ms rồi -1
     * (TX nghẽn kéo dài = link chết; caller coi như TIMEOUT → FAULT → reconnect). */
    ssize_t write(const uint8_t* buf, size_t n);

    void flush();   /* xả RX/TX buffer */

private:
    int fd_ = -1;
};

} // namespace iobus

#endif /* IOBUS_IOP_PORT_HPP */
