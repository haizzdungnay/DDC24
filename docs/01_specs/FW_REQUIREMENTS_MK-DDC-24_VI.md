# Firmware Requirements Specification — MK-DDC-24
## MCU STM32G0B1RBT6 / FreeRTOS

> **Document ID:** FW-REQ-MK-DDC-24-VI  
> **Phiên bản:** 1.0 | 2026-05-28  
> **Trạng thái:** Approved (Owner 2026-06-08)
> 📘 **Đọc cùng:** [README](README.md) — hướng dẫn + glossary · Đã đồng bộ **2026-05-30** (xem [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md))  
> **Tác giả:** KINEXUS Technologies — Firmware Team  
> **Nguồn gốc:** Trace từ SRS-MK-DDC-24-VI, HW-SPEC-MK-DDC-24-VI, IOP-SPEC-MK-DDC-24-VI

**Quy ước mức độ:**
- **MUST** — Bắt buộc hoàn toàn. Thiếu = release fail.
- **SHOULD** — Nên có. Nếu không, cần giải trình.
- **MAY** — Tùy chọn.

---

## 1. Phạm vi

Tài liệu này định nghĩa requirements cho **MCU firmware** chạy trên STM32G0B1RBT6 trong MK-DDC-24. Không bao gồm OS/application layer trên SOM.

---

## 2. I/O Sampling Requirements

### 2.1 ADC Sampling (Universal Input UI1–UI8)

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-IO-001 | PHẢI sample tất cả 8 kênh UI từ ADS131M08 qua SPI3 với chu kỳ ≤ 1ms (≥ 1000 sps) | MUST | T-FW-001 |
| FW-IO-002 | PHẢI áp dụng moving average filter 8 samples trước khi đưa vào IOP buffer | MUST | T-FW-002 |
| FW-IO-003 | PHẢI detect và reject outlier vượt ±10% range trong 1 sample (spike filter) | SHOULD | T-FW-003 |
| FW-IO-004 | ADC raw value PHẢI là uint24 (big-endian) theo định nghĩa ADS131M08 output register | MUST | T-FW-004 |
| FW-IO-005 | PHẢI giữ timestamp (tick) của sample cuối cùng hợp lệ | MUST | T-FW-005 |
| FW-IO-006 | Nếu ADS131M08 không trả lời trong 5ms liên tiếp: set `FAULT_FLAGS.ADC_FAULT = 1`, báo qua IOP | MUST | T-FW-006 |
| FW-IO-007 | SPI giao tiếp với ADS131M08 PHẢI dùng DMA (không blocking polling) | MUST | T-FW-007 |
| FW-IO-008 | PHẢI recover tự động sau ADC_FAULT: thử reinit ADS131M08 mỗi 1 giây | SHOULD | T-FW-008 |

### 2.2 Auto-Detection Sensor Type

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-IO-010 | PHẢI implement thuật toán auto-detect sensor type khi boot hoặc khi nhận lệnh từ SOM | MUST | T-FW-010 |
| FW-IO-011 | Auto-detect PHẢI thực hiện theo thứ tự: (1) đo điện trở tĩnh, (2) đo điện áp DC, (3) đo current signature | MUST | T-FW-011 |
| FW-IO-012 | Threshold auto-detect (dải điện trở → sensor type): xem Bảng 2.2.1 | MUST | T-FW-012 |
| FW-IO-013 | Sau khi auto-detect, MCU PHẢI báo kết quả cho SOM qua `DIAG_RESP.SENSOR_TYPE_MAP` (reserved field — xem IOP SPEC) | SHOULD | T-FW-013 |
| FW-IO-014 | MCU PHẢI nhận lệnh override sensor type từ SOM (qua command được bổ sung sau) và ưu tiên override | MUST | T-FW-014 |

#### Bảng 2.2.1 — Auto-detect Threshold

| Điện trở đo | → Sensor Type |
|------------|--------------|
| < 200 Ω | Short / wire → dry contact / DI mode |
| 200 Ω – 2 kΩ | PT100 (nominal 100Ω @ 0°C) |
| 2 kΩ – 4 kΩ | PT1000 (nominal 1kΩ @ 0°C) |
| 8 kΩ – 12 kΩ | NTC 10kΩ |
| 16 kΩ – 24 kΩ | NTC 20kΩ |
| Điện áp 0–10V present | 0–10V analog |
| Current loop detected | 4–20mA |
| > 100 kΩ | Open / not connected |

