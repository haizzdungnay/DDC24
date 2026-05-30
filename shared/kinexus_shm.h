/**
 * @file    kinexus_shm.h
 * @brief   HỢP ĐỒNG shared memory giữa các service BE (SOM).
 *          io-driver/fieldbus GHI; plc/bacnet/agent/hmi ĐỌC (seqlock).
 *          Nguồn-chuẩn: spec/SW_ARCH_SPEC §2, design/software/SW_IODRIVER_DESIGN.
 *
 * @note    Reader dùng pattern seqlock: đọc seq (chẵn) -> đọc data ->
 *          đọc lại seq; nếu lẻ hoặc đổi -> đọc lại. Reader KHÔNG block writer.
 */
#ifndef KINEXUS_SHM_H
#define KINEXUS_SHM_H

#include <stdint.h>

#define KX_SHM_IO_PATH    "/dev/shm/kinexus_io_shm"
#define KX_SHM_PLC_PATH   "/dev/shm/kinexus_plc_shm"
#define KX_SHM_MAGIC      0x4B584401u   /* "KXD\1" */

#define KX_N_UI   8
#define KX_N_DI   8
#define KX_N_AO   4
#define KX_N_DO   4
#define KX_N_AV   32
#define KX_N_BV   16
#define KX_N_MSV  8
#define KX_N_EXT  64   /* điểm thiết bị phụ (Modbus RTU master) */

/* Chất lượng điểm */
typedef enum { KX_Q_GOOD = 0, KX_Q_UNCERTAIN = 1, KX_Q_BAD = 2 } kx_quality_t;

/* Trạng thái IOP */
typedef enum { KX_IOP_NORMAL = 0, KX_IOP_FAULT = 1, KX_IOP_SAFE = 2 } kx_iop_status_t;

/* ============ io_shm: io-driver -> phần còn lại (giá trị đã scale) ============ */
typedef struct {
    uint32_t magic;
    volatile uint32_t seq;          /* seqlock: lẻ=đang ghi, chẵn=ổn      */
    uint64_t ts_ns;                 /* mốc cập nhật (CLOCK_MONOTONIC)      */

    float    ui_value[KX_N_UI];     /* engineering: °C, V, mA, %...        */
    uint8_t  ui_quality[KX_N_UI];   /* kx_quality_t                        */
    char     ui_unit[KX_N_UI][8];   /* "degC","V","mA"...                  */

    uint8_t  di_state[KX_N_DI];     /* 0/1 (đã debounce)                   */
    uint32_t di_counter[KX_N_DI];   /* đếm cạnh                            */

    float    ao_setpoint[KX_N_AO];  /* PLC ghi vào (eng); io-driver đọc->MCU */
    uint8_t  ao_mode[KX_N_AO];      /* 0=0-10V, 1=4-20mA                   */
    uint8_t  do_cmd[KX_N_DO];       /* 0/1 lệnh                            */
    uint8_t  do_feedback[KX_N_DO];  /* 0/1 phản hồi relay                  */

    uint16_t fault_flags;           /* gương IOP_FAULT_* từ MCU            */
    uint8_t  iop_status;            /* kx_iop_status_t                     */
    int16_t  mcu_temp_x10;          /* 0.1 °C                              */

    /* metrics IOP (cho /system/status) */
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

/* ============ plc_shm: PLC -> bacnet/agent (object BACnet) ============ */
typedef struct {
    float    value;                 /* present value                      */
    float    priority[16];          /* priority array (commandable)        */
    float    relinquish_default;
    uint8_t  quality;
    uint8_t  reliability;           /* 0=no-fault,1=over,2=under,3=open,4=short */
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

#endif /* KINEXUS_SHM_H */
