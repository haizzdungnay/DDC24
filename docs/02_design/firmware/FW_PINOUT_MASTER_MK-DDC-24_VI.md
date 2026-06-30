# FW Pinout Master — STM32G0B1RBT6 (LQFP-64)
## MK-DDC-24 — D-1

> **Document ID:** DDD-PINOUT-MK-DDC-24-VI
> **Phiên bản:** 2.0 | 2026-06-30
> **Trạng thái:** Approved for Rev A (ADR-010; owner re-sign required at schematic release)
> 📘 [README](../../01_specs/README.md) · Đồng bộ: `hardware-design/05_mcu_io/MCU_STM32G0_SPEC.md §3`

> ⭐ **NGUỒN-CHUẨN DUY NHẤT cho chân MCU.** Schematic (`CB_SCHEMATIC_NOTES`), block diagram, CubeMX `.ioc`, và firmware HAL init **PHẢI** khớp bảng này. Mọi thay đổi qua DR gate + bump version.

---

## 1. Ràng buộc chọn part
- **STM32G0B1RBT6**, Cortex-M0+ @ 64 MHz, 128 KB Flash, 144 KB SRAM, **3× SPI**, **2× DMA controller** + DMAMUX, LQFP-64. Pin-compatible STM32G071RB.
- Lý do đủ chân: cần đồng thời USART1(IOP)+SPI1(DAC)+SPI3(ADC) chạy DMA → 3 SPI + 2 DMA là điều kiện cần (đã chốt IOP-Q-R006).

---

## 2. Bảng phân bổ chân (authoritative)

### 2.1 Giao tiếp & SPI
| Chức năng | Tín hiệu | Pin | AF/Mode | DMA | Ghi chú |
|-----------|----------|-----|---------|-----|---------|
| IOP UART (→SOM) | USART1_TX | PA9 | AF1 | DMA ch (TX) | 921.6k 8N1, nối CM3 UART2_RX |
| IOP UART (←SOM) | USART1_RX | PA10 | AF1 | DMA ch (RX) | nối CM3 UART2_TX, IDLE-line IRQ |
| Debug UART | USART2_TX | PA2 | AF1 | — | 115.2k |
| Debug UART | USART2_RX | PA3 | AF1 | — | (cũng là đường nạp bootloader option) |
| DAC8554 | SPI1_SCK | PA5 | AF0 | — | 8 MHz, Mode 1 |
| DAC8554 | SPI1_MOSI | PA7 | AF0 | DMA ch (TX) | DIN |
| DAC8554 | SPI1_NSS | PA4 | GPIO | — | SYNC (CS, active LOW) |
| DAC8554 | DAC_LDAC | PB0 | GPIO | — | pulse LOW → update đồng bộ 4 kênh |
| ADS131M08 | SPI3_SCK | PC10 | AF | — | 4 MHz, Mode 1 |
| ADS131M08 | SPI3_MISO | PC11 | AF | DMA ch (RX) | DOUT |
| ADS131M08 | SPI3_MOSI | PC12 | AF | — | DIN/SDI (ghi config — **bắt buộc**) |
| ADS131M08 #1 | SPI3_CS1 | PB2 | GPIO | — | pull-up 10k |
| ADS131M08 #1 | ADC1_DRDY | PA8 | EXTI | — | interrupt data-ready |
| ADS131M08 #2 | SPI3_CS2 | PA15 | GPIO | — | pull-up 10k; not part of two-wire SWD |
| ADS131M08 #2 | ADC2_DRDY | PA6 | EXTI | — | interrupt data-ready |

### 2.2 Universal Input per-channel mode latch

Base Rev A has 16 analog UI channels and no dedicated 8-DI bank. The retired PB4-PB11 DI mapping is forbidden unless a separately approved isolated-DI SKU is designed.

| Signal | Pin | Mode | Function |
|---|---|---|---|
| UI_MODE_DATA | PB12 | GPIO OUT | Serial data for 48-bit mode-latch chain |
| UI_MODE_CLK | PB13 | GPIO OUT | Shift clock |
| UI_MODE_LATCH | PB14 | GPIO OUT | Output register/latch clock |
| UI_MODE_OE | PB15 | GPIO OUT | Safe output enable; active level follows selected latch |

### 2.3 Digital Output (ULN2003 → relay ×4)
| Kênh | Pin | Kênh | Pin |
|------|-----|------|-----|
| DO1_DRV | PC0 | DO3_DRV | PC2 |
| DO2_DRV | PC1 | DO4_DRV | PC3 |

### 2.4 Retired direct UI enable/select pins

