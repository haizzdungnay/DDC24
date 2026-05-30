# MCU Specification — STM32G0B1RBT6

> **Document:** HW-DES-05-MCU | Rev 1.0 | 2026-05-27  
> **Vai trò:** Real-time I/O controller, FreeRTOS, giao tiếp với CM3 qua UART (Kinexus-IOP v1)

---

## 1. Chọn MCU

**Lý do chọn STM32G0B1RBT6:**
- ARM Cortex-M0+ @ 64MHz — đủ cho 1ms real-time sampling
- 128KB Flash — đủ cho FreeRTOS + firmware đầy đủ + OTA buffer
- 144KB SRAM — dư địa lớn cho task stack + ring buffer I/O
- **3× SPI** (SPI1→DAC8554, SPI3→ADS131M08, SPI2 spare) + **2× DMA controller** → đủ DMA đồng thời cho ADC + DAC + UART, không cần polling fallback
- 12-bit ADC tích hợp (dự phòng, main ADC là ADS131M08)
- UART, I2C đầy đủ
- Package LQFP64 — pin-compatible với STM32G071RB, dễ SMT sản xuất hàng loạt
- Giá: ~2.0–2.5 USD (mass production)
- Công cụ phát triển: STM32CubeIDE + STM32CubeMX (free)

> **Lịch sử chọn part:** Ban đầu là STM32G071RB (2× SPI, 1× DMA). Đổi sang **STM32G0B1RBT6** (Rev 2.0, 2026-05-30) để có 3× SPI + 2× DMA controller — hợp thức hóa thiết kế "SPI3 → ADS131M08, SPI1 → DAC8554 chạy DMA song song". Pin-compatible LQFP64, đổi không ảnh hưởng layout.

---

## 2. Thông số Kỹ thuật

| Thông số | Giá trị |
|----------|---------|
| **Core** | ARM Cortex-M0+ |
| **Clock** | 64MHz (HSE 8MHz × PLL) |
| **Flash** | 128KB |
| **SRAM** | 144KB |
| **ADC** | 2× 12-bit SAR, 12 channels |
| **DAC** | 1× 12-bit (không dùng — dùng DAC8554 ngoài) |
| **SPI** | 3× (SPI1 → DAC8554; SPI3 → ADS131M08; SPI2 spare) |
| **UART** | 4× (UART1 → CM3 IOP; UART2 → debug) |
| **I2C** | 2× |
| **GPIO** | 51× |
| **Timers** | 11× (dùng TIM1 cho 1ms task cycle) |
| **IWDG** | Independent Watchdog (timeout 1s) |
| **Operating temp** | -40°C ~ +85°C |
| **Package** | LQFP64 |
| **VDD** | 3.3V |

---

## 3. Pin Mapping STM32G0B1RBT6

> **⭐ NGUỒN CHUẨN DUY NHẤT cho pinout MCU.** `CB_BLOCK_DIAGRAM`, `CB_SCHEMATIC_NOTES`, `IO_DI_CIRCUIT`, `IO_DO_RELAY`, `IO_UI_CIRCUIT` PHẢI khớp bảng này. Phân bổ chân mux-enable đầy đủ (D-1) sẽ chốt ở giai đoạn pinmux design.

### 3.1 UART

| Signal | Pin STM32 | Kết nối | Tốc độ |
|--------|-----------|---------|:------:|
| **USART1_TX** | PA9 | CM3 UART2_RX (IOP) | 921.600 |
| **USART1_RX** | PA10 | CM3 UART2_TX (IOP) | 921.600 |
| **USART2_TX** | PA2 | Debug/Programming | 115.200 |
| **USART2_RX** | PA3 | Debug/Programming | 115.200 |

### 3.2 SPI

| Signal | Pin STM32 | Kết nối |
|--------|-----------|---------|
| **SPI1_CLK** | PA5 | DAC8554 SCLK |
| **SPI1_MOSI** | PA7 | DAC8554 DIN |
| **SPI1_CS** | PA4 | DAC8554 SYNC (active LOW) |
| **SPI1_LDAC** | PB0 | DAC8554 LDAC (GPIO điều khiển — xem P2-10/§AO) |
| **SPI3_CLK** | PC10 | ADS131M08 SCLK |
| **SPI3_MISO** | PC11 | ADS131M08 DOUT |
| **SPI3_MOSI** | PC12 | ADS131M08 DIN/SDI (**bắt buộc** — ghi config register) |
| **SPI3_CS** | PB2 (GPIO) | ADS131M08 !CS — pull-up 10kΩ |
| **DRDY_ADC** | PA8 (EXTI) | ADS131M08 !DRDY (interrupt báo data ready) |

