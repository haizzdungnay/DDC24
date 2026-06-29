# MK-DDC-24 - Hardware Design Documentation

> **SOM:** Radxa CM3 (RK3566, Quad-core A55, 2GB LPDDR4 baseline)
> **MCU:** STM32G0B1RBT6
> **Hardware docs rev:** HW-DES v1.3 | 2026-06-23
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
│   └── CB_SCHEMATIC_NOTES.md
├── 03_io_subsystem/
│   ├── IO_UI_CIRCUIT.md
│   ├── IO_AO_CIRCUIT.md
│   ├── IO_DO_RELAY.md
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
│   └── HW-RISK-UI-16CH.md
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
| 4 | `05_mcu_io/MCU_STM32G0_SPEC.md` | MCU pinmap and mode latch |
| 5 | `05_mcu_io/IOP_PROTOCOL.md` | Signed int32 UI ADC frame |
| 6 | `05_mcu_io/FW-ADC-SAMPLING.md` | Firmware sampling sequence |
| 7 | `06_bom/BOM-UI-16CH.md` | UI BOM, tolerances, alternates |
| 8 | `09_hw_bringup/HW-TEST-UI-16CH.md` | UI test plan |
| 9 | `hw_design_review/HW-RISK-UI-16CH.md` | Risk register and release blockers |
| 10 | `hw_design_review/SCHEMATIC_REVIEW_CHECKLIST.md` | Sign-off checklist before layout |

---

## 4. Architecture Diagram

```text
UI field terminal
  -> protection / miswire / EMC filter
  -> mode front-end
  -> scaled low-voltage node
  -> mux / buffer / filter
  -> 2x ADS131M08
  -> STM32G0B1
  -> binary IOP frame, 16 x int32 raw_adc
  -> Radxa CM3
  -> Linux scaling / linearization / application
```

Optional true industrial DI, if required, must be a separate isolated-DI sheet/module. It is not provided by UI dry-contact mode.

---

## 5. Release Gates Before Schematic/Layout

- [ ] PM accepts Rev A scope: no RTD UI, dry contact auxiliary only.
- [ ] HW Lead approves protection and error budgets.
- [ ] FW Lead approves mode latch, sampling sequence, and IOP frame.
- [ ] QA approves `HW-TEST-UI-16CH.md` and risk closure evidence.
- [ ] BOM values match schematic.
- [ ] No document used for release contradicts HW-DES-03-UI Rev 2.2 or later.

---

## Revision History

| Date | Rev | Change |
|------|-----|--------|
| 2026-05-27 | v1.0 | Initial hardware docs |
| 2026-05-30 | v1.1 | STM32G0B1 and MCU-master ADC architecture updates |
| 2026-06-23 | v1.2 | Initial DI to UI migration |
| 2026-06-23 | v1.3 | UI architecture review: per-channel mode select, TMUX low-voltage only, 49.9R shunt, RTD removed, dry contact auxiliary only, signed int32 IOP frame |

---

**Document ID:** HW-DES-README | Rev 1.3 | 2026-06-23
