#ifndef HMI_SHM_READER_HPP
#define HMI_SHM_READER_HPP

#include <cstdint>
#include <cstring>

#include "mkddc_shm.h"

namespace hmi {

/* Flat snapshot of all SHM fields used by HMI screens.
 * Populated by ShmReader::read_all() in the 1s lv_timer. */
struct DataCache {
    /* --- from kx_io_shm_t --- */
    float    ui_value[KX_N_UI]{};
    uint8_t  ui_quality[KX_N_UI]{};
    char     ui_unit[KX_N_UI][8]{};
    uint8_t  di_state[KX_N_DI]{};
    uint32_t di_counter[KX_N_DI]{};
    float    ao_setpoint[KX_N_AO]{};
    uint8_t  ao_mode[KX_N_AO]{};
    uint8_t  do_cmd[KX_N_DO]{};
    uint8_t  do_feedback[KX_N_DO]{};
    uint16_t fault_flags  = 0;
    uint8_t  iop_status   = KX_IOP_FAULT;
    int16_t  mcu_temp_x10 = 0;
    uint64_t ts_ns        = 0;
    uint32_t iop_rx = 0, iop_crc_err = 0, iop_timeout = 0;
    bool     io_valid     = false;

    /* --- from kx_plc_shm_t --- */
    kx_point_t     ai[KX_N_UI]{};
    kx_point_t     bi[KX_N_DI]{};
    kx_point_t     ao[KX_N_AO]{};
    kx_point_t     bo[KX_N_DO]{};
    kx_ext_point_t ext[KX_N_EXT]{};
    uint16_t       ext_count   = 0;
    uint8_t        plc_running = 0;
    uint32_t       scan_count  = 0;
    uint64_t       plc_ts_ns   = 0;
    bool           plc_valid   = false;

    /* Age in ns (now_ns - ts_ns) set at read time; UINT64_MAX if ts_ns==0 */
    uint64_t age_ns = UINT64_MAX;
};

/* System-level snapshot updated every 5s from /proc, /sys, network. */
struct SysSnapshot {
    char     fw_version[64]         = "unknown";
    uint32_t uptime_s               = 0;
    char     boot_reason[32]        = "unknown";
    char     mcu_fw_version[32]     = "unknown";
    char     last_error[64]         = "NONE";
    float    cpu_pct                = 0.0f;
    uint32_t ram_used_mb            = 0;
    uint32_t ram_total_mb           = 0;
    uint32_t storage_used_gb        = 0;
    uint32_t storage_total_gb       = 0;
    int32_t  cpu_temp_c10           = 0;  /* 0.1 °C */
    bool     eth_link               = false;
    char     eth_ip[16]             = "";
    char     eth_mac[18]            = "";
    char     eth_mask[16]           = "";
    char     eth_gw[16]             = "";
    char     bacnet_status[24]      = "UNKNOWN";
    uint32_t bacnet_last_req_s      = 0;
    char     modbus_rtu1_status[24] = "UNKNOWN";
    char     modbus_rtu2_status[24] = "UNKNOWN";
    char     modbus_tcp_status[24]  = "UNKNOWN";
    bool     core_running           = false;
    bool     iobus_running          = false;
    bool     hmi_running            = true;
    bool     bacnet_running         = false;
    bool     modbus_running         = false;
    char     watchdog_status[24]    = "UNKNOWN";
    char     watchdog_last_reset[32]= "NONE";
    char     last_warn[64]          = "NONE";
    char     last_fault[64]         = "NONE";
};

/* Read-only consumer of both SHM segments.
 * HMI never writes SHM (except safe-state in Screen 6 reboot). */
class ShmReader {
public:
    ~ShmReader() { detach(); }

    /* Attach both SHM segments. Returns false if either not ready yet (retry). */
    bool attach();
    void detach();

    bool attached_io()  const { return io_  != nullptr; }
    bool attached_plc() const { return plc_ != nullptr; }

    /* Seqlock read into DataCache. Sets io_valid / plc_valid independently. */
    bool read_all(DataCache* out) const;

    /* For unit tests: inject pre-allocated structs (no mmap). */
    void attach_external_io (const kx_io_shm_t*  p) { io_  = p; ext_io_  = true; }
    void attach_external_plc(const kx_plc_shm_t* p) { plc_ = p; ext_plc_ = true; }

private:
    const volatile kx_io_shm_t*  io_      = nullptr;
    const volatile kx_plc_shm_t* plc_     = nullptr;
    bool ext_io_  = false;
    bool ext_plc_ = false;
    size_t io_sz_ = 0;
    size_t plc_sz_ = 0;

    static bool seqlock_read_io (const volatile kx_io_shm_t*  s, DataCache* out);
    static bool seqlock_read_plc(const volatile kx_plc_shm_t* s, DataCache* out);
};

/* Populate SysSnapshot from /proc & /sys. Call every 5s. */
void sys_snapshot_update(SysSnapshot* snap);

} // namespace hmi

#endif
