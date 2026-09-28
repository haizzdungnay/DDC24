#ifndef HMI_SHM_READER_HPP
#define HMI_SHM_READER_HPP

#include <cstddef>
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

/* Kết quả một lần read_all(): trạng thái đọc của TỪNG vùng SHM.
 *
 * Vì sao cần struct thay vì một bool: đường annunciation (banner sự cố, alarm
 * E001/E002) phải coi "không đọc được io" là CÓ SỰ CỐ, không phải "bình
 * thường". Trước đây read_all() trả một bool duy nhất chỉ phản ánh vùng io và
 * caller bỏ qua nó, nên một lần đọc thất bại làm DataCache giữ nguyên
 * iop_status=NORMAL của chu kỳ trước → banner vẫn xanh, E001 im lặng
 * (finding F-03, review 2026-07-30). */
struct ReadStatus {
    bool io_ok  = false;
    bool plc_ok = false;
};

/* Quyết định annunciation an toàn — nguồn chân lý duy nhất cho banner sự cố,
 * alarm E001 và E002. main.cpp gọi đúng hai hàm này; test chốt hành vi ở đây
 * chứ không copy lại biểu thức, để test không thể "đúng" trong khi main sai.
 *
 * Nguyên tắc: KHÔNG ĐỌC ĐƯỢC = CÓ SỰ CỐ. */
inline bool io_fault_active(const ReadStatus& st, const DataCache& d)
{
    return !st.io_ok || d.iop_status == KX_IOP_FAULT;
}

/* E002 chỉ có nghĩa khi io_shm đọc được: fault_flags của chu kỳ trước không
 * được phép kích alarm MCU, và bịa ra cờ lỗi cũng sai như nuốt nó. */
inline bool mcu_fault_active(const ReadStatus& st, const DataCache& d)
{
    return st.io_ok && d.fault_flags != 0;
}

/* T63-102 (PERF-API-01, Plan 63 §4.2): chính sách đọc seqlock — CÙNG chính
 * sách T63-101 của web (apps/web-api/internal/app/shm_reader.go).
 *
 * Trước bản này reader thử 5 vòng liền và gặp seq lẻ là thử lại NGAY: cả 5 vòng
 * xong trong < 1 µs, gọn trong đúng một lần writer đang ghi, nên một lần ghi
 * bình thường của iobus/Core cũng đủ làm HMI mất một chu kỳ dữ liệu (banner
 * FAULT, E001 thoáng qua).
 *
 * Nay: thử lại tới `deadline_ns` (tổng ≤ 1 ms); `spin_yields` lần đầu chỉ
 * nhường CPU (`sched_yield`), sau đó ngủ `backoff_ns` — nhưng CHỈ khi hạn còn
 * lại ≥ `backoff_ns + sleep_slack_ns`, để lần đọc thất bại kết thúc tại deadline
 * chứ không trễ thêm một nhịp ngủ. Hết hạn = đọc thất bại, fail-safe như cũ
 * (annunciation reset về FAULT, giá trị giữ bản cũ + age_ns).
 *
 * HMI không phải luồng RT (lv_timer 1 s), nên chờ tối đa 1 ms × 2 segment là
 * chấp nhận được. Mặc định là hành vi production; hook chỉ để test thay đồng
 * hồ/ngủ/nhường CPU. */
struct SeqlockPolicy {
    uint64_t deadline_ns    = 1000000ull;   /* 1 ms — cùng lý do shmSeqlockDeadline */
    int      spin_yields    = 8;
    uint64_t backoff_ns     = 50000ull;     /* 50 µs */
    uint64_t sleep_slack_ns = 250000ull;    /* độ vượt nanosleep đo trên host (T63-101) */
    /* nullptr ⇒ production: CLOCK_MONOTONIC / nanosleep / sched_yield. */
    uint64_t (*now_ns)(void* ctx)             = nullptr;
    void     (*sleep_ns)(void* ctx, uint64_t) = nullptr;
    void     (*yield)(void* ctx)              = nullptr;
    void*    ctx                              = nullptr;
};

