# Bill of Materials — MK-DDC-24 Carrier Board v1.0

> **Document:** HW-DES-06-BOM | Rev 1.0 | 2026-05-27  
> **Trạng thái:** DRAFT — Chưa xác nhận nguồn hàng cuối cùng  
> **Công cụ quản lý:** Xuất từ KiCad BOM plugin (hỗ trợ từ schematic)

---

## 1. Tổng quan Chi phí

| Nhóm | Ước tính (USD) | Ghi chú |
|------|:--------------:|---------|
| SOM Radxa CM3 (2GB/8GB) | 30.00 | Giá volume 500+ pcs |
| MCU STM32G0B1RBT6 | 2.30 | LQFP64, 3×SPI/2×DMA |
| ADC ADS131M08 | 5.50 | 8-channel 24-bit |
| DAC DAC8554 | 4.00 | 4-channel 16-bit |
| RS-485 MAX13487E + isolation ADUM1201 | 2.50 | |
| Relay ×4 HF46F-5 | 3.20 | 0.80/relay |
| Opto-isolator PC817 ×8 | 0.80 | 0.10/opto |
| Power supply ICs | 3.00 | LM2596, LDO, boost |
| Passive components (R, C, L) | 2.50 | |
| Connectors, terminals | 4.00 | B2B, terminal block |
| PCB (4-layer, 148×88mm) | 3.50 | Volume 500+ |
| Misc (RTC, crystal, TVS, fuses) | 2.20 | |
| **Tổng Carrier Board** | **~63 USD** | |
| **Vỏ DIN-rail + Assembly** | **~15 USD** | |
| **Grand Total BOM (EXW estimate)** | **~78 USD** | Target margin → 450–550 USD retail |

---

## 2. BOM Chi tiết

### 2.1 Compute & Communication

| RefDes | Mô tả | Giá trị / Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|----------------|:---:|-------------|-------|:---:|:---------:|
| U1 | SOM Module | Radxa CM3 2GB/8GB, no WiFi | B2B | Radxa | RS-E000260 | 1 | 30.00 |
| U2 | Microcontroller | STM32G0B1RBT6 (3×SPI, 2×DMA, 144KB SRAM) | LQFP64 | ST Micro | STM32G0B1RBT6 | 1 | 2.30 |
| U3 | 8-ch 24-bit ADC | ADS131M08IPBSR | TSSOP-32 | TI | ADS131M08IPBSR | 1 | 5.50 |
| U4 | 4-ch 16-bit DAC | DAC8554IPWR | TSSOP-16 | TI | DAC8554IPWR | 1 | 4.00 |
| U5 | Voltage Ref 2.5V | REF3025AIDBZR | SOT-23-3 | TI | REF3025AIDBZR | 1 | 1.20 |
| U6 | RTC | DS3231SN# | SOIC-16 | Maxim | DS3231SN# | 1 | 1.50 |
| Y1 | Crystal 32.768kHz | 32.768kHz ±20ppm | SMD3215 | Abracon | ABS06-32.768kHz | 1 | 0.30 |
| Y2 | Crystal 8MHz (MCU HSE) | 8.000MHz ±30ppm | SMD3225 | Abracon | ABM8-8.000MHZ | 1 | 0.25 |
| Y3 | Crystal 4.096MHz (ADC ref) | 4.096MHz ±20ppm | SMD3225 | Murata | CSTCE4M00G15L99-R0 | 1 | 0.40 |

### 2.2 RS-485 Interface

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| U7 | RS-485 Transceiver auto-dir | MAX13487EESA+ | SOIC-8 | Maxim | MAX13487EESA+ | 1 | 1.20 |
| U8 | Digital Isolator 2-ch | ADUM1201BRZ-RL7 | SOIC-8 | Analog Devices | ADUM1201BRZ-RL7 | 1 | 1.30 |
| J1 | Terminal block RS-485 | 3-pin, pitch 5.08mm | — | Phoenix | MC 1,5/3-ST-3.81 | 1 | 0.40 |
| R1 | RS-485 termination | 120Ω ±1% 0.25W | 0603 | — | — | 1 | 0.02 |
| D1 | TVS RS-485 bus | SMAJ6.5A | DO-214AC | Vishay | SMAJ6.5A | 2 | 0.15 |

### 2.3 Ethernet

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| J2 | RJ-45 + magnetics integrated | HR911105A (100/1000Base-T) | Through-hole | Hanrun | HR911105A | 1 | 0.80 |

### 2.4 Digital Input (×8)

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| U9–U16 | Optocoupler DI | PC817B | DIP-4 / SOP-4 | Sharp | PC817B | 8 | 0.10 ea |
| R10–R17 | Current limiting R DI | 2.2kΩ ±5% 0.5W | 1206 | — | — | 8 | 0.05 ea |
| R18–R25 | Pull-up R DI | 10kΩ ±1% 0.1W | 0402 | — | — | 8 | 0.01 ea |
| C10–C17 | Debounce cap DI | 100nF / 50V X7R | 0402 | — | — | 8 | 0.01 ea |
| D2–D9 | Schottky protection DI | BAT54S | SOT-23 | Vishay | BAT54S | 8 | 0.05 ea |
| LED1–LED8 | LED DI indicator | Green 0603 | 0603 | Kingbright | APT1608EC | 8 | 0.05 ea |
| J3 | Terminal block DI | 10-pin (8 ch + 2 COM), pitch 5.08 | — | Phoenix | — | 1 | 1.20 |

