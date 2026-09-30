/**
 * @file    iop_protocol_v3_DRAFT.h
 * @brief   Kinexus-IOP v3.0 — BẢN NHÁP hợp đồng byte SOM (master) <-> MCU (slave).
 *
 * @warning BẢN NHÁP (DRAFT) — chưa phải contract chính thức.
 *          Đi cùng ICD `IOP-SPEC-MK-DDC-24-VI` v3.0 (docs/01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md).
 *          Khi ICD được hai team ký, nội dung file này trở thành
 *          `contracts/iop/iop_protocol.h` v3.0 (cùng một thay đổi với phía SOM).
 *          Trước lúc đó, `contracts/iop/iop_protocol.h` v2.0 vẫn là thứ SOM đang chạy.
 *
 * @note    Quan hệ thẩm quyền: file này giữ BYTE và HẰNG SỐ; ICD giữ HÀNH VI.
 *          Mâu thuẫn về byte → sửa ICD theo file này; về hành vi → ICD thắng.
 *          Không sao chép hằng số sang nơi khác — include file này.
 *
 * @note    v3.0 là BREAKING so với v2.0 (SET_AO 8 → 16 byte, HANDSHAKE_RESP 8 → 12 byte).
 *          Mảng AO/DO trên dây luôn có đủ IOP_MAX_AO / IOP_MAX_DO phần tử; số kênh
 *          thực lắp do MCU khai trong HANDSHAKE_RESP (N_UI, N_AO, N_DO, N_DI).
 *          Một định dạng phục vụ cả bo 16 UI / 4 AO / 4 DO và 16 UI / 8 AO / 8 DO.
 *
 * Biên dịch được với C99 trở lên và C++11 trở lên; không phụ thuộc HAL/OS.
 */
#ifndef MKDDC_IOP_PROTOCOL_V3_H
#define MKDDC_IOP_PROTOCOL_V3_H

#include <stdint.h>

/* ===================================================================== */
/* Phiên bản                                                              */
/* ===================================================================== */
#define IOP_VER_MAJOR        3u
#define IOP_VER_MINOR        0u
#define IOP_VERSION_U16      ((uint16_t)((IOP_VER_MAJOR << 8) | IOP_VER_MINOR))   /* 0x0300 */

/* ===================================================================== */
/* Khung: SOF | LEN | CMD | SEQ | PAYLOAD[LEN] | CRC_HI | CRC_LO           */
/* ===================================================================== */
#define IOP_SOF              0xAAu
#define IOP_HDR_LEN          4u
#define IOP_CRC_LEN          2u      /* CRC-16/MODBUS, HI truyền trước LO */
#define IOP_MAX_PAYLOAD      252u
#define IOP_MAX_FRAME        (IOP_HDR_LEN + IOP_MAX_PAYLOAD + IOP_CRC_LEN)   /* 258 */
#define IOP_MIN_FRAME        (IOP_HDR_LEN + IOP_CRC_LEN)                     /* 6   */

/* ===================================================================== */
/* Số kênh tối đa trên dây (số thực lắp khai trong HANDSHAKE_RESP)        */
/* ===================================================================== */
#define IOP_MAX_UI           16u
#define IOP_MAX_AO           8u
#define IOP_MAX_DO           8u
#define IOP_MAX_DI           8u      /* trần mã hóa dự phòng; Rev A PHẢI khai N_DI = 0 */

/* ===================================================================== */
/* UART và thời gian (ICD §3, §9)                                          */
/* ===================================================================== */
#define IOP_BAUD                     921600u
#define IOP_BAUD_TOL_PERMILLE        15u     /* ±1,5 % mỗi bên                        */
#define IOP_TX_INTERBYTE_MAX_US      500u    /* bên gửi: khoảng trống giữa hai byte   */
#define IOP_RX_INTERBYTE_ABORT_US    1000u   /* bên nhận: bỏ frame dở khi vượt        */

