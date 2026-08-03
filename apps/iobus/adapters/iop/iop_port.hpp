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

    /* Mã trả về đặc biệt của read(): peer đã đóng (EOF / hangup).
     * PHẢI khác 0 (=chưa có dữ liệu, có thể có sau). Trước bản sửa 2026-07-30
     * cả hai đều trả 0 nên caller không phân biệt được "chưa có dữ liệu" với
     * "sẽ không bao giờ có dữ liệu nữa" (finding F-05). */
    static constexpr ssize_t READ_EOF = -2;

    /* Trả số byte (>0); 0 nếu chưa có dữ liệu; READ_EOF nếu peer đã đóng;
     * -1 lỗi thật. EINTR tự retry.
     * Lưu ý: tty raw với VMIN=0/VTIME=0 trả 0 cho cả "rỗng" và "EOF", nên hàm
     * này dùng poll(timeout=0) để phân biệt — xem chi tiết trong .cpp. */
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
