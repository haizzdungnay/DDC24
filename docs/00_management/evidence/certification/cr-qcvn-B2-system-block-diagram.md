# B2 — System Block Diagram

> **Document ID:** CR-QCVN-B2-v1 | Rev 1.1 | 2026-06-04  
> **Mục đích:** Phục vụ chứng nhận QCVN / CR Mark cho MK-DDC-24  
> **Input source:** HW-DES-02-CB (Carrier Board Block Diagram)  
> **Taxonomy:** B2-diagram-v1

---

## 1. Kiến trúc tổng thể (2-Layer Architecture)

```
                    ┌───────────────────────────────────────────────────────────────────┐
                    │                   MK-DDC-24 — SYSTEM BLOCK DIAGRAM                │
                    │                                                                   │
                    │  ╔══════════════════════════════════════════════════════════════╗  │
                    │  ║            LAYER 1 — COMPUTE (Radxa CM3)                     ║  │
                    │  ║  SoC: Rockchip RK3566 — Quad A55 @ 1.8 GHz                  ║  │
                    │  ║  2 GB LPDDR4 · 8 GB eMMC · GbE PHY onboard                 ║  │
                    │  ║  OS: Debian 12 + PREEMPT_RT                                 ║  │
                    │  ║                                                            ║  │
                    │  ║  ┌─────────────────────────────────────────────────────────┐ ║  │
                    │  ║  │ NORTHBOUND INTERFACES (IP only)                         │ ║  │
                    │  ║  │ GbE RGMII → RJ-45: BACnet/IP, MQTT, REST API           │ ║  │
                    │  ║  │ USB-C (OTG): commissioning, console                     │ ║  │
                    │  ║  │ USB-A 3.0 (Host): debug dongle                         │ ║  │
                    │  ║  │ microSD: recovery image                                 │ ║  │
                    │  ║  └─────────────────────────────────────────────────────────┘ ║  │
                    │  ║                                                            ║  │
                    │  ║  ┌─────────────────────────────────────────────────────────┐ ║  │
                    │  ║  │ PERIPHERAL I/F (on carrier)                             │ ║  │
                    │  ║  │ SPI0 → HMI TFT ILI9341 (2.4", 240×320)                 │ ║  │
                    │  ║  │ I2C0 → RTC DS3231                                      │ ║  │
                    │  ║  │ GPIO → DIP SW×8, LED×4, MCU nRESET                    │ ║  │
                    │  ║  │ UART0 → CH340 → USB-C (debug console)                 │ ║  │
                    │  ║  │ UART4 → MAX13487E → RS-485 (Modbus RTU)              │ ║  │
                    │  ║  └─────────────────────────────────────────────────────────┘ ║  │
                    │  ║                          │ UART2 @ 921600 baud (IOP)         ║  │
                    │  ╚══════════════════════════╪═══════════════════════════════════╝  │
                    │                             │                                      │
                    │  ╔══════════════════════════╪═══════════════════════════════════╗  │
                    │  ║            LAYER 2 — REAL-TIME I/O (STM32G0B1RBT6)          ║  │
                    │  ║  MCU: Cortex-M0+ @ 64 MHz · 144 KB SRAM                    ║  │
                    │  ║  FreeRTOS · IOP protocol (industrial I/O processor)        ║  │
                    │  ║                                                            ║  │
                    │  ║  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  ║  │
                    │  ║  │ ANALOG INPUT │  │ ANALOG OUTPUT│  │ DIGITAL INPUT    │  ║  │
                    │  ║  │ ×8 (Universal)│  │ ×4           │  │ ×8               │  ║  │
                    │  ║  │              │  │              │  │                  │  ║  │
                    │  ║  │ ADS131M08    │  │ DAC8554      │  │ PC817 Opto ×8   │  ║  │
                    │  ║  │ 8-ch 24-bit  │  │ 4-ch 16-bit  │  │ 24VDC sensing   │  ║  │
                    │  ║  │ SPI3 (MCU)   │  │ SPI1 (MCU)   │  │ Debounce + clamp │  ║  │
                    │  ║  │ Modes: 0-10V │  │ 0-10V / 4-20mA│  │                  │  ║  │
                    │  ║  │ 4-20mA, NTC, │  │              │  │                  │  ║  │
                    │  ║  │ dry contact  │  │              │  │                  │  ║  │
                    │  ║  └──────────────┘  └──────────────┘  └──────────────────┘  ║  │
                    │  ║                                                            ║  │
                    │  ║  ┌─────────────────────────────────────────────────────────┐ ║  │
                    │  ║  │ DIGITAL OUTPUT — RELAY ×4                               │ ║  │
                    │  ║  │ ULN2003 driver → HF46F-005-HS1TGF                       │ ║  │
                    │  ║  │ SPDT · 5A 250VAC · Clearance ≥3.2mm (IEC 61010-1)      │ ║  │
                    │  ║  │ TVS clamp on coil driver output                          │ ║  │
                    │  ║  └─────────────────────────────────────────────────────────┘ ║  │
                    │  ╚═══════════════════════════════════════════════════════════════╝  │
                    │                                                                   │
                    │  ╔═══════════════════════════════════════════════════════════════╗  │
                    │  ║  POWER SUPPLY MODULE                                          ║  │
                    │  ║  24VAC/VDC Input → Bridge Rectifier → TVS (P6KE33A)          ║  │
                    │  ║  → Polyfuse MF-R200/12 → DC/DC LM2596HVS (5V/3A)             ║  │
                    │  ║    → LDO AP2114H-3.3 (3.3V/1A) → CM3 + MCU + digital I/O    ║  │
                    │  ║    → LDO XC6206P182MR (1.8V/200mA) → ADC DVDD                ║  │
                    │  ║    → Boost SX1308 (+15V/200mA) → AO op-amp rail              ║  │
                    │  ╚═══════════════════════════════════════════════════════════════╝  │
                    └───────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow

```
BACnet/IP ──► GbE ──► CM3 ──► UART2 (IOP) ──► STM32 ──► ADS131M08 (UI)
  Client                                                     DAC8554  (AO)
                    │                                        PC817    (DI)
                    │                                        ULN2003  (DO)
                    │
                    ├── UART4 ──► MAX13487E ──► RS-485 (Modbus RTU)
                    │
                    ├── SPI0 ──► HMI TFT ILI9341
                    │
                    ├── I2C0 ──► RTC DS3231
                    │
                    └── USB-C ──► Console (debug / commissioning)