/* Bộ đếm TÍCH LUỸ của một segment kể từ khi ShmReader được tạo (reset khi HMI
 * restart). `failures` = số lần hết deadline mà không có snapshot nhất quán. */
struct SeqlockSegmentStats {
    uint64_t reads       = 0;
    uint64_t retries     = 0;
    uint64_t failures    = 0;
    uint64_t max_wait_us = 0;
};

struct SeqlockStats {
    SeqlockSegmentStats io;
    SeqlockSegmentStats plc;
};

/* T63-102: dòng log phút `hmi.shm_reader k=v …` (không có tiền tố mức log,
 * không xuống dòng) ghi vào `buf`; trả giá trị của snprintf. Mọi khoá là TÍCH
 * LUỸ theo tiến trình HMI — probe lấy delta đầu/cuối cửa sổ đo. Không cấp phát. */
constexpr std::size_t kSeqlockStatsLineCapacity = 448;
int format_seqlock_stats_line(char* buf, std::size_t size, const SeqlockStats& stats);

/* Read-only consumer of both SHM segments. HMI never writes SHM. */
class ShmReader {
public:
    ~ShmReader() { detach(); }

    /* Attach both SHM segments. Returns false if either not ready yet (retry). */
    bool attach();
    void detach();

    bool attached_io()  const { return io_  != nullptr; }
    bool attached_plc() const { return plc_ != nullptr; }

    /* Seqlock read into DataCache. Sets io_valid / plc_valid independently.
     *
     * Fail-safe: các field lái annunciation (iop_status, fault_flags) được reset
     * về trạng thái "có sự cố" TRƯỚC khi đọc, nên một lần đọc thất bại không bao
     * giờ để giá trị cũ tiếp tục lái quyết định. Các field *giá trị*
     * (ui_value/ai/... và ts_ns) KHÔNG bị reset — chúng đã được age_ns bảo vệ ở
     * screen_io, xoá chúng chỉ làm màn hình nháy khi trượt một chu kỳ đọc. */
    ReadStatus read_all(DataCache* out) const;

    /* For unit tests: inject pre-allocated structs (no mmap). */
    void attach_external_io (const kx_io_shm_t*  p) { io_  = p; ext_io_  = true; }
    void attach_external_plc(const kx_plc_shm_t* p) { plc_ = p; ext_plc_ = true; }

    /* T63-102: bộ đếm retry/fail theo segment (tích luỹ). */
    SeqlockStats seqlock_stats() const { return stats_; }
    /* T63-102: chỉ test dùng — thay đồng hồ/ngủ/nhường CPU. */
    void set_seqlock_policy_for_test(const SeqlockPolicy& policy) { policy_ = policy; }

private:
    const volatile kx_io_shm_t*  io_      = nullptr;
    const volatile kx_plc_shm_t* plc_     = nullptr;
    bool ext_io_  = false;
    bool ext_plc_ = false;
    size_t io_sz_ = 0;
    size_t plc_sz_ = 0;
    SeqlockPolicy policy_{};
    /* read_all() là const với DataCache nhưng vẫn phải đếm; HMI đọc SHM từ đúng
     * một luồng (lv_timer), nên không cần atomic. */
    mutable SeqlockStats stats_{};

    static bool seqlock_read_io (const volatile kx_io_shm_t*  s, DataCache* out,
                                 const SeqlockPolicy& policy, SeqlockSegmentStats* stats);
    static bool seqlock_read_plc(const volatile kx_plc_shm_t* s, DataCache* out,
                                 const SeqlockPolicy& policy, SeqlockSegmentStats* stats);
};

/* Populate SysSnapshot from /proc & /sys. Call every 5s. */
void sys_snapshot_update(SysSnapshot* snap);

} // namespace hmi

#endif
