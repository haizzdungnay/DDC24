/**
 * @file  ext_cache.cpp
 * @brief MOD-006/009 + MBR-B104: ext sample cache + push snapshot v2.
 */
#include "ext_cache.hpp"
#include "fieldbus_time.hpp"

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
    std::memset(samples_, 0, sizeof(samples_));
    /* D-10: điểm CHƯA TỪNG có mẫu là (BAD, NOT_INITIALIZED, offline), không
     * phải "0 với nhãn dữ liệu tốt". Với một điểm nhiệt độ, 0 là giá trị hợp
     * lý về mặt vật lý nên người dùng không có cách nào nhận ra đó là số bịa. */
    for (int i = 0; i < KX_N_EXT; i++) {
        samples_[i].quality        = KX_EXTQ_BAD;
        samples_[i].quality_reason = KX_EXTR_NOT_INITIALIZED;
    }
}

void ExtCache::declare_point(uint16_t idx, const char* point_id, uint8_t slave_addr,
                             uint8_t bus_id, bool writable)
{
    if (idx >= KX_N_EXT) return;
    std::lock_guard<std::mutex> lock(mu_);
    kx_ext_sample_v2_t& s = samples_[idx];
    std::strncpy(s.point_id, point_id, sizeof(s.point_id) - 1);
    s.point_id[sizeof(s.point_id) - 1] = '\0';
    s.slave_addr = slave_addr;
    s.bus_id     = bus_id;
    s.writable   = writable ? 1u : 0u;
    s.online     = 0u;
    if (s.sample_mono_ns == 0) {
        s.quality        = KX_EXTQ_BAD;
        s.quality_reason = KX_EXTR_NOT_INITIALIZED;
    }
    if (idx >= count_) count_ = static_cast<uint16_t>(idx + 1);
}

void ExtCache::set_sample(uint16_t idx, const char* point_id, double value,
                          kx_ext_quality_t quality, kx_ext_quality_reason_t reason,
                          uint8_t slave_addr, uint8_t bus_id, bool online, bool writable,
                          int64_t sample_utc_ms, int64_t sample_mono_ns)
{
    if (idx >= KX_N_EXT) return;
    std::lock_guard<std::mutex> lock(mu_);
    kx_ext_sample_v2_t& s = samples_[idx];
    std::strncpy(s.point_id, point_id, sizeof(s.point_id) - 1);
    s.point_id[sizeof(s.point_id) - 1] = '\0';
    s.quality        = static_cast<uint8_t>(quality);
    s.quality_reason = static_cast<uint8_t>(reason);
    s.slave_addr     = slave_addr;
    s.bus_id         = bus_id;
    s.online         = online ? 1u : 0u;
    s.writable       = writable ? 1u : 0u;

    /* Mẫu hỏng KHÔNG được ghi đè giá trị và mốc thời gian tốt trước đó
     * (DATA_MODEL §6.2: BAD ⇒ "không publish value mới"). Nếu ghi đè, một lần
     * decode lỗi sẽ xoá mất giá trị cuối cùng đọc được và người vận hành mất
     * luôn manh mối "trước khi hỏng nó đang là bao nhiêu". */
    if (quality == KX_EXTQ_GOOD) {
        s.value          = value;
        s.sample_utc_ms  = sample_utc_ms;
        s.sample_mono_ns = sample_mono_ns;
        s.exception_code = 0;
    }
    if (idx >= count_) count_ = static_cast<uint16_t>(idx + 1);
}

void ExtCache::mark_range_quality(uint16_t start_idx, uint16_t count,
                                  kx_ext_quality_t quality, kx_ext_quality_reason_t reason,
                                  bool online)
{
    std::lock_guard<std::mutex> lock(mu_);
    for (uint16_t i = start_idx; i < start_idx + count && i < KX_N_EXT; i++) {
        kx_ext_sample_v2_t& s = samples_[i];
        /* Điểm chưa từng có mẫu vẫn phải giữ NOT_INITIALIZED: nói "TIMEOUT" cho
         * một điểm chưa hề được hỏi lần nào là mô tả sai nguyên nhân. */
        if (s.sample_mono_ns == 0) {
            s.quality        = KX_EXTQ_BAD;
            s.quality_reason = KX_EXTR_NOT_INITIALIZED;
        } else {
            s.quality        = static_cast<uint8_t>(quality);
            s.quality_reason = static_cast<uint8_t>(reason);
        }
        s.online = online ? 1u : 0u;
    }
}

void ExtCache::mark_slave_offline(uint16_t start_idx, uint16_t count, uint8_t /*slave_addr*/)
{
    mark_range_quality(start_idx, count, KX_EXTQ_OFFLINE, KX_EXTR_TIMEOUT, false);
}

void ExtCache::mark_slave_stale(uint16_t start_idx, uint16_t count, uint8_t /*slave_addr*/)
{
    mark_range_quality(start_idx, count, KX_EXTQ_STALE, KX_EXTR_TIMEOUT, true);
}

void ExtCache::mark_range_exception(uint16_t start_idx, uint16_t count, uint8_t exception_code)
{
    std::lock_guard<std::mutex> lock(mu_);
    for (uint16_t i = start_idx; i < start_idx + count && i < KX_N_EXT; i++) {
        samples_[i].exception_code = exception_code;
        samples_[i].quality        = KX_EXTQ_BAD;
        samples_[i].quality_reason = KX_EXTR_DEVICE_EXCEPTION;
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

    /* D-11: lấy offset của `samples` từ chính struct thay vì cộng tay kích
     * thước header. Cách cũ đúng chỉ vì header không sinh padding; thêm một
     * field vào header là receiver đọc lệch mà không test nào bắt được. */
    static_assert(offsetof(kx_ext_snapshot_v2_t, samples) == 72,
                  "layout header kx_ext_snapshot_v2_t đã đổi — cập nhật consumer đồng bộ");

    kx_ext_snapshot_v2_t msg{};
    std::unique_lock<std::mutex> lock(mu_);
    msg.magic            = KX_EXT_SNAP_V2_MAGIC;
    msg.schema_version   = static_cast<uint16_t>(KX_EXT_SNAP_SCHEMA_VER);
    msg.count            = count_;
    msg.sequence         = ++sequence_;
    msg.generation       = prov_.generation;
    msg.config_revision  = prov_.config_revision;
    msg.producer_boot_id = prov_.producer_boot_id;
    msg.publish_mono_ns  = monotonic_ns();
    std::memcpy(msg.config_checksum, prov_.config_checksum, sizeof(msg.config_checksum));
    msg.config_checksum[sizeof(msg.config_checksum) - 1] = '\0';
    const uint16_t published = count_;
    std::memcpy(msg.samples, samples_, published * sizeof(kx_ext_sample_v2_t));
    /* Nhả khoá TRƯỚC sendto: một syscall chậm không được giữ worker lại. */
    lock.unlock();

    struct sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, sock_path.c_str(), sizeof(addr.sun_path) - 1);

    const ssize_t total = static_cast<ssize_t>(
        offsetof(kx_ext_snapshot_v2_t, samples) + published * sizeof(kx_ext_sample_v2_t));
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

kx_ext_sample_v2_t ExtCache::sample(uint16_t idx) const
{
    std::lock_guard<std::mutex> lock(mu_);
    if (idx >= KX_N_EXT) return kx_ext_sample_v2_t{};
    return samples_[idx];
}

} // namespace iobus::fieldbus
