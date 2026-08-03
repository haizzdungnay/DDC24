/**
 * @file    iop_protocol.h
 * @brief   MKDDC-IOP — HỢP ĐỒNG giao thức SOM(master) <-> MCU(slave).
 *          FW (STM32) và BE (mkddc-iobus) PHẢI include CHUNG file này.
 *
 * @note    NGUỒN-CHUẨN CUỐI CÙNG (ADR-010 — 2026-06-25):
 *          file này THẮNG mọi tài liệu (spec/guide) khi có mâu thuẫn về
 *          opcode, payload layout, enum, FAULT bit, RESET reason, hằng số timing.
 *          Docs chỉ là diễn giải; docs lệch header → sửa docs.
 *
 * @note    Đổi file này = đổi hợp đồng: bump IOP_VER_*, cập nhật cả 2 phía,
 *          chạy lại cross-test CRC/parse, cập nhật ADR-010.
 *          KHÔNG fork/sửa 1 bên.
 *
 * @version 2.0  (BREAKING — xem ADR-010)
 *          Thay đổi so với v1.1:
 *          - IO_RESP: 8×uint24(34B) → 16×int32(74B); thêm ADC1_STAT, ADC2_STAT,
 *            DO_FB_MASK; bỏ DI_MASK (base SKU không có DI)
 *          - FAULT_FLAGS: restructured — thêm ADC2_FAULT (bit1), shift DAC→bit2,
 *            UI_OV→bit3, RELAY_STUCK→bit4, WDG_RESET→bit5, OVERTEMP→bit6, VDD→bit7
 *          - HANDSHAKE_RESP: 6B → 8B; thêm BOARD_CAP_MAP[6..7]
 *          - Helper mới: iop_be32s() cho signed int32 BE
 */
#ifndef MKDDC_IOP_PROTOCOL_H
#define MKDDC_IOP_PROTOCOL_H

#include <stdint.h>

/* ---- Version (đàm phán khi HANDSHAKE) ---- */
#define IOP_VER_MAJOR        2u
#define IOP_VER_MINOR        0u

/* ---- Khung (frame): SOF | LEN | CMD | SEQ | PAYLOAD[LEN] | CRC_HI | CRC_LO ---- */
#define IOP_SOF              0xAAu
#define IOP_HDR_LEN          4u      /* SOF + LEN + CMD + SEQ            */
#define IOP_CRC_LEN          2u      /* CRC-16/Modbus, big-endian (HI trước) */
#define IOP_MAX_PAYLOAD      252u
#define IOP_MAX_FRAME        (IOP_HDR_LEN + IOP_MAX_PAYLOAD + IOP_CRC_LEN) /* 258 */
#define IOP_MIN_FRAME        (IOP_HDR_LEN + IOP_CRC_LEN)                   /* 6   */

/* ---- UART / timing (SOM master trừ khi ghi rõ MCU) ---- */
/* Tính toán (921600 baud, 8N1 = 92160 B/s):
 *   GET_IO frame  =  6 B → 0.065 ms wire
 *   IO_RESP frame = 80 B → 0.868 ms wire  →  round-trip TX = 0.933 ms
 *   MCU processing (SPI DMA 2× ADS131M08 + frame build) ≈ 0.5 ms
 *   Expected latency ≈ 1.4 ms → period 2 ms để 30% margin */
#define IOP_BAUD                  921600u
#define IOP_GET_IO_PERIOD_MS      2u     /* SOM poll 500 Hz (ADR-010 rev, was 10 ms) */
#define IOP_RESP_TIMEOUT_MS       3u     /* wire+MCU ≈1.4ms; 3ms = 2× margin        */
#define IOP_MAX_RETRY             3u     /* SOM retry / lệnh trước khi coi là fail  */
#define IOP_FAULT_TIMEOUT_MS      20u    /* 10 × poll period: 10 lần liên tiếp miss  */
#define IOP_RECONNECT_PERIOD_MS   5000u  /* SOM gửi lại HANDSHAKE mỗi 5s khi fault  */
#define IOP_HANDSHAKE_TIMEOUT_MS  1000u  /* SOM chờ HANDSHAKE_RESP                  */
#define IOP_SAFE_TIMEOUT_MS       200u   /* MCU không nhận GET_IO -> safe-state      */

/* ---- Command codes ---- */
typedef enum {
    CMD_GET_IO         = 0x01u,
    CMD_IO_RESP        = 0x02u,
    CMD_SET_AO         = 0x10u,
    CMD_SET_DO         = 0x11u,
    CMD_ACK            = 0x12u,
    CMD_SET_AO_CFG     = 0x13u,   /* chọn mode AO (0-10V/4-20mA) per channel   */
    CMD_GET_DIAG       = 0x20u,
    CMD_DIAG_RESP      = 0x21u,
    CMD_HANDSHAKE      = 0x30u,
    CMD_HANDSHAKE_RESP = 0x31u,
    CMD_RESET_IO       = 0x40u,
    CMD_NACK           = 0xFEu
} iop_cmd_t;

