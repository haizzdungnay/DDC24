# SOM Specification — Radxa CM3 (Rockchip RK3566)

> **Document:** HW-DES-01-SOM | Rev 1.1 | 2026-06-23
> **Áp dụng cho:** MK-DDC-24 Carrier Board v1.x

---

## 1. Lý do Chọn Radxa CM3

| Tiêu chí | Radxa CM3 | Đánh giá |
|----------|-----------|---------|
| CPU | RK3566 Quad-core A55 @ 1.8GHz | ✅ Đủ mạnh cho soft PLC + BACnet + MQTT |
| RAM | 2GB LPDDR4 (variant được chọn) | ✅ Thoải mái cho Debian + tất cả services |
| Storage | 8GB eMMC onboard | ✅ A/B partition + log space |
| Ethernet | Gigabit PHY onboard | ✅ Không cần PHY ngoài trên carrier |
| UART | 7× UART | ✅ UART2 → MCU IOP, UART4 → RS-485, UART debug |
| SPI | 4× SPI | ✅ SPI0 → HMI TFT ILI9341 (ADS131M08 do **MCU** đọc qua SPI3) |
| I2C | 8× I2C | ✅ I2C0 → RTC DS3231, I2C1 → spare |
| GPIO | 50× GPIO | ✅ DIP switch, LED status, MCU reset |
| USB | 1× USB3.0 + 2× USB2.0 Host + 1× OTG | ✅ OTG → USB-C console/commissioning |
| OS | Debian / Linux / Android | ✅ Debian 12 chính thức hỗ trợ |
| Form factor | 55 × 40 mm, B2B 3×100-pin 0.4mm | ✅ Phù hợp carrier board DIN-rail |
| Giá (2GB eMMC 8GB) | ~25–35 USD (volume) | ✅ Đáp ứng BOM ≤ 40 USD |
| Tài liệu | Schematic, pinout, BSP, forum | ✅ Đầy đủ cho thiết kế carrier |

### ⚠️ Ràng buộc cần lưu ý

| Vấn đề | Giá trị CM3 | Yêu cầu DDC | Giải pháp |
|--------|-----------|------------|---------|
| Nhiệt độ hoạt động | 0°C ~ 50°C (consumer) | -20°C ~ 65°C | Heatsink 5540B + thermal design tốt; giám sát CPU temp |
| ADC onboard | 2× 12-bit SAR | 16× UI analog | 2× ADS131M08 ngoài do **MCU STM32 đọc qua SPI3** rồi gửi signed raw int32 lên CM3 qua IOP (xem IO_UI_CIRCUIT.md) |
| Real-time I/O | Không có | 1ms sampling | STM32G0B1 MCU đảm nhiệm |
| WiFi/BT | Optional onboard | Không yêu cầu | Dùng variant không WiFi để giảm giá |

---

## 2. Thông số Kỹ thuật Radxa CM3 (Đã chọn)

### 2.1 Compute

| Thông số | Giá trị |
|----------|---------|
| **SoC** | Rockchip RK3566 |
| **CPU** | Quad-core ARM Cortex-A55, 64-bit, @ 1.8 GHz |
| **GPU** | ARM Mali-G52-2EE (không dùng trong DDC) |
| **NPU** | 1 TOPs @ INT8 (reserved — edge inference tương lai) |
| **RAM** | **2 GB LPDDR4** (variant đã chọn) |
| **eMMC** | **8 GB** onboard (variant đã chọn) |
| **WiFi/BT** | **Không chọn** (variant không wireless) |

### 2.2 Interfaces (tại connector B2B)

| Interface | Số lượng | Dùng trong DDC-24 |
|-----------|:--------:|-------------------|
| **Gigabit Ethernet RGMII** | 1× | ✅ Cổng RJ-45 (BACnet/IP, Modbus TCP, MQTT) |
| **UART** | 7× | UART2 (MCU IOP), UART4 (RS-485), UART0 (debug) |
| **SPI** | 4× | SPI0 (HMI TFT ILI9341). **ADS131M08 do MCU đọc qua SPI3 — không nối tới CM3** |
| **I2C** | 8× | I2C0 (RTC DS3231) |
| **USB 3.0 Host** | 1× | USB-A connector |
| **USB 2.0 Host** | 2× | 1× USB-A, 1× spare |
| **USB 2.0 OTG** | 1× | USB-C (commissioning + serial console) |
| **PCIe 2.1** | 1× | Dự phòng (không dùng Ver 1) |
| **SDMMC** | 1× | microSD slot (recovery image) |
| **PWM** | 9× | LED dimming hoặc buzzer (optional) |
| **ADC** | 2× 12-bit | Đo nhiệt độ board, điện áp supply |
| **GPIO** | 50× | DIP switch 8-bit, LED status ×4, MCU nRESET |

### 2.3 I/O Architecture Overview

