# 05 — IOP / UART Implementation Guide (hợp đồng MCU ↔ SOM)
## MK-DDC-24 — Kinexus-IOP v1.1

> **Document ID:** IMPL-IOP-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Owner:** Dev 1 (MCU slave) + Dev 2 (SOM master) — **CẢ HAI bắt buộc đọc**
> **Nguồn-chuẩn DUY NHẤT:** [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) +
> [`shared/iop_protocol.h`](../../shared/iop_protocol.h)

> ⚠️ File này là **HỢP ĐỒNG implement**. Nếu code MCU và code SOM bất đồng, sửa cho khớp
> file này + `iop_protocol.h`. **KHÔNG fork/sửa 1 bên.** Đổi hợp đồng = bump `IOP_VER_*` +
> sửa cả 2 phía + chạy lại cross-test.

---

## 1. UART config (cả 2 phía phải khớp tuyệt đối)

| Thông số | Giá trị | MCU | SOM |
|----------|---------|-----|-----|
| Baud | **921600** | USART1 | `/dev/ttyS2` (CM3 UART2) |
| Frame | 8N1 (8 data, no parity, 1 stop) | | `cfsetspeed` + termios raw |
| Flow control | None | | tắt RTS/CTS, IXON/IXOFF |
| Pin MCU | PA9=TX, PA10=RX | AF1 | — |
| Isolation | ADUM1201 (2 GND tách biệt) | | |
| Hằng số | `IOP_BAUD=921600` | | dùng chung header |

> SOM mở port: `O_RDWR | O_NOCTTY | O_NONBLOCK`, set termios raw (cfmakeraw), VMIN/VTIME=0,
> flush RX/TX trước khi handshake.

---

## 2. Frame format

```
┌────┬─────┬─────┬─────┬──────────────┬──────────┐
│ SOF│ LEN │ CMD │ SEQ │   PAYLOAD    │  CRC16   │
│0xAA│ 1B  │ 1B  │ 1B  │ 0..252 B     │ 2B HI,LO │
└────┴─────┴─────┴─────┴──────────────┴──────────┘
Tổng frame = LEN + 6.  CRC tính trên SOF..PAYLOAD (big-endian: HI trước).
```

| Hằng số (`iop_protocol.h`) | Giá trị |
|------|---------|
| `IOP_SOF` | 0xAA |
| `IOP_HDR_LEN` | 4 |
| `IOP_CRC_LEN` | 2 |
| `IOP_MAX_PAYLOAD` | 252 |
| `IOP_MIN_FRAME` | 6 |

---

## 3. CRC rule (CRC-16/Modbus)

```
poly 0xA001 (reflected), init 0xFFFF, refin=yes, refout=yes, xorout=0x0000.
Scope: SOF + LEN + CMD + SEQ + PAYLOAD.
Trong frame: CRC_HI (bits15..8) trước, CRC_LO sau.
Hàm chung: iop_crc16() trong shared/iop_protocol.h — CẢ MCU lẫn SOM dùng đúng hàm này.
```
**Test vector BẮT BUỘC khớp 2 phía:**
```
{0xAA,0x00,0x01,0x00}  → 0x84C0
{0xAA,0x00,0x01,0x01}  → 0x556B
```
> IOP-SW-010 + IOP-FW-010: mỗi phía PHẢI có unit test ≥10 vector. Vector thứ 3 (SET_AO)
> tính bằng reference impl khi tích hợp, lưu vào test cả 2 phía.

---

## 4. SEQ rule

```
- SOM: SEQ=0 sau reset; +1 mỗi frame gửi (wrap 255→0).
- MCU: LUÔN echo SEQ từ request vào response. MCU KHÔNG tự generate SEQ.
- SOM: verify SEQ trong response == SEQ request gần nhất. Lệch → bỏ frame, iop_seq_err++, log.
```

---

## 5. Command list (catalog)

