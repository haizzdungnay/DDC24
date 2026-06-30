# HW Test Plan - Universal Input 16CH Rev A

> **Document:** HW-TEST-UI-16CH | Rev 1.1 | 2026-06-30
> **Scope:** 16-channel Universal Input hardware/firmware validation before PCB release and during prototype bring-up
> **Related:** HW-DES-03-UI Rev 2.2, FW-ADC-SAMPLING, IOP_PROTOCOL, HW-RISK-UI-16CH

---

## 1. Test Objectives

- Verify every UI channel supports the approved Rev A modes: 0-10V, 4-20mA, NTC, auxiliary dry contact.
- Verify PT100/PT1000 are not claimed/tested as Rev A UI modes.
- Verify TMUX/analog switches see only low-voltage conditioned signals.
- Verify 24V miswire, short, open, ESD/EFT basic checks, and firmware fault reporting.
- Verify raw ADC data is signed int32 in binary IOP frames with CRC.

---

## 2. Equipment

| Equipment | Requirement |
|-----------|-------------|
| Precision voltage calibrator | 0V, 2.5V, 5V, 10V points |
| Current loop calibrator | 4mA, 12mA, 20mA, 22mA, 24mA |
| Precision resistor decade box | NTC simulation, dry contact/open/short tests; calibrated accuracy <=+/-0.1%, temperature coefficient <=25ppm/C, actual value and ambient recorded |
| 24VDC supply with current limit | Miswire tests |
| Oscilloscope | ADC SPI/DRDY timing, protection response where safe |
| Logic analyzer | IOP frame, CRC, sequence, SPI capture |
| DMM | Field and low-voltage node verification |
| Thermal camera or probe | Shunt/protection power checks |

---

## 3. Pre-Test Checks

- [ ] Schematic shows terminal -> protection -> front-end -> low-voltage mux/buffer -> ADC.
- [ ] Rshunt populated as 49.9R 0.1% 25ppm on all current input channels.
- [ ] Mode latch outputs are visible and default safe.
- [ ] PT100/PT1000 mode is absent/DNI.
- [ ] Dry contact labels say auxiliary only.
- [ ] IOP frame parser can decode 16 x int32 raw values.

---

## 4. 0-10V Tests

Run on every UI channel unless first article triage defines a reduced sample plan. Full 16-channel test is required before release.

| Test | Stimulus | Expected result |
|------|----------|-----------------|
| V-00 | 0.000V | After zero calibration: `abs(raw_zero) <= 8,389` counts (0.1% of signed 24-bit FS) and scaled absolute error <=10mV; channel valid |
| V-25 | 2.500V | Scaled value within provisional error budget |
| V-50 | 5.000V | Scaled value within provisional error budget |
| V-100 | 10.000V | ADC node about 1.079V before calibration |
| V-OV24 | 24VDC miswire, current-limited | Protection survives; no field voltage reaches mux/ADC; firmware overrange/fault |
| V-OPEN | Input open | Defined bias/open status or explicit not-supported status |
| V-NOISE | Inject representative noise | Filter/status behavior documented |

Do not record a final accuracy claim until the signed error budget is complete.

---

## 5. 4-20mA Tests

| Test | Stimulus | Expected shunt voltage | Expected behavior |
|------|----------|-----------------------:|------------------|
| I-04 | 4.000mA | 0.1996V | Valid low-range reading |
| I-12 | 12.000mA | 0.5988V | Valid mid-range reading |
| I-20 | 20.000mA | 0.9980V | Valid full-scale reading |
| I-22 | 22.000mA | 1.0978V | Warning/overrange threshold as configured |
| I-24 | 24.000mA | 1.1976V | Overrange supported without ADC headroom violation |
| I-MIS24 | 24VDC miswire | N/A | Protection current/power stays within calculated limits; firmware fault |
| I-OPEN | Loop open | N/A | Open-loop status or low-current fault |

Record shunt temperature rise during 20mA and 24mA runs.

---

## 6. NTC Tests

