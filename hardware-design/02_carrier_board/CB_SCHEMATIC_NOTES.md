# Carrier Board Schematic Notes & Design Guidelines

> **Document:** HW-DES-02-SCH | Rev 1.0 | 2026-05-27  
> **Dùng kết hợp với:** CB_BLOCK_DIAGRAM.md, SOM_SPEC_RADXA_CM3.md

---

## 1. Tài nguyên Schematic Tham khảo

| Tài liệu | Link | Ghi chú |
|----------|------|---------|
| Radxa CM3 Schematic V1.322 | https://dl.radxa.com/cm3/docs/v1.322/radxa_cm3_v1.322_schematic.pdf | Bắt buộc tham khảo |
| Radxa CM3 Reference IO Board | https://github.com/radxa/radxa-som-projects/tree/main/cm3 | Tham khảo carrier board Radxa |
| ADS131M08 EVM Schematic | https://www.ti.com/tool/ADS131M08EVM | Tham khảo mạch ADC |
| DAC8554 Reference Design | TI Application Note SBAA186 | Tham khảo DAC design |
| STM32G0B1 Reference Design | ST AN4296 (STM32G0 design guide) | Decoupling, crystal, boot |
| IEC 61010-1 | Tiêu chuẩn clearance/creepage | Áp dụng cho relay HV section |
| IEC 61326-1 | Tiêu chuẩn EMC đo lường/điều khiển | |

---

## 2. Schematic Checklist — CM3 Interface

### 2.1 Power Input CM3 (B2B pins)

- [ ] VCC_5V kết nối tất cả VCC pins CON1-1, CON1-3, CON1-5 (không bỏ pin nào)
- [ ] GND kết nối tất cả GND pins CON1-2, CON1-4, CON1-6
- [ ] Bypass capacitor 100nF gần mỗi VCC B2B pin
- [ ] Bulk capacitor 100µF tại VCC_5V input carrier (gần B2B)
- [ ] Không kết nối các pin `NC` (No Connect) của CM3

### 2.2 UART Debug (UART0 → CH340)

- [ ] UART0_TX (CON1-68) → CH340G TX input
- [ ] UART0_RX (CON1-70) → CH340G RX output
- [ ] CH340G VCC = 3.3V (không dùng 5V — CM3 UART là 3.3V)
- [ ] USB-C D+/D− cần CC resistors: CC1=5.1kΩ, CC2=5.1kΩ to GND (UFP mode)
- [ ] ESD protection PRTR5V0U2X trên D+/D−

### 2.3 UART MCU IOP (UART2)

- [ ] UART2_TX (CON1-80) → STM32 USART1_RX (PA10) — chéo TX↔RX
- [ ] UART2_RX (CON1-82) → STM32 USART1_TX (PA9)
- [ ] Level: đều 3.3V, không cần level shifter
- [ ] Series resistor 33Ω trên đường TX của mỗi bên (tránh ringing)

### 2.4 SPI0 → HMI TFT ILI9341 (CM3)

> **Lưu ý kiến trúc:** ADS131M08 **KHÔNG** nối tới CM3. ADC do MCU đọc qua SPI3 — xem §3.1. CM3 SPI0 dùng cho màn hình TFT.

- [ ] CM3 SPI0_CLK (CON1-37) → ILI9341 SCK — series R 33Ω
- [ ] CM3 SPI0_MOSI (CON1-39) → ILI9341 MOSI/SDA — series R 33Ω
- [ ] CM3 SPI0_CS0 (CON1-41) → ILI9341 CS#
- [ ] CM3 GPIO0_C0 (CON1-51) → ILI9341 DC (Data/Command)
- [ ] CM3 GPIO0_C1 (CON1-53) → ILI9341 RST# (active LOW)
- [ ] CM3 PWM11 (CON1-55) → ILI9341 BL qua R 33Ω (backlight, max 20mA)
- [ ] ILI9341 VCC=3V3, GND; bypass 100nF gần module

### 2.5 I2C0 → DS3231 RTC

- [ ] I2C0_SDA (CON1-46) → DS3231 SDA — pull-up 4.7kΩ → 3.3V
- [ ] I2C0_SCL (CON1-48) → DS3231 SCL — pull-up 4.7kΩ → 3.3V
- [ ] DS3231: VBAT → CR2032 battery holder (backup 3V)
- [ ] DS3231: INT/SQW pin → STM32 (optional wake-up)
- [ ] Decoupling DS3231 VCC: 100nF

### 2.6 Ethernet RGMII → RJ-45

- [ ] Toàn bộ RGMII pins từ CON3: tham chiếu Radxa CM3 schematic V1.322 page GMAC
- [ ] Magnetics integrated RJ-45 HR911105A (100/1000Base-T)
- [ ] RGMII ref clock 25MHz: CM3 CM3 GMAC cấp (verify trong schematic Radxa)
- [ ] Capacitor 0.1µF trên MDI pairs tại RJ-45 side
- [ ] Bố trí: RJ-45 sát cạnh PCB, RGMII traces ngắn nhất có thể

---

## 3. Schematic Checklist — MCU STM32G0B1

