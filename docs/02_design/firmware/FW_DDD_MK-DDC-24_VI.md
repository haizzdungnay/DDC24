# Firmware Detailed Design — MK-DDC-24
## MCU STM32G0B1RBT6 / FreeRTOS (IEEE 1016)

> **Document ID:** DDD-FW-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30
> **Trạng thái:** Approved (Owner 2026-06-08) (DP-0 skeleton có decomposition) — chi tiết module bổ sung ở DP-2
> **Owner:** Firmware Team
> 📘 [README](../../01_specs/README.md) · Nâng từ `FW_ARCH_SPEC` · Trace `FW_REQUIREMENTS`, `SWFW_INTERFACE_SPEC`

---

## 1. Mục đích & Phạm vi
Thiết kế chi tiết firmware MCU: phân rã module, interface nội bộ, dữ liệu, thuật toán hot-path, fault/safe-state. **Trace:** toàn bộ `FW-*` requirement + `IOP-FW-*`.
Không bao gồm: app SOM, schematic.

## 2. Bối cảnh & ràng buộc
- MCU STM32G0B1RBT6 @64MHz, 128KB Flash/144KB SRAM; pinout = **[D-1 FW_PINOUT_MASTER](FW_PINOUT_MASTER_MK-DDC-24_VI.md)**.
- Real-time cứng: ADC sampling 1ms; IOP response ≤5ms.
- Không dynamic alloc sau RTOS start (coding std §4).
- Ngoại vi: SPI3↔ADS131M08, SPI1↔DAC8554, USART1↔SOM (IOP), GPIO DI/DO/mux.

## 3. Phân rã module
```
            ┌──────────────────────── app layer (FreeRTOS tasks) ───────────────────────┐
            │ io_sample · iop_comm · ao_output · do_control · diagnostics · watchdog     │
            └───────────────┬──────────────────┬───────────────────┬────────────────────┘
                   ┌─────────▼──────┐  ┌────────▼────────┐  ┌───────▼────────┐
   driver layer    │ adc_drv (SPI3) │  │ dac_drv (SPI1)  │  │ iop_drv (UART) │  gpio_drv · wdg_drv
                   └────────────────┘  └─────────────────┘  └────────────────┘
                                   STM32 HAL/LL + DMA + DMAMUX
```

| Module | Trách nhiệm | Task/Driver | Trace |
|--------|-------------|-------------|-------|
| `io_sample` | đọc ADS131M08, lọc, đọc+debounce DI | task Pri7 1ms | FW-IO-001..024 |
| `iop_comm` | parse/build frame IOP, CRC, SEQ, dispatch | task Pri6 10ms | IOP-FW-001..010 |
| `ao_output` | nhận ao_cmd → ghi DAC8554, mode select | task Pri6 10ms | FW-AO-001..009 |
| `do_control` | ghi relay, đọc feedback, stuck-detect | task Pri6 10ms | FW-DO-001..006 |
| `diagnostics` | temp/VDD/counters, self-test | task Pri2 1s | FW-DIAG-001..006 |
| `watchdog` | liveness check + IWDG kick | task Pri1 500ms | FW-WDG-001..006 |
| `adc_drv/dac_drv/iop_drv/gpio_drv` | HAL+DMA wrapper | driver | — |
| `bootloader hook` | nhận lệnh OTA, jump system bootloader | — | FW-OTA-001..005 |

## 4. Thiết kế chi tiết module

### 4.1 `io_sample` (Pri 7, 1 ms) — hot-path
- **Trigger:** TIM-based 1ms (xTaskNotifyFromISR).
- **Luồng:** start SPI3 DMA đọc 8×24-bit → DMA TC callback ghi `io_data_buf` (bảo vệ `xIoDataMutex`); đọc 8 GPIO DI → debounce; tăng `sample_cnt`.
- **Filter:** moving average 8 mẫu (FW-IO-002); spike reject ±10% (FW-IO-003).
- **Lỗi:** ADS131M08 không phản hồi 5ms → `FAULT_FLAGS.ADC_FAULT`; thử reinit mỗi 1s (FW-IO-006/008).
- **Tài nguyên:** stack 512B; budget < 200 µs/chu kỳ.
- **Data:** `io_data_t` (xem FW_ARCH §4.1).

