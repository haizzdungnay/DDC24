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
/* v5 (MBR-B001, Đ-03): kx_ext_point_t đổi sang typed double + quality 5 mức +
 * quality_reason + sample timestamp. Đây là ABI change THẬT — stride của
 * plc_shm.ext[] đổi từ 40 lên 64 byte nên MỌI offset sau ext[] dịch chỗ.
 * Magic phải đổi để binary cũ FAIL RÕ thay vì đọc lệch trường trong im lặng. */
#define KX_SHM_MAGIC      0x4B584407u   /* "KXD\7" v7: plc_shm chở ext_cmd_seq (MBA-FW-08) */

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
#define KX_N_FB_BUS    4    /* trần số bus RS-485 publish được (Rev A dùng 2)   */

/* MBR-B110: counter là uint64. uint32 tràn sau ~4,29 tỷ lượt; một bus poll
 * 10 slave ở 200 ms sinh 50 lượt/s ⇒ tràn sau ~2,7 năm, ngắn hơn tuổi thọ một
 * tủ điều khiển. Khi tràn, counter tụt về 0 và mọi phép delta của FE/historian
 * cho ra số âm khổng lồ hoặc "vừa reset" — cả hai đều sai. */
typedef struct {
    uint64_t last_seen_ms;   /* mốc poll thành công gần nhất (CLOCK_MONOTONIC ms); 0 = chưa từng */
    uint64_t total_polls;    /* tổng lượt poll kể từ khi iobus khởi động */
    uint64_t total_errors;   /* tổng lượt lỗi; error rate = total_errors/total_polls */
    uint8_t  addr;           /* địa chỉ Modbus 1..247 */
    uint8_t  online;         /* 1 = slave đang online theo retry policy */
    uint8_t  bus_id;         /* bus vật lý 1..N; 0 = chưa xác định */
    uint8_t  _pad[5];
} kx_slave_metrics_t;

typedef struct {
    uint64_t timeout_errors;
    uint64_t crc_errors;
    uint64_t retry_attempts;
    uint64_t write_failed;
    uint64_t write_dropped;
    uint8_t  consecutive_errors;
    uint8_t  last_exception;  /* mã exception Modbus gần nhất; 0 = chưa gặp */
    uint8_t  _pad[6];
} kx_modbus_diag_t;

/* MBR-B305: số liệu THẬT của một sợi dây, đo bởi BusWorker.
 *
 * Trước bản này trang Overview lấy p50/p95/utilization từ hằng số viết cứng
 * trong handler Go — giao diện hiển thị số không do thiết bị nào sinh ra. Đó
 * đúng loại lỗi mà D-07 đã cấm ở tầng FE, chỉ là bị đẩy xuống một tầng.
 *
 * `state` là chuỗi ngắn (CLOSED/OPENING/RUNNING/PORT_ERROR/DRAINING/SWAPPING/
 * CONFIG_ERROR) chứ không phải enum số: consumer đọc thẳng ra UI mà không cần
 * bảng tra đồng bộ giữa ba ngôn ngữ. */
