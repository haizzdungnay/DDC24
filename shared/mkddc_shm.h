/**
 * @file    mkddc_shm.h
 * @brief   HỢP ĐỒNG shared memory giữa các service BE (SOM).
 *          mkddc-iobus GHI io_shm; mkddc-core/web ĐỌC (seqlock).
 *          mkddc-core GHI plc_shm + 2 field output trong io_shm (xem ownership).
 *
 * @note    NGUỒN-CHUẨN CUỐI CÙNG (Contract Freeze 2026-06-11 — xem
 *          docs/03_implementation/15_CONTRACT_FREEZE.md):
 *          file này THẮNG mọi tài liệu khi có mâu thuẫn về SHM layout, magic,
 *          path, field ownership, seqlock. Bảng ownership chi tiết (writer/
 *          reader/unit/update-rate/stale/default): 06_MKDDC_IOBUS guide §5.
 *
 * @note    Rename 2026-06-11: file cũ shared/kinexus_shm.h → file này.
 *          CHỈ đổi tên file + path runtime (kinexus_* → mkddc_*).
 *          Struct/typedef/macro GIỮ prefix kx_/KX_ và magic GIỮ NGUYÊN
 *          (binary contract không đổi) — KHÔNG tự ý rename struct/field.
 *
 * @note    Reader dùng pattern seqlock: đọc seq (chẵn) -> đọc data ->
 *          đọc lại seq; nếu lẻ hoặc đổi -> đọc lại. Reader KHÔNG block writer.
 */
#ifndef MKDDC_SHM_H
#define MKDDC_SHM_H

#include <stdint.h>

/* Path runtime Rev A — KHÔNG có alias, KHÔNG còn /dev/shm/kinexus_* */
#define KX_SHM_IO_PATH    "/dev/shm/mkddc_io_shm"
#define KX_SHM_PLC_PATH   "/dev/shm/mkddc_plc_shm"
#define KX_SHM_MAGIC      0x4B584403u   /* "KXD\3" — bumped v3: kx_reliability_t + ui_reliability[] (ADR-011) */

#define KX_N_UI   16   /* v2: Rev A 16 UI analog (ADR-010) */
#define KX_N_DI   8    /* reserved: DI optional SKU; base SKU stays 0 in SHM */
#define KX_N_AO   4
#define KX_N_DO   4
#define KX_N_AV   32
#define KX_N_BV   16
#define KX_N_MSV  8
#define KX_N_EXT  64   /* điểm thiết bị phụ (Modbus RTU master) */

/* Chất lượng điểm */
typedef enum { KX_Q_GOOD = 0, KX_Q_UNCERTAIN = 1, KX_Q_BAD = 2 } kx_quality_t;

/* Nguyên nhân lỗi điểm — 8 giá trị nội bộ tuần tự (0-7).
 * Ánh xạ sang BACnet Reliability ASHRAE 135-2020: xem bacnet_reliability.hpp.
 * ADR-011: iobus ghi ui_reliability[] trong io_shm → core chuyển vào plc_shm.ai[].reliability. */
typedef enum {
    KX_REL_RELIABLE              = 0,  /* NO_FAULT_DETECTED (BACnet 0) */
    KX_REL_OVER_RANGE            = 1,  /* OVER_RANGE        (BACnet 2) */
    KX_REL_UNDER_RANGE           = 2,  /* UNDER_RANGE       (BACnet 3) */
    KX_REL_OPEN_LOOP             = 3,  /* OPEN_LOOP         (BACnet 4) */
    KX_REL_SHORTED_LOOP          = 4,  /* SHORTED_LOOP      (BACnet 5) */
    KX_REL_CONFIGURATION_ERROR   = 5,  /* CONFIGURATION_ERROR (BACnet 10) */
    KX_REL_COMMUNICATION_FAILURE = 6,  /* COMMUNICATION_FAILURE (BACnet 12) */
    KX_REL_UNRELIABLE_OTHER      = 7,  /* UNRELIABLE_OTHER  (BACnet 7) */
} kx_reliability_t;

/* Trạng thái IOP (map từ state machine iobus: NORMAL_POLL→NORMAL;
 * INIT/HANDSHAKE/FAULT/RECONNECT→FAULT; SAFE_STATE→SAFE) */
typedef enum { KX_IOP_NORMAL = 0, KX_IOP_FAULT = 1, KX_IOP_SAFE = 2 } kx_iop_status_t;

/* ============ io_shm: iobus -> phần còn lại (giá trị đã scale) ============
 * Creator: mkddc-iobus (O_CREAT, init toàn bộ = default trước khi set magic).
 * Seqlock writer duy nhất: iobus. Ngoại lệ ownership: core là writer DUY NHẤT
 * của ao_setpoint[] + do_cmd[] (iobus chỉ đọc 2 field này).
 */
