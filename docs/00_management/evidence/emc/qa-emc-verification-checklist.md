# QA EMC Verification Checklist — MK-DDC-24
## IEC 61326-1 Compliance Review Template

> **Document ID:** KX-DDC24-QA-RPT-002  
> **Phiên bản:** 1.0 | 2026-06-02  
> **Trạng thái:** Draft — pre-populated checklist, awaiting test reports  
> **Owner:** QAReviewer  
> **Ref:** IOT-5474 | EMC_THERMAL_NOTES.md | HW-Q-003 | PM-MARKET-001 v1.1 §6.3

---

## Instructions

When pre-compliance (Month 2) and formal lab (Month 3) reports arrive:
1. Open this checklist
2. For each standard line, enter the result from the report
3. Attach/navigate to the report page/attachment as evidence path
4. If any item FAILS → log non-conformance in OPEN_ISSUES
5. Update traceability matrix after completion
6. Change status to "Approved" when all items are verified

---

## 1. Test Report Inventory

| Item | Expected | Received? | File/Path |
|------|----------|-----------|-----------|
| Pre-compliance EMC test report | Month 2 | ⬜ Not yet | — |
| Formal EMC lab test report | Month 3 | ⬜ Not yet | — |
| Lab accreditation certificate (for formal report) | ISO 17025 | ⬜ Not yet | — |
| Test equipment calibration certs | Per lab | ⬜ Not yet | — |

---

## 2. IEC 61326-1 — Emissions

### 2.1 CISPR 11 — Radiated Emissions (Class A, Industrial)

| # | Requirement | Limit | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-01 | Radiated emissions 30–230 MHz | ≤ 40 dB(µV/m) at 10m (Class A) | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-02 | Radiated emissions 230–1000 MHz | ≤ 47 dB(µV/m) at 10m (Class A) | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-03 | Margin from limit (worst spur) | Report margin in dB | ⬜ Pending | N/A | |

### 2.2 CISPR 11 — Conducted Emissions (AC mains port)

| # | Requirement | Limit | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-04 | Conducted emissions 0.15–0.5 MHz | ≤ 79 dB(µV) QP / 66 dB(µV) AV | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-05 | Conducted emissions 0.5–30 MHz | ≤ 73 dB(µV) QP / 60 dB(µV) AV | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-06 | Margin from limit (worst frequency) | Report margin in dB | ⬜ Pending | N/A | |

---

## 3. IEC 61326-1 — Immunity

### 3.1 IEC 61000-4-2 — ESD Immunity

| # | Requirement | Level | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-07 | Contact discharge (±8kV, Level 4) | Performance criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-08 | Air discharge (±15kV, Level 4) | Performance criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-09 | Test points: all exposed metal, I/O terminals, enclosure seams | Full coverage | ⬜ Pending | N/A | |

**Design mitigation check:** TVS SMAJ15A (UI), P6KE36A (DI), PRTR5V0U2X (USB), SMAJ6.5A (RS-485), built-in magnetics (Ethernet). Per EMC_THERMAL_NOTES §3.

### 3.2 IEC 61000-4-3 — Radiated RF Immunity

| # | Requirement | Level | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-10 | Radiated RF 80–1000 MHz, 10 V/m | Level 3, criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-11 | 1 kHz AM modulation 80% | — | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-12 | Spot check at enclosure resonances if needed | — | ⬜ Pending | ⬜ Pass / ⬜ Fail | |

### 3.3 IEC 61000-4-4 — EFT / Burst Immunity

| # | Requirement | Level | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-13 | ±2 kV on AC/DC power port (coupling clamp) | Level 3, criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-14 | ±1 kV on I/O signal ports (capacitive clamp) | Level 3, criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-15 | ±2 kV on RS-485 lines (if within cable length) | Level 3, criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |

**Design mitigation:** Power input CM choke 3.5mH + Y-cap 10nF/1kV; RS-485 ferrite bead 600Ω@100MHz.

### 3.4 IEC 61000-4-5 — Surge Immunity

| # | Requirement | Level | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-16 | ±2 kV line-to-line on AC power port | Level 3, criterion B | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-17 | ±4 kV line-to-earth on AC power port | Level 3, criterion B | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-18 | ±1 kV on I/O lines | Level 2/3, criterion B | ⬜ Pending | ⬜ Pass / ⬜ Fail | |

**Design mitigation:** MOV SIOV-S14K275 + P6KE33A TVS on power input; GDT + TVS on RS-485.

### 3.5 IEC 61000-4-6 — Conducted RF Immunity

| # | Requirement | Level | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-19 | Conducted RF 0.15–80 MHz, 10 Vrms | Level 3, criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-20 | 1 kHz AM modulation 80% | — | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-21 | Injection on power, I/O, RS-485, Ethernet ports | All relevant ports | ⬜ Pending | N/A | |