### 2.3 Debounce (Digital Input DI1–DI8)

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-IO-020 | PHẢI implement phần mềm debounce cho DI1–DI8 | MUST | T-FW-020 |
| FW-IO-021 | Debounce time mặc định: 20ms (configurable 5ms–100ms qua SOM command) | MUST | T-FW-021 |
| FW-IO-022 | State change chỉ được ghi nhận khi tín hiệu ổn định liên tục trong suốt debounce window | MUST | T-FW-022 |
| FW-IO-023 | MCU PHẢI detect edge (R_TRIG / F_TRIG) và đếm pulse (counter per kênh) | SHOULD | T-FW-023 |
| FW-IO-024 | Counter DI PHẢI là uint16, gửi trong IO_RESP nếu được bật (hiện IOP v1 chưa có — flag cho v1.1) | MAY | — |

---

## 3. Analog Output (AO) Requirements

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-AO-001 | PHẢI ghi giá trị AO1–AO4 xuống DAC8554 qua SPI1 trong ≤ 5ms sau khi nhận SET_AO từ SOM | MUST | T-FW-030 |
| FW-AO-002 | DAC SPI PHẢI dùng DMA (không blocking) | MUST | T-FW-031 |
| FW-AO-003 | Nếu DAC8554 không respond (SPI timeout): set `FAULT_FLAGS.DAC_FAULT = 1` | MUST | T-FW-032 |
| FW-AO-004 | Khi vào safe state: AO PHẢI output safe value trong ≤ 5ms | MUST | T-FW-033 |
| FW-AO-005 | PHẢI hold last AO value nếu mất kết nối IOP (không tự về 0 trừ khi nhận RESET_IO) | MUST | T-FW-034 |
| FW-AO-006 | PHẢI validate raw value: uint16 trong [0, 65535]. Nếu ngoài range → NACK + log | MUST | T-FW-035 |
| FW-AO-007 | PHẢI nhận và lưu cấu hình AO mode per kênh qua IOP command `SET_AO_CFG` (v1.1): mode=0→0–10V, mode=1→4–20mA | MUST | T-FW-036 |
| FW-AO-008 | Mặc định khi boot (trước khi nhận `SET_AO_CFG`): tất cả AO kênh ở mode 0–10V | MUST | T-FW-037 |
| FW-AO-009 | Safe state khi mode 0–10V: AO = 0V (protocol raw=0); khi mode 4–20mA: AO = 4mA (protocol raw=0 theo SWFW §6.3 — nếu DAC vật lý span 0–20mA, FW quy đổi nội bộ ≈ count 13107) | MUST | T-FW-038 |

> **Ghi chú:** `SET_AO_CFG` là IOP command mới, dự kiến IOP v1.1. Đến khi v1.1 có hiệu lực, SOM gửi mode config ngay sau HANDSHAKE. Xem OPEN-ISSUES IOP-Q-004.

---

## 4. Digital Output / Relay (DO) Requirements

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-DO-001 | PHẢI điều khiển relay DO1–DO4 trong ≤ 5ms sau khi nhận SET_DO từ SOM | MUST | T-FW-040 |
| FW-DO-002 | PHẢI đọc relay feedback (pin GPIO kiểm tra trạng thái coil) và set `DO_FB_MASK` trong IO_RESP | MUST | T-FW-041 |
| FW-DO-003 | Nếu DO_FB không khớp lệnh sau 20ms: set `FAULT_FLAGS.RELAY_STUCK = 1` | MUST | T-FW-042 |
| FW-DO-004 | Khi vào safe state: tất cả relay PHẢI về OPEN (de-energized) | MUST | T-FW-043 |
| FW-DO-005 | PHẢI limit relay switching: không cho phép đóng/mở quá 10 lần/giây per kênh (relay protection) | SHOULD | T-FW-044 |
| FW-DO-006 | PHẢI ghi relay switch counter per kênh (lifetime counter) | SHOULD | T-FW-045 |

---

## 5. Watchdog Requirements

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-WDG-001 | PHẢI dùng IWDG (Independent Watchdog) timeout = 1 giây | MUST | T-FW-050 |
| FW-WDG-002 | PHẢI kick IWDG trong `watchdog_task` mỗi 500ms | MUST | T-FW-051 |
| FW-WDG-003 | `watchdog_task` PHẢI verify rằng `io_sample_task` và `iop_comm_task` đang chạy trước khi kick IWDG (task health check) | MUST | T-FW-052 |
| FW-WDG-004 | PHẢI dùng WWDG (Window Watchdog) cho `iop_comm_task` — cửa sổ window 80–100% (kick quá sớm cũng fault) | SHOULD | T-FW-053 |
| FW-WDG-005 | PHẢI detect IOP communication timeout: nếu không nhận GET_IO trong 200ms → apply safe state (AO=0, DO=open) | MUST | T-FW-054 |
| FW-WDG-006 | Sau watchdog reset: PHẢI ghi nguyên nhân (RCC_CSR) vào SRAM backup vùng không xóa và báo qua IOP FAULT_FLAGS | MUST | T-FW-055 |

---

