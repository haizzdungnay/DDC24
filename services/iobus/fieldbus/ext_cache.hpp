/**
 * @file  ext_cache.hpp
 * @brief MOD-006/009: internal ext point cache + push snapshot datagram to fieldbus.sock.
 *        Fieldbus KHÔNG ghi plc_shm trực tiếp — chỉ gửi kx_ext_snapshot_msg_t tới core.
 */
#ifndef IOBUS_EXT_CACHE_HPP
#define IOBUS_EXT_CACHE_HPP

#include <cstdint>
#include <string>

#include "mkddc_shm.h"

namespace iobus::fieldbus {

class ExtCache {
public:
    ExtCache();

    /* Ghi giá trị điểm ext sau khi decode từ Modbus register.
     * idx: index trong cache (0..KX_N_EXT-1).
     * Nếu idx ngoài range → bỏ qua. */
    void set_point(uint16_t idx, const char* name, float value,
                   kx_quality_t quality, uint8_t slave_addr,
                   bool online, bool writable);

    /* Đánh toàn bộ điểm của slave addr thành offline/BAD khi slave offline.
     * start_idx..start_idx+count-1: range điểm thuộc slave đó trong cache. */
    void mark_slave_offline(uint16_t start_idx, uint16_t count, uint8_t slave_addr);

    /* Giữ last-known-value trong cửa sổ retry nhưng đánh STALE/UNCERTAIN. */
    void mark_slave_stale(uint16_t start_idx, uint16_t count, uint8_t slave_addr);

    /* Gửi snapshot datagram tới /run/mkddc/fieldbus.sock (SOCK_DGRAM, sendto).
     * sock_path: đường dẫn socket (không cần connect, sendto once-per-push).
     * Trả false nếu send fail (log + continue — drop acceptable). */
    bool push_snapshot(const std::string& sock_path);

    /* Số điểm đang dùng trong cache. */
    uint16_t count() const { return count_; }

    /* Read-only access (cho test + write path). */
    const kx_ext_point_t& point(uint16_t idx) const { return points_[idx]; }
    kx_ext_point_t& point_rw(uint16_t idx) { return points_[idx]; }

private:
    kx_ext_point_t points_[KX_N_EXT] = {};
    uint16_t       count_ = 0;
    int            sock_fd_ = -1;   /* persistent sendto socket */
};

} // namespace iobus::fieldbus

#endif /* IOBUS_EXT_CACHE_HPP */
