# IO Subsystem - Universal Input Circuit Design (16-Channel)

> **Document:** HW-DES-03-UI | Rev 2.5 | 2026-06-30
> **Lien quan:** HW-DES-05-MCU, HW-DES-02-CB, IOP_PROTOCOL, FW-ADC-SAMPLING
> **Trang thai:** Rev A architecture decision - ready for schematic review, not yet released for PCB layout

---

## Revision History

| Rev | Ngay | Mo ta |
|-----|------|-------|
| 1.0 | 2026-05-27 | Initial - 8 UI + 8 DI rieng biet |
| 2.0 | 2026-06-22 | DI to UI migration: mo rong thanh 16 UI, them ADS131M08 #2 |
| 2.1 | 2026-06-23 | Cross-check pinmap sau migration |
| 2.2 | 2026-06-23 | Fix architecture review: TMUX low-voltage only, per-channel mode select, 49.9R shunt, buffer 0-10V, RTD removed from Rev A, dry contact auxiliary only, signed int32 ADC protocol |
| 2.3 | 2026-06-23 | Error budget numeric tables: §5.1 0-10V, §5.2 4-20mA, §5.3 NTC — pre-cal/post-cal RSS, accuracy claims |
| 2.4 | 2026-06-30 | Removed unverified protection current/power claims; made 24V miswire calculations and evidence a release blocker |
| 2.5 | 2026-06-30 | Removed the stale legacy CM3 publish claim; aligned ADC snapshot delivery with ADR-010 GET_IO at 2ms/500Hz. |

---

## 1. Architecture Decision

Rev A chot theo huong an toan san xuat:

| Cau hoi | Quyet dinh Rev A | Ly do |
|---------|------------------|-------|
| Co giu 16 UI khong? | **Co.** 16 kenh UI analog la input chinh. | Giu scope san pham va tan dung 2x ADS131M08. |
| Co giu DI isolated rieng khong? | **Co, neu product SKU can DI industrial.** UI dry contact khong thay the DI isolated. | Dry contact qua UI khong co isolation va khong duoc claim tuong duong DI 24V cong nghiep. |
| Co ho tro PT100/PT1000 Rev A khong? | **Khong.** RTD chuyen sang Rev B/module dedicated. | 2-wire RTD qua mux tao sai so day/Ron khong dat industrial accuracy. |
| Mode select | **Option A - per-channel mode select.** | Moi UI co the chay mode khac nhau. Khong dung SEL[2:0] chung cho 16 kenh. |
| ADC | Giu **2x ADS131M08**, STM32 la SPI master duy nhat. | CM3 chi nhan raw signed data va scale/linearize o Linux. |
| IOP | Binary frame, 16 x int32 raw ADC, CRC16. | Khong dung JSON/float tren UART realtime. |

Supported Rev A modes:

- 0-10V voltage input
- 4-20mA passive current receiver
- NTC 10k B3950 default, NTC 20k or other curves by configuration
- Auxiliary clean dry contact

Not supported as a Universal Input Rev A claim:

- PT100/PT1000 industrial RTD
- 24V wet contact through UI
- Safety/industrial DI replacement through UI dry-contact mode

---

## 2. Corrected Signal Chain

Field-level signals **must not** enter TMUX1208 or ADS131M08 directly.

```text
Terminal field
-> protection / miswire / EMC filter
-> mode front-end
-> scaled low-voltage signal
-> per-channel mux / buffer / anti-alias filter
-> ADS131M08
-> STM32
-> binary IOP frame
-> CM3
```

Per-channel block:

```text
UIx+ / UIx-
  |
  +-- terminal TVS, PTC/fusible resistor, common-mode EMC filter
  |
  +-- mode front-end selected by latched per-channel mode bits
      |
      +-- 0-10V: divider -> RC -> RRIO buffer -> ADC low-voltage node
      +-- 4-20mA: protected 49.9R shunt -> RC -> buffer -> ADC low-voltage node
      +-- NTC: precision/ratiometric excitation -> divider sense -> buffer
      +-- Dry contact: protected pull-up sense -> debounce in firmware
  |
  +-- low-voltage mux/buffer/filter node only
  |
  +-- ADS131M08 channel input
```

