# Module Design — `iop_comm` (FW)
## Giao thức IOP phía MCU — code-ready

> **Document ID:** DDD-FWMOD-IOP-MK-DDC-24-VI
> **Phiên bản:** 2.0 | 2026-06-30 · 📘 [README](../../01_specs/README.md)
> **Nguồn-chuẩn giao thức:** [ADR-010](../../adr/ADR-010-iop-v2-poll-capability-map.md) + `shared/iop_protocol.h` · **Trace:** `IOP-FW-001..010`, `FW-IOP-*`

> Module quan trọng nhất của FW. Đây là "người phiên dịch" giữa MCU và SOM. Đọc xong file này là code được task `iop_comm`.

---

## 1. Nhiệm vụ
- Nhận frame từ SOM (UART DMA), kiểm CRC + SEQ, hiểu lệnh, làm theo, trả lời.
- Task `iop_comm_task` Pri 6, đánh thức bởi UART IDLE + DMA (không poll).

## 2. Định nghĩa frame (header dùng chung SW↔FW)
```c
// iop_protocol.h  — PHẢI giống bên SOM
#define IOP_SOF        0xAAu
#define IOP_HDR_LEN    4u          // SOF+LEN+CMD+SEQ
#define IOP_CRC_LEN    2u
#define IOP_MAX_PAYLOAD 252u

// CMD codes (xem IOP-SPEC §4)
enum {
  CMD_GET_IO=0x01, CMD_IO_RESP=0x02,
  CMD_SET_AO=0x10, CMD_SET_DO=0x11, CMD_ACK=0x12, CMD_SET_AO_CFG=0x13,
  CMD_GET_DIAG=0x20, CMD_DIAG_RESP=0x21,
  CMD_HANDSHAKE=0x30, CMD_HANDSHAKE_RESP=0x31,
  CMD_RESET_IO=0x40, CMD_NACK=0xFE
};
// NACK error codes
enum { ERR_UNKNOWN_CMD=0x01, ERR_BAD_LEN=0x02, ERR_CRC_FAIL=0x03,
       ERR_BUSY=0x04, ERR_SAFE_STATE=0x05, ERR_VERSION_INCOMPAT=0x06 };
```

## 3. CRC-16/Modbus (giống hệt bên SOM — test vector chung)
```c
uint16_t crc16_modbus(const uint8_t *data, uint16_t len) {
    uint16_t crc = 0xFFFFu;
    for (uint16_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t b = 0; b < 8; b++)
            crc = (crc & 1u) ? (uint16_t)((crc >> 1) ^ 0xA001u) : (uint16_t)(crc >> 1);
    }
    return crc;   // truyền CRC_HI trước, CRC_LO sau (IOP-SPEC §3.2)
}
```
> Test vector bắt buộc: `AA 00 01 00`→`0x6C20`; `AA 00 01 01`→`0xACE1` (IOP-SPEC §10). Phải khớp SOW + FW.

## 4. Nhận frame (RX) — dùng UART IDLE + DMA
```
[Khởi tạo] HAL_UARTEx_ReceiveToIdle_DMA(huart1, rx_buf, sizeof rx_buf)
[ISR IDLE] → biết số byte n đã nhận → xTaskNotifyFromISR(iop_task, n)

[iop_comm_task]
  on notify(n):
    if n < 6: bỏ (frame tối thiểu 6 byte)
    if rx_buf[0] != IOP_SOF: tái đồng bộ (tìm 0xAA)
    len = rx_buf[1]; total = len + 6
    if n < total: chờ thêm / timeout
    crc_calc = crc16_modbus(rx_buf, total-2)
    crc_rx   = (rx_buf[total-2]<<8) | rx_buf[total-1]
    if crc_calc != crc_rx:  send_nack(cmd, ERR_CRC_FAIL); crc_err++; return
    seq = rx_buf[3]
    dispatch(rx_buf[2] /*cmd*/, &rx_buf[4] /*payload*/, len, seq)
    rx_cnt++
```