#define IOP_GET_IO_PERIOD_MS         2u      /* SOM poll 500 Hz                        */
#define IOP_RESP_TIMEOUT_MS          3u      /* SOM chờ response                       */
#define IOP_MAX_RETRY                3u      /* SOM retry, gửi lại đúng byte cũ        */
#define IOP_FAULT_TIMEOUT_MS         20u     /* SOM: liên kết suy giảm; KHÔNG RESET_IO */
#define IOP_SAFE_TIMEOUT_MS          200u    /* MCU: vào COMM_SAFE                     */
#define IOP_SAFE_WINDOW_MAX_MS       205u    /* MCU: hạn trên cửa sổ vào safe          */
#define IOP_CORE_DEAD_MS             500u    /* SOM: core im lặng → RESET_IO(CORE_WDG) */
#define IOP_REASSERT_PERIOD_MS       1000u   /* SOM: gửi lại output + GET_STATE        */
#define IOP_HANDSHAKE_TIMEOUT_MS     1000u
#define IOP_RECONNECT_PERIOD_MS      5000u
#define IOP_TURN_P999_US             500u    /* MCU: T_turn p99,9                      */
#define IOP_TURN_MAX_US              1000u   /* MCU: T_turn tối đa                     */
#define IOP_SETTLING_MAX_MS          100u    /* MCU: SETTLING tắt sau SET_UI_CFG       */
#define IOP_BOOT_READY_MS            500u    /* MCU: trả lời được sau khi nhả reset    */
#define IOP_NRESET_PULSE_MIN_MS      1u      /* SOM: độ rộng xung nRESET tối thiểu     */

/* ===================================================================== */
/* Mã lệnh                                                                */
/* ===================================================================== */
typedef enum {
    CMD_GET_IO         = 0x01u,
    CMD_IO_RESP        = 0x02u,
    CMD_SET_AO         = 0x10u,
    CMD_SET_DO         = 0x11u,
    CMD_ACK            = 0x12u,
    CMD_SET_AO_CFG     = 0x13u,
    CMD_SET_UI_CFG     = 0x14u,
    CMD_SET_SAFE_CFG   = 0x15u,
    CMD_GET_DIAG       = 0x20u,
    CMD_DIAG_RESP      = 0x21u,
    CMD_GET_STATE      = 0x22u,
    CMD_STATE_RESP     = 0x23u,
    CMD_HANDSHAKE      = 0x30u,
    CMD_HANDSHAKE_RESP = 0x31u,
    CMD_RESET_IO       = 0x40u,
    CMD_NACK           = 0xFEu
} iop_cmd_t;

/* ---- LEN cố định theo CMD ---- */
#define IOP_GET_IO_LEN          0u
#define IOP_IO_RESP_LEN         74u
#define IOP_SET_AO_LEN          16u   /* 8 × uint16                              */
#define IOP_SET_DO_LEN          2u
#define IOP_ACK_LEN             1u
#define IOP_SET_AO_CFG_LEN      1u
#define IOP_SET_UI_CFG_LEN      16u   /* 16 × uint8 mode                          */
#define IOP_SET_SAFE_CFG_LEN    17u   /* 8 × uint16 AO safe + 1 byte DO safe mask */
#define IOP_GET_DIAG_LEN        0u
#define IOP_DIAG_RESP_LEN       20u
#define IOP_GET_STATE_LEN       0u
#define IOP_STATE_RESP_LEN      32u
#define IOP_HANDSHAKE_LEN       4u
#define IOP_HANDSHAKE_RESP_LEN  12u
#define IOP_RESET_IO_LEN        1u
#define IOP_NACK_LEN            2u

/* ===================================================================== */
/* NACK                                                                   */
/* ===================================================================== */
typedef enum {
    ERR_UNKNOWN_CMD       = 0x01u,
    ERR_BAD_LEN           = 0x02u,
    ERR_CRC_FAIL          = 0x03u,
    ERR_BUSY              = 0x04u,   /* không dùng trong Rev A */
    ERR_SAFE_STATE        = 0x05u,
    ERR_VERSION_INCOMPAT  = 0x06u,
    ERR_HW_FAULT          = 0x07u,
    ERR_NO_SESSION        = 0x08u,
    ERR_BAD_VALUE         = 0x09u
} iop_err_t;

/* ===================================================================== */
/* HANDSHAKE (SOM → MCU, 4 byte)                                          */
/*   [0..1] SOM_IOP_VERSION  [2..3] SOM_CAPABILITIES                       */
/* ===================================================================== */
#define IOP_CAP_DIAG          (1u << 0)
#define IOP_CAP_RESET_IO      (1u << 1)

/* ===================================================================== */
/* HANDSHAKE_RESP (MCU → SOM, 12 byte)                                    */
/* ===================================================================== */
#define IOP_HSR_OFF_IOP_VER       0u    /* uint16 BE */
#define IOP_HSR_OFF_FW_VER        2u    /* uint16 BE */
#define IOP_HSR_OFF_STATUS        4u    /* uint8     */
#define IOP_HSR_OFF_RSV           5u    /* 0         */
#define IOP_HSR_OFF_FEATURES      6u    /* uint16 BE */
#define IOP_HSR_OFF_N_UI          8u    /* uint8     */
#define IOP_HSR_OFF_N_AO          9u    /* uint8     */
#define IOP_HSR_OFF_N_DO          10u   /* uint8     */
#define IOP_HSR_OFF_N_DI          11u   /* uint8     */

