# SWFW Interface Specification — Kinexus-IOP v1
## MK-DDC-24 | SOM ↔ MCU Communication Protocol

> **Document ID:** IOP-SPEC-MK-DDC-24-VI  
> **Phiên bản:** 1.2 | 2026-06-15 (Sửa tên service + SHM path theo ADR-005 + Contract Freeze: `kinexus-io-driver` → `mkddc-iobus`, `/kinexus/io_data` → `/dev/shm/mkddc_io_shm`)
> **Trạng thái:** Superseded 2026-06-25 by ADR-010 and `shared/iop_protocol.h` v2.0; retained as IOP v1 history only
> 📘 **Đọc cùng:** [README](README.md) — hướng dẫn + glossary · Đã đồng bộ **2026-05-30** (xem [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md))  
> **Tác giả:** KINEXUS Technologies — System Architecture Team  
> **Current authority:** [ADR-010](../adr/ADR-010-iop-v2-poll-capability-map.md), [`shared/iop_protocol.h`](../../shared/iop_protocol.h), and `hardware-design/05_mcu_io/IOP_PROTOCOL.md`. Do not implement payload/timing tables in this v1 file.
> ⚠️ **Precedence (Contract Freeze):** giá trị thực thi — opcode, payload layout, enum, FAULT bit,
> RESET reason, CRC, hằng số timing — lấy theo [`shared/iop_protocol.h`](../../shared/iop_protocol.h).
> Spec lệch header → **header thắng**, sửa spec theo. Xem [16_CONTRACT_FREEZE](../03_implementation/16_CONTRACT_FREEZE.md).

**Tài liệu liên quan:**

| Tài liệu | ID | Phiên bản |
|---------|-----|---------|
| Software Requirements Spec | SRS-MK-DDC-24-VI | 1.1 |
| Firmware Requirements Spec | FW-REQ-MK-DDC-24-VI | 1.0 |
| Hardware Specification | HW-SPEC-MK-DDC-24-VI | 1.1 |
| Data Sheet | DS-MK-DDC-24-VI | 2.1 |

---

## 1. Phạm vi

Tài liệu này định nghĩa đầy đủ giao thức truyền thông giữa:

- **SOM** (Radxa CM3 / RK3566, chạy Debian 12) — vai trò **Master**
- **MCU** (STM32G0B1RBT6, chạy FreeRTOS) — vai trò **Slave**

Phạm vi bao gồm:
- Physical layer (UART, isolation)
- Frame format và encoding
- Command catalog (toàn bộ)
- Timing, timeout, retry policy
- Error handling và fault state
- Startup / initialization handshake
- Versioning và compatibility

---

## 2. Physical Layer

### 2.1 UART Parameters

| Thông số | Giá trị |
|---------|---------|
| **Interface** | UART (async, full-duplex) |
| **Baud rate** | **921,600 bps** |
| **Data bits** | 8 |
| **Parity** | None |
| **Stop bits** | 1 |
| **Flow control** | None (no RTS/CTS, no XON/XOFF) |
| **SOM side** | UART2 (CM3 → `/dev/ttyS2`) |
| **MCU side** | USART1 (PA9=TX, PA10=RX) |
| **Isolation** | ADUM1201ARZ (2500V RMS, max 1 Mbps) |
| **Direction** | Full-duplex, SOM TX → MCU RX; MCU TX → SOM RX |

### 2.2 Isolation Circuit

```
SOM UART2_TX  ──► ADUM1201 Channel A ──► MCU USART1_RX
SOM UART2_RX  ◄── ADUM1201 Channel B ◄── MCU USART1_TX
              VCC2 (3.3V, SOM side)   VCC1 (3.3V, MCU side)
              GND2 (SOM DGND)         GND1 (MCU AGND/DGND)
```

> **Quy tắc:** Hai GND PHẢI tách biệt hoàn toàn tại chỗ nối. Không được kết nối GND1 và GND2 trực tiếp trên carrier board.

---

## 3. Frame Format

### 3.1 Cấu trúc Frame

```
┌────┬─────┬─────┬─────┬──────────────────┬──────────┐
│ SOF│ LEN │ CMD │ SEQ │    PAYLOAD        │  CRC16   │
│ 1B │ 1B  │ 1B  │ 1B  │  0–252 bytes     │  2 bytes │
└────┴─────┴─────┴─────┴──────────────────┴──────────┘
```