```

---

## 3. I/O Block Summary

| Block | Quantity | Interface | IC/Component | Isolation |
|-------|:--------:|-----------|-------------|-----------|
| **Universal Input (UI)** | 8 | SPI3 → ADS131M08 | TMUX1208 ×8, ADS131M08 | TVS (SMAJ15A) + Schottky clamp |
| **Analog Output (AO)** | 4 | SPI1 → DAC8554 | DAC8554, TLV4110 | TVS (SMAJ12A) |
| **Digital Input (DI)** | 8 | GPIO (PB4–PB11) | PC817B ×8 | Opto-isolated (DIP-4) |
| **Digital Output (DO)** | 4 | GPIO → ULN2003 | HF46F-005 ×4 | Relay isolation (3.2mm clearance) |
| **RS-485** | 1 | UART4 → MAX13487E | MAX13487E + ADUM1201 | TVS (SMAJ6.5A) on bus |
| **Ethernet** | 1 | RGMII (CM3 onboard) | HR911105A (integrated mag) | Transformer isolation |

---

## 4. Power Distribution

```
24VAC/VDC ──► BR1 (GBU4J) ──► D51 TVS (P6KE33A) ──► F1 (MF-R200/12)
                │
                ├──► U28 LM2596HVS ──► 5V/3A ──► Radxa CM3
                │                                ├──► USB-C, USB-A
                │                                └──► STM32 MCU
                │
                ├──► U29 AP2114H ──► 3.3V/1A ──► MCU, ADC, DAC, RS-485, HMI
                │
                ├──► U30 XC6206P182MR ──► 1.8V/200mA ──► ADC DVDD
                │
                └──► U31 SX1308 ──► +15V/200mA ──► AO op-amp (TLV4110)
```

---

## 5. Mechanical & Environmental

| Parameter | Value |
|-----------|-------|
| PCB | 148 × 88 mm, 4-layer |
| Enclosure | DIN-rail mount, 150×90×55mm |
| Operating temp | -20°C ~ 65°C (with heatsink CM3) |
| Power input | 24VAC/VDC ±20% |
| Protection | TVS input surge, polyfuse 2A, reverse polarity via bridge rectifier |

---

## 6. Tài liệu tham khảo

| Tài liệu | Link |
|----------|------|
| Carrier Board Block Diagram | hardware-design/02_carrier_board/CB_BLOCK_DIAGRAM.md |
| SOM Spec (Radxa CM3) | hardware-design/01_som/SOM_SPEC_RADXA_CM3.md |
| BOM Chi tiết | hardware-design/06_bom/BOM_MK-DDC-24_v1.md |
| SRS (Software Requirements) | spec/SW_REQUIREMENTS_MK-DDC-24_VI.md |

---

**Document ID:** CR-QCVN-B2-v1 | Rev 1.1 | 2026-06-04