### 4.2 `iop_comm` (Pri 6, 10 ms / event) — hợp đồng [SWFW_INTERFACE_SPEC]
- **RX:** UART IDLE + DMA → frame; verify CRC-16/Modbus (cross-test với SOM, IOP-FW-010); check SEQ; dispatch theo CMD.
- **Dispatch:** `GET_IO`→build `IO_RESP` từ `io_data_buf`; `SET_AO`→`xAoQueue`; `SET_DO`→`xDoQueue`; `SET_AO_CFG`→set AO mode pins; `RESET_IO`→safe-state flag; `HANDSHAKE`→version negotiate; lỗi→`NACK`.
- **TX:** DMA; latency GET_IO→IO_RESP ≤5ms (FW-IOP-003).
- **Watchdog IOP:** không nhận GET_IO 200ms → safe-state (FW-WDG-005).
- **Lỗi:** CRC/SEQ/len → NACK + counter (DIAG_RESP).

### 4.3 `ao_output` (Pri 6, 10 ms)
- nhận `ao_cmd_t` từ `xAoQueue`; validate [0,65535] (FW-AO-006); ghi 4 kênh DAC8554 (SPI1 DMA) rồi pulse LDAC (PB0) update đồng bộ.
- safe-state: V-mode→0V; mA-mode→4mA (protocol raw 0x0000 — SWFW §6.3; DAC count nội bộ ≈13107 nếu span 0–20mA) (FW-AO-009).
- hold-last khi mất IOP (không tự về 0 trừ RESET_IO) (FW-AO-005).

### 4.4 `do_control` (Pri 6, 10 ms)
- nhận `do_cmd_t`; áp mask/value lên PC0–PC3; đọc feedback GPIO → `do_fb_mask`.
- stuck-detect: fb≠cmd sau 20ms → `RELAY_STUCK` (FW-DO-003).
- rate-limit ≤10 đóng/mở/s/kênh (FW-DO-005); lifetime counter (FW-DO-006).
- safe-state: tất cả OPEN.

### 4.5 `diagnostics` (Pri 2, 1 s)
- đo MCU temp (internal ADC) + VDD; ngưỡng 85°C→`MCU_OVERTEMP`+giảm sample 100ms; VDD ngoài [3.0,3.6]→fault, ngừng AO.
- duy trì counters (rx/crc/seq/wdg) trong SRAM backup.

### 4.6 `watchdog` (Pri 1, 500 ms)
- IWDG timeout 1s; chỉ kick khi `io_sample`+`iop_comm` còn sống (health flag). WWDG cho `iop_comm` (FW-WDG-004).
- sau reset: đọc RCC_CSR → lưu nguyên nhân → `MCU_WATCHDOG_RESET`.

### 4.7 Bootloader/OTA hook
- Bình thường chạy app. Khi SOM cần nạp MCU: SOM kéo BOOT0=HIGH + nRESET → MCU vào ROM bootloader (AN3155 UART). App đảm bảo safe-state trước (FW-OTA-002). Chi tiết → **D-7** (firmware/FW_BOOTLOADER_OTA).

## 5. Concurrency & timing
- Bảng priority/period/stack: **FW_ARCH §2.1** (nguồn-chuẩn). Mutex/queue: **§2.2**.
- IPC nội MCU: `xIoDataMutex`, `xAoQueue(1)`, `xDoQueue(1)`, critical section cho `fault_flags`.
- Budget chu kỳ: io_sample <200µs, iop_comm <1ms, không lock dài trên hot-path.

## 6. Fault & Safe-State (FSM)
- FSM: `INIT→HANDSHAKE→NORMAL → {IOP_FAULT, SAFE_STATE, PERMANENT_FAULT}` (FW_ARCH §7).
- Safe-state values: AO=0V/4mA, DO=open (IOP-SPEC §6.3).
- PERMANENT_FAULT (VDD/ADC init fail): không kick IWDG → HW reset.

## 7. Ma trận truy vết (trích)
| REQ | Design unit | Test |
|-----|-------------|------|
| FW-IO-001 | §4.1 | T-FW-001 |
| IOP-FW-004 | §4.2 | T-FW-IOP-001 |
| FW-AO-009 | §4.3 | T-FW-033 |
| FW-DO-003 | §4.4 | T-FW-042 |
| FW-WDG-005 | §4.6 | T-FW-054 |
| FW-OTA-001 | §4.7 / D-7 | T-FW-080 |

## 8. Open points
| ID | Vấn đề | Owner | Hạn |
|----|--------|-------|-----|
| FW-Q-004 | DRDY interrupt vs polling cho ADC | FW+HW | Sprint 2 |
| — | DMAMUX channel map (verify CubeMX) | FW | Sprint 1 |
| — | Module designs riêng (io_sample, iop_comm…) ở DP-2 | FW | DP-2 |

---
**Rev** 1.0 | 2026-05-30
