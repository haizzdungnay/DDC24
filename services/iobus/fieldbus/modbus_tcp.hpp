/**
 * @file  modbus_tcp.hpp
 * @brief MOD-013: Modbus TCP client — kết nối đến nhiều slave TCP độc lập.
 *        Mỗi slave có reconnect state machine: DISCONNECTED → connect → CONNECTED.
 *        libmodbus API guarded by MKDDC_ENABLE_MODBUS; logic compile unconditionally.
 */
#ifndef IOBUS_MODBUS_TCP_HPP
#define IOBUS_MODBUS_TCP_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "device_profile.hpp"
#include "ext_cache.hpp"
#include "fieldbus_config.hpp"
#include "poll_scheduler.hpp"

namespace iobus::fieldbus {

class ModbusTcp {
public:
    ~ModbusTcp();

    /**
     * Init TCP contexts từ tcp_slaves trong config.
     * ext_offset: ext_cache index bắt đầu cấp cho TCP (sau RTU slaves).
     * Trả false nếu MKDDC_ENABLE_MODBUS=OFF hoặc tcp_slaves rỗng.
     */
    bool open(const FieldbusConfig& cfg, uint16_t ext_offset);
    void close();

    bool has_slaves() const { return !conns_.empty(); }

    /**
     * Poll tất cả TCP slaves đến hạn; reconnect slave đã disconnect nếu đến hạn.
     * Gọi push_snapshot() sau khi poll xong.
     */
    void poll_once(uint64_t now_ms, ExtCache& cache,
                   const std::string& fieldbus_sock_path);

    /* Số ms nên sleep trước khi poll_once() kế. */
    uint32_t sleep_ms_until_next(uint64_t now_ms) const;

    /* Tổng số ext slots cấp cho TCP slaves (để caller tính offset tiếp theo). */
    uint16_t total_ext_count() const { return total_ext_count_; }

private:
    struct TcpConn {
        void*         ctx              = nullptr;  /* modbus_t* as void* */
        SlaveState    state;
        DeviceProfile profile;
        uint16_t      ext_base         = 0;
        uint16_t      ext_count        = 0;
        bool          connected        = false;
        uint64_t      next_reconnect_ms = 0;
        TcpSlaveConfig cfg;
    };

    bool try_connect(TcpConn& conn);
    void free_ctx(TcpConn& conn);
    void mark_offline(TcpConn& conn, ExtCache& cache);
    void read_conn(TcpConn& conn, uint64_t now_ms, ExtCache& cache);

    std::vector<TcpConn> conns_;
    uint16_t             total_ext_count_ = 0;
};

} // namespace iobus::fieldbus

#endif /* IOBUS_MODBUS_TCP_HPP */