Use calibrated <=+/-0.1%, <=25ppm/C precision resistors/decade box to simulate NTC. Record instrument ID, calibration due date, actual resistance, tolerance, lead compensation, and ambient temperature for every point.

| Test | Simulated resistance | Expected behavior |
|------|---------------------:|------------------|
| NTC-10K | 10.000k | Temperature near 25C for B3950 default |
| NTC-HOT | Value matching high-temperature point | Scaled temperature monotonic and plausible |
| NTC-COLD | Value matching low-temperature point | Scaled temperature monotonic and plausible |
| NTC-SHORT-GND | Short to GND | `UIx_SHORT` |
| NTC-SHORT-24 | 24VDC miswire, current-limited | Protection survives; fault status |
| NTC-OPEN | Open sensor | `UIx_OPEN` or explicit open state |
| NTC-VREF | Change/measured Vexc | Firmware compensation uses measured/ratiometric reference |

---

## 7. Auxiliary Dry Contact Tests

| Test | Stimulus | Expected behavior |
|------|----------|------------------|
| DC-OPEN | Contact open | Open state after debounce |
| DC-CLOSED | Contact short to return | Closed state after debounce |
| DC-DEBOUNCE | Bounce injection | No chatter beyond configured debounce |
| DC-DEADBAND | Force 0.8-2.0V equivalent | Invalid/deadband status |
| DC-LONG-WIRE | Representative long cable/noise | No false claim; behavior recorded |
| DC-WET24 | 24V wet-contact attempt | Must be rejected unless dedicated compatible circuit exists |

Pass criteria include correct documentation wording: auxiliary clean dry contact only, no isolated DI replacement claim.

---

## 8. ADC / IOP Protocol Tests

| Test | Method | Expected result |
|------|--------|-----------------|
| ADC-SIGN | Inject/force boundary samples | `0x7FFFFF`, `0x800000`, `0xFFFFFF` sign-extend correctly |
| ADC-16CH | Capture frame | 16 x int32 raw values UI1..UI16 present |
| ADC-STATUS | Force ADS status bit | `adc_status_1/2` preserved in frame |
| DRDY1-TO | Hold/mask DRDY1 | DRDY1 timeout bit/counter set |
| DRDY2-TO | Hold/mask DRDY2 | DRDY2 timeout bit/counter set |
| UART-CRC | Corrupt frame byte | CM3 drops frame, increments CRC fail counter |
| UART-SEQ | Drop frame | Sequence gap detected |
| UART-NOJSON | Inspect payload | Binary only; no JSON, no float |

---

## 9. Calibration Tests

| Mode | Required calibration points |
|------|-----------------------------|
| 0-10V | 0V and 10V minimum; 2.5V/5V as verification points |
| 4-20mA | 4mA and 20mA minimum; 12mA/22mA/24mA as verification points |
| NTC | Reference resistor points around expected operating range |
| Dry contact | Threshold and debounce verification |

Calibration data must be stored with channel ID, mode, date, firmware version, and operator/test station ID.

---

## 10. Acceptance Criteria

- [ ] All 16 channels pass 0-10V checks.
- [ ] All 16 channels pass 4-20mA checks with 49.9R shunt and 24mA overrange.
- [ ] NTC formula and Vexc compensation are verified.
- [ ] Dry contact is auxiliary only and debounce works.
- [ ] 24V miswire tests do not damage front-end/mux/ADC under controlled current-limited procedure.
- [ ] Signed int32 ADC frame, CRC fail, sequence gap, ADC timeout, and DRDY timeout tests pass.
- [ ] Error budget and calibration report are attached before any production accuracy claim.
- [ ] V-00 numeric threshold and NTC resistor accuracy records pass on every tested channel.

---

## Revision History

| Rev | Date | Change |
|---|---|---|
| 1.0 | 2026-06-23 | Initial UI 16-channel test plan. |
| 1.1 | 2026-06-30 | Added objective zero threshold and calibrated NTC resistance requirements. |

**Document ID:** HW-TEST-UI-16CH | Rev 1.1 | 2026-06-30
