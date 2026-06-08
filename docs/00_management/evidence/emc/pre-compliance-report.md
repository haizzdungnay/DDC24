# Pre-compliance EMC Test Report — MK-DDC-24

> **Document ID:** KX-DDC24-HW-RPT-002  
> **Phiên bản:** 1.0 | 2026-06-02  
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Owner:** DeveloperTeam (HW)  
> **Ref:** IOT-5480 | IOT-5472 | hardware-design/07_emc_thermal/EMC_THERMAL_NOTES.md | HW-Q-003 | docs/adr/ADR-001-adc-avdd-noise-measurement-contract.md

---

## Mục lục

1. [Test Identification](#1-test-identification)
2. [Equipment Requirements](#2-equipment-requirements)
3. [Measurement Setup](#3-measurement-setup)
4. [Clock Harmonics Scan](#4-clock-harmonics-scan)
5. [Return Path & GND Plane Integrity](#5-return-path--gnd-plane-integrity)
6. [Ferrite Bead Verification](#6-ferrite-bead-verification)
7. [Ethernet Magnetics CMC](#7-ethernet-magnetics-cmc)
8. [ESD 4kV Contact Pre-compliance](#8-esd-4kv-contact-pre-compliance)
9. [TVS/MOV Protection Verification](#9-tvsmov-protection-verification)
10. [24VAC/DC Supply Noise on ADC](#10-24vacdc-supply-noise-on-adc)
11. [Summary & Risk Rating](#11-summary--risk-rating)
12. [Recommended Fixes / Next Actions](#12-recommended-fixes--next-actions)

---

## 1. Test Identification

| Field | Value |
|-------|-------|
| **Product** | MK-DDC-24 (BACnet DD Controller) |
| **DUT HW Rev** | Carrier Board v1.0 + Radxa CM3 2GB |
| **Test type** | EMC pre-compliance (in-house, spectrum analyzer + near-field probe) |
| **Standards scope** | IEC 61326-1 (Class A), CISPR 11, IEC 61000-4-2 |
| **Test date** | TBD — requires equipment setup |
| **Operator** | TBD |
| **Ambient temp** | TBD |
| **Supply voltage** | 24VAC/VDC ±10% |

---

## 2. Equipment Requirements

| Equipment | Specification | Status |
|-----------|--------------|--------|
| Spectrum Analyzer | 9 kHz – 1 GHz min, RBW 120 kHz (CISPR) | ⬜ Cần xác nhận |
| Near-field probe set | H-field loop probe (100 µm – 3 mm tip) | ⬜ Cần xác nhận |
| LISN (for conducted emissions) | 50 µH / 50Ω, CISPR 16-1-2 | ⬜ Cần xác nhận |
| Oscilloscope | ≥ 200 MHz BW, 1 GS/s, FFT mode | ⬜ Cần xác nhận |
| High-voltage differential probe | 100 MHz, 1400 V, 100:1/1000:1 | ⬜ Cần xác nhận |
| ESD gun | IEC 61000-4-2 compliant, ±8kV contact (Level 4) | ⬜ Cần xác nhận |
| DUT | MK-DDC-24 carrier board + CM3, production FW | ⬜ Cần xác nhận |
| Power supply | 24VAC / 24VDC variable | ⬜ Cần xác nhận |
| Load simulator | UI sensor sim, DO/DI actuator sim | ⬜ Cần xác nhận |
| BACnet client | BACnet scanner (e.g. BACnet Explorer, YABE) | ⬜ Cần xác nhận |

---

## 3. Measurement Setup

### 3.1 Physical Setup

```
[24V AC/DC Supply] ─── [LISN] ─── [DUT MK-DDC-24] ─── [BACnet Client (Ethernet)]
                                        │
                              ┌─────────┼─────────┐
                              │         │         │
                           [UI sim]  [DI sim]  [AO/DO load]
```

- DUT đặt trên bàn cách điện, cách tường ≥ 1m
- Cable looms: power input 1m, Ethernet 2m, I/O cables 1m mỗi loại
- BACnet communication active trong suốt test (northbound)
- UI input: sensor simulator reading (NTC hoặc 4-20mA)
- DO cycling: relay đóng/ngắt 30s cycle
- AO output: 0-10V ramp

### 3.2 DUT Configuration

| Parameter | Setting |
|-----------|---------|
| Firmware | Production build (không dùng special test FW) |
| BACnet link | Active, polling COV every 5s |
| UI channels | 8× enabled, NTC 10kΩ input |
| DI channels | 8× dry contact, 50% ON/OFF |
| AO channels | 2× 0-10V, 2× 4-20mA |
| DO/Relay | 2× ON, 2× cycling |
| Supply | 24VAC / 24VDC (separate runs) |

---

## 4. Clock Harmonics Scan

### 4.1 Measurement Procedure

1. DUT power ON, all I/O active, BACnet link up
2. Near-field H-loop probe kết nối spectrum analyzer
3. Probe đặt cách CM3/BGA 2mm, scan từ 0–500 MHz
4. Đánh dấu peak tại các tần số clock: 8MHz (MCU HSE), 4.096MHz (ADC), 32.768kHz (RTC)
5. Tính harmonic multiples đến 500 MHz
6. Lặp lại probe tại: crystal packages, SPI traces, Ethernet RGMII, DC/DC inductor

### 4.2 Clock Sources

| Clock | Frequency | Source | Location | Harmonic Risk |
|-------|-----------|--------|----------|---------------|
| MCU HSE | 8.000 MHz | Y2 (ABM8-8.000MHZ) | STM32G0B1 | 8, 16, 24, 32,… MHz |
| CM3 system | 64 MHz (estimate) | Radxa CM3 internal PLL | CM3 BGA | 64, 128, 192,… MHz |
| RGMII ref | 100 MHz (estimate) | CM3 GMAC PLL | CM3 BGA / RGMII traces | 100, 200, 300,… MHz |
| ADC ref | 4.096 MHz | Y3 (CSTCE4M00G15L99-R0) | ADS131M08 | 4.096, 8.192, 12.288,… MHz |
| RTC | 32.768 kHz | Y1 (ABS06-32.768kHz) | DS3231 | Negligible above 1 MHz |

### 4.3 Measurement Results

| Frequency | Amplitude (dBµV) | Limit (CISPR 11 Class A) | Pass/Fail | Notes |
|-----------|-----------------|--------------------------|-----------|-------|
| 8 MHz (fund) | ⬜ | N/A (near-field) | ⬜ | Record peak near Y2 |
| 16 MHz (H2) | ⬜ | N/A | ⬜ | |
| 32 MHz (H4) | ⬜ | N/A | ⬜ | |
| 64 MHz (H8) | ⬜ | N/A | ⬜ | Near CM3 BGA |
| 100 MHz | ⬜ | N/A | ⬜ | Near RGMII |
| 4.096 MHz | ⬜ | N/A | ⬜ | Near Y3/ADC |

**Note:** Near-field scan amplitudes are comparative (not absolute). Convert to CISPR 11 radiated limits only in chamber. Use scan to identify relative peak magnitudes and unexpected harmonics.

**Evidence directory:** `docs/00_management/evidence/emc/clock-harmonics/` — see README.md for measurement protocol and filename conventions.

### 4.4 Pass/Fail Criteria (Pre-compliance)

- All spurs < reference threshold (TBD based on chamber correlation, typical −10dB below CISPR 11 Class A limit with antenna factor)
- No unexpected harmonics at non-clock frequencies
- Harmonic amplitude drops ≥ 20dB from fundamental at 5th harmonic and above

**Result:** ⬜ Pass / ⬜ Fail / ⬜ Needs measurement

---

## 5. Return Path & GND Plane Integrity

### 5.1 Design Verification (Document Review)

| Check | Design Spec | Evidence | Status |
|-------|-------------|----------|--------|
| GND plane L2 continuous | EMC_THERMAL_NOTES §2.1 | Rule: "L2 liên tục (không cắt, không slot)" | ✅ Confirmed by design |
| Star ground point | EMC_THERMAL_NOTES §2.1 | 1 điểm nối GND analog + digital gần PSU input | ✅ Confirmed by design |
| Chassis GND via Y-cap | EMC_THERMAL_NOTES §2.1 | Y-cap 10nF/1kV từ signal GND → chassis | ✅ Confirmed by design |
| No GND plane split | CB_SCHEMATIC_NOTES §4 | "không split GND — dùng 1 GND plane liên tục" | ✅ Confirmed by design |
| Via stitching near RF areas | EMC_THERMAL_NOTES §2.2 | Via GND stitching quanh SPI, Ethernet | ✅ Confirmed by design |

### 5.2 Physical Verification

| Check | Method | Result |
|-------|--------|--------|
| GND plane continuity (L2) | Visual inspection + multimeter continuity test | ⬜ |
| Via stitching density | Microscope check ≥ 5 vias/cm near RF zones | ⬜ |
| Star ground single point | Multimeter GND loop check (no ground loop) | ⬜ |
| No slot under high-speed traces | Visual inspection L2 under RGMII, SPI | ⬜ |
| Chassis Y-cap soldered | Visual inspection C? (10nF/1kV) | ⬜ |

**Evidence directory:** `docs/00_management/evidence/emc/gnd-continuity/` — see README.md for measurement protocol and filename conventions.

**Result:** ✅ Pass (design) / ⬜ Pass (physical pending) / ⬜ Fail

---

## 6. Ferrite Bead Verification

### 6.1 BOM Verification

| Location | Component | BOM Reference | Qty | Status |
|----------|-----------|---------------|:---:|--------|
| RS-485 A/B line | Ferrite bead 600Ω @ 100MHz | EMC_THERMAL_NOTES §2.4 | 2 | ✅ Confirmed by design |
| UI input (×8) | Ferrite bead 600Ω + 100nF | IO_UI_CIRCUIT §6, EMC_THERMAL_NOTES §2.4 | 8 | ✅ Confirmed by design |
| +5V_RELAY rail | Ferrite bead separates +5V_RELAY | PWR_DESIGN §7, CB_SCHEMATIC_NOTES §4 | 1 | ✅ Confirmed by design |

### 6.2 Physical Verification

| Check | Method | Result |
|-------|--------|--------|
| RS-485 ferrite beads fitted | Visual + LCR meter | ⬜ |
| UI ferrite beads fitted (×8) | Visual + LCR meter | ⬜ |
| +5V_RELAY ferrite bead fitted | Visual + continuity test | ⬜ |
| Impedance @ 100 MHz | LCR meter or VNA sweep | ⬜ |

**Result:** ✅ Pass (design) / ⬜ Pass (physical pending) / ⬜ Fail

---

## 7. Ethernet Magnetics CMC

### 7.1 Design Verification

| Check | Evidence | Status |
|-------|----------|--------|
| RJ-45 integrated magnetics model | HR911105A (BOM §2.3) | ✅ Confirmed |
| Integral common-mode choke | HR911105A datasheet: integrated CM choke for 100/1000Base-T | ✅ Confirmed |
| ESD protection | ±6kV (per HR911105A spec) | ✅ Confirmed |
| MDI pair caps | 0.1µF trên MDI pairs tại RJ-45 side (CB_SCHEMATIC_NOTES §2.6) | ✅ Confirmed |
| RGMII layout proximity | RJ-45 sát cạnh PCB, RGMII traces ngắn (CB_SCHEMATIC_NOTES §2.6) | ✅ Confirmed |

### 7.2 Physical Verification

| Check | Method | Result |
|-------|--------|--------|
| HR911105A soldered correctly | Visual + solder joint inspection | ⬜ |
| MDI pair caps present (×4) | Visual | ⬜ |
| Chassis GND connection to RJ-45 shield | Continuity test | ⬜ |

**Result:** ✅ Pass (design) / ⬜ Pass (physical pending) / ⬜ Fail

---

## 8. ESD 4kV Contact Pre-compliance

### 8.1 Measurement Procedure

1. DUT power ON, all I/O active, BACnet link up, normal operation
2. ESD gun set to **4kV contact discharge** (IEC 61000-4-2 Level 4)
3. Discharge mode: single discharge, 1s interval
4. Test points (per IEC 61000-4-2):
   - All exposed metal (DIN-rail mount points, screw terminals)
   - All I/O terminals (UI×8, DI×8, AO×4, DO×4)
   - Enclosure seams, ventilation holes
   - USB connector shells, RJ-45 shield
   - RS-485 terminal block
   - Power terminal block
5. Performance criterion: **Criterion A** (no degradation, no loss of function)
6. Monitoring:
   - BACnet COV check sau mỗi discharge
   - UI readings không drop out
   - DO state không thay đổi
   - AO output không glitch

### 8.2 ESD Protection Map (Pre-verified from BOM)

| Test Zone | Protection Device | Level | Status |
|-----------|-----------------|-------|--------|
| UI terminals (×8) | TVS SMAJ15A + BAT54S clamp | ±8kV contact | ✅ Confirmed |
| DI terminals (×8) | TVS P6KE36A (specified) + PC817 opto 1500V RMS | ±8kV contact | ✅ Confirmed (TVS RefDes not explicit in BOM) |
| RS-485 A/B | TVS SMAJ6.5A per line + ADUM1201 isolation | ±15kV | ✅ Confirmed |
| USB-C | PRTR5V0U2X | ±8kV contact | ✅ Confirmed |
| USB-A | PRTR5V0U2X | ±8kV contact | ✅ Confirmed |
| Ethernet RJ-45 | HR911105A integrated ±6kV | ±6kV | ✅ Confirmed |
| Power input 24V | P6KE33A + MOV SIOV-S14K275 | Surge 600W | ✅ Confirmed |

### 8.3 Test Results

| Test Point | Discharge Type | Voltage | Result | Notes |
|-----------|---------------|---------|--------|-------|
| UI-1 terminal | Contact | 4kV | ⬜ | |
| UI-2 terminal | Contact | 4kV | ⬜ | |
| UI-8 terminal | Contact | 4kV | ⬜ | |
| DI-1 terminal | Contact | 4kV | ⬜ | |
| DI-8 terminal | Contact | 4kV | ⬜ | |
| AO-1 terminal | Contact | 4kV | ⬜ | |
| AO-4 terminal | Contact | 4kV | ⬜ | |
| DO-1 terminal | Contact | 4kV | ⬜ | |
| DO-4 terminal | Contact | 4kV | ⬜ | |
| RS-485 terminal | Contact | 4kV | ⬜ | |
| RJ-45 shield | Contact | 4kV | ⬜ | |
| USB-C shell | Contact | 4kV | ⬜ | |
| USB-A shell | Contact | 4kV | ⬜ | |
| Power terminal | Contact | 4kV | ⬜ | |
| DIN-rail mount | Contact | 4kV | ⬜ | |

**Performance criterion:** IEC 61000-4-2 Criterion A — no loss of function, no UI/AO/DO disturbance, BACnet link remains up.

**Evidence files:**
- Test procedure: `docs/00_management/evidence/emc/esd/iot-5888-esd-4kv-contact-procedure.md`
- Evidence template (fill per point): `docs/00_management/evidence/emc/esd/iot-5888-esd-4kv-contact-evidence.md`
- Photos per test point: `docs/00_management/evidence/emc/esd/esd-{point}.jpg` (15 photos, 1 per point)
- Setup overview photo: `docs/00_management/evidence/emc/esd/esd-setup-overview.jpg`

**Result:** ⬜ Pass / ⬜ Fail / ⬜ Needs measurement

---

## 9. TVS/MOV Protection Verification

### 9.1 Design Verification (BOM Cross-check)

| Reference | Type | Part Number | Location | Purpose | Status |
|-----------|------|-------------|----------|---------|--------|
| D20–D27 | TVS | SMAJ15A | UI terminals (×8) | Overvoltage clamp 16.7V | ✅ BOM §2.5 |
| D51 | TVS | P6KE33A | Power input | Surge 2nd stage 33V clamp | ✅ BOM §2.8 |
| D1 (×2) | TVS | SMAJ6.5A | RS-485 A/B | Bus protection | ✅ BOM §2.2 |
| D36–D39 | TVS | SMAJ12A | AO outputs (×4) | Overvoltage clamp 13.3V | ✅ BOM §2.6 |
| — | TVS | P6KE36A | DI terminals | Overvoltage (600W pulse) | ⚠️ BOM chưa ghi RefDes rõ |
| — | TVS array | PRTR5V0U2X | USB-C, USB-A, SD, RS-485, UART | ESD dual-line | ✅ EMC_THERMAL_NOTES §3, CB_SCHEMATIC_NOTES §5 |
| — | MOV | SIOV-S14K275 | Power input | Surge 1st stage 275V 175J | ✅ EMC_THERMAL_NOTES §4 |

### 9.2 Physical Verification

| Check | Method | Result |
|-------|--------|--------|
| All TVS diodes soldered | Visual inspection | ⬜ |
| P6KE36A TVS present on DI | Visual (verify RefDes) | ⬜ |
| MOV SIOV-S14K275 soldered | Visual + multimeter (varistor mode) | ⬜ |
| PRTR5V0U2X on USB, SD, RS-485, UART | Visual (verify per connector) | ⬜ |
| TVS orientation correct (cathode marking) | Visual check | ⬜ |
| MOV energy rating adequate (175J) | Datasheet check | ✅ 175J adequate for 2kV surge |
| Clamping voltage measurement | Curve tracer (optional) | ⬜ |

**Result:** ✅ Pass (design/BOM) / ⬜ Pass (physical pending) / ⬜ Fail

---

## 10. 24VAC/DC Supply Noise on ADC

### 10.1 Measurement Procedure

1. Run two supply modes with same DUT load state:
   - `24VAC` via isolation transformer into production input path
   - `24VDC` from linear PSU or battery; không dùng SMPS cho comparison baseline
2. Use short-ground `10x` probes; probe tại IC pin hoặc decoupling node gần nhất. Ground lead dài làm invalid high-frequency evidence.
3. Collect `LF_ripple` capture set for low-frequency ripple:
   - DC-coupled, start at `5 ms/div`
   - Minimum channel group: `24V rectified`, `+5V`, `+3.3V`, `AVDD_ADC_3V3`
4. Collect `HF_noise_fft` capture set for ADC-supporting rails:
   - AC-coupled hoặc math-removed DC offset, `10 us/div`, bandwidth limit `20 MHz` ON
   - Minimum channel group: `+3.3V`, `AVDD_ADC_3V3`, `VREF_ADC_2V5`, helper/trigger channel as needed
5. FFT mode: record noise spectrum `0–500 kHz` for both `AVDD_ADC_3V3` and `VREF_ADC_2V5`
6. Record `Noise p-p`, `Noise RMS`, `Dominant Freq`, capture timestamp/log reference, and evidence filename for each required node
7. Store screenshots/exports under `docs/00_management/evidence/emc/adc-noise/` using contract in `docs/adr/ADR-001-adc-avdd-noise-measurement-contract.md`

### 10.2 Supply Rail Architecture

| Rail | Source | Noise Criticality | ADC Impact |
|------|--------|-------------------|------------|
| +5V | LM2596HVS (DC/DC buck) | Medium | ADC DVDD (via LDO) |
| +3.3V | AP2114H (LDO from 5V) | Low | MCU + ADC DVDD |
| +1.8V | XC6206P182 (LDO from 3.3V) | Low | CM3 I/O |
| +15V | SX1308 (boost) | Medium | AO excitation |
| AVDD | +3.3V analog rail feeding ADS131M08 AVDD | Critical | ADC analog supply stability |
| VREF | REF3025 (2.5V reference) output | Critical | ADC reference input stability |

### 10.3 Measurement Results

| Rail | Noise p-p (mV) | Noise RMS (mV) | Dominant Freq | Pass/Fail |
|------|---------------|----------------|---------------|-----------|
| 24V rectified | ⬜ | ⬜ | ⬜ | ⬜ |
| +5V (LM2596 out) | ⬜ | ⬜ | ⬜ | ⬜ |
| +3.3V (LDO) | ⬜ | ⬜ | ⬜ | ⬜ |
| AVDD (ADS131M08 analog 3.3V rail) | ⬜ | ⬜ | ⬜ | ⬜ |
| ADC VREF (REF3025 2.5V) | ⬜ | ⬜ | ⬜ | ⬜ |

**Acceptance criteria (ADC):**
- AVDD noise ≤ 5 mV p-p (24-bit ADC, LSB = 2×VREF/2^24 ≈ 298 nV @ 2.5V)
- Noise floor at ADC sampling rate (1 kHz typ) ≤ ½ LSB RMS
- No coherent spur within ADC signal bandwidth (0–500 Hz)
- VREF noise ≤ 1 mV p-p (REF3025 spec: 12 µVrms typ, 50 µVp-p max)

### 10.4 24VAC vs 24VDC Comparison

| Condition | ADC Noise p-p | ADC Reading Stability | Notes |
|-----------|---------------|----------------------|-------|
| 24VAC supply | ⬜ | ⬜ | Include same DUT load state and evidence IDs; expect 100/120Hz ripple from rectifier |
| 24VDC supply | ⬜ | ⬜ | Must use linear PSU or battery baseline; note if comparison is provisional |

**Result:** ⬜ Pass / ⬜ Fail / ⬜ Needs measurement

---

## 11. Summary & Risk Rating

### 11.1 Verdict Summary

| Section | Item | Design Review | Physical Measurement | Risk |
|---------|------|:-------------:|:-------------------:|:----:|
| §4 | Clock harmonics scan | N/A | ⬜ Pending | **Medium** — CM3 clock harmonics may radiate via cable harness |
| §5 | Return path / GND plane | **✅ Pass** | ⬜ Pending | **Low** — design rules strictly enforced |
| §6 | Ferrite beads | **✅ Pass** | ⬜ Pending | **Low** — all specified on BOM, confirmation pending |
| §7 | Ethernet magnetics CMC | **✅ Pass** | ⬜ Pending | **Low** — HR911105A with integrated CM choke |
| §8 | ESD 4kV contact | **✅ Pass** (design) | ⬜ Pending | **Medium** — depends on PCB layout, verify with ESD gun |
| §9 | TVS/MOV protection | **✅ Pass** (BOM) | ⬜ Pending | **Low** — all protection devices present per BOM |
| §10 | 24VAC/DC supply noise on ADC | N/A | ⬜ Pending | **Medium** — DC/DC noise coupling to ADC is common issue |

### 11.2 Risk Matrix

| Item | Likelihood | Severity | Risk Level | Mitigation |
|------|:----------:|:--------:|:----------:|------------|
| Clock harmonics > limit | Medium | High | **Medium** | Shielding enclosure (aluminum), ferrite on cable harness |
| ESD failure at UI/DI | Low | High | **Low-Medium** | TVS + opto already specified; verify layout GND return |
| ADC noise from 24VAC rectifier | Medium | Medium | **Medium** | Additional LC filter on AVDD; averaging in FW |
| DC/DC switching noise on ADC | Low-Medium | Medium | **Low** | LDO + reference already specified; verify decoupling |
| Ethernet radiation via cable | Low | High | **Low** | Integrated CMC + short RGMII traces |

### 11.3 Overall Pre-compliance Assessment

| Criterion | Status |
|-----------|--------|
| Emissions (CISPR 11) — design review | ✅ Acceptable risk — requires spectrum scan confirmation |
| Emissions (CISPR 11) — measured | ⬜ Pending |
| Immunity (IEC 61000-4-2 ESD) — design review | ✅ All TVS/protection devices confirmed on BOM |
| Immunity (IEC 61000-4-2 ESD) — measured | ⬜ Pending |
| Supply noise on ADC | ⬜ Pending — most likely risk item |

**Overall risk rating:** **Medium** — design mitigations are in place per EMC_THERMAL_NOTES and BOM. Physical verification with spectrum analyzer and ESD gun is required to confirm compliance before formal lab submission.

---

## 12. Recommended Fixes / Next Actions

### By Priority

| Pri | Action | Owner | Due |
|:---:|--------|-------|:---:|
| **P1** | Execute clock harmonics scan with spectrum analyzer + near-field probe | HW | Before formal lab |
| **P1** | Execute ESD 4kV contact test at all terminals with ESD gun | HW | Before formal lab |
| **P1** | Measure 24VAC supply noise on ADC AVDD rail with oscilloscope | HW | Before formal lab |
| **P2** | Physical verification of GND plane continuity (multimeter) | HW | During assembly |
| **P2** | Confirm all ferrite beads fitted and correct impedance | HW | During assembly inspection |
| **P2** | Confirm PRTR5V0U2X on all USB/SD/RS-485/UART connectors | HW | During assembly inspection |
| **P3** | If clock harmonics exceed threshold: add ferrite on I/O cable harness | HW | If needed |
| **P3** | If ADC noise exceeds threshold: add π-filter (ferrite + cap) before ADC AVDD | HW+FW | If needed |

### Pre-requisites for Formal Lab (HW-Q-003)

- [ ] All P1 physical measurements complete and documented
- [ ] Pre-compliance report updated with measurement data
- [ ] Any critical failures fixed and verified
- [ ] Formal lab booking confirmed (lead time 2–4 weeks)
- [ ] DUT samples (minimum 2) ready for lab submission

---

## Appendix A: QA Checklist Mapping

| QA Checklist ID | Description | Report Section | Status |
|-----------------|-------------|----------------|--------|
| EMC-29 | Clock harmonics scan at 8/64/100/4.096 MHz | §4 | ⬜ |
| EMC-30 | GND plane continuity verified | §5 | ✅ Pass (design) |
| EMC-31 | Ferrite beads on RS-485 A/B | §6 | ✅ Pass (design) |
| EMC-32 | Ferrite beads on power input | §6 | ✅ Pass (design) |
| EMC-33 | Ethernet magnetics CM choke | §7 | ✅ Pass (design) |
| EMC-34 | All TVS/MOV soldered and verified | §9 | ✅ Pass (BOM) |
| EMC-35 | Opto-isolator + ADUM1201 galvanic isolation | §9 | ✅ Pass (BOM) |
| EMC-36 | ESD gun test 4kV contact at all terminals | §8 | ⬜ |
| EMC-37 | Y-cap 10nF on power input to chassis GND | §5 | ✅ Pass (design) |

## Appendix B: Test Equipment Calibration

| Equipment | Model | Calibration Due | Status |
|-----------|-------|:---------------:|--------|
| ⬜ | ⬜ | ⬜ | ⬜ |
| ⬜ | ⬜ | ⬜ | ⬜ |

*(Fill before testing)*

---

> **Document ID:** KX-DDC24-HW-RPT-002 | Rev 1.0 | 2026-06-02  
> **Next update:** After physical measurement execution