| Field | Size | Mô tả |
|-------|------|-------|
| **SOF** | 1 byte | Start-of-Frame marker = `0xAA` |
| **LEN** | 1 byte | Số byte PAYLOAD (0–252). Tổng frame = LEN + 6 |
| **CMD** | 1 byte | Command / Response code (xem Mục 4) |
| **SEQ** | 1 byte | Sequence number, 0–255, wrap-around |
| **PAYLOAD** | 0–252 B | Dữ liệu lệnh / phản hồi (tùy CMD) |
| **CRC16** | 2 bytes | CRC-16/Modbus của toàn bộ byte từ SOF đến cuối PAYLOAD (big-endian: CRC_HI trước) |

### 3.2 CRC16 Specification

- **Polynomial:** `0x8005` (Modbus CRC-16)
- **Initial value:** `0xFFFF`
- **Input reflection:** Yes
- **Output reflection:** Yes
- **Final XOR:** `0x0000`
- **Scope:** Tính CRC trên các byte: `SOF + LEN + CMD + SEQ + PAYLOAD`
- **Byte order trong frame:** `CRC_HI` (bits 15–8) trước, `CRC_LO` (bits 7–0) sau

**Ví dụ tính CRC (Python):**
```python
import struct

def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc
```

### 3.3 Sequence Number Rules

- **SOM** khởi tạo SEQ = 0 sau reset; tăng 1 mỗi frame gửi đi (wrap 255→0).
- **MCU** copy SEQ từ request vào response tương ứng.
- **SOM** xác minh SEQ trong response == SEQ của request gần nhất.
- Nếu SEQ không khớp: bỏ qua frame, tăng `iop_seq_mismatch_counter`, ghi log.
- **MCU KHÔNG** tự generate SEQ; MCU luôn echo SEQ từ SOM.

### 3.4 Byte Stuffing

Không áp dụng byte stuffing. Frame length xác định bởi field LEN. Receiver đọc đúng `LEN + 6` bytes sau khi nhận SOF.

---

## 4. Command Catalog

### 4.1 Tổng quan

| CMD | Tên | Hướng | Mô tả |
|-----|-----|-------|-------|
| `0x01` | `GET_IO` | SOM → MCU | Poll toàn bộ giá trị I/O |
| `0x02` | `IO_RESP` | MCU → SOM | Phản hồi I/O data |
| `0x10` | `SET_AO` | SOM → MCU | Ghi giá trị 4 kênh AO |
| `0x11` | `SET_DO` | SOM → MCU | Ghi trạng thái 4 kênh DO relay |
| `0x12` | `ACK` | MCU → SOM | Xác nhận SET_AO / SET_DO / SET_AO_CFG |
| `0x13` | `SET_AO_CFG` | SOM → MCU | Cấu hình mode AO per kênh (0–10V/4–20mA) — *IOP v1.1* |
| `0x20` | `GET_DIAG` | SOM → MCU | Đọc diagnostics MCU |
| `0x21` | `DIAG_RESP` | MCU → SOM | Phản hồi diagnostics |
| `0x30` | `HANDSHAKE` | SOM → MCU | Khởi tạo kết nối / kiểm tra version |
| `0x31` | `HANDSHAKE_RESP` | MCU → SOM | Phản hồi handshake + version info |
| `0x40` | `RESET_IO` | SOM → MCU | Yêu cầu MCU đưa I/O về safe state |
| `0xFE` | `NACK` | MCU → SOM | Từ chối lệnh (kèm error code) |
| `0xFF` | Reserved | — | Không dùng |

---

### 4.2 `0x01 GET_IO` — Poll I/O Data

**Hướng:** SOM → MCU  
**PAYLOAD:** 0 byte (LEN = 0x00)

```
Frame: AA 00 01 <SEQ> <CRC_HI> <CRC_LO>
```

**MCU xử lý:** Đọc snapshot I/O mới nhất từ `io_sample_task` và trả `IO_RESP`.

---

### 4.3 `0x02 IO_RESP` — I/O Data Response