#define IOP_HS_STATUS_OK          0x00u  /* cùng major, cùng minor */
#define IOP_HS_STATUS_WARN        0x01u  /* cùng major, khác minor */
#define IOP_HS_STATUS_INCOMPAT    0x02u  /* khác major             */

/* BOARD_FEATURES — tính năng phần cứng không phải số kênh */
#define IOP_FEAT_RTD              (1u << 0)  /* mạch PT100/PT1000 có lắp (Rev A: 0)      */
#define IOP_FEAT_DO_FB            (1u << 1)  /* relay có mạch đọc trạng thái thật        */

/* ===================================================================== */
/* IO_RESP (MCU → SOM, 74 byte)                                           */
/* ===================================================================== */
#define IOP_IOR_OFF_UI_RAW        0u    /* int32 BE × 16                      */
#define IOP_IOR_OFF_ADC1_STAT     64u
#define IOP_IOR_OFF_ADC2_STAT     65u
#define IOP_IOR_OFF_MCU_TEMP      66u   /* int16 BE, 0,1 °C                   */
#define IOP_IOR_OFF_FAULT         68u   /* uint16 BE                          */
#define IOP_IOR_OFF_SAMPLE_CNT    70u   /* uint16 BE                          */
#define IOP_IOR_OFF_DO_FB         72u   /* uint8, bit i = DO(i+1)             */
#define IOP_IOR_OFF_MCU_STATE     73u   /* uint8, IOP_MST_*                   */

/* ADC1_STAT / ADC2_STAT */
#define IOP_ADC_STAT_DRDY_OK       (1u << 0)
#define IOP_ADC_STAT_LOCK          (1u << 1)
#define IOP_ADC_STAT_CRC_FAULT     (1u << 2)
#define IOP_ADC_STAT_DRDY_TIMEOUT  (1u << 3)
#define IOP_ADC_STAT_SPI_TIMEOUT   (1u << 4)
#define IOP_ADC_STAT_SETTLING      (1u << 5)

/* FAULT_FLAGS (uint16) */
#define IOP_FAULT_ADC1             (1u << 0)
#define IOP_FAULT_ADC2             (1u << 1)
#define IOP_FAULT_DAC              (1u << 2)   /* bất kỳ DAC nào ghi thất bại        */
#define IOP_FAULT_UI_OV            (1u << 3)   /* |UI_RAW| >= IOP_UI_OV_THRESHOLD    */
#define IOP_FAULT_RELAY_STUCK      (1u << 4)   /* chỉ khi IOP_FEAT_DO_FB             */
#define IOP_FAULT_WDG_RESET        (1u << 5)   /* sticky, xoá khi nhận GET_DIAG      */
#define IOP_FAULT_MCU_OVERTEMP     (1u << 6)
#define IOP_FAULT_VDD              (1u << 7)
#define IOP_UI_OV_THRESHOLD        8136950L    /* 97 % dải ADC 24 bit                */

/* MCU_STATE */
#define IOP_MST_SESSION            (1u << 0)
#define IOP_MST_SAFE_ACTIVE        (1u << 1)
#define IOP_MST_CFG_VALID          (1u << 2)
#define IOP_MST_FRESH_BOOT         (1u << 3)
#define IOP_MST_OUTPUT_MISMATCH    (1u << 4)

/* ===================================================================== */
/* SET_AO (16 byte): AO1..AO8, uint16 BE. Kênh >= N_AO PHẢI = 0.           */
/*   0-10 V : V  = raw / 65535 * 10                                        */
/*   4-20 mA: mA = 4 + raw / 65535 * 16                                    */
/* SET_DO (2 byte): [0] MASK [1] VALUE, bit i = DO(i+1); bit >= N_DO = 0.  */
/* SET_AO_CFG (1 byte): bit i = mode AO(i+1): 0 = 0-10 V, 1 = 4-20 mA.     */
/* ===================================================================== */
#define IOP_AO_SAFE_RAW_DEFAULT    0u          /* 0 V hoặc 4 mA */

/* SET_UI_CFG (16 byte): mode mỗi UI */
typedef enum {
    IOP_UI_MODE_DISABLED    = 0u,
    IOP_UI_MODE_VOLTAGE_10V = 1u,
    IOP_UI_MODE_CURRENT_MA  = 2u,
    IOP_UI_MODE_NTC         = 3u,
    IOP_UI_MODE_DRY_CONTACT = 4u
} iop_ui_mode_t;
#define IOP_UI_MODE_MAX            4u

