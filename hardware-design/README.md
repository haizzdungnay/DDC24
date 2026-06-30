# MK-DDC-24 - Hardware Design Documentation

> **SOM:** Radxa CM3 (RK3566, Quad-core A55, 2GB LPDDR4 baseline)
> **MCU:** STM32G0B1RBT6
> **Hardware docs rev:** HW-DES v1.4 | 2026-06-30
> **Status:** Draft for Rev A schematic review after UI architecture correction

---

## 1. Current Rev A Architecture

Rev A controlled decisions:

- 16 Universal Input analog channels remain the main input architecture.
- 2x ADS131M08 remain the ADC architecture.
- STM32 is the only ADC SPI master.
- CM3 receives raw signed ADC data and performs scale/linearization.
- UI modes: 0-10V, 4-20mA, NTC 10k/20k/configured, auxiliary dry contact.
- Per-channel mode select uses a latch/shift-register scheme; shared SEL[2:0] is rejected.
- 4-20mA uses 49.9R 0.1% 25ppm shunt.
- PT100/PT1000 are not Universal Input Rev A modes.
- Dry contact through UI is auxiliary only and does not replace industrial isolated DI.
- TMUX/analog switches are low-voltage only, after protection and mode front-end.

---

## 2. Directory Structure

```text
hardware-design/
├── README.md
├── 01_som/
│   └── SOM_SPEC_RADXA_CM3.md
├── 02_carrier_board/
│   ├── CB_BLOCK_DIAGRAM.md
│   ├── CB_SCHEMATIC_NOTES.md
│   └── GROUNDING_SCHEME.md
├── 03_io_subsystem/
│   ├── IO_UI_CIRCUIT.md
│   ├── IO_AO_CIRCUIT.md
│   ├── IO_DO_RELAY.md
│   ├── IO_RS485_CIRCUIT.md
│   └── IO_DI_CIRCUIT.md              archived reference; not UI replacement
├── 04_power_supply/
│   └── PWR_DESIGN.md
├── 05_mcu_io/
│   ├── MCU_STM32G0_SPEC.md
│   ├── IOP_PROTOCOL.md
│   └── FW-ADC-SAMPLING.md
├── 06_bom/
│   ├── BOM_MK-DDC-24_v1.md
│   └── BOM-UI-16CH.md
├── 07_emc_thermal/
│   └── EMC_THERMAL_NOTES.md
├── 08_mechanical/
│   └── MECHANICAL_ENCLOSURE.md
├── 09_hw_bringup/
│   ├── HW_BRINGUP_TEST_PROCEDURE.md
│   └── HW-TEST-UI-16CH.md
├── 10_manufacturing/
│   └── MFG_DATA_PACKAGE.md
├── hw_design_review/
│   ├── SCHEMATIC_REVIEW_CHECKLIST.md
│   ├── HW-RISK-UI-16CH.md
│   └── HW_DOC_REVIEW_CLOSURE_PLAN.md
├── kicad/
│   └── PCB_PLACEMENT_GUIDE.md
└── REWORK_DI_TO_UI.md                 superseded historical note
```

---

## 3. Read This First for UI Rev A

| Order | Document | Purpose |
|------:|----------|---------|
| 1 | `03_io_subsystem/IO_UI_CIRCUIT.md` | HW-DES-03-UI architecture decision and per-mode circuits |
| 2 | `02_carrier_board/CB_BLOCK_DIAGRAM.md` | System signal chain and board-level boundary |
| 3 | `02_carrier_board/CB_SCHEMATIC_NOTES.md` | Schematic checklist and sheet rules |
| 4 | `04_power_supply/PWR_DESIGN.md` | Power tree, budgets, regulator/protection release gates |
| 5 | `02_carrier_board/GROUNDING_SCHEME.md` | Chassis, field, digital, and analog return strategy |
| 6 | `03_io_subsystem/IO_RS485_CIRCUIT.md` | RS-485 transceiver, isolation, termination, protection |
| 7 | `05_mcu_io/MCU_STM32G0_SPEC.md` | MCU pinmap and mode latch |
| 8 | `05_mcu_io/IOP_PROTOCOL.md` | Signed int32 UI ADC frame and AO/DO commands |
| 9 | `05_mcu_io/FW-ADC-SAMPLING.md` | 1ms acquisition and 2ms poll/response timing |
| 10 | `06_bom/BOM-UI-16CH.md` | UI BOM, tolerances, alternates |
| 11 | `07_emc_thermal/EMC_THERMAL_NOTES.md` | Port-level EMC targets and thermal checks |
| 12 | `09_hw_bringup/HW-TEST-UI-16CH.md` | UI test plan |
| 13 | `10_manufacturing/MFG_DATA_PACKAGE.md` | Fabrication outputs and approval gate |
| 14 | `hw_design_review/HW_DOC_REVIEW_CLOSURE_PLAN.md` | Review issue status and required evidence |
| 15 | `hw_design_review/SCHEMATIC_REVIEW_CHECKLIST.md` | Sign-off checklist before layout |

---

## 4. Architecture Diagram

```text
24VAC/VDC
  -> fuse / bridge / coordinated surge protection
  -> regulated 5V, 3.3V, 1.8V, +15V_AO, +5V_RELAY rails

UI1..UI16 -> terminal protection -> mode front-end -> low-voltage mux/buffer
           -> 2x ADS131M08 -> STM32G0B1

STM32G0B1 -> DAC8554 / AO front-end -> AO1..AO4
           -> relay driver / dry contacts -> DO1..DO4
           <-> IOP v2 UART, SOM polls every 2ms <-> Radxa CM3

Radxa CM3 -> Ethernet / USB / local HMI
           -> protected RS-485 Modbus RTU master -> downstream devices
           -> Linux scaling / control / BACnet-IP / MQTT / REST
```

Optional true industrial DI, if required, must be a separate isolated-DI sheet/module. It is not provided by UI dry-contact mode.

---

## 5. Release Gates Before Schematic/Layout

- [ ] PM accepts Rev A scope: no RTD UI, dry contact auxiliary only.
- [ ] HW Lead approves protection and error budgets.
- [ ] FW Lead approves mode latch, sampling sequence, and IOP frame.
- [ ] QA approves `HW-TEST-UI-16CH.md` and risk closure evidence.
- [ ] BOM values match schematic.
- [ ] P0 rows in `HW_DOC_REVIEW_CLOSURE_PLAN.md` have engineering evidence or signed waivers.
- [ ] No document used for release contradicts HW-DES-03-UI Rev 2.2 or later.

---

## Revision History

| Date | Rev | Change |
|------|-----|--------|
| 2026-05-27 | v1.0 | Initial hardware docs |
| 2026-05-30 | v1.1 | STM32G0B1 and MCU-master ADC architecture updates |
| 2026-06-23 | v1.2 | Initial DI to UI migration |
| 2026-06-23 | v1.3 | UI architecture review: per-channel mode select, TMUX low-voltage only, 49.9R shunt, RTD removed, dry contact auxiliary only, signed int32 IOP frame |
| 2026-06-30 | v1.4 | Full-system diagram, power/EMC/grounding/RS-485 reading order, and hardware-review closure gate |

---

**Document ID:** HW-DES-README | Rev 1.4 | 2026-06-30