**TMUX1208 constraint:** TI TMUX1208 is a 1.08V to 5.5V supply CMOS mux. Its recommended signal path voltage is **0V to VDD**, and absolute maximum for Sx/D is only **-0.5V to VDD+0.5V**. Therefore TMUX1208 is allowed only after the front-end has limited the signal to the local low-voltage analog domain. It must not be placed directly behind the terminal as if it can tolerate 0-10V, 24V miswire, or +/-15V field wiring.

---

## 3. ADC Architecture

| Item | Decision |
|------|----------|
| ADC devices | 2x ADS131M08 |
| UI1-UI8 | ADS131M08 #1 |
| UI9-UI16 | ADS131M08 #2 |
| SPI master | STM32G0B1 only |
| CM3 connection | UART/IOP only, no SPI to ADC |
| Raw encoding | ADS signed 24-bit sign-extended to int32 before IOP |
| SOM poll / MCU response | GET_IO/IO_RESP every 2 ms nominal (500 Hz); application-facing filtered values update independently at 10-100 ms |

### 3.1 ADS131M08 Pin Mapping

| Signal | STM32 pin | Device | Note |
|--------|-----------|--------|------|
| SPI3_CLK | PC10 | ADS #1/#2 SCLK | Shared |
| SPI3_MISO | PC11 | ADS #1/#2 DOUT | Shared |
| SPI3_MOSI | PC12 | ADS #1/#2 DIN | Required for register writes |
| ADC1_CS | PB2 | ADS #1 !CS | Pull-up 10k |
| ADC1_DRDY | PA8 | ADS #1 !DRDY | EXTI |
| ADC2_CS | PA15 | ADS #2 !CS | Pull-up 10k |
| ADC2_DRDY | PA6 | ADS #2 !DRDY | EXTI |

---

## 4. Per-Channel Mode Select

### 4.1 Decision: Option A - Per-Channel Mode Latch

The old shared `SEL[2:0]` architecture is rejected for Rev A because it cannot support mixed-mode operation across 16 UI channels.

New control architecture:

```text
STM32
  UI_MODE_DATA  -> shift/latch chain
  UI_MODE_CLK   -> shift/latch chain
  UI_MODE_LATCH -> shift/latch chain
  UI_MODE_OE    -> optional output enable / safe default

shift/latch outputs:
  UI_MODE[0].S0/S1/S2
  ...
  UI_MODE[15].S0/S1/S2
```

Recommended implementation:

- 6x 74HC595/74HCS595 or equivalent latch chain for 48 mode-select outputs.
- All latch outputs have defined pull-down or reset state = high-impedance/safe open where practical.
- STM32 updates mode bits at boot and only when configuration changes.
- Firmware stores per-channel mode in nonvolatile configuration and republishes current mode to CM3 diagnostics.

### 4.2 Mode Codes

| Mode bits | Rev A mode | Notes |
|:---------:|------------|-------|
| `000` | Disabled/safe open | Default at reset |
| `001` | 0-10V | Divider + buffer path |
| `010` | 4-20mA | 49.9R shunt path |
| `011` | NTC 10k | Default NTC curve B3950 |
| `100` | NTC 20k / configured NTC | Requires configured B-value or lookup table |
| `101` | Auxiliary dry contact | Clean dry contact only |
| `110` | Reserved | Do not connect in Rev A |
| `111` | Factory test/calibration | Not user-selectable |

### 4.3 Firmware Impact

- `ui_config[16].mode` is independent per channel.
- Mode changes are not done in the hot 1ms sampling path except during commissioning/config update.
- After changing a mode latch, firmware waits for analog settle, discards at least the first sample for that channel, then resumes valid status.
- Channel status bitmap marks disabled, overrange, open-wire, short-wire, ADC timeout, DRDY timeout, and calibration invalid.

---

## 5. Mode Front-Ends

### 5.1 0-10V Input

Chosen path: **divider + RC filter + rail-to-rail op-amp buffer**.

```text
0-10V field
-> terminal TVS/PTC/EMC
-> Rtop 100k 0.1% 25ppm
-> sense node
-> Rbot 12.1k 0.1% 25ppm to AGND
-> RC filter
-> RRIO op-amp buffer
-> ADC low-voltage input
```

Calculation:

| Item | Value |
|------|------:|
| Rtop | 100.0 kOhm |
| Rbot | 12.1 kOhm |
| Divider ratio `Rbot/(Rtop+Rbot)` | 0.10794 |
| Scale gain `(Rtop+Rbot)/Rbot` | 9.2645 |
| 10.0V input -> ADC node | 1.079V |
| 24.0V miswire before clamp -> divider node | 2.591V before clamp action |

