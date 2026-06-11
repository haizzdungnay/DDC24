/**
 * @file    iop_protocol.h
 * @brief   MKDDC-IOP — HỢP ĐỒNG giao thức SOM(master) <-> MCU(slave).
 *          FW (STM32) và BE (mkddc-iobus) PHẢI include CHUNG file này.
 *
 * @note    NGUỒN-CHUẨN CUỐI CÙNG (Contract Freeze 2026-06-11 — xem
 *          docs/03_implementation/15_CONTRACT_FREEZE.md):
 *          file này THẮNG mọi tài liệu (spec/guide) khi có mâu thuẫn về
 *          opcode, payload layout, enum, FAULT bit, RESET reason, hằng số timing.
 *          Docs chỉ là diễn giải; docs lệch header → sửa docs.
 *
 * @note    Đổi file này = đổi hợp đồng: bump IOP_VER_*, cập nhật cả 2 phía,
 *          chạy lại cross-test CRC/parse, cập nhật 15_CONTRACT_FREEZE.
 *          KHÔNG fork/sửa 1 bên.
 * @version 1.1   (1.0 = base; 1.1 = thêm SET_AO_CFG + chốt FAULT bit/RESET reason)
 */
#ifndef MKDDC_IOP_PROTOCOL_H
#define MKDDC_IOP_PROTOCOL_H

#include <stdint.h>

/* ---- Version (đàm phán khi HANDSHAKE) ---- */
#define IOP_VER_MAJOR        1u
#define IOP_VER_MINOR        1u

/* ---- Khung (frame): SOF | LEN | CMD | SEQ | PAYLOAD[LEN] | CRC_HI | CRC_LO ---- */
#define IOP_SOF              0xAAu
#define IOP_HDR_LEN          4u      /* SOF + LEN + CMD + SEQ            */
#define IOP_CRC_LEN          2u      /* CRC-16/Modbus, big-endian (HI trước) */
#define IOP_MAX_PAYLOAD      252u
#define IOP_MAX_FRAME        (IOP_HDR_LEN + IOP_MAX_PAYLOAD + IOP_CRC_LEN) /* 258 */
#define IOP_MIN_FRAME        (IOP_HDR_LEN + IOP_CRC_LEN)                   /* 6   */

/* ---- UART / timing (SOM master trừ khi ghi rõ MCU) ---- */
#define IOP_BAUD                  921600u
#define IOP_GET_IO_PERIOD_MS      10u    /* SOM poll 100 Hz                       */
#define IOP_RESP_TIMEOUT_MS       10u    /* SOM chờ MCU trả lời 1 lệnh           */
#define IOP_MAX_RETRY             3u     /* SOM retry / lệnh trước khi coi là fail */
#define IOP_FAULT_TIMEOUT_MS      100u   /* SOM: >100ms không IO_RESP hợp lệ → FAULT */
#define IOP_RECONNECT_PERIOD_MS   5000u  /* SOM gửi lại HANDSHAKE mỗi 5s khi fault */
#define IOP_HANDSHAKE_TIMEOUT_MS  1000u  /* SOM chờ HANDSHAKE_RESP                */
#define IOP_SAFE_TIMEOUT_MS       200u   /* MCU không nhận GET_IO -> safe-state   */

/* ---- Command codes ---- */
typedef enum {
    CMD_GET_IO         = 0x01u,
    CMD_IO_RESP        = 0x02u,
    CMD_SET_AO         = 0x10u,
    CMD_SET_DO         = 0x11u,
    CMD_ACK            = 0x12u,
    CMD_SET_AO_CFG     = 0x13u,   /* v1.1: chọn mode AO (0-10V/4-20mA)  */
    CMD_GET_DIAG       = 0x20u,
    CMD_DIAG_RESP      = 0x21u,
    CMD_HANDSHAKE      = 0x30u,
    CMD_HANDSHAKE_RESP = 0x31u,
    CMD_RESET_IO       = 0x40u,
    CMD_NACK           = 0xFEu
} iop_cmd_t;

/* ---- Payload length cố định theo CMD (LEN field phải đúng giá trị này) ---- */
#define IOP_GET_IO_LEN          0u
#define IOP_IO_RESP_LEN         34u
#define IOP_SET_AO_LEN          8u
#define IOP_SET_DO_LEN          2u
#define IOP_ACK_LEN             1u
#define IOP_SET_AO_CFG_LEN      1u
#define IOP_GET_DIAG_LEN        0u
#define IOP_DIAG_RESP_LEN       20u
#define IOP_HANDSHAKE_LEN       4u
#define IOP_HANDSHAKE_RESP_LEN  6u
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

/* ---- HANDSHAKE: SOM_CAPABILITIES bit + RESP STATUS ---- */
#define IOP_CAP_DIAG          (1u << 0)  /* SOM hỗ trợ GET_DIAG       */
#define IOP_CAP_RESET_IO      (1u << 1)  /* SOM có thể gửi RESET_IO   */
#define IOP_HS_STATUS_OK      0x00u
#define IOP_HS_STATUS_WARN    0x01u      /* version mismatch, vẫn chạy */
#define IOP_HS_STATUS_INCOMPAT 0x02u     /* SOM phải abort             */