### 3.3 GPIO Digital Input (DI × 8)

| Signal | Pin STM32 | Kết nối | Pull |
|--------|-----------|---------|:----:|
| DI1 | PB4 | Opto PC817 collector | Pull-up 10k (ext.) |
| DI2 | PB5 | Opto | Pull-up |
| DI3 | PB6 | Opto | Pull-up |
| DI4 | PB7 | Opto | Pull-up |
| DI5 | PB8 | Opto | Pull-up |
| DI6 | PB9 | Opto | Pull-up |
| DI7 | PB10 | Opto | Pull-up |
| DI8 | PB11 | Opto | Pull-up |

### 3.4 GPIO Digital Output (DO × 4 via ULN2003A)

| Signal | Pin STM32 | Kết nối |
|--------|-----------|---------|
| DO1_DRV | PC0 | ULN2003A IN1 |
| DO2_DRV | PC1 | ULN2003A IN2 |
| DO3_DRV | PC2 | ULN2003A IN3 |
| DO4_DRV | PC3 | ULN2003A IN4 |

### 3.5 GPIO UI Analog Mode Select (TMUX1208 SEL)

| Signal | Pin STM32 | Kết nối |
|--------|-----------|---------|
| UI_SEL_S0 | PB12 | TMUX1208 S0 (chung 8 mux) |
| UI_SEL_S1 | PB13 | TMUX1208 S1 |
| UI_SEL_S2 | PB14 | TMUX1208 S2 |
| UI_EN[0..7] | PC4–PC9, PC13, PC15 | Enable từng kênh mux |

> **Đã dời SEL khỏi PA0/PA1** để tránh đụng chân với ADC nội (§3.8) đo VCC/board temp. PA6 nay là spare.

### 3.6 GPIO Misc

| Signal | Pin STM32 | Kết nối | Direction |
|--------|-----------|---------|:---------:|
| **nRESET** | NRST | CM3 GPIO0_A4 | IN (CM3 reset MCU) |
| **BOOT0** | BOOT0 | Pull-down 10kΩ (normal run) | IN |
| **FAULT_OUT** | PD5 | CM3 GPIO0_A6 | OUT (báo lỗi) |
| **MCU_LED** | PD6 | LED xanh MCU alive (blink 1Hz) | OUT |
| **IWDG_FEED** | Internal | IWDG feed trong task cycle | — |

### 3.7 Clock

| Signal | Pin | Giá trị |
|--------|-----|---------|
| HSE Crystal | OSC_IN/OUT | 8MHz, load cap 12pF |
| PLL | Internal | × 8 = 64MHz sysclk |

### 3.8 ADC tích hợp (dự phòng)

| Channel | Pin | Mục đích |
|---------|-----|---------|
| ADC_IN0 | PA0 | Đo VCC_5V (qua divider /3) |
| ADC_IN1 | PA1 | Nhiệt độ board (NTC 10k trên PCB) |

---

## 4. FreeRTOS Task Structure

> **⚠ Nguồn chuẩn:** Task model chi tiết (priority, period, stack, deadline, mutex/queue) được định nghĩa trong **`spec/FW_ARCH_SPEC_MK-DDC-24_VI.md` §2**. Bảng dưới chỉ là tóm tắt; nếu khác biệt, FW_ARCH là nguồn đúng.

| Task (theo FW_ARCH §2) | Priority | Period | Stack | Chức năng |
|------------------------|:--------:|:------:|:-----:|-----------|
| `io_sample_task` | 7 (High) | 1 ms | 512 B | ADC sampling ADS131M08 + DI debounce |
| `iop_comm_task` | 6 | 10 ms | 512 B | IOP UART protocol (TX+RX gộp 1 task) |
| `ao_output_task` | 6 | 10 ms | 256 B | Apply AO → DAC8554 |
| `do_control_task` | 6 | 10 ms | 256 B | Relay control + feedback |
| `diagnostics_task` | 2 | 1000 ms | 256 B | MCU temp, VDD, counters |
| `watchdog_task` | 1 | 500 ms | 128 B | Task health check + IWDG kick |

