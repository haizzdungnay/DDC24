# ADC AVDD/VREF Supply-Noise Measurement — Execution Procedure

> **Issue:** [IOT-5914](../../../../../../../../../IOT/issues/IOT-5914)
> **ADR-001 Contract:** docs/adr/ADR-001-adc-avdd-noise-measurement-contract.md
> **Pre-compliance Report:** docs/00_management/evidence/emc/pre-compliance-report.md
> **Evidence Path:** docs/00_management/evidence/emc/adc-noise/

## Equipment Required

| Item | Spec |
|------|------|
| Oscilloscope | ≥200 MHz BW, 1 GS/s, FFT mode |
| Passive probes | 10×, spring-ground (short return path) |
| Isolation transformer | For 24VAC supply mode |
| Linear PSU or battery | 24VDC supply mode, no SMPS |
| DUT | MK-DDC-24 carrier board + Radxa CM3, production FW |
| Load simulator | UI sensor sim, DO/DI actuator, AO load |

## DUT Configuration

| Parameter | Setting |
|-----------|---------|
| Firmware | Production build |
| BACnet link | Active, COV polling every 5s |
| UI channels | 8× enabled, NTC 10kΩ input |
| DI channels | 8× dry contact, 50% ON |
| AO channels | 2× 0-10V, 2× 4-20mA |
| DO/Relay | 2× ON, 2× cycling |
| Supply | 24VAC and 24VDC (separate runs) |

## Measurement Nodes (5 nodes)

| # | Node | Description | Probe Point |
|---|------|-------------|-------------|
| 1 | `24V_rectified` | Post-bridge bulk DC node | Bridge rectifier output cap |
| 2 | `+5V_LM2596` | LM2596HVS DC/DC buck output | Output cap or IC pin |
| 3 | `+3V3_AP2114H` | AP2114H LDO output (3.3V) | Output cap or IC pin |
| 4 | `AVDD_ADC_3V3` | ADS131M08 analog supply | U3 AVDD pin or nearest decoupling cap |
| 5 | `VREF_ADC_2V5` | REF3025 reference output | REF3025 output pin or decoupling cap |

## Capture Classes (per supply mode)

### LF_ripple
- **Coupling:** DC
- **Timebase:** 5 ms/div (slower if needed for full envelope)
- **Metrics:** Noise p-p, Noise RMS
- **Channel groups:**
  - Group A: 24V_rectified, +5V_LM2596, +3V3_AP2114H, AVDD_ADC_3V3
  - Group B: +3V3_AP2114H, AVDD_ADC_3V3, VREF_ADC_2V5

### HF_noise_fft
- **Coupling:** AC (or math-removed DC offset)
- **Timebase:** 10 µs/div
- **BW Limit:** 20 MHz ON for p-p/RMS
- **FFT Span:** 0–500 kHz
- **Metrics:** Noise p-p, Noise RMS, Dominant Freq (kHz)
- **Channel groups:**
  - Group A: 24V_rectified, +5V_LM2596, +3V3_AP2114H, AVDD_ADC_3V3
  - Group B: +3V3_AP2114H, AVDD_ADC_3V3, VREF_ADC_2V5, helper/trigger

## Evidence File Naming

Store all files in this directory (`docs/00_management/evidence/emc/adc-noise/`).

Pattern: `YYYYMMDD_<supply-mode>_<capture-class>_<node-or-group>.<ext>`

| Example | Description |
|---------|-------------|
| `20260603_24VAC_LF_ripple_groupA.png` | 24VAC, LF ripple, all 4 channels group A |
| `20260603_24VAC_LF_ripple_groupB.png` | 24VAC, LF ripple, group B (VREF) |
| `20260603_24VAC_HF_noise_fft_groupA.png` | 24VAC, HF FFT, group A |
| `20260603_24VAC_HF_noise_fft_groupB.png` | 24VAC, HF FFT, group B |
| `20260603_24VDC_LF_ripple_groupA.png` | 24VDC, LF ripple, group A |
| `20260603_24VDC_LF_ripple_groupB.png` | 24VDC, LF ripple, group B |
| `20260603_24VDC_HF_noise_fft_groupA.png` | 24VDC, HF FFT, group A |
| `20260603_24VDC_HF_noise_fft_groupB.png` | 24VDC, HF FFT, group B |

Optional: export CSV for FFT data: `YYYYMMDD_24VAC_HF_noise_fft_AVDD_ADC_3V3.csv`

## Quality Flags

Mark any degraded evidence with one of:
- `invalid_probe_ground` — long flying ground lead used
- `invalid_supply_source` — SMPS used for 24VDC baseline
- `invalid_load_state_unknown` — DUT load state not recorded
- `invalid_ambient_noise_unchecked` — scope noise floor not verified before measurement
- `partial_node_access` — node not physically probeable

## Acceptance Criteria

| Criterion | Limit |
|-----------|-------|
| AVDD noise p-p | ≤ 5 mV p-p |
| VREF noise p-p | ≤ 1 mV p-p |
| ADC signal BW (0–500 Hz) | No coherent spur |
| Evidence files | All 5 nodes, both supply modes, both capture classes |

## Report Sections to Update After Measurement

After measurement, populate:
1. `pre-compliance-report.md` §10.3 — measurement result rows
2. `pre-compliance-report.md` §10.4 — 24VAC vs 24VDC comparison
3. `pre-compliance-report.md` §11.1 — verdict for §10 row
4. `pre-compliance-report.md` §11.3 — overall assessment status

## Procedure (step-by-step)

1. Power DUT with 24VAC via isolation transformer, all I/O active
2. Verify DUT boot, BACnet link up, I/O functional
3. Connect 10× probes with spring ground to Group A nodes
4. Set scope: DC-coupled, 5 ms/div, capture LF_ripple group A → save screenshot
5. Reconfigure to Group B nodes, capture LF_ripple group B → save screenshot
6. Set scope: AC-coupled, 10 µs/div, 20 MHz BW limit
7. Capture HF_noise_fft group A → save screenshot
8. Capture HF_noise_fft group B → save screenshot
9. Enable FFT mode (0–500 kHz span), capture per-node FFT for AVDD + VREF
10. Record Noise p-p, Noise RMS, Dominant Freq for each rail in results table
11. Repeat steps 1–10 with 24VDC linear PSU/battery
12. Populate pre-compliance-report.md §10.3, §10.4, §11
13. Push evidence files and report updates to repo