/* SET_SAFE_CFG (17 byte) */
#define IOP_SAFE_OFF_AO_RAW        0u    /* uint16 BE × 8   */
#define IOP_SAFE_OFF_DO_MASK       16u   /* uint8           */

/* ===================================================================== */
/* DIAG_RESP (20 byte)                                                    */
/* ===================================================================== */
#define IOP_DGR_OFF_FW_VER         0u
#define IOP_DGR_OFF_UPTIME_S       2u
#define IOP_DGR_OFF_RX_CNT         4u
#define IOP_DGR_OFF_CRC_ERR        6u
#define IOP_DGR_OFF_SEQ_ERR        8u
#define IOP_DGR_OFF_WDG_RESET_CNT  10u
#define IOP_DGR_OFF_ADC_RATE       12u
#define IOP_DGR_OFF_TEMP_MAX       14u
#define IOP_DGR_OFF_VDD_MV         16u
#define IOP_DGR_OFF_RSV            18u

/* ===================================================================== */
/* STATE_RESP (32 byte)                                                   */
/* ===================================================================== */
#define IOP_STR_OFF_MCU_STATE      0u
#define IOP_STR_OFF_SAFE_REASON    1u
#define IOP_STR_OFF_RESET_CAUSE    2u
#define IOP_STR_OFF_RSV            3u
#define IOP_STR_OFF_SAFE_CNT       4u    /* uint16 BE, bão hòa        */
#define IOP_STR_OFF_RX_AGE_MS      6u    /* uint16 BE, bão hòa 65535  */
#define IOP_STR_OFF_MAX_GAP_MS     8u    /* uint16 BE, bão hòa        */
#define IOP_STR_OFF_CFG_DIGEST     10u   /* uint32 BE                 */
#define IOP_STR_OFF_AO_RAW         14u   /* uint16 BE × 8             */
#define IOP_STR_OFF_DO_MASK        30u   /* uint8                     */
#define IOP_STR_OFF_AO_MODE        31u   /* uint8                     */

typedef enum {
    IOP_SAFE_REASON_NONE          = 0u,
    IOP_SAFE_REASON_BOOT          = 1u,
    IOP_SAFE_REASON_COMM_TIMEOUT  = 2u,
    IOP_SAFE_REASON_RESET_IO      = 3u,
    IOP_SAFE_REASON_HANDSHAKE     = 4u,
    IOP_SAFE_REASON_VDD           = 5u,
    IOP_SAFE_REASON_SELF_TEST     = 6u,
    IOP_SAFE_REASON_HW_FAULT      = 7u,
    IOP_SAFE_REASON_CONFIG_CHANGE = 8u
} iop_safe_reason_t;

/* Nhiều cờ cùng bật → chọn giá trị NHỎ NHẤT khác 0 */
typedef enum {
    IOP_RESET_CAUSE_UNKNOWN  = 0u,
    IOP_RESET_CAUSE_IWDG     = 1u,
    IOP_RESET_CAUSE_WWDG     = 2u,
    IOP_RESET_CAUSE_SOFTWARE = 3u,
    IOP_RESET_CAUSE_LOWPOWER = 4u,
    IOP_RESET_CAUSE_OBL      = 5u,
    IOP_RESET_CAUSE_POWER    = 6u,
    IOP_RESET_CAUSE_PIN      = 7u
} iop_reset_cause_t;

/* ===================================================================== */
/* RESET_IO (1 byte): reason                                              */
/* ===================================================================== */
#define IOP_RESET_REASON_NORMAL       0x00u
#define IOP_RESET_REASON_CORE_WDG     0x01u
#define IOP_RESET_REASON_BMS_TIMEOUT  0x02u   /* dự phòng, Rev A chưa dùng           */
#define IOP_RESET_REASON_OPERATOR     0x03u
#define IOP_RESET_REASON_OTA          0x04u   /* Rev B                               */
#define IOP_RESET_REASON_IOP_FAULT    0x05u   /* SOM v3 không gửi; MCU vẫn chấp nhận */

/* ===================================================================== */
/* CFG_DIGEST: CRC-32/ISO-HDLC trên 34 byte                               */
/*   UI_MODE[16] || AO_MODE_MASK[1] || SET_SAFE_CFG payload[17]           */
/* ===================================================================== */
#define IOP_CFG_DIGEST_DATA_LEN    (IOP_MAX_UI + IOP_SET_AO_CFG_LEN + IOP_SET_SAFE_CFG_LEN)   /* 34 */

