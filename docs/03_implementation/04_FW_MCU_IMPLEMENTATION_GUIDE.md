# 04 — FW_MCU Implementation Guide
## MK-DDC-24 — Hướng dẫn lập trình firmware STM32G0B1RBT6

> **Document ID:** IMPL-FWMCU-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Owner:** Dev 1 (FW_MCU)
> **Nguồn-chuẩn:** [FW_DDD](../02_design/firmware/FW_DDD_MK-DDC-24_VI.md) ·
> [FW_PINOUT_MASTER](../02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) ·
> [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) ·
> [`shared/iop_protocol.h`](../../shared/iop_protocol.h)

---

## 0. Cách đọc file này

Mỗi module có format cố định:
```
Module / Mục tiêu / Input / Output / File cần viết / Luồng xử lý / Lỗi phải xử lý / Test / Done khi
```
Bắt đầu code theo thứ tự: §1 setup → io_sample → iop_comm → ao_output/do_control →
diagnostics/watchdog → drivers.

---

## 1. Setup chung (làm trước mọi module)

### 1.1 CubeMX
- Chip **STM32G0B1RBT6**, clock **64 MHz** (HSE 8MHz PF0/PF1 + PLL).
- Cấu hình chân **đúng từng dòng** [FW_PINOUT_MASTER §2](../02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md).
- Bật FreeRTOS (CMSIS-RTOS v2). DMA: USART1_RX/TX, SPI3_RX, SPI1_TX.
- USART1 = 921600 8N1, IDLE line interrupt + DMA RX circular.
- USART2 = 115200 8N1 (debug console).

### 1.2 Task table (FW_ARCH §2.1 — nguồn-chuẩn)

| Task | Priority | Period | Stack | File |
|------|----------|--------|-------|------|
| io_sample | 7 | 1 ms | 512 B | io_sample.c |
| iop_comm | 6 | event/10 ms | 1 KB | iop_comm.c |
| ao_output | 6 | 10 ms / queue | 512 B | ao_output.c |
| do_control | 6 | 10 ms / queue | 512 B | do_control.c |
| diagnostics | 2 | 1 s | 512 B | diagnostics.c |
| watchdog | 1 | 500 ms | 256 B | watchdog.c |

### 1.3 IPC nội MCU (FreeRTOS)
```
xIoDataMutex   — bảo vệ io_data_buf (io_sample ghi, iop_comm đọc)
xAoQueue(len=1)— ao_cmd_t  (iop_comm → ao_output)
xDoQueue(len=1)— do_cmd_t  (iop_comm → do_control)
fault_flags    — uint16, critical section (mọi task ghi, iop_comm đọc)
```

### 1.4 Luật bất di bất dịch
- KHÔNG `malloc` sau khi RTOS start (FW_CODING_STANDARD §4).
- ISR ngắn, chỉ `xTaskNotifyFromISR` / set DMA flag.
- Mọi HAL call check return; lỗi → set fault flag, không silent.
- Output mặc định an toàn: AO=0V/4mA, DO=open.

---

## 2. Module: `io_sample` (Pri 7, 1 ms)

```
Mục tiêu : Đọc 8 UI (ADS131M08) + 8 DI (opto), lọc, debounce, cập nhật io_data_buf.
Input    : SPI3 DMA RX (8×24-bit từ ADC); GPIO PB4..PB11 (DI); TIM 1ms notify.
Output   : io_data_buf{ ui_raw[8] (s24), di_mask (u8), sample_cnt (u16) } (mutex bảo vệ).
File     : fw/app/io_sample.c, fw/drivers/adc_drv.c, fw/drivers/gpio_drv.c
```
**Luồng xử lý:**
```
1. TIM 1ms ISR → xTaskNotifyFromISR(io_sample).
2. adc_drv_start_dma() đọc 8 kênh ADS131M08 (SPI3 DMA).
3. DMA TC callback → copy raw vào buffer tạm.
4. Moving average 8 mẫu/kênh (FW-IO-002); spike reject ±10% (FW-IO-003).
5. Đọc 8 GPIO DI → debounce (N mẫu liên tiếp) → di_mask (active-LOW sau opto → đảo).
6. Lock xIoDataMutex → ghi io_data_buf → unlock.
7. sample_cnt++ (wrap u16).
```
**Lỗi phải xử lý:**
```
- ADS131M08 không phản hồi 5ms (DRDY PA8 không lên / SPI timeout) → FAULT_FLAGS.ADC_FAULT;
  thử reinit ADC mỗi 1s.
- UI > 110% full scale → FAULT_FLAGS bit UI_OV (bit2 theo IOP spec §4.3.1).
```
**Test (T-FW-001 / group 1):**
```
- Cấp điện áp biết trước vào UI1 → raw đọc đúng tỉ lệ (sai số < 1%).
- Đóng/mở contact DI1 → di_mask bit0 đổi sau debounce, không rung.
- Rút SPI ADC → ADC_FAULT bật sau ≤5ms.
```
**Done khi:** 8 UI raw + 8 DI đọc đúng, sample_cnt tăng đều, budget < 200µs/chu kỳ, ADC_FAULT đúng.

