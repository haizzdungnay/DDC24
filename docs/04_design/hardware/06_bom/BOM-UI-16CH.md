# BOM - Universal Input 16CH Rev A

> **Document:** BOM-UI-16CH | Rev 1.1 | 2026-06-30
> **Ap dung cho:** HW-DES-03-UI Rev 2.2
> **Trang thai:** Preliminary schematic BOM; pricing and alternates require sourcing review

---

## 1. Scope

This BOM covers the Rev A Universal Input subsystem only:

- 16 analog UI channels
- 2x ADS131M08 ADC devices
- Per-channel mode select latch
- 0-10V, 4-20mA, NTC 10k/20k, auxiliary dry contact

Excluded from this BOM:

- PT100/PT1000 RTD front-end
- Industrial isolated DI
- AO/DO/power/CM3/communication sections

---

## 2. Key Architecture BOM Decisions

| Item | Decision |
|------|----------|
| ADC | Keep 2x ADS131M08 |
| Mode select | Add 48-bit latch/shift-register outputs for per-channel mode bits |
| 4-20mA shunt | Change from 62R to **49.9R 0.1% 25ppm/C** |
| 0-10V input | Add RRIO buffer after divider/filter |
| NTC reference | Precision or measured `VREF_UI`, not assumed CM3 PMIC 3.3V |
| RTD parts | Not populated in Rev A |
| Dry contact | Auxiliary only; no isolated DI replacement claim |

---

## 3. UI BOM Detail

| RefDes | Description | Primary value / part | Package | Qty | Critical requirements | Alternates / notes |
|--------|-------------|----------------------|---------|----:|-----------------------|--------------------|
| U3, U3B | 8-channel 24-bit ADC | ADS131M08IPBSR | TSSOP-32 | 2 | Use TI ADS131M08; no direct substitute without FW validation | ADS131M08IPBS if supply/package OK |
| U17-U32 | Low-voltage analog mux, if final schematic keeps mux stage | TMUX1208RSVR | VSSOP/QFN | 16 | Signal pins only see 0V..VDD low-voltage nodes | TMUX1208PWR; verify package/availability |
| U40-U45 | Mode latch/shift register | 74HCS595 / 74HC595 3.3V compatible | TSSOP/SOIC | 6 | 48 outputs for 16 x 3 mode bits; reset/default safe | SN74HCS595, 74LVC595 if voltage compatible |
| U46-U53 | RRIO buffer op-amp, dual | TLV9062 / OPA2991 class | SOIC/VSSOP | 8 | Low offset/bias enough for 0-10V and current low-end | Select after error-budget review |
| U54 | UI excitation/reference | REF3025 or precision VREF_UI source | SOT-23 | 1 | Used or measured for NTC ratiometric calculation | Existing analog reference acceptable only if loading/noise OK |
| R30-R45 | 0-10V divider top | 100k 0.1% 25ppm | 0603/0805 | 16 | Prefer matched network for better ratio drift | Thin-film network alternate |
| R46-R61 | 0-10V divider bottom | 12.1k 0.1% 25ppm | 0603/0805 | 16 | 10V -> about 1.079V | Thin-film network alternate |
| R66-R81 | 4-20mA shunt | **49.9R 0.1% 25ppm, >=0.125W** | 0805/1206 | 16 | 24mA -> 1.1976V, 0.0287W | 0.25W preferred for margin |
| R82-R97 | NTC pull-up | 10k 0.1% 25ppm | 0603 | 16 | Default NTC 10k B3950 | Fit 20k option where SKU/config requires |
| R98-R113 | UI series/current-limit | Value per protection calc | 0805/1206 | 16 | Must survive calculated fault case | Use fusible resistor where appropriate |
| F_UI1-F_UI16 | Resettable protection | PTC, hold/trip TBD | 1812 or similar | 16 | 24V miswire protection; final hold/trip must be calculated | Could be fusible resistor if service model allows |
| D20-D35 | Terminal TVS | Field-side TVS, voltage TBD by mode/protection calc | SMA/SMB | 16 | Place closest to terminal | Do not rely on ADC clamp diode |
| D36-D51 | Low-voltage clamp | BAT54S or low-leakage clamp | SOT-23 | 16 | After divider/front-end only | Verify leakage vs error budget |
| C_UIx_AA | Anti-alias/filter capacitors | TBD by bandwidth | C0G/X7R | 16+ | Values depend on final sample/filter design | Avoid high leakage dielectrics on precision nodes |
| J4A/J4B | UI terminal block | 2 x 16-position pair or equivalent | 5.08mm | 2 | 16 channels with return/common per final wiring | Must fit enclosure |
| TP_UIx | Test points | Field and low-voltage representative nodes | 1mm pad | TBD | Required for production/debug | At least representative channels if space limited |

---

## 4. Removed / Not Populated for Rev A

| Item | Status | Reason |
|------|--------|--------|
| 62R shunt | Removed | 20mA was too close to ADC headroom; 24mA overrange not safe enough |
| REF200 RTD excitation | Not populated | RTD removed from Rev A UI |
| PT100/PT1000 Kelvin network | Not populated | Requires dedicated 3-wire/4-wire RTD design |
| PC817 DI claim inside UI | Not applicable | True DI isolated must be a separate sheet/module |

---

## 5. Sourcing Notes

- ADS131M08 availability must be checked before schematic freeze.
- TMUX1208 package and voltage domain must match the low-voltage-only usage in HW-DES-03-UI.
- Op-amp selection drives the final error budget; do not freeze accuracy claims until selected.
- PTC/fusible protection values must be chosen from a calculated 24V miswire table, not copied from a generic design.

### 5.1 Alternate-part qualification

An entry in the “Alternates / notes” column is a candidate, not an approved second source. For each critical part, sourcing must attach an equivalence record covering:

| Part class | Mandatory comparison |
|---|---|
| ADS131M08 | Register/frame behavior, noise, reference, clocking, package/pinout, firmware impact |
| Analog mux | Supply/signal range, on-resistance/flatness, leakage, charge injection, ESD, pinout/package |
| RRIO op-amp | Input/output range, offset/bias/noise/drift, stability with RC/load, supply, pinout |
| Mode latch | VIH/VIL at 3.3V, power-up/reset/OE behavior, output drive, package/pinout |
| Divider/shunt network | Ratio/absolute tolerance, TCR tracking, voltage/power rating, pulse/fault behavior |
| PTC/fuse/TVS/clamp | Hold/trip, leakage, standoff/clamp at test current, pulse energy, capacitance, failure mode |
| Connector | Pitch/keying/current/voltage, wire range, enclosure fit, creepage/clearance |

Approval requires HW, firmware (where behavior changes), sourcing, and QA sign-off plus a test result on the worst affected mode. Until then the part stays `candidate`, not `approved alternate`.

---

## 6. Release Checklist

- [ ] Final schematic RefDes match this BOM.
- [ ] 49.9R shunt appears on all 16 current-input paths.
- [ ] No 62R shunt remains in UI BOM.
- [ ] No RTD excitation parts are populated as Rev A UI default.
- [ ] Mode latch output count covers 16 x 3 mode bits.
- [ ] Protection component ratings are backed by current/power calculations.
- [ ] Alternate parts are reviewed for voltage, leakage, drift, and package.

---

## Revision History

| Rev | Date | Change |
|---|---|---|
| 1.0 | 2026-06-23 | Preliminary UI Rev A BOM. |
| 1.1 | 2026-06-30 | Defined critical-part second-source qualification and approval evidence. |

**Document ID:** BOM-UI-16CH | Rev 1.1 | 2026-06-30