/* ---- Payload length cố định theo CMD (LEN field phải đúng giá trị này) ---- */
#define IOP_GET_IO_LEN          0u
#define IOP_IO_RESP_LEN         74u   /* v2: 16×int32 + adc_stat×2 + meta (ADR-010) */
#define IOP_SET_AO_LEN          8u
#define IOP_SET_DO_LEN          2u
#define IOP_ACK_LEN             1u
#define IOP_SET_AO_CFG_LEN      1u
#define IOP_GET_DIAG_LEN        0u
#define IOP_DIAG_RESP_LEN       20u
#define IOP_HANDSHAKE_LEN       4u
#define IOP_HANDSHAKE_RESP_LEN  8u    /* v2: tăng từ 6 → 8, thêm BOARD_CAP_MAP  */
#define IOP_RESET_IO_LEN        1u
#define IOP_NACK_LEN            2u

/* ---- NACK error codes ---- */
typedef enum {
    ERR_UNKNOWN_CMD       = 0x01u,
    ERR_BAD_LEN           = 0x02u,
    ERR_CRC_FAIL          = 0x03u,
    ERR_BUSY              = 0x04u,
    ERR_SAFE_STATE        = 0x05u,
    ERR_VERSION_INCOMPAT  = 0x06u
} iop_err_t;

/* ---- HANDSHAKE: SOM_CAPABILITIES bit ---- */
#define IOP_CAP_DIAG          (1u << 0)  /* SOM hỗ trợ GET_DIAG       */
#define IOP_CAP_RESET_IO      (1u << 1)  /* SOM có thể gửi RESET_IO   */

/* ---- HANDSHAKE_RESP status ---- */
#define IOP_HS_STATUS_OK      0x00u
#define IOP_HS_STATUS_WARN    0x01u      /* version mismatch, vẫn chạy */
#define IOP_HS_STATUS_INCOMPAT 0x02u     /* SOM phải abort             */

/* ---- BOARD_CAP_MAP (HANDSHAKE_RESP byte [6..7]) ---- */
#define IOP_BOARD_CAP_UI_16   (1u << 0)  /* 16 UI analog (2× ADS131M08)          */
#define IOP_BOARD_CAP_DI_8    (1u << 1)  /* 8 DI industrial (optional SKU module) */
#define IOP_BOARD_CAP_DO_4    (1u << 2)  /* 4 DO relay                            */
#define IOP_BOARD_CAP_AO_4    (1u << 3)  /* 4 AO (DAC8554)                        */
#define IOP_BOARD_CAP_RTD     (1u << 4)  /* PT100/PT1000 circuit populated         */
/* Rev A base SKU: UI_16 | DO_4 | AO_4 = 0x000D */
#define IOP_BOARD_CAP_REV_A   (IOP_BOARD_CAP_UI_16 | IOP_BOARD_CAP_DO_4 | IOP_BOARD_CAP_AO_4)

/* ====== RESET_IO (0x40) reason — bảng CHUẨN duy nhất ======
 * MCU hành vi GIỐNG NHAU cho mọi reason: AO→safe (theo mode), DO→open,
 * ghi fault log kèm reason, trả ACK(0x40). Reason chỉ phục vụ log/alarm. */
#define IOP_RESET_REASON_NORMAL       0x00u
#define IOP_RESET_REASON_CORE_WDG     0x01u
#define IOP_RESET_REASON_BMS_TIMEOUT  0x02u
#define IOP_RESET_REASON_OPERATOR     0x03u
#define IOP_RESET_REASON_OTA          0x04u
#define IOP_RESET_REASON_IOP_FAULT    0x05u

/* ---- AO safe raw (DAC8554 16-bit) ---- */
#define IOP_AO_SAFE_VOLT_RAW      0u      /* 0V  (mode 0-10V)            */
#define IOP_AO_SAFE_CURR_RAW      0u      /* 4mA (mode 4-20mA): raw 0 = 4mA */

/* ====== Payload IO_RESP v2 (74 byte) — đọc bằng byte offset, big-endian ======
 * [0..63]  UI_RAW[16]   : 16 × int32 BE (ADS131M08 s24 sign-extended to int32)
 * [64]     ADC1_STAT    : uint8 — chip status ADS131M08 #1 (ch1-8)  (IOP_ADC_STAT_*)
 * [65]     ADC2_STAT    : uint8 — chip status ADS131M08 #2 (ch9-16) (IOP_ADC_STAT_*)
 * [66..67] MCU_TEMP     : int16 BE, đơn vị 0.1°C
 * [68..69] FAULT_FLAGS  : uint16 BE (xem IOP_FAULT_* v2 bên dưới)
 * [70..71] SAMPLE_CNT   : uint16 BE (wrap)
 * [72]     DO_FB_MASK   : uint8 — bit0..3 = DO1..DO4 relay feedback
 * [73]     reserved     : 0x00
 * Không có DI_MASK — base SKU Rev A không có DI (ADR-010)
 */

