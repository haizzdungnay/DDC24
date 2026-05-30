# Carrier Board — Block Diagram & Design Specification

> **Document:** HW-DES-02-CB | Rev 1.0 | 2026-05-27  
> **Áp dụng cho:** MK-DDC-24 Carrier Board v1.x  
> **PCB layers:** 4-layer (yêu cầu tối thiểu)

---

## 1. Block Diagram

```
                    ┌───────────────────────────────────────────────────────┐
                    │                  CARRIER BOARD v1.x                   │
                    │                                                       │
  ┌──────────────┐  │  ┌──────────────────────────────────────────────────┐ │
  │ 24VAC/VDC    │  │  │              POWER SUPPLY MODULE                 │ │
  │ Terminal 2P  │──►  │  Bridge Rect → TVS → DC/DC 5V/3A → LDO 3.3V/1A │ │
  └──────────────┘  │  │   LDO 1.8V/200mA (ADC DVDD) · Boost +15V/200mA  │ │
                    │  │                              (AO op-amp rail)    │ │
                    │  └──────┬────────┬────────┬──────────┬──────────────┘ │
                    │         │5V/3A   │3.3V/1A  │1.8V/200mA │+15V/200mA     │
                    │  ┌───────▼──────────────────────────────────────────┐ │
                    │  │              Radxa CM3 (55×40mm)                 │ │
                    │  │  RK3566 Quad-A55@1.8G │ 2GB LPDDR4 │ 8GB eMMC  │ │
                    │  │  GbE PHY onboard │ Debian 12 + PREEMPT_RT       │ │
                    │  │                                                  │ │
                    │  │  CON1─────── UART0 ──► Debug (CH340)            │ │
                    │  │  CON1─────── UART2 ──► MCU STM32 (IOP 921k)    │ │
                    │  │  CON2─────── UART4 ──► MAX13487E (RS-485)       │ │
                    │  │  CON1─────── SPI0  ──► HMI TFT ILI9341 (2.4")  │ │
                    │  │  CON1─────── I2C0  ──► DS3231 (RTC)            │ │
                    │  │  CON3─────── RGMII ──► Ethernet Mag → RJ-45    │ │
                    │  │  CON2─────── USB OTG ► USB-C connector          │ │
                    │  │  CON1─────── USB3.0 ► USB-A connector           │ │
                    │  │  CON3─────── GPIO  ──► LED×4, DIP SW×8         │ │
                    │  └──────────────────────────────────────────────────┘ │
                    │                    │ UART2 (921600 baud, IOP)         │
                    │  ┌─────────────────▼──────────────────────────────┐   │
                    │  │         STM32G0B1RBT6 MCU (FreeRTOS)           │   │
                    │  │  ADC_EXT: SPI3 → ADS131M08 (8ch UI sampling)  │   │
                    │  │  DAC_OUT: SPI1 → DAC8554 (4ch AO 0-10V/4-20mA)│   │
                    │  │  DI_IN:   GPIO PB4–PB11 ← Opto PC817 ×8       │   │
                    │  │  DO_OUT:  GPIO PC0–PC3 → ULN2003 → Relay ×4   │   │
                    │  │  FAULT:   GPIO PD5 → CM3 GPIO0_A6 (báo lỗi)   │   │
                    │  └──┬──────────┬──────────┬─────────────────────┘   │
                    │     │SPI3      │SPI1       │GPIO                     │
                    │  ┌──▼──┐    ┌──▼──┐    ┌───▼──────────────────────┐ │
                    │  │ADS  │    │DAC  │    │  DI opto  │ DO relay     │ │
                    │  │131M8│    │8554 │    │  PC817×8  │ SPDT 5A ×4   │ │
                    │  └──┬──┘    └──┬──┘    └───┬────────┬─────────────┘ │
                    │     │          │            │        │               │
  UI1-UI8 ──────────►  [Signal Cond.]  [AO 0-10V/4-20mA]                  │
  DI1-DI8 ──────────►               [Opto-isolated 24VDC] [Relay contacts] ◄──DO1-DO4
  RS-485 A/B ────────►  [MAX13487E ← UART4]                               │
  RJ-45 Ethernet ────►  [Mag + RJ45 ← RGMII]                              │
  USB-C ─────────────►  [USB-C ← OTG]                                     │
  USB-A ─────────────►  [USB-A ← USB3.0]                                  │
  microSD ────────────►  [SD socket ← SDMMC]                               │
  DIP×8 ─────────────►  [DIP SW ← GPIO]                                    │
  LED×4 ─────────────►  [LED bar ← GPIO]                                   │
                    └───────────────────────────────────────────────────────┘
```

---

## 2. PCB Stackup (4-layer)