typedef struct {
    uint32_t magic;                 /* = KX_SHM_MAGIC khi hợp lệ           */
    volatile uint32_t seq;          /* seqlock: lẻ=đang ghi, chẵn=ổn       */
    uint64_t ts_ns;                 /* mốc cập nhật (CLOCK_MONOTONIC)      */

    float    ui_value[KX_N_UI];      /* engineering: °C, V, mA, %... default 0.0 */
    uint8_t  ui_quality[KX_N_UI];    /* kx_quality_t; default BAD (chưa có mẫu)  */
    uint8_t  ui_reliability[KX_N_UI];/* kx_reliability_t per channel; default COMMUNICATION_FAILURE */
    char     ui_unit[KX_N_UI][8];    /* "degC","V","mA"... NUL-terminated   */

    uint8_t  di_state[KX_N_DI];     /* 0/1 (đã debounce); default 0        */
    uint32_t di_counter[KX_N_DI];   /* đếm cạnh lên; default 0             */

    float    ao_setpoint[KX_N_AO];  /* WRITER=core (eng V/mA); iobus đọc→SET_AO; default safe (0V/4mA) */
    uint8_t  ao_mode[KX_N_AO];      /* WRITER=iobus (mode ĐÃ áp dụng từ io_config+ACK SET_AO_CFG); 0=0-10V,1=4-20mA */
    uint8_t  do_cmd[KX_N_DO];       /* WRITER=core; 0/1 lệnh; default 0    */
    uint8_t  do_feedback[KX_N_DO];  /* 0/1 phản hồi relay; default 0       */

    uint16_t fault_flags;           /* gương IOP_FAULT_* từ MCU; default 0 */
    uint8_t  iop_status;            /* kx_iop_status_t; default FAULT      */
    int16_t  mcu_temp_x10;          /* 0.1 °C; default 0                   */

    /* metrics IOP (cho /system/status); default 0, reset khi iobus restart */
    uint32_t iop_rx, iop_crc_err, iop_timeout, iop_seq_err;
} kx_io_shm_t;

/* ============ ext_shm: fieldbus (Modbus RTU master) -> hệ thống ============ */
typedef struct {
    char     name[24];              /* tên điểm (vd "EXT-1.DI0")           */
    float    value;
    uint8_t  quality;               /* kx_quality_t                       */
    uint8_t  slave_addr;
    uint8_t  online;                /* slave online?                      */
    uint8_t  writable;
    float    setpoint;              /* PLC/BMS đặt -> fieldbus ghi xuống   */
    uint8_t  dirty;                 /* có setpoint cần ghi                 */
} kx_ext_point_t;

/* ============ plc_shm: core -> iobus(BACnet)/web (object table) ============
 * Creator + seqlock writer duy nhất: mkddc-core.
 */
typedef struct {
    float    value;                 /* present value                      */
    float    priority[16];          /* priority array (commandable)        */
    float    relinquish_default;
    uint8_t  quality;
    uint8_t  reliability;           /* kx_reliability_t (0-7); ADR-011; iobus copies from ui_reliability[] */
} kx_point_t;

typedef struct {
    uint32_t magic;
    volatile uint32_t seq;
    uint64_t ts_ns;

    kx_point_t ai[KX_N_UI];
    kx_point_t bi[KX_N_DI];
    kx_point_t ao[KX_N_AO];         /* commandable (priority array)        */
    kx_point_t bo[KX_N_DO];         /* commandable                         */
    kx_point_t av[KX_N_AV];
    kx_point_t bv[KX_N_BV];
    kx_point_t msv[KX_N_MSV];

    kx_ext_point_t ext[KX_N_EXT];   /* điểm mở rộng từ field bus           */
    uint16_t   ext_count;

    uint8_t  plc_running;
    uint32_t scan_count;
    uint32_t scan_overrun;
} kx_plc_shm_t;

/* ---- seqlock helpers (single-writer / multi-reader) ---- */
#define KX_WRITE_BEGIN(s)  do { __atomic_add_fetch(&(s)->seq, 1, __ATOMIC_RELEASE); } while (0)
#define KX_WRITE_END(s)    do { __atomic_add_fetch(&(s)->seq, 1, __ATOMIC_RELEASE); } while (0)
/* reader: lặp { v=seq; nếu lẻ tiếp tục; đọc data; } đến khi seq==v và chẵn */

/* ============ fieldbus IPC: iobus fieldbus → core (UNIX datagram /run/mkddc/fieldbus.sock) ======
 * Struct này dùng làm payload datagram gửi từ mkddc-iobus (fieldbus thread) sang mkddc-core.
 * Core nhận tại ranh giới scan (scan_step_read_ext), ghi vào plc_shm.ext[] (seqlock write).
 * Fieldbus KHÔNG ghi plc_shm trực tiếp — core là writer duy nhất.
 * Magic: "EXT\1" = 0x45585401 — reject datagram nếu magic sai hoặc n < sizeof header.
 * Thêm vào mkddc_shm.h (Rev 2026-06-17) vì cả iobus lẫn core đều phải dùng struct này.
 * Xem: SW_FIELDBUS_DESIGN §10, plan 25 §3.
 */
#define KX_EXT_SNAP_MAGIC  0x45585401u   /* "EXT\1" */

typedef struct {
    uint32_t magic;                      /* = KX_EXT_SNAP_MAGIC khi hợp lệ     */
    uint16_t count;                      /* số điểm hợp lệ trong points[]       */
    uint16_t _pad;
    kx_ext_point_t points[KX_N_EXT];    /* snapshot tại thời điểm poll xong    */
} kx_ext_snapshot_msg_t;

#endif /* MKDDC_SHM_H */
