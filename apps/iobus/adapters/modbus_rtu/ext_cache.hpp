/**
 * @file  ext_cache.hpp
 * @brief MOD-006/009 + MBR-B103/B104: cache mẫu ext + publish snapshot v2 tới
 *        fieldbus.sock. Fieldbus KHÔNG ghi plc_shm trực tiếp — core là writer
 *        duy nhất; iobus chỉ gửi `kx_ext_snapshot_v2_t`.
 *
 * Cache giữ **mẫu** (value + quality + reason + mốc thời gian), không giữ
 * setpoint/dirty: hai trường đó thuộc quyền core.
 */
#ifndef IOBUS_EXT_CACHE_HPP
#define IOBUS_EXT_CACHE_HPP

#include <cstdint>
#include <mutex>
#include <string>

#include "mkddc_shm.h"

namespace iobus::fieldbus {

/* Provenance của một lần publish. Tách thành struct để BusWorker/ModbusMaster
 * không phải nhớ thứ tự 5 tham số rời. */
struct SnapshotProvenance {
    uint64_t generation       = 1;
    uint64_t config_revision  = 0;
    uint64_t producer_boot_id = 0;
    char     config_checksum[KX_EXT_CHECKSUM_LEN] = {0};
};

class ExtCache {
public:
    ExtCache();

    /* Ghi một mẫu ĐỌC THÀNH CÔNG.
     *
     * `sample_utc_ms`/`sample_mono_ns` là mốc của chính mẫu này. Chỉ hàm này
     * cập nhật mốc thời gian: mọi đường xuống cấp quality (stale/offline) phải
     * GIỮ NGUYÊN mốc cũ, vì mốc trả lời câu hỏi "lần cuối thiết bị nói thật là
     * khi nào", không phải "lần cuối ta thử hỏi là khi nào". */
    void set_sample(uint16_t idx, const char* point_id, double value,
                    kx_ext_quality_t quality, kx_ext_quality_reason_t reason,
                    uint8_t slave_addr, uint8_t bus_id, bool online, bool writable,
                    int64_t sample_utc_ms, int64_t sample_mono_ns);

    /* Cấp danh tính slot trước lần I/O đầu tiên: điểm chưa từng có mẫu phải
     * publish được đúng point_id kèm BAD/NOT_INITIALIZED thay vì một ô trống. */
    void declare_point(uint16_t idx, const char* point_id, uint8_t slave_addr,
                       uint8_t bus_id, bool writable);

    /* Hạ quality cho toàn bộ slot của một slave mà KHÔNG đụng value/timestamp.
     * `reason` nói vì sao: TIMEOUT, PORT_DOWN, CONFIG_ERROR… */
    void mark_range_quality(uint16_t start_idx, uint16_t count,
                            kx_ext_quality_t quality, kx_ext_quality_reason_t reason,
                            bool online);

    /* Tương thích ngược cho call site cũ. */
    void mark_slave_offline(uint16_t start_idx, uint16_t count, uint8_t slave_addr);
    void mark_slave_stale(uint16_t start_idx, uint16_t count, uint8_t slave_addr);

    /* Gắn mã exception Modbus gốc cho một dải slot (reason DEVICE_EXCEPTION). */
    void mark_range_exception(uint16_t start_idx, uint16_t count, uint8_t exception_code);

    /* Gửi snapshot v2 (SOCK_DGRAM, sendto). Trả false nếu send fail
     * (log + continue — mất một datagram là chấp nhận được, core dùng ảnh cũ
     * và `sample_age` tự tăng thành STALE). */
    bool push_snapshot(const std::string& sock_path);

    void set_provenance(const SnapshotProvenance& prov) { prov_ = prov; }
    const SnapshotProvenance& provenance() const { return prov_; }

    /* Số slot đang dùng. */
    uint16_t count() const { std::lock_guard<std::mutex> lock(mu_); return count_; }
    /* Số datagram đã publish — bằng `sequence` của gói kế tiếp trừ 1. */
    uint64_t sequence() const { return sequence_; }

    /* Bản SAO có khoá — dùng ở test và ở đường đọc chẩn đoán. Trả tham chiếu
     * ra ngoài khoá là mời đọc rách. */
    kx_ext_sample_v2_t sample(uint16_t idx) const;

private:
    /* MBR-B101: nhiều BusWorker ghi cache đồng thời (dải slot rời nhau) trong
     * khi publisher đọc toàn bộ. Dải rời nhau KHÔNG đủ để bỏ khoá: `count_` là
     * biến dùng chung, và `push_snapshot` memcpy cả mảng nên phải thấy một ảnh
     * nhất quán. */
    mutable std::mutex mu_;
    kx_ext_sample_v2_t samples_[KX_N_EXT] = {};
    uint16_t           count_    = 0;
    uint64_t           sequence_ = 0;
    SnapshotProvenance prov_{};
    int                sock_fd_ = -1;   /* persistent sendto socket */
};

} // namespace iobus::fieldbus

#endif /* IOBUS_EXT_CACHE_HPP */