/* ===================================================================== */
/* Hàm tiện ích                                                           */
/* ===================================================================== */

/* CRC-16/MODBUS: poly 0xA001 (phản xạ), init 0xFFFF. Trong frame: HI trước. */
static inline uint16_t iop_crc16(const uint8_t *d, uint16_t n)
{
    uint16_t crc = 0xFFFFu;
    for (uint16_t i = 0u; i < n; i++) {
        crc ^= (uint16_t)d[i];
        for (uint8_t b = 0u; b < 8u; b++)
            crc = (crc & 1u) ? (uint16_t)((crc >> 1) ^ 0xA001u) : (uint16_t)(crc >> 1);
    }
    return crc;
}

/* CRC-32/ISO-HDLC (như zlib.crc32): poly 0xEDB88320 (phản xạ), init/xorout 0xFFFFFFFF. */
static inline uint32_t iop_crc32(const uint8_t *d, uint16_t n)
{
    uint32_t crc = 0xFFFFFFFFu;
    for (uint16_t i = 0u; i < n; i++) {
        crc ^= (uint32_t)d[i];
        for (uint8_t b = 0u; b < 8u; b++)
            crc = (crc & 1u) ? ((crc >> 1) ^ 0xEDB88320u) : (crc >> 1);
    }
    return crc ^ 0xFFFFFFFFu;
}

static inline uint16_t iop_be16(const uint8_t *p)
{
    return (uint16_t)(((uint16_t)p[0] << 8) | p[1]);
}

static inline int32_t iop_be32s(const uint8_t *p)
{
    return (int32_t)(((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
                     ((uint32_t)p[2] << 8)  |  (uint32_t)p[3]);
}

static inline void iop_put_be16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v >> 8);
    p[1] = (uint8_t)v;
}

static inline void iop_put_be32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v >> 24);
    p[1] = (uint8_t)(v >> 16);
    p[2] = (uint8_t)(v >> 8);
    p[3] = (uint8_t)v;
}

/* Mặt nạ các kênh thực lắp, ví dụ N_DO = 4 → 0x0F, N_DO = 8 → 0xFF. */
static inline uint8_t iop_populated_mask(uint8_t n)
{
    return (n >= 8u) ? (uint8_t)0xFFu : (uint8_t)((1u << n) - 1u);
}

/* ===================================================================== */
/* Kiểm tĩnh                                                              */
/* ===================================================================== */
#if defined(__cplusplus) && (__cplusplus >= 201103L)
#define IOP_STATIC_ASSERT(c, m) static_assert((c), m)
#elif defined(__STDC_VERSION__) && (__STDC_VERSION__ >= 201112L)
#define IOP_STATIC_ASSERT(c, m) _Static_assert((c), m)
#else
/* C99: mảng kích thước âm làm biên dịch lỗi khi điều kiện sai. */
#define IOP_SA_CAT_(a, b) a##b
#define IOP_SA_CAT(a, b)  IOP_SA_CAT_(a, b)
#define IOP_STATIC_ASSERT(c, m) typedef char IOP_SA_CAT(iop_static_assert_line_, __LINE__)[(c) ? 1 : -1]
#endif

IOP_STATIC_ASSERT(IOP_SET_AO_LEN == 2u * IOP_MAX_AO, "SET_AO phai co du IOP_MAX_AO kenh");
IOP_STATIC_ASSERT(IOP_SET_SAFE_CFG_LEN == 2u * IOP_MAX_AO + 1u, "SET_SAFE_CFG = AO safe + DO mask");
IOP_STATIC_ASSERT(IOP_SET_UI_CFG_LEN == IOP_MAX_UI, "SET_UI_CFG = 1 byte moi UI");
IOP_STATIC_ASSERT(IOP_IO_RESP_LEN == 4u * IOP_MAX_UI + 10u, "IO_RESP = 16 x int32 + 10 byte");
IOP_STATIC_ASSERT(IOP_STR_OFF_AO_MODE + 1u == IOP_STATE_RESP_LEN, "STATE_RESP layout");
IOP_STATIC_ASSERT(IOP_HSR_OFF_N_DI + 1u == IOP_HANDSHAKE_RESP_LEN, "HANDSHAKE_RESP layout");
IOP_STATIC_ASSERT(IOP_CFG_DIGEST_DATA_LEN == 34u, "CFG_DIGEST tren 34 byte");
IOP_STATIC_ASSERT(IOP_MAX_DO <= 8u && IOP_MAX_AO <= 8u, "mask DO/AO mode la 1 byte");

#endif /* MKDDC_IOP_PROTOCOL_V3_H */
