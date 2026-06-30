# Schematic Review Checklist - MK-DDC-24 Carrier Board

> **Document:** HW-REVIEW-01 | Rev 1.3 | 2026-06-30
> **Scope:** Review before PCB fabrication, with mandatory 16 UI Rev A architecture checks

---

## 1. Review Process & Sign-Off

| Review step | Owner | Complete | Notes |
|-------------|-------|----------|-------|
| Designer self-review | HW Designer | [ ] | Net names, front-end values, ERC |
| Peer hardware review | HW Peer | [ ] | Protection, analog accuracy, layout constraints |
| Firmware review | FW Lead | [ ] | Mode latch, ADC sampling, IOP frame |
| QA review | QA Lead | [ ] | Test plan coverage and acceptance criteria |
| Product approval | PM | [ ] | Rev A feature claims and exclusions |
| Final release | HW Lead | [ ] | Schematic may proceed to layout |

---

## 2. Critical Pass/Fail Items

| Item | Pass criteria | Status | Reviewer |
|------|---------------|--------|----------|
| TMUX placement | No field terminal signal enters TMUX/ADC before protection/front-end | [ ] | |
| Signal chain | Terminal -> protection -> mode front-end -> low-voltage mux/buffer -> ADC | [ ] | |
| Mode select | Per-channel latch/shift-register mode select, no shared SEL[2:0] to all channels | [ ] | |
| 4-20mA shunt | 49.9R 0.1% 25ppm, power rating >=0.125W; 0.25W preferred | [ ] | |
| 0-10V buffer | Divider + RC + RRIO buffer before ADC node | [ ] | |
| NTC reference | Precision/measured/ratiometric Vexc; no unverified PMIC 3.3V assumption | [ ] | |
| RTD | PT100/PT1000 absent from Rev A UI or moved to dedicated 3/4-wire design | [ ] | |
| Dry contact | Labeled auxiliary only, no isolated DI replacement claim | [ ] | |
| IOP raw | 16 x int32 signed raw ADC in binary frame with CRC | [ ] | |
| Protection table | 24V miswire, short/open, ESD/EFT, reverse polarity have current/power/status notes | [ ] | |

Any unchecked item above blocks layout release unless formally waived by HW Lead, FW Lead, QA, and PM.

---

## 3. Power and Signal Integrity

| Item | Criteria | Status | Reviewer |
|------|----------|--------|----------|
| MCU decoupling | 100nF near every VDD/VDDA pin plus local bulk | [ ] | |
| ADS decoupling | AVDD/DVDD decoupling per device, quiet return | [ ] | |
| References | ADC/UI reference routing isolated from surge currents | [ ] | |
| SPI3 | PC10/PC11/PC12 to both ADS devices, CS/DRDY independent | [ ] | |
| UART2 | CM3<->MCU IOP route supports 921600 8N1 | [ ] | |
| Relay clearance | Contact creepage/clearance meets selected safety basis | [ ] | |
| +5V capacity | Final budget <=85% of selected converter continuous rating | [ ] | |
| +3.3V thermal | Switching regulator calculation and prototype Tj evidence meet closure plan | [ ] | |
| Input surge coordination | TVS/MOV clamp, regulator abs max, bridge/fuse stress and test level agree | [ ] | |
| Grounding | Ground domains/net-tie/shield/return-current overlay approved | [ ] | |

---

## 4. Universal Input Detailed Review

### 4.1 Per-Channel Architecture

| Item | Criteria | Status | Reviewer |
|------|----------|--------|----------|
| UI mode latch | 48 outputs available for 16 x 3 mode bits | [ ] | |
| Reset default | Latch reset/default state is safe disabled | [ ] | |
| Test access | DATA/CLK/LATCH/OE test pads or debug access | [ ] | |
| Mode metadata | Firmware can report channel mode and status | [ ] | |

### 4.2 0-10V

| Item | Criteria | Status | Reviewer |
|------|----------|--------|----------|
| Divider | 100k / 12.1k 0.1% 25ppm or approved matched network | [ ] | |
| Gain | 10V -> about 1.079V, scale gain 9.2645 | [ ] | |
| Buffer | RRIO buffer after RC filter | [ ] | |
| 24V fault | Component power and clamp current calculated | [ ] | |
| Error budget | No final accuracy claim without signed budget | [ ] | |

### 4.3 4-20mA