**Hướng:** MCU → SOM  
**PAYLOAD:** 34 bytes (LEN = 0x22)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0–2 | UI1_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 0 |
| 3–5 | UI2_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 1 |
| 6–8 | UI3_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 2 |
| 9–11 | UI4_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 3 |
| 12–14 | UI5_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 4 |
| 15–17 | UI6_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 5 |
| 18–20 | UI7_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 6 |
| 21–23 | UI8_RAW | 3 | uint24 big-endian | ADS131M08 raw sample, channel 7 |
| 24 | DI_MASK | 1 | uint8 bitmask | bit0=DI1 .. bit7=DI8. 1=ON (contact closed) |
| 25 | DO_FB_MASK | 1 | uint8 bitmask | bit0=DO1 .. bit3=DO4. 1=relay closed (feedback) |
| 26–27 | MCU_TEMP | 2 | int16, big-endian | MCU die temperature × 10 (°C). Ví dụ: 250 = 25.0°C |
| 28–29 | FAULT_FLAGS | 2 | uint16 bitmask | Xem Mục 4.3.1 |
| 30–31 | SAMPLE_CNT | 2 | uint16 big-endian | ADC sample counter (wrap). Dùng để phát hiện MCU hang |
| 32–33 | RESERVED | 2 | — | Gửi 0x0000. SOM bỏ qua. |

#### 4.3.1 FAULT_FLAGS Bitmask (bảng chuẩn duy nhất — khớp `IOP_FAULT_*` trong `shared/iop_protocol.h`)

| Bit | Tên (macro header) | Set khi | Clear khi | Sticky |
|-----|--------------------|---------|-----------|--------|
| 0 | `ADC_FAULT` (`IOP_FAULT_ADC`) | ADS131M08 không có mẫu hợp lệ trong 100ms (DRDY/SPI timeout từng mẫu = 5ms) | Reinit ADC thành công + có mẫu hợp lệ | Không |
| 1 | `DAC_FAULT` (`IOP_FAULT_DAC`) | DAC8554 không phản hồi SPI | Ghi DAC thành công trở lại | Không |
| 2 | `UI_OV` (`IOP_FAULT_UI_OV`) | Bất kỳ kênh UI nào đo > 110% full scale | Mọi UI ≤ 110% FS | Không |
| 3 | `RELAY_STUCK` (`IOP_FAULT_RELAY_STUCK`) | DO feedback không khớp với lệnh sau 20ms | Feedback khớp lệnh trở lại | Không |
| 4 | `MCU_WATCHDOG_RESET` (`IOP_FAULT_WDG_RESET`) | Boot sau reset do IWDG/WWDG (đọc RCC_CSR) | MCU nhận **GET_DIAG đầu tiên sau boot** (SOM xác nhận đã đọc) | **Sticky** |
| 5 | `MCU_OVERTEMP` (`IOP_FAULT_MCU_OVERTEMP`) | MCU_TEMP > 85.0°C | MCU_TEMP < 80.0°C (hysteresis 5°C) | Không |
| 6 | `VDD_FAULT` (`IOP_FAULT_VDD`) | VDD ngoài [3.0, 3.6]V — MCU đồng thời ngừng cập nhật AO | VDD trong dải trở lại | Không |
| 7–15 | Reserved | Luôn 0 | — | — |

> Hành vi SOM (iobus): thấy bit4 → phát alarm `MCU_WATCHDOG_RESET` rồi gửi GET_DIAG (vòng diag 1s
> sẵn có) để MCU clear bit. Các bit khác → mirror vào `fault_flags` trong SHM + alarm theo
> [06_MKDDC_IOBUS §9](../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md).

---

### 4.4 `0x10 SET_AO` — Set Analog Output

**Hướng:** SOM → MCU  
**PAYLOAD:** 8 bytes (LEN = 0x08)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0–1 | AO1 | 2 | uint16 big-endian | DAC raw value. 0 = min output, 65535 = max output |
| 2–3 | AO2 | 2 | uint16 big-endian | |
| 4–5 | AO3 | 2 | uint16 big-endian | |
| 6–7 | AO4 | 2 | uint16 big-endian | |

**Mapping AO raw → Output:**
- Chế độ 0–10V: `V = (raw / 65535) × 10.0`
- Chế độ 4–20mA: `mA = 4.0 + (raw / 65535) × 16.0`

> **Lưu ý (chốt IOP-Q-R008):** Chế độ (V hoặc mA) chọn bằng **phần mềm per kênh**, không phải jumper. SOM gửi cấu hình mode qua lệnh `SET_AO_CFG (0x13)` — xem §4.4a. MCU lưu mode mỗi kênh; mặc định khi boot (trước khi nhận `SET_AO_CFG`) = 0–10V.