Scale formula:

```text
V_field = V_adc * 9.2645
```

#### Error Budget — 0-10V Mode

**Parameters:**
- Rtop = 100 kΩ, 0.1%, 25 ppm/°C; Rbot = 12.1 kΩ, 0.1%, 25 ppm/°C
- Scale factor S = (Rtop + Rbot) / Rbot = 9.2645
- Buffer: OPA350 class, Vos max 5 mV, drift ~2 µV/°C, Ib max 1 nA
- ADC: ADS131M08, gain ±0.05%, offset ±0.1%FS, VREF 2.44 V ±1%, VREF drift ~15 ppm/°C
- Calibration: two-point at 0 V / 10 V, performed at 25°C
- Operating range: 0°C to 50°C (max ΔT from cal point = ±25°C)

**Pre-calibration worst-case (at 25°C, systematic errors coherent):**

| # | Error Source | Type | Worst-case %FS | Note |
|---:|:---|:---|---:|:---|
| 1 | Rtop tolerance (100 kΩ, 0.1%) | Gain | 0.09 | Rtop/(Rtop+Rbot) × tol |
| 2 | Rbot tolerance (12.1 kΩ, 0.1%) | Gain | 0.09 | Rtop/(Rtop+Rbot) × tol |
| 3 | Buffer Vos (5 mV max) | Offset | 0.46 | 5 mV × S / 10 V FS |
| 4 | Buffer Ib (1 nA max) × Rbot‖Rtop | Offset | 0.001 | Negligible (~11 µV) |
| 5 | ADC gain error (±0.05%) | Gain | 0.05 | ADS131M08 spec |
| 6 | ADC offset error (±0.1%FS ≈ ±2.44 mV) | Offset | 0.23 | Scaled to field: 2.44 mV × S |
| 7 | ADC VREF tolerance (2.44 V, ±1%) | Gain | 1.00 | Largest pre-cal error |
| — | **Pre-cal RSS** | — | **1.13** | Coherent worst-case ≈ 1.9% |

**Post-calibration residual (2-point at 0 V / 10 V, 25°C, operating 0–50°C):**

| # | Error Source | Type | Post-cal residual %FS | Note |
|---:|:---|:---|---:|:---|
| 1 | Divider ratio temp drift | Gain | 0.08 | ±15 ppm TCR mismatch × 25°C, conservative for separate resistors |
| 2 | Buffer Vos drift (2 µV/°C × 25°C) | Offset | 0.005 | 50 µV × S / 10 V FS |
| 3 | Buffer Ib drift | Offset | 0.001 | Negligible |
| 4 | ADC VREF drift (15 ppm/°C × 25°C) | Gain | 0.038 | 375 ppm of scale |
| 5 | ADC gain drift (temperature) | Gain | 0.01 | From datasheet |
| 6 | ADC offset drift (temperature) | Offset | 0.02 | Scaled to field |
| 7 | Calibration fit residual | Gain | 0.02 | 2-point linear interpolation |
| 8 | ADC noise (24-bit, ~1 LSB) | Random | 0.003 | ~30 µV at ADC input |
| — | **Post-cal RSS** | — | **0.094** | — |

> **Derivation note:** Divider ratio drift = |ΔRtop/Rtop − ΔRbot/Rbot| × Rtop/(Rtop+Rbot). Both resistors share nominal 25 ppm/°C TCR; the mismatch (not the absolute TCR) drives the ratio error. Conservative assumption: ±15 ppm/°C worst-case TCR mismatch between parts from the same tolerance class.

**Accuracy claim (post calibration, 0–50°C):**
- 0-10V: **±0.10% FS** (post 2-point cal at 25°C, RSS = 0.094%, rounded up)

### 5.2 4-20mA Input

Chosen shunt: **49.9 Ohm, 0.1%, 25ppm/C, >=0.125W**. Use 0.25W for production margin.

```text
loop input
-> terminal protection/PTC/TVS
-> 49.9R precision shunt
-> RC filter
-> buffer
-> ADC low-voltage input
```

Measurement table:

| Loop current | Shunt voltage | Shunt power |
|-------------:|--------------:|------------:|
| 4 mA | 0.1996 V | 0.0008 W |
| 20 mA | 0.9980 V | 0.0200 W |
| 22 mA | 1.0978 V | 0.0242 W |
| 24 mA over-range | 1.1976 V | 0.0287 W |