typedef struct {
    uint64_t total_transactions;
    uint64_t total_errors;
    uint64_t port_reopens;
    uint32_t latency_p50_us;
    uint32_t latency_p95_us;
    uint32_t latency_max_us;
    uint32_t baud;
    uint16_t utilization_pct_x100;  /* 0..10000 = 0..100,00 % */
    uint8_t  id;                    /* 1-based; 0 = slot chưa dùng */
    char     parity;
    uint8_t  stop_bits;
    uint8_t  _pad[3];
    char     name[16];
    char     device[32];
    char     state[16];
} kx_bus_metrics_t;

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

    /* ---- MBR-B110/B305: bus metrics + danh tính counter (WRITER=iobus) ----
     *
     * `producer_boot_id` đổi mỗi lần iobus khởi động lại. Consumer PHẢI so nó
     * giữa hai lần đọc trước khi tính delta: thiếu bước này, một lần restart
     * bị đọc thành "ai đó vừa reset counter bằng tay" (OD-MBRTU-008). */
    uint64_t producer_boot_id;
    uint64_t counters_since_ms;   /* mốc CLOCK_MONOTONIC ms counter bắt đầu đếm */
    uint8_t  fb_bus_count;        /* số phần tử hợp lệ trong fb_bus[] */
    uint8_t  _fb_bus_pad[7];
    kx_bus_metrics_t fb_bus[KX_N_FB_BUS];

    /* T59-702: khoảng cách lớn nhất giữa hai IO_RESP hợp lệ, đo bởi chính
     * poll loop IOP. Đơn vị microsecond giữ đủ độ phân giải quanh cổng 200 ms;
     * 0 = chưa có đủ hai phản hồi để đo. Nối cuối để reader cũ không lệch ABI. */
    uint32_t max_iop_poll_gap_us;

    /* ---- `ISS-PIO-11`/`F-PIO-008`: BẢN ĐỒ NĂNG LỰC BO (WRITER=iobus) ----
     *
     * Hợp đồng IOP đã có `BOARD_CAP_MAP` từ lâu (`iop_protocol.h`), `iobus` đọc
     * nó ở handshake để kiểm hai điều kiện rồi VỨT: `grep board_cap
     * contracts/shm/mkddc_shm.h` trước bản vá này ra 0 kết quả. Hệ quả: mọi
     * tầng trên phải VIẾT CỨNG số kênh — bốn nguồn sự thật cho cùng một dữ kiện
     * (`core_client.go`, `overview.go`, `points/catalog.go`, FE `utils.ts`) —
     * và `DS_MK-DDC-24_VI` §174 hứa "khi capability map xác nhận" trong khi cơ
     * chế đó không tồn tại.
     *
     * `board_cap_valid = 0` nghĩa là CHƯA HỎI ĐƯỢC (chưa handshake, hoặc MCU
     * chưa trả). Nó KHÔNG có nghĩa "bo không có năng lực nào" — consumer phải
     * coi đó là KHÔNG BIẾT và fail-closed, đúng nguyên tắc "thiếu bằng chứng
     * không phải bằng chứng".
     *
     * VÌ SAO BUMP MAGIC — và vì sao lý do KHÔNG PHẢI là "layout đổi":
     *
     * Hai field này rơi trọn vào phần padding đuôi đã có, nên `sizeof
     * (kx_io_shm_t)` GIỮ NGUYÊN 3576 và mọi offset cũ không nhúc nhích. Binary
     * cũ đọc SHM mới vẫn đúng; binary mới đọc SHM cũ đọc trúng padding đã được
     * `memset` về 0 lúc tạo, tức thấy `valid = 0`. Không có ca đọc lệch nào.
     *
     * Lý do thật nằm ở chỗ khác: KHÔNG CÓ MAGIC MỚI thì `valid = 0` có HAI
     * nghĩa không phân biệt được — "producer đời cũ không biết field này, và sẽ
     * không bao giờ điền" và "producer đời mới, chỉ là chưa handshake xong".
     * Một consumer chờ năng lực bo sẽ chờ mãi ở ca thứ nhất mà không có cách
     * nào biết. Magic v6 là câu trả lời cho "producer có nói thứ tiếng này
     * không"; `board_cap_valid` là câu trả lời cho "nó đã hỏi được chưa". Gộp
     * hai câu hỏi vào một field là cách một trong hai câu trả lời bị mất.
     *
     * Đúng tiền lệ v5 (Đ-03): consumer thấy magic cũ PHẢI từ chối. */
    uint16_t board_cap_map;     /* gương IOP_BOARD_CAP_* từ handshake; chỉ đọc khi board_cap_valid = 1 */
    uint8_t  board_cap_valid;   /* 1 = đã hỏi được MCU; 0 = CHƯA BIẾT (không phải "không có") */
    uint8_t  _board_cap_pad;
} kx_io_shm_t;