**MCU trả:** `ACK (0x12)` với echo SEQ.

---

### 4.4a `0x13 SET_AO_CFG` — Set AO Range Mode (IOP v1.1)

**Hướng:** SOM → MCU
**PAYLOAD:** 1 byte (LEN = 0x01)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0 | AO_MODE | 1 | uint8 bitmask | bit0=AO1 .. bit3=AO4. 0 = 0–10V, 1 = 4–20mA |

**MCU xử lý:** điều khiển relay/analog-switch chọn đường ra cho từng kênh, lưu mode vào config flash, áp safe-state đúng theo mode mới (0V hoặc 4mA). Trả `ACK (0x12)` với ECHOED_CMD = 0x13.

> **Trạng thái:** lệnh này thuộc **IOP v1.1**. Đến khi v1.1 có hiệu lực, SOM gửi `SET_AO_CFG` ngay sau HANDSHAKE; MCU chưa hỗ trợ thì trả NACK `ERR_UNKNOWN_CMD` và giữ mặc định 0–10V. Tham chiếu FW-AO-007.

---

### 4.5 `0x11 SET_DO` — Set Digital Output (Relay)

**Hướng:** SOM → MCU  
**PAYLOAD:** 2 bytes (LEN = 0x02)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0 | DO_MASK | 1 | uint8 | bit0=DO1 .. bit3=DO4. 1 = kênh này áp dụng lệnh từ DO_VALUE |
| 1 | DO_VALUE | 1 | uint8 | bit0=DO1 .. bit3=DO4. 1=relay đóng, 0=relay mở |

**Ví dụ:** Đóng DO1, mở DO2, không thay đổi DO3/DO4:
```
DO_MASK  = 0b00000011 (0x03)  ← áp dụng cho bit0 và bit1
DO_VALUE = 0b00000001 (0x01)  ← DO1=đóng, DO2=mở
```

**MCU trả:** `ACK (0x12)` với echo SEQ.

---

### 4.6 `0x12 ACK` — Acknowledge

**Hướng:** MCU → SOM  
**PAYLOAD:** 1 byte (LEN = 0x01)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0 | ECHOED_CMD | 1 | uint8 | CMD của lệnh được ACK (0x10 hoặc 0x11) |

---

### 4.7 `0x20 GET_DIAG` — Request Diagnostics

**Hướng:** SOM → MCU  
**PAYLOAD:** 0 bytes (LEN = 0x00)

**MCU trả:** `DIAG_RESP (0x21)`.

---

### 4.8 `0x21 DIAG_RESP` — Diagnostics Response

**Hướng:** MCU → SOM  
**PAYLOAD:** 20 bytes (LEN = 0x14)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0–1 | FW_VERSION | 2 | uint16 | MCU firmware version. High byte = major, low byte = minor |
| 2–3 | UPTIME_S | 2 | uint16 | Uptime MCU (giây, wrap at 65535 ≈ 18h) |
| 4–5 | IOP_RX_CNT | 2 | uint16 | Số frame nhận được (wrap) |
| 6–7 | IOP_CRC_ERR | 2 | uint16 | Số frame bị CRC error |
| 8–9 | IOP_SEQ_ERR | 2 | uint16 | Số lần SEQ không khớp |
| 10–11 | WDG_RESET_CNT | 2 | uint16 | Tổng số lần reset do watchdog |
| 12–13 | ADC_SAMPLE_RATE | 2 | uint16 | ADC actual sample rate (Hz) |
| 14–15 | MCU_TEMP_MAX | 2 | int16 | Max MCU temp kể từ boot (×10 °C) |
| 16–17 | VDD_MV | 2 | uint16 | MCU VDD millivolts (3300 = 3.3V) |
| 18–19 | RESERVED | 2 | — | 0x0000 |

---

### 4.9 `0x30 HANDSHAKE` — Initialize Connection

**Hướng:** SOM → MCU  
**PAYLOAD:** 4 bytes (LEN = 0x04)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0–1 | SOM_IOP_VERSION | 2 | uint16 | SOM implementation version (xem Mục 7) |
| 2–3 | SOM_CAPABILITIES | 2 | uint16 | Capability bitmask (xem Mục 4.9.1) |

#### 4.9.1 SOM_CAPABILITIES Bitmask