| Loại I/O | Số kênh | Hardware | MCU Interface | Ghi chú |
|----------|:-------:|---------|--------------|---------|
| **UI (Universal Input)** | **16×** | Protection/front-end -> low-voltage mux/buffer -> 2× ADS131M08 | SPI3 (MCU STM32G0B1) | Rev A: 0-10V, 4-20mA, NTC, auxiliary dry contact |
| **Optional isolated DI** | SKU dependent | Opto/digital isolator sheet if required | MCU/IO expander TBD | Not replaced by UI dry contact |
| **AO (Analog Output)** | **4×** | DAC8554 | SPI1 (MCU STM32G0B1) | 0-10V, 4-20mA |
| **DO (Digital Output)** | **4×** | Relay HF46F + ULN2003A | GPIO (MCU STM32G0B1) | 250VAC/30VDC |
| **Total base I/O** | **24 ch** | 16 UI + 4 AO + 4 DO | CM3 receives data via UART IOP | Optional DI not counted in base Rev A |

### 2.3 Connector B2B

| Connector | Số pin | Pitch | Nhà cung cấp gợi ý |
|-----------|:------:|:-----:|-------------------|
| **CON1** | 100 pin | 0.4 mm | Hirose DF40C-100DS-0.4V (CM3 side) |
| **CON2** | 100 pin | 0.4 mm | Hirose DF40C-100DS-0.4V |
| **CON3** | 100 pin | 0.4 mm | Hirose DF40C-100DS-0.4V |

> **Carrier board dùng:** Hirose DF40HC(3.0)-100DS-0.4V (socket, chiều cao stack 3mm)

---

## 3. Pin Mapping CM3 → Carrier Board

> Pin number theo Radxa CM3 Pinout XLSX (v1.32):
> Source: https://dl.radxa.com/cm3/docs/radxa_cm3_v1300_to_1320_pinout.xlsx

### 3.1 Power Pins (CM3 yêu cầu từ Carrier)

| CM3 Pin | Tên | Điện áp | Dòng max | Ghi chú |
|---------|-----|:-------:|:--------:|---------|
| CON1-1,3,5 | VCC_5V | 5.0V ±5% | 3A tổng | Nguồn chính cho SoC |
| CON1-2,4,6 | GND | 0V | — | Ground |
| CON2-95 | VCC_1V8 | — | — | Output từ CM3 PMIC, dùng cho I/O reference |
| CON3-2 | VCC_3V3 | — | — | Output từ CM3 PMIC, có thể cấp ≤ 200mA peripheral |

> ⚠️ Carrier PHẢI cấp 5V ổn định ±5% cho CM3. KHÔNG dùng trực tiếp 3.3V từ CM3 PMIC cho relay hoặc tải nặng.

### 3.2 UART Mapping

| Chức năng | CM3 UART | CM3 Pins (CON) | Baud rate | Ghi chú |
|-----------|----------|---------------|:---------:|---------|
| **Debug console** | UART0 | CON1-68 (TX), CON1-70 (RX) | 1.5M | Kết nối CH340 → USB-C |
| **MCU IOP (STM32)** | UART2 | CON1-80 (TX), CON1-82 (RX) | 921.600 | Full-duplex, 3.3V level |
| **RS-485 BACnet/Modbus** | UART4 | CON2-8 (TX), CON2-10 (RX) | 9.6k–115.2k | Qua MAX13487E |
| **Spare** | UART3 | CON2-4 (TX), CON2-6 (RX) | — | Dự phòng |

### 3.3 SPI Mapping

| Chức năng | CM3 SPI | CM3 Pins (CON) | Ghi chú |
|-----------|---------|---------------|---------|
| **HMI TFT ILI9341** | SPI0 | CON1-37(CLK), CON1-39(MOSI), CON1-41(CS0); DC=CON1-51, RST=CON1-53, BL=CON1-55(PWM) | 20–40MHz, Mode 0; xem HW_SPEC §11.1 |

> **ADS131M08 KHÔNG nối tới CM3.** ADC do **MCU STM32 đọc qua SPI3** (PC10/PC11/PC12) rồi truyền raw lên CM3 qua IOP (UART2 921k). Đây là kiến trúc đã chốt (IOP-Q-R001/R007: UART-only giữa SOM↔MCU).

### 3.4 I2C Mapping

| Chức năng | CM3 I2C | CM3 Pins (CON) | Địa chỉ | Ghi chú |
|-----------|---------|---------------|:-------:|---------|
| **RTC DS3231** | I2C0 | CON1-46(SDA), CON1-48(SCL) | 0x68 | Pull-up 4.7kΩ lên 3.3V |
| **Spare** | I2C1 | CON1-50(SDA), CON1-52(SCL) | — | Dự phòng sensor |

### 3.5 GPIO Mapping

