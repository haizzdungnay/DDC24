/**
 * @file  bacnet_objtable.hpp
 * @brief Core BAC-004: creator + seqlock writer kx_plc_shm.
 *        Full implementation: value/quality/reliability per point,
 *        ext[] update từ fieldbus.sock (MOD-009).
 *
 * Rule: core là writer DUY NHẤT của kx_plc_shm_t (15 §6).
 *       BACnet server (iobus) CHỈ đọc plc_shm.
 */
#ifndef CORE_BACNET_OBJTABLE_HPP
#define CORE_BACNET_OBJTABLE_HPP

#include "mkddc_shm.h"
#include "point_table.hpp"

namespace core {

class BacnetObjTable {
public:
    ~BacnetObjTable();

    /* core là creator của plc_shm (15 §6). */
    bool attach();
    void detach();

    /**
     * Ghi value/quality/reliability từ point table + io snapshot qua seqlock.
     * Gọi ở scan step 9 (sau output_writer.write).
     * BAC-004: reliability map từ quality + fault_flags theo SW_BACNET_DESIGN §6.
     */
    /**
     * ADR-011 overload: thêm ui_reliability[] để ghi kx_point_t.reliability cho AI
     * trực tiếp từ io_shm (thay vì re-compute từ quality, mất thông tin fault cause).
     */
    void publish(const PointTable& table, uint32_t scan_count, uint32_t scan_overrun,
                 uint16_t fault_flags, uint8_t iop_status,
                 const uint8_t ui_reliability[KX_N_UI]);

    /**
     * MOD-009: đọc ext snapshot datagram từ fieldbus.sock (SOCK_DGRAM, MSG_DONTWAIT).
     * Ghi plc_shm.ext[] giữa KX_WRITE_BEGIN/END — core là single writer.
     * Nếu sockfd < 0 hoặc không có datagram → dùng snapshot cũ (stale theo ts_ns).
     */
    void read_ext(int sockfd);

    bool attached() const { return shm_ != nullptr; }

    /* COR-011: direct access to plc_shm for Protocol nodes (scan_loop reads ext[]). */
    const kx_plc_shm_t* shm() const { return shm_; }
    kx_plc_shm_t*       shm()       { return shm_; }

private:
    kx_plc_shm_t* shm_ = nullptr;
};

/* BAC-008: quality + fault_flags → kx_reliability_t value for non-AI points (BI, AO, BO, AV...).
 * AI reliability is now set directly from io_shm.ui_reliability[] (ADR-011). */
uint8_t quality_to_reliability(kx_quality_t q, uint16_t fault_flags, int ch_mask_bit);

} // namespace core

#endif /* CORE_BACNET_OBJTABLE_HPP */