| Bit | Capability |
|-----|-----------|
| 0 | `CAP_DIAG` — SOM hỗ trợ GET_DIAG |
| 1 | `CAP_RESET_IO` — SOM có thể gửi RESET_IO |
| 2–15 | Reserved (0) |

---

### 4.10 `0x31 HANDSHAKE_RESP` — Handshake Response

**Hướng:** MCU → SOM  
**PAYLOAD:** 6 bytes (LEN = 0x06)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0–1 | MCU_IOP_VERSION | 2 | uint16 | MCU implementation version |
| 2–3 | MCU_FW_VERSION | 2 | uint16 | MCU firmware version |
| 4 | STATUS | 1 | uint8 | 0x00 = OK; 0x01 = version mismatch warning; 0x02 = incompatible (SOM phải abort) |
| 5 | RESERVED | 1 | — | 0x00 |

---

### 4.11 `0x40 RESET_IO` — Safe State Reset

**Hướng:** SOM → MCU  
**PAYLOAD:** 1 byte (LEN = 0x01)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0 | REASON | 1 | uint8 | Bảng reason chuẩn dưới đây (`IOP_RESET_REASON_*` trong header) |

**Bảng REASON chuẩn duy nhất:**

| Giá trị | Macro header | Ai gửi | Khi nào dùng | Log/Alarm phía SOM |
|---------|--------------|--------|--------------|---------------------|
| `0x00` | `IOP_RESET_REASON_NORMAL` | iobus | Sau handshake lúc startup — đưa IO về safe-state đã biết | INFO `iop.reset reason=normal` |
| `0x01` | `IOP_RESET_REASON_CORE_WDG` | iobus | Phát hiện core/scan-loop chết (**Rev A: reserved, chưa dùng**) | ERROR + alarm `CORE_WDG` |
| `0x02` | `IOP_RESET_REASON_BMS_TIMEOUT` | core→iobus | Policy BMS/BACnet timeout (**Rev A: reserved, chưa dùng**) | WARN + alarm |
| `0x03` | `IOP_RESET_REASON_OPERATOR` | web→core→iobus | Lệnh commissioning của người vận hành | INFO + audit log |
| `0x04` | `IOP_RESET_REASON_OTA` | iobus | SOM chuẩn bị nạp firmware MCU | INFO `iop.reset reason=ota` |
| `0x05` | `IOP_RESET_REASON_IOP_FAULT` | iobus | Đường FAULT: >100ms không có IO_RESP hợp lệ (trước khi vào SAFE_STATE) | ERROR + alarm `IOP_TIMEOUT` |

**MCU xử lý (GIỐNG NHAU cho mọi reason — reason chỉ để log/diag, MCU không phân nhánh hành vi):**
1. Tất cả AO về `SAFE_AO_VALUE` (mặc định: 0V / 4mA tùy mode)
2. Tất cả relay DO về `SAFE_DO_VALUE` (mặc định: open = 0)
3. Ghi fault event vào MCU fault log **kèm reason byte**
4. Trả `ACK (0x12)` với ECHOED_CMD = 0x40
5. REASON ngoài bảng (0x06–0xFF): vẫn safe-state + ACK, log reason lạ (forward-compatible)

---

### 4.12 `0xFE NACK` — Negative Acknowledge

**Hướng:** MCU → SOM  
**PAYLOAD:** 2 bytes (LEN = 0x02)

| Offset | Field | Size | Encoding | Mô tả |
|--------|-------|------|----------|-------|
| 0 | REJECTED_CMD | 1 | uint8 | CMD bị từ chối |
| 1 | ERROR_CODE | 1 | uint8 | Xem Mục 4.12.1 |

#### 4.12.1 Error Codes

| Code | Tên | Mô tả |
|------|-----|-------|
| `0x01` | `ERR_UNKNOWN_CMD` | CMD không nhận ra |
| `0x02` | `ERR_BAD_LEN` | LEN không phù hợp với CMD |
| `0x03` | `ERR_CRC_FAIL` | CRC16 không khớp (MCU đã tính lại) |
| `0x04` | `ERR_BUSY` | MCU đang xử lý lệnh khác |
| `0x05` | `ERR_SAFE_STATE` | MCU đang trong safe state, từ chối SET_AO/SET_DO |
| `0x06` | `ERR_VERSION_INCOMPAT` | IOP version không tương thích |

---

## 5. Timing & Scheduling