| Chức năng | CM3 GPIO | CM3 Pins (CON) | Direction | Ghi chú |
|-----------|----------|---------------|:---------:|---------|
| **LED POWER** | GPIO3_C4 | CON3-10 | OUT | Xanh lá, active HIGH |
| **LED ETH** | GPIO3_C5 | CON3-12 | OUT | Xanh lá |
| **LED BACnet** | GPIO3_C6 | CON3-14 | OUT | Xanh dương |
| **LED FAULT** | GPIO3_C7 | CON3-16 | OUT | Đỏ |
| **DIP SW1–SW8** | GPIO4_B0–B7 | CON3-20–34 | IN | Pull-up 10kΩ, active LOW |
| **MCU nRESET** | GPIO0_A4 | CON1-10 | OUT | Active LOW, open-drain |
| **BOOT SELECT** | GPIO0_A5 | CON1-12 | OUT | CM3 boot mode control |
| **FAULT_IN** | GPIO0_A6 | CON1-14 | IN | Từ MCU báo lỗi I/O |

### 3.6 USB Mapping

| Chức năng | CM3 USB | CM3 Pins (CON) | Connector | Ghi chú |
|-----------|---------|---------------|-----------|---------|
| **USB-C console/OTG** | USB2.0 OTG | CON2-50..56 | USB-C 2.0 | CC resistors theo spec |
| **USB-A host** | USB3.0 + USB2.0 | CON1-30..42 | USB-A | USB3.0 cho debug dongle |

### 3.7 Ethernet Mapping

| Chức năng | CM3 | CM3 Pins | PHY | Ghi chú |
|-----------|-----|----------|-----|---------|
| **GbE** | GMAC0 RGMII | CON3-40..70 | Onboard CM3 | Chỉ cần kéo transformer RJ-45 trên carrier |

> CM3 đã tích hợp Gigabit PHY. Carrier board chỉ cần:
> 1. Kết nối RGMII từ CON3 → Ethernet magnetics → RJ-45
> 2. 1× 25MHz crystal cho PHY (một số variant đã có onboard)

---

## 4. Lưu ý Thiết kế Carrier Board

### 4.1 Signal Integrity

- Tất cả RGMII lines (Ethernet): length matching ±0.5mm, impedance 50Ω single-ended
- SPI0 (HMI TFT ILI9341): max trace length 80mm; 33Ω series trên CLK/MOSI giảm ringing tại 40MHz
- UART lines: không cần controlled impedance, pull-up 10kΩ nếu idle-HIGH
- B2B connector: KHÔNG route signal nhanh qua vias gần connector

### 4.2 Decoupling

- Mỗi connector B2B VCC_5V pin: 100µF + 100nF ceramic gần chân
- VCC_3V3 output từ CM3: chỉ bypass 100nF, không cấp tải > 200mA

### 4.3 Boot Mode

- CM3 boot sequence: eMMC → SD card → USB OTG (recovery)
- BOOT pin trên carrier: kết nối jumper 2-pin để force SD boot khi cần recovery
- `MASKROM` pin: để test pad (không ra connector user)

### 4.4 Nhiệt độ & Tản nhiệt

- CM3 consumer spec: 0°C ~ 50°C
- Yêu cầu DDC: -20°C ~ 65°C
- **Biện pháp:**
  - Gắn Radxa Heatsink 5540B (có thermal pad)
  - Lỗ thông gió trên vỏ DIN-rail phía trên CM3
  - Software: cpufreq governor = `schedutil`, thermal throttle < 70°C
  - Monitor `thermal_zone0` qua `/sys/class/thermal` → cảnh báo nếu > 60°C

---

## 5. Tài nguyên Thiết kế CM3

| Tài liệu | Link |
|---------|------|
| Product Brief | https://dl.radxa.com/cm3/docs/rad-doc-0054_radxa_cm3_product_brief__revision_2.3_g148a184.pdf |
| Schematic V1.322 | https://dl.radxa.com/cm3/docs/v1.322/radxa_cm3_v1.322_schematic.pdf |
| Pinout XLSX | https://dl.radxa.com/cm3/docs/radxa_cm3_v1300_to_1320_pinout.xlsx |
| 3D STP | https://dl.radxa.com/cm3/docs/hw/radxa_cm3_pcba_3d.stp.zip |
| Reference IO Board Schematic | https://github.com/radxa/radxa-som-projects/tree/main/cm3 |
| Debian BSP | https://docs.radxa.com/en/cm3 |

---

| Rev | Date | Changes |
|-----|------|---------|
| 1.1 | 2026-06-23 | Updated I/O description: 16× UI (no separate DI), added I/O Architecture Overview table |
| 1.2 | 2026-06-23 | Final rev bump Phase 1-2: Updated pin mapping consistency check, verified UI_EN[8-15] = PB4-PB11 |
| 1.0 | 2026-05-27 | Initial release. |

**Document ID:** HW-DES-01-SOM | Rev 1.2 | 2026-06-23

---

## Revision History

| Rev | Date | Changes |
|-----|------|---------|
| 1.0 | 2026-05-27 | Initial SOM specification |
| 1.1 | 2026-06-23 | UI Rev A clarification: 16 UI analog, optional isolated DI separate, signed raw IOP data |

---

**Document ID:** HW-DES-01-SOM | Rev 1.1 | 2026-06-23