/* ====== RESET_IO (0x40) reason — bảng CHUẨN duy nhất ======
 * MCU hành vi GIỐNG NHAU cho mọi reason: AO→safe (theo mode), DO→open,
 * ghi fault log kèm reason, trả ACK(0x40). Reason chỉ phục vụ log/alarm.
 * Ai gửi / khi nào:
 *   NORMAL      iobus, sau handshake khi startup — đưa IO về safe đã biết.
 *   CORE_WDG    iobus, khi phát hiện core/scan-loop chết (Rev A: reserved, chưa dùng).
 *   BMS_TIMEOUT core→iobus, policy BMS/BACnet timeout (Rev A: reserved, chưa dùng).
 *   OPERATOR    web→core→iobus, lệnh commissioning của người vận hành.
 *   OTA         iobus, SOM sắp nạp firmware MCU.
 *   IOP_FAULT   iobus, đường FAULT: >IOP_FAULT_TIMEOUT_MS không IO_RESP hợp lệ.
 */
#define IOP_RESET_REASON_NORMAL       0x00u
#define IOP_RESET_REASON_CORE_WDG     0x01u
#define IOP_RESET_REASON_BMS_TIMEOUT  0x02u
#define IOP_RESET_REASON_OPERATOR     0x03u
#define IOP_RESET_REASON_OTA          0x04u
#define IOP_RESET_REASON_IOP_FAULT    0x05u

/* ---- AO safe raw (DAC8554 16-bit) ---- */
#define IOP_AO_SAFE_VOLT_RAW      0u      /* 0V  (mode 0-10V)            */
#define IOP_AO_SAFE_CURR_RAW      0u      /* 4mA (mode 4-20mA): raw 0 = 4mA theo mapping §SET_AO */

/* ====== Payload IO_RESP (34 byte) — đọc bằng byte offset, big-endian ====== */
/* [0..23]  UI1..UI8 raw  : 8 x uint24 BE (3 byte/kênh, s24 two's complement) */
/* [24]     DI_MASK       : bit i = DIi (1=ON sau debounce)                  */
/* [25]     DO_FB_MASK    : feedback relay (bit0=DO1..bit3=DO4)              */
/* [26..27] MCU_TEMP      : int16 BE, đơn vị 0.1 C                           */
/* [28..29] FAULT_FLAGS   : uint16 BE (xem IOP_FAULT_*)                      */
/* [30..31] SAMPLE_CNT    : uint16 BE (wrap)                                 */
/* [32..33] reserved      : 0x0000                                           */

/* ====== FAULT_FLAGS bit — bảng CHUẨN duy nhất (khớp SWFW spec §4.3.1) ======
 * bit | tên              | set khi                                  | clear khi              | sticky
 * 0   | ADC_FAULT        | ADS131M08 không có mẫu hợp lệ trong 100ms| reinit OK + mẫu hợp lệ | không
 * 1   | DAC_FAULT        | DAC8554 không phản hồi SPI               | ghi DAC thành công lại | không
 * 2   | UI_OV            | bất kỳ UI > 110% full scale              | mọi UI ≤ 110% FS       | không
 * 3   | RELAY_STUCK      | DO feedback ≠ lệnh sau 20ms              | feedback khớp lại      | không
 * 4   | MCU_WDG_RESET    | boot sau reset IWDG/WWDG (RCC_CSR)       | MCU nhận GET_DIAG đầu  | STICKY
 *     |                  |                                          | tiên sau boot          |
 * 5   | MCU_OVERTEMP     | MCU_TEMP > 85.0°C                        | MCU_TEMP < 80.0°C      | không
 * 6   | VDD_FAULT        | VDD ngoài [3.0, 3.6]V (MCU ngừng AO)     | VDD trong dải          | không
 * 7-15| reserved         | luôn 0                                   | —                      | —
 */
#define IOP_FAULT_ADC          (1u << 0)
#define IOP_FAULT_DAC          (1u << 1)
#define IOP_FAULT_UI_OV        (1u << 2)
#define IOP_FAULT_RELAY_STUCK  (1u << 3)
#define IOP_FAULT_WDG_RESET    (1u << 4)   /* sticky */
#define IOP_FAULT_MCU_OVERTEMP (1u << 5)
#define IOP_FAULT_VDD          (1u << 6)

/* ---- SET_AO payload: 4 x uint16 BE (raw DAC) = 8 byte ----
 * 0-10V : V  = (raw/65535)*10      ; raw = (V/10)*65535, clamp [0,65535]
 * 4-20mA: mA = 4 + (raw/65535)*16  ; raw = ((mA-4)/16)*65535, clamp [0,65535]
 */
/* ---- SET_DO payload: [mask][value] = 2 byte                             ---- */
/* ---- SET_AO_CFG payload: [bitmask mode] 1 byte (bit i: 0=0-10V,1=4-20mA) --- */

/* ---- CRC-16/Modbus: poly 0xA001, init 0xFFFF. Truyền HI trước, LO sau. --- */
/* Test vector (BẮT BUỘC khớp FW & BE — bộ đầy đủ 12 frame: 15_CONTRACT_FREEZE §5):
 *   {0xAA,0x00,0x01,0x00} -> 0x6C20   |   {0xAA,0x00,0x01,0x01} -> 0xACE1
 *   Frame GET_IO SEQ=1 hoàn chỉnh: AA 00 01 01 AC E1
 *   (Vector cũ 0x84C0/0x556B trong docs trước 2026-06-11 là SAI — đã thay.) */
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
static inline uint16_t iop_be16(const uint8_t *p) { return (uint16_t)((p[0] << 8) | p[1]); }
static inline uint32_t iop_be24(const uint8_t *p) { return ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | p[2]; }
/* s24 → int32 (sign-extend two's complement 24-bit) */
static inline int32_t  iop_s24(const uint8_t *p)  { int32_t v = (int32_t)iop_be24(p); return (v & 0x800000) ? (v - 0x1000000) : v; }

#endif /* MKDDC_IOP_PROTOCOL_H */