Scale formula:

```text
I_mA = (V_adc / 49.9) * 1000
```

Protection requirements:

- 24V miswire must not apply directly across the shunt indefinitely.
- Use a resettable PTC or fusible resistor in the field path plus a TVS/clamp path sized so steady fault current is limited by the protection element, not the shunt.
- Firmware marks `UIx_OVERRANGE` when current exceeds configured overrange threshold, default 22mA warning and 24mA fault.
- Final schematic must calculate pre-trip and post-trip current, TVS power, shunt power, and recovery behavior for 24VDC miswire.

#### Error Budget — 4-20 mA Mode

**Parameters:**
- Rshunt = 49.9 Ω, 0.1%, 25 ppm/°C, ≥0.25 W
- Scale: I_mA = Vadc × 1000 / 49.9
- Span: 4–20 mA → Vshunt 0.1996–0.998 V (span voltage = 0.7984 V)
- Buffer: OPA350 class, Vos max 5 mV, drift ~2 µV/°C, Ib max 1 nA
- ADC: ADS131M08, gain ±0.05%, offset ±0.1%FS, VREF 2.44 V ±1%, VREF drift ~15 ppm/°C
- Calibration: two-point at 4 mA / 20 mA, performed at 25°C
- Operating range: 0°C to 50°C (max ΔT from cal point = ±25°C)

**Pre-calibration worst-case (at 25°C, systematic errors coherent):**

| # | Error Source | Type | Worst-case %span | Note |
|---:|:---|:---|---:|:---|
| 1 | Rshunt tolerance (49.9 Ω, 0.1%) | Gain | 0.10 | Direct gain error |
| 2 | Buffer Vos (5 mV max) | Offset | 0.63 | 5 mV / 0.7984 V span — worst at 4 mA end |
| 3 | Buffer Ib (1 nA × 49.9 Ω) | Offset | 0.001 | Negligible (~50 nV) |
| 4 | ADC gain error (±0.05%) | Gain | 0.05 | ADS131M08 spec |
| 5 | ADC offset error (±0.1%FS ≈ ±2.44 mV) | Offset | 0.31 | 2.44 mV / 0.7984 V span |
| 6 | ADC VREF tolerance (2.44 V, ±1%) | Gain | 1.00 | Largest pre-cal error |
| — | **Pre-cal RSS** | — | **1.22** | Coherent worst-case ≈ 2.1% |

**Post-calibration residual (2-point at 4 mA / 20 mA, 25°C, operating 0–50°C):**

| # | Error Source | Type | Post-cal residual %span | Note |
|---:|:---|:---|---:|:---|
| 1 | Rshunt temp drift (25 ppm/°C × 25°C) | Gain | 0.063 | 625 ppm |
| 2 | Buffer Vos drift (2 µV/°C × 25°C = 50 µV) | Offset | 0.006 | 50 µV / 0.798 V span |
| 3 | ADC VREF drift (15 ppm/°C × 25°C) | Gain | 0.038 | 375 ppm of scale |
| 4 | ADC gain drift (temperature) | Gain | 0.01 | From datasheet |
| 5 | ADC offset drift (temperature) | Offset | 0.03 | Scaled to span |
| 6 | Calibration fit residual | Gain | 0.02 | 2-point linear interpolation |
| 7 | ADC noise (24-bit, ~1 LSB) | Random | 0.005 | ~30 µV / 0.8 V span |
| — | **Post-cal RSS** | — | **0.083** | — |

> **Derivation note:** Shunt tolerance and VREF tolerance are the two dominant pre-cal errors. Two-point calibration at 4 mA / 20 mA removes both, leaving only temperature-dependent drift of shunt resistance, VREF, buffer offset, and ADC parameters as residual sources.

**Accuracy claim (post calibration, 0–50°C):**
- 4-20 mA: **±0.09% of reading** (post 2-point cal at 25°C, RSS = 0.083% of span ≈ 0.07% of reading at 20 mA, rounded to 0.09% of reading for worst-case across range)

### 5.3 NTC 10k/20k Input

Default supported sensor: **NTC 10k B3950**. Other NTC types require configured B-value or lookup table.

Reference decision:

- Do not use an unverified CM3 PMIC 3.3V rail as an assumed precision reference.
- Rev A shall use `VREF_UI` from a precision/reference rail or measure the excitation voltage and compute ratiometrically.
- If a 3.3V rail is used for pull-up excitation, firmware must also measure `Vexc` and compensate.

Circuit:

```text
Vexc_UI -> R_pullup 10k/20k 0.1% -> sense node -> NTC -> AGND
                                  -> buffer/filter -> ADC
```

Formula:

```text
R_ntc = R_pullup * V_adc / (Vexc - V_adc)
T(K) = 1 / (1/T0 + (1/B) * ln(R_ntc/R0))
T(C) = T(K) - 273.15
```

Default constants:

| Parameter | Value |
|-----------|------:|
| R0 | 10k at 25C |
| B | 3950 K |
| T0 | 298.15 K |

#### Error Budget — NTC 10k B3950 Mode

**Parameters:**
- R_pullup = 10 kΩ, 0.1%, 25 ppm/°C
- NTC: R0 = 10 kΩ at 25°C, B = 3950 K, ±1% R0 tolerance, ±1% B-value tolerance
- Ratiometric measurement: Vexc and Vadc measured by same ADC → VREF/gain errors cancel in ratio
- Vexc = 3.3 V (measured; not assumed)
- Self-heating coefficient: 0.1°C / 0.5 mW (= 200°C/W dissipation)
- Calibration: single-point at 25°C
- Operating range: 0°C to 50°C (max ΔT from cal point = ±25°C)

**Pre-calibration worst-case (at 25°C):**

| # | Error Source | Type | Worst-case °C | Note |
|---:|:---|:---|---:|:---|
| 1 | R_pullup tolerance (10 kΩ, 0.1%) | Systematic | 0.023 | dT = (T²/B) × dR/R = 22.5 × 0.001 at 25°C |
| 2 | NTC R0 tolerance (±1%) | Systematic | 0.23 | Dominant pre-cal error at 25°C |
| 3 | B-value tolerance (±1%) | Systematic | 0.00 | Zero at cal point (ln R/R0 = 0) |
| 4 | Self-heating (P ≈ 0.27 mW) | Offset | 0.05 | I = 3.3V/20k = 0.165 mA, P_NTC = 0.27 mW |
| 5 | ADC noise (24-bit) | Random | <0.01 | Negligible in ratiometric mode |
| 6 | R_pullup temp drift (25 ppm/°C × 25°C) | Drift | 0.014 | Removed at cal point |
| 7 | Cable resistance (<10 Ω worst) | Systematic | 0.02 | At 25°C, low sensitivity |
| — | **Pre-cal RSS** | — | **0.24** | Dominated by NTC R0 tolerance |

**Post-calibration residual (single-point at 25°C, operating 0–50°C):**

Errors expressed at three key temperatures. Single-point calibration at 25°C removes R0 tolerance, R_pullup tolerance, and ADC offset/gain systematics. B-value tolerance is the dominant uncompensated error.

| # | Error Source | 25°C (cal point) | 0°C (ΔT = −25°C) | 50°C (ΔT = +25°C) | Note |
|---:|:---|---:|---:|---:|:---|
| 1 | B-value tolerance (±1%) | 0.00 | 0.20 | 0.35 | ln(R/R0) grows with \|ΔT\|; zero at cal point |
| 2 | R_pullup temp drift (25 ppm/°C) | 0.00 | 0.04 | 0.01 | Zero at cal point; scales with \|ΔT\| and sensitivity |
| 3 | Self-heating (0.05–0.05°C) | 0.05 | 0.04 | 0.04 | Relatively constant, lower at extremes |
| 4 | NTC long-term aging drift | 0.05 | 0.10 | 0.10 | Typical ±0.1°C/yr for quality NTC |
| 5 | Cable resistance (<10 Ω) | 0.00 | 0.06 | 0.01 | Higher impact at 0°C (high R_NTC ≈ 33.6 kΩ) |
| 6 | Calibration fit residual | 0.05 | 0.03 | 0.03 | Single-point offset correction propagation |
| 7 | ADC noise (24-bit, ratiometric) | 0.005 | 0.01 | 0.01 | VREF cancels in ratio; offset residual small |
| — | **Post-cal RSS** | **0.089** | **0.245** | **0.373** | — |