| Item | Criteria | Status | Reviewer |
|------|----------|--------|----------|
| Shunt | 49.9R 0.1% 25ppm, >=0.125W | [ ] | |
| Headroom | 24mA -> 1.1976V and supported as overrange | [ ] | |
| Fault protection | 24V miswire steady/pre-trip current calculated | [ ] | |
| Scale | `I_mA = Vadc / 49.9 * 1000` documented | [ ] | |

### 4.4 NTC

| Item | Criteria | Status | Reviewer |
|------|----------|--------|----------|
| Default | NTC 10k B3950 default | [ ] | |
| Other NTC | B-value/table configurable | [ ] | |
| Formula | `R_ntc = Rpullup * Vadc / (Vexc - Vadc)` or chosen equivalent | [ ] | |
| Reference | Vexc measured or ratiometric | [ ] | |

### 4.5 Dry Contact / DI

| Item | Criteria | Status | Reviewer |
|------|----------|--------|----------|
| Dry contact | Clean auxiliary dry contact only | [ ] | |
| Wet 24V | Not supported unless dedicated circuit added | [ ] | |
| Isolation | No isolation claim in UI docs/silkscreen/spec | [ ] | |
| True DI | Separate isolated DI sheet/module if product needs industrial DI | [ ] | |

---

## 5. Documentation Completeness

| Document | Required state | Status |
|----------|----------------|--------|
| `IO_UI_CIRCUIT.md` | Rev 2.2 or later | [ ] |
| `MCU_STM32G0_SPEC.md` | Per-channel mode latch pinmap | [ ] |
| `CB_BLOCK_DIAGRAM.md` | Corrected UI signal chain | [ ] |
| `CB_SCHEMATIC_NOTES.md` | Corrected UI checklist | [ ] |
| `IOP_PROTOCOL.md` | 16 x int32 raw ADC binary frame | [ ] |
| `FW-ADC-SAMPLING.md` | ADC/MCU/CM3/application rates distinguished | [ ] |
| `HW-TEST-UI-16CH.md` | Test cases for modes and faults | [ ] |
| `HW-RISK-UI-16CH.md` | Open risks reviewed | [ ] |
| `BOM-UI-16CH.md` | UI BOM, alternates, tolerances | [ ] |
| `GROUNDING_SCHEME.md` | Ground domains, return paths, shield and isolation rules | [ ] |
| `IO_RS485_CIRCUIT.md` | RS-485 schematic/BOM/layout/test requirements | [ ] |
| `HW_DOC_REVIEW_CLOSURE_PLAN.md` | P0 evidence links and issue dispositions current | [ ] |

### 5.1 RS-485 review

| Item | Pass criteria | Status | Reviewer |
|---|---|---|---|
| Role | Port is Modbus RTU master only; no MS/TP/slave label remains | [ ] | |
| Transceiver | Voltage, common-mode, unit-load, baud and direction-control behavior verified | [ ] | |
| Isolation | Digital isolator plus isolated power fitted together; barrier spacing/keepout passes | [ ] | |
| Bias | One controlled fail-safe bias network per segment; idle differential measured | [ ] | |
| Termination | 120R endpoint termination is selectable and default population documented | [ ] | |
| Protection | TVS/filter clamp and pulse rating coordinate with transceiver and EMC target | [ ] | |
| Ground/shield | COM and SHIELD follow `GROUNDING_SCHEME.md`; no accidental DGND/chassis bridge | [ ] | |
| Routing/test | Coupled A/B pair, short stubs, connector-side TVS, and test points reviewed | [ ] | |

---

## 6. Release Checklist

- [ ] All critical pass/fail items are closed.
- [ ] HW risk register release blockers are closed or signed waived.
- [ ] UI test plan is approved by QA.
- [ ] BOM values match schematic RefDes.
- [ ] FW Lead approves IOP frame and sampling sequence.
- [ ] PM approves Rev A public feature claims.
- [ ] Layout engineer confirms placement constraints are understood.
- [ ] All P0 evidence rows in `HW_DOC_REVIEW_CLOSURE_PLAN.md` are closed or formally waived.

---

## Revision History

| Rev | Date | Change |
|---|---|---|
| 1.2 | 2026-06-23 | UI Rev A schematic review checklist. |
| 1.3 | 2026-06-30 | Added power, grounding, RS-485, and closure-plan gates. |

**Document ID:** HW-REVIEW-01 | Rev 1.3 | 2026-06-30