**Total SRAM task stack:** ~2KB + FreeRTOS kernel ~4KB + data buffers ~8KB (rất dư trong 144KB SRAM).

---

## 5. Kinexus-IOP v1 Protocol (UART)

> **⚠ Nguồn chuẩn DUY NHẤT:** **`spec/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md`** (IOP-SPEC v1.0). Mọi chi tiết frame format, command catalog, CRC, SEQ, timing, fault FSM đều ở đó. **Không** dùng lại bảng command cũ trong tài liệu này.

Tóm tắt (chi tiết → IOP-SPEC):

| Mục | Giá trị chuẩn (IOP-SPEC) |
|-----|--------------------------|
| Frame | `SOF(0xAA) · LEN · CMD · SEQ · PAYLOAD(0–252) · CRC16` |
| CRC | **CRC-16/Modbus** (poly 0x8005, init 0xFFFF) — *không phải CCITT* |
| SEQ | có (1 byte, MCU echo SEQ từ SOM) |
| Command chính | `0x01 GET_IO`, `0x02 IO_RESP`, `0x10 SET_AO`, `0x11 SET_DO`, `0x12 ACK`, `0x20/0x21 DIAG`, `0x30/0x31 HANDSHAKE`, `0x40 RESET_IO`, `0xFE NACK` |
| Poll interval | 10 ms (100 Hz) |
| Response timeout | 10 ms (retry ×3) → 100 ms → safe state |
| Baud rate | 921.600 bps |
| Frame max | LEN+6 = tối đa 258 bytes |

> **Lưu ý lịch sử:** Bảng command cũ (CMD_READ_AI/READ_DI/WRITE_AO, CRC-CCITT, không SEQ, timeout 50ms) ở Rev 1.0 đã **bị loại bỏ** khi IOP-SPEC v1.0 ban hành (2026-05-28).

---

## 6. Watchdog

- **IWDG timeout:** 1 giây
- `task_diagnostics` feed IWDG mỗi 500ms
- Nếu IWDG reset xảy ra → MCU set FAULT_OUT pin HIGH → CM3 nhận interrupt → log sự kiện → reset MCU lần nữa

---

## 7. OTA / Programming MCU

> **⚠ Cập nhật (chốt P1-4):** SRS OTA-004, FW-OTA-001 và SW-OTA-004 **bắt buộc** SOM nạp firmware MCU trong cùng gói OTA **ngay từ Ver 1**. Do đó **Ver 1 PHẢI hỗ trợ đường CM3 → MCU UART bootloader** (không chỉ SWD).

**Ver 1 — Hai đường nạp:**
1. **Factory/Debug — SWD:** Header 5-pin SWD tại cạnh PCB (nạp lần đầu tại nhà máy, debug).
2. **Field OTA — CM3 nạp MCU qua UART system bootloader (BẮT BUỘC Ver 1):**
   - CM3 GPIO kéo **BOOT0 = HIGH** → assert **nRESET** → MCU vào ROM system bootloader.
   - CM3 gửi firmware MCU `.bin` qua **USART (đường IOP UART2/USART1 hoặc USART2)** dùng giao thức ST AN3155.
   - Trước khi flash: tất cả output PHẢI ở safe state (FW-OTA-002). Sau flash: verify CRC (FW-OTA-004), nhả BOOT0, reset → chạy firmware mới (≤ 5s, FW-OTA-003).
   - Nếu CRC fail: bootloader giữ firmware cũ (FW-OTA-005).

**Yêu cầu phần cứng kèm theo:** CM3 GPIO điều khiển được **BOOT0** (qua jumper-bypass FET hoặc trực tiếp) và **nRESET** của MCU — xem MCU pinout §3.6 và CB_SCHEMATIC §3.

> **Ghi chú:** Việc chọn UART nào để nạp (tái dùng đường IOP hay USART2 debug) chốt ở giai đoạn thiết kế firmware bootloader (D-7).

---

**Document ID:** HW-DES-05-MCU | Rev 1.0 | 2026-05-27
