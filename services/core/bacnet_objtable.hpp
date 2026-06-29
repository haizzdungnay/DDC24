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
    void publish(const PointTable& table, uint32_t scan_count, uint32_t scan_overrun,
                 uint16_t fault_flags = 0, uint8_t iop_status = KX_IOP_FAULT);

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

/* BAC-008: quality + fault_flags → BACnet Reliability value (kx_point_t.reliability).
 * 0=NO_FAULT, 1=OVER_RANGE, 2=UNDER_RANGE, 3=OPEN_LOOP, 4=SHORT_LOOP, 5=COMM_FAILURE.
 * IOP fault → 5 (comm failure, value stale). */
uint8_t quality_to_reliability(kx_quality_t q, uint16_t fault_flags, int ch_mask_bit);

} // namespace core

#endif /* CORE_BACNET_OBJTABLE_HPP */