- [ ] Decoupling: 100nF tại mỗi VDD pin (có 4 VDD pins), 10µF bulk
- [ ] VDDA: 100nF + 1µF riêng biệt, không chung với VDD
- [ ] Crystal 8MHz: load cap 12pF theo datasheet oscillator
- [ ] NRST: 100nF bypass to GND, không kết nối trực tiếp với CM3 GPIO (dùng OD gate nếu cần)
- [ ] BOOT0: pull-down 10kΩ (normal run mode), jumper để override
- [ ] SWD header: SWDIO, SWDCLK, VCC, GND, NRST (5-pin 1.27mm)
- [ ] Tất cả NC pins: đánh dấu NC trong schematic, không route

### 3.1 SPI3 (MCU) → ADS131M08 ADC

- [ ] MCU SPI3_CLK (PC10) → ADS131M08 SCLK — series R 33Ω
- [ ] MCU SPI3_MOSI (PC12) → ADS131M08 DIN/SDI — **bắt buộc** (ghi config register)
- [ ] MCU SPI3_MISO (PC11) ← ADS131M08 DOUT — series R 33Ω
- [ ] MCU GPIO (PB2) → ADS131M08 !CS — pull-up 10kΩ → 3.3V
- [ ] ADS131M08 !DRDY → MCU PA8 (interrupt báo data ready)
- [ ] ADS131M08 CLKIN: crystal 4.096MHz (hoặc MCO từ MCU)
- [ ] ADS131M08 AVDD, DVDD: bypass 10µF + 100nF riêng biệt mỗi pin
- [ ] **Toàn bộ cụm MCU + ADS131M08 + DAC8554 ở cùng vùng PCB; không có đường SPI nào chạy tới CM3**

---

## 4. Schematic Checklist — Power Supply

- [ ] Polyfuse F1 2A trên đường dương 24V INPUT (trước bridge rectifier)
- [ ] Bridge rectifier GBU4J: 2 chân AC vào terminal block (cực tính không quan trọng cho AC)
- [ ] TVS P6KE33A: song song với đầu ra DC bridge, cathode → DC+, anode → GND
- [ ] Bulk capacitor C1: electrolytic đặt đúng cực (dương → DC+)
- [ ] LM2596HVS: follow datasheet layout recommendation (inductor gần Output pin, Schottky gần anode GND)
- [ ] GND plane split: không split GND — dùng 1 GND plane liên tục (analog và digital GND kết hợp tại 1 điểm star ground)
- [ ] Nhiệt DC/DC: thermal via bên dưới LM2596 SOT-223, ít nhất 4 via φ0.5mm
- [ ] Relay: +5V_RELAY tách qua ferrite bead 600Ω từ main +5V

---

## 5. Schematic Checklist — I/O Protection

- [ ] Mỗi UI terminal: TVS SMAJ15A (trước mạch điều hòa), R_fuse 100Ω series
- [ ] Mỗi DI terminal: D1 BAT85 + R1 2.2kΩ (không để hở)
- [ ] RS-485 A/B: TVS SMAJ6.5A mỗi chân, sau terminal trước MAX13487E
- [ ] DO relay contact terminal: copper clearance ≥ 3.2mm (IEC 61010-1)
- [ ] ESD arrays PRTR5V0U2X: tại tất cả user-accessible connectors (USB-C, USB-A, SD, RS-485, debug UART)

---

## 6. Signal Naming Convention

Dùng tên thống nhất trong schematic để dễ cross-reference:

| Signal | Convention | Ví dụ |
|--------|-----------|-------|
| Power | IN_CAPS | `VCC_5V`, `VCC_3V3`, `GND`, `VCC_15V` |
| UART | UART_DEVICE_DIR | `UART_MCU_TX`, `UART_MCU_RX` |
| SPI | SPI_DEVICE_SIG | `SPI_ADC_CLK`, `SPI_ADC_MOSI` |
| Relay control | DO_x_DRV | `DO1_DRV`, `DO2_DRV` |
| Relay contact | DO_x_COM/NO/NC | `DO1_COM`, `DO1_NO` |
| UI analog | UI_x_ANA | `UI1_ANA`, `UI8_ANA` |
| DI signal | DI_x_LOGIC | `DI1_LOGIC` (sau opto) |

---

## 7. Schematic Sheet Organization (KiCad recommended)

| Sheet | Nội dung |
|-------|---------|
| **01_TOP** | Title block, project info, revision history |
| **02_CM3** | CM3 B2B symbols, CM3 decoupling |
| **03_MCU** | STM32G0B1, SWD, crystal, decoupling |
| **04_POWER** | Bridge rect, DC/DC, LDOs, boost |
| **05_UI_INPUT** | 8× UI kênh (signal conditioning, mux, TVS) |
| **06_DI_INPUT** | 8× DI kênh (opto, resistor) |
| **07_AO_OUTPUT** | DAC8554, op-amp, output circuit |
| **08_DO_RELAY** | ULN2003A, 4× relay, terminal |
| **09_COMM** | Ethernet (RGMII, RJ-45), RS-485, USB-C, USB-A |
| **10_PERIPHERAL** | RTC DS3231, microSD, DIP switch, LEDs, test points |

---

**Document ID:** HW-DES-02-SCH | Rev 1.0 | 2026-05-27
