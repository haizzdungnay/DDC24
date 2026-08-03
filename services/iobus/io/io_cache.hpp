/**
 * @file  io_cache.hpp
 * @brief Creator + seqlock writer duy nhất của kx_io_shm (06 §3.7, §5).
 *        iobus CHỈ ghi field Writer=iobus; ao_setpoint/do_cmd là của core (read-only,
 *        ngoại lệ init: memset 0 toàn struct TRƯỚC khi set magic).
 */
#ifndef IOBUS_IO_CACHE_HPP
#define IOBUS_IO_CACHE_HPP

#include "io/io_types.hpp"

namespace iobus {

class IobusMetrics;

class IoCache {
public:
    ~IoCache();

    /* shm_open(O_CREAT) + ftruncate + mmap + init default + set magic CUỐI CÙNG. */
    bool attach();
    void detach();   /* munmap, KHÔNG shm_unlink (core còn đọc — 06 §13 bước 13) */

    /* Ghi snapshot input + metrics + status qua seqlock. di_counter đếm cạnh lên nội bộ. */
    void write_io(const IoSnapshot& s, const IobusMetrics& m);

    /* Ghi ao_mode[] (sau ACK SET_AO_CFG) + ui_unit[]/ui_raw_unit[] (khi load config). */
    void write_ao_mode(const uint8_t mode[KX_N_AO]);
    void write_ui_units(const char units[KX_N_UI][8], const char raw_units[KX_N_UI][8]);

    /* Cập nhật iop_status; trạng thái != NORMAL cũng đánh dấu toàn bộ UI mất liên lạc. */
    void write_status(uint8_t iop_status, const IobusMetrics& m);

    /* Poll lỗi thoáng qua trước fault timeout: dữ liệu stale nhưng chưa mất liên lạc. */
    void mark_inputs_unreliable();

    /* Publish telemetry per-slave fieldbus cho Web (finding F-03).
     * `count` bị cắt xuống KX_N_FB_SLAVE; fb_publish_seq tăng mỗi lần gọi để
     * consumer phân biệt "iobus chưa publish lần nào" với "đã publish, 0 slave". */
    void write_fieldbus_metrics(const kx_slave_metrics_t* slaves, size_t count);
    void write_modbus_diagnostics(const kx_modbus_diag_t* diagnostics, size_t count);

    /* Publish trạng thái bind BACnet/IP THẬT (finding F-04).
     * `bound` phải là kết quả bip_init()/rebind(), không phải cờ enabled trong config. */
    void write_bacnet_bind(bool bound, uint16_t udp_port);

    const kx_io_shm_t* shm() const { return shm_; }

private:
    kx_io_shm_t* shm_ = nullptr;
    uint8_t      prev_di_[KX_N_DI] = {};
    uint32_t     di_counter_[KX_N_DI] = {};
};

} // namespace iobus

#endif /* IOBUS_IO_CACHE_HPP */