/* ============ ext_shm: fieldbus (Modbus RTU master) -> hệ thống ============
 *
 * CONTRACT v2 (MBR-B001, Đ-03 phê duyệt 2026-08-04). Ba thay đổi có chủ ý so
 * với v1, mỗi thay đổi vá một lỗi quan sát được chứ không phải làm đẹp:
 *
 * 1. `value`/`setpoint` từ `float` sang `double`. float32 có 24 bit mantissa
 *    nên MẤT CHÍNH XÁC NGUYÊN với mọi giá trị > 16.777.216. Thanh ghi
 *    uint32 của đồng hồ điện (kWh tích luỹ) vượt ngưỡng này sau vài tháng
 *    vận hành, và khi vượt thì số đọc bị làm tròn tới bội của 2 rồi 4 rồi 8 —
 *    một sai số câm, không có cờ lỗi nào, và historian ghi thẳng vào DB.
 * 2. `quality` mở rộng từ 3 lên 5 mức (`kx_ext_quality_t`). v1 gộp "chưa từng
 *    có mẫu", "thiết bị trả sai" và "cấu hình sai" vào cùng một `BAD`, nên
 *    người vận hành không phân biệt được lỗi đấu dây với lỗi khai báo.
 * 3. Thêm `sample_utc_ms`/`sample_mono_ns`: v1 không có mốc thời gian của
 *    MẪU, chỉ có `ts_ns` của cả snapshot, nên không tính được tuổi mẫu từng
 *    điểm và không phân biệt được STALE với GOOD.
 *
 * Đây là ABI change có kiểm soát: `KX_SHM_MAGIC` lên v5 và mọi consumer đọc
 * plc_shm phải nâng cùng gói (Đ-03). Consumer thấy magic cũ PHẢI từ chối, tuyệt
 * đối không "đọc tạm" theo layout đoán được.
 */

/* Quality của Point Modbus RTU — 5 mức, theo DATA_MODEL §6.2 (OD-MBRTU-016).
 * Giá trị 0/1/2 trùng số với kx_quality_t để đường map cũ (UNCERTAIN→STALE)
 * không đổi nghĩa khi nâng cấp; 3/4 là mức mới. */
typedef enum {
    KX_EXTQ_GOOD         = 0,  /* sample decode hợp lệ, còn trong hạn tươi     */
    KX_EXTQ_STALE        = 1,  /* mẫu quá hạn nhưng chưa tới ngưỡng offline    */
    KX_EXTQ_BAD          = 2,  /* decode lỗi / non-finite / exception response */
    KX_EXTQ_OFFLINE      = 3,  /* mất liên lạc thiết bị hoặc cổng down         */
    KX_EXTQ_CONFIG_ERROR = 4,  /* cấu hình không thực thi được — fail-closed   */
} kx_ext_quality_t;

/* Lý do quality khác GOOD — 10 mã theo DATA_MODEL §6.3. */
typedef enum {
    KX_EXTR_NONE             = 0,
    KX_EXTR_NOT_INITIALIZED  = 1,  /* chưa từng có mẫu thành công              */
    KX_EXTR_CONFIG_ERROR     = 2,  /* thiếu profile, hết slot, bus không mở    */
    KX_EXTR_DECODE_ERROR     = 3,  /* codec trả non-finite hoặc kiểu sai       */
    KX_EXTR_OUT_OF_RANGE     = 4,  /* ngoài min/max khai báo                   */
    KX_EXTR_TIMEOUT          = 5,
    KX_EXTR_CRC_ERROR        = 6,
    KX_EXTR_PORT_DOWN        = 7,  /* cổng serial lỗi (ENODEV/EIO)             */
    KX_EXTR_DEVICE_EXCEPTION = 8,  /* slave trả exception; xem exception_code  */
    KX_EXTR_WRITE_FAILED     = 9,
    KX_EXTR_BUS_OVERLOAD     = 10,
} kx_ext_quality_reason_t;