| Layer | Tên | Nội dung |
|-------|-----|---------|
| **L1 (Top)** | Signal_Top | CM3 B2B footprint, MCU, connectors, fine-pitch IC |
| **L2** | GND | Ground plane liên tục — tham chiếu SI |
| **L3** | Power | Các rail 5V, 3.3V, 1.8V, +15V (AO) |
| **L4 (Bottom)** | Signal_Bot | I/O terminal blocks, relay, opto, passives |

> **Lưu ý:** High-current paths (relay coil, RS-485, power) ưu tiên L4. Signal nhạy (SPI, UART, RGMII) ở L1.

---

## 3. PCB Dimensions & Layout Guidelines

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| **Kích thước PCB** | 148 × 88 mm | Fit trong vỏ DIN-rail 150×90×55mm |
| **Vùng CM3** | 60 × 45 mm (top-center) | Clear-out dưới CM3 không có component |
| **Vùng terminal I/O** | L4 toàn bộ phía DI/UI | Terminal block pitch 5.08mm |
| **Vùng relay** | Bottom-right | Khoảng cách relay ≥ 5mm nhau |
| **Vùng power** | Top-left | DC/DC converter, heatsink pad |
| **Mounting hole** | 4× M3, corner | Khoảng cách ≥ 5mm từ edge |

---

## 4. Signal Routing Rules

### 4.1 RGMII (Ethernet CM3 → Magnetics)

| Rule | Giá trị |
|------|---------|
| Impedance | 50Ω ±10% single-ended |
| Length matching | TX group: ±0.5mm; RX group: ±0.5mm |
| Max trace length | 100mm |
| Reference plane | L2 GND liên tục |
| Spacing | ≥ 3× trace width so với signal khác |

### 4.2a SPI3 (MCU STM32 → ADS131M08 ADC) — *trên cụm MCU, không phải CM3*

| Rule | Giá trị |
|------|---------|
| Impedance | 50Ω |
| Max length | 50mm (MCU ↔ ADS131M08, cùng cụm) |
| Clock speed | 4 MHz → relaxed SI |
| CS# | Pull-up 10kΩ lên 3.3V; DRDY → MCU PA8 interrupt |

### 4.2b SPI0 (CM3 → HMI TFT ILI9341)

| Rule | Giá trị |
|------|---------|
| Impedance | không yêu cầu controlled (50Ω khuyến nghị) |
| Max length | 80mm |
| Clock speed | 20–40 MHz; 33Ω series trên CLK/MOSI |
| Tín hiệu | CLK, MOSI, CS, DC, RST, BL (PWM) |

### 4.3 UART2 (CM3 → STM32, IOP)

| Rule | Giá trị |
|------|---------|
| Level | 3.3V CMOS, không cần level shifter (cùng rail) |
| Max length | 80mm |
| Baud | 921.600 — cần trace sạch, không qua vias nhiều |

### 4.4 RS-485 (MAX13487E → Terminal)

| Rule | Giá trị |
|------|---------|
| Differential pair | 120Ω ±10% (matched pair) |
| Isolation gap | ≥ 3mm clearance từ low-voltage logic |
| TVS placement | Gần terminal, trước MAX13487E |

### 4.5 High-Voltage Relay (250VAC)

| Rule | Giá trị |
|------|---------|
| Clearance (relay contact) | ≥ 3.2mm (IEC 61010-1, Cat II, Pollution 2) |
| Creepage | ≥ 4mm |
| Relay to relay | ≥ 5mm giữa 2 relay |
| Copper fill | Không fill copper dưới relay contact traces |

---

## 5. Test Points

| Test Point | Net | Mô tả |
|------------|-----|-------|
| TP1 | VCC_5V | Đo điện áp vào CM3 |
| TP2 | VCC_3V3 | Rail 3.3V |
| TP3 | GND | Ground reference |
| TP4 | UART0_TX | Debug console |
| TP5 | UART2_TX | IOP MCU |
| TP6 | SPI3_CLK (MCU) | ADC SPI clock (MCU ↔ ADS131M08) |
| TP7 | RS485_A | BACnet/Modbus bus A |
| TP8 | RS485_B | BACnet/Modbus bus B |
| TP9 | MCU_nRESET | STM32 reset |
| TP10–17 | UI1–UI8 | Universal input (trước conditioning) |

---

## 6. DRC Rules (Design Rule Check)

| Rule | Giá trị |
|------|---------|
| Min trace width | 0.1mm (signal), 0.3mm (power ≤ 1A), 0.8mm (power > 1A) |
| Min via drill | 0.2mm |
| Min clearance | 0.1mm (general), 3.2mm (HV relay), 0.3mm (B2B area) |
| Min annular ring | 0.1mm |
| B2B footprint tolerance | ±0.05mm (critical — 0.4mm pitch) |

---

**Document ID:** HW-DES-02-CB | Rev 1.0 | 2026-05-27
