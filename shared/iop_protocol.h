/**
 * @file    iop_protocol.h
 * @brief   Kinexus-IOP — HỢP ĐỒNG giao thức SOM(master) <-> MCU(slave).
 *          FW (STM32) và BE (io-driver) PHẢI include CHUNG file này.
 *          Nguồn-chuẩn: spec/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md
 *
 * @note    Đổi file này = đổi hợp đồng: bump IOP_VER_*, cập nhật cả 2 phía,
 *          chạy lại cross-test CRC/parse. KHÔNG fork/sửa 1 bên.
 * @version 1.1   (1.0 = base; 1.1 = thêm SET_AO_CFG)
 */
#ifndef KINEXUS_IOP_PROTOCOL_H
#define KINEXUS_IOP_PROTOCOL_H

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

/* ---- UART ---- */
#define IOP_BAUD             921600u
#define IOP_GET_IO_PERIOD_MS 10u     /* SOM poll 100 Hz                  */
#define IOP_RESP_TIMEOUT_MS  10u     /* SOM chờ MCU trả lời             */
#define IOP_SAFE_TIMEOUT_MS  200u    /* MCU không nhận GET_IO -> safe-state */

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

/* ---- NACK error codes ---- */
typedef enum {
    ERR_UNKNOWN_CMD        = 0x01u,
    ERR_BAD_LEN            = 0x02u,
    ERR_CRC_FAIL          = 0x03u,
    ERR_BUSY              = 0x04u,
    ERR_SAFE_STATE        = 0x05u,
    ERR_VERSION_INCOMPAT  = 0x06u
} iop_err_t;

/* ---- RESET_IO reason ---- */
#define IOP_RESET_REASON_NORMAL   0x00u
#define IOP_RESET_REASON_OTA      0x04u   /* SOM sắp nạp firmware MCU    */

/* ---- AO safe raw (DAC8554 16-bit) ---- */
#define IOP_AO_SAFE_VOLT_RAW      0u      /* 0V  (mode 0-10V)            */
#define IOP_AO_SAFE_CURR_RAW      13107u  /* 4mA (mode 4-20mA, ~4/20*65535) */

/* ====== Payload IO_RESP (34 byte) — đọc bằng byte offset, big-endian ====== */
/* [0..23]  UI1..UI8 raw  : 8 x uint24 BE (3 byte/kênh)                      */
/* [24]     DI_MASK       : bit i = DIi (1=ON sau debounce)                  */
/* [25]     DO_FB_MASK    : feedback relay                                   */
/* [26..27] MCU_TEMP      : int16 BE, đơn vị 0.1 C                           */
/* [28..29] FAULT_FLAGS   : uint16 BE (xem IOP_FAULT_*)                      */
/* [30..31] SAMPLE_CNT    : uint16 BE                                        */
/* [32..33] reserved      : 0x0000                                          */
#define IOP_IO_RESP_LEN      34u

/* ---- FAULT_FLAGS bit ---- */
#define IOP_FAULT_ADC          (1u << 0)
#define IOP_FAULT_DAC          (1u << 1)
#define IOP_FAULT_RELAY_STUCK  (1u << 2)
#define IOP_FAULT_MCU_OVERTEMP (1u << 3)
#define IOP_FAULT_VDD          (1u << 4)
#define IOP_FAULT_WDG_RESET    (1u << 5)

/* ---- SET_AO payload: 4 x uint16 BE (raw DAC) = 8 byte ---- */
/* ---- SET_DO payload: [mask][value] = 2 byte                ---- */
/* ---- SET_AO_CFG payload: [bitmask mode] 1 byte (bit i: 0=0-10V,1=4-20mA) */

/* ---- CRC-16/Modbus: poly 0xA001, init 0xFFFF. Truyền HI trước, LO sau. --- */
/* Test vector (BẮT BUỘC khớp FW & BE):                                       */
/*   {0xAA,0x00,0x01,0x00} -> 0x84C0   |   {0xAA,0x00,0x01,0x01} -> 0x556B   */
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

#endif /* KINEXUS_IOP_PROTOCOL_H */
