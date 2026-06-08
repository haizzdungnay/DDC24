# PCB Placement Guide — MK-DDC-24 Carrier Board

> **Tài liệu:** PCB-PG-01 | Rev 1.1 | 2026-06-02  
> **KiCad project:** `hardware-design/kicad/MK-DDC-24-Carrier.kicad_pcb`  
> **Kích thước:** 148×88mm, 4-layer, 1.6mm FR4  
> **Thay đổi từ Rev 1.0:** Added K4 relay footprint (X=95, Y=30, staggered)

---

## 1. KiCad Project Structure

```
hardware-design/kicad/
├── MK-DDC-24-Carrier.kicad_pro       ← Project settings
├── MK-DDC-24-Carrier.kicad_pcb       ← PCB layout (1223 lines)
├── MK-DDC-24-Carrier.kicad_sch       ← Root schematic (hierarchy)
├── 02_CM3.kicad_sch                  ← CM3 SOM interface
├── 03_MCU.kicad_sch                  ← STM32G0B1 MCU
├── 04_POWER.kicad_sch                ← Power supply
├── 05_UI_INPUT.kicad_sch             ← Universal inputs
├── 06_DI_INPUT.kicad_sch             ← Digital inputs
├── 07_AO_OUTPUT.kicad_sch            ← Analog outputs
├── 08_DO_RELAY.kicad_sch             ← Digital output / relay
├── 09_COMM.kicad_sch                 ← Communications
├── 10_PERIPHERAL.kicad_sch           ← Peripherals
└── PCB_PLACEMENT_GUIDE.md            ← This file
```

---

## 2. Component Placement Zones

PCB coordinate origin: **bottom-left corner** (0,0). Dimensions: X=0..148, Y=0..88.

```
 88 +─────────────────┬──────────────────┬──────────────────────+
    │   POWER SUPPLY   │   CM3 B2B ZONE   │    COMMUNICATIONS    │
    │   Zone 1         │   Zone 2         │    Zone 4            │
    │   X: 2-50        │   X: 46-102      │    X: 100-146        │
    │   Y: 55-86       │   Y: 42-86       │    Y: 55-86          │
    │                  │   (keepout below)│                      │
    ├─────────────────┼──────────────────┼──────────────────────┤
    │   MCU + ADC +    │                  │                      │
    │   DAC Cluster    │   UI/DI/AO       │    DO RELAY ×4       │
    │   Zone 3         │   Zone 5         │    Zone 6            │
    │   X: 5-50        │   X: 50-95       │    X: 95-146         │
    │   Y: 20-55       │   Y: 5-42        │    Y: 5-42           │
    │                  │                  │    (HV clearance     │
    │                  │                  │     3.2mm)           │
    │                  ├──────────────────┴──────────────────────┤
    │                  │   Terminal blocks (bottom edge)        │
    │                  │   UI | AO | DI | DO                    │
  0 └──────────────────┴─────────────────────────────────────────┘
  0                  50                 95                 148
```

### Zone Details

| Zone | Area (mm) | Components |
|------|-----------|------------|
| **1 — Power** | X:2-50, Y:55-86 | J7, F1, BR1, D51, C1, U28(LM2596), L1, D50, U29(AP2114H), U30(XC6206P182), U31(SX1308) |
| **2 — CM3 B2B** | X:46-102, Y:42-86 | J11/J12/J13 (B2B connectors), bypass caps. Bottom layer keepout: no components |
| **3 — MCU+ADC+DAC** | X:5-50, Y:20-55 | U2(STM32G0B1), U3(ADS131M08), U4(DAC8554), U5(REF3025), U6(DS3231), Y2(8MHz), Y3(4.096MHz), J14(SWD) |
| **4 — Comms** | X:100-146, Y:55-86 | J2(RJ-45), U7(MAX13487E), U8(ADUM1201), J1(RS-485), J8(USB-C), J9(USB-A) |
| **5 — I/O** | X:50-95, Y:5-42 | J4(UI), J3(DI), J5(AO), terminal blocks, passives, TMUX1208 ×8, PC817 ×8 |
| **6 — Relay** | X:95-146, Y:5-42 | K1-K4(HF46F), U27(ULN2003A), J6(DO), DO LEDs. HV clearance ≥3.2mm |

---

## 3. Component Coordinates (Detail)

### 3.1 Power Supply (Zone 1)