### 2.5 Universal Input (×8)

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| U17–U24 | Analog mux 8:1 | TMUX1208RSVR | VSSOP-16 | TI | TMUX1208RSVR | 8 | 0.80 ea |
| R30–R37 | Input divider R1 (10V mode) | 100kΩ ±0.1% | 0603 | Susumu | RG1608P-1003-B-T5 | 8 | 0.10 ea |
| R40–R47 | Input divider R2 (10V mode) | 12.1kΩ ±0.1% | 0603 | Susumu | — | 8 | 0.10 ea |
| R50–R57 | Shunt 4–20mA | 62Ω ±0.1% 0.25W | 0805 | Susumu | — | 8 | 0.15 ea |
| R60–R67 | Pull-up NTC 10k | 10kΩ ±0.1% | 0603 | Susumu | — | 8 | 0.10 ea |
| D20–D27 | TVS UI protection | SMAJ15A | DO-214AC | Vishay | SMAJ15A | 8 | 0.10 ea |
| D28–D35 | Schottky clamp | BAT54S | SOT-23 | Vishay | BAT54S | 8 | 0.05 ea |
| J4 | Terminal block UI | 10-pin pitch 5.08 | — | Phoenix | — | 1 | 1.20 |
| U25 | Excitation current source | REF200AU | SOT-23-5 | TI | REF200AU | 4 | 0.80 ea |

### 2.6 Analog Output (×4)

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| U26 | Op-amp AO buffer | TLV4110ID | SOIC-8 | TI | TLV4110ID | 2 | 1.50 ea |
| Q1–Q4 | NPN transistor V-to-I | BCX56-16 | SOT-89 | NXP | BCX56-16 | 4 | 0.15 ea |
| R70–R73 | Gain resistor op-amp | 10kΩ ±0.1% | 0603 | Susumu | — | 8 | 0.10 ea |
| R74–R77 | Output series protection | 100Ω ±1% 0.25W | 0805 | — | — | 4 | 0.05 ea |
| R78–R81 | V-to-I sense resistor | 50Ω ±0.1% 0.5W | 1206 | Susumu | — | 4 | 0.20 ea |
| D36–D39 | TVS AO output | SMAJ12A | DO-214AC | Vishay | SMAJ12A | 4 | 0.10 ea |
| J5 | Terminal block AO | 8-pin (4 ch × 2), pitch 5.08 | — | Phoenix | — | 1 | 1.00 |

### 2.7 Digital Output — Relay (×4)

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| K1–K4 | Relay SPDT 5A 250VAC | HF46F-005-HS1TGF | PCB mount | Hongfa | HF46F-005-HS1TGF | 4 | 0.80 ea |
| U27 | Relay driver Darlington | ULN2003ADR | SOIC-16 | TI | ULN2003ADR | 1 | 0.25 |
| LED9–LED12 | LED DO indicator | Red 0603 | 0603 | Kingbright | APT1608ID | 4 | 0.05 ea |
| R82–R85 | LED current R | 470Ω | 0402 | — | — | 4 | 0.01 ea |
| J6 | Terminal block DO | 12-pin (4× COM/NO/NC), pitch 5.08 | — | Phoenix | — | 1 | 1.50 |

### 2.8 Power Supply

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| U28 | DC/DC step-down 5V/3A | LM2596HVS-5.0 | D²PAK | TI | LM2596HVSX-5.0/NOPB | 1 | 1.20 |
| L1 | Inductor 100µH 3A | SRR1260-101Y | SMD | Bourns | SRR1260-101Y | 1 | 0.50 |
| D50 | Freewheeling Schottky | SS34 (3A 40V) | DO-214AC | Vishay | SS34-E3/57T | 1 | 0.15 |
| C50 | Bulk cap input | 470µF/50V Low ESR | 10×20mm | Rubycon | 50ZLH470M10X23 | 1 | 0.50 |
| C51,52 | Input bypass | 100µF/50V electrolytic | φ8×12mm | — | — | 2 | 0.20 ea |
| C53,54 | Output filter | 470µF/16V Low ESR | φ8×16mm | Rubycon | — | 2 | 0.30 ea |
| C55–C58 | HF bypass | 100nF/50V X7R | 0402 | — | — | 4 | 0.01 ea |
| U29 | LDO 3.3V/1A | AP2114H-3.3TRG1 | SOT-223 | Diodes Inc | AP2114H-3.3TRG1 | 1 | 0.25 |
| U30 | LDO 1.8V/200mA | XC6206P182MR | SOT-23-3 | Torex | XC6206P182MR | 1 | 0.15 |
| U31 | Boost converter 15V | SX1308 | SOT-23-6 | Shengxin | SX1308 | 1 | 0.20 |
| L2 | Boost inductor 22µH | SRR0604-220Y | SMD | Bourns | SRR0604-220Y | 1 | 0.20 |
| BR1 | Bridge rectifier 4A | GBU4J | GBU | Vishay | GBU4J-E3/45 | 1 | 0.30 |
| F1 | Polyfuse 2A | MF-R200/12 | 1812 | Bourns | MF-R200/12 | 1 | 0.30 |
| D51 | TVS input surge | P6KE33A | DO-15 | Vishay | P6KE33A-E3/54 | 1 | 0.20 |
| J7 | Power input terminal | 2-pin pitch 5.08 | — | Phoenix | PT 1,5/2-ST-3.5 | 1 | 0.25 |