## 6. Diagnostics Requirements

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-DIAG-001 | PHẢI đo MCU die temperature qua internal ADC channel và cập nhật mỗi 1 giây | MUST | T-FW-060 |
| FW-DIAG-002 | Nếu MCU_TEMP > 85°C: set `FAULT_FLAGS.MCU_OVERTEMP = 1` và reduce ADC sampling rate tới 100ms | MUST | T-FW-061 |
| FW-DIAG-003 | PHẢI đo VDD voltage qua internal reference và báo trong DIAG_RESP | MUST | T-FW-062 |
| FW-DIAG-004 | Nếu VDD < 3.0V hoặc > 3.6V: set fault và ngừng AO output | MUST | T-FW-063 |
| FW-DIAG-005 | PHẢI count: IOP_RX_CNT, IOP_CRC_ERR, IOP_SEQ_ERR, WDG_RESET_CNT (xem DIAG_RESP field) | MUST | T-FW-064 |
| FW-DIAG-006 | Counters PHẢI lưu trong SRAM backup (survive soft reset, clear on factory reset) | SHOULD | T-FW-065 |

---

## 7. IOP Communication Requirements

> **Tham chiếu đầy đủ:** `IOP-SPEC-MK-DDC-24-VI`

| ID | Yêu cầu | Loại | Trace |
|----|---------|------|-------|
| FW-IOP-001 | PHẢI implement IOP Slave protocol theo `IOP-SPEC-MK-DDC-24-VI` | MUST | IOP-FW-001 |
| FW-IOP-002 | PHẢI dùng UART DMA cho TX và RX | MUST | IOP-FW-002 |
| FW-IOP-003 | Response latency GET_IO → IO_RESP: ≤ 5ms | MUST | IOP-FW-004 |
| FW-IOP-004 | PHẢI verify CRC-16/Modbus mọi frame nhận | MUST | IOP-FW-007 |
| FW-IOP-005 | PHẢI trả NACK cho frame CRC fail hoặc unknown CMD | MUST | IOP-FW-008 |
| FW-IOP-006 | PHẢI implement HANDSHAKE và version check | MUST | IOP-FW-009 |
| FW-IOP-007 | MCU-side IOP watchdog: safe state nếu không nhận GET_IO trong 200ms | MUST | IOP-FW-006 |

---

## 8. Boot & Initialization Requirements

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-BOOT-001 | PHẢI khởi tạo xong và sẵn sàng trả IO_RESP trong ≤ 500ms sau Power-On-Reset | MUST | T-FW-070 |
| FW-BOOT-002 | Thứ tự init: (1) Clocks/GPIO, (2) UART DMA, (3) SPI ADC+DAC, (4) FreeRTOS start | MUST | T-FW-071 |
| FW-BOOT-003 | PHẢI đọc RCC_CSR để phát hiện nguyên nhân reset trước và lưu vào fault log | MUST | T-FW-072 |
| FW-BOOT-004 | PHẢI thực hiện self-test ADC: đọc internal reference voltage → verify ±5% | MUST | T-FW-073 |
| FW-BOOT-005 | Nếu self-test fail: không apply bất kỳ AO/DO; báo fault qua IOP FAULT_FLAGS | MUST | T-FW-074 |

---

## 9. Firmware Update Requirements

| ID | Yêu cầu | Loại | Test Ref |
|----|---------|------|---------|
| FW-OTA-001 | PHẢI hỗ trợ firmware update qua SOM (SOM flash MCU qua UART bootloader hoặc SWD) | MUST | T-FW-080 |
| FW-OTA-002 | Trong quá trình MCU flashing: tất cả output PHẢI ở safe state trước khi SOM bắt đầu | MUST | T-FW-081 |
| FW-OTA-003 | Sau khi flash xong: MCU reset tự động; khởi động lại trong ≤ 5 giây | MUST | T-FW-082 |
| FW-OTA-004 | PHẢI verify CRC của image mới trước khi jump vào | MUST | T-FW-083 |
| FW-OTA-005 | Nếu CRC fail sau flash: giữ nguyên firmware cũ (bootloader không overwrite) | MUST | T-FW-084 |

---

## 10. Memory & Performance Budget

| Tài nguyên | Budget | Ghi chú |
|-----------|--------|---------|
| **Flash** | ≤ 96 KB / 128 KB | 32 KB reserve cho debug/config |
| **SRAM total** | ≤ 28 KB / 144 KB | 8 KB reserve cho stack overflow guard |
| **IOP task stack** | 512 bytes | |
| **ADC task stack** | 512 bytes | |
| **AO task stack** | 256 bytes | |
| **DO task stack** | 256 bytes | |
| **Diagnostics task stack** | 256 bytes | |
| **Watchdog task stack** | 128 bytes | |
| **FreeRTOS kernel overhead** | ~2 KB | |

---

**Document ID:** FW-REQ-MK-DDC-24-VI  
**Revision:** 1.0 | 2026-05-28  
**Approved by:** Firmware Lead, System Architect — KINEXUS Technologies