The shared `UI_SEL_S0..S2` and direct `UI_EN0..15` architecture is retired. `PC4-PC9`, `PC13`, `PC15`, and `PB4-PB11` are NC/reserved by default. Any reuse requires one controlled pinout change across this file, `MCU_STM32G0_SPEC.md`, schematic, CubeMX `.ioc`, firmware, and tests.

### 2.5 AO mode-select (relay/analog-switch ×4, phần mềm — SET_AO_CFG)
| Kênh | Pin | 0 = 0–10V, 1 = 4–20mA |
|------|-----|------------------------|
| AO1_MODE | PD1 | |
| AO2_MODE | PD2 | |
| AO3_MODE | PD3 | |
| AO4_MODE | PD4 | |

### 2.6 ADC nội (giám sát) & Misc
| Chức năng | Pin | Ghi chú |
|-----------|-----|---------|
| ADC_IN0 (VCC_5V/3) | PA0 | giám sát nguồn |
| ADC_IN1 (board NTC) | PA1 | nhiệt độ board |
| FAULT_OUT → CM3 | PD5 | OUT, → CM3 GPIO0_A6 |
| MCU_LED (alive) | PD6 | blink 1 Hz |
| nRESET ← CM3 | NRST | CM3 GPIO0_A4 reset MCU |
| BOOT0 | BOOT0 | pull-down 10k; CM3 kéo HIGH để vào bootloader (OTA) |
| SWDIO / SWCLK | PA13 / PA14 | debug header 5-pin |
| HSE crystal | PF0 / PF1 | OSC_IN/OUT 8 MHz, <= +/-20 ppm; load capacitors calculated from selected crystal CL + stray capacitance |

### 2.7 Chân dự phòng (spare)
PB1, PB3, PD0, PC14 và các chân PF còn lại là spare. `PC4-PC9`, `PC13`, `PC15`, `PB4-PB11` là **NC/reserved** from retired UI/DI mappings; they are not general spare pins until an approved change releases them.

---

## 3. Bảng tổng hợp theo port (để cross-check, tránh đụng chân)

| Port | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|------|---|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|
| **PA** | ADCin0 | ADCin1 | dbgTX | dbgRX | DAC_CS | DAC_SCK | ADC2_DRDY | DAC_MOSI | ADC1_DRDY | IOP_TX | IOP_RX | — | — | SWDIO | SWCLK | ADC2_CS |
| **PB** | LDAC | spare | ADC1_CS | spare | NC | NC | NC | NC | NC | NC | NC | NC | MODE_DATA | MODE_CLK | MODE_LATCH | MODE_OE |
| **PC** | DO1 | DO2 | DO3 | DO4 | NC | NC | NC | NC | NC | NC | SPI3_SCK | SPI3_MISO | SPI3_MOSI | NC | spare | NC |
| **PD** | spare | AO1mode | AO2mode | AO3mode | AO4mode | FAULT | LED | — | — | — | — | — | — | — | — | — |
| **PF** | OSC_IN | OSC_OUT | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

> ✅ Không có chân nào trùng chức năng. Cần verify lại bằng STM32CubeMX `.ioc` khi bring-up (một số AF mapping cần chọn đúng kênh DMAMUX).

---

## 4. Phân bổ DMA (DMAMUX)
| Kênh dùng DMA | Hướng | Mục đích |
|---------------|-------|----------|
| USART1_RX | RX | nhận frame IOP (IDLE+DMA) |
| USART1_TX | TX | gửi frame IOP |
| SPI3_RX | RX | đọc 24 byte ADS131M08/chu kỳ 1ms |
| SPI1_TX | TX | ghi DAC8554 |

> STM32G0B1 có DMA1 + DMA2 + DMAMUX → đủ 4 luồng trên không tranh chấp. Map cụ thể chốt khi cấu hình CubeMX (đóng FW-Q-001 mức P3).

---

## 5. Trace REQ
| Pin group | Trace |
|-----------|-------|
| IOP UART | IOP-FW-002, FW-IOP-002 |
| SPI3 ADC | FW-IO-001, FW-IO-007 |
| SPI1 DAC | FW-AO-002 |
| UI mode latch | FW-IO-001, ADR-010 |
| DO | FW-DO-001 |
| AO mode | FW-AO-007 (SET_AO_CFG) |
| BOOT0/nRESET | FW-OTA-001 (CM3 nạp MCU) |
| FAULT_OUT | FW-WDG-006 |

---
## Revision History

| Rev | Date | Change |
|---|---|---|
| 1.0 | 2026-05-30 | Initial 8 UI + 8 DI pinout. |
| 2.0 | 2026-06-30 | Rev A: 16 UI, second ADS131M08 CS/DRDY, per-channel mode latch, retired DI/direct UI-enable pins. |

**Rev** 2.0 | 2026-06-30 · Ký lại khi schematic release: FW Lead ___ · HW Lead ___