### 5.1 Normal Operation Timing

```
SOM Timeline (every 10ms):
  t=0ms:   SOM gửi GET_IO (0x01)
  t≤2ms:   MCU trả IO_RESP (0x02)  ← latency target
  t=5ms:   SOM gửi SET_AO (0x10) nếu có thay đổi
  t≤7ms:   MCU trả ACK (0x12)
  t=7ms:   SOM gửi SET_DO (0x11) nếu có thay đổi
  t≤9ms:   MCU trả ACK (0x12)
  t=10ms:  Chu kỳ tiếp theo bắt đầu
```

### 5.2 Timeout và Retry Policy

| Timeout | Giá trị | Hành động khi timeout |
|---------|---------|----------------------|
| **Response timeout** | 10 ms | SOM retry lệnh (tối đa 3 lần) |
| **Max retry** | 3 lần | Sau 3 lần: set `iop_fault = TRUE`, ghi error log |
| **Fault timeout** | 100 ms không có IO_RESP hợp lệ | `RESET_IO` (safe state), escalate fault |
| **Reconnect attempt** | Mỗi 5 giây khi fault | SOM gửi HANDSHAKE lại |
| **MCU response latency** | ≤ 2 ms (target) | MCU PHẢI trả response trong 5ms, không vượt 10ms |

### 5.3 Throughput Calculation

```
Baud rate: 921,600 bps = 92,160 bytes/s
GET_IO frame:       6 bytes  (SOF+LEN+CMD+SEQ+CRC)
IO_RESP frame:     40 bytes  (6 header + 34 payload)
SET_AO frame:      14 bytes  (6 header + 8 payload)
ACK frame:          7 bytes
SET_DO frame:       8 bytes
ACK frame:          7 bytes

Total per 10ms cycle: 6 + 40 + 14 + 7 + 8 + 7 = 82 bytes
Time to transmit 82 bytes @ 921600 baud: ~0.89 ms
→ Bandwidth utilization: 8.9% (ample margin)
```

---

## 6. Error Handling & Fault States

### 6.1 SOM-Side Error Handling

```
IOP Driver (SOM):
  Normal polling:
    SEQ++
    Send GET_IO
    Wait for IO_RESP (timeout 10ms)
    ├─ RECEIVED OK:
    │    Validate CRC16
    │    ├─ CRC OK: Check SEQ, update I/O values, reset fault timer
    │    └─ CRC FAIL: iop_crc_err++, retry
    └─ TIMEOUT:
         retry_count++
         if retry_count < 3: resend
         else:
           set iop_fault=TRUE
           log ERROR "IOP: MCU not responding"
           if fault_duration > 100ms: send RESET_IO, enter FAULT state
```

### 6.2 Fault State Behavior

| State | SOM hành vi | MCU hành vi |
|-------|------------|------------|
| **Normal** | Poll 100Hz, apply I/O values from PLC | Trả dữ liệu thực |
| **IOP_FAULT** | Ngừng SET_AO/SET_DO; giữ retry GET_IO; ghi fault log | Không đổi output (hold last) |
| **SAFE_STATE** | Gửi `RESET_IO`; thông báo PLC watchdog; escalate alarm | AO=0V/4mA, DO=open |
| **RECONNECT** | Gửi HANDSHAKE mỗi 5s | Xử lý HANDSHAKE bình thường |

### 6.3 Safe State Values

| Output | Safe State Value | Lý do |
|--------|-----------------|-------|
| AO1–AO4 (0–10V mode) | 0.0V (raw = 0x0000) | Valve closed = safe |
| AO1–AO4 (4–20mA mode) | 4.0mA (raw = 0x0000) | Minimum live signal, loop healthy |
| DO1–DO4 | OPEN (0) | Relay de-energized = safe |

> **Cấu hình override:** Safe state values có thể cấu hình per-kênh qua Web IDE (lưu trong `/data/config/io_safe_state.conf`). Nếu không cấu hình, dùng giá trị default ở trên.

---

## 7. Protocol Versioning

### 7.1 Version Number

`IOP_VERSION` là uint16: `(MAJOR << 8) | MINOR`

| Version | Mô tả |
|---------|-------|
| `0x0100` (1.0) | Baseline — tài liệu này |

### 7.2 Compatibility Rules

