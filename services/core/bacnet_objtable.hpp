/**
 * @file  bacnet_objtable.hpp
 * @brief STUB (07 §0 #11): creator + seqlock writer kx_plc_shm.
 *        Stub = ghi value/quality, bỏ priority array BACnet.
 */
#ifndef CORE_BACNET_OBJTABLE_HPP
#define CORE_BACNET_OBJTABLE_HPP

#include "point_table.hpp"

namespace core {

class BacnetObjTable {
public:
    ~BacnetObjTable();

    /* core là creator của plc_shm (15 §6). */
    bool attach();
    void detach();

    /* Ghi value/quality từ point table qua seqlock (scan step 9). */
    void publish(const PointTable& table, uint32_t scan_count, uint32_t scan_overrun);

private:
    kx_plc_shm_t* shm_ = nullptr;
};

} // namespace core

#endif /* CORE_BACNET_OBJTABLE_HPP */
