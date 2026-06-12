#include "iop/iop_port.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>

#include <fcntl.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>

namespace iobus {

static speed_t baud_to_speed(int baud)
{
    switch (baud) {
    case 9600:    return B9600;
    case 19200:   return B19200;
    case 38400:   return B38400;
    case 57600:   return B57600;
    case 115200:  return B115200;
    case 230400:  return B230400;
    case 460800:  return B460800;
    case 921600:  return B921600;
    default:      return B0;
    }
}

IopPort::~IopPort()
{
    close();
}

bool IopPort::open(const std::string& dev, int baud)
{
    close();
    fd_ = ::open(dev.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd_ < 0) {
        std::fprintf(stderr, "ERROR iop.open_fail dev=%s errno=%d (%s)\n",
                     dev.c_str(), errno, std::strerror(errno));
        return false;
    }

    struct termios tio {};
    if (tcgetattr(fd_, &tio) != 0) {
        std::fprintf(stderr, "ERROR iop.open_fail dev=%s tcgetattr errno=%d\n", dev.c_str(), errno);
        close();
        return false;
    }
    cfmakeraw(&tio);
    tio.c_cflag &= ~static_cast<tcflag_t>(CRTSCTS);   /* no HW flow control */
    tio.c_iflag &= ~static_cast<tcflag_t>(IXON | IXOFF | IXANY);
    tio.c_cflag |= CLOCAL | CREAD;
    tio.c_cc[VMIN]  = 0;
    tio.c_cc[VTIME] = 0;

    const speed_t sp = baud_to_speed(baud);
    if (sp != B0) {
        cfsetispeed(&tio, sp);
        cfsetospeed(&tio, sp);
    } else {
        std::fprintf(stderr, "WARN  iop.open baud=%d not standard, keep device default\n", baud);
    }

    if (tcsetattr(fd_, TCSANOW, &tio) != 0) {
        std::fprintf(stderr, "ERROR iop.open_fail dev=%s tcsetattr errno=%d\n", dev.c_str(), errno);
        close();
        return false;
    }
    flush();
    std::fprintf(stderr, "INFO  iop.open dev=%s baud=%d\n", dev.c_str(), baud);
    return true;
}

void IopPort::close()
{
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

ssize_t IopPort::read(uint8_t* buf, size_t n)
{
    if (fd_ < 0) return -1;
    for (;;) {
        const ssize_t r = ::read(fd_, buf, n);
        if (r >= 0) return r;
        if (errno == EINTR) continue;
        if (errno == EAGAIN || errno == EWOULDBLOCK) return 0;
        return -1;
    }
}

ssize_t IopPort::write(const uint8_t* buf, size_t n)
{
    if (fd_ < 0) return -1;
    size_t off = 0;
    int eagain_waits = 0;
    while (off < n) {
        const ssize_t w = ::write(fd_, buf + off, n - off);
        if (w > 0) { off += static_cast<size_t>(w); continue; }
        if (w < 0 && errno == EINTR) continue;
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            /* TX buffer đầy: chờ writable thay vì busy-spin; quá ~50ms (peer
             * PTY chết / flow nghẽn) → lỗi, caller xử lý như timeout */
            if (++eagain_waits > 5) return -1;
            struct pollfd pfd { fd_, POLLOUT, 0 };
            if (::poll(&pfd, 1, 10) < 0 && errno != EINTR) return -1;
            continue;
        }
        return -1;
    }
    return static_cast<ssize_t>(off);
}

void IopPort::flush()
{
    if (fd_ >= 0)
        tcflush(fd_, TCIOFLUSH);
}

} // namespace iobus