---

## 3. Module: `iop_comm` (Pri 6, event/10 ms) — XƯƠNG SỐNG

```
Mục tiêu : Parse/build frame IOP, verify CRC/SEQ, dispatch CMD. Là hợp đồng với SOM.
Input    : UART1 RX bytes (DMA + IDLE) từ SOM.
Output   : UART1 TX frame (DMA); xAoQueue; xDoQueue; safe-state flag; diag counters.
File     : fw/app/iop_comm.c, fw/drivers/iop_drv.c, fw/common/crc16.c, fw/common/iop_protocol.h
```
**Luồng xử lý:**
```
1. Nhận byte qua UART1 DMA (circular) + IDLE-line IRQ báo "có frame".
2. Tìm SOF = 0xAA.
3. Đọc LEN (byte sau SOF).
4. Đọc đủ HDR(4) + PAYLOAD(LEN) + CRC(2) = LEN+6 byte.
5. Tính iop_crc16(SOF..PAYLOAD), so với CRC_HI/CRC_LO (big-endian).
6. CRC sai → NACK(ERR_CRC_FAIL) + iop_crc_err++ → bỏ frame.
7. Check LEN hợp lệ với CMD (vd GET_IO LEN=0). Sai → NACK(ERR_BAD_LEN).
8. Check CMD trong catalog. Lạ → NACK(ERR_UNKNOWN_CMD).
9. Echo SEQ vào response.
10. Dispatch:
    - GET_IO     → lock mutex, đọc io_data_buf, build IO_RESP (34B), TX.
    - SET_AO     → parse 4×u16 → ao_cmd_t → xAoQueue; trả ACK(0x10).
    - SET_DO     → parse mask+value → do_cmd_t → xDoQueue; trả ACK(0x11).
    - SET_AO_CFG → set AO mode pins PD1..PD4; trả ACK(0x13) (nếu chưa hỗ trợ: NACK UNKNOWN_CMD).
    - GET_DIAG   → build DIAG_RESP (20B), TX.
    - RESET_IO   → set safe-state flag, AO/DO về safe; trả ACK(0x40).
    - HANDSHAKE  → version negotiate, build HANDSHAKE_RESP (STATUS), TX.
11. Cập nhật iop_rx++; reset IOP-watchdog timer (đã nhận GET_IO).
```
**Lỗi phải xử lý:**
```
- CRC sai → NACK ERR_CRC_FAIL, counter++.
- SEQ: MCU LUÔN echo SEQ (không tự generate); không reject theo SEQ (đó là việc SOM).
- LEN không khớp CMD → NACK ERR_BAD_LEN.
- CMD lạ → NACK ERR_UNKNOWN_CMD.
- Đang safe-state mà nhận SET_AO/SET_DO → NACK ERR_SAFE_STATE.
- Không nhận GET_IO 200ms → set safe-state (phối hợp watchdog).
```
**Test (T-FW-IOP-001 / group 2):**
```
- Test vector CRC: {AA 00 01 00}→0x84C0; {AA 00 01 01}→0x556B (BẮT BUỘC khớp).
- GET_IO → IO_RESP đúng 34B, latency ≤ 5ms (đo bằng GPIO toggle + oscilloscope).
- SET_DO bật relay; SET_AO ra V đúng.
- Gửi frame CRC hỏng → nhận NACK ERR_CRC_FAIL.
```
**Done khi:**
```
- GET_IO trả IO_RESP trong ≤5ms.
- CRC sai bị reject + NACK.
- SET_DO bật relay thật; SET_AO xuất analog thật.
- Chạy 1000 GET_IO liên tục không lỗi.
```