| CMD | Tên | Hướng | LEN payload | Phản hồi |
|-----|-----|-------|-------------|----------|
| 0x01 | GET_IO | SOM→MCU | 0 | IO_RESP |
| 0x02 | IO_RESP | MCU→SOM | 34 | — |
| 0x10 | SET_AO | SOM→MCU | 8 | ACK |
| 0x11 | SET_DO | SOM→MCU | 2 | ACK |
| 0x12 | ACK | MCU→SOM | 1 | — |
| 0x13 | SET_AO_CFG | SOM→MCU | 1 | ACK (v1.1) |
| 0x20 | GET_DIAG | SOM→MCU | 0 | DIAG_RESP |
| 0x21 | DIAG_RESP | MCU→SOM | 20 | — |
| 0x30 | HANDSHAKE | SOM→MCU | 4 | HANDSHAKE_RESP |
| 0x31 | HANDSHAKE_RESP | MCU→SOM | 6 | — |
| 0x40 | RESET_IO | SOM→MCU | 1 | ACK |
| 0xFE | NACK | MCU→SOM | 2 | — |

---

## 6. Payload từng command (byte offset, big-endian)

### 6.1 IO_RESP (0x02) — 34 byte
```
[0..23]  UI1..UI8 raw : 8 × uint24 BE (3B/kênh)
[24]     DI_MASK      : bit0=DI1..bit7=DI8 (1=ON sau debounce)
[25]     DO_FB_MASK   : bit0=DO1..bit3=DO4 (1=relay đóng, feedback)
[26..27] MCU_TEMP     : int16 BE, ×10 (°C). 250=25.0°C
[28..29] FAULT_FLAGS  : uint16 BE (xem §6.6)
[30..31] SAMPLE_CNT   : uint16 BE (wrap) — phát hiện MCU hang
[32..33] RESERVED     : 0x0000
```
### 6.2 SET_AO (0x10) — 8 byte
```
[0..1] AO1, [2..3] AO2, [4..5] AO3, [6..7] AO4 : uint16 BE raw DAC (0=min,65535=max)
0-10V: V=(raw/65535)*10 ; 4-20mA: mA=4+(raw/65535)*16
```
### 6.3 SET_DO (0x11) — 2 byte
```
[0] DO_MASK : bit i =1 → áp dụng lệnh cho DOi
[1] DO_VALUE: bit i =1 → relay đóng, 0 → mở
Ví dụ đóng DO1, mở DO2, giữ DO3/4: MASK=0x03, VALUE=0x01
```
### 6.4 SET_AO_CFG (0x13) — 1 byte (v1.1)
```
[0] AO_MODE : bit0=AO1..bit3=AO4. 0=0-10V, 1=4-20mA
MCU: set relay/switch PD1..PD4, lưu mode, áp safe-state đúng mode mới.
```
### 6.5 HANDSHAKE (0x30, 4B) / HANDSHAKE_RESP (0x31, 6B)
```
HANDSHAKE:      [0..1] SOM_IOP_VERSION u16, [2..3] SOM_CAPABILITIES u16 (bit0=CAP_DIAG,bit1=CAP_RESET_IO)
HANDSHAKE_RESP: [0..1] MCU_IOP_VERSION, [2..3] MCU_FW_VERSION, [4] STATUS (0=OK,1=warn,2=incompat→abort), [5]=0
```
### 6.6 DIAG_RESP (0x21) — 20 byte
```
[0..1] FW_VERSION, [2..3] UPTIME_S, [4..5] IOP_RX_CNT, [6..7] IOP_CRC_ERR,
[8..9] IOP_SEQ_ERR, [10..11] WDG_RESET_CNT, [12..13] ADC_SAMPLE_RATE,
[14..15] MCU_TEMP_MAX, [16..17] VDD_MV, [18..19] RESERVED
```
### 6.7 ACK (0x12, 1B) / NACK (0xFE, 2B)
```
ACK : [0] ECHOED_CMD (CMD được ACK)
NACK: [0] REJECTED_CMD, [1] ERROR_CODE
```
### 6.8 FAULT_FLAGS bitmask
```
bit0 ADC_FAULT · bit1 DAC_FAULT · bit2 UI_OV(>110%FS) · bit3 RELAY_STUCK
bit4 MCU_WATCHDOG_RESET(sticky) · bit5 MCU_OVERTEMP(>85°C) · bit6..15 reserved
```

---

## 7. ACK/NACK rule

```
- SET_AO/SET_DO/SET_AO_CFG/RESET_IO thành công → ACK với ECHOED_CMD.
- CRC sai → NACK ERR_CRC_FAIL (0x03).
- LEN không khớp CMD → NACK ERR_BAD_LEN (0x02).
- CMD lạ → NACK ERR_UNKNOWN_CMD (0x01).
- MCU bận → NACK ERR_BUSY (0x04).
- MCU đang safe-state, nhận SET_* → NACK ERR_SAFE_STATE (0x05).
- Version không tương thích → NACK ERR_VERSION_INCOMPAT (0x06) / STATUS=0x02 ở handshake.
```