| RefDes | Component | Package | X (mm) | Y (mm) | Layer | Rotation |
|--------|-----------|---------|:------:|:------:|:-----:|:--------:|
| J7 | 24V terminal 2P | MKDS 1/2-5.08 | 12 | 82.5 | F.Cu | 90° |
| F1 | Polyfuse MF-R200 | 1812 | 8 | 73 | F.Cu | 0° |
| BR1 | Bridge GBU4J | GBU | 8 | 62 | F.Cu | 0° |
| D51 | TVS P6KE33A | DO-15 | 16 | 55 | F.Cu | 0° |
| C1 | Bulk 2200µF/50V | Radial D10 | 22 | 80 | F.Cu | 0° |
| U28 | LM2596HVS-5.0 | D²PAK/TO-263 | 30 | 68 | F.Cu | 0° |
| L1 | Inductor 100µH/3A | 12×12mm SMD | 30 | 58 | F.Cu | 0° |
| D50 | Schottky SS34 | DO-214AC | 38 | 56 | F.Cu | 0° |
| U29 | LDO AP2114H-3.3 | SOT-223 | 15 | 48 | F.Cu | 0° |
| U30 | LDO XC6206P182 | SOT-23-3 | 22 | 48 | F.Cu | 0° |
| U31 | Boost SX1308 | SOT-23-6 | 30 | 48 | F.Cu | 0° |

### 3.2 CM3 B2B (Zone 2)

| RefDes | Component | Package | X (mm) | Y (mm) | Layer | Rotation |
|--------|-----------|---------|:------:|:------:|:-----:|:--------:|
| J11 | CON1 B2B | DF40HC-100DS | 57 | 48 | F.Cu | 0° |
| J12 | CON2 B2B | DF40HC-100DS | 74 | 48 | F.Cu | 0° |
| J13 | CON3 B2B | DF40HC-100DS | 91 | 48 | F.Cu | 0° |
| SW1 | DIP SW 8-bit | CTS slide | 60 | 62 | F.Cu | 0° |
| J10 | microSD slot | Push-push | 46 | 77.5 | F.Cu | 0° |

**B2B connector spacing:** 17mm center-to-center (J11→J12=17mm, J12→J13=17mm).  
**CM3 keepout:** B.Cu layer, X=46.5..101.5, Y=44..84 — no components or vias.

### 3.3 MCU + ADC + DAC (Zone 3)

| RefDes | Component | Package | X (mm) | Y (mm) | Layer | Rotation |
|--------|-----------|---------|:------:|:------:|:-----:|:--------:|
| U2 | STM32G0B1RBT6 | LQFP-64 | 22 | 35 | F.Cu | 0° |
| U3 | ADS131M08 | TSSOP-32 | 22 | 18 | F.Cu | 0° |
| U4 | DAC8554 | TSSOP-16 | 40 | 35 | F.Cu | 0° |
| U5 | REF3025 | SOT-23-3 | 40 | 28 | F.Cu | 0° |
| U6 | DS3231 RTC | SOIC-16 | 45 | 45 | F.Cu | 0° |
| Y2 | Crystal 8MHz | 3225 | 15 | 38 | F.Cu | 0° |
| Y3 | Crystal 4.096MHz | 3225 | 15 | 22 | F.Cu | 0° |
| J14 | SWD debug | 1×05 1.27mm | 12 | 30 | F.Cu | 0° |

**Routing priority within Zone 3 (shortest traces first):**
1. U2 ↔ U3 (SPI3): CLK, MOSI, MISO, CS — max 50mm
2. U2 ↔ U4 (SPI1): CLK, MOSI, CS, LDAC — max 50mm
3. U3 ↔ Y3 (ADC CLKIN): 4.096MHz crystal — keep <10mm
4. U2 ↔ Y2 (HSE): 8MHz crystal — keep <10mm

### 3.4 Communications (Zone 4)

| RefDes | Component | Package | X (mm) | Y (mm) | Layer | Rotation |
|--------|-----------|---------|:------:|:------:|:-----:|:--------:|
| J2 | RJ-45 HR911105A | THT | 146 | 62 | F.Cu | 180° |
| U7 | MAX13487E | SOIC-8 | 120 | 75 | F.Cu | 0° |
| U8 | ADUM1201 | SOIC-8 | 110 | 75 | F.Cu | 0° |
| J1 | RS-485 terminal 3P | MKDS 1/3-5.08 | 132 | 84 | F.Cu | 90° |
| J8 | USB-C OTG | TYPE-C-31-M-12 | 140 | 48 | F.Cu | 180° |
| J9 | USB-A Host | USB-A vertical | 140 | 38 | F.Cu | 180° |

### 3.5 Relay — Zone 6

