# PCB Placement Guide - MK-DDC-24 Carrier Board

> **Document:** PCB-PG-01 | Rev 1.3 | 2026-06-23
> **KiCad target project:** `docs/04_design/hardware/kicad/MK-DDC-24-Carrier.kicad_pcb` (currently missing; manufacturing blocked)
> **Board size:** 148 x 88 mm, 4-layer, 1.6 mm FR4
> **UI Rev A placement rule:** field protection and mode front-end before any low-voltage mux/buffer

---

## Revision History

| Rev | Date | Changes |
|-----|------|---------|
| 1.0 | 2026-06-02 | Initial release |
| 1.1 | 2026-06-02 | Added K4 relay footprint |
| 1.2 | 2026-06-23 | DI to UI migration, 16 UI and ADS131M08 #2 |
| 1.3 | 2026-06-23 | UI architecture review: TMUX low-voltage only, protection/front-end closest to terminals, per-channel mode latch placement |

---

## 1. KiCad Project Structure

```text
docs/04_design/hardware/kicad/
├── MK-DDC-24-Carrier.kicad_pro
├── MK-DDC-24-Carrier.kicad_pcb
├── MK-DDC-24-Carrier.kicad_sch
├── 02_CM3.kicad_sch
├── 03_MCU.kicad_sch
├── 04_POWER.kicad_sch
├── 05_UI_INPUT.kicad_sch
├── 06_AO_OUTPUT.kicad_sch
├── 07_DO_RELAY.kicad_sch
├── 08_COMM.kicad_sch
├── 09_PERIPHERAL.kicad_sch
└── 10_DI_ISOLATED_OPTION.kicad_sch   optional SKU sheet, not a UI substitute
```

If the KiCad hierarchy still contains `06_DI_INPUT.kicad_sch`, it must be renamed/archived before Rev A schematic release or moved to the optional isolated-DI sheet.

---

## 2. Component Placement Zones

Coordinate origin: bottom-left corner, X=0..148, Y=0..88.

```text
 88 +-----------------+------------------+----------------------+
    | POWER           | CM3 B2B          | COMMUNICATIONS       |
    | X:2-50 Y:55-86  | X:46-102 Y:42-86 | X:100-146 Y:55-86    |
    +-----------------+------------------+----------------------+
    | MCU + ADC + DAC | UI FIELD +       | DO RELAY             |
    | X:5-50 Y:20-55  | FRONT-END        | X:95-146 Y:5-42      |
    |                 | X:50-95 Y:5-42   |                      |
    +-----------------+------------------+----------------------+
      0               50                 95                    148
```

| Zone | Area | Components |
|------|------|------------|
| 1 - Power | X:2-50, Y:55-86 | 24V terminal, fuse, bridge, TVS, DC/DC, LDOs |
| 2 - CM3 B2B | X:46-102, Y:42-86 | B2B connectors and bypass caps, bottom keepout |
| 3 - MCU/ADC/DAC | X:5-50, Y:20-55 | STM32, ADS131M08 #1/#2, DAC8554, refs, crystals, SWD |
| 4 - Comms | X:100-146, Y:55-86 | RJ-45, RS-485, USB |
| 5A - UI terminal/protection | X:50-95, Y:5-16 | UI terminals, TVS, PTC/fusible elements, EMC filters |
| 5B - UI mode front-end | X:50-95, Y:16-30 | Divider, shunt, pull-up, RC, protection clamps |
| 5C - UI low-voltage mux/buffer | X:50-95, Y:30-42 | TMUX/analog switches and op-amp buffers after scaling/clamp only |
| 6 - Relay | X:95-146, Y:5-42 | Relays, ULN2003, DO terminal, HV clearance |

**Critical placement change:** Do not place TMUX1208 directly behind UI terminals as the first field-facing component. Terminal-side field voltage must first pass through protection and the mode front-end, then only the scaled low-voltage node may enter mux/buffer/ADC circuitry.

---

## 3. Component Coordinates

Coordinates are starting recommendations and must be adjusted in KiCad after footprint selection.

### 3.1 MCU / ADC / DAC Cluster

| RefDes | Component | Package | X | Y | Notes |
|--------|-----------|---------|--:|--:|-------|
| U2 | STM32G0B1RBT6 | LQFP-64 | 22 | 35 | Center of realtime cluster |
| U3 | ADS131M08 #1 | TSSOP-32 | 22 | 18 | UI1-UI8 |
| U3B | ADS131M08 #2 | TSSOP-32 | 35 | 24 | UI9-UI16, close to U2/U3 |
| U4 | DAC8554 | TSSOP-16 | 40 | 35 | AO DAC |
| U5 | REF3025 / analog ref | SOT-23-3 | 40 | 28 | Keep quiet |
| Y2 | 8MHz MCU crystal | 3225 | 15 | 38 | <10mm to MCU |
| Y3 | 4.096MHz ADC clock | 3225 | 18 | 22 | Near ADS devices or buffered clock source |
| J14 | SWD header | 1x05 | 12 | 30 | Edge-accessible |