| SOM Version | MCU Version | Kết quả |
|------------|------------|---------|
| 1.x | 1.x | OK |
| 1.x | 2.x | WARN (MCU mới hơn, backward compat) |
| 2.x | 1.x | ERROR — SOM không được kết nối |
| Major mismatch | — | MCU trả `STATUS = 0x02`, SOM abort + alarm |

---

## 8. Startup Sequence

```
SOM boot:
  1. mkddc-iobus.service start
  2. Open /dev/ttyS2, configure 921600/8N1
  3. Flush RX/TX buffers
  4. SEQ = 0
  5. Send HANDSHAKE (0x30) với SOM_IOP_VERSION = 0x0100
  6. Wait HANDSHAKE_RESP (0x31), timeout = 1000ms
     ├─ STATUS=0x00: continue normal operation
     ├─ STATUS=0x01: log WARNING, continue
     └─ STATUS=0x02 or timeout: log CRITICAL, retry 3 times
        → if still fail: raise IOP_INIT_FAIL alarm, enter safe state
  7. Start polling loop (10ms timer)

MCU boot:
  1. FreeRTOS start
  2. io_sample_task starts ADC sampling
  3. iop_comm_task waits for HANDSHAKE
  4. On HANDSHAKE received: validate version, send HANDSHAKE_RESP
  5. Begin responding to GET_IO, SET_AO, SET_DO
```

---

## 9. Implementation Requirements

### 9.1 SOM (Software Team)

| ID | Yêu cầu | Priority |
|----|---------|---------|
| IOP-SW-001 | PHẢI implement IOP driver trong `mkddc-iobus` service (C++17) | MUST |
| IOP-SW-002 | PHẢI dùng CRC-16/Modbus theo Mục 3.2 | MUST |
| IOP-SW-003 | PHẢI implement timeout/retry theo Mục 5.2 | MUST |
| IOP-SW-004 | PHẢI expose I/O values qua POSIX shared memory `/dev/shm/mkddc_io_shm` (format `kx_io_shm_t` định nghĩa trong `shared/mkddc_shm.h`) | MUST |
| IOP-SW-005 | PHẢI implement fault state machine theo Mục 6.2 | MUST |
| IOP-SW-006 | PHẢI ghi metrics (iop_crc_err, iop_seq_err, iop_timeout) qua `/api/v1/system/status` | MUST |
| IOP-SW-007 | PHẢI implement HANDSHAKE và version check theo Mục 8 | MUST |
| IOP-SW-008 | Thread/process PHẢI chạy với SCHED_FIFO priority ≥ 70 để đảm bảo 100Hz | MUST |
| IOP-SW-009 | Shared memory update PHẢI atomic (POSIX rwlock hoặc seqlock) | MUST |
| IOP-SW-010 | PHẢI có unit test cho CRC16 với ít nhất 10 test vectors | MUST |

### 9.2 MCU (Firmware Team)

| ID | Yêu cầu | Priority |
|----|---------|---------|
| IOP-FW-001 | PHẢI implement IOP slave trong `iop_comm_task` (FreeRTOS) | MUST |
| IOP-FW-002 | PHẢI dùng DMA cho UART TX/RX (không polling) | MUST |
| IOP-FW-003 | PHẢI buffer IO_RESP data từ `io_sample_task` qua FreeRTOS queue | MUST |
| IOP-FW-004 | Response latency PHẢI ≤ 5ms từ khi nhận GET_IO đến khi bắt đầu TX IO_RESP | MUST |
| IOP-FW-005 | PHẢI xử lý RESET_IO và apply safe state trong ≤ 5ms | MUST |
| IOP-FW-006 | PHẢI implement MCU-side watchdog: nếu không nhận GET_IO trong 200ms → apply safe state tự động | MUST |
| IOP-FW-007 | PHẢI verify CRC của mọi frame nhận được trước khi xử lý | MUST |
| IOP-FW-008 | PHẢI respond với NACK cho mọi frame bị CRC error hoặc unknown CMD | MUST |
| IOP-FW-009 | PHẢI implement HANDSHAKE và version negotiation theo Mục 8 | MUST |
| IOP-FW-010 | PHẢI có unit test cho CRC16 (≥ 10 test vectors giống IOP-SW-010) | MUST |

---

## 10. Test Vectors

### 10.1 CRC16 Test Vectors (bộ chuẩn 12 vector — Contract Freeze 2026-06-11)