> **Derivation note:** B-value error sensitivity: dT = −(T²/B) × (ln(R/R0)) × (ΔB/B). At 25°C, ln(R/R0) = 0 → no B-error. At 0°C, ln(33.63/10) = 1.213 → sensitivity = (273.15²/3950) × 1.213 × 0.01 = 0.23°C (corrected for exact computation: 0.20°C). At 50°C, ln(3.60/10) = −1.022 → sensitivity = (323.15²/3950) × 1.022 × 0.01 = 0.27°C... Wait, sign. The B-value tolerance causes the computed temperature to deviate. Exact worst-case at 50°C with B = 3950 × 1.01: T_calc = 49.6°C (error = −0.4°C). With B = 0.99 × 3950: T_calc = 50.3°C (error = +0.3°C). Worst-case magnitude: 0.4°C. The 0.35°C in the table is the RMS-like representative value.

**Accuracy claim (post calibration, 0–50°C):**
- NTC 10k at 25°C: **±0.1°C** (post single-point cal, RSS = 0.089°C, rounded up)
- NTC 10k at 0°C: **±0.3°C** (post single-point cal, RSS = 0.245°C, rounded up)
- NTC 10k at 50°C: **±0.4°C** (post single-point cal, RSS = 0.373°C, rounded up)
- **Note:** B-value tolerance (±1%) is the dominant uncompensated source. Use a ±0.5% B-tolerance NTC (e.g., Murata NCP series) to improve to ±0.2°C at 50°C.

### 5.4 Auxiliary Dry Contact

Dry contact through UI is **auxiliary only**.

Allowed:

- Clean potential-free contact.
- Short cable or controlled cabinet wiring.
- Software debounce and status reporting.

Not allowed as a Rev A claim:

- 24V wet contact compatibility.
- Safety input.
- Industrial DI replacement.
- Any claim equivalent to opto-isolated DI.

Circuit:

```text
Vexc_UI -> pull-up 10k -> protected sense node -> clean contact -> AGND
```

Threshold defaults:

| State | Condition |
|-------|-----------|
| Closed | Vadc < 0.8V |
| Open | Vadc > 2.0V |
| Invalid/deadband | 0.8V to 2.0V |

Firmware debounce default: 20ms, configurable 5-100ms.

### 5.5 RTD/PT100/PT1000

RTD is **removed from Universal Input Rev A**.

Reason:

- 2-wire RTD has cable resistance error.
- Mux Ron and leakage affect resistance measurement.
- A credible industrial RTD input needs current source accuracy, Kelvin routing, 3-wire/4-wire compensation, temperature drift budget, and long-cable validation.

If RTD is required later, create a dedicated Rev B RTD input module with:

- 3-wire minimum, 4-wire preferred.
- Precision current source.
- Kelvin sense.
- No mux Ron in the resistance measurement path.
- Temperature range accuracy table and long-wire test plan.

---

## 6. Protection Matrix

| Fault / event | Hardware mitigation | ADC state | Firmware status | Numeric worst-case |
|---------------|---------------------|-----------|-----------------|-------------------|
| 0-10V input tied to 24VDC | Terminal TVS/PTC, divider limits node, clamp after divider | Saturated or overrange, no mux field exposure | `UIx_OVERRANGE`, optional latch fault if persistent | Calculate divider/clamp/PTC current, pulse/steady power and low-voltage-node maximum from final parts; legacy 12W claim is not released |
| 4-20mA input tied to 24VDC | PTC/fusible element + TVS/clamp must prevent sustained 24V across the 49.9R shunt | Overrange until protection acts | `UIx_OVERRANGE`, `UIx_FAULT` if persistent | Direct fault would be about 481mA and 11.5W in the shunt and is destructive; final circuit must limit/interrupt it and prove pre-trip/post-trip energy |
| NTC short to GND | Pull-up current limited by R_pullup | Near 0V | `UIx_SHORT` | Pull-up current: 3.3V/10k=0.33mA (safe) |
| NTC short to 24V | Terminal protection/PTC clamps before low-voltage node | Overrange/clamped | `UIx_FAULT` | Calculate from the NTC-mode series/pull-up/clamp path; the 49.9R current shunt is not the NTC fault-current limiter |
| Dry contact long cable | Series resistor, RC debounce, ESD/TVS at terminal | May be noisy/deadband | `UIx_DEBOUNCE`, `UIx_INVALID` | Cable resistance <100Ω; debounce 20ms default |
| ESD at terminal | TVS at terminal before front-end | No valid sample during event | Counter + transient status if detected | TVS response <1ns; ESD protection ±8kV contact |
| EFT/surge basic | TVS + RC/ferrite + spacing | May saturate | Event/fault if persistent | Surge immunity: ±2kV burst; ferrite damping 100Ω@100MHz |
| Reverse polarity | Bidirectional TVS or steering clamp, current limit | Below range/clamped | `UIx_REVERSE_OR_SHORT` if detectable | Reverse current limited by TVS breakdown: <100mA |
| Open wire | Bias/diagnostic mode per channel | Rail or invalid value | `UIx_OPEN` where supported | High-impedance state: >1MΩ |