### 2.9 USB Connectors

| RefDes | Mô tả | Model | Qty | Giá (USD) |
|--------|-------|-------|:---:|:---------:|
| J8 | USB-C 2.0 (OTG / console) | USB-C SMD | 1 | 0.40 |
| J9 | USB-A 3.0 (host) | USB-A Through-hole | 1 | 0.30 |

### 2.10 User Interface — LED & Buttons

| RefDes | Mô tả | Qty | Giá (USD) |
|--------|-------|:---:|:---------:|
| SW1 | DIP switch 8-bit (BACnet Device ID + termination) | 1 | 0.50 |
| SW2–SW7 | Tactile push button 6× 6mm (UP/DOWN/LEFT/RIGHT/ENTER/ESC) | 6 | 0.10 ea |
| LED13 | LED Power (xanh lá, 0603) | 1 | 0.05 |
| LED14 | LED ETH Link (xanh lá, 0603) | 1 | 0.05 |
| LED15 | LED BACnet/Modbus (xanh dương, 0603) | 1 | 0.05 |
| LED16 | LED Fault (đỏ, 0603) | 1 | 0.05 |
| LED17 | LED DO1 status (vàng, 0603) | 1 | 0.05 |
| R90–R96 | LED current limiting R 1kΩ 0402 | 7 | 0.01 ea |
| R97–R102 | Pull-up R nút nhấn 10kΩ 0402 | 6 | 0.01 ea |
| J10 | microSD slot (push-push type) | 1 | 0.30 |
| TP1–TP17 | Test points | 17 | 0.02 ea |

### 2.11 HMI Display

| RefDes | Mô tả | Model | Pkg | Nhà sản xuất | Part# | Qty | Giá (USD) |
|--------|-------|-------|:---:|-------------|-------|:---:|:---------:|
| DSP1 | TFT LCD 2.4" ILI9341, SPI, 240×320, 65K màu | ILI9341 module | PCB mount | Waveshare / generic | — | 1 | 3.50 |
| C80–C81 | Bypass cap SPI LCD power | 100nF X7R 0402 | 0402 | — | — | 2 | 0.01 ea |
| R103 | Backlight current R (ILI9341 BL pin) | 33Ω ±5% 0.1W | 0402 | — | — | 1 | 0.01 |
| J17 | Header FPC/ribbon ILI9341 (nếu gắn qua cáp) | 8-pin FFC 1.0mm | SMD | Molex | — | 1 | 0.25 |

### 2.12 B2B Connectors (CM3 ↔ Carrier)

| RefDes | Mô tả | Model | Qty | Giá (USD) |
|--------|-------|-------|:---:|:---------:|
| J11, J12, J13 | B2B socket 100-pin 0.4mm pitch 3mm stack | DF40HC(3.0)-100DS-0.4V | 3 | 1.50 ea |

### 2.13 Debug Headers

| RefDes | Mô tả | Qty | Giá (USD) |
|--------|-------|:---:|:---------:|
| J14 | SWD MCU debug 5-pin 1.27mm | 1 | 0.20 |
| J15 | UART debug 3-pin 2.54mm | 1 | 0.10 |
| J16 | BOOT jumper 2-pin 2.54mm | 1 | 0.10 |

---

## 3. BOM Không bao gồm

- Heatsink CM3 (Radxa 5540B) — mua riêng từ Radxa
- Vỏ DIN-rail (order từ nhà cung cấp vỏ công nghiệp)
- Label và nhãn dán
- Connector housing và terminal (phụ kiện đi kèm theo terminal Phoenix)

---

## 4. Ghi chú Tìm kiếm Nguồn hàng

| IC | Phân phối chính | Tìm kiếm Thay thế |
|----|----------------|-------------------|
| ADS131M08 | Mouser, DigiKey | Không có equivalent, phải dùng TI |
| DAC8554 | Mouser | DAC8552 (2-ch) × 2 nếu 4-ch không có hàng |
| MAX13487E | DigiKey, Arrow | SP3485 (EXAR) — hoạt động tương tự |
| Radxa CM3 | Radxa direct, AliExpress | Không thay thế trong Ver 1 |
| LM2596HVS | DigiKey | LM2576HVS (dòng thấp hơn) hoặc MPQ8636 |

---

**Document ID:** HW-DES-06-BOM | Rev 1.0 | 2026-05-27