/* ---- ADC_STAT bits (áp dụng cho cả ADC1_STAT và ADC2_STAT) ---- */
#define IOP_ADC_STAT_DRDY_OK    (1u << 0)  /* DRDY pulse nhận trong cửa sổ mẫu gần nhất */
#define IOP_ADC_STAT_LOCK       (1u << 1)  /* ADS131 LOCK bit — SPI communication error  */
#define IOP_ADC_STAT_CRC_FAULT  (1u << 2)  /* ADS131 REGMAP_CRC_ERR                      */

/* ====== FAULT_FLAGS v2 bit — bảng CHUẨN duy nhất (ADR-010) ======
 * BREAKING CHANGE so với v1: ADC2_FAULT mới ở bit1; DAC/UI_OV/RELAY/WDG/OVERTEMP/VDD shift +1 bit.
 *
 * bit | tên              | set khi                                   | clear khi             | sticky
 * 0   | ADC1_FAULT       | ADS131M08 #1 không có mẫu hợp lệ 100ms   | reinit OK + mẫu hợp lệ | không
 * 1   | ADC2_FAULT       | ADS131M08 #2 không có mẫu hợp lệ 100ms   | reinit OK + mẫu hợp lệ | không
 * 2   | DAC_FAULT        | DAC8554 không phản hồi SPI                | ghi DAC thành công     | không
 * 3   | UI_OV            | bất kỳ UI > 110% full scale               | mọi UI ≤ 110% FS       | không
 * 4   | RELAY_STUCK      | DO feedback ≠ lệnh sau 20ms               | feedback khớp lại      | không
 * 5   | WDG_RESET        | boot sau reset IWDG/WWDG (RCC_CSR)        | MCU nhận GET_DIAG đầu  | STICKY
 *     |                  |                                           | tiên sau boot          |
 * 6   | MCU_OVERTEMP     | MCU_TEMP > 85.0°C                         | MCU_TEMP < 80.0°C      | không
 * 7   | VDD_FAULT        | VDD ngoài [3.0, 3.6]V (MCU ngừng AO)      | VDD trong dải          | không
 * 8-15| reserved         | luôn 0                                    | —                      | —
 */
#define IOP_FAULT_ADC1         (1u << 0)
#define IOP_FAULT_ADC2         (1u << 1)
#define IOP_FAULT_DAC          (1u << 2)
#define IOP_FAULT_UI_OV        (1u << 3)
#define IOP_FAULT_RELAY_STUCK  (1u << 4)
#define IOP_FAULT_WDG_RESET    (1u << 5)   /* sticky */
#define IOP_FAULT_MCU_OVERTEMP (1u << 6)
#define IOP_FAULT_VDD          (1u << 7)

/* ---- SET_AO payload: 4 x uint16 BE (raw DAC) = 8 byte ----
 * 0-10V : V  = (raw/65535)*10      ; raw = (V/10)*65535, clamp [0,65535]
 * 4-20mA: mA = 4 + (raw/65535)*16  ; raw = ((mA-4)/16)*65535, clamp [0,65535]
 */
/* ---- SET_DO payload: [mask][value] = 2 byte                             ---- */
/* ---- SET_AO_CFG payload: [bitmask mode] 1 byte (bit i: 0=0-10V,1=4-20mA) --- */

/* ---- CRC-16/Modbus: poly 0xA001, init 0xFFFF. Truyền HI trước, LO sau. --- */
/* Test vector GET_IO (PHẢI khớp FW & BE):
 *   {0xAA,0x00,0x01,0x00} -> 0x6C20   |   {0xAA,0x00,0x01,0x01} -> 0xACE1
 *   Frame GET_IO SEQ=1 hoàn chỉnh: AA 00 01 01 AC E1 */
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

/* Helper big-endian */
static inline uint16_t iop_be16(const uint8_t *p)  { return (uint16_t)((p[0] << 8) | p[1]); }
/* iop_be24 / iop_s24: DEPRECATED since IOP v2 (ADR-010). UI_RAW is now int32 BE.
 * Use iop_be32s() for all UI_RAW fields. These remain only for MCU FW legacy
 * reference (DIAG_RESP fields that predate v2). DO NOT use for IO_RESP parsing. */
#if defined(__cplusplus) && __cplusplus >= 201402L
[[deprecated("IOP v2: use iop_be32s() for UI_RAW. iop_be24/iop_s24 are v1 helpers.")]]
#endif
static inline uint32_t iop_be24(const uint8_t *p)  { return ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | p[2]; }
/* int32 BE (v2: UI_RAW truyền dưới dạng signed int32) */
static inline int32_t  iop_be32s(const uint8_t *p) {
    return (int32_t)(((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3]);
}
#if defined(__cplusplus) && __cplusplus >= 201402L
[[deprecated("IOP v2: use iop_be32s() for UI_RAW. iop_be24/iop_s24 are v1 helpers.")]]
#endif
static inline int32_t  iop_s24(const uint8_t *p) {
    /* Inline be24 to avoid triggering the iop_be24 deprecation warning internally. */
    uint32_t u = ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | p[2];
    return (u & 0x800000u) ? (int32_t)(u - 0x1000000u) : (int32_t)u;
}

#endif /* MKDDC_IOP_PROTOCOL_H */
