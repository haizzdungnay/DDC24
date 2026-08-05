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
 * @note    Rename 2026-06-11: file cũ kinexus_shm.h → file này.
 *          CHỈ đổi tên file + path runtime (kinexus_* → mkddc_*).
 *          Struct/typedef/macro GIỮ prefix kx_/KX_ và magic GIỮ NGUYÊN
 *          (binary contract không đổi) — KHÔNG tự ý rename struct/field.
 *
 * @note    Reader dùng pattern seqlock: đọc seq (chẵn) -> đọc data ->
 *          đọc lại seq; nếu lẻ hoặc đổi -> đọc lại. Reader KHÔNG block writer.
 *
 * @note    HỢP ĐỒNG READER — BẮT BUỘC (bổ sung 2026-07-30 sau finding F-02):
 *
 *          Reader PHẢI mmap() segment rồi áp pattern seqlock trên vùng đã map.
 *          Đọc bằng read() / pread() / os.ReadFile() / ioutil.ReadFile() /
 *          open()+fread() là **KHÔNG HỢP LỆ**, dù có kiểm `magic` và độ dài.
 *
 *          Vì sao: writer không hề chạm `magic` trong lúc ghi, nên check magic
 *          LUÔN pass và không phát hiện được gì. Còn shmfs dùng chung page với
 *          writer, nên một lần read() cả segment có thể trộn byte trước và sau
 *          một lần update — snapshot bị XÉ, không nhất quán, mà không có bất kỳ
 *          dấu hiệu nào để nhận ra. Chỉ có `seq` mới phát hiện điều đó, và `seq`
 *          chỉ dùng được khi reader đọc trực tiếp bộ nhớ đã map (đọc seq trước,
 *          đọc data, đọc LẠI seq trên cùng vùng map).
 *
 *          Đây chính là lỗi F-02: apps/web-api/internal/app/core_client.go dùng os.ReadFile +
 *          check magic/độ dài, snapshot bị xé đi thẳng ra WS monitor và được
 *          historian ghi vào DB thành bản ghi lịch sử sai không thể phát hiện
 *          về sau.
 *
 *          Hai hiện thực ĐÚNG dùng làm hình mẫu:
 *            - C++: apps/hmi/data/shm_reader.cpp  (seqlock_read_io/_plc)
 *            - C++: apps/iobus/fieldbus/modbus_master.cpp (drain_ext_writes)
 *          Trình tự bắt buộc: đọc seq với acquire → bỏ nếu LẺ → memcpy toàn bộ
 *          struct → đọc lại seq với acquire → nếu khác thì retry (có GIỚI HẠN
 *          số lần) → chỉ coi dữ liệu hợp lệ khi hai lần đọc seq bằng nhau VÀ
 *          magic đúng. Retry hết lượt = ĐỌC THẤT BẠI, và caller phải xử lý
 *          fail-safe (xem F-03: giữ dữ liệu cũ để lái annunciation là lỗi an
 *          toàn).
 *
 *          Consumer không muốn tự hiện thực seqlock thì dùng đường đi qua core
 *          (ReadPointSnapshot qua web IPC) — core đã đọc nhất quán sẵn.
 */
#ifndef MKDDC_SHM_H
#define MKDDC_SHM_H

#include <stdint.h>

/* Path runtime Rev A — KHÔNG có alias, KHÔNG còn /dev/shm/kinexus_* */
#define KX_SHM_IO_PATH    "/dev/shm/mkddc_io_shm"
#define KX_SHM_PLC_PATH   "/dev/shm/mkddc_plc_shm"
#define KX_SHM_MAGIC      0x4B584404u   /* "KXD\4" v4: UI raw live data + kx_reliability_t/ui_reliability[] */

#define KX_N_UI   16   /* v2: Rev A 16 UI analog (ADR-010) */
#define KX_N_DI   8    /* reserved: DI optional SKU; base SKU stays 0 in SHM */
#define KX_N_AO   4
#define KX_N_DO   4
#define KX_N_AV   32
#define KX_N_BV   16
#define KX_N_MSV  8
#define KX_N_EXT  256  /* điểm thiết bị phụ (Modbus RTU master) */

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

/* ============ Telemetry per-slave fieldbus (Modbus RTU master) ============
 * WRITER=iobus (fieldbus thread), READER=web. Ảnh chụp của FieldbusMetrics.
 *
 * uint64 đặt ĐẦU struct có chủ ý: giữ alignment 8 và làm layout xác định trên
 * cả x86-64 lẫn aarch64, không phụ thuộc padding do trình biên dịch chèn.
 * sizeof = 24 byte, không có padding ẩn.
 */
#define KX_N_FB_SLAVE  32   /* trần số slave publish được; vượt thì cắt và báo qua fb_slave_count */

typedef struct {
    uint64_t last_seen_ms;   /* mốc poll thành công gần nhất (CLOCK_MONOTONIC ms); 0 = chưa từng */
    uint32_t total_polls;    /* tổng lượt poll kể từ khi iobus khởi động */
    uint32_t total_errors;   /* tổng lượt lỗi; error rate = total_errors/total_polls */
    uint8_t  addr;           /* địa chỉ Modbus 1..247 */
    uint8_t  online;         /* 1 = slave đang online theo retry policy */
    uint8_t  _pad[6];
} kx_slave_metrics_t;

