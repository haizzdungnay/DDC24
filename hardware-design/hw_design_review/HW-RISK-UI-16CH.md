# Risk Register - Universal Input 16CH Rev A

> **Document:** HW-RISK-UI-16CH | Rev 1.1 | 2026-06-30
> **Scope:** Hardware/Firmware/QA risks for 16-channel Universal Input before schematic/layout release

---

## 1. Risk Summary

| ID | Risk | Severity | Likelihood | Mitigation | Owner | Status |
|----|------|:--------:|:----------:|------------|-------|--------|
| UI-R001 | Field signal routed directly to TMUX/ADC | High | Medium | Mandatory block order and schematic checklist; ERC/net naming review | HW Lead | Open |
| UI-R002 | TMUX1208 misused as high-voltage field mux | High | Medium | TMUX only after low-voltage conditioning; datasheet limit cited in HW-DES-03-UI | HW Lead | Open |
| UI-R003 | Shared SEL prevents mixed-mode channels | High | High | Adopt per-channel mode latch Option A | HW/FW | Mitigated by design |
| UI-R004 | 62R shunt lacks 24mA headroom | High | High | Use 49.9R 0.1% 25ppm, calculate 24mA = 1.1976V | HW | Mitigated by design |
| UI-R005 | 24V miswire burns shunt/protection | High | Medium | PTC/fusible + TVS/clamp power calculation and test | HW/QA | Open |
| UI-R006 | 0-10V divider loading/ADC input bias causes accuracy error | Medium | Medium | Add RRIO buffer; final error budget before accuracy claim | HW | Open |
| UI-R007 | NTC reference unstable if using CM3 PMIC 3.3V | Medium | Medium | Use precision/measured/ratiometric Vexc | HW/FW | Open |
| UI-R008 | PT100/PT1000 claim inaccurate through 2-wire mux path | High | High | Remove RTD from Rev A UI; dedicated Rev B module if needed | PM/HW | Mitigated by scope |
| UI-R009 | Dry contact incorrectly sold as industrial DI | High | Medium | Wording changed to auxiliary only; separate isolated DI SKU/module required | PM/HW | Open |
| UI-R010 | UART frame too large or ambiguous after 16 x int32 | Medium | Medium | ADR-010 fixes a 74-byte IO_RESP with CRC/sequence; verify sustained 2ms/500Hz GET_IO cadence and timeout behavior | FW | Open |
| UI-R011 | ADS signed raw parsed as unsigned | High | Medium | Sign-extension tests and parser vectors | FW/QA | Open |
| UI-R012 | ADC/DRDY timeout indistinguishable from stale UART | Medium | Medium | Separate status bits and counters | FW | Open |
| UI-R013 | Protection leakage affects measurement | Medium | Medium | Include TVS/clamp leakage in error budget | HW | Open |
| UI-R014 | Mode latch reset state selects unsafe mode | High | Low | Pull/default safe disabled; test reset/boot transitions | HW/FW/QA | Open |
| UI-R015 | BOM alternates break leakage/drift assumptions | Medium | Medium | Alternate-part review for tolerance, leakage, drift, voltage, package | Supply/HW | Open |

---

## 2. Release Blockers

The design must not proceed to PCB layout until these are closed or formally accepted:

- UI-R001 field-to-mux/ADC routing risk.
- UI-R003 per-channel mode-select implementation.
- UI-R005 24V miswire current/power calculations.
- UI-R008 RTD removed from Rev A claims.
- UI-R009 dry contact claim corrected.
- UI-R010/UI-R011 IOP raw ADC frame signed int32 contract accepted by FW/SW.

---

## 3. Required Evidence

| Evidence | Source |
|----------|--------|
| Schematic screenshot/netlist showing terminal -> protection -> front-end -> low-voltage mux/buffer -> ADC | KiCad/ERC review |
| 4-20mA shunt calculation and power table | HW-DES-03-UI + schematic calc sheet |
| 0-10V error budget | HW design review |
| NTC Vexc compensation method | HW/FW review |
| Mode latch reset-state test | QA test report |
| Signed int32 parser tests | FW/CM3 unit tests |
| Miswire and short/open test report | HW-TEST-UI-16CH |

---

## 4. Sign-Off

| Role | Required decision |
|------|-------------------|
| PM | Accept Rev A scope: no RTD UI, dry contact auxiliary only |
| HW Lead | Approve front-end/protection/error budget before layout |
| FW Lead | Approve mode latch, sampling, and IOP frame contract |
| QA Lead | Approve test plan and risk closure evidence |

---

## Revision History

| Rev | Date | Change |
|---|---|---|
| 1.0 | 2026-06-23 | Initial Rev A UI risk register. |
| 1.1 | 2026-06-30 | Aligned UI-R010 verification cadence with ADR-010 at 2ms/500Hz. |

**Document ID:** HW-RISK-UI-16CH | Rev 1.1 | 2026-06-30