---

## 8. Timeout / retry rule (SOM side)

| Tham số | Giá trị | Hành động |
|---------|---------|-----------|
| Response timeout | 10 ms (`IOP_RESP_TIMEOUT_MS`) | retry lệnh (tối đa 3) |
| Max retry | 3 | sau 3: `iop_fault=TRUE`, log ERROR |
| GET_IO period | 10 ms (`IOP_GET_IO_PERIOD_MS`) | poll 100Hz |
| Fault timeout | 100 ms không IO_RESP hợp lệ | gửi RESET_IO, vào FAULT |
| Reconnect | mỗi 5 s khi fault | gửi lại HANDSHAKE |
| MCU safe timeout | 200 ms (`IOP_SAFE_TIMEOUT_MS`) | MCU tự safe-state |

---

## 9. Startup sequence (bắt buộc theo đúng thứ tự)

```
1. SOM mở /dev/ttyS2, 921600 8N1, flush RX/TX, SEQ=0.
2. SOM gửi HANDSHAKE (0x30) với SOM_IOP_VERSION=0x0101, capabilities.
3. MCU trả HANDSHAKE_RESP (0x31) với version + STATUS.
4. SOM kiểm version:
     STATUS=0x00 → tiếp tục
     STATUS=0x01 → log WARNING, tiếp tục
     STATUS=0x02 / timeout → log CRITICAL, retry 3 lần → fail thì raise IOP_INIT_FAIL + safe.
5. SOM gửi SET_AO_CFG (0x13) nếu cần đổi mode (MCU chưa hỗ trợ → NACK UNKNOWN_CMD, giữ 0-10V).
6. SOM bắt đầu GET_IO poll loop (10ms timer).
7. MCU trả IO_RESP mỗi GET_IO.
8. Timeout → retry (≤3).
9. Retry fail → báo MCU fault (iop_status=FAULT, alarm bus).
```

---

## 10. Error handling (state machine — đồng bộ 2 phía)

| State | SOM | MCU |
|-------|-----|-----|
| NORMAL | poll 100Hz, apply IO | trả dữ liệu thật |
| IOP_FAULT | ngừng SET_*; retry GET_IO; log | hold last output |
| SAFE_STATE | gửi RESET_IO; alarm | AO=0V/4mA, DO=open |
| RECONNECT | HANDSHAKE mỗi 5s | xử lý HANDSHAKE bình thường |

Safe-state values: AO 0-10V→0V (raw0); AO 4-20mA→4mA (raw 13107); DO→open.

---

## 11. Test vector & cross-test (Phase 2 gate)

```
Bước cross-test bắt buộc trước khi đóng Phase 2:
1. CRC: cả 2 phía cho cùng output với 10 vector (gồm 2 vector trong §3).
2. GET_IO/IO_RESP: SOM gửi 1000 lần → 0 CRC error, 0 SEQ error, latency ≤5ms.
3. SET_DO/SET_AO: SOM gửi → relay/AO thật đổi → IO_RESP feedback khớp.
4. Negative: SOM gửi frame CRC hỏng / CMD lạ / LEN sai → MCU trả NACK đúng code.
5. Safe: SOM ngừng GET_IO 200ms → MCU IO về safe (đo relay/AO).
```
Frame mẫu (GET_IO SEQ=1): `AA 00 01 01 <CRC_HI> <CRC_LO>` (CRC=0x556B → `55 6B`).

---

## 12. Phân nhiệm implement

| Yêu cầu | MCU (Dev 1) | SOM (Dev 2) |
|---------|-------------|-------------|
| CRC16 | IOP-FW-010 (crc16.c) | IOP-SW-010 (iop_crc.cpp) |
| DMA UART | IOP-FW-002 | termios raw + poll/epoll |
| Timeout/retry | — (slave) | IOP-SW-003 |
| HANDSHAKE | IOP-FW-009 | IOP-SW-007 |
| Safe-state | IOP-FW-006 (200ms) | IOP-SW-005 (RESET_IO) |
| Metrics | DIAG counters | IOP-SW-006 (/system/status) |

---
**Rev** 1.0 | 2026-06-10