typedef struct {
    char     name[24];              /* point_id ổn định (v1 gọi là "name")     */
    double   value;                 /* engineering value sau scale/offset       */
    double   setpoint;              /* PLC/BMS đặt -> fieldbus ghi xuống        */
    int64_t  sample_utc_ms;         /* mốc SAMPLE thành công gần nhất; 0=chưa   */
    int64_t  sample_mono_ns;        /* cùng mốc trên CLOCK_MONOTONIC; 0=chưa    */
    uint8_t  quality;               /* kx_ext_quality_t                        */
    uint8_t  quality_reason;        /* kx_ext_quality_reason_t                 */
    uint8_t  exception_code;        /* Modbus exception 0x01..0x0B; 0 = không   */
    uint8_t  slave_addr;
    uint8_t  bus_id;                /* 1..N bus vật lý; 0 = chưa xác định       */
    uint8_t  online;                /* slave online?                            */
    uint8_t  writable;
    uint8_t  dirty;                 /* có setpoint cần ghi                      */
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
    /* MBA-FW-08: danh tính lệnh ghi EXT; 0 = chưa có lệnh. Core tăng khi có
     * intent mới, iobus chỉ đọc. Cờ dirty là cờ mức, không nhận diện lệnh.
     * Nối cuối để giữ mọi offset cũ; magic v7 chặn binary không tương thích. */
    uint32_t ext_cmd_seq[KX_N_EXT];
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
#define KX_EXT_SNAP_MAGIC  0x45585401u   /* "EXT\1" — v1, KHÔNG còn được phát  */

typedef struct {
    uint32_t magic;                      /* = KX_EXT_SNAP_MAGIC khi hợp lệ     */
    uint16_t count;                      /* số điểm hợp lệ trong points[]       */
    uint16_t _pad;
    kx_ext_point_t points[KX_N_EXT];    /* snapshot tại thời điểm poll xong    */
} kx_ext_snapshot_msg_t;

/* ============ Snapshot v2 (MBR-B001) — iobus fieldbus → core ============
 *
 * v1 chỉ mang `magic + count + points[]`. Consumer vì thế KHÔNG trả lời được
 * ba câu hỏi mà vận hành thật luôn cần:
 *
 *   - "Tôi có mất datagram nào không?"  → không có `sequence`.
 *   - "Ảnh này thuộc cấu hình nào?"     → không có `generation`/`config_revision`,
 *     nên sau một lần apply, slot index có thể đã đổi ý nghĩa mà consumer vẫn
 *     dùng ảnh cũ và gán giá trị của Point A cho Point B.
 *   - "Producer có vừa restart không?"  → không có `producer_boot_id`, nên
 *     counter tụt về 0 bị đọc thành "hệ thống vừa được reset thủ công".
 *
 * `sequence` đơn điệu tăng theo tiến trình producer; đứt quãng = mất gói.
 * `generation` tăng mỗi lần iobus SWAP sang cấu hình mới; consumer thấy
 * generation lạ phải coi toàn bộ slot mapping cũ là vô hiệu.
 * `config_revision`/`config_checksum` trỏ về đúng bản cấu hình BE đã apply,
 * cho phép FE nói "iobus đang chạy revision N" thay vì đoán.
 */
#define KX_EXT_SNAP_V2_MAGIC   0x45585402u   /* "EXT\2" */
#define KX_EXT_SNAP_SCHEMA_VER 2u
/* 23 hex đầu của SHA-256 + NUL. Đủ để phát hiện lệch cấu hình (2^92 tổ hợp),
 * không cần chở trọn 64 ký tự qua mỗi datagram. */
#define KX_EXT_CHECKSUM_LEN    24

typedef struct {
    char     point_id[24];          /* định danh ổn định xuyên generation      */
    double   value;
    int64_t  sample_mono_ns;        /* mốc sample thành công; 0 = chưa có mẫu  */
    int64_t  sample_utc_ms;
    uint8_t  quality;               /* kx_ext_quality_t                        */
    uint8_t  quality_reason;        /* kx_ext_quality_reason_t                 */
    uint8_t  exception_code;        /* Modbus exception gốc; 0 = không          */
    uint8_t  slave_addr;
    uint8_t  bus_id;                /* 1..N; 0 = chưa xác định                 */
    uint8_t  online;
    uint8_t  writable;
    uint8_t  _pad;
} kx_ext_sample_v2_t;

typedef struct {
    uint32_t magic;                 /* = KX_EXT_SNAP_V2_MAGIC                  */
    uint16_t schema_version;        /* = KX_EXT_SNAP_SCHEMA_VER; lệch ⇒ REJECT */
    uint16_t count;                 /* số phần tử hợp lệ trong samples[]        */
    uint64_t sequence;              /* đơn điệu tăng; đứt ⇒ mất datagram        */
    uint64_t generation;            /* generation cấu hình đang chạy            */
    uint64_t config_revision;       /* revision BE đã apply                     */
    uint64_t producer_boot_id;      /* đổi mỗi lần iobus khởi động lại          */
    uint64_t publish_mono_ns;       /* mốc publish của chính snapshot này        */
    char     config_checksum[KX_EXT_CHECKSUM_LEN];
    kx_ext_sample_v2_t samples[KX_N_EXT];
} kx_ext_snapshot_v2_t;

#endif /* MKDDC_SHM_H */