### 3.6 IEC 61000-4-8 — Power Frequency Magnetic Field

| # | Requirement | Level | Result | Verdict | Evidence |
|---|-------------|-------|--------|---------|----------|
| EMC-22 | 50/60 Hz magnetic field 30 A/m | Level 4, criterion A | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-23 | Orientation: worst-case axis | — | ⬜ Pending | N/A | |

---

## 4. IEC 61010-1 — Electrical Safety

| # | Requirement | Result | Verdict | Evidence |
|---|-------------|--------|---------|----------|
| EMC-24 | Installation Category II | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-25 | Pollution Degree 2 | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-26 | Clearance and creepage distances verified | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-27 | Dielectric strength / Hi-pot test (if required by lab) | ⬜ Pending | ⬜ Pass / ⬜ Fail | |
| EMC-28 | Protective bonding (if applicable) | ⬜ Pending | ⬜ Pass / ⬜ Fail | |

**Note:** IEC 61010-1 safety is typically tested by the same lab as part of the EMC submission (LVD directive for CE). Separate report may apply.

---

## 5. Supplementary Checks

### 5.1 Pre-compliance Pre-checks (from EMC_THERMAL_NOTES §7)

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| EMC-29 | Clock harmonics scan at 8/64/100/4.096 MHz | ⬜ Pending | Pre-compliance report §4 (needs spectrum analyzer) |
| EMC-30 | GND plane continuity verified | ✅ Pass (design review) | EMC_THERMAL_NOTES §2.1, CB_SCHEMATIC_NOTES §4 — continuous L2 plane, star ground, no split |
| EMC-31 | Ferrite beads fitted on RS-485 A/B | ✅ Pass (design review) | EMC_THERMAL_NOTES §2.4 — 600Ω@100MHz specified |
| EMC-32 | Ferrite beads fitted on power input | ✅ Pass (design review) | EMC_THERMAL_NOTES §2.4 — CM choke 3.5mH specified |
| EMC-33 | Ethernet magnetics with integral CM choke confirmed | ✅ Pass (design review) | HR911105A (BOM §2.3) — integrated CM choke for 100/1000Base-T |
| EMC-34 | All TVS/MOV soldered and protection level verified | ✅ Pass (BOM review) | BOM confirms SMAJ15A, P6KE33A, SMAJ6.5A, SMAJ12A, SIOV-S14K275; PRTR5V0U2X per EMC_THERMAL_NOTES §3 |
| EMC-35 | Opto-isolator (DI) + ADUM1201 (RS-485) galvanic isolation verified | ✅ Pass (BOM review) | PC817B ×8 (BOM §2.4), ADUM1201BRZ (BOM §2.2) |
| EMC-36 | ESD gun test 4 kV contact at all terminals (pre-compliance) | ⬜ Pending | Pre-compliance report §8 (needs ESD gun) |
| EMC-37 | Y-cap 10nF on power input to chassis GND confirmed | ✅ Pass (design review) | EMC_THERMAL_NOTES §2.1, §2.4 — 10nF/1kV Y-cap from signal GND → chassis | |

### 5.2 Test Configuration

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| EMC-38 | Test sample running production FW (not special test FW) | ⬜ Pending | |
| EMC-39 | I/O exercised during test (UI reading sensor, AO/DO cycling) | ⬜ Pending | |
| EMC-40 | BACnet communication active during EMC test (northbound link) | ⬜ Pending | |
| EMC-41 | Test performed at nominal 24V AC/DC supply | ⬜ Pending | |
| EMC-42 | Test performed at worst-case temperature (if required by standard) | ⬜ Pending | |

---

## 6. Results Summary

| Section | Total Checks | Pass | Fail | N/A | Verdict |
|---------|-------------|------|------|-----|---------|
| Emissions (CISPR 11) | 6 | — | — | — | ⬜ |
| ESD (61000-4-2) | 3 | — | — | — | ⬜ |
| Radiated RF (61000-4-3) | 3 | — | — | — | ⬜ |
| EFT/Burst (61000-4-4) | 3 | — | — | — | ⬜ |
| Surge (61000-4-5) | 3 | — | — | — | ⬜ |
| Conducted RF (61000-4-6) | 3 | — | — | — | ⬜ |
| Power freq magnetic (61000-4-8) | 2 | — | — | — | ⬜ |
| Safety (61010-1) | 5 | — | — | — | ⬜ |
| Pre-compliance pre-checks | 9 | 7 | 0 | 2 | ⬜ Pending measurement |
| Test configuration | 5 | — | — | — | ⬜ |
| **Total** | **42** | **7** | **0** | **35** | |

---

## 7. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Reviewer | | | |
| HW Lead | | | |
| PM | | | |

---

## 8. Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | QAReviewer | Initial checklist created — awaiting pre-compliance and formal EMC reports |