| RefDes | Component | Package | X (mm) | Y (mm) | Layer | Rotation |
|--------|-----------|---------|:------:|:------:|:-----:|:--------:|
| K1 | Relay HF46F-005-HS1TGF | HF46F | 110 | 18 | F.Cu | 0° |
| K2 | Relay HF46F-005-HS1TGF | HF46F | 125 | 18 | F.Cu | 0° |
| K3 | Relay HF46F-005-HS1TGF | HF46F | 140 | 18 | F.Cu | 0° |
| K4 | Relay HF46F-005-HS1TGF | HF46F | 95 | 30 | F.Cu | 0° |

**Layout note:** K1-K3 aligned in a row at Y=18mm. K4 staggered left and down (Y=30mm) for ≥5mm HV clearance per IEC 61010-1. See §5.6 for routing rules.

### 3.6 Test Points

| Ref | Signal | X (mm) | Y (mm) | Layer | Diameter |
|-----|--------|:------:|:------:|:-----:|:--------:|
| TP1 | VCC_5V | 8 | 8 | F.Cu | 1.5mm |
| TP2 | VCC_3V3 | 8 | 13 | F.Cu | 1.5mm |
| TP3 | GND | 8 | 18 | F.Cu | 1.5mm |
| TP4 | UART0_TX | 140 | 10 | F.Cu | 1.0mm |
| TP5 | UART2_TX | 140 | 15 | F.Cu | 1.0mm |
| TP6 | SPI3_CLK | 5 | 28 | F.Cu | 1.0mm |
| TP7 | RS485_A | 140 | 20 | F.Cu | 1.0mm |
| TP8 | RS485_B | 140 | 25 | F.Cu | 1.0mm |
| TP9 | MCU_nRESET | 5 | 33 | F.Cu | 1.0mm |
| TP10 | UI1 | 50 | 12 | B.Cu | 1.0mm |
| TP11 | UI2 | 55 | 12 | B.Cu | 1.0mm |
| TP12 | UI3 | 60 | 12 | B.Cu | 1.0mm |
| TP13 | UI4 | 65 | 12 | B.Cu | 1.0mm |
| TP14 | UI5 | 70 | 12 | B.Cu | 1.0mm |
| TP15 | UI6 | 75 | 12 | B.Cu | 1.0mm |
| TP16 | UI7 | 80 | 12 | B.Cu | 1.0mm |
| TP17 | UI8 | 85 | 12 | B.Cu | 1.0mm |

---

## 4. DRC Rules Coverage

| Rule | Spec | PCB File Setting | Status |
|------|:----:|:----------------:|:------:|
| Min trace width (signal) | 0.1mm | 0.1mm track_min_width | ✅ |
| Min trace width (power ≤1A) | 0.3mm | 0.3mm (Power_<=1A class) | ✅ |
| Min trace width (power >1A) | 0.8mm | 0.8mm (Power_>1A class) | ✅ |
| Min via drill | 0.2mm | 0.2mm via_min_drill | ✅ |
| Min via diameter | 0.4mm | 0.4mm via_min_diameter | ✅ |
| Min clearance (general) | 0.1mm | 0.15mm trace_clearance | ✅ |
| HV relay clearance | 3.2mm | 3.2mm (clearance_override HV) | ✅ |
| B2B tight clearance | 0.3mm | 0.3mm (clearance_override B2B) | ✅ |
| Min annular ring | 0.1mm | — (pad-dependent) | ⚠️ Verify in KiCad |
| RGMII 50Ω impedance | ±10% | RGMII_50R class (w=0.3mm) | ⚠️ Needs width calc |
| RS-485 diff pair 120Ω | ±10% | RS485_Diff class (w=0.3/g=0.2) | ⚠️ Needs width calc |
| RGMII length matching | ±0.5mm | — | ❌ Manual routing |
| RGMII max trace length | 100mm | — | ❌ Manual routing |
| Terminal block pitch | 5.08mm | Via footprint | ✅ |
| Mounting holes | 4×M3 (3.2mm drill) | 4× MountingHole_3.2mm | ✅ |

**✅ = Set in design rules / footprint**  
**⚠️ = Needs verification with stackup**  
**❌ = Requires manual routing in KiCad**

---

## 5. Routing Rules by Signal Group

### 5.1 RGMII (Ethernet, 125MHz DDR)

| Parameter | Requirement |
|-----------|-------------|
| Impedance | 50Ω ±10% single-ended (trace width ~0.3mm with 0.2mm prepreg) |
| Length match TX | ±0.5mm (TXD0-3, TXC, TX_CTL) |
| Length match RX | ±0.5mm (RXD0-3, RXC, RX_CTL) |
| Reference plane | L2 GND — continuous, no slots |
| Spacing | ≥3× trace width from other signals (≥0.9mm) |
| Via count | Max 2 per net (prefer 0-1) |
| Route order | J2(RJ-45) → J13(CON3) shortest path |