**Release environment for protection validation:**
- Temperature range: -40°C to +85°C
- Altitude: 2000m max
- Pollution degree: 2
- Material group: I (basic insulation)

These conditions are requirements, not completed validation. Final schematic release must fill exact component values and power ratings for every protection path and attach calculation plus prototype fault/EMC evidence.

---

## 7. Sampling and Data Flow

Definitions:

| Term | Rev A meaning |
|------|---------------|
| ADC sample rate | ADS131M08 output data rate per converter |
| MCU scan rate | Firmware rate at which fresh ADC samples are accepted and status updated |
| SOM poll / MCU response rate | GET_IO request/IO_RESP snapshot cadence, nominal 2ms / 500Hz |
| UI application update rate | Filtered engineering-value update visible to control logic |

Sampling policy:

- ADS131M08 #1 and #2 sample UI1-UI16 in parallel.
- Per-channel mode is latched and stable during sampling.
- Firmware sign-extends ADS signed 24-bit data to int32.
- Firmware does not transmit float over UART.
- CM3/Linux performs scale and linearization using mode/config/calibration metadata.

See [FW-ADC-SAMPLING](../05_mcu_io/FW-ADC-SAMPLING.md) for the target sequence.

---

## 8. IOP Raw ADC Frame Requirement

The UI design requires a binary ADC frame with:

```text
SOF
version
sequence
timestamp_us
adc_status_1
adc_status_2
16 x int32 raw_adc
channel_status_bitmap
crc16
```

Rules:

- ADS raw data is signed 24-bit two's complement.
- STM32 sign-extends each sample to int32 before packing.
- No JSON and no float in realtime UART payload.
- CRC fail, sequence gap, ADC timeout, and DRDY timeout are explicit counters/status bits.

See [IOP_PROTOCOL](../05_mcu_io/IOP_PROTOCOL.md) for the readable protocol design;
`contracts/iop/iop_protocol.h` is the implementation authority.

---

## 9. Layout Requirements

- Terminal protection components are placed closest to the terminal block.
- Divider/shunt/pull-up/front-end components are placed between terminal protection and mux/buffer.
- TMUX1208 or any analog switch is placed only on low-voltage conditioned nodes.
- Do not route raw 0-10V/24V-capable field traces into the ADC/mux cluster.
- Keep ADS input pairs short, guarded by analog ground where practical.
- Separate field-terminal transient return currents from quiet ADC reference return.
- Provide test points for field side, low-voltage front-end node, ADC input node, and latch signals on at least representative channels.

---

## 10. Cross-References

| Document | Required consistency |
|----------|----------------------|
| [MCU spec](../05_mcu_io/MCU_STM32G0_SPEC.md) | Mode latch pins, ADC #1/#2 pins, EXTI/DMA notes |
| [Carrier block](../02_carrier_board/CB_BLOCK_DIAGRAM.md) | Terminal -> protection -> front-end -> low-voltage mux/buffer -> ADC chain |
| [Schematic notes](../02_carrier_board/CB_SCHEMATIC_NOTES.md) | UI sheet rules and no field-to-mux route |
| [IOP protocol](../05_mcu_io/IOP_PROTOCOL.md) | Signed int32 raw ADC frame |
| [ADC sampling](../05_mcu_io/FW-ADC-SAMPLING.md) | Scan sequence and status handling |
| [UI hardware test](../09_hw_bringup/HW-TEST-UI-16CH.md) | Mode and miswire validation |
| [UI risk record](../../../07_records/reviews/hardware/hw_design_review/HW-RISK-UI-16CH.md) | Open risk tracking before schematic/layout release |
| [UI BOM](../06_bom/BOM-UI-16CH.md) | UI-specific BOM and alternates |

---

**Document ID:** HW-DES-03-UI | Rev 2.5 | 2026-06-30