## 5. Dispatch lệnh
```c
void dispatch(uint8_t cmd, const uint8_t *p, uint8_t len, uint8_t seq) {
  switch (cmd) {
    case CMD_GET_IO:                       // build IO_RESP từ io_data_buf
      build_and_send_io_resp(seq); break;
    case CMD_SET_AO:                       // 8 byte: 4×uint16 BE
      if (len != 8) { send_nack(cmd, ERR_BAD_LEN, seq); break; }
      ao_cmd_t c; for(i=0;i<4;i++) c.ao_raw[i]=be16(p+2*i);
      xQueueOverwrite(xAoQueue, &c); send_ack(CMD_SET_AO, seq); break;
    case CMD_SET_DO:                       // 2 byte: mask, value
      if (len != 2) { send_nack(cmd, ERR_BAD_LEN, seq); break; }
      do_cmd_t d = { p[0], p[1] };
      xQueueOverwrite(xDoQueue, &d); send_ack(CMD_SET_DO, seq); break;
    case CMD_SET_AO_CFG:                    // 1 byte bitmask mode (v2)
      set_ao_mode_pins(p[0]); send_ack(CMD_SET_AO_CFG, seq); break;
    case CMD_GET_DIAG:   build_and_send_diag(seq); break;
    case CMD_RESET_IO:   enter_safe_state(p[0]); send_ack(CMD_RESET_IO, seq); break;
    case CMD_HANDSHAKE:  handle_handshake(p, len, seq); break;
    default:             send_nack(cmd, ERR_UNKNOWN_CMD, seq);
  }
}
```

## 6. Build IO_RESP v2 (74-byte payload — ADR-010)
```
[0..63]  UI_RAW[16] (int32 signed BE; ADS s24 sign-extended)
[64]     ADC1_STAT
[65]     ADC2_STAT
[66..67] MCU_TEMP (int16 BE, ×10 °C)
[68..69] FAULT_FLAGS v2 (uint16 BE)
[70..71] SAMPLE_CNT (uint16 BE)
[72]     DO_FB_MASK
[73]     reserved = 0x00
```
Base SKU không có DI_MASK. Đọc snapshot dưới `xIoDataMutex` (ngắn). TX qua DMA. **GET_IO→IO_RESP phải nằm trong response timeout 3ms** (FW-IOP-003).

## 7. SEQ & timing
- MCU **echo SEQ** từ request (không tự sinh) (IOP-SPEC §3.3).
- MCU watchdog IOP: không nhận GET_IO trong **200ms** → `enter_safe_state()` tự động (FW-WDG-005).

## 8. HANDSHAKE (khởi tạo)
```
nhận HANDSHAKE(SOM_IOP_VERSION, CAPS):
  if major(SOM_ver) != major(MCU_ver):  STATUS=0x02 (incompat)
  elif minor khác:                       STATUS=0x01 (warn)
  else:                                  STATUS=0x00
  gửi HANDSHAKE_RESP(MCU_IOP_VERSION, MCU_FW_VERSION, STATUS, BOARD_CAP_MAP)
```

Base SKU gửi `BOARD_CAP_MAP=0x000D` (UI_16 | DO_4 | AO_4).

## 9. TX (gửi) — DMA, không blocking
```c
void send_frame(uint8_t cmd, uint8_t seq, const uint8_t *pl, uint8_t len){
  tx_buf[0]=IOP_SOF; tx_buf[1]=len; tx_buf[2]=cmd; tx_buf[3]=seq;
  memcpy(&tx_buf[4], pl, len);
  uint16_t crc = crc16_modbus(tx_buf, 4+len);
  tx_buf[4+len]=crc>>8; tx_buf[5+len]=crc&0xFF;     // HI trước
  HAL_UART_Transmit_DMA(huart1, tx_buf, 6+len);
}
```

## 10. Lỗi & đếm (báo qua DIAG_RESP)
`rx_cnt, crc_err, seq_err, wdg_reset_cnt` — lưu SRAM backup, gửi khi GET_DIAG.

## 11. Test (Unity, chạy host)
- CRC test vectors (≥10) khớp SOM (IOP-FW-010).
- Parse frame hợp lệ/sai LEN/sai CRC/unknown CMD → đúng nhánh.
- Safe-state khi 200ms không có GET_IO (T-FW-IOP-004).

## 12. Trace REQ
`IOP-FW-001..010`, `FW-IOP-001..007`, `T-FW-IOP-001..006`.

---
**Rev** 2.0 | 2026-06-30 (IOP v2 ADR-010 payload/timing/capability map)