/* Chẩn đoán Modbus RTU nối thêm, giữ nguyên toàn bộ offset/stride cũ. */
typedef struct {
    uint32_t timeout_errors;
    uint32_t crc_errors;
    uint32_t retry_attempts;
    uint8_t  consecutive_errors;
    uint8_t  _pad[3];
} kx_modbus_diag_t;

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
    float    ui_raw[KX_N_UI];        /* raw electrical input before eng scale: V or mA; default 0.0 */
    uint8_t  ui_quality[KX_N_UI];    /* kx_quality_t; default BAD (chưa có mẫu)  */
    uint8_t  ui_reliability[KX_N_UI];/* kx_reliability_t per channel; default COMMUNICATION_FAILURE */
    char     ui_unit[KX_N_UI][8];    /* "degC","V","mA"... NUL-terminated   */
    char     ui_raw_unit[KX_N_UI][8];/* "V","mA" or "" when raw display is not applicable */

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

    /* ---- Northbound/southbound telemetry (WRITER=iobus) ----
     *
     * Vì sao tồn tại: trước 2026-07-31, trang Web `settings/network` phải tự
     * BỊA số liệu cho nửa dưới màn hình vì không có nguồn thật nào:
     *   - `bmsLink` được suy ra từ chỗ 3 field trong file config khác rỗng, nên
     *     báo "online" cả khi BACnet/IP chưa hề bind được socket (finding F-04);
     *   - error rate mỗi slave bị gán cứng 0 và poll state là MỘT giá trị toàn
     *     cục sao chép cho mọi dòng, nên một slave hỏng giữa nhiều slave là
     *     không thể nhìn thấy (finding F-03).
     * `FieldbusMetrics` (apps/iobus/fieldbus/fieldbus_metrics.hpp) đã đếm
     * đúng per-slave từ lâu nhưng chưa hề được publish ra khỏi iobus.
     *
     * NỐI VÀO CUỐI struct có chủ ý — KHÔNG đổi magic, đúng quy tắc đã ghi ở
     * kx_plc_shm_t: mọi offset cũ giữ nguyên và consumer dùng ngữ nghĩa
     * min-length (apps/web-api/internal/app/core_client.go), nên binary CŨ đọc SHM MỚI vẫn
     * đúng, và binary MỚI đọc SHM CŨ (528 byte) chỉ đơn giản là không thấy
     * phần này — consumer PHẢI kiểm độ dài trước khi đọc và coi "không có dữ
     * liệu" là KHÔNG BIẾT, tuyệt đối không quy thành 0/online.
     */
    uint16_t bacnet_udp_port;   /* cổng UDP BACnet/IP đang bind THẬT; 0 = chưa bind */
    uint8_t  bacnet_bound;      /* 1 = bip_init() thành công và socket đang mở       */
    uint8_t  fb_slave_count;    /* số phần tử hợp lệ trong fb_slave[]; 0 = chưa poll */
    uint32_t fb_publish_seq;    /* tăng mỗi lần publish; 0 = iobus chưa publish lần nào */
    kx_slave_metrics_t fb_slave[KX_N_FB_SLAVE];
    kx_modbus_diag_t modbus_diag[KX_N_FB_SLAVE]; /* timeout/retry/CRC per slave */
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

    /* ---- Runtime health (WRITER=core, ghi 1 lần lúc khởi động) ----
     *
     * Vì sao tồn tại: cảnh báo `rt.sched_fifo_fail (degraded)` chỉ được log
     * MỘT LẦN lúc khởi động rồi cuộn khỏi journal. Trên board lab, core đã
     * chạy nhiều ngày ở SCHED_OTHER thay vì SCHED_FIFO 80 mà không ai biết
     * (xem docs/07_records/test-evidence/fw-som/2026-07-28-watchdog-target.md).
     * Suy giảm im lặng phải quan sát được liên tục, không chỉ ở một dòng log.
     *
     * NỐI VÀO CUỐI struct có chủ ý — KHÔNG đổi magic:
     * mọi offset cũ giữ nguyên, và consumer dùng ngữ nghĩa min-length
     * (apps/web-api/internal/app/core_client.go: `len(data) < kxPlcShmMinLen`) nên binary cũ
     * đọc SHM mới vẫn đúng. Quy tắc bắt buộc cho lần sau: chỉ được NỐI THÊM
     * vào cuối; đổi thứ tự/kiểu/kích thước field cũ vẫn là ABI change và vẫn
     * phải đổi magic. */
    uint8_t  rt_sched_policy;    /* giá trị SCHED_* thật đo bằng sched_getscheduler() */
    uint8_t  rt_sched_priority;  /* ưu tiên RT thật đang chạy; 0 khi không phải RT   */
    uint8_t  rt_mlock_ok;        /* 1 = mlockall thành công                          */
    uint8_t  rt_degraded;        /* 1 = KHÔNG đạt cấu hình RT mong đợi -> cảnh báo   */
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