### 3.2 UI Zone

| RefDes | Component group | X | Y | Placement rule |
|--------|-----------------|--:|--:|----------------|
| J4A | UI1-UI8 terminal | 62 | 5 | Bottom edge |
| J4B | UI9-UI16 terminal | 88 | 5 | Bottom edge |
| D_UIx | UI TVS/protection | 62-92 | 10 | Closest parts to terminal |
| F_UIx/RF_UIx | PTC/fusible/series protection | 62-92 | 13 | Before front-end |
| R_DIV/R_SHUNT/R_NTC | Mode front-end passives | 58-92 | 18-27 | Field-scaled stage |
| U_BUFx | RRIO input buffers | 58-92 | 28-34 | Low-voltage side |
| U_MUXx | TMUX/analog switch if used | 58-92 | 34-40 | Low-voltage conditioned node only |
| U_MODE_LATCH | 74HC595/74HCS595 chain | 50-58 | 32-42 | Near MCU side of UI zone, not terminal side |

### 3.3 Communications and Relay

Keep existing placement intent:

- RJ-45 at the right edge/top-right.
- RS-485 terminal near edge with TVS before transceiver.
- Relays at bottom-right with >=3.2mm clearance and >=4mm creepage on contacts.
- No copper pour under relay contact traces.

---

## 4. Routing Rules

### 4.1 UI Routing

| Segment | Rule |
|---------|------|
| Terminal to TVS/PTC | Shortest route; transient return to field/protection ground path |
| Protection to front-end | Size for calculated fault current/power |
| Front-end to mux/buffer | Low-voltage node only; keep away from relay and DC/DC |
| Buffer/mux to ADS | Short, quiet, guarded where practical |
| Field 24V-capable traces | Do not enter MCU/ADC cluster directly |
| ADC reference return | Keep separate from surge/fault current return until controlled ground point |

### 4.2 SPI3 ADC Routing

| Parameter | Requirement |
|-----------|-------------|
| Max length | 50mm target in MCU/ADC cluster |
| Series R | 22-33R on SCLK/MOSI/MISO near driver |
| CS pull-up | 10k for CS1 and CS2 |
| DRDY | PA8 and PA6 as clean EXTI signals |
| Keep away | Relay contact traces, DC/DC switch node, field surge return |

### 4.3 UI Mode Latch Routing

| Signal | Rule |
|--------|------|
| DATA/CLK/LATCH/OE | Route as digital control, away from ADC input nodes |
| Latch outputs | Short to mode-select pins, add default pulls where needed |
| Test access | Provide pads for DATA, CLK, LATCH, OE |

---

## 5. Test Points

| Ref | Signal | Purpose |
|-----|--------|---------|
| TP1 | VCC_5V | 5V rail |
| TP2 | VCC_3V3 | 3.3V rail |
| TP3 | GND | Ground |
| TP4 | UART0_TX | Debug |
| TP5 | UART2_TX | IOP |
| TP6 | SPI3_CLK | ADC SPI |
| TP7 | RS485_A | RS-485 A |
| TP8 | RS485_B | RS-485 B |
| TP9 | MCU_nRESET | Reset |
| TP10-TP25 | UI1-UI16_FIELD | Terminal-side UI checks |
| TP26-TP33 | Representative `UIx_SENSE_LV` | Low-voltage front-end node checks |
| TP34-TP37 | UI_MODE_DATA/CLK/LATCH/OE | Mode latch debug |

---

## 6. Remaining Work in KiCad GUI

- [ ] Update schematic hierarchy to match Rev A sheet names.
- [ ] Annotate mode latch parts and UI front-end components.
- [ ] Run ERC to confirm no field net enters mux/ADC directly.
- [ ] Update PCB from schematic.
- [ ] Route field protection first, then low-voltage analog, then digital controls.
- [ ] Run DRC including relay clearance and terminal spacing.
- [ ] Review 3D/mechanical clearance for terminal block and DIN enclosure.
- [ ] Export Gerber/NC drill/P&P only after HW/FW/QA sign-off.

---

**Document ID:** PCB-PG-01 | Rev 1.3 | 2026-06-23
