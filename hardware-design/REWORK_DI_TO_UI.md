# REWORK SPEC - DI to UI Migration (Superseded)

> **Document:** HW-REWORK-01 | Rev 2.0 | 2026-06-23  
> **Status:** SUPERSEDED by `03_io_subsystem/IO_UI_CIRCUIT.md` Rev 2.2 and related UI Rev A documents  
> **Purpose:** Historical record of the initial DI-to-UI migration only

---

## 1. Supersession Notice

The 2026-06-22 migration proposal is no longer the controlling design source. It contained assumptions that are not acceptable for schematic/layout release:

- Shared `SEL[2:0]` across all 16 channels.
- Dry contact through UI described as a full replacement for industrial DI.
- 62R current shunt for 4-20mA.
- RTD/PT100/PT1000 treated as a Universal Input mode.
- TMUX placement that could be interpreted as field-facing.
- BOM assumptions around REF200/RTD that do not match Rev A scope.

Use the controlled Rev A documents below instead.

---

## 2. Current Rev A Decision

| Topic | Current decision |
|-------|------------------|
| UI count | Keep 16 UI analog channels |
| ADC | Keep 2x ADS131M08, STM32 is sole SPI master |
| Mode select | Per-channel mode latch/shift-register outputs; no shared SEL for all channels |
| Supported UI modes | 0-10V, 4-20mA, NTC 10k/20k/configured, auxiliary dry contact |
| 4-20mA shunt | 49.9R 0.1% 25ppm/C, power checked to 24mA overrange |
| 0-10V | Divider + RC + rail-to-rail buffer |
| NTC | Precision/measured/ratiometric excitation |
| Dry contact | Auxiliary clean dry contact only; no isolated DI claim |
| PT100/PT1000 | Removed from Universal Input Rev A; dedicated RTD module required if needed |
| IOP | Binary frame, 16 x signed int32 raw ADC, CRC16 |

---

## 3. Controlling Documents

| Document | Purpose |
|----------|---------|
| `03_io_subsystem/IO_UI_CIRCUIT.md` | HW-DES-03-UI Rev A architecture |
| `05_mcu_io/MCU_STM32G0_SPEC.md` | MCU pinmap and mode latch control |
| `02_carrier_board/CB_BLOCK_DIAGRAM.md` | Carrier-level signal chain |
| `02_carrier_board/CB_SCHEMATIC_NOTES.md` | Schematic checklist and sheet rules |
| `05_mcu_io/IOP_PROTOCOL.md` | UI ADC binary frame proposal |
| `05_mcu_io/FW-ADC-SAMPLING.md` | Firmware sampling sequence |
| `09_hw_bringup/HW-TEST-UI-16CH.md` | UI test plan |
| `hw_design_review/HW-RISK-UI-16CH.md` | Risk register |
| `06_bom/BOM-UI-16CH.md` | UI-specific BOM |

---

## 4. Historical Migration Items Preserved

The useful parts of the original migration remain valid only as historical background:

- 16 UI channels are desired.
- 2x ADS131M08 is still the ADC architecture.
- STM32 remains the ADC master.
- CM3 receives raw data and performs scaling/linearization.

All other implementation details must be checked against the current controlled documents.

---

**Document ID:** HW-REWORK-01 | Rev 2.0 | 2026-06-23
