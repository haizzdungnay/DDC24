/**
 * @file  modbus_master.hpp
 * @brief MOD-006/007: Modbus RTU master — read FC01/02/03/04, write FC05/06/15/16.
 *        Chạy priority thường (KHÔNG SCHED_FIFO — tránh chặn IOP 100Hz).
 *        rs485.device từ fieldbus.conf — KHÔNG hardcode path trong code (plan 25 §1).
 *        libmodbus API guarded by MKDDC_ENABLE_MODBUS; logic compile unconditionally.
 */
#ifndef IOBUS_MODBUS_MASTER_HPP
#define IOBUS_MODBUS_MASTER_HPP

#include <atomic>
#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "device_profile.hpp"
#include "ext_cache.hpp"
#include "fieldbus_config.hpp"
#include "fieldbus_metrics.hpp"
#include "poll_scheduler.hpp"
#include "mkddc_shm.h"

namespace iobus::fieldbus {

struct PendingWrite {
    uint16_t ext_idx;       /* index trong ext_cache */
    uint8_t  slave_addr;
    uint8_t  fc;
    uint16_t reg_addr;
    float    value;
    PointType type;
    ByteOrder byte_order;
    float    scale;
    float    offset;
    bool     submitted = false;
};

class ModbusMaster {
public:
    ~ModbusMaster();

    /**
     * Init libmodbus context từ fieldbus.conf.
     * rs485.device từ config — KHÔNG hardcode. Priority thường.
     * Trả false nếu MKDDC_ENABLE_MODBUS=OFF hoặc open/config fail.
     */
    bool open(const FieldbusConfig& cfg);
    void close();
    bool is_open() const { return ctx_ != nullptr; }

    /**
     * Chạy 1 iteration poll loop:
     *  - Với mỗi slave đến hạn: read blocks → decode → ext_cache.set_point()
     *  - Sau khi read: flush pending_writes cho slave đó
     *  - Kiểm tra E302/E303 qua metrics
     * Sau khi tất cả slaves: ext_cache.push_snapshot(fieldbus_sock_path).
     * Gọi từ fieldbus thread (priority thường).
     */
    void poll_once(uint64_t now_ms, ExtCache& cache, FieldbusMetrics& metrics,
                   const std::string& fieldbus_sock_path);

    /**
     * Thêm write request từ core (qua plc_shm.ext[i].dirty).
     * Sẽ được flush trong poll_once() của vòng kế.
     */
    void enqueue_write(const PendingWrite& w);

    /**
     * COR-011 write bridge: đọc dirty flags từ plc_shm, enqueue PendingWrite cho
     * mỗi ext slot writable đang dirty. Gọi từ fieldbus_thread trước poll_once().
     * Chỉ iterate RTU slaves — TCP writes xử lý riêng.
     */
    void drain_ext_writes(const kx_plc_shm_t* shm);

    /* Tính số ms nên sleep trước khi poll_once() kế.
     * 0 = có slave đến hạn ngay. */
    uint32_t sleep_ms_until_next(uint64_t now_ms) const;

    /* Tổng số ext slots đã cấp phát cho RTU slaves — TCP offset bắt đầu từ đây. */
    uint16_t total_ext_count() const {
        if (slave_ext_base_.empty()) return 0;
        const size_t last = slave_ext_base_.size() - 1;
        return static_cast<uint16_t>(slave_ext_base_[last] + slave_ext_count_[last]);
    }

private:
    void read_slave(uint8_t slave_idx, uint64_t now_ms,
                    ExtCache& cache, FieldbusMetrics& metrics);
    void write_slave(uint8_t slave_idx, FieldbusMetrics& metrics);
    void flush_pending(uint8_t slave_idx);

    void* ctx_ = nullptr;   /* modbus_t* — void* để compile mà không cần libmodbus header */

    std::vector<SlaveState>   slave_states_;
    std::vector<DeviceProfile> profiles_;
    std::vector<uint16_t>     slave_ext_base_;   /* index vào ext_cache cho slave[i] */
    std::vector<uint16_t>     slave_ext_count_;  /* số ext points thực của slave[i] */
    /* F-16: slave[i] không dùng được do lỗi cấu hình (thiếu profile, không có
     * điểm đọc, hoặc hết ext slot). read_slave() đi đường lỗi cho nó thay vì
     * chạy qua vòng points rỗng rồi báo ONLINE. uint8_t thay vì bool để tránh
     * std::vector<bool> proxy-reference. */
    std::vector<uint8_t>      slave_config_error_;
    std::vector<PendingWrite> pending_writes_;
    std::array<float, KX_N_EXT> last_written_{};
    std::array<bool, KX_N_EXT>  has_last_written_{};
    FieldbusConfig            cfg_;
};

} // namespace iobus::fieldbus

#endif /* IOBUS_MODBUS_MASTER_HPP */