Input = `SOF..PAYLOAD` (phần được tính CRC). Trong frame, CRC truyền **HI trước, LO sau**.

| # | Ý nghĩa | Input (hex) | CRC16 |
|---|---------|-------------|-------|
| V1 | GET_IO SEQ=0 | `AA 00 01 00` | `0x6C20` |
| V2 | GET_IO SEQ=1 | `AA 00 01 01` | `0xACE1` |
| V3 | GET_IO SEQ=255 (wrap) | `AA 00 01 FF` | `0x2C60` |
| V4 | GET_DIAG SEQ=2 | `AA 00 20 02` | `0xFDB9` |
| V5 | HANDSHAKE SEQ=0, ver=0x0101, cap=0x0003 | `AA 04 30 00 01 01 00 03` | `0x019A` |
| V6 | SET_DO SEQ=3, mask=01, value=01 | `AA 02 11 03 01 01` | `0xBD54` |
| V7 | SET_DO SEQ=4, mask=03, value=01 | `AA 02 11 04 03 01` | `0x1CE4` |
| V8 | SET_AO SEQ=5, AO1=32768 | `AA 08 10 05 80 00 00 00 00 00 00 00` | `0x1EE3` |
| V9 | SET_AO_CFG SEQ=6, mode=0x02 | `AA 01 13 06 02` | `0x404E` |
| V10 | RESET_IO SEQ=7, reason=0x05 | `AA 01 40 07 05` | `0x03FE` |
| V11 | ACK SEQ=3, echo SET_DO | `AA 01 12 03 11` | `0x1D5D` |
| V12 | NACK SEQ=8, GET_IO + ERR_CRC_FAIL | `AA 02 FE 08 01 03` | `0x6A90` |

> **Yêu cầu:** Cả SW và FW PHẢI produce kết quả CRC giống nhau cho cùng input (unit test ≥10 vector
> mỗi phía — IOP-SW-010/IOP-FW-010, dùng đúng bảng này). Chạy cross-check test khi tích hợp lần đầu.
> Vector cũ `0x84C0`/`0x556B` trong tài liệu trước 2026-06-11 là **SAI** (không khớp thuật toán
> poly 0xA001/init 0xFFFF trong `iop_crc16()`) — đã thay bằng bảng trên.

### 10.2 Frame Encoding Examples

**GET_IO (SEQ=1):**
```
AA 00 01 01 <CRC_HI> <CRC_LO>
```

**IO_RESP (SEQ=1, 8× UI all=0, DI=0xFF, DO_FB=0x00, TEMP=25.0°C=250=0x00FA, FAULT=0, SAMPLE_CNT=100=0x0064):**
```
AA 22 02 01
00 00 00  00 00 00  00 00 00  00 00 00
00 00 00  00 00 00  00 00 00  00 00 00
FF 00 00 FA 00 00 00 64 00 00
<CRC_HI> <CRC_LO>
```

---

## 11. Open Issues (IOP)

| ID | Vấn đề | Owner | Target |
|----|--------|-------|--------|
| IOP-Q-001 | Safe state AO mode 4-20mA: 4mA (min) hay 0mA (dead)? Cần quyết định product. | Product Team | 2026-06-10 |
| IOP-Q-002 | SAMPLE_CNT uint16 wrap ở 65535 — có cần dùng uint32 không? | FW Team | 2026-06-05 |
| IOP-Q-003 | UART DMA buffer size cho MCU: 64 bytes đủ không? | FW Team | 2026-06-05 |
| IOP-Q-004 | Cần test ADUM1201 jitter ảnh hưởng đến CRC hay không? | HW Team | 2026-06-15 |

---

**Document ID:** IOP-SPEC-MK-DDC-24-VI  
**Revision:** 1.2 | 2026-06-15 (footer reconcile for §8/§9.1)  
**Approved by:** System Architect, SW Lead, FW Lead — KINEXUS Technologies

## Revision History
| Rev | Date | Changes |
|-----|------|---------|
| 1.2 | 2026-06-15 | §8/§9.1 reconcile: kinexus-io-driver → mkddc-iobus, /kinexus/io_data → /dev/shm/mkddc_io_shm (audit 2026-06-15) |
| 1.1 | 2026-06-11 | Contract Freeze: FAULT bit6 VDD_FAULT, RESET_IO reason table, sửa CRC vector |
| 1.0 | 2026-05-28 | Initial approved |