---

## 4. Module: `ao_output` (Pri 6, 10 ms)

```
Mục tiêu : Nhận ao_cmd → ghi 4 kênh DAC8554, quản AO mode, safe-state AO.
Input    : ao_cmd_t từ xAoQueue (4×u16 raw); AO mode (từ SET_AO_CFG); safe-state flag.
Output   : SPI1 DMA → DAC8554; pulse LDAC (PB0); cập nhật AO mode pins PD1..PD4.
File     : fw/app/ao_output.c, fw/drivers/dac_drv.c
```
**Luồng xử lý:**
```
1. Chờ ao_cmd_t từ xAoQueue.
2. Validate mỗi kênh raw ∈ [0,65535] (FW-AO-006).
3. Ghi 4 kênh DAC8554 qua SPI1 DMA (mode 1, 8MHz).
4. Pulse LDAC (PB0 LOW→HIGH) update đồng bộ 4 kênh.
5. Nếu safe-state flag: bỏ qua queue, ghi safe value: V-mode→0 (raw0), mA-mode→13107 (4mA).
6. Hold-last khi mất IOP (KHÔNG tự về 0 trừ khi RESET_IO) (FW-AO-005).
```
**Lỗi phải xử lý:**
```
- DAC8554 không phản hồi SPI → FAULT_FLAGS.DAC_FAULT.
- raw ngoài [0,65535] → clamp + log.
```
**Test (T-FW-033 / group 1+2):**
```
- SET_AO raw=32768 mode 0-10V → đo ~5.0V.
- SET_AO_CFG bit0=1 (AO1→4-20mA) → safe-state ra 4mA (không 0).
- Trigger safe-state → AO về 0V/4mA ≤5ms.
```
**Done khi:** AO ra điện áp/dòng đúng đo bằng đồng hồ; safe-state đúng theo mode.

---

## 5. Module: `do_control` (Pri 6, 10 ms)

```
Mục tiêu : Ghi relay DO theo mask/value, đọc feedback, phát hiện stuck.
Input    : do_cmd_t từ xDoQueue {mask, value}; GPIO feedback.
Output   : GPIO PC0..PC3 (ULN2003 → relay); do_fb_mask; FAULT_FLAGS.RELAY_STUCK.
File     : fw/app/do_control.c, fw/drivers/gpio_drv.c
```
**Luồng xử lý:**
```
1. Chờ do_cmd_t từ xDoQueue.
2. Với mỗi bit i: nếu mask.bit_i=1 → ghi value.bit_i ra PC[i].
3. Sau 20ms đọc feedback GPIO → do_fb_mask.
4. Stuck-detect: fb ≠ cmd sau 20ms → FAULT_FLAGS.RELAY_STUCK (FW-DO-003).
5. Rate-limit ≤10 đóng/mở/giây/kênh (FW-DO-005); lifetime counter (FW-DO-006).
6. Safe-state: tất cả relay OPEN (value=0).
```
**Lỗi phải xử lý:**
```
- Feedback ≠ command → RELAY_STUCK bit.
- Quá rate-limit → bỏ lệnh thừa + log.
```
**Test (T-FW-042 / group 1+2):**
```
- SET_DO mask=0x0F value=0x05 → DO1,DO3 đóng; DO2,DO4 mở; feedback khớp.
- Giữ relay (giả stuck) → RELAY_STUCK bật.
- Safe-state → tất cả relay mở.
```
**Done khi:** relay thật đóng/mở đúng mask/value; feedback đúng; stuck-detect chạy.

---

## 6. Module: `diagnostics` (Pri 2, 1 s)

```
Mục tiêu : Đo nhiệt/VDD, duy trì counters, build DIAG_RESP.
Input    : ADC nội (temp die, VDD PA0); counters từ iop_comm.
Output   : DIAG_RESP payload (20B); FAULT_FLAGS.MCU_OVERTEMP/VDD.
File     : fw/app/diagnostics.c
```
**Luồng xử lý:**
```
1. Đọc MCU temp (internal ADC) + VDD.
2. Temp > 85°C → MCU_OVERTEMP + giảm sample rate xuống 100ms.
3. VDD ngoài [3.0,3.6]V → FAULT_FLAGS.VDD + ngừng AO.
4. Duy trì counters (rx, crc_err, seq_err, wdg_reset) trong SRAM backup.
5. Khi GET_DIAG: build DIAG_RESP {fw_ver, uptime, rx_cnt, crc_err, seq_err, wdg_cnt,
   adc_rate, temp_max, vdd_mv, reserved}.
```
**Test (group 2):** GET_DIAG → DIAG_RESP 20B; làm nóng MCU → MCU_OVERTEMP.
**Done khi:** DIAG_RESP đúng 20B, counters phản ánh đúng số frame/CRC error.

