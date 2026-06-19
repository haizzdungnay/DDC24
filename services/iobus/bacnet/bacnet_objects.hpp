/**
 * @file  bacnet_objects.hpp
 * @brief BAC-003 + BAC-005: BACnet object registry for MK-DDC-24.
 *        Objects: AI×8, BI×8, AO×4, BO×4, AV×32, BV×16, MSV×8 + Device.
 *        ReadProperty / ReadPropertyMultiple callbacks read from kx_plc_shm_t.
 *        WriteProperty callbacks go to core.sock via source=bacnet.
 *        Dispatch requires MKDDC_ENABLE_BACNET.
 */
#ifndef IOBUS_BACNET_OBJECTS_HPP
#define IOBUS_BACNET_OBJECTS_HPP

#include <cstdint>
#include <string>
#include <functional>
#include "bacnet_config.hpp"
#include "bacnet_reliability.hpp"
#include "bacnet_priority.hpp"
#include "bacnet_cov.hpp"
#include "mkddc_shm.h"

namespace iobus::bacnet {

/** Callback to send a write command to core.sock.
 *  Returns true if core accepted (result != overridden), false = overridden. */
using CoreWriteFn = std::function<bool(const std::string& op,
                                        uint32_t point_idx,
                                        float value,
                                        const std::string& user,
                                        int prio)>;

/** Callback to notify COV subscribers (caller dispatches to BACnet network). */
using CovNotifyFn = std::function<void(BacnetObjectType obj_type,
                                        uint32_t instance,
                                        float value,
                                        uint8_t status_flags)>;

/**
 * BAC-003: Object registry — holds config (names, units, COV_Increment, etc.)
 * and exposes read/write interface called by bacnet_server.
 *
 * Instance numbers: 1-based. AI1→instance 1, ..., AI8→instance 8.
 * AV1–AV32, BV1–BV16, MSV1–MSV8.
 */
class BacnetObjects {
public:
    BacnetObjects();

    /** Initialize from config (device name, IDs). */
    void init(const BacnetConfig& cfg);

    /** BAC-005: Read Present_Value + Status_Flags + Reliability from plc_shm.
     *  Returns false if instance out of range. */
    bool read_ai(uint32_t instance, float* value, uint8_t* status_flags, uint8_t* reliability,
                  const kx_plc_shm_t* shm) const;
    bool read_bi(uint32_t instance, float* value, uint8_t* status_flags, uint8_t* reliability,
                  const kx_plc_shm_t* shm) const;
    bool read_ao(uint32_t instance, float* value, uint8_t* status_flags, uint8_t* reliability,
                  const kx_plc_shm_t* shm) const;
    bool read_bo(uint32_t instance, float* value, uint8_t* status_flags, uint8_t* reliability,
                  const kx_plc_shm_t* shm) const;
    bool read_av(uint32_t instance, float* value, uint8_t* status_flags,
                  const kx_plc_shm_t* shm) const;
    bool read_bv(uint32_t instance, float* value, uint8_t* status_flags,
                  const kx_plc_shm_t* shm) const;
    bool read_msv(uint32_t instance, float* value, uint8_t* status_flags,
                   const kx_plc_shm_t* shm) const;

    /** BAC-006: WriteProperty → Priority_Array → core.sock.
     *  Returns true if core accepted; false = overridden. */
    bool write_ao(uint32_t instance, uint8_t prio, float value,
                   const std::string& user, const CoreWriteFn& fn);
    bool write_bo(uint32_t instance, uint8_t prio, float value,
                   const std::string& user, const CoreWriteFn& fn);
    bool write_av(uint32_t instance, float value,
                   const std::string& user, const CoreWriteFn& fn);
    bool write_bv(uint32_t instance, float value,
                   const std::string& user, const CoreWriteFn& fn);
    bool write_msv(uint32_t instance, float value,
                    const std::string& user, const CoreWriteFn& fn);

    /** Relinquish (write NULL to Priority_Array slot). */
    bool relinquish_ao(uint32_t instance, uint8_t prio,
                        const std::string& user, const CoreWriteFn& fn);
    bool relinquish_bo(uint32_t instance, uint8_t prio,
                        const std::string& user, const CoreWriteFn& fn);

    /** Out_Of_Service flag (operator set, clears fault). */
    void set_oos_ai(uint32_t instance, bool oos);
    void set_oos_bi(uint32_t instance, bool oos);

    bool oos_ai(uint32_t instance) const;
    bool oos_bi(uint32_t instance) const;

    /** Object names (Object_Name property). */
    const std::string& ai_name(uint32_t instance) const;
    const std::string& bi_name(uint32_t instance) const;
    const std::string& ao_name(uint32_t instance) const;
    const std::string& bo_name(uint32_t instance) const;
    const std::string& av_name(uint32_t instance) const;
    const std::string& bv_name(uint32_t instance) const;
    const std::string& msv_name(uint32_t instance) const;

    /** COV_Increment (AI/AO/AV). */
    void set_cov_increment_ai(uint32_t instance, float v);
    void set_cov_increment_ao(uint32_t instance, float v);
    void set_cov_increment_av(uint32_t instance, float v);

    /** AI engineering unit string (e.g. "degC"). */
    const std::string& ai_unit(uint32_t instance) const;

    /** Access Priority manager (BAC-006). */
    BacnetPriority& priority() { return priority_; }
    const BacnetPriority& priority() const { return priority_; }

    /** Access COV manager (BAC-007). */
    BacnetCov& cov() { return cov_; }
    const BacnetCov& cov() const { return cov_; }

    /** Device config. */
    const BacnetConfig& config() const { return cfg_; }

private:
    BacnetConfig   cfg_;
    BacnetPriority priority_;
    BacnetCov      cov_;

    static constexpr int N_AI  = 8;
    static constexpr int N_BI  = 8;
    static constexpr int N_AO  = 4;
    static constexpr int N_BO  = 4;
    static constexpr int N_AV  = 32;
    static constexpr int N_BV  = 16;
    static constexpr int N_MSV = 8;

    std::string ai_names_[N_AI];
    std::string bi_names_[N_BI];
    std::string ao_names_[N_AO];
    std::string bo_names_[N_BO];
    std::string av_names_[N_AV];
    std::string bv_names_[N_BV];
    std::string msv_names_[N_MSV];
    std::string ai_units_[N_AI];

    bool ai_oos_[N_AI] = {};
    bool bi_oos_[N_BI] = {};

    static const std::string kEmpty;
};

} // namespace iobus::bacnet

#endif /* IOBUS_BACNET_OBJECTS_HPP */