### 5.2 SPI3 (MCU ↔ ADC, 4MHz)

| Parameter | Requirement |
|-----------|-------------|
| Max length | 50mm (U2 ↔ U3, same zone) |
| Series R | 33Ω on CLK, MOSI, MISO |
| CS pull-up | 10kΩ to 3.3V |
| Keep away | ≥5mm from relay HV, ≥3mm from DC/DC inductor |

### 5.3 SPI1 (MCU ↔ DAC, 10MHz)

| Parameter | Requirement |
|-----------|-------------|
| Max length | 50mm (U2 ↔ U4, same zone) |
| LDAC | PB0 GPIO control, route to DAC8554 pin |
| VREF | REF3025 output → clean trace, shielded by GND |

### 5.4 RS-485 (UART4, 115.2kbps)

| Parameter | Requirement |
|-----------|-------------|
| Differential pair | A/B, width=0.3mm, gap=0.2mm, 120Ω target |
| Isolation | ADUM1201 between CM3 UART4 and MAX13487E |
| TVS | SMAJ6.5A at terminal, before MAX13487E |
| Gap | ≥3mm from low-voltage logic (CM3 side of isolator) |

### 5.5 UART2 (CM3 ↔ MCU IOP, 921.6kbps)

| Parameter | Requirement |
|-----------|-------------|
| Max length | 80mm |
| Series R | 33Ω on TX lines |
| Vias | Minimize (prefer 0-2) |
| Keep away | ≥3mm from DC/DC, relay |

### 5.6 High-Voltage Relay (250VAC)

| Parameter | Requirement |
|-----------|-------------|
| Clearance | ≥3.2mm (IEC 61010-1 Cat II, Poll 2) |
| Traces | B.Cu only (L4, bottom layer) |
| Copper fill | No copper under relay contact traces |
| Relay spacing | ≥5mm between relays (K4 staggered at Y=30mm for clearance) |

---

## 6. Layer Utilization

| Layer | Function | Key Content |
|-------|----------|-------------|
| **L1 (F.Cu)** | Signal_Top | CM3 B2B, MCU, connectors, fine-pitch ICs, power routing |
| **L2 (In1.Cu)** | GND_Plane | Solid ground plane — no splits, continuous SI reference |
| **L3 (In2.Cu)** | PWR_Plane | Split: top half=5V, middle=3.3V, bottom=GND |
| **L4 (B.Cu)** | Signal_Bot | I/O terminal blocks, relay, opto, HV traces, TP10-17 |

**GND stitching:** Via stitching around B2B area (4 vias min), around RJ-45, and near DC/DC.

---

## 7. Remaining Work (In KiCad GUI)

These items **cannot be done via file generation** and require KiCad PCB Editor:

1. **Netlist import:** Open schematic → Annotate → Run ERC → Tools → Update PCB from Schematic
2. **Routing all traces:** Manual interactive routing following rules in §5. Includes K4 coil drive (DO4_DRV) and contact traces via ULN2003A and J6 terminal block
3. **RGMII length tuning:** Use KiCad's tuned-route tool for length matching (±0.5mm)
4. **RS-485 diff pair routing:** Use KiCad's Diff Pair routing tool
5. **Zone fill refinement:** Re-fill zones after routing (B.Cu keepout under CM3)
6. **Copper pour for LM2596:** 20×20mm heat spreader on L1 + 8 thermal vias to L2
7. **DRC verification:** Tools → Design Rules Checker → Run DRC
8. **3D viewer check:** Inspect for mechanical conflicts (mounting holes, relay clearance, B2B connectors)
9. **Gerber/NC drill export:** File → Plot → Generate Gerber files + NC drill files

### Update History

| Rev | Date | Changes |
|-----|------|---------|
| 1.1 | 2026-06-02 | Added K4 footprint (X=95, Y=30). Updated §5.6 with staggered layout note. |
| 1.0 | 2026-06-02 | Initial release. |

---

## 8. DRC Severity Mapping

| Error/Warning | KiCad DRC Setting |
|--------------|-------------------|
| Clearance violation | error |
| Track width violation | error |
| Unconnected items | error |
| Shorting cycles | error |
| Starved thermal | error |
| PTH inside courtyard | warning |
| Silk over copper | warning |

All DRC severities are pre-configured in `MK-DDC-24-Carrier.kicad_pro` §`design_settings.drc_exclusions`.

---

**Document ID:** PCB-PG-01 | Rev 1.1 | 2026-06-02  
**Prepared for:** IOT-5560 — Tài liệu B4 — Bản vẽ PCB Layout (KiCad)
**Change history:** Rev 1.0 → 1.1: Added K4 relay footprint (X=95, Y=30, staggered)