---

## 7. Module: `watchdog` (Pri 1, 500 ms)

```
Mục tiêu : Liveness check + kick IWDG; safe-state khi mất IOP; ghi nguyên nhân reset.
Input    : health flag của io_sample + iop_comm; IOP-watchdog timer; RCC_CSR.
Output   : kick IWDG; safe-state flag; FAULT_FLAGS.MCU_WATCHDOG_RESET; FAULT_OUT PD5.
File     : fw/app/watchdog.c, fw/drivers/wdg_drv.c
```
**Luồng xử lý:**
```
1. IWDG timeout 1s. Chỉ kick khi io_sample + iop_comm còn sống (health flag set mỗi chu kỳ).
2. WWDG cho iop_comm (FW-WDG-004).
3. Không nhận GET_IO 200ms (IOP_SAFE_TIMEOUT_MS) → set safe-state flag → AO/DO về safe.
4. Sau reset: đọc RCC_CSR → nếu watchdog reset → set sticky MCU_WATCHDOG_RESET (clear khi SOM đọc).
5. PERMANENT_FAULT (VDD/ADC init fail): KHÔNG kick IWDG → HW reset.
```
**Test (T-FW-054 / group 1):**
```
- Treo io_sample giả → IWDG reset trong ~1s.
- Ngừng gửi GET_IO → MCU safe-state sau 200ms.
- Sau watchdog reset → DIAG WDG_RESET_CNT tăng, IO_RESP FAULT bit5 set.
```
**Done khi:** IWDG reset đúng khi treo; safe-state khi mất GET_IO 200ms; counter reset đúng.

---

## 8. Driver modules (HAL/DMA wrapper)

| Module | File | Mục tiêu | Input | Output | Done khi |
|--------|------|----------|-------|--------|----------|
| `adc_drv` | adc_drv.c | ADS131M08 SPI3+DMA, config registers | SPI3 | 8×s24 raw | đọc 8 kênh đúng, DRDY interrupt PA8 |
| `dac_drv` | dac_drv.c | DAC8554 SPI1+DMA, LDAC sync | 4×u16 | analog out | 4 kênh ra đúng, LDAC update đồng bộ |
| `iop_drv` | iop_drv.c | USART1 DMA RX(circular)+IDLE, TX DMA | bytes | frame | RX/TX DMA không mất byte @921600 |
| `gpio_drv` | gpio_drv.c | DI read, DO write, mux select, AO mode | GPIO | levels | DI/DO/mux đúng pinout |

> ⚠️ `adc_drv` PHẢI ghi config ADS131M08 qua SPI3_MOSI (PC12) — đọc-only không đủ.

---

## 9. Thứ tự implement đề xuất (cho Dev 1)

```
1. Setup CubeMX + blink LED (Phase 0).            → §1
2. crc16.c + Unity test (khớp test vector).        → §3 (CRC trước)
3. gpio_drv + do_control (relay là dễ verify nhất).→ §5,§8
4. adc_drv + io_sample (UI/DI).                    → §2,§8
5. dac_drv + ao_output.                            → §4,§8
6. iop_drv + iop_comm (ghép IOP — cross-test SOM). → §3,§8
7. diagnostics + watchdog + safe-state.            → §6,§7
```

---

## 10. Bảng trace REQ → module → test

| REQ | Module | Test |
|-----|--------|------|
| FW-IO-001..024 | io_sample | T-FW-001, group 1 |
| IOP-FW-001..010 | iop_comm | T-FW-IOP-001, group 2 |
| FW-AO-001..009 | ao_output | T-FW-033, group 1/2 |
| FW-DO-001..006 | do_control | T-FW-042, group 1/2 |
| FW-DIAG-001..006 | diagnostics | group 2 |
| FW-WDG-001..006 | watchdog | T-FW-054, group 1 |

---
**Rev** 1.0 | 2026-06-10 · DoD đầy đủ: [12_DEFINITION_OF_DONE §1](12_DEFINITION_OF_DONE.md)
