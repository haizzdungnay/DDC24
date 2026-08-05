/**
 * @file  ext_cache.cpp
 * @brief MOD-006/009: ext cache + push snapshot to fieldbus.sock.
 */
#include "ext_cache.hpp"

#include <cerrno>
#include <cstddef>
#include <cstdio>
#include <cstring>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace iobus::fieldbus {

ExtCache::ExtCache()
{
    std::memset(points_, 0, sizeof(points_));
    /* init quality=BAD cho tất cả */
    for (int i = 0; i < KX_N_EXT; i++)
        points_[i].quality = KX_Q_BAD;
}

void ExtCache::set_point(uint16_t idx, const char* name, float value,
                          kx_quality_t quality, uint8_t slave_addr,
                          bool online, bool writable)
{
    if (idx >= KX_N_EXT) return;
    kx_ext_point_t& p = points_[idx];
    std::strncpy(p.name, name, sizeof(p.name) - 1);
    p.name[sizeof(p.name) - 1] = '\0';
    p.value      = value;
    p.quality    = static_cast<uint8_t>(quality);
    p.slave_addr = slave_addr;
    p.online     = online ? 1u : 0u;
    p.writable   = writable ? 1u : 0u;
    /* setpoint/dirty: core sở hữu, fieldbus không ghi */
    if (idx >= count_) count_ = static_cast<uint16_t>(idx + 1);
}

void ExtCache::mark_slave_offline(uint16_t start_idx, uint16_t count,
                                   uint8_t /*slave_addr*/)
{
    for (uint16_t i = start_idx; i < start_idx + count && i < KX_N_EXT; i++) {
        points_[i].online  = 0;
        points_[i].quality = KX_Q_BAD;
    }
}

void ExtCache::mark_slave_stale(uint16_t start_idx, uint16_t count,
                                uint8_t /*slave_addr*/)
{
    for (uint16_t i = start_idx; i < start_idx + count && i < KX_N_EXT; i++) {
        points_[i].online  = 1;
        points_[i].quality = KX_Q_UNCERTAIN;
    }
}

bool ExtCache::push_snapshot(const std::string& sock_path)
{
    /* Lazy-create sendto socket một lần */
    if (sock_fd_ < 0) {
        sock_fd_ = ::socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
        if (sock_fd_ < 0) {
            std::fprintf(stderr, "WARN  ext_cache.socket_fail errno=%d\n", errno);
            return false;
        }
    }

    /* Header phải nằm ngay trước mảng points thì phép tính `total` ở dưới mới
     * đúng; khoá lại bằng static_assert để đổi layout là fail lúc biên dịch. */
    static_assert(offsetof(kx_ext_snapshot_msg_t, points) ==
                      sizeof(uint32_t) + sizeof(uint16_t) + sizeof(uint16_t),
                  "layout header kx_ext_snapshot_msg_t đã đổi — cập nhật consumer đồng bộ");

    kx_ext_snapshot_msg_t msg;
    msg.magic = KX_EXT_SNAP_MAGIC;
    msg.count = count_;
    msg._pad  = 0;
    std::memcpy(msg.points, points_,
                count_ * sizeof(kx_ext_point_t));

    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, sock_path.c_str(), sizeof(addr.sun_path) - 1);

    /* D-11: lấy offset của `points` từ chính struct thay vì cộng tay kích thước
     * ba field header. Cách cũ đúng chỉ vì header 8 byte không sinh padding
     * trước mảng; thêm một field vào header là receiver đọc lệch mà không test
     * nào bắt được. Đây đúng loại giả định layout viết tay đã gây ra finding F-17. */
    const ssize_t total = static_cast<ssize_t>(
        offsetof(kx_ext_snapshot_msg_t, points) + count_ * sizeof(kx_ext_point_t));
    const ssize_t n = ::sendto(sock_fd_, &msg, static_cast<size_t>(total),
                               MSG_DONTWAIT,
                               reinterpret_cast<struct sockaddr*>(&addr),
                               sizeof(addr));
    if (n < 0) {
        if (errno != EAGAIN && errno != EWOULDBLOCK && errno != ECONNREFUSED)
            std::fprintf(stderr, "WARN  ext_cache.sendto_fail path=%s errno=%d\n",
                         sock_path.c_str(), errno);
        return false;
    }
    return true;
}

} // namespace iobus::fieldbus
